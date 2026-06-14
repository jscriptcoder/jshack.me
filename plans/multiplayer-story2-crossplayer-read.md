# Plan: Story 2 — B reads A's filesystem over the public path (cross-player READ)

**Branch**: feat/v2-crossplayer-read (per-slice branches below)
**Status**: Active
**Parent epic**: `plans/multiplayer-crossplayer-epic.md` (Story 2 row)
**Authored**: 2026-06-14 (via `planning`, after grounding the v2 read path)

## Goal

A second identity (B) who holds credentials can `ssh guest@<A.publicIp>`, land on A's
**real, server-persisted** workstation record, and `ls`/`cat` the **actual files A created** —
filtered server-side by the 3-tier read rule (owner / active-session + permission-walker /
no-session + allowlist). No `patches` PK flip (that is Story 3 — first cross-player WRITE).

## The grounded architecture (why this is more than "port the read filter")

The epic assumed Story 2 mostly reuses the shipped stack. Grounding the code surfaced three hard
facts that reshape it:

1. **`ssh` is LAN-only today** (`core/commands/ssh.ts:91`) — it resolves the target from B's own
   `generateHomeLan(B.pubkey, essid)`. A public IP is unreachable. We add public-IP routing,
   exactly parallel to Story 1's `nmap` public-IP path (`isPublicIp` from `core/generation/ip.ts`).
2. **The remote FS is reconstructed CLIENT-side** (`ui/activeRoot.ts`): base tree from
   `buildRemoteHostFs(B.pubkey, essid, host)` (or B's own workstation) + `applyPatches(base, B's
patches)`. For A's workstation this cannot work for B — the base is
   `buildWorkstationBaseFs('workstation-'+A.pubkey, A.config)` and `listPatches` is scoped to the
   caller's `player_key`. **B has neither A's seed nor A's rows → A's filesystem must be SERVER-served.**
3. **🔑 The server can't reconstruct A's box either, yet.** `buildWorkstationBaseFs` needs A's
   **`GameConfig`** (`username`, `machineName`, `rootPassword`), which lives ONLY in A's browser
   localStorage (`core/gameConfig/gameConfig.ts:113`). The registry has `owner_key`/`essid`/
   `workstation_machine_id` but not the config. (A's `guest` password is pubkey-seeded, so the
   server CAN recompute it from `owner_key` — only the player-chosen `username`/`machineName`/
   `rootPassword` are missing.) → **Story 2 must persist A's workstation identity at join.**

## Key design decisions (LOCKED — owner-confirmed 2026-06-14)

- **D1 — A's filesystem is SERVER-served for cross-player hops.** B cannot regenerate A's box
  (A-pubkey + A-private-config seeded). The server regenerates A's baseline + applies A's
  owner-scoped patches + runs the read filter, and returns the **materialized, filtered Directory
  tree** to B. (Not "filtered patch rows" — B has no baseline to replay them over. This is forced,
  not a preference.)
- **D2 — Persist A's `GameConfig` at join** (chosen over an FS projection or a bespoke passwd-only
  store). Extend the join/register round-trip + `network_registry` row to carry
  `workstation_username`, `workstation_machine_name`, and `workstation_root_hash` (= `md5(rootPassword)`,
  **never plaintext**). The server then calls one shared generator to rebuild A's baseline. Minimal
  (3 fields), faithful to the regenerate-in-`core/` model.
- **D3 — B authenticates as `guest`** (not root). guest's password is A-pubkey-seeded
  (`createPrng('workstation-'+ownerKey).pick(GUEST_PASSWORDS)`) — dev-recoverable from the known
  weak-password pool, like NPC hosts. Non-root → exercises the read-permission walker at a real
  non-owner tier (can't read `/root`; can read world-readable + traverse). root/brick stays Story 4.
- **D4 — Walking skeleton splits login-first / read-second.** 2b = get a session on A's REAL record
  (FS read deferred); 2c = server-materialized read so `ls`/`cat` show A's real files. Mirrors
  Story 1's 1a/1b cadence.
- **D5 — No `patches` PK flip.** Stories 1–2 only READ the owner's existing per-viewer rows via the
  registry's `owner_key` (Story 1b's pattern). The flip rides Story 3's first cross-player WRITE.
- **D6 — One generator, no client/server drift** (framework-agnostic `core/` boundary). Factor a
  pure `buildWorkstationBaseFsFromIdentity({ ownerKey, username, machineName, rootPasswordHash })`
  that BOTH the client (own box: hashes plaintext rootPassword, delegates) and the server
  (cross-player: already has the hash) call. The existing `buildWorkstationBaseFs(pubkey, config)`
  becomes the thin client wrapper. guest password derives from `ownerKey` inside the shared fn.

## Reachability model (per-public-IP, degenerate NAT — unchanged from Story 1)

A and B are on **different** networks; B scans/sshes A's public IP from outside. A's public IP
uniquely identifies A's network → A's single registered workstation (degenerate NAT). Same-wifi
shared public IP (multiple workstations behind one IP) is **Story 7**; multi-machine behind real
NAT is **Story 5**. So Story 2 keeps the `network_registry` PK = `public_ip` (one workstation per
public IP) — no registry-shape change beyond D2's added columns.

## Acceptance Criteria

- [ ] Joining a network persists A's workstation identity (`username`/`machineName`/`root-hash`)
      server-side; the wire payload never contains a plaintext root password.
- [ ] B `ssh guest@<A.publicIp>` with the correct guest password lands a session whose
      `machineId` is A's **real** `workstation_machine_id` (not a coordinate-derived id); the prompt
      reflects A's hostname. Wrong password → `Permission denied`. A's box must be running `sshd`
      (open ssh port) for the connection to be accepted (else `Connection refused`).
- [ ] After login, B `cat`s a file **A created** (a real persisted patch on A's box) and sees A's
      content — not a per-viewer regeneration and not B's own box.
- [ ] The read is filtered by tier: a `guest`-session caller cannot read `/root/*` or other
      non-guest-readable paths (read-permission walker); a **no-session** caller sees only the
      externally-observable allowlist; the **owner** (A) reads its own box completely and unchanged.
- [ ] A operating its own workstation is byte-for-byte unchanged (no regression in the own-box path).
- [ ] Every new pure unit at 100% mutation; cross-identity behavior proven end-to-end via
      **agent-browser** + a scripted two-identity wire check (v2 has no Playwright).

## Slices

Every slice runs the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle. Before code on any slice,
load `tdd`, `testing`, `mutation-testing`, `refactoring`. Read `.claude/CLAUDE.md` + the v2 gotchas
(lint is the format gate; `api/*` not typechecked locally — keep it thin, logic in `core/`; don't
run Stryker with the dev server up). Squash-merge per slice; bump version on feature slices.

---

### Slice 2a: Join persists A's workstation identity server-side (enabler)

**Value**: The server gains the inputs (A's `username`/`machineName`/`root-hash`) it needs to
reconstruct A's box for any cross-player reader. Unblocks 2b's auth and 2c's read. Independently
verifiable at the wire (the registry row carries the fields), so it is a legitimate small enabler,
not a hidden schema-only story.
**Path**: `env.homeNetwork.join` round-trip (client) → `registerNetwork` envelope gains
`username`/`machine_name`/`root_hash` (client computes `md5(rootPassword)` — plaintext never
leaves the browser) → `handleRegisterNetwork` persists them → `network_registry` row (migration
adds 3 columns) → observable via a signed read/wire dump.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): joining persists `workstation_username`,
`workstation_machine_name`, `workstation_root_hash` to the registry row; the register schema
accepts them but still refuses a client-supplied `player_key`/`public_ip`/`owner_key`; the root
value persisted is the **hash**, and no plaintext root password appears anywhere in the request
payload or the row.
**RED**: extend `registerNetwork.test.ts` — `handleRegisterNetwork` writes a row whose
`workstation_username`/`workstation_machine_name`/`workstation_root_hash` equal the (verified)
payload fields; a payload omitting them is rejected/defaulted per decision; a smuggled
`owner_key`/plaintext-password field is refused. Add a `gameConfig`/identity test that the client
join helper sends `md5(rootPassword)`, never the plaintext (mutator focus: the hashing step, the
field-passthrough, the refine).
**GREEN**: migration `…_workstation_identity.sql` adds the 3 nullable TEXT columns; extend
`NetworkRegistryRow` + `registerNetworkSchema` + the upsert; client join helper hashes + attaches
the fields.
**MUTATE**: Stryker on `registerNetwork.ts` + the client hashing helper.
**KILL MUTANTS**: boundary/passthrough/refine survivors.
**REFACTOR**: if the row-build grows, extract a small `toRegistryRow` mapper. Assess only.
**Done when**: ACs met, 100% mutation on new pure code, wire dump shows the fields (no plaintext),
human approves commit.

---

### Slice 2b: B logs into A's box over the public IP (session on A's REAL record)

**Value**: First cross-player REACH + AUTH — B gets a real session on A's actual workstation
record, the foundation every later read/write/brick stands on.
**Path**: `ssh guest@<A.publicIp>` → client detects a public-IP target (`isPublicIp`) → routes to
a new cross-player login round-trip → server resolves the registry by `public_ip`
(`owner_key` + persisted config + A's `sshd` pidfile), regenerates A's `/etc/passwd` via the shared
generator (D6), validates the guest password, and (reusing `createSession`) writes a `sessions`
row for `(B.player_key, A.workstation_machine_id)` → client `pushSession` with
`machineId = A.workstation_machine_id` + prompt shows A's `machineName`. **FS browse intentionally
deferred** (2c) — after login `ls`/`cat` is not yet wired to A's box (acknowledged intermediate;
the observable here is the authenticated session, prompt, and server session row, not file content).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): `ssh guest@<A.publicIp>` + correct guest password →
exit 0, session pushed with `machineId === A.workstation_machine_id`, prompt reflects A's hostname,
and a server `sessions` row exists for `(B, A.workstation_machine_id)`; wrong password →
`Permission denied (password).`, no session; A's box not running `sshd` → `Connection refused`;
an unregistered public IP → `No route to host`/`Connection refused` (match Story 1b's down shape);
the client never claims a tier (userType comes back server-derived); the guest password is validated
against A's REAL regenerated passwd (prove with a non-default value — e.g. A's seed yields a
specific pool entry — so it can't be a hardcoded accept).
**RED**: pure handler test for the cross-player login resolver (`core/...resolveCrossPlayerLogin`):
registered IP + correct guest hash → `{ ok, userType:'guest', machineId, machineName }`; wrong
hash → `invalid_credentials`; unregistered IP → `host_unreachable`; smuggled `player_key` refused;
no sshd pidfile → refused/`Connection refused`. `ssh.ts` test: public-IP target routes to the new
seam (not `generateHomeLan`); maps results to the right CLI lines; pushes a session carrying A's
real `machine_id`.
**GREEN**: `core/network/resolveCrossPlayerLogin.ts` (registry lookup → shared-generator passwd
rebuild → guest validate → session-create wiring); `api/network.ts` action; `adapters` + `env.ssh`
public path; `ssh.ts` public-IP branch; prompt uses returned `machineName`.
**MUTATE**: Stryker on the resolver + `ssh.ts` public branch.
**KILL MUTANTS**: auth equality, error-shape, machine_id passthrough survivors.
**REFACTOR**: share reachability (registry + sshd pidfile) with Story 1b's `resolvePublicScan`
if a clean common helper emerges (assess; don't force).
**Done when**: ACs met, 100% mutation on new pure code, agent-browser two-identity login proven,
human approves commit.

---

### Slice 2c: B reads A's REAL files through the server-materialized 3-tier filter (tier 2)

**Value**: The headline cross-player READ — B sees A's actual persisted files, permission-filtered
at B's (guest) tier. This is the security-load-bearing core of Story 2.
**Path**: B (active session on A's box from 2b) browses → client detects a cross-player hop (the
session's `machineId` is not resolvable on the local LAN / is flagged server-served) → fetches A's
FS from a new signed read action → server resolves `owner_key` + config (registry by
`workstation_machine_id`), regenerates A's baseline (shared generator, D6) + `applyPatches(A's
owner-scoped patch rows)` → applies the **read filter** at the caller's tier (active session →
permission-walker `canRead` + parent-traverse at `session.userType`) → returns the **materialized,
pruned Directory tree** → client renders it via `env.fs` (`ls`/`cat`).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): B `cat`s a file A created (a real patch on A's box)
and sees A's content; B (guest) cannot read `/root/*` or a non-guest-readable path (pruned from the
returned tree); the returned tree equals `buildWorkstationBaseFsFromIdentity(A) + A's patches`
filtered at guest tier (no extra paths, no missing readable paths); the wire body never contains a
path the tier forbids (the wire IS the threat surface — filter server-side, not in the UI).
**RED**: pure read-filter test over a tree (port legacy `readFilter`/allowlist semantics, memory
`project_read_path_privacy_gap`): given A's tree + an active guest session, world-readable +
traversable paths survive, `/root/*` and non-readable paths are dropped; cross-player resolve
handler test: registered machine_id + active session → A's filtered tree incl. an A-created file;
the response carries no forbidden path. Mutator focus: the per-node `canRead` decision, parent
`x`-traverse, the keep/drop branch, owner-scoping of the patch read (`player_key = owner_key`).
**GREEN**: `core/patches/readFilter.ts` (tree-walking `canRead` + traverse; verify/extend
`core/filesystem/walker.ts` for a read mode if absent); `core/...resolveCrossPlayerFs.ts`
(registry reverse-lookup → regen → applyPatches → filter → serialize tree); `api/network.ts`
(owner-scoped `/` patch read, like 1b's `findRunFiles` but full-tree); adapter + client wiring in
`activeRoot.ts`/`ui/state.ts` to use the server tree for a cross-player hop.
**MUTATE**: Stryker on `readFilter.ts` + the resolve handler.
**KILL MUTANTS**: walker boundary (r-bit, traverse), keep/drop, owner-scope survivors.
**REFACTOR**: if `readFilter` and L2's `canWrite` share traversal, unify in the walker (assess).
**Done when**: ACs met, 100% mutation, agent-browser shows B `cat`ing an A-created file + `/root`
denied, scripted wire check confirms no forbidden path leaks, human approves commit.

---

### Slice 2d: No-session allowlist (tier 3) + owner (tier 1) — complete the 3-tier filter

**Value**: Closes the filter's other two tiers so the cross-player read boundary is whole and
matches the legacy model; protects A's secrets from un-authenticated readers.
**Path**: same read action as 2c, exercised by callers in the other two tiers — a caller with **no
session** on A's box (resolved the IP but never logged in) gets only the externally-observable
allowlist (`/var/run/*.pid`, `/var/www/**`, `/etc/iptables/rules.v4`, `/var/lib/dpkg/status`, …);
the **owner** (A) reads its own box completely.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): a no-session caller's returned tree contains ONLY
allowlist paths (default-deny everything else, incl. `/etc/passwd`, `/root`, home dotfiles);
the owner path returns the full tree (tier-1 bypass); A's own-box browsing is unchanged
(regression guard); the allowlist is pinned by an exact test (tripwire-commented for future
off-port CVEs, per the legacy memo).
**RED**: read-filter tests for tier 3 (allowlist glob matcher: `*` segment-bound, `**` recursive;
non-allowlist dropped) and tier 1 (owner → unfiltered); an own-box regression test asserting the
local path is untouched.
**GREEN**: add the allowlist + matcher to `readFilter.ts`; tier dispatch (owner / session / none)
in the resolve handler.
**MUTATE**: Stryker on the matcher + tier dispatch.
**KILL MUTANTS**: glob boundary (`*` vs `**`), default-deny, tier-precedence survivors.
**REFACTOR**: assess.
**Done when**: ACs met, 100% mutation, agent-browser/wire check shows no-session → allowlist-only
and owner → full, human approves commit.

## Open confirms for implementation (resolve at the relevant slice, not now)

- **Walker read mode** — verify `core/filesystem/walker.ts` exposes a `canRead` (the grep showed
  `canRead`/`canWrite` in the shared walker; `fsView` only surfaces `canWrite`). If read mode is
  missing, adding it is a 2c sub-step (mirror `canWrite`: file `r` bit + parent `x` traverse).
- **Session creation for cross-player ssh** — confirm 2b can reuse `createSession`
  (`core/sessions/createSession.ts` + `api/sessions.ts`) with `machine_id = A.workstation_machine_id`
  so 2c's tier-2 lookup (`findActiveSession`) resolves. (SSH epic noted `authCreateSession` was
  deferred; confirm the current path that writes the ssh `sessions` row and point it at A's real id.)
- **Registry reverse lookup** — 2c resolves `owner_key`+config from `workstation_machine_id` (B
  holds A's id from the 2b session). `public_ip` is the PK; add a query/index on
  `workstation_machine_id`, or have B pass A's public IP through the hop. Decide in 2c.
- **`/etc/passwd` at guest tier** — confirm `PASSWD_FILE` perms: if world-readable (`o+r`), a guest
  _session_ legitimately reads it incl. inline hashes (game-accepted: cracking needs a session
  first — `feedback_no_etc_shadow`, read-path memo). Tier 3 (no session) must still drop it
  (default-deny). Pin both in 2c/2d tests.
- **`GameConfig` shape server-side** — only `username`/`machineName`/`root-hash` are persisted;
  guest password derives from `ownerKey`. Confirm no other config field feeds
  `buildWorkstationBaseFs` (it does not today).

## Pre-PR Quality Gate (each slice)

1. `mutation-testing` on the slice's new pure code (dev server DOWN).
2. `refactoring` assessment.
3. `npm run lint` + `npm run test:run` (in `v2/`); `npm run build` green (tsc is now a self-imposed
   gate after 1b's debt cleanup).
4. agent-browser two-identity E2E for the slice's observable; scripted wire check that no forbidden
   content leaks (the wire is the threat surface).

## Out of scope (explicit deferrals)

- Cross-player WRITE + the `patches` PK flip → **Story 3**.
- Root escalation / bricking → **Story 4** (uses the persisted root-hash this story lands).
- Real iptables NAT / multi-machine / multi-layer → **Story 5**.
- Cross-player scan/connection trace (kern.log/auth.log re-key onto the shared record) → **Story 6**.
- Same-wifi shared-LAN occupancy → **Story 7**.

---

_Delete this file when Story 2 is complete; reconcile `plans/multiplayer-crossplayer-epic.md`
(mark Story 2 ✅, point Next step at Story 3). If `plans/` is empty, delete the directory._
