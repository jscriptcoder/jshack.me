# Plan: Eliminate `'localhost'` as a machine_id

**Branch**: `plan/eliminate-localhost-machine-id` (plan only; implementation branch will be separate)
**Status**: Draft (awaiting approval)

## Problem

The literal string `'localhost'` is used as a machine_id everywhere a player's own workstation appears. This was a single-player abstraction — the workstation was per-player private and unreachable from outside. With cross-player home networks (PR #88+) the workstation is now addressable on the LAN at `${subnet}${lan_ip}`, but the storage layer still keys it under `'localhost'`. Result: A and B disagree on the workstation's machine_id.

Concrete symptom (smoke-tested in PR #93's follow-up):

- Player A nmaps Player B's workstation at `192.168.90.195`. Patch persisted with `machine_id='192.168.90.195'`. Realtime hint published on `patches:192.168.90.195`.
- Player B's browser keys their own workstation under `machine_id='localhost'`. Subscribed only to home/world/mission machines (localhost is excluded from Realtime per `FileSystemContext.tsx:483` to prevent neighbor-leak). Never receives the hint, never refetches.

The asymmetry exists at every layer:

- `patches` table — A writes rows keyed `192.168.90.195`, B reads rows keyed `localhost`. Two disjoint rowsets.
- `home_network_occupants` — works correctly (already keyed by network_id + lan_ip).
- `sessions` table — same per-player private semantics as patches.
- The `WHERE machine_id <> 'localhost' OR player_key = me` filter at `api/patches.ts:142` only exists *because* localhost was a magic shared literal — it stops cross-player reads from leaking neighbors' localhost mutations.

## Goal

Stop using the literal `'localhost'` as a machine_id anywhere in storage. Each workstation gets a **stable, identity-derived machine_id** that:

- Is the same across sessions (survives reload, reset of in-game state, WiFi disconnect/reconnect).
- Is unique per player (so two browsers on the same LAN don't collide).
- Is the same value regardless of which home network the player is currently on.
- Is what *both* the player AND any other player on the LAN agree to use when storing/reading patches and sessions for that workstation.

The `'localhost'` literal stays as a **UI/CLI affordance** (terminal prompt, `ssh localhost`, etc.) — it just resolves to the workstation_id internally.

## Model

**Workstation machine_id = `ws-${first-12-hex(player_key)}`** (e.g., `ws-aabbccddee01`).

- Identity-derived → stable per player, no DB allocation needed.
- 12 hex chars = 48 bits of pubkey entropy → collision probability vanishing.
- `ws-` prefix makes the format easy to grep, distinct from IP addresses.
- Independent of WiFi state, home network membership, or anything else that changes mid-session.

**Other-player addressing:** When A nmaps B's workstation at `${subnet}${B.lan_ip}`:

1. A's `NetworkContext` already exposes B as an `OccupantMachine` (per PR #93's `lanOccupants` flow).
2. The occupant entry carries `player_key`. A's client derives `ws-${first-12-hex(player_key)}` to get B's canonical machine_id.
3. Any side-effect write A's command performs on the target (log appends, file writes via exploit, etc.) goes through `appendToMachineLog(workstationIdFor(targetIp), ...)` — the helper looks up the IP in lanOccupants and translates.
4. Patches land in DB rows keyed `('ws-bbcc...', ...)`. B subscribed to `patches:ws-bbcc...` (their own workstation). Hint fires, B refetches, sees A's write. Symmetry restored.

**Loopback CLI affordance:** `ssh localhost`, `ping localhost`, `nc -l 127.0.0.1 ...` all keep working. The string `'localhost'` (and `'127.0.0.1'`) stays a recognized loopback alias in command parsers, but resolves to the workstation_id internally for any storage operation. No user-visible change.

**Terminal prompt:** unchanged — keeps showing whatever it shows today (hostname-derived). This is a display-only string, not a machine_id.

## Threat model

The `WHERE machine_id <> 'localhost' OR player_key = me` filter (api/patches.ts:142) gets removed. The threat it guarded against:

> Player A on the same LAN as Player B reads patches for `'localhost'` (literal) and sees B's localhost mutations because they share the literal machine_id.

Under workstation_id, A and B have *different* machine_ids (`ws-aa...` vs `ws-bb...`). Cross-player reads on `ws-aa...` only return A's rows because B never wrote to that machine_id. The filter becomes structurally unnecessary — the IDs themselves are per-player private.

Forgery / spam threats unchanged from PR #92's hint architecture.

## Acceptance criteria

- [ ] New helper `workstationMachineId(identity): string` returns `ws-${first-12-hex(identity.publicKeyHex)}`. Pure, fully tested.
- [ ] New helper `isOwnWorkstation(machineId, identity): boolean` returns true iff `machineId === workstationMachineId(identity)`.
- [ ] `SessionContext` initializes `session.machine = workstationMachineId(identity)` instead of literal `'localhost'`. All `session.machine === 'localhost'` checks use `isOwnWorkstation()`.
- [ ] `FileSystemContext` keys the player's own filesystem under `workstationMachineId(identity)` instead of `'localhost'`. The Realtime subscription effect *includes* the workstation_id (no longer filtered out).
- [ ] `NetworkContext` resolves `'localhost'` and `'127.0.0.1'` aliases to the workstation_id when used in a command target.
- [ ] Cross-player commands (nmap, ssh, scp, ftp, mysql, redis, hydra, msfconsole, nc, snmpset, snmpwalk, apt, ping, dig) use a `targetMachineId(targetIp, lanOccupants, workstationId)` helper that returns the canonical machine_id for storage operations: `ws-...` for occupant LAN IPs, the literal IP for everything else.
- [ ] `clearOwnedPatches` parameterizes on the workstation_id instead of hardcoding `PERSISTENT_MACHINE_ID = 'localhost'`. Server derives it from the verified player_key.
- [ ] `api/patches.ts` drops the `WHERE machine_id <> 'localhost' OR player_key = me` filter — no longer load-bearing.
- [ ] Migration: existing rows keyed `'localhost'` are dropped (per `feedback_no_backward_compat` memory — no live players).
- [ ] All existing tests pass; new tests cover the workstation_id helper, the IP→ws-id translation, the FileSystemContext localhost-key replacement, and the cross-player smoke (A writes to B's workstation, B refetches via hint).

## Out of scope

- **Renaming the workstation_id format later.** If `ws-${hex}` turns out to be confusing in logs, we can change the format — it's a single source of truth in the helper.
- **Eliminating in-game fixture content with `localhost` strings.** The generated `wp-config.php` etc. contain `$db_host = "localhost"` — those are in-game files, unrelated to our machine_id.
- **Loopback CLI alias rewrites.** `ssh localhost` keeps working. We resolve to workstation_id internally; the user never sees `ws-...`.
- **The `'localhost'` literal in display strings (prompt, log lines, etc.).** Stays as-is unless it actively confuses the storage layer.
- **Generalizing the hint pattern across patches + occupants.** Two consumers is still copy-paste territory; defer until a third use case.

## Phasing

Three PRs, each shippable independently.

### Phase 1 — Workstation ID infrastructure (small, additive)

Adds the helper + plumbing without changing storage keys yet. This PR is a no-op behaviorally; subsequent PRs flip the switch.

- New module `src/identity/workstationId.ts` exporting `workstationMachineId(identity)` + `isOwnWorkstation(machineId, identity)`.
- `IdentityContext` (or wherever identity is resolved at the App level) exposes the workstation_id alongside the existing identity object so consumers can read it without re-deriving.
- Tests: helper purity, stability across calls, format conformance, distinctness across identities.

**Acceptance**: helper exists, is exported, has test coverage. No call site uses it yet.

### Phase 2 — Replace `'localhost'` machine_id with workstation_id (the meat)

The bulk of the change. Touches:

- `SessionContext.tsx` (5 hardcoded `'localhost'` defaults + 1 conditional comparison).
- `FileSystemContext.tsx` — `PERSISTENT_MACHINE_KEYS` becomes a function of identity; the Realtime subscription effect filter no longer excludes the workstation; the `fileSystems[currentMachine] ?? fileSystems['localhost']` fallback uses workstation_id.
- `MissionContext.tsx` — `PERSISTENT_MACHINES` set becomes identity-derived.
- `sessionUtils.ts` — `defaultSession()` uses workstation_id.
- `NetworkContext.tsx` — `isLocalhostDisconnected` and the two localhost-conditional branches use `isOwnWorkstation()`.
- `Terminal.tsx`, `useCommands.ts`, `useNetworkCommands.ts`, `useWifiCommands.ts` — all `session.machine === 'localhost'` checks → `isOwnWorkstation(session.machine)`.
- All command files (`apt`, `dig`, `ftp`, `hydra`, `msfconsole`, `mysql`, `nc`, `ping`, `rediscli`, `scp`, `snmpset`, `snmpwalk`, `ssh`) — the loopback CLI alias matching is preserved, but resolution to a machine_id uses the workstation_id helper.
- `logging/utils.ts` — display formatting unchanged; storage routing uses workstation_id.
- New helper `targetMachineIdFor(targetIp, lanOccupants, ownWorkstationId)` for commands that write side-effects on remote machines (the appendToMachineLog path). Returns the canonical machine_id: `ws-...` if `targetIp` matches an occupant LAN IP; the literal IP otherwise.
- nmap and other commands that write logs on the target call `appendToMachineLog(targetMachineIdFor(targetIp, ...), ...)` so cross-player writes to a workstation land under the canonical `ws-...` key.

**Acceptance**: full test suite green. Two-browser smoke verifies A writes to B's workstation → B receives hint and refetches.

**Migration step (one-shot SQL):**

```sql
-- Wipe old localhost-keyed rows; players will rehydrate fresh with their
-- new workstation_id. Per feedback_no_backward_compat memory: no live
-- players, free to drop.
DELETE FROM patches WHERE machine_id = 'localhost';
DELETE FROM sessions WHERE machine_id = 'localhost';
```

(In practice this happens at any local Supabase reset; for cloud, run once before first deploy.)

### Phase 3 — Server-side cleanup

Drops the now-unnecessary localhost guard.

- `api/patches.ts` — remove the `WHERE machine_id <> 'localhost' OR player_key = me` filter at line 142.
- `patchRegistry/types.ts` — update the `ListPatchesForMachinesParams` doc-comment to reflect the new model.
- `patchRegistry/supabaseDelete.ts` — `PERSISTENT_MACHINE_ID` constant goes away. `clearOwnedPatches` accepts the workstation_id from the handler.
- `patchRegistry/handler.ts` — the `clearOwnedPatches` action passes the verified player's workstation_id as the deletion target.
- README updates: `src/patchRegistry/README.md` (the localhost-special-case section), `src/session/README.md`.
- Memory updates: `project_multiplayer_cross_player_visibility` (the localhost special case is gone).

**Acceptance**: full test suite green. Cross-player visibility regression check: A still sees B's writes on shared mission/home machines, B doesn't see A's workstation_id rows (because they have different ws-ids).

## Risks & open questions

1. **Existing IndexedDB caches.** Each player's local IndexedDB cache has patches under the old `'localhost'` key. On first load post-update, those won't be replayed against the new workstation_id base. Players will see their localhost files reset to base. Per no-backward-compat: acceptable. Could add a one-shot migration in the cache layer if disruptive.

2. **Mid-session state during the upgrade.** A player loaded with the old code has `session.machine = 'localhost'`; their next mutation goes to `'localhost'` keyed rows. After upgrade, the new code reads/writes `ws-...` rows. Storage doesn't merge. Per no-backward-compat: hard cutover, fine.

3. **The `getDefaultHomePath(machineId, username)` call** — used to resolve `~` for cd. Currently checks `machineId === 'localhost'` for the localhost-specific fallback. Becomes `isOwnWorkstation(machineId, identity)`. Need to confirm this doesn't break any deeper machine-path resolution.

4. **`PERSISTENT_MACHINE_KEYS` is also referenced in mission/home transition logic** — patches for "persistent" machines survive transitions. With workstation_id replacing localhost, the set is `new Set([workstationMachineId(identity)])`. Needs to be derived per-render (or memoized) since identity is in scope.

5. **Tests using `'localhost'` literal** — many tests explicitly construct sessions or patches with `machine: 'localhost'`. Per the project's no-mocks-of-storage rule, we'll need to update these to use the workstation_id helper or a test fixture identity.

6. **`'localhost'` in router/internal IPs** — the home network's router has both a `publicIp` AND an `internalIp` (e.g., `10.0.0.1`). Neither is `'localhost'`, so this is unrelated. Just confirming.

## Estimated effort

- Phase 1: ~half-day (helper + tests + identity wiring).
- Phase 2: ~1-2 days (the meat — careful per-file changes + test updates + smoke).
- Phase 3: ~half-day (cleanup + docs + memory).

Total: ~2-3 days of focused work. Each phase ships independently.

## Decision points needing user input

1. **Workstation_id format.** Proposed: `ws-${first-12-hex(player_key)}`. Alternatives: full pubkey hex (long), or shorter (collision risk). Or human-readable like `${workstation_name}-${hex}` for debugging at the cost of stability across name changes.

2. **Migration strategy.** Proposed: SQL DELETE on existing `'localhost'` rows, no migration. Alternatives: migrate (complex, low value given no live players); or leave orphaned (free but cluttered).

3. **`logging/utils.ts` display strings.** The `formatHostname(machineId)` helper currently returns `'localhost'` for the `'localhost'` machine_id. Should it now return `'localhost'` for the workstation_id, or the raw `ws-...`, or the player's hostname? Probably `'localhost'` for display continuity.

4. **Phase 3 separately or fold into Phase 2.** Keeping the localhost-filter through Phase 2 means there's a brief window where the filter is dead code. Folding Phase 3 into Phase 2 ships everything atomically. Trade-off: PR size vs. atomicity.
