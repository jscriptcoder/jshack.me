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

- **Scan (Story 5.1.1b):** `nmap <A's public IP>` from B routes to a signed `resolvePublicScan`
  (`core/scan/resolvePublicScan.ts`). The server resolves the public IP to A's **router**
  (`router_machine_id`), materializes it (seeded base + journal replay —
  `core/network/materializeRouterFs.ts`), checks `canBoot` (a bricked router takes the whole
  IP dark), and returns its open ports via `scanResult` (external vantage): the router's own
  seeded `sshd:22` plus any live forwards. The workstation is dark behind NAT until A opts a
  forward in (Story 5.1.3).
- **Login (Story 5.1.2 — routes by destination port):** `ssh [-p port] <user>@<A's public IP>`
  takes the cross-player branch in `core/commands/ssh.ts` (`executePublicLogin`): reachability
  via `resolvePublic`, then `authenticatePublic` carries the **destination port** (default 22).
  Server-side, `authCreateSessionPublic` (`core/sessions/authCreateSessionPublic.ts`)
  materializes A's **router**, boot-gates it, and consults `machineServing`: a router-own port
  (`:22`) → validate against the router's seeded admin password and land the session on
  **`router_machine_id`**; a forwarded port → the internal host (Story 5.1.3); neither →
  `404 host_unreachable` (so an unforwarded `-p 2222` is refused before any password check —
  the opt-in default). The registry projection here is the minimal `{ owner_key,
  router_machine_id, essid }`; the workstation-fields projection (`RegistryWorkstation`) now
  lives with its sole consumer, `authElevateSession.ts`. The client never claims a tier.
- **Own-LAN router login (Story 5.1.3a):** A's own `ssh root@<subnet>.1` (the `.1` gateway,
  `kind:'router'`) takes the own-LAN branch of `ssh.ts`, but reachability and the hop's machine id
  come from the router (`buildRouterBaseFs` / `computeRouterId`), not a regenerated sibling.
  `authCreateSession` (`core/sessions/authCreateSession.ts`) branches on `host.kind === 'router'`:
  it builds the router FS from the caller's own (verified) key, validates the seeded admin password
  against its root-only `/etc/passwd`, and lands the session on **`router_machine_id`**. A then
  `nano`-edits `/etc/iptables/rules.v4`, persisting to the shared router journal (§4). B seeing
  (`resolveTargetPorts`) and using (`-p 2222` → workstation) the forward is 5.1.3b/c.
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
  (2) a **registered foreign workstation** via `findRegistryByMachineId` →
  `buildRegisteredWorkstationFs` (rebuilt from the **owner's** identity — the same
  `buildWorkstationBaseFsFromIdentity` the read path uses, so A's tree can't drift between
  what A sees and what an attacker is checked against), else (3) **fail closed** →
  `permission_denied`. It then runs the shared walker `createFsView(tree, { userType }).canWrite`
  at the **server session's** tier.
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
journal (chronologically) → **prune to the caller's tier** → serialize and ship. The tier is
server-derived, never a client claim:

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

su / brick auth.log traces on the foreign box are a cross-player WRITE, deferred to Story 6.

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

## Status & roadmap

Shipped: **Story 1** (public-IP discovery), **Story 2** (cross-player read + 3-tier filter),
**Story 3** (cross-player write: shared-journal PK flip, L2 owner-materialized branch, write
boundary, tombstone-always `rm`), **Story 4** (su-to-root via the obtained password → permanent
`/boot` brick → bricked box dark to others). Live loop: `crack → connect → nmap <public IP> → ssh
guest@<public IP> → su root → rm /boot/vmlinuz → reboot`, after which A is bricked and drops off
scans / refuses logins for everyone.

**Story 5** (cross-player home NAT) in flight: `nano` (5.0), the router as a real journal-backed
machine + public-IP scan/login routed through it (5.1.1a/b, 5.1.2), and A's own-LAN `ssh root@.1`
+ `nano /etc/iptables/rules.v4` persisting to the shared router journal (5.1.3a) are shipped. Next:
**5.1.3b** (B's scan reflects the forward — wire `resolveTargetPorts`), **5.1.3c** (B's `-p 2222` →
workstation + restored loop E2E), then **5.1.4** (dual-homed `.1` sameLAN view). Then **Story 6**
(cross-player scan/connection + su/brick auth.log trace on the shared record), **Story 7**
(same-wifi shared-LAN occupancy). See `plans/multiplayer-crossplayer-epic.md`.

**Known accepted gap (deferred to an L3 smart-server):** a client with a valid keypair can
mint an `effect_one_shot`/root session via `createSession` and call the read/reset effects
directly, skipping the in-game CVE flow. Accepted per the ship-first security stance; real
mitigation is a server-side game-logic re-run.

## Key files

| Concern               | File                                                              |
| --------------------- | ----------------------------------------------------------------- |
| Shared-journal replay | `core/patches/orderPatchesForReplay.ts`                           |
| Write handler         | `core/patches/upsertPatch.ts`                                     |
| Remove (tombstone)    | `core/patches/removePatch.ts`                                     |
| L1 session gate       | `core/patches/authorizeMachineAccess.ts`                          |
| L2 walker + registry  | `core/patches/remoteWritePermission.ts`                           |
| Read filter (3-tier)  | `core/patches/readFilter.ts`                                      |
| Cross-player read     | `core/network/resolveCrossPlayerFs.ts`                            |
| Shared materialize    | `core/network/materializeWorkstationFs.ts`                        |
| Registry write        | `core/network/registerNetwork.ts`                                 |
| Public scan resolve   | `core/scan/resolvePublicScan.ts`                                  |
| su elevation (server) | `core/sessions/authElevateSession.ts`                             |
| Public ssh gate       | `core/sessions/authCreateSessionPublic.ts`                        |
| Brick authority       | `core/boot/bootFiles.ts` (`canBoot`)                              |
| reboot (cold boot)    | `core/commands/reboot.ts`                                         |
| Shared FS walker      | `core/filesystem/fsView.ts`                                       |
| Journal fold          | `core/filesystem/applyPatches.ts`                                 |
| Wire codec            | `core/filesystem/treeCodec.ts`                                    |
| Owner FS generator    | `core/generation/workstationFs.ts`                                |
| Machine id derivation | `core/identity/workstation.ts`                                    |
| Router id + own-router | `core/identity/router.ts` (`computeRouterId`, `isOwnRouter`)     |
| Router FS composer    | `core/generation/routerFs.ts` (`buildRouterBaseFs`)               |
| Router materialize    | `core/network/materializeRouterFs.ts`                             |
| Own-LAN ssh auth      | `core/sessions/authCreateSession.ts` (router branch)             |
| ssh (cross + own LAN) | `core/commands/ssh.ts`                                            |
| Client active root    | `ui/activeRoot.ts` (own / own-router / remote base + replay)      |
| Client served tree    | `ui/state.ts` (`servedRoot`, `refreshServedRoot`, `commandChain`) |
| API surface           | `api/patches.ts`, `api/network.ts`, `api/sessions.ts`             |
