# Cross-player architecture (as-built)

How one player (B) scans, enters, reads, and modifies another player's (A's) machine.
This is the core of v2's multiplayer. It covers the shipped model — Stories 1–3 of the
multiplayer/cross-player epic. Design intent lives in
`v2/docs/rewrite-blueprint/sections/05-shared-world-and-cross-player.md`; the in-flight epic
(remaining Stories 4–7) lives in `plans/multiplayer-crossplayer-epic.md` while active.

## The gate this design crosses

Single-player v2 was **per-viewer**: every identity regenerated each machine under its own
key, so a file or trace one player created was invisible to everyone else. Cross-player
turns three things shared and server-authoritative:

1. A **shared machine record** — a machine's filesystem patches key on `machine_id`, with
   the writing player demoted from _identity_ to _provenance_.
2. A **public-IP registry** — `public IP → network → router → machines`, server-persisted
   and queryable, so a _different_ identity's scan resolves to real machines server-side.
3. A **server-side read filter** — the wire is pruned to the caller's tier before it leaves.

**Trust boundary:** the Vercel function + Supabase RLS (service-role only), never the client.
Every identity claim is the verified Ed25519 pubkey from the signed envelope; a client never
asserts who it is or what tier it holds. Treat any client (the game UI, `curl`, Burp) as
hostile — the wire is the threat surface.

## 1. Storage: the shared patch journal

A machine's filesystem is a **base FS** (deterministically generated from the owner's
identity) plus a **journal** of patch rows replayed over it.

- **Table `patches`**, PK **`(machine_id, path, writer_key)`** (migration
  `20260614130000_patches_shared_journal.sql`). One row per _(file, writer)_, so multiple
  writers' edits to the same path **coexist**.
- **`writer_key`** = the player who wrote that row (provenance). **Always server-stamped**
  from the verified pubkey; the payload schema rejects a client-supplied
  `player_key`/`writer_key` outright (`core/patches/upsertPatch.ts`).
- **`content: null`** is a deletion marker (tombstone). The in-game file `owner` column
  (for `ls -l`) is separate from `writer_key`.
- **Chronological replay:** reads sort rows by **server `updated_at` asc, tiebreak
  `writer_key`** (`core/patches/orderPatchesForReplay.ts`) before folding them. `updated_at`
  is bumped server-side on every write (a `BEFORE UPDATE` trigger), so a client cannot forge
  its write to win ordering. `applyPatches` (`core/filesystem/applyPatches.ts`) folds the
  ordered list left-to-right — **last write per path wins**.
- **`applyPatches` semantics:** `nodeType:'directory'` → create empty dir, **no-op if the
  path already exists** (so a `mkdir` never clobbers files added under it later);
  `content:null` → `removeNode`, which **drops the whole subtree** for a directory path (so a
  single tombstone hides a recursively-removed dir); `content:string` → create/overwrite a
  file.
- **Deletes are tombstone-always** (`core/patches/removePatch.ts`): every `rm` clears the
  caller's own row + descendant rows, then upserts a `content:null` marker. A bare
  hard-delete would lose the "deleted at t" event, letting a concurrent writer's row keep the
  file alive after replay; a tombstone is a write that wins chronologically, so
  delete-then-recreate replays correctly (a later owner write wins over an earlier tombstone).

RLS denies anon/authenticated entirely; only the service-role function touches the table.

## 2. Identity & addressing

- **Machine id** = `computeWorkstationId(name, pubkeyHex)` =
  `name-<sha256('ed25519:' + pubkeyHex)[0..8]>` (`core/identity/workstation.ts`). The
  `'ed25519:'` prefix is **load-bearing** — a raw-pubkey derivation diverges and silently
  breaks auth/L1/L2. `isOwnWorkstation(machineId, pubkey)` matches that suffix. Because the
  id already encodes the owner, `(machine_id, …)` is a sound shared key and never merges two
  players' (or per-viewer NPC) boxes.
- **Public IP** = ESSID-seeded, from a fixed prefix allowlist (`core/generation/ip.ts`,
  `isPublicIp`). Joining a home network registers a row in **`network_registry`** (PK
  `public_ip`): `owner_key`, `workstation_machine_id` (indexed), `router_machine_id`
  (= `computeRouterId(owner_key)` — a DISTINCT machine, Story 5.1.1b), `essid`,
  `workstation_username`, `workstation_machine_name`, `workstation_root_hash`
  (`core/network/registerNetwork.ts`, migrations `20260613000000_network_registry.sql` +
  `20260617000000_drop_network_registry_forward_table.sql`).
- **NAT (Story 5.1):** the router is a real, journal-backed machine
  (`router_machine_id = computeRouterId(owner_key)`, `core/identity/router.ts`) that bears the
  public IP and runs its own seeded `sshd:22`. Forwards are NOT a registry column — they parse
  from the router's `/etc/iptables/rules.v4` (`core/network/iptablesRules.ts`), the single
  source of truth. `scanResult({ vantage, … })` (`core/scan/scanResult.ts`) is the one total
  function feeding both scan paths (external = own ports ∪ live forwards; sameLAN = own only —
  never a merged view). The old degenerate `forward_table` column is dropped.
  `machineServing({ routerFs, port })` (`core/network/machineServing.ts`, Story 5.1.2) is the
  routing counterpart — given the materialized router and a destination port it returns the
  served machine: a router own port → `router`; a parsed forward → `forward{internalIp,
internalPort}`; else `none` (router-own wins a same-port tie). It shares `readRulesV4` with
  `scanResult` (both lifted into `iptablesRules.ts`).
- **The owner's own router is a distinct machine category (Story 5.1.3a):** neither the own
  workstation (suffix-match, L1-bypass), a regenerated LAN sibling (`hostForMachineId`), nor a
  cross-player foreign box. `isOwnRouter(machineId, pubkey) = machineId === computeRouterId(pubkey)`
  (`core/identity/router.ts`) is the identity-derived recognizer, and `buildRouterBaseFs(ownerKey)`
  (`core/generation/routerFs.ts`) is the single owner-key → router base FS composer that the client
  view, the server materialize (`materializeRouterFs`), the L2 walker, and the own-LAN auth handler
  all share (so the router tree never drifts between them). Holding the router id grants **no L1
  bypass** — the router is always session-gated (you must `ssh root@.1` to configure it).

## 3. Reachability & cross-player login

- **Scan (Story 5.1.1b + 5.1.3b):** `nmap <A's public IP>` from B routes to a signed `resolvePublicScan`
  (`core/scan/resolvePublicScan.ts`). The server resolves the public IP to A's **router**
  (`router_machine_id`), materializes it (seeded base + journal replay —
  `core/network/materializeRouterFs.ts`), checks `canBoot` (a bricked router takes the whole
  IP dark), and returns its open ports via `scanResult` (external vantage): the router's own
  seeded `sshd:22` plus any live forwards. The workstation is dark behind NAT until A opts a
  forward in. **5.1.3b** wires `scanResult`'s injected `resolveTargetPorts`: the pure
  `core/scan/workstationPortResolver.ts` `buildWorkstationPortResolver` maps a forward's
  `internalIp` to A's one workstation behind NAT (its LAN address, read from A's LEASE on the
  ESSID — never derived, so the public path and the same-LAN path can never disagree about
  where A's box is), materializes it (`materializeWorkstationFs`), and reads
  its open ports — so a forward (mapped to its public port) is shown **iff** the target port is up
  (a fresh ws has an empty `/var/run` → dark until A starts `sshd`). Since 5.1.3c this port reader
  is a thin wrapper over `buildWorkstationResolver` (returning the materialized `Directory | null`),
  the SAME internalIp→ws lookup the forwarded-port login reuses for passwd + liveness — one
  materialization, two readers, never a drift between what a scan shows and what a login checks. The handler parses `rules.v4`
  only to gate the prefetch: a fresh box (no forward) skips the second journal read entirely; the
  `RegistryLookup` projection gained the workstation fields (machine id, essid, identity) for this.
- **Login (Story 5.1.2 — routes by destination port):** `ssh [-p port] <user>@<A's public IP>`
  takes the cross-player branch in `core/commands/ssh.ts` (`executePublicLogin`): reachability
  via `resolvePublic`, then `authenticatePublic` carries the **destination port** (default 22).
  Server-side, `authCreateSessionPublic` (`core/sessions/authCreateSessionPublic.ts`)
  materializes A's **router**, boot-gates it, and consults `machineServing` to resolve the
  destination port to an auth target via one `resolveAuthTarget` (the router and forward arms
  share a single `{ fs, machineId }` → passwd-check → insert tail): a router-own port (`:22`) →
  validate against the router's seeded admin password and land the session on
  **`router_machine_id`**; a **forwarded port (Story 5.1.3c)** → the workstation behind the
  router (below); neither → `404 host_unreachable` (so an unforwarded `-p 2222` is refused before
  any password check — the opt-in default). The registry projection here now carries the
  workstation fields too (`{ owner_key, router_machine_id, essid, workstation_machine_id,
workstation_username, workstation_root_hash }`) — a structural superset of the scan path's
  `WorkstationTarget`. The client never claims a tier.
- **Forwarded-port login (Story 5.1.3c):** when `machineServing` returns a `forward`,
  `resolveAuthTarget` fetches the **workstation** journal (the existing `findPatches` dep, scoped
  to `workstation_machine_id`) and resolves the forward's `internalIp` → A's one workstation via
  the shared `buildWorkstationResolver` (`core/scan/workstationPortResolver.ts`, returning the
  materialized `Directory | null` — the SAME lookup the scan's port resolver wraps). A forward
  that reaches no host, or whose internal port isn't being served (a dark DNAT target — `sshd`
  down, or on a different port), → `404 host_unreachable` before any password check. Otherwise the
  password is validated against the **workstation's** `/etc/passwd` (a weak `guest` account exists)
  and the session lands on **`workstation_machine_id`**. The router's boot/dark gate stays upstream
  on the public IP. Confirmed live end-to-end: B's `ssh guest@<A.publicIp> -p 2222` → `guest@<A's
ws>` → `su root` → reads A's `/etc/passwd` (tier-gated cross-player read).
- **Own-LAN router login (Story 5.1.3a):** A's own `ssh root@<subnet>.1` (the `.1` gateway,
  `kind:'router'`) takes the own-LAN branch of `ssh.ts`, but reachability and the hop's machine id
  come from the router (`buildRouterBaseFs` / `computeRouterId`), not a regenerated sibling.
  `authCreateSession` (`core/sessions/authCreateSession.ts`) branches on `host.kind === 'router'`:
  it builds the router FS from the caller's own (verified) key, validates the seeded admin password
  against its root-only `/etc/passwd`, and lands the session on **`router_machine_id`**. A then
  `nano`-edits `/etc/iptables/rules.v4`, persisting to the shared router journal (§4). B **seeing**
  the forward is shipped (5.1.3b — `resolveTargetPorts`, above); B **using** it (`-p 2222` →
  workstation auth) is shipped too (5.1.3c — forwarded-port login, above).
- **Own-LAN router scan (Story 5.1.4):** A's own `nmap <subnet>.1` (the `.1` gateway, `kind:'router'`)
  resolves the player's REAL router rather than a cosmetic NPC host: `nmap.ts` builds the router FS from
  the own key (`buildRouterBaseFs`) and reads its ports through the single `scanResult({ vantage:'sameLAN' })`
  — the SAME total function the public-IP scan uses at `external`. `sameLAN` returns the router's own ports
  only (its seeded `sshd:22`) and never consults `rules.v4`, so a forward configured for the public side can
  never leak into the LAN-side `.1` view — the dual-homed invariant: one function, two vantages, never a
  merged view (`project_dual_homed_router_scan_discrepancy` closed). Client-only (no api/DB); self and
  sibling hosts still read their own FS via `readOpenPorts`.
- **Guest password:** `workstationGuestPassword(ownerKeyHex)` — a deterministic pick from a
  weak-password list, seeded from the owner's pubkey alone (`core/generation/workstationFs.ts`),
  so the server can recover it for cross-player auth and a future cracker can match it. The
  player's own user has an empty hash (unauthenticatable cross-player — `md5(x)` is never `''`).

## 4. Authorization (server-enforced)

Two layers gate every write/remove (`upsertPatch.ts`, `removePatch.ts`):

- **L1 — session** (`core/patches/authorizeMachineAccess.ts`): the caller's OWN workstation
  (suffix match) bypasses; otherwise an active `sessions` row `(player_key, machine_id)` must
  exist (B's ssh hop), else `403 no_session`.
- **L2 — permission walker** (`core/patches/enforceRemoteWriteL2` in
  `remoteWritePermission.ts`): own-box bypasses (session is null). For a remote target it
  resolves the tree as (0) the caller's **own router** (`isOwnRouter` → `buildRouterBaseFs`,
  Story 5.1.3a — so A's root-tier `/etc/iptables/rules.v4` write walks the real router perms,
  not a workstation tree), else (1) an NPC host on the caller's LAN (`hostForMachineId`), else
  (2) a **registered foreign machine** via `findRegistryByMachineId`, which now returns a
  **discriminated** row (`RegistryMachine = workstation | router`, matching BOTH the
  `workstation_machine_id` and `router_machine_id` columns): a foreign **router** (Story 5.2 —
  B `ssh root`'d into A's router) → `buildRouterBaseFs(owner_key)`, a foreign **workstation** →
  `buildRegisteredWorkstationFs` — both rebuilt from the **owner's** identity (the same builders
  the read path uses, so A's tree can't drift between what A sees and what an attacker is checked
  against), else (3) **fail closed** → `permission_denied`. It then runs the shared walker
  `createFsView(tree, { userType }).canWrite` at the **server session's** tier — so B, holding a
  **root** session on A's router (the appliance is root-only), can rewrite A's `rules.v4`, while a
  non-root / no-session caller is denied.
- **The shared walker** (`core/filesystem/fsView.ts`) is the single FS-permission authority
  for client AND server, so there's no drift. Overwriting a node needs write on the node;
  **creating** a new entry needs write **+ execute on the containing directory** (Unix:
  adding an entry modifies the dir), and a deeper-missing path has no container → denied.
  This closed a real gap where a guest could plant a file in a restricted-but-empty dir.

Story 3's ceiling is **guest** writes (a guest-writable path like `/tmp`). su-to-root and
bricking are Story 4 (they use the obtained root password).

## 5. The read path (3-tier filter)

`core/network/resolveCrossPlayerFs.ts` serves A's filesystem to B. B has neither A's seed nor
A's rows, so the **server** is the only party that can materialize A's box: registry
reverse-lookup → rebuild A's baseline from the owner's identity → replay A's machine-scoped
journal (chronologically) → **prune to the caller's tier** → serialize and ship. Since Story 5.2
the reverse-lookup is **discriminated** (`RegistryMachine = workstation | router`, matching both
id columns), so a `router_machine_id` materializes the **router** base (`materializeRouterFs`)
and a `workstation_machine_id` the workstation base (`materializeWorkstationFs`) — one handler,
one tier filter, the right base. (This is how B `cat`s/`nano`s A's `/etc/iptables/rules.v4` after
`ssh root`ing into A's router.) The tier is server-derived, never a client claim:

- **Tier 1 — owner** (verified pubkey == `owner_key`): the FULL tree; the session table is
  not even consulted.
- **Tier 2 — active session:** pruned by the shared read walker at the session's tier
  (`filterTreeForRead`).
- **Tier 3 — no session:** only the externally-observable allowlist (pidfiles, `/var/www`,
  NAT rules — `filterTreeToAllowlist` / `EXTERNALLY_OBSERVABLE_ALLOWLIST`); everything else
  default-denies.

Pruning happens **before** the response leaves — a path the tier may not read never crosses
the wire, so passwd hashes and non-observable files can't leak. The tree crosses as a
JSON-safe codec (`core/filesystem/treeCodec.ts` `serializeTree`/`deserializeTree`; a `Map`
stringifies to `{}` without it).

## 6. Client integration

- The terminal renders a cross-player hop from the **server-served tree** (`servedRoot` in
  `ui/state.ts`), not the local journal — B can't rebuild A's box locally. Own-box / local-LAN
  hops use the local journal; `refreshServedRoot()` re-pulls after a write so B sees its own
  change, and clears to null (never B's own files) off a cross-player hop.
- **The own router renders from the local journal, not a served tree (Story 5.1.3a):**
  `resolveActiveRoot`/`baseFsFor` (`ui/activeRoot.ts`) has an own-router branch — when the active
  session is on `computeRouterId(ownKey)` it picks `buildRouterBaseFs(ownKey)` and replays the
  router journal locally — and `isCrossPlayerWorkstation` excludes the own router (`isOwnRouter`),
  so it is NOT misread as a cross-player hop (which would fetch a tier-filtered served tree). A
  `nano rules.v4` edit therefore reflects immediately off the journal A wrote (`rebindPatchClient`
  points the patch client's `machineId` at the router).
- **The command pipeline is serial** (`runInput` → `commandChain` in `ui/state.ts`): one
  command runs at a time; a second submit queues behind the first and runs only after it
  fully completes, including its async server refresh. Do **not** reintroduce concurrent
  command execution — it caused a stale-FS-view race (a read issued during a write's refresh
  saw the pre-write tree).

## 7. Root escalation & bricking (Story 4)

With A's root password in hand (player-chosen at A's setup, validated server-side), B can
escalate on A's box and permanently brick it.

- **Cross-player `su` elevation** (`core/sessions/authElevateSession.ts`): B (already ssh'd into A
  as guest) runs `su`; on a foreign hop the client posts a signed `suElevate`. The server resolves
  A by `machine_id` → rebuilds A's box → checks `md5(typed) === workstation_root_hash` → inserts a
  root-tier `kind:'su'` session row. No L1 change: `findActiveSession` returns the top-of-stack
  row, so the su row (latest) makes B's later writes authorize at **root**. The client routes to
  the server ONLY on a cross-player hop (`isCrossPlayerWorkstation`); own-box / NPC `su` stays
  local (its `/etc/passwd` is readable). Routing is in `su.ts` via `env.su.elevate`.
- **The brick = a root `rm` of a `/boot` kernel image.** `/boot/{vmlinuz,initrd.img}` live in the
  shared base FS (`core/generation/baseFs.ts` `bootDir()`), root-owned / root-write. A root
  `rm /boot/vmlinuz` records a `content:null` tombstone on the shared journal; replayed, the file
  is gone. The brick state IS the tombstone — pure-derived, no marker / no schema, cross-player by
  construction, **permanent** (append-only journal; renewal = a new identity only).
- **`canBoot` is the single authority** (`core/boot/bootFiles.ts`): both kernel images present →
  boots; else `{ missing: 'vmlinuz' | 'initrd.img' }` (vmlinuz checked first — GRUB load order →
  the correct panic copy). Pure over an already-resolved tree, so client and server agree.
- **Detection on every app entry:** the boot screen (`ui/screens/boot.tsx`) runs for every
  returning player, resolves the OWN box (base + own journal, **hop-independent** — it checks YOUR
  box, not the remote you're standing on), and consults `canBoot`. Missing → GRUB / kernel-panic,
  **halt, no terminal, no recovery**. `reboot` (`core/commands/reboot.ts`, root-only via the binary
  gate) is the in-game trigger: it forces a cold boot of the current machine (own box via `env.fs`,
  cross-player via the server-served tree) and then disconnects from the rebooted box.
- **A bricked box goes dark to others:** the two public-IP server gates materialize the target and
  ask `canBoot` BEFORE doing their work (same registry-rebuild + journal replay the read path uses).
  Post-5.1.1b/5.1.2 both gates key on the **router** (`core/network/materializeRouterFs.ts`) — it
  is the public face — so bricking the router alone takes the whole public IP dark: `resolvePublicScan`
  → host-down / no ports (even with lingering `/var/run` pidfiles); `authCreateSessionPublic` →
  `404 host_unreachable` before the password is checked, no session inserted. (Cross-player `su`,
  `authElevateSession`, still rebuilds the **workstation** B stands on via `materializeWorkstationFs`.)
  A dead box can't be scanned or logged into no matter the credentials.
- **The dark-gate is role-based, at the workstation level too (Story 5.3):**
  `dark-gate(addr) = canBoot(machineServing(addr))`. The shared `buildWorkstationResolver`
  (`core/scan/workstationPortResolver.ts` — the ONE internal-IP→workstation lookup both the public
  scan and the public ssh gate read) returns `null` when the materialized workstation can't boot, so
  a bricked workstation **behind a NAT forward** drops its forwarded port from `resolvePublicScan`
  and `404`s an `authCreateSessionPublic` to that port — even with a lingering `sshd` pidfile. Because
  the router is gated upstream by its own `canBoot`, **bricking the workstation only removes its
  forwarded ports; the router keeps answering its own.** (One gate site → scan and ssh can't disagree.)

su / brick auth.log traces on the foreign box are a cross-player WRITE — shipped in Story 6 (§8).

## 8. Observability: cross-player traces (Story 6)

Every cross-player scan / login / escalation leaves a truthful, **server-written** trace on the
TARGET's shared record, which the owner (or a 3rd player with a session) reads back — turning the
shipped attack loop into an attacker/defender loop.

- **The keystone (decision 1): a log line is written under `writer_key = owner_key` of the TARGET,
  not the attacker.** `applyPatches` folds **last-write-wins per (machine_id, path, writer_key)**, so
  if each attacker wrote a log under their OWN key the rows would collapse to the last writer's
  content. Writing every line under the target owner's key makes them **accrete into ONE row**; the
  attacker's identity lives in the line **content** (source IP / `by <from>` user), never in
  `writer_key`. This is the one place a cross-player write is keyed to the owner rather than the
  acting player.
- **One shared primitive** — `appendMachineLog(deps, target, line)`
  (`core/patches/appendMachineLog.ts`): best-effort read-modify-write — read the current content at
  `(machine_id, path, writer_key)`, append `${line}\n`, upsert `node_type:'file'`. A failed READ bails
  without writing (never clobbers). **Best-effort throughout**: a logging read/write failure never
  breaks — or fabricates — the underlying scan / auth (each handler wraps the call in try/catch).
- **Source IP is server-derived, never the client `source_ip`** — `resolveCrossPlayerSourceIp`
  (`core/logging/crossPlayerSourceIp.ts`, via `FindRegistryByOwnerKey`) maps the attacker's verified
  pubkey → their HOME public IP. Forging / framing another network is impossible by construction; a
  client-supplied `source_ip` is ignored. It is the attacker's **operating-machine** IP — B's home box
  today (v2 has no command-vantage switch); when the pivot feature ships the operating machine becomes
  the hop and the same path logs the hop's IP, masking B — no logging rework. (su lines carry **no**
  source IP — they are username-only.)
- **The three cross-player handlers + the own-LAN fix:**
  - **Scan** (`resolvePublicScan`, 6.1): after a host-up resolve, one `formatNmapScanAggregate`
    `kern.log` line on the **router** record (`router_machine_id`), hostname =
    `seedRouterHostname(owner_key)`, source = the attacker's home IP. `found:false` (unknown / dark /
    bricked) writes nothing.
  - **Connection** (`authCreateSessionPublic`, 6.2): one `formatSshdAuthLine` `auth.log` line on
    **both** outcomes (`Accepted` / `Failed password …`), on the resolved target — **router** for `:22`,
    **workstation** for a forwarded `:2222` (hostname = seeded router name / `workstation_machine_name`).
    A `404 host_unreachable` (unforwarded / dark / bricked, before any password) writes nothing.
  - **su** (`authElevateSession`, 6.3): one `formatSuAuthLine` `auth.log` line on **both** outcomes
    (`Successful` / `FAILED su for root by <from>`) on the **workstation** record; `from_user` is carried
    in the payload (B's current ws user, e.g. `guest`) so the line reads truthfully; no source IP.
  - **Own-LAN `.1`** (`handleNmapScan` `logHostScan`, 6.4): the `.1` gateway's `kern.log` line — its
    **machine id AND its port list** — routes through the router (`computeRouterId(caller)` +
    `buildRouterBaseFs(caller)`), not the dead-end coordinate path (`hostMachineId` +
    `buildRemoteHostFs`). So a player scanning their own router reads the trace via `ssh root@.1` with
    the router's **real** ports (was a dead-end record nobody read, listing "ports none"). NPC siblings
    keep the coordinate path; self is skipped; writer stays the caller (= owner on this own-LAN path,
    still owner-keyed). Mirrors `ssh.ts`'s own-router branch.
- **Decision 8 — log ALL port probes, not just `nmap`.** A cross-player `ssh` reuses
  `resolvePublicScan` for its reachability check, so it ALSO writes a `kern.log` scan line: a
  cross-player ssh attempt leaves **both** a `kern.log` scan line and the `auth.log` line — the server
  can't distinguish "honest ssh" from "probing via the ssh path", so suppressing it would reopen a
  stealth-recon hole. Defense-in-depth, not a bug.
- **Tier & tamper.** Logs are tier-2 readable, tier-3 hidden (a no-session scanner can't read them);
  a dark / bricked target logs nothing (the dark-gate runs first); root can clear logs — no
  tamper-resistance (decision 7), no separate brick-event trace (decision 5).
- **Formatters / paths:** `core/logging/kernLog.ts` (`formatNmapScanAggregate`, `KERN_LOG_*`),
  `core/logging/authLog.ts` (`formatSshdAuthLine`, `formatSuAuthLine`, `AUTH_LOG_*`).

## Invariants (the load-bearing rules)

- `writer_key` / identity is **always** the server-verified pubkey, never a client claim.
- Replay ordering is the **server** `updated_at` (trigger-stamped), never client-supplied.
- The **wire is the threat surface** — prune/authorize server-side before the response leaves.
- `machine_id` MUST go through `computeWorkstationId` (the `ed25519:` prefix is load-bearing).
- The FS-permission walker (`fsView.ts`) is **shared** client+server — no second implementation.
- Cross-player materialization rebuilds from the **owner's** identity (one
  `buildWorkstationBaseFsFromIdentity`), so read and write check the same tree.
- Root passwords travel as an md5 hash, never plaintext. Passwords live inline in
  `/etc/passwd`; there is no `/etc/shadow` in this game.
- Deletes are tombstones, not hard deletes (chronological correctness on a shared journal).
- The terminal runs commands serially.
- `canBoot` over the replayed tree is the single brick authority, shared client + server.
- A bricked box (a `/boot` tombstone) is unreachable: scan host-down + public ssh `404`, gated
  before any port read or password check — independent of credentials or lingering pidfiles.
- Cross-player log lines are written under the **target owner's** `writer_key` (the system owns its
  logs, so attackers' lines accrete into one row); the attacker's identity lives in the line content
  (source IP / `by <from>` user), never in `writer_key`. Server-derived source IP only.

## Status & roadmap

Shipped: **Story 1** (public-IP discovery), **Story 2** (cross-player read + 3-tier filter),
**Story 3** (cross-player write: shared-journal PK flip, L2 owner-materialized branch, write
boundary, tombstone-always `rm`), **Story 4** (su-to-root via the obtained password → permanent
`/boot` brick → bricked box dark to others). Live loop: `crack → connect → nmap <public IP> → ssh
guest@<public IP> → su root → rm /boot/vmlinuz → reboot`, after which A is bricked and drops off
scans / refuses logins for everyone.

**Story 5.1** (router as a real machine + player-controlled NAT) is ✅ **COMPLETE**: `nano` (5.0), the
router as a real journal-backed machine + public-IP scan/login routed through it (5.1.1a/b, 5.1.2),
A's own-LAN `ssh root@.1` + `nano /etc/iptables/rules.v4` persisting to the shared router journal
(5.1.3a), B's scan reflecting A's forward (5.1.3b — `resolveTargetPorts` wired + liveness-gated), B's
`-p 2222` → **workstation** auth (5.1.3c — forward→ws via `resolveAuthTarget` + the shared
`buildWorkstationResolver`), and A's own-LAN `nmap <subnet>.1` resolving the real router via
`scanResult` sameLAN (5.1.4 — `.1` no longer cosmetic; forwards excluded LAN-side, closing the
dual-homed scar). The full decision-8 cross-player loop is confirmed live (agent-browser vs
`vercel dev`+Supabase: B cross-network `nmap` → `:22`+`:2222`, `ssh guest -p 2222` → A's ws, `su root`
→ A's `/etc/passwd`).

**Story 5.2** (B attacks A's router — cross-player router takeover) is ✅ **COMPLETE**: the
cross-player READ + WRITE paths are now router-aware. The server reverse-lookup is **discriminated**
(`RegistryMachine = workstation | router`, matching both id columns), so B (root-session'd on A's
router via the shipped `ssh root@<A.publicIp>`) reads A's router tree (`resolveCrossPlayerFs` →
`materializeRouterFs`) and the L2 walker rebuilds A's router from `buildRouterBaseFs(owner_key)` —
letting B `nano`-rewrite A's `/etc/iptables/rules.v4`, persisted to A's shared router journal, so
A's public scan reflects the change. The full loop is confirmed live (agent-browser vs `vercel dev`

- Supabase, and `scripts/testCrossPlayerRouter.ts` 8/8): B `ssh root@<A.publicIp>` → `cat rules.v4`
  → `nano` add `forward 2222 to <A.ws>:22` → `nmap <A.publicIp>` goes `[22]` → `[22, 2222]` (B exposed
  A's workstation). No new mechanism for su (the router is root-only — B logs in as root directly).

**Story 5.3** (router brick → whole public IP dark) is ✅ **COMPLETE**, finishing the Story-5
cross-player home-NAT arc. The router-brick → whole-IP-dark path was already shipped (both public
gates `canBoot`-gate the router); 5.3 verified it end-to-end **and** generalized the dark-gate to the
**workstation behind the NAT**: the shared `buildWorkstationResolver` now returns `null` for a bricked
workstation, so its forwarded port drops from the scan and `404`s ssh-via-forward, while the router
keeps answering its own — `dark-gate(addr) = canBoot(machineServing(addr))` realised at both roles
(decision #10). Confirmed live (agent-browser vs `vercel dev`+Supabase: B cross-network bricks A's
router → `nmap <A.publicIp>` "Host seems down", `ssh` "No route to host"; and
`scripts/testRouterBrick.ts` 9/9, both brick directions).

**Story 6** (cross-player scan / connection / su trace on the shared record) is ✅ **COMPLETE** (§8).
The three cross-player handlers (`resolvePublicScan`, `authCreateSessionPublic`, `authElevateSession`)
and the own-LAN `.1` scan now leave owner-keyed `kern.log` / `auth.log` traces via the shared
`appendMachineLog` primitive, with server-derived source IPs — so the shipped attack loop is now an
observable attacker/defender loop. Confirmed live (agent-browser + per-slice wire-checks
`scripts/testCrossPlayer{Scan,Connection,Su}Trace.ts`). Decision 8: a cross-player ssh leaves both a
scan and an auth trace (no silent recon).

Next: **Story 7** (same-wifi shared-LAN occupancy). Deferred: **5b** (multi-layer generated target
networks), the **pivot / operate-from-a-hop** vantage (its own story — the source-IP derivation is
already shaped for it). See `plans/multiplayer-crossplayer-epic.md`.

**Known accepted gap (deferred to an L3 smart-server):** a client with a valid keypair can
mint an `effect_one_shot`/root session via `createSession` and call the read/reset effects
directly, skipping the in-game CVE flow. Accepted per the ship-first security stance; real
mitigation is a server-side game-logic re-run.

## Key files

| Concern                | File                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Shared-journal replay  | `core/patches/orderPatchesForReplay.ts`                                            |
| Write handler          | `core/patches/upsertPatch.ts`                                                      |
| Remove (tombstone)     | `core/patches/removePatch.ts`                                                      |
| L1 session gate        | `core/patches/authorizeMachineAccess.ts`                                           |
| L2 walker + registry   | `core/patches/remoteWritePermission.ts`                                            |
| Read filter (3-tier)   | `core/patches/readFilter.ts`                                                       |
| Cross-player read      | `core/network/resolveCrossPlayerFs.ts`                                             |
| Shared materialize     | `core/network/materializeWorkstationFs.ts`                                         |
| Registry write         | `core/network/registerNetwork.ts`                                                  |
| Public scan resolve    | `core/scan/resolvePublicScan.ts`                                                   |
| Forward→ws resolve     | `core/scan/workstationPortResolver.ts` (`buildWorkstationResolver` + port wrapper) |
| su elevation (server)  | `core/sessions/authElevateSession.ts`                                              |
| Public ssh gate        | `core/sessions/authCreateSessionPublic.ts`                                         |
| Trace append primitive | `core/patches/appendMachineLog.ts`                                                 |
| Cross-player source IP | `core/logging/crossPlayerSourceIp.ts` (`resolveCrossPlayerSourceIp`)               |
| kern.log / auth.log    | `core/logging/kernLog.ts`, `core/logging/authLog.ts`                               |
| Own-LAN scan log       | `core/scan/nmapScan.ts` (`logHostScan`, router branch)                             |
| Brick authority        | `core/boot/bootFiles.ts` (`canBoot`)                                               |
| reboot (cold boot)     | `core/commands/reboot.ts`                                                          |
| Shared FS walker       | `core/filesystem/fsView.ts`                                                        |
| Journal fold           | `core/filesystem/applyPatches.ts`                                                  |
| Wire codec             | `core/filesystem/treeCodec.ts`                                                     |
| Owner FS generator     | `core/generation/workstationFs.ts`                                                 |
| Machine id derivation  | `core/identity/workstation.ts`                                                     |
| Router id + own-router | `core/identity/router.ts` (`computeRouterId`, `isOwnRouter`)                       |
| Router FS composer     | `core/generation/routerFs.ts` (`buildRouterBaseFs`)                                |
| Router materialize     | `core/network/materializeRouterFs.ts`                                              |
| Own-LAN ssh auth       | `core/sessions/authCreateSession.ts` (router branch)                               |
| ssh (cross + own LAN)  | `core/commands/ssh.ts`                                                             |
| Client active root     | `ui/activeRoot.ts` (own / own-router / remote base + replay)                       |
| Client served tree     | `ui/state.ts` (`servedRoot`, `refreshServedRoot`, `commandChain`)                  |
| API surface            | `api/patches.ts`, `api/network.ts`, `api/sessions.ts`                              |
