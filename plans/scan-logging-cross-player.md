# Plan: scan/connection logging — leaving traces on target machines (cross-player)

**Branch**: `feat/v2-scan-logging` (per-slice branches below)
**Status**: In progress — **Slice 3 RE-SLICED into 3a (UNBLOCKED) + 3b (blocked)** (updated 2026-06-12,
post-SSH-epic). The SSH epic (PRs #221–#228) built three of the four prerequisites: the **remote write
seam**, the **server L1 gate** (`authorizeMachineAccess`), and the **server L2 walker**
(`enforceRemoteWriteL2`) all now exist, and PR #228 shipped **`appendMachineLog`** — the exact "system
writes a line to a machine's log file" primitive this plan needs.
**Key reframing (2026-06-12):** the per-viewer write is at **exact parity with the already-shipped SSH
auth.log** (#228 also writes scoped to `(player_key, machine_id)` — self-readable, not yet cross-player).
So the scan log can ship the same way **now**: **Slice 3a** writes the kern.log line on the scanned
NPC/generated host per-viewer (self-observable: scan → break in as the same identity → `cat kern.log`
shows your own scan), which is **unblocked and builds the entire server-action + write seam**. The ONE
remaining hard block is **cross-player shared machine persistence** (the _different-identity_ read +
scanning real player workstations): that is **Slice 3b**, and it needs the shared, server-persisted
machine record from `network-generator-epic`. 3b is then only a re-key/re-read of 3a's write — the write
call, formatter, source-IP, and NAT logic all carry over.
**Mechanism reshaped — see "Post-SSH-epic mechanism update" below: the 3g server-internal write
OBSOLETES the `AMBIENT_LOG_FILES` allowlist (Slice 2, DELETED).**
**Parent epic**: `plans/network-generator-epic.md` (cross-player read/write path) — slots in once
generated LAN hosts have DB-backed, _cross-player-shared_ patch streams.

## Why this matters

Scanning and connecting must leave a **trace on the target machine's filesystem** (`/var/log/*`).
This is not cosmetic: in a multiplayer world, **logs are the primary way players discover each
other**. You break into a box, `cat /var/log/kern.log`, and see another player's source IP from
when they scanned it. The defender role (watching your own logs for intruders) and the attacker
role (covering tracks) both hang off this. Realism + emergent PvP discovery in one mechanism.

The catch: a trace is only valuable if it **persists on a machine someone else can later read**.
That requires the target to be a real, server-persisted machine — which v2 does not have yet.

## Prerequisite (re-checked 2026-06-12 after the SSH epic — only #1's cross-player half remains)

Today in v2 the scanned LAN (`generateHomeLan`) is **pure-generated, deterministic placeholders** —
rows in nmap's output. The SSH epic gave them a stable `machine_id` and a server-persisted patch
stream, but **per-viewer** (scoped to the requesting player_key), not cross-player-shared. Status of
each item:

1. **Scanned hosts are real machines** with a stable `machine_id` + server-side patch stream.
   **PARTIALLY MET.** The SSH epic gave generated hosts a coordinate-derived `machine_id`
   (`hostMachineId`/`hostForMachineId`, `core/generation/remoteHostId.ts`) and a real server patch
   stream (3e: writable remote FS in the `patches` table keyed by `(player_key, machine_id)`; 3g wrote
   `/var/log/auth.log` there). **STILL MISSING (the hard block): a CROSS-PLAYER SHARED machine record.**
   Each viewer regenerates the host's FS and patches under THEIR OWN `player_key`, so a trace one player
   writes is invisible to another. `findMachineByAddress`/`resolveDns` in `v2/src/ui/env.ts` may still
   need wiring for an _unowned_ target. → `network-generator-epic`.
2. **A remote write seam** exists. ✅ **MET (SSH epic).** The full remote write path landed (3e/3f),
   and 3g shipped **`appendMachineLog`** (`core/patches/appendMachineLog.ts`) — the read-modify-write of
   a log file on a target machine, _as the system_. This is the seam (see the mechanism update below);
   the legacy `LogApi`/target-aware-`PatchApi` framing is superseded.
3. **Server L1 exists to make an exception _for_.** ✅ **MET (PR #225).**
   `core/patches/authorizeMachineAccess.ts` — own-workstation bypass OR an active `sessions` row for
   `(player_key, machine_id)`, else `403 no_session`. Wired into upsert/list/remove handlers.
4. **Server L2 (the permission walker) is server-enforced.** ✅ **MET (PR #227).**
   `core/patches/remoteWritePermission.ts` (`enforceRemoteWriteL2`/`isRemoteWriteAllowed`) runs the
   shared `createFsView().canWrite` server-side via FS **regeneration** (no `machine_filesystems`
   projection). A bypass would now skip both L1 and L2 — but see below: the 3g pattern doesn't need a
   bypass at all.

Per-viewer logging (the scanner reads their own trace) needs only #2–#4, all MET — that is **Slice 3a**,
buildable now. The STOP rule applies only to **Slice 3b**: if you need a _different_ identity to read
the trace (cross-player), do not proceed until #1's shared machine record lands.

## Post-SSH-epic mechanism update (2026-06-12) — READ BEFORE the legacy reference

PR #228 (ssh auth.log) established the v2 pattern for "a service records a login/scan on the machine it
just touched", and it diverges from legacy in a way that **simplifies this plan**:

- **Write via `appendMachineLog`** (`core/patches/appendMachineLog.ts`), NOT a client `LogApi` through
  the normal patch stream. It is a fire-and-forget read-modify-write of a target log file _as the
  system_ (`{readLog, upsertPatch}` deps + `{playerKey, machineId, path, owner, permissions}` target).
  Built to be reused by exactly these callers (nmap-scan/ftp/nc/mysqld/redis) — **only the formatter and
  the target path differ.** For nmap that is `formatNmapScanAggregate` + `/var/log/kern.log` (kern.log
  confirmed by the owner: legacy-faithful + realistic).
- **The write is SERVER-INTERNAL, inside the action handler** — exactly how `handleAuthCreateSession`
  writes auth.log. The server, having already verified the signed envelope (= verified pubkey) and
  resolved/authorized the target, writes the log line itself. **The client never supplies the path or
  content.**
- **⇒ The `AMBIENT_LOG_FILES` allowlist (Slice 2) is almost certainly OBSOLETE.** The allowlist existed
  only because legacy logging was _client-driven_: the client told the server "append <line> to
  </var/log/...> on target X", so the server needed an exact-match Set to stop a forged envelope from
  planting `/var/log/payload.sh`. In the 3g model the **server hardcodes the path** (kern.log) — there
  is nothing to forge, so there is no allowlist to protect and no L1/L2 bypass to grant. This is
  strictly simpler and more secure. **CONFIRM at Slice 2: drop the allowlist entirely** unless a
  genuinely client-driven log write survives (none is currently planned).
- **Structural implication: nmap must gain a SERVER round-trip.** Today nmap is pure client-side
  generation (`generateHomeLan`), so there is no handler in which to do the server-internal write.
  **Slice 3a** turns the scan into a server action (resolve the target → return ports → write the
  kern.log line via `appendMachineLog`), the same shape as `authCreateSession`. **Slice 3b** later
  re-points target resolution + the row key at the _shared_ machine record (reading a shared host's
  ports is a server read anyway) — but the server action itself is built in 3a.
- **What already exists in v2** (do not re-port): the syslog core `formatSyslogLine` (`core/logging/
syslog.ts`); `formatNmapScanAggregate` (`core/logging/kernLog.ts`) + `resolveLogSourceIP`
  (`core/logging/sourceIp.ts`), both **SHIPPED in Slice 1 (v0.51.0)**; the source-IP/public-IP model
  (Slice A, **SHIPPED #210**); the L1/L2 server gates. 3a only needs the server action + `KERN_LOG_*`
  storage identity + wiring.
- **The cross-player gap is unchanged by 3g.** `appendMachineLog` writes under the _caller's_ player_key
  view. Making the trace readable by another identity still needs the shared-machine record (#1). The
  primitive is already shaped for it (target is `(playerKey, machineId)`; a shared model swaps how the
  row is keyed/read, not the write call).

The legacy reference below is kept for the **format + source-IP + routing** details (still ported
verbatim), but the **allowlist-bypass machinery is superseded** by the server-internal write above.

## Legacy reference (format + source-IP + routing — port verbatim; allowlist machinery SUPERSEDED)

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

- **`appendMachineLog`** (`core/patches/appendMachineLog.ts`, shipped #228) — the write primitive.
  nmap's server action calls it with `formatNmapScanAggregate(...)` + the kern.log target. (The old
  `LogApi` stub in `v2/src/core/commands/types.ts`/`env.ts` is superseded by the server-internal model
  — a client-side `LogApi` is no longer the seam; remove or leave the dead stub.)
- The syslog formatters (`core/logging/syslog.ts`: `formatSyslogLine`/`formatSyslogTimestamp`;
  `core/logging/kernLog.ts`: `formatNmapScanAggregate`; `core/logging/sourceIp.ts`:
  `resolveLogSourceIP`) — all **SHIPPED in Slice 1 (v0.51.0)**; 3a just calls them.
- The server L1/L2 gates already exist (`authorizeMachineAccess.ts`, `remoteWritePermission.ts`) — the
  server-internal write doesn't pass through them, so no bypass/allowlist is needed (see mechanism
  update). The remaining surface is the **shared cross-player machine record** (network-generator-epic).

## Decisions baked in (CONFIRM before coding)

1. **~~`LogApi` is the seam~~ SUPERSEDED → the seam is `appendMachineLog`, called SERVER-INTERNALLY**
   (post-SSH-epic). The server writes the log inside the scan action (the request it already verified +
   authorized), like `handleAuthCreateSession` writes auth.log. The client never names the path/content.
   _Why the change_: it removes the entire client-driven-write trust problem the legacy `LogApi`/allowlist
   existed to solve. (Original decision 1 — `LogApi` vs target-aware `PatchApi` — is moot; neither client
   seam is used.)
2. **Aggregate one line per sweep**, ported from legacy (not one per probed port). nmap → `kern.log`
   (owner-confirmed: same file as legacy, realistic).
3. **~~Exact-match allowlist, upsert-only bypass~~ LIKELY DROPPED** — obsolete under the server-internal
   write (server hardcodes kern.log → nothing to forge → no bypass). CONFIRM at Slice 2; keep the legacy
   allowlist only if a client-driven log write is ever reintroduced (none planned). The legacy wire-level
   negative test (`/var/log/payload.sh` → 403) becomes unnecessary if there is no client-supplied path.
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
  here that is not blocked. **SHIPPED — PR #210 (`f6c5d62`, v0.34.0).**
- **Server allocation, when it lands, folds into `/api/join-home-network` — do NOT port legacy's
  standalone `allocate-ip`. (Decision 2026-06-07.)** Legacy needed a separate signed `allocate-ip`
  endpoint (random roll + `public_ips` Supabase table + collision-retry + Upstash rate-limit/nonce)
  only because multiplayer was bolted onto a single-player base. v2 is multiplayer-first: the join
  endpoint is the boundary, so it should **allocate-on-first-join, persist the network's `publicIp`,
  and return the stored value to later occupants** (collision-retry there, reusing the already-ported
  `generatePublicIp` — that is when the dropped `usedIps` loop returns). Until a cross-player consumer
  needs globally-unique, addressable IPs, the deterministic ESSID seed is sufficient and the
  `Promise`-shaped `env.homeNetwork.join` seam absorbs the swap with zero rework.

## Acceptance Criteria

Tagged by the slice that satisfies each: **[3a]** passes once the per-viewer write ships (unblocked);
**[3b]** stays unchecked until the shared-machine record lands. Shipping 3a WITHOUT 3b is expected — do
not read "scan logging shipped" as "cross-player log discovery works"; the headline PvP payoff is 3b.

- [ ] **[3a]** An online player runs `nmap <target>` against a real generated host → a single aggregate
      line lands in that host's `/var/log/kern.log`, persisted server-side.
- [ ] **[3a]** The **same identity** that scanned then reads the host (post-breakin session via ssh)
      sees its **own** scan line via `cat /var/log/kern.log` — self-observable, parity with SSH auth.log.
- [ ] **[3a]** The source IP follows the realism rule: same-`/24` scan logs the attacker's **LAN IP**;
      off-network scan logs the **home-router public IP**.
- [ ] **[3a]** Scanning while offline writes **no** log (no target, no trace).
- [ ] **[3b]** A **different identity** that can read that target (owner, or post-breakin session) sees
      the scanner's line — i.e. the trace is genuinely **cross-player observable** (the headline payoff).
- [ ] **[3b]** Scanning a real **player workstation** (not just an NPC host) leaves the same trace,
      readable by that workstation's owner.
- [ ] ~~A forged signed envelope with no session can upsert to an allowlisted log path~~ — **N/A under
      the server-internal write** (the client never supplies a log path, so there is no allowlist to
      test). Reinstate only if a client-driven log write is added.
- [ ] **[3a]** `removePatch` on a log file with no session is rejected — covering tracks needs a real
      session. (The server-internal _write_ bypasses nothing, but _deleting_ a line is still a normal
      session-gated remove — the legacy asymmetry holds.)

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` before code. Run `npm run lint` in
`v2/` (no Prettier — `project_v2_no_prettier_format_gate`). Bump version (`package.json` +
`package-lock.json`) after each slice. **Slices A (SHIPPED #210) + 1 (SHIPPED v0.51.0 — pure
formatter/source-IP) are done; Slice 2 is DELETED (server-internal write obsoletes the allowlist);
Slice 3 is split — 3a (per-viewer server-internal write, self-observable, parity with SSH auth.log) is
UNBLOCKED and buildable now; 3b (cross-player read via the shared machine record + scanning player
workstations) is blocked on Prerequisite #1.**

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

### Slice 1: pure log formatting + source-IP resolution (no I/O) — ✅ SHIPPED (v0.51.0)

**Value**: the formatter + source-IP rules exist and are proven in isolation — the deterministic core,
portable from legacy with zero infra. **Shippable ahead of the cross-player block** (like Slice A).
**SHIPPED**: the logging module was restructured by **destination concern** rather than dumping the
nmap formatter into `authLog.ts` (kern.log ≠ auth.log; "syslog" is the _format_, not a file):

- `core/logging/syslog.ts` — shared syslog FORMAT primitives (`formatSyslogTimestamp`,
  `formatSyslogLine`, `derivePid`); auth.log + kern.log + future service logs all compose these.
- `core/logging/authLog.ts` — auth.log concern only (su/sshd formatters + `AUTH_LOG_*`).
- `core/logging/kernLog.ts` — `formatNmapScanAggregate` (`kernel: [iptables] Port scan …`, no `[pid]`).
- `core/logging/sourceIp.ts` — `resolveLogSourceIP` (options-object signature per CLAUDE.md;
  same-`/24` leaks LAN IP, off-network NATs to public IP, no-home → LAN fallback).
  Mutation: all four modules **100%** (killed a real `join('.')→join('')` subnet-matching survivor with
  an octet-boundary test). No E2E — pure functions, no live caller until Slice 3 wires nmap.
  _Real-Linux note_: an nmap scan only logs if the target firewall has an iptables `LOG` rule; that line
  is a kernel-facility message → lands in `/var/log/kern.log` (and `/var/log/syslog` on Debian default).
  kern.log is the kernel-specific home — matches legacy + owner confirmation.

### Slice 2: ~~server-side `AMBIENT_LOG_FILES` allowlist bypass~~ — LIKELY DROP (confirm)

**Superseded by the server-internal write (see mechanism update).** Because the scan action writes
kern.log itself (client never supplies the path), there is no session-less _client_ write to allow, so
no allowlist and no L1/L2 bypass. **Default plan: DELETE this slice.** Re-introduce the legacy
exact-match `Set` + upsert-only bypass + `scripts/testAmbientLogAllowlist.ts` wire-test ONLY if a
genuinely client-driven log write is ever added (none planned). If kept, the constraints below are
load-bearing — see "Legacy reference".

### Slice 3a: per-viewer server-internal kern.log write, wired to a server-side nmap scan — NOT BLOCKED

**Value**: end-to-end self-observable trace — `nmap <target>` against a generated host leaves a
persisted line in that host's `/var/log/kern.log`, which the **same identity** reads after breaking in.
**Exact parity with the SSH auth.log write (#228)**: per-viewer, scoped to `(player_key, machine_id)`,
server-internal. This builds the **entire server-action + write seam**; 3b later only re-keys the row.
**Why unblocked**: writing to the scanner's own per-viewer copy needs no shared-machine record — the
SSH epic already proved this exact pattern against generated hosts (3e writable remote FS + 3g auth.log).

**Path** (3g-shaped, not legacy `LogApi`):

- **nmap gains a server action.** Today nmap is pure client-side `generateHomeLan` (no round-trip), so
  there is no handler to do a server-internal write. Add a scan action (e.g. on `/api/...`) that
  verifies the signed envelope, resolves the target host on the caller's own LAN, returns its ports,
  AND — server-internal — calls
  `appendMachineLog({readLog, upsertPatch}, {playerKey, machineId, path: /var/log/kern.log, owner:'root',
permissions: kern.log perms}, formatNmapScanAggregate(...))` **once per sweep**, best-effort. The api
  glue mirrors `api/sessions.ts`' authCreateSession `readAuthLog`/`upsertPatch` wiring.
  - **Real-latency note** (`feedback_real_latency_over_fake_delays`): the scan now has a real
    round-trip; reconcile with the existing client-side abort-aware `env.sleep` row pacing — don't stack
    fake delay on top of the real request.
- **kern.log storage identity.** Add `KERN_LOG_PATH`/`KERN_LOG_OWNER`/`KERN_LOG_PERMISSIONS` beside the
  `AUTH_LOG_*` set (single source of truth shared by the host-FS seed + the appender), so the seeded
  file and every appended patch agree. World-readable, root-write (iptables LOG is a kernel write).
- **Source IP + NAT destination.** Resolve the source IP via `resolveLogSourceIP` (Slice 1) using the
  connected network's `publicIp` (Slice A); NAT-resolve the destination so the line lands where the host
  actually lives (legacy parity).
- **Offline guard.** No connected LAN → no scan → no write (the existing nmap `UNREACHABLE` path).

**RED**: handler test — online scan of a reachable target appends **exactly one** kern.log line
(server-internal); unreachable/out-of-range target → no line; offline → no scan → no line. The **same
identity** re-reading the host sees its own line. Mutator watch: one-line-per-sweep (not per-probe),
the online guard, the target-resolution, the per-viewer keying.
**GREEN**: the scan server action + `appendMachineLog` call + nmap client wiring.
**MUTATE / KILL / REFACTOR**: per skills.
**Live E2E** (`feedback_e2e_test_new_primitives`): crack → connect → online → `nmap` a generated host →
`ssh` in (same identity) → `cat /var/log/kern.log` shows the scan line with the resolved source IP.
Watch the network tab — the integration seam (scan action → `appendMachineLog` → patch → DB → read-back)
is exactly where legacy drifted.

### Slice 3b: cross-player read — shared-machine keying + scanning player workstations (CROSS-PLAYER-BLOCKED)

**Value**: the headline payoff — a **different identity** that can read the target sees the scanner's
line, and you can leave a trace by scanning a real **player workstation**, not just an NPC host.
**Blocked on Prerequisite #1's shared, server-persisted machine record (`network-generator-epic`).**
**Path**: re-key 3a's write from the per-viewer `(player_key, machine_id)` row to the **shared machine
record** so all occupants/owners read the same kern.log; extend target resolution so a player workstation
is a valid scan target. **Everything else carries over from 3a unchanged** — the write call, the
formatter, the source-IP resolution, the NAT destination, the offline guard. This is the re-key/re-read
swap the per-viewer seam was built to absorb.
**RED**: handler test — a **second identity** reading the shared target sees the first identity's scan
line; scanning a player workstation lands a line its owner reads. Mutator watch: the shared-vs-per-viewer
keying, the workstation-as-target resolution.
**GREEN**: the shared-keying swap + workstation target resolution. **MUTATE / KILL / REFACTOR**.
**Live E2E**: crack → connect → online → `nmap` a shared host → break in **as another identity** →
`cat /var/log/kern.log` shows the attacker's scan line with the resolved source IP.

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
  (`patches.ts` `noopNonceStore`). The allowlist forgery target is gone (server-internal write, no
  client-supplied path), so the residual concern is only replaying a signed scan envelope — low value
  (re-logs your own scan). Still confirm the real nonce store lands with the broader cross-player work.

---

_Delete this file when all slices ship. Note (updated 2026-06-12): the WRITE mechanism exists
(`appendMachineLog`, server-internal); Slices A + 1 shipped. **Slice 3 is split: 3a (per-viewer write,
self-observable, parity with the shipped SSH auth.log) is UNBLOCKED — build it next**; 3b (the
different-identity / cross-player read + scanning player workstations) stays parked until generated hosts
have a shared, server-persisted machine record (network-generator-epic), at which point it is just a
re-key/re-read of 3a's write. Do not gate 3a on the shared record — it writes to the scanner's own
per-viewer copy, exactly like SSH does today._
