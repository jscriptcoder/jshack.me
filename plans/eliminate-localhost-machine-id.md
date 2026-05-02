# Plan: Eliminate `'localhost'` as a machine_id

**Branch**: `plan/eliminate-localhost-machine-id`
**Status**: Approved — implementing as a single PR (no migration needed; Phases 2 & 3 folded together)

## Problem

The literal string `'localhost'` is used as a machine_id everywhere a player's own workstation appears. This was a single-player abstraction — the workstation was per-player private and unreachable from outside. With cross-player home networks (PR #88+) the workstation is now addressable on the LAN at `${subnet}${lan_ip}`, but the storage layer still keys it under `'localhost'`. Result: A and B disagree on the workstation's machine_id.

Concrete symptom (smoke-tested in PR #93's follow-up):

- Player A nmaps Player B's workstation at `192.168.90.195`. Patch persisted with `machine_id='192.168.90.195'`. Realtime hint published on `patches:192.168.90.195`.
- Player B's browser keys their own workstation under `machine_id='localhost'`. Subscribed only to home/world/mission machines (localhost is excluded from Realtime per `FileSystemContext.tsx:483` to prevent neighbor-leak). Never receives the hint, never refetches.

The asymmetry exists at every layer:

- `patches` table — A writes rows keyed `192.168.90.195`, B reads rows keyed `localhost`. Two disjoint rowsets.
- `home_network_occupants` — works correctly (already keyed by network_id + lan_ip).
- `sessions` table — same per-player private semantics as patches.
- The `WHERE machine_id <> 'localhost' OR player_key = me` filter at `api/patches.ts:142` only exists _because_ localhost was a magic shared literal — it stops cross-player reads from leaking neighbors' localhost mutations.

## Goal

Stop using the literal `'localhost'` as a machine_id anywhere in storage. Each workstation gets a **stable, identity-derived machine_id** that:

- Is the same across sessions (survives reload, reset of in-game state, WiFi disconnect/reconnect).
- Is unique per player (so two browsers on the same LAN don't collide).
- Is the same value regardless of which home network the player is currently on.
- Is what _both_ the player AND any other player on the LAN agree to use when storing/reading patches and sessions for that workstation.

The `'localhost'` literal stays as a **UI/CLI affordance** (terminal prompt, `ssh localhost`, etc.) — it just resolves to the workstation_id internally.

## Model

**Workstation machine_id = the player's hostname.**

```
machine_id = `${workstation_name}-${first-8-hex(player_key)}`
```

E.g., `skylab-aabbccdd`. Same value used everywhere — patches table, sessions table, Realtime channels, occupant rows, nmap output, /etc/hostname, ssh banner.

- Identity-derived (suffix is `first-8-hex(sha256(player_key))`) → stable per player.
- 8 hex chars = 32 bits of suffix entropy → ~65k players sharing the SAME workstation_name before 50% birthday collision. Plenty for any realistic player base; can lengthen later under no-backward-compat if needed.
- Globally unique under the existing UNIQUE(network_id, hostname) constraint (which still catches the ultra-rare collision case at LAN-join time).
- Available pre-WiFi (workstation_name + identity are both set at intro screen).
- Independent of WiFi state, home network membership.
- The occupant row already stores this as `hostname`, so cross-player addressing needs no schema additions.

**Other-player addressing:** When A nmaps B's workstation at `${subnet}${B.lan_ip}`:

1. A's `NetworkContext` exposes B as an `OccupantMachine` (per PR #93's `lanOccupants` flow).
2. The occupant entry carries `hostname` (= B's workstation_id) directly. No derivation needed.
3. Any side-effect write A's command performs on the target goes through `appendToMachineLog(targetMachineIdFor(targetIp, lanOccupants, ownWorkstationId), ...)`. Helper logic: if `targetIp` matches an occupant's LAN IP, return `occupant.hostname`; else return `targetIp` verbatim.
4. Patches land in DB rows keyed `('skylab-aabbccdd', ...)`. B subscribed to `patches:skylab-aabbccdd` (their own workstation). Hint fires, B refetches, sees A's write. Symmetry restored.

**Loopback CLI affordance:** `ssh localhost`, `ping localhost`, `nc -l 127.0.0.1 ...` all keep working. The strings `'localhost'` and `'127.0.0.1'` stay recognized loopback aliases in command parsers, but resolve to the workstation_id internally for any storage operation. No user-visible change.

**Terminal prompt sanitized — display strips the suffix.** The prompt format `${username}@${strip-suffix(hostname)}:${cwd}$` shows `alice@skylab:~$` instead of `alice@skylab-aabbccdd:~$`. Strip regex: `/-[0-9a-f]{8}$/`. The full hostname stays visible everywhere else (nmap output, `cat /etc/hostname`, ssh banner, log lines) — that's the network identity players need to address each other.

## Threat model

The `WHERE machine_id <> 'localhost' OR player_key = me` filter (api/patches.ts:142) gets removed. The threat it guarded against:

> Player A on the same LAN as Player B reads patches for `'localhost'` (literal) and sees B's localhost mutations because they share the literal machine_id.

Under workstation_id (= hostname), A and B have _different_ machine_ids (`alice-skylab-aabbccdd` vs `bob-rocket-bbccdd11`). Cross-player reads only return rows for the requested machine_id. The filter becomes structurally unnecessary — the IDs themselves are per-player private.

Forgery / spam threats unchanged from PR #92's hint architecture.

## Acceptance criteria

- [ ] `deriveHostnameSuffix` bumped from 4 hex to 8 hex.
- [ ] New helper `workstationMachineId(workstationName, identity): string` returns `${workstationName}-${first-8-hex(identity.publicKeyHex)}`. Pure, fully tested.
- [ ] New helper `isOwnWorkstation(machineId, workstationName, identity): boolean`.
- [ ] New helper `displayPromptHostname(hostname): string` strips `-${8-hex}$` for the prompt.
- [ ] New helper `targetMachineIdFor(targetIp, lanOccupants, ownWorkstationId): string` for cross-player side-effect routing.
- [ ] `SessionContext` initializes `session.machine = workstationMachineId(...)` instead of literal `'localhost'`. All `session.machine === 'localhost'` checks use `isOwnWorkstation()`.
- [ ] `FileSystemContext` keys the player's own filesystem under `workstationMachineId(...)` instead of `'localhost'`. The Realtime subscription effect _includes_ the workstation_id (no longer filtered out).
- [ ] `MissionContext.PERSISTENT_MACHINES` becomes identity-derived.
- [ ] `NetworkContext` resolves `'localhost'` and `'127.0.0.1'` aliases to the workstation_id when used in a command target.
- [ ] Cross-player commands (nmap, ssh, scp, ftp, mysql, redis, hydra, msfconsole, nc, snmpset, snmpwalk, apt, ping, dig) use `targetMachineIdFor(...)` for log/file side-effects on remote machines.
- [ ] Terminal prompt rendering uses `displayPromptHostname()`.
- [ ] `clearOwnedPatches` parameterizes on the workstation_id instead of hardcoding `PERSISTENT_MACHINE_ID = 'localhost'`. Server derives it from the verified player_key + workstation_name (or accepts it as a payload field).
- [ ] `api/patches.ts` drops the `WHERE machine_id <> 'localhost' OR player_key = me` filter — no longer load-bearing.
- [ ] No migration needed (DB wiped pre-launch).
- [ ] All existing tests pass; new tests cover the workstation_id helper, the IP→workstation_id translation, the FileSystemContext storage-key replacement, and the prompt sanitizer.

## Out of scope

- **Renaming the workstation_id format later.** If `ws-${hex}` turns out to be confusing in logs, we can change the format — it's a single source of truth in the helper.
- **Eliminating in-game fixture content with `localhost` strings.** The generated `wp-config.php` etc. contain `$db_host = "localhost"` — those are in-game files, unrelated to our machine_id.
- **Loopback CLI alias rewrites.** `ssh localhost` keeps working. We resolve to workstation_id internally; the user never sees `ws-...`.
- **The `'localhost'` literal in display strings (prompt, log lines, etc.).** Stays as-is unless it actively confuses the storage layer.
- **Generalizing the hint pattern across patches + occupants.** Two consumers is still copy-paste territory; defer until a third use case.

## Phasing

**One PR for the whole change.** No migration step needed (DB wiped pre-launch). Phases 1+2+3 ship atomically — keeps review coherent and avoids leaving the helper as unused infrastructure on main between PRs.

### Implementation order within the PR

1. **Helpers + suffix bump** — `workstationMachineId`, `isOwnWorkstation`, `displayPromptHostname`, `targetMachineIdFor`. Bump `deriveHostnameSuffix` from 4 to 8 hex.
2. **Storage layer** — `SessionContext.tsx`, `sessionUtils.ts`, `FileSystemContext.tsx`, `MissionContext.tsx`, `NetworkContext.tsx`. Replace literal `'localhost'` machine_id with workstation_id. `PERSISTENT_MACHINE_KEYS` / `PERSISTENT_MACHINES` become identity-derived. Realtime subscription effect _includes_ the workstation_id (the localhost-leak filter is no longer needed).
3. **Command + hook layer** — `Terminal.tsx`, `useCommands.ts`, `useNetworkCommands.ts`, `useWifiCommands.ts`, all command files. Replace `session.machine === 'localhost'` with `isOwnWorkstation(...)`. Loopback CLI aliases stay; resolve to workstation_id internally.
4. **Cross-player target translation** — wire `targetMachineIdFor(targetIp, lanOccupants, ownWorkstationId)` into nmap and other commands that side-effect on remote machines (the `appendToMachineLog` path). This is the load-bearing fix for "A writes to B's workstation, B refetches via hint."
5. **Prompt sanitization** — Terminal prompt rendering uses `displayPromptHostname()` to strip the suffix.
6. **Server-side cleanup** — `api/patches.ts` drops the `WHERE machine_id <> 'localhost' OR player_key = me` filter (no longer load-bearing). `patchRegistry/supabaseDelete.ts` drops `PERSISTENT_MACHINE_ID`. `clearOwnedPatches` parameterizes on workstation_id.
7. **Docs + memory** — `src/patchRegistry/README.md`, `src/session/README.md`, `src/homeNetworks/README.md` (mention 8-hex suffix). Update `project_multiplayer_cross_player_visibility` memory (localhost special case gone). Update `project_multiplayer_home_network_model` memory (suffix length).

**Acceptance**: full test suite green. Two-browser smoke: A writes to B's workstation → B receives hint and refetches → cross-player log entries appear live.

## Risks & known caveats

1. **`getDefaultHomePath(machineId, username)`** — used to resolve `~` for cd. Currently checks `machineId === 'localhost'` for the localhost-specific fallback. Becomes `isOwnWorkstation(machineId, ...)`. Need to confirm this doesn't break any deeper machine-path resolution.
2. **`PERSISTENT_MACHINE_KEYS` is also referenced in mission/home transition logic** — patches for "persistent" machines survive transitions. With workstation_id replacing localhost, the set is `new Set([workstationMachineId(...)])`. Needs to be derived per-render (or memoized) since identity is in scope.
3. **Tests using `'localhost'` literal** — many tests explicitly construct sessions or patches with `machine: 'localhost'`. We'll need to update these to use the workstation_id helper or a test fixture identity. Likely the bulk of test churn.
4. **In-game fixture content with `localhost` strings** (`$db_host = "localhost"` in `generation/pools/credentials.ts`) — these are unrelated; they're the IN-GAME machines' generated config files. Not touched.
5. **Router/internal IPs (`10.0.0.1`)** — unrelated; these are real IPs, not the literal `'localhost'`. Not touched.

## Locked-in decisions

1. **Workstation_id format**: `${workstation_name}-${first-8-hex(player_key)}`. Same as the hostname (occupant.hostname column already stores this — no schema change).
2. **Migration**: none — DB wiped pre-launch.
3. **Display strings**: prompt strips suffix → `${username}@${workstation_name}` (e.g. `alice@skylab:~$`). All other surfaces (nmap, /etc/hostname, ssh, logs) show the full hostname unchanged.
4. **Phasing**: single atomic PR.

## Estimated effort

~1-2 days of focused work for the whole PR. The bulk is per-file edits + test fixture updates.
