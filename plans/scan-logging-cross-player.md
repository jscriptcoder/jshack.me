# Plan: scan/connection logging — leaving traces on target machines (cross-player)

**Branch**: `feat/v2-scan-logging` (per-slice branches below)
**Status**: Proposed — **HARD-BLOCKED** on "scanned hosts become real, server-persisted machines"
(see Prerequisite below). This plan is the design of record so the requirement is not lost; do
**not** start it while nmap targets pure-generated placeholders.
**Parent epic**: `plans/network-generator-epic.md` (cross-player read/write path) — slots in once
generated LAN hosts have DB-backed patch streams.

## Why this matters

Scanning and connecting must leave a **trace on the target machine's filesystem** (`/var/log/*`).
This is not cosmetic: in a multiplayer world, **logs are the primary way players discover each
other**. You break into a box, `cat /var/log/kern.log`, and see another player's source IP from
when they scanned it. The defender role (watching your own logs for intruders) and the attacker
role (covering tracks) both hang off this. Realism + emergent PvP discovery in one mechanism.

The catch: a trace is only valuable if it **persists on a machine someone else can later read**.
That requires the target to be a real, server-persisted machine — which v2 does not have yet.

## Prerequisite (the hard block — verify all four before starting)

Today in v2 the scanned LAN (`generateHomeLan`) is **pure-generated, deterministic placeholders** —
rows in nmap's output, not machines. Before logging has anywhere to live, the following must exist
(this is the `network-generator-epic` cross-player work, not this plan):

1. **Scanned hosts are real machines** with a stable `machine_id` and their own server-side patch
   stream (a DB row set keyed by machine, like legacy). Today `findMachineByAddress` / `resolveDns`
   return `null` (`v2/src/ui/env.ts`), so there is no `machine_id` to address a log to.
2. **A remote write seam** exists. `PatchApi` (`v2/src/core/commands/types.ts:135-143`) is hardwired
   to the player's own workstation (`patchApi.ts` machineId = own workstation id). Writing a log to
   a box you don't own needs either a target-aware `PatchApi` or the `LogApi` made real.
3. **Server L1 exists to make an exception _for_.** Today the only server check is
   `isOwnWorkstation(payload.machine_id, publicKey)` → else `403 no_session`
   (`v2/src/core/patches/upsertPatch.ts:81-83`). There is no active-session/hop-chain validation for
   remote machines yet. The ambient-log bypass is meaningless until that gate exists — there is
   nothing to bypass.
4. **Server L2 (the permission walker) is server-enforced.** `v2/src/core/filesystem/walker.ts`
   exists but is only invoked client-side; the endpoint does not run it. The bypass must skip **both**
   L1 and L2 (legacy parity), so L2 must first be a server gate.

If you find yourself wanting to log to a host with no `machine_id` and no server session model, STOP —
the prerequisite isn't met and any logging built now writes nowhere and is readable by no one.

## Legacy reference (the mechanism we are porting)

Full module: `src/logging/` (legacy, frozen). The shape to carry over:

- **Write primitive**: `appendToMachineLog(targetIp, '/var/log/<file>', line, logFs)` — reads the
  current log file on the **target**, appends a line, writes it back. New files land world-readable,
  root-write (`appendToMachineLog.ts:16-20`). It flows through the **normal patch stream**
  (`broadcastAndRecordPatch` → `upsertPatchOnServer` → dualWrite onto the target's `machine_filesystems`).
- **nmap routing + format**: nmap → `/var/log/kern.log`, one **aggregate** line per sweep (not per
  probe — avoids log flooding). `formatNmapScanAggregate` (`src/logging/formatters.ts:409-422`):
  `MMM DD HH:MM:SS <hostname> kernel: [iptables] Port scan from <sourceIp> — probed ports 22,80 (2 hits)`.
- **Source-IP realism** (`src/logging/utils.ts:40-50`, `resolveLogSourceIP`): on a remote session →
  the session machine's IP; own workstation + target on same `/24` → **LAN IP** (same-LAN traffic
  doesn't NAT, and a LAN-sharing defender sees the real attacker LAN IP); own workstation + different
  network → **home router public IP** (NAT); no home network → LAN IP fallback. This is the
  `feedback_log_source_ip_realism` rule — keep it exactly.
- **THE EXCEPTION — `AMBIENT_LOG_FILES` allowlist** (`src/patchRegistry/handler.ts:321-370`):
  recon leaves logs on a box the actor has **no session on**, so the server upsert path skips L1+L2
  for an **exact-match allowlist** of canonical log files:
  ```
  /var/log/auth.log  access.log  kern.log  vsftpd.log  mysql.log  redis.log  mail.log  syslog
  ```
  Non-negotiable design constraints (carry verbatim, they're load-bearing security):
  - **Exact-match `Set`, NEVER a `/var/log/` prefix.** A prefix lets a forged signed envelope plant
    `/var/log/payload.sh` on a machine you don't own. There is a wire-level test
    (`scripts/testAmbientLogAllowlist.ts`) asserting `/var/log/payload.sh`, `/var/log/messages`,
    `/var/log/nginx/access.log`, `/var/log/auth.log.1`, subdirs → still `403 no_session`.
  - **Bypass applies to `upsertPatch` ONLY.** `removePatch` has no exception — **covering tracks**
    (deleting a log line) still needs a real session on the box. Keep this asymmetry.

## v2 surfaces this bolts onto

- `LogApi` is **already typed** (`v2/src/core/commands/types.ts:185-188`:
  `appendAuthLog(target, line)`, `appendAccessLog(target, line)`) — but has **zero callers** and is a
  no-op stub in the UI (`v2/src/ui/env.ts` `logStub`). This plan makes it real and adds the kern.log
  channel nmap needs.
- Server endpoint: `v2/src/core/patches/upsertPatch.ts` `handleUpsertPatch` — where the allowlist
  bypass goes (after the prerequisite L1/L2 gates are added there).
- `walker.ts` (L2) — must become a server gate first (prerequisite #4).

## Decisions baked in (CONFIRM before coding)

1. **`LogApi` is the seam, not a target-aware `PatchApi`.** Keep logging on its own narrow contract
   (`appendAuthLog`/`appendAccessLog`/+`appendKernLog`) rather than widening `PatchApi` to take a
   target machine. _Rationale_: the allowlist bypass is the whole point — `LogApi` writes are
   ambient and session-less by design; ordinary `PatchApi` writes are session-gated. Different trust
   semantics → different seam. _Alternative_: a `PatchApi.writeTo(target, …)` that internally routes
   log paths through the bypass — rejected, blurs the trust boundary.
2. **Aggregate one line per sweep**, ported from legacy (not one per probed port). nmap → kern.log.
3. **Exact-match allowlist, upsert-only bypass** — verbatim from legacy, including the wire-level
   negative test. No `/var/log/` prefix, ever.
4. **Source-IP resolver ported faithfully** (`resolveLogSourceIP`) — same-LAN leaks the LAN IP on
   purpose (`feedback_log_source_ip_realism`). Needs v2's notion of localIP + home-router public IP.
5. **Channels scoped to what ships.** Only wire the log files for commands that exist in v2 at port
   time. nmap → kern.log now; auth.log/access.log/etc. land as ssh/curl/hydra/etc. arrive. Keep the
   allowlist complete (all 8) so each command just starts emitting — but only TEST channels with a
   live caller (`feedback` on no metadata-only tests).

## Public/NAT IP model (resolved — was an open question)

`resolveLogSourceIP`'s off-network branch needs a **home-router public IP**, which v2 does not model
yet (`assignHomeNetwork` issues only a `localIp`). Resolution:

- **Port `generatePublicIp` to `v2/src/core/generation/ip.ts`** (pure, framework-agnostic). Carry
  legacy's design (`src/generation/ip.ts:12-22`): first octet **PRNG-picked from the fixed 12-prefix
  allowlist** `[45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212]` (realistic routable ranges —
  never RFC1918 by construction), octets 2–3 in `1–254`, octet 4 in `2–254`. Deterministic from a
  seeded `Prng` (`core/generation/prng.ts`). The optional `usedIps` collision-avoidance arg can be
  dropped for now (single allocation) and added back when the IP registry lands.
- **Seed per-NETWORK (ESSID), not per-player.** Seed string `home-public-${essid}` — distinct from
  the per-player `home-${pubkey}-${essid}` used for `localIp`. _Why_: the WAN IP belongs to the
  router, so every occupant of the same AP must see the **same** public IP. ESSID-only seeding is the
  forward-correct seam: when cross-player + server-authoritative join land, all occupants already
  agree on the public IP with no migration. (Per-player seeding would have each player invent a
  different WAN IP for the same AP — wrong the moment two players share a LAN.)
- **Store it on the join result.** Extend `HomeNetworkAssignment` (`core/network/homeNetwork.ts:23`)
  with `readonly publicIp: Ipv4`. `assignHomeNetwork` derives it from the ESSID seed and returns it
  alongside `localIp`/`hostname`. This is the value the future `/api/join-home-network` server will
  **allocate authoritatively** (legacy's `routerPublicIp` override precedence) — the `Promise`-shaped
  `env.homeNetwork.join` seam already absorbs that swap.
- **Consumer wiring.** The logging layer reads the connected network's `publicIp` (null when offline)
  and passes it as `resolveLogSourceIP`'s 5th arg. Mirrors legacy `getPublicIP()`
  (`src/network/NetworkContext.tsx:807-810`): `homeNetwork ? router.publicIp : null`.
- **Shippable early / independently.** Unlike the rest of this plan, this piece is pure model with a
  golden test and **no cross-player dependency** — it can land ahead of the parked logging work
  (e.g. folded into the connectivity arc) without waiting on the Prerequisite. It is the one slice
  here that is not blocked. The `assignHomeNetwork` golden test
  (`core/network/homeNetwork.test.ts:24`) must be updated to include the new `publicIp` field.

## Acceptance Criteria

- [ ] An online player runs `nmap <subnet>` against a **real, server-persisted** target host →
      a single aggregate line lands in that target's `/var/log/kern.log`, persisted server-side.
- [ ] A different identity that can read that target (owner, or post-breakin session) sees the
      scanner's line via `cat /var/log/kern.log` — i.e. the trace is genuinely cross-player observable.
- [ ] The source IP follows the realism rule: same-`/24` scan logs the attacker's **LAN IP**;
      off-network scan logs the **home-router public IP**.
- [ ] A forged signed envelope with **no session** can upsert to an allowlisted log path (200) but
      is rejected (`403 no_session`) for any non-allowlisted `/var/log/*` path, subdir, or `.1` suffix.
- [ ] `removePatch` on a log file with no session is rejected — covering tracks needs a real session.
- [ ] Scanning while offline writes **no** log (no target, no trace).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` before code. Run `npm run lint` in
`v2/` (no Prettier — `project_v2_no_prettier_format_gate`). Bump version (`package.json` +
`package-lock.json`) after each slice. **Do not start Slice 0 until the Prerequisite holds.**

### Slice 0 (gate): confirm the prerequisite is met

**Value**: a written, verified check that real target machines + server L1/L2 exist, so logging has
somewhere to live. Not a code slice — a go/no-go. If any of the four prerequisite items is missing,
this plan stays parked and the missing piece is built in its own epic slice first.

### Slice A (NOT blocked — can ship ahead of the Prerequisite): public/NAT IP model

**Value**: the home network has a stable, ESSID-seeded public IP — completing the connectivity model
and giving Slice 1's source-IP resolver its off-network value. Pure model; no cross-player dependency,
so it can land independently (e.g. folded into the connectivity arc) while the rest of this plan stays
parked.
**Path**: port `generatePublicIp` into `v2/src/core/generation/ip.ts` (12-prefix allowlist,
deterministic, see "Public/NAT IP model" above) → extend `HomeNetworkAssignment` with `publicIp` →
`assignHomeNetwork` derives it from the `home-public-${essid}` seed and returns it. Update the
`env.homeNetwork.join` stub + the `commandEnv` test factory to carry `publicIp`.
**RED**: `generatePublicIp` — golden IP for a fixed seed; first octet ∈ the 12-prefix allowlist;
octet ranges (2–3 ∈ 1–254, 4 ∈ 2–254); never RFC1918. `assignHomeNetwork` — `publicIp` is stable for
an ESSID and **identical across two different identities on the same ESSID** (the per-network
contract), distinct across ESSIDs; update the existing golden test. Mutator watch: the allowlist
`pick`, each octet bound, the seed string (`home-public-` vs `home-`).
**GREEN**: the generator + assignment extension. **MUTATE / KILL / REFACTOR**: per skills.

### Slice 1: pure log formatting + source-IP resolution (no I/O)

**Value**: the formatter + source-IP rules exist and are proven in isolation — the deterministic core,
portable from legacy with zero infra.
**Path**: port `formatNmapScanAggregate` and `resolveLogSourceIP` into `v2/src/core/logging/`
(pure, framework-agnostic — fits the core boundary). No env, no patches.
**RED**: golden line for a fixed date/host/source/ports; source-IP table (same-`/24` → LAN; diff →
public; remote session → session IP; no-home → LAN fallback). Mutator watch: subnet-prefix slice
length, the `sessionMachine !== own` branch, the `??` fallback.
**GREEN**: the two pure functions. **MUTATE / KILL / REFACTOR**: per skills.

### Slice 2: server-side `AMBIENT_LOG_FILES` allowlist bypass (L1+L2)

**Value**: the endpoint lets session-less recon writes land on allowlisted log paths only — the
security-critical core, fully testable at the handler layer without a UI.
**Path**: in `handleUpsertPatch` (`v2/src/core/patches/upsertPatch.ts`), add the exact-match
allowlist check that skips the (prerequisite) remote-session L1 gate **and** the server L2 walker for
allowlisted paths — upsert only. `removePatch` unchanged.
**RED**: allowlisted path + no session → 200; every non-allowlisted `/var/log/*` (`payload.sh`,
`messages`, `nginx/access.log`, `auth.log.1`, subdirs) + no session → `403 no_session`;
`removePatch` on a log path + no session → `403`. Port the negative cases from
`scripts/testAmbientLogAllowlist.ts`. Mutator watch: `Set.has` vs `startsWith`, the upsert-only
guard, each allowlist entry.
**GREEN**: the allowlist `Set` + `isAmbientLogPath` + the branch. **MUTATE / KILL / REFACTOR**.

### Slice 3: real `LogApi` → patch stream, wired to nmap

**Value**: end-to-end — `nmap <subnet>` against a real host leaves a persisted, cross-player-readable
trace in that host's `/var/log/kern.log`.
**Path**: make `LogApi` real (`v2/src/ui/env.ts`) — `appendKernLog`/`appendAuthLog`/`appendAccessLog`
read-append-write the target's log file through the remote write seam (the made-real LogApi route to
`/api/patches` with the allowlisted path). Wire nmap to call it once per sweep with the
Slice-1-formatted line + resolved source IP. NAT-resolve the destination so the log lands where the
host actually lives (legacy parity).
**RED**: command-level test — online `nmap` against a real target appends exactly one kern.log line;
offline → no call. A second identity reading the target sees the line. Mutator watch: one-line-per-
sweep (not per-probe), the online guard, the target-resolution.
**GREEN**: LogApi impl + nmap wiring. **MUTATE / KILL / REFACTOR**.

## Pre-PR Quality Gate (each slice)

1. Mutation testing (`mutation-testing` skill) — report reviewed. Don't run Stryker alongside the v2
   dev server (`project_v2_stryker_devserver_contention`).
2. Refactoring assessment (`refactoring` skill).
3. `npm run lint` + typecheck + `npm run test:run` pass in `v2/`.
4. **E2E the new primitive through the UI before "done"** (`feedback_e2e_test_new_primitives`,
   `feedback_e2e_test_new_primitives`): crack → connect → online → `nmap` a real host → break in →
   `cat /var/log/kern.log` shows your scan. Watch the network tab — the integration seam
   (LogApi → patch → allowlist bypass → DB → cross-player read) is exactly where legacy drifted.

## Open questions to confirm with the owner

- ~~**What is v2's "home-router public IP"?**~~ **RESOLVED** — see "Public/NAT IP model" above and
  Slice A: port `generatePublicIp` (12-prefix allowlist), seed per-network (`home-public-${essid}`),
  store on `HomeNetworkAssignment.publicIp`, server-allocated later via `/api/join-home-network`.
- **Cross-player read path**: this plan assumes the `network-generator-epic` read filter (legacy's
  three-tier `listPatchesForMachines`) is the path by which a second player reads the trace. Confirm
  sequencing — logging-write (this plan) likely lands just after the cross-player read path.
- **Replay/nonce**: legacy used Upstash; v2's nonce store is a no-op locally
  (`patches.ts` `noopNonceStore`). Allowlisted session-less writes are the highest-value forgery
  target — confirm the real nonce store lands with, or before, this plan.

---

_Delete this file when all slices ship. Note: this plan stays parked until the Prerequisite holds —
do not implement against pure-generated placeholder hosts._
