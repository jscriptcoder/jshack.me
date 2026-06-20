# Plan: Story 6 — Cross-player scan / connection / su trace on the shared record

**Branch**: one branch + PR per slice (v2 convention, squash-merge `feat(v2): … (#N)`)
**Status**: Active — 6.0 ✅ merged (#284), 6.1 ✅ merged (#286), 6.2 ✅ merged (#287), 6.3 ✅ merged (#288) + live-confirmed. **NEXT = Slice 6.4 (own-LAN `.1` scan → real router `kern.log`) — the LAST slice; Story 6 ships when it merges.**
**Epic**: `plans/multiplayer-crossplayer-epic.md` → "Story 6 — resolved scope & decisions (grill-me, 2026-06-19)" (READ FIRST; 7 locked decisions)
**As-built foundation**: `v2/docs/cross-player-architecture.md` (esp. §3 reachability/login, §4 authorization, §7 root/bricking)

## ▶ RESUME HERE (Slice 6.4 — the LAST slice) — picking up after compaction

**Done so far:** 6.0 (#284), 6.1 (#286), 6.2 (#287), 6.3 (#288) ALL MERGED to `main` + live-confirmed. Branch
`feat/v2-ownlan-router-scan-trace` is already created off main — start RED on it. **6.4 is the only remaining
slice; when it merges, Story 6 ships** (delete this plan, graduate durable mechanics to
`v2/docs/cross-player-architecture.md` + trim MEMORY).

**6.4 = own-LAN `.1` scan writes the REAL router `kern.log` (close the dead-end).** This is NOT a cross-player
handler — it's the own-LAN `handleNmapScan` path (`core/scan/nmapScan.ts`). Today `logHostScan` writes EVERY
scanned host's kern.log line to `hostMachineId(host, essid)`, including the `.1` gateway — but the gateway's
`hostMachineId('gateway'/seeded-name, essid)` is a DEAD-END record nobody reads: A reaches its real router via
`ssh root@.1` → `computeRouterId(caller)`, a DIFFERENT machine id. So A scanning `.1` leaves a trace on a record
A can never `cat`. Fix: route the `.1` host's line to the real router id.

Concrete delta (scouted 2026-06-20):
- `core/scan/nmapScan.ts` `logHostScan` (the `machineId:` field of the `appendMachineLog` target, currently
  `hostMachineId(host, context.essid)` at ~line 104): change to
  `host.kind === 'router' ? computeRouterId(context.publicKey) : hostMachineId(host, context.essid)`.
  `LanHost.kind` is `'machine' | 'router'` (confirmed `generateHomeLan.ts:16-21`); the `.1` gateway host alone
  carries `kind: 'router'` (`generateHomeLan.ts:45-49`), NPC siblings + self are `'machine'`. The writer_key
  stays `context.publicKey` (= the caller = the owner, so still owner-keyed; this is own-LAN, B==owner). Self is
  already excluded upstream (`host.ip !== selfIp`). Mirrors `authCreateSessionPublic`'s router branch.
- ADD `import { computeRouterId } from '../identity/router';` to `nmapScan.ts`.
- **No api/ wiring change** — `handleNmapScan` deps (`now`/`readLog`/`upsertPatch`) are unchanged; only the
  target machine id of the `.1` line moves. `api/network.ts` already passes them.

**RED** (`nmapScan.test.ts`): scanning a target that covers `.1` logs on `computeRouterId(caller)` (NOT
`hostMachineId`); an NPC sibling still logs on its `hostMachineId`; self is still skipped. Mutator gaps: the
`host.kind === 'router'` branch (assert the two ids DIFFER and the router line lands on `computeRouterId`, the
NPC line on `hostMachineId`); the equality literal `'router'`.

**Live-env state:** `vercel dev` was STOPPED at 6.3 close (:3100 free). 6.4 is a pure own-LAN core change —
the wire-check/agent-browser confirm is lighter: A `nmap <subnet>.1` (or a range covering `.1`) →
`ssh root@.1` → `cat /var/log/kern.log` shows the scan line on the REAL router. The own-box loop needs only
ONE identity (no second player) — recipe: crack WiFi → `nmcli connect` → `nmap <subnet>.1` → `su root` →
`sshd` → `ssh root@<subnet>.1` → `cat /var/log/kern.log`. agent-browser command-submit = native keydown
dispatch on the terminal `<input>` (the `SEND` eval helper from the 6.3 confirm); `su`/`ssh` `Password:`
prompts take the pw on the next input line. Playbook → `v2/docs/cross-player-e2e-playbook.md`.

## Goal

A player B who scans, connects to, or escalates on player A's machine leaves a truthful, server-written
trace (`kern.log` / `auth.log`) on A's **shared** record that A (or a 3rd player C with a session) reads
back — turning the shipped cross-player attack loop into an observable attacker/defender loop.

## Background (why this is mostly net-new, not a re-key)

The shipped 3a logging fires ONLY on the own-LAN `nmap` path (`handleNmapScan` → coordinate-derived NPC
`hostMachineId`, `writer_key = caller`). The three **cross-player** handlers do **not** log today:
`resolvePublicScan` (scan), `authCreateSessionPublic` (connection), `authElevateSession` (su). Own-LAN
`ssh`/`su` already log correctly (`authCreateSession` stamps both outcomes and already routes `.1` →
`computeRouterId`; own-box `su` → `appendAuthLog`). So Story 6 wires logging into the three cross-player
handlers + fixes one own-LAN `.1` gap.

**Keystone (decision 1):** `applyPatches` folds **last-write-wins per path**, so multiple writers' rows for
one log file collapse to the last writer's content. Every log line is therefore written under
`writer_key = owner_key` of the TARGET machine (the system owns its logs) so they accrete into ONE row;
the attacker's identity lives in the **line content** (source IP / username). The cross-player handlers must
pass `owner_key` explicitly as the log `writerKey`, distinct from `verified.publicKey` (= B).

## Acceptance Criteria

- [ ] B `nmap <A.publicIp>` → A reads a `[iptables] Port scan from <B's public IP>` line in A's **router**
      `/var/log/kern.log` (`computeRouterId`), with the ports B actually saw.
- [ ] The source IP in that line is **server-derived from B's verified identity** (B's home public IP via
      `findRegistryByOwnerKey(B)`), NOT the client `source_ip` — so it can't be forged or used to frame
      another network. (See "Pivot deferred" below for the hop case.)
- [ ] B `ssh guest@<A.publicIp> -p 2222` (success) and a wrong-password attempt (failure) → A (or a 3rd
      player C with a session) reads `Accepted` / `Failed password for guest from <B's public IP>` in A's
      **workstation** `/var/log/auth.log`. The `:22` case lands on the **router** auth.log.
- [ ] B `su root` on A's workstation (success) and a wrong-password attempt (failure) → A/C reads
      `Successful` / `FAILED su for root by guest` in A's **workstation** `/var/log/auth.log`.
- [ ] A `nmap <subnet>.1` (own router) leaves a `kern.log` line on the **real** router record
      (`computeRouterId`) that A reads via `ssh root@.1` — not the dead-end `hostMachineId('gateway')`.
- [ ] A no-session scanner cannot read either log (tier-3 hides them); a dark / bricked target logs nothing;
      a `404 host_unreachable` (unforwarded / unknown) logs nothing.
- [ ] All logging is best-effort: a log read/write failure never breaks (or fabricates) the scan / auth.

## Out of scope (locked)

- No separate brick-event trace (decision 5). No tamper-resistance — root can clear logs (decision 7).
- **Pivot / operate-from-a-hop deferred (its own future story).** v2 does NOT switch a command's execution
  vantage to a hopped machine today — `ssh.ts`/`nmap.ts` always resolve against B's HOME context
  (`generateHomeLan(env.identity.publicKeyHex, …)`, source `wlan0.ipv4`), and `resolveLogSourceIP`
  (`core/logging/sourceIp.ts`) is ported but unwired. So Story 6 logs B's **operating-machine** IP, which is
  **B's home box today**. The source-IP derivation is shaped so that WHEN the pivot feature ships (command
  vantage adopts the hop), the operating machine becomes the hop N and the same path logs N's IP — masking
  B's real IP — with no logging rework. The pivot feature is parked in the epic's parking lot.
- No new schema/migration anticipated (reuses `patches` + `network_registry`). Tier/permission model
  unchanged (logs are tier-2 readable, tier-3 hidden).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; load `tdd`, `testing`, `mutation-testing`,
`refactoring` before code. Core handlers are pure → **vitest unit tests** (the existing `*.test.ts`
pattern, e.g. `authCreateSession.test.ts` already asserts the appended log line). The live cross-player
loop is proven by a **deterministic wire-check script** (`v2/scripts/`, the `testRouterBrick.ts` /
`testCrossPlayerRouter.ts` pattern) plus an **agent-browser** confirm at slice close (playbook:
`v2/docs/cross-player-e2e-playbook.md`). E2E is NOT for what a unit test already covers
(`feedback_e2e_scope`).

---

### Slice 6.0 (prerequisite): Routers get a seeded random hostname (port the legacy pool) — ✅ DONE (#284, merged)

**Value**: The router is a real machine with a real name (`mikrotik01`), not a universal `gateway` — and
that name is what the cross-player log lines (6.1/6.2) need. Observable on its own via `nmap`.
**Path**: `generateHomeLan` currently hardcodes the `.1` host's name as `'gateway'`; `buildRouterBaseFs`
sets no hostname at all. **new**: `seedRouterHostname(ownerKeyHex)` (pure, `core/generation/routerFs.ts`,
`router-host-` PRNG namespace) picks from a ported router-name pool (legacy `hostnamesByRole.router`);
`generateHomeLan` uses it for the `.1` `LanHost.hostname` (seeded by the viewer's key = the owner for
own-LAN). Server-recoverable from `owner_key` alone, like the admin pw / sshd seed.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
- `seedRouterHostname(ownerKey)` returns a deterministic pool member (same key → same name; different keys
  spread across the pool).
- `nmap <subnet>.1` (own LAN) displays the router's seeded name, not `gateway`.
- The name is derivable server-side from `owner_key` alone (no FS read), so the cross-player log lines can
  reuse it.
**RED**: `routerFs.test.ts` — determinism + pool membership of `seedRouterHostname`; `generateHomeLan.test.ts`
— the `.1` host carries the seeded name. Mutator gaps: the PRNG namespace string (assert it differs from
`router-admin-`/`router-ssh-`), the pool indexing.
**GREEN**: add the pool + `seedRouterHostname`; thread it into `generateHomeLan`'s gateway host.
**MUTATE**: Stryker on `routerFs.ts` + `generateHomeLan.ts`. **KILL MUTANTS** / **REFACTOR**.
**Done when**: AC met; `nmap` shows the real name; mutation report reviewed; human approves commit.

---

### Slice 6.1 (walking skeleton): Cross-player scan leaves an owner-keyed router `kern.log` line — ✅ DONE (#286, merged + live-confirmed)

**Value**: A defender (A) discovers that someone scanned their public IP, with the scanner's source IP —
the first cross-player trace, proving the whole new path end-to-end.
**Path**: B `nmap <A.publicIp>` → `env.scan.resolvePublic` → `resolvePublicScan` resolves A's router + ports
(shipped) → **new**: after a successful resolve (host up), best-effort `appendMachineLog` of one
`formatNmapScanAggregate` line to `(machine_id = A.router_machine_id, /var/log/kern.log, writer_key =
A.owner_key)`, hostname = `seedRouterHostname(A.owner_key)` (slice 6.0), source IP = **B's home public IP**
(server-derived from the verified pubkey via `findRegistryByOwnerKey(B)` — never the client `source_ip`) →
A `ssh root@.1` → `cat /var/log/kern.log`. Skipped here: connection/su traces (6.2/6.3), own-LAN `.1` fix
(6.4), the pivot/hop vantage (own future story — see Out of scope).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
- A successful public scan appends exactly ONE `kern.log` line on the **router** record
  (`router_machine_id`), `writer_key = owner_key`, owner/perms = `KERN_LOG_*`, content =
  `formatNmapScanAggregate` over the resolved ports + B's home public IP.
- `found:false` (unknown IP, dark/bricked router) appends **nothing**.
- A log read failure → no write (RMW bails); a write failure → scan result still returns 200 (best-effort).
- The source IP is server-derived from B's verified identity; a client-supplied `source_ip` is ignored.
- B with no registry row (no home network) → source falls back to `unknown`, scan still succeeds.
**RED**: `resolvePublicScan.test.ts` — "lands one iptables kern.log line on the ROUTER record under the
OWNER's writer_key for a host-up scan"; "writes nothing when found:false / read fails"; "source IP is B's
registry public IP, not the payload `source_ip`"; "unknown when B has no registry row". Mutator gaps (from
`mutator-rules.md`): the `found` boolean guard (ConditionalExpression/BooleanLiteral — assert both branches),
`writerKey = owner_key` (StringLiteral — assert it's NOT `verified.publicKey`), best-effort try/catch (assert
a thrown write still yields 200), the source-IP fallback string.
**GREEN**: add `now`/`readLog`/`upsertPatch` + `findRegistryByOwnerKey` deps; resolve B's source IP, then
call `appendMachineLog` with `writerKey: data.owner_key` after the `found:true` port resolve; wire
`api/network.ts` (readLog/upsertPatch/`Date.now`/owner-key lookup). No essid added to the scan payload — the
source is pubkey-derived.
**MUTATE**: Stryker on `resolvePublicScan.ts` (+ the source-IP helper). **KILL MUTANTS**: survivors →
strengthen; ask if ambiguous. **REFACTOR**: assess extracting a shared "append cross-player log line" wrapper
and a shared `crossPlayerSourceIp` helper (defer unless 6.2 proves the duplication).
**Done when**: AC met; wire-check script shows B-scan → A reads the line; agent-browser confirm; mutation
report reviewed; human approves commit.

---

### Slice 6.2: Cross-player connection leaves an owner-keyed `auth.log` line (both outcomes) — ✅ DONE (wire-check 7/7 + agent-browser; PR pending)

**Value**: A defender sees who logged in (or tried to) and from where — the brute-force / hydra signal.
**Path**: B `ssh [-p port] <user>@<A.publicIp>` → `authCreateSessionPublic` resolves `target.machineId`
(router `:22` / workstation forward) + checks the password (shipped) → **new**: best-effort
`appendMachineLog` of one `formatSshdAuthLine` line to `(target.machineId, /var/log/auth.log, writer_key =
data.owner_key)` on BOTH success and failure, source IP = the shared `crossPlayerSourceIp` helper (B's home
public IP, from 6.1), hostname = `seedRouterHostname(owner_key)` for a router-served port /
`workstation_machine_name` (registry projection) for a forwarded port. A `404 host_unreachable` (unforwarded
/ dark / bricked, before any password) logs nothing.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
- Successful `:2222` login → `Accepted password for guest from <B IP>` on the **workstation** record
  (`writer_key = owner_key`); successful `:22` → on the **router** record.
- Wrong password (reachable) → `Failed password …` line; 401 still returned.
- `404 host_unreachable` (unforwarded port / unknown IP / bricked router) → **no** line.
- Read/write failure is best-effort (auth result unchanged).
**RED**: `authCreateSessionPublic.test.ts` — accepted line on the resolved machine under owner writer_key;
failed line on wrong password; no line on each 404 branch; line lands on `target.machineId` (router vs ws).
Mutator gaps: the outcome ternary (`passwordOk ? 'success' : 'failure'` — assert both strings), the
machineId selection (router vs ws), the early-return 404 branches (assert no write), owner-vs-caller
writer_key.
**GREEN**: add `now`/`readLog`/`upsertPatch` + `findRegistryByOwnerKey` deps; log after `resolveAuthTarget`
succeeds + the password check; reuse the 6.1 source-IP + (if extracted) the log-line wrapper; add
`workstation_machine_name` to the registry projection; wire `api/sessions.ts`. Mirror `logSshAttempt`'s shape
from `authCreateSession.ts` (lift the shared formatter call if it earns it).
**MUTATE**: Stryker on `authCreateSessionPublic.ts`. **KILL MUTANTS** / **REFACTOR** (now reassess the
shared cross-player-log wrapper across 6.1/6.2).
**Done when**: AC met; wire-check both ports + both outcomes; agent-browser confirm (A/C reads the line);
mutation report reviewed; human approves commit.

---

### Slice 6.3: Cross-player `su` leaves an owner-keyed `auth.log` line (both outcomes) — ✅ DONE (#288, merged + live-confirmed)

**Value**: A defender sees an escalation attempt on their box — the deferred Story-4 su trace.
**Path**: B `su root` on A's workstation → `authElevateSession` reconstructs A's box + checks the password
(shipped) → **new**: best-effort `appendMachineLog` of one `formatSuAuthLine` line to
`(data.workstation_machine_id, /var/log/auth.log, writer_key = data.owner_key)` on BOTH outcomes,
hostname = `workstation_machine_name` (registry projection); `from_user` carried in the payload (B's current
ws user, e.g. `guest`); no source IP (su lines are username-only).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
- Successful `su root` → `Successful su for root by guest` on the **workstation** record
  (`writer_key = owner_key`); wrong password → `FAILED su for root by guest`; 401 still returned.
- `404 host_unreachable` (unknown machine_id) → **no** line.
- Best-effort (auth result unchanged on a logging failure).
**RED**: `authElevateSession.test.ts` — successful/failed su lines under owner writer_key on the workstation
record; no line on the 404 branch; `from_user` flows into the line. Mutator gaps: outcome branch, the
`from_user` passthrough, owner-vs-caller writer_key, the 404 early return.
**GREEN**: add `now`/`readLog`/`upsertPatch` deps + `from_user` to the schema; log after the password check;
wire `api/sessions.ts` (`suElevate`); thread `from_user` from `su.ts` (`env.su.elevate`).
**MUTATE**: Stryker on `authElevateSession.ts`. **KILL MUTANTS** / **REFACTOR**.
**Done when**: AC met; wire-check both outcomes; agent-browser confirm; mutation report reviewed; human
approves commit.

---

### Slice 6.4: Own-LAN `.1` scan writes the real router `kern.log` (close the dead-end)

**Value**: Consistency — A scanning its own router from inside leaves a log A can read on the real router,
matching the cross-player behavior and the NPC behavior.
**Path**: A `nmap <subnet>.1` → `env.scan.record` → `handleNmapScan` resolves hosts (shipped) → **change**:
for the `.1` gateway host, write the `kern.log` line to `computeRouterId(caller)` instead of
`hostMachineId('gateway', essid)` (writer stays the caller = the owner, so still owner-keyed). NPC siblings
unchanged.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
- A `nmap <subnet>.1` (or a range covering `.1`) appends the line on `computeRouterId(caller)`; A reads it
  via `ssh root@.1; cat /var/log/kern.log`.
- Generic NPC siblings still log on their `hostMachineId` (unchanged); the player's own workstation is still
  skipped (self-scan exclusion).
**RED**: `nmapScan.test.ts` — the gateway host logs on `computeRouterId`, an NPC host logs on
`hostMachineId`, self is skipped. Mutator gaps: the `host.kind === 'router'` branch selecting the machine
id (assert the two ids differ and the right one is used).
**GREEN**: in `logHostScan`, pick `host.kind === 'router' ? computeRouterId(publicKey) :
hostMachineId(host, essid)` (mirrors `authCreateSession`'s router branch).
**MUTATE**: Stryker on `nmapScan.ts`. **KILL MUTANTS** / **REFACTOR**.
**Done when**: AC met; agent-browser confirm (A scans `.1`, sees it after `ssh root@.1`); mutation report
reviewed; human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — `mutation-testing` skill, report reviewed (accept tooling-equivalent survivors per the
   recorded rules: load-throw, type-narrowing, no-op filter).
2. Refactoring assessment — `refactoring` skill (esp. the shared cross-player-log wrapper after 6.2).
3. `npm run typecheck` (= `tsc -b`, covers `api/` + `scripts/`) + lint pass.
4. `api/` runtime correctness (DB columns/constraints) is NOT locally typechecked → the wire-check script +
   agent-browser are the runtime proof for any handler that touches Supabase
   (`project_v2_api_not_typechecked_locally`).

## Resolved (2026-06-19)

- **6.3 live-confirmed (2026-06-20)** — cross-player `su` → owner-keyed WORKSTATION `auth.log`, both outcomes.
  Wire-check `scripts/testCrossPlayerSuTrace.ts` **5/5** (Successful line under A's owner_key naming the ws;
  wrong-pw 401 + FAILED line; keystone — B `by guest` + C `by visitor` accrete in ONE owner-keyed row;
  unregistered machine_id 404 writes nothing) + agent-browser full two-player loop (B fresh identity: crack
  WiFi → `nmcli connect` → `ssh guest@<A.publicIp> -p 2222` → `su root` → `cat /var/log/auth.log`): A's ws
  auth.log carried BOTH `skylab sshd[…]: Accepted password for guest from <B's HOME public IP>` (6.2) AND
  `skylab su[…]: Successful su for root by guest` (6.3) in the one owner-keyed row. `by guest` = B's ACTUAL ws
  session username → proves `from_user` threads end-to-end (`su.ts` `env.session.username` → `env.su.elevate`
  → adapter `from_user` → `suElevate`); hostname `skylab` = `workstation_machine_name` (registry projection
  live). **NO source IP** on su lines (username-only). MUTATE: Stryker on `authElevateSession.ts` **97.40%**,
  2 equivalent survivors accepted (same shapes as 6.2: `'failure'`→`''` since the only consumer branches on
  `=== 'success'`; redundant `account === null` disjunct already implied by `!passwordOk`). REFACTOR:
  `logCrossPlayerSu` kept inline (consistent with 6.2). `seedCrossPlayerTarget.ts` extended with the router NAT
  forward so the single-seed browser path reaches A's ws as guest under the router-routing model.
- **6.2 live-confirmed (2026-06-20)** — wire-check `scripts/testCrossPlayerConnectionTrace.ts` **7/7**
  (router `:22` Accepted line under A's owner_key naming the seeded router; wrong-pw 401 + Failed line;
  forged `source_ip` ignored; B+C accrete in ONE owner-keyed row; forwarded `:2222` guest Accepted line
  on the WORKSTATION record naming `workstation_machine_name`; unregistered IP 404 writes nothing) +
  agent-browser full loop (crack→`nmcli connect`→`ssh root@<A.publicIp>`→`cat /var/log/auth.log`): line
  `edge-rtr sshd[…]: Accepted password for root from <B's HOME public IP>`, AND (decision 8) `cat
  /var/log/kern.log` showed the SAME ssh ALSO left `[iptables] Port scan from <same B IP>` — a cross-player
  ssh leaves BOTH traces. Source IP is B's registry public IP (`51.212.140.221`), NOT B's LAN IP
  (`192.168.153.45`) — server-derived, unforgeable. **REFACTOR shipped:** the source-IP derivation
  (duplicated across 6.1+6.2) extracted to `core/logging/crossPlayerSourceIp.ts`
  (`resolveCrossPlayerSourceIp` + `FindRegistryByOwnerKey`, 100% mutation); `resolvePublicScan.ts`
  refactored onto it. The best-effort log try/catch was assessed and KEPT inline (formatters/targets differ;
  inline keeps the best-effort posture visible). Two equivalent mutants accepted on `authCreateSessionPublic.ts`
  (`'failure'`→`''` observationally identical since the only consumer branches on `=== 'success'`;
  `account === null` a redundant disjunct already implied by `!passwordOk`).
- **Log ALL port probes, not just `nmap` (decision 8, 2026-06-20)** — cross-player `ssh` to a public IP
  ALSO writes a `kern.log` "port scan" line, because `core/commands/ssh.ts` (`ssh.ts:84`) calls
  `env.scan.resolvePublic(host)` for its reachability check — the SAME `resolvePublicScan` handler 6.1 logs.
  **ACCEPTED as intended** (user, 2026-06-20): this is the no-silent-recon posture — an attacker cannot
  enumerate A's open ports without leaving a trace, regardless of whether they use `nmap` or `ssh` (the
  server can't distinguish "honest ssh" from "attacker probing via the ssh path", so suppressing ssh's line
  would reopen a stealth-recon hole). **Consequence for 6.2:** a cross-player ssh attempt intentionally
  leaves BOTH a `kern.log` scan line (already, via 6.1) AND the `auth.log` line 6.2 adds — defense-in-depth,
  not a bug. Caught by the 6.1 agent-browser confirm (unit tests/wire-check missed it — the integration-seam
  drift `feedback_e2e_test_new_primitives` warns about). Graduate to `v2/docs/cross-player-architecture.md`
  when Story 6 ships.
- **6.1 live-confirmed (2026-06-20)** — wire-check `scripts/testCrossPlayerScanTrace.ts` **6/6** (owner-keyed
  row, B+C accrete in ONE row = keystone, forged `source_ip` ignored, host-down writes nothing) + agent-browser
  full loop (crack→connect→`nmap`→`ssh root@`→`cat kern.log`): line `edge-rtr kernel: [iptables] Port scan
  from <B's HOME public IP> …`, `writer_key = A.owner_key` (DB-verified). Source IP is B's registry public IP,
  NOT B's LAN IP — server-derived, unforgeable.
- **Hostname in the log lines** — routers get a **seeded random name** from a ported pool (slice 6.0,
  `seedRouterHostname(owner_key)`), NOT a universal `gateway`; the router is just another machine with NAT
  config. Router log lines (6.1, 6.2 `:22`) read that seeded name; **workstation** log lines (6.2 `:2222`,
  6.3) read the existing `workstation_machine_name` (already on the registry, = `assignHomeNetwork(...)
  .hostname`, e.g. `laptop-42`) — add it to the handler's registry projection where missing.
- **Source IP — operating-machine-derived, home today, hop-ready** — the logged source is B's **operating
  machine's** public IP, derived **server-side from B's verified pubkey** (`findRegistryByOwnerKey`), never
  the client `source_ip` (so forging / framing is impossible by construction). Today the operating machine is
  always B's home box (v2 has no command-vantage switch). When the **pivot feature** ships (its own story),
  the operating machine becomes the hop and the same path logs the hop's IP — masking B's real IP. One
  network at a time, so no multi-network disambiguation.

## Open micro-choice (default unless you object, before 6.0)

- **Router-name pool flavor** — DEFAULT: port legacy `hostnamesByRole.router` verbatim (`router01`, `gw-main`,
  `core-rtr`, `pfsense01`, `mikrotik01`, …) per `feedback_v2_match_legacy_command_interface`. Alternative: a
  home-router-brand set matching v2's `ROUTER_ADMIN_PASSWORDS` flavor (`netgear`, `linksys`, `cisco`).
  Trivially swappable either way.

---
*Delete this file when Story 6 ships (all five slices 6.0–6.4 merged). Graduate durable mechanics into
`v2/docs/cross-player-architecture.md` and the MEMORY index.*
