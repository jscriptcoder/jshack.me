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
  `public_ip`): `owner_key`, `workstation_machine_id` (indexed), `router_machine_id`,
  `forward_table` (JSONB), `essid`, `workstation_username`, `workstation_machine_name`,
  `workstation_root_hash` (`core/network/registerNetwork.ts`, migration
  `20260613000000_network_registry.sql`).
- **NAT is degenerate today** — stored as a value: `router_machine_id = workstation`,
  `forward_table = [{ publicPort: '*', → workstation }]`. Real selective iptables is Story 5,
  which swaps the value, not the shape.

## 3. Reachability & cross-player login

- **Scan:** `nmap <A's public IP>` from B routes to a signed `resolvePublicScan`
  (`core/scan/resolvePublicScan.ts`). The server reverse-looks-up the registry and returns
  A's **real open ports**, read from A's owner-scoped `/var/run/*.pid` rows
  (`core/services/pidfile.ts` `readOpenPortsFromPidfiles`). A service is "open" only if its
  pidfile exists — e.g. `sshd` must be running (`sshd` drops `/var/run/sshd.pid`).
- **Login:** `ssh <user>@<A's public IP>` takes the cross-player branch in
  `core/commands/ssh.ts` (`executePublicLogin`): reachability via `resolvePublic`, password
  via `authenticatePublic` (the server regenerates A's `/etc/passwd` and validates), landing
  a session on A's **real `workstation_machine_id`** at the server-derived `userType`. The
  client never claims a tier.
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
  resolves the tree as (1) an NPC host on the caller's LAN (`hostForMachineId`), else (2) a
  **registered foreign workstation** via `findRegistryByMachineId` →
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
- **The command pipeline is serial** (`runInput` → `commandChain` in `ui/state.ts`): one
  command runs at a time; a second submit queues behind the first and runs only after it
  fully completes, including its async server refresh. Do **not** reintroduce concurrent
  command execution — it caused a stale-FS-view race (a read issued during a write's refresh
  saw the pre-write tree).

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

## Status & roadmap

Shipped: **Story 1** (public-IP discovery), **Story 2** (cross-player read + 3-tier filter),
**Story 3** (cross-player write: shared-journal PK flip, L2 owner-materialized branch, write
boundary, tombstone-always `rm`). Live loop: `crack → connect → nmap <public IP> → ssh
guest@<public IP> → ls/cat/create/edit/rm`.

Next: **Story 4** (su-to-root via the obtained password → brick), **Story 5** (real iptables
NAT / multi-layer), **Story 6** (cross-player scan/connection trace on the shared record),
**Story 7** (same-wifi shared-LAN occupancy). See `plans/multiplayer-crossplayer-epic.md`.

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
| Registry write        | `core/network/registerNetwork.ts`                                 |
| Public scan resolve   | `core/scan/resolvePublicScan.ts`                                  |
| Shared FS walker      | `core/filesystem/fsView.ts`                                       |
| Journal fold          | `core/filesystem/applyPatches.ts`                                 |
| Wire codec            | `core/filesystem/treeCodec.ts`                                    |
| Owner FS generator    | `core/generation/workstationFs.ts`                                |
| Machine id derivation | `core/identity/workstation.ts`                                    |
| ssh (cross-player)    | `core/commands/ssh.ts`                                            |
| Client served tree    | `ui/state.ts` (`servedRoot`, `refreshServedRoot`, `commandChain`) |
| API surface           | `api/patches.ts`, `api/network.ts`                                |
