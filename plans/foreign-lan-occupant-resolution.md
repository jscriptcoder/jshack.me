# Plan: Foreign LAN Occupant Resolution

**Branch**: `feat/foreign-lan-occupant-resolution-plan` (plan only; each implementation PR gets its own branch)
**Status**: Active

## Goal

Make Player A — sitting on her own LAN — able to **ssh / ftp / scp / nc / curl / gobuster / lynx / mysql / rediscli** into Player B's workstation via Player B's router NAT-forward, when A and B are on different LANs. Today the cross-LAN nmap path (trilogy PR 5, v0.138.0) discovers B's forwarded ports but the foothold primitives fail at the IP → workstation_id translation that A's local state doesn't perform for foreign occupants.

User frame (2026-05-19): _"the whole point of multi-player/cross-player"._

## Acceptance Criteria

Each row below must pass cross-LAN — Player A on LAN 1 acting against Player B on LAN 2. B's router has the relevant NAT forward installed; B has opened the underlying service on her workstation.

- [ ] `ssh <B.user>@<B.router.publicIp>` with B's `/etc/passwd` password lands a session on B's workstation (`session.machine = B.workstationId`); subsequent commands write/read against B's storage.
- [ ] `scp <local> <B.user>@<B.router.publicIp>:/tmp/` deposits the file under B's workstation_id.
- [ ] `ftp <B.router.publicIp>` reaches B's vsftpd virtual-users prompt; valid creds enter FTP mode with `remoteMachine = B.workstationId`.
- [ ] `nc <B.router.publicIp> <forwarded-backdoor-port>` opens a remote shell on B's workstation when B has planted a backdoor.
- [ ] `curl http://<B.router.publicIp>/` renders B's `/var/www/html/index.html` when B runs apache2/nginx and forwards 80.
- [ ] `gobuster -u http://<B.router.publicIp>` walks B's hosted paths.
- [ ] `lynx http://<B.router.publicIp>` renders B's site.
- [ ] `mysql -u <user> -h <B.router.publicIp> -p<pw>` and `rediscli -h <B.router.publicIp>` reach B's daemons when forwarded (these are workstation-daemon expansions tracked separately — keep wiring symmetric so they "just work" when those daemons ship).
- [ ] Non-cross-LAN paths (own-LAN occupants, mission targets, world targets, localhost) are unchanged — no regressions in the existing same-LAN cross-player smoke (PRs #124-#131).

## Background

After the cross-LAN trilogy (PRs #151-#155), this works:

- `nmap <foreign public IP>` regenerates the foreign HomeNetwork via `ensureForeignReachable`, renders the router + iptables-merged forwards.
- `resolveNat(foreign router IP, forwarded port)` returns the foreign **internal LAN IP** + internal port.

What breaks next:

- The internal LAN IP from `resolveNat` is `${B.layer0Subnet}.${B.lan_ip_slot}` — a foreign LAN address.
- `findMachineByIp(foreign LAN IP)` returns `undefined`. B's workstation is an **occupant** of B's LAN, not a generated machine in `HomeNetwork.networkConfig.machineConfigs`. The PR 4 `findMachineInHomeNetworks` only covers router + generated NPC machines.
- `resolveTargetMachineId(foreign LAN IP)` returns the LAN IP unchanged. `buildResolveTargetMachineId` is hard-coded to A's `activeNetwork` subnet + A's `lanOccupants` — it doesn't know about B's LAN at all.
- Auth envelope lands with `machine_id = foreign LAN IP`. Server's `/etc/passwd` lookup at that machine_id returns nothing → password rejected.

The fix is layered: a pure resolver that knows "foreign LAN IP → foreign workstation_id," then two extension points (`targetMachineIdFor` for write addressing, `findMachineByIp` for read-path / banner resolution), then per-command async pre-resolve so the foreign network is materialized before the auth helper closures are captured.

Data needed for the resolver is already collected by `ForeignNetworksContext`:

- `foreignNetworks: readonly HomeNetwork[]` — each carries `layers[0].subnet`.
- `foreignLanOccupants: readonly OccupantSummary[]` — each carries `network_id` (foreign public IP), `lan_ip`, `hostname` (= workstation_id).

The mapping `network_id → layer0 subnet` is one lookup over `foreignNetworks`.

## Out of Scope

- **Foreign LAN-occupant rendering in nmap of a foreign subnet.** This memo's smoke matrix exercises NAT-forward foothold paths only. Showing other players as alive hosts inside a foreign LAN scan is a separate UX surface (multi-LAN extension of `occupantMachines` + `occupantDnsRecords` merge) and ships if/when it's load-bearing.
- **Mission inner gateways' foreign awareness.** Mission instances stay leaf-only per the L2 follow-up state.
- **Server-authoritative cross-LAN re-validation** (L3 smart-server). Stays deferred per `project_multiplayer_security_model`.
- **Closure-timing investigation for fire-and-forget auth events.** If a smoke turns up a "first attempt misses, second hits" race, address it then with the same pattern PR 5 used for nmap (return the resolved value directly so the caller doesn't wait on React state propagation).

## PR Breakdown

| #   | Branch / PR                                 | Scope                                                                                                                                                                   |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat/foreign-lan-occupant-resolution-plan` | This plan document                                                                                                                                                      |
| 2   | `feat/foreign-lan-occupant-resolver`        | Pure `foreignLanOccupantResolver.ts` + tests                                                                                                                            |
| 3   | `feat/foreign-aware-target-machine-id`      | `targetMachineIdFor` + `buildResolveTargetMachineId` extension; rewire `useNetworkCommands` + `Terminal` call sites                                                     |
| 4   | `feat/foreign-aware-find-machine-by-ip`     | `NetworkContext.findMachineByIp` + `findMachineUsers` synthesize stub `RemoteMachine` for foreign LAN occupants; thread `foreignLanOccupants` through `NetworkProvider` |
| 5   | `feat/ssh-cross-lan-foothold`               | `ssh.ts` adopts `findMachineByIpAsync` pre-resolve. End-to-end smoke is the bellwether — proves the layered fix works on the load-bearing path.                         |
| 6   | `feat/cross-lan-protocol-fanout`            | `ftp`, `scp`, `nc`, `curl`, `gobuster`, `lynx`, `mysql`, `rediscli` adopt the same pre-resolve. `ncConnect` log-handler hostname resolution.                            |
| 7   | Smoke matrix verification                   | Manual on jshack-dev. 8 rows from the acceptance criteria. No code; close the plan + delete `plans/foreign-lan-occupant-resolution.md`.                                 |

PRs 2, 3, 4 are pure / typed work — independently mergeable in order. PR 5 is the load-bearing smoke. PR 6 fans out once the bellwether is proven.

## Steps

### Step 1 — Pure resolver (PR 2)

**RED**: `src/foreignNetworks/foreignLanOccupantResolver.test.ts`. Tests:

- Empty inputs → empty map.
- One foreign network + one occupant → map entry at `${subnet}${lan_ip}` → `{ workstationId: hostname, networkId, layer0Subnet: subnet }`.
- Multiple occupants across multiple foreign networks → distinct entries; subnet-prefixed so colliding host octets across different LANs don't merge.
- Occupant whose `network_id` doesn't match any `foreignNetworks` entry → skipped (defensive; can happen during refetch races).
- Result has reference stability when inputs are unchanged (`===` on memoization).

**GREEN**: `src/foreignNetworks/foreignLanOccupantResolver.ts`:

```ts
export type ForeignLanOccupantEntry = {
  readonly workstationId: string;
  readonly networkId: string;
  readonly layer0Subnet: string;
};

export const buildForeignLanOccupantMap = (
  foreignNetworks: readonly HomeNetwork[],
  foreignLanOccupants: readonly OccupantSummary[],
): ReadonlyMap<string, ForeignLanOccupantEntry> => { ... }
```

- Build a network-id → subnet lookup over `foreignNetworks` first (O(N) once).
- For each occupant: skip if its `network_id` isn't in the lookup; otherwise emit entry keyed by `${subnet}${lan_ip}`.

**MUTATE**: drop the prefix-anchored full-IP key, drop the network-id lookup, return entries with wrong field bindings.
**KILL MUTANTS**: tests cover each.
**REFACTOR**: only if a reused predicate emerges.
**Done when**: helper exists, unit tests pass, no other module imports it yet.

### Step 2 — `targetMachineIdFor` foreign extension (PR 3)

**RED**: extend `src/homeNetworks/homeNetworkHelpers.test.ts`:

- Existing matrix unchanged (own-LAN occupant, gateway-alias, mission/world/loopback passthrough, ownLanIp self-targeting).
- New cases: when `foreignOccupantMap` knows the target IP, return its `workstationId`. Precedence: ownLanIp > own-LAN occupant > gateway-alias > **foreign occupant** > passthrough. The foreign branch is lower priority than the own/gateway branches so a pathological IP collision doesn't mis-target.
- `buildResolveTargetMachineId` accepts foreign inputs and threads them through: given `foreignNetworks` + `foreignLanOccupants`, the returned resolver translates foreign LAN IPs.

**GREEN**:

- Add optional `foreignOccupantMap?: ReadonlyMap<string, ForeignLanOccupantEntry>` last param to `targetMachineIdFor`. Branch sits after gateway-alias canonicalization and before subnet-mismatch passthrough.
- Extend `buildResolveTargetMachineId(activeNetwork, lanOccupants, ownHostname, foreignNetworks?, foreignLanOccupants?)`. Calls `buildForeignLanOccupantMap` once and curries it.
- Re-export the new map type from `homeNetworks` for typed call sites.

**MUTATE**: drop the foreign branch, flip precedence with gateway-alias, return the network_id instead of workstationId.
**KILL MUTANTS**: tests pin the precedence ordering + the workstation_id field selection.
**REFACTOR**: assess collapsing the precedence chain into a sequence of map lookups.

**Wiring step** (same PR — small):

- `src/hooks/useNetworkCommands.ts`: pull `foreignNetworks` + `foreignLanOccupants` from `useForeignNetworks` and pass into `buildResolveTargetMachineId`.
- `src/components/Terminal.tsx`: same.

**Done when**: cross-player auth helpers receive a `resolveTargetMachineId` that translates foreign LAN IPs to workstation_ids; unit tests + existing same-LAN tests both pass.

### Step 3 — `findMachineByIp` foreign occupant synthesis (PR 4)

**RED**: extend `NetworkContext.test.tsx` (or its closest unit-test sibling) — synthesize a foreign HomeNetwork + a foreign occupant and assert:

- `findMachineByIp(foreignLanIp)` returns a stub `RemoteMachine` with `ip = foreignLanIp`, `hostname = workstationId`, `ports = []`, `users = []`.
- `findMachineUsers(foreignLanIp)` returns `[]` (empty — server is authority; client never had B's user list).
- A foreign LAN IP that doesn't match any occupant still returns `undefined`.
- Adding a foreign occupant doesn't shadow own-LAN, mission, or world matches (precedence pinned).

**GREEN**:

- Thread `foreignLanOccupants` through `NetworkProvider` props (already exposed by `useForeignNetworks`; `GameSession.tsx` passes it).
- After the existing `findMachineInHomeNetworks(ip, foreignNetworks ?? [])` branch, fall through to a foreign-occupant lookup: build the foreign-occupant map (or memoize via `useMemo` over foreign inputs) and synthesize the stub.
- Symmetric extension on `findMachineUsers` — foreign occupant lookup returns `[]` (no `users` to expose); callers already tolerate empty arrays per the existing cross-player placeholder comment in `useAuthentication.handleFtpUsernameSubmit`.

**MUTATE**: drop the foreign-occupant branch, return `users: ['x']` from the stub, shadow own-LAN.
**KILL MUTANTS**: tests pin shape + precedence.
**REFACTOR**: assess extracting the synthesis into a helper if the shape repeats anywhere else (probably not).

**Done when**: any path through `NetworkContext` resolves foreign LAN IPs to a stub machine; `findMachineByIpAsync(foreignLanIp)` materializes the network AND finds the occupant in one async hop.

### Step 4 — SSH bellwether (PR 5)

**RED**: `src/commands/ssh.test.ts` extension — when `findMachineByIpAsync` is wired and the user types `ssh user@<foreign public IP>`, the command awaits the resolver before invoking `startSshPrompt`. With the resolver mocked to return a foreign router stub, the command proceeds; without it, the existing sync path still works.

**GREEN**: in `ssh.ts`'s entry point (the command's argv handler), follow PR 5's pattern:

1. Sync `getMachine(target)`; if hit, dispatch existing path.
2. Otherwise `await findMachineByIpAsync(target)` (if provided). On hit, dispatch; on miss, surface the existing "Host unreachable" / "Connection refused" error.
3. Token-cancel + try/catch on errors, mirroring nmap.

The auth helpers don't change. `useAuthentication.loginSshWithAuth` already consumes `resolveTargetMachineId` (now foreign-aware) and `findMachineByIp` (now foreign-aware). The pre-resolve at the command boundary forces the foreign network into the cache before the user is even prompted; by the time `startSshPrompt` fires, the React render cycle has flushed the new state into the auth callback closures.

**MUTATE**: bypass the resolver, return early without dispatching.
**KILL MUTANTS**: existing ssh test suite + the new cross-LAN extension.
**REFACTOR**: assess extracting `dispatchAuth` like PR 5's `dispatchScan` if it makes the async branch readable.

**Smoke (manual on jshack-dev)**: two browsers, two players, two LANs. B opens port 22 (sshd via existing wiring) on her workstation + adds an iptables forward rule on her router. A in a different LAN runs `ssh <B.user>@<B.router.publicIp>` and lands a session on B's workstation. Verify:

- A's `pwd` returns B's home path.
- A's `cat /etc/passwd` returns B's user list (server-side `/etc/passwd` projection from the L2 chunk; A reading via B's workstation_id storage key).
- A's writes (e.g. `nano /tmp/hello.txt`) appear in B's tab via Realtime.
- A's `exit` returns to A's workstation cleanly.

**Done when**: smoke passes end-to-end. PR 5 merged.

### Step 5 — Sibling commands (PR 6)

**RED**: extension tests for each command — `ftp`, `scp`, `nc`, `curl`, `gobuster`, `lynx`, `mysql`, `rediscli`. Same pattern: with `findMachineByIpAsync` injected, the entry point pre-resolves; without it (legacy callers / tests that omit the injection), behavior unchanged.

**GREEN**: thread the pre-resolve into each command. For most, the entry-point shape is identical to ssh. For `nc`, the resolution happens before the backdoor port connection. For `curl` / `gobuster` / `lynx`, the resolution happens before the HTTP fetch; once the foreign network is in state, `applyDynamicOverrides` + `resolveNat` handle the rest.

`src/logging/handlers/ncConnect.ts` uses `findMachineByIp` for source/target hostname lookup in log lines — once `findMachineByIp` is foreign-aware (PR 4), these log lines render correctly cross-LAN. If a smoke shows otherwise, pre-resolve there too.

**MUTATE / KILL / REFACTOR**: same as Step 4 per command.

**Smoke matrix (PR 7)**: 8 rows from acceptance criteria, two browsers, two LANs.

**Done when**: smoke matrix passes. Plan deleted.

## Verification After Each PR

Run on each branch before opening PR:

- `npm run build`
- `npm run lint`
- `npm run format`
- `npm run test:run`

Version bumps: each impl PR bumps `package.json` + `package-lock.json` per user preference.

## Pre-PR Quality Gate

For each PR:

1. Mutation testing (manual — RED-GREEN-MUTATE-KILL cycle documented above).
2. Refactoring assessment per step.
3. Typecheck + lint + tests pass.
4. Memory update where load-bearing decisions surface (e.g., precedence pinning rationale).

---

_Delete this file when the plan is complete._
