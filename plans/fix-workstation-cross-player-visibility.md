# Plan: Workstation Cross-Player Visibility Fix

**Branch**: `fix-workstation-cross-player-visibility`
**Status**: Active
**Tracks**: `project_workstation_visibility_bug.md` — P1, blocks chunk #1b L2 workstation end-to-end smoke testing.

## Goal

Make patches on a player's workstation visible cross-player to others on the same LAN, so daemon state changes (sshd pid file written → port 22 opens) propagate live and `nmap` from a same-LAN attacker reflects the real-time service state.

## Background

`FileSystemContext.tsx` builds a `machineIdsKey` (line 302–307) that drives BOTH the rehydration fetch (line 338) AND the Realtime subscription (line 466). Today it covers `workstationId + homeFileSystems keys + missionFileSystems keys`. **It does NOT include LAN occupant hostnames.**

LAN occupants are other players on the active home network. Each occupant's `hostname` IS their `workstation_id` (per the `eliminate-localhost` PR #94 and the `project_workstation_id_model` memory). When player A starts sshd, A's client writes a patch to `machine_id=<A's-workstation_id>`. The server stores it. The Realtime hint fires on `patches:<A's-workstation_id>`. **Player B never subscribes to that channel** because B's `machineIdsKey` doesn't include A's workstation_id, so B never refetches and B's nmap of A's workstation continues to show port 22 closed.

This blocks chunk #1b L2 smoke testing — we can't verify "B can ssh into A's workstation" if B can't even see A's daemon as running.

**Why this isn't the same bug as the read-path privacy gap (`project_read_path_privacy_gap.md`)**: that gap is about server-side filtering of patches when B *does* request them. This bug is about B never requesting them in the first place. The two fixes are independent. Read-path filtering is a separate (and larger) follow-up chunk.

## Acceptance Criteria

Behaviour-driven outcomes:

- [ ] When player B is on the same LAN as player A and A starts sshd on A's workstation, B's `nmap <A's-LAN-IP>` reflects port 22 as open within the Realtime debounce window.
- [ ] When A kills sshd (pid file removed), B's next `nmap` shows port 22 closed.
- [ ] B's rehydration fetch (initial mount + keyset-change refetch) requests patches for A's `workstation_id` whenever A is in B's `lanOccupants`.
- [ ] B's Realtime channel set includes `patches:<A's-workstation_id>` whenever A is in B's `lanOccupants`.
- [ ] When B joins a different home network (or disconnects from the LAN), the subscription set rotates accordingly — old occupant channels are torn down, new ones spun up.
- [ ] Self-filtering still holds: B does not subscribe to its own workstation_id via the occupant path (already excluded by `lanOccupants` in `HomeNetworksContext`).
- [ ] All existing `FileSystemContext.test.tsx` tests still pass (no regression on rehydration semantics or Realtime self-skip).

## Non-Goals

- **Read-path privacy filtering** — a forged-envelope attacker fetching A's `~/.bash_history` is a separate chunk. Tracked in `project_read_path_privacy_gap.md`.
- **Cross-LAN visibility** — occupants on home networks B has joined but isn't currently connected to are NOT in scope. The active-LAN scope matches the repro and matches `lanOccupants`'s existing semantics. Broader scope is a follow-up if needed.
- **World-network occupants** — world networks (findit.io, playground) aren't player-owned LANs; no occupant patches there to subscribe to.

## Steps

Each step follows RED-GREEN-MUTATE-KILL-REFACTOR per project CLAUDE.md.

### Step 1: Failing test — `machineIdsKey` includes lan-occupant hostnames

**Why first**: Pins the new prop's contract before any production change. The test will fail to compile because the prop doesn't exist yet. Classic TDD RED.

**RED**: New test in `src/filesystem/FileSystemContext.test.tsx`:

> "Rehydration fetch requests patches for lan-occupant hostnames in addition to workstation/home/mission machine_ids."

Render `FileSystemProvider` with `lanOccupantHostnames={['mainframe-1a2b3c4d', 'rocket-bbccdd11']}`. Wait for the debounced rehydration fetch. Assert `mockedListPatchesForMachines` was called with a `machineIds` array that contains BOTH occupant hostnames AND the workstation/home/mission ids, deduped + sorted.

**GREEN**: Add `lanOccupantHostnames?: readonly string[]` to `FileSystemProviderProps`. Fold into `machineIdsKey`'s Set:

```ts
const machineIdsKey = useMemo(() => {
  const ids = new Set<string>([workstationId]);
  if (homeFileSystems) for (const id of Object.keys(homeFileSystems)) ids.add(id);
  if (missionFileSystems) for (const id of Object.keys(missionFileSystems)) ids.add(id);
  if (lanOccupantHostnames) for (const id of lanOccupantHostnames) ids.add(id);
  return [...ids].sort().join(',');
}, [homeFileSystems, missionFileSystems, workstationId, lanOccupantHostnames]);
```

**MUTATE**: Run `mutation-testing` skill on `FileSystemContext.tsx`'s `machineIdsKey` block. Likely surviving mutants:

- Loop boundary: `for (const id of lanOccupantHostnames)` → `for (const id of [])` — kill via the test asserting BOTH ids land in the call.
- Conditional: `if (lanOccupantHostnames)` → unconditional — equivalent if undefined+empty are both no-ops; document inline if so.
- Set semantics: `ids.add(id)` → `ids.has(id) || ids.add(id)` — equivalent (Set.add is idempotent).

**KILL MUTANTS**: Add tests until score ≥ 90% on the changed block, or document equivalents.

**REFACTOR**: Assess. If the four `for/if` blocks become repetitive, consider a small `unionInto(set, ids)` helper — only if it reads cleaner.

**Done when**: Test green; mutation score ≥ 90%; existing tests still green.

### Step 2: Failing test — Realtime subscribes to occupant channels

**RED**: New test in `FileSystemContext.test.tsx` Realtime subscription describe-block (next to the existing `'passes the supabase client from getRealtimeClient to subscribeToMachine'` test):

> "Subscribes to a Realtime channel for each lan-occupant hostname."

Mock `getRealtimeClient` to return a fake non-null client. Render with `lanOccupantHostnames=['mainframe-1a2b3c4d']`. Assert `mockedSubscribeToMachine` was called with the occupant hostname (alongside workstation/home/mission ids).

**GREEN**: No production code change expected — Realtime effect (line 466+) already iterates the same `machineIdsKey` so Step 1's keyset extension covers this. The test is the contract; if it passes without code change, that's the desired symmetry.

**MUTATE**: N/A — no new production code. (Step 1's mutation run already covers `machineIdsKey`.)

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: Test green without modifying the Realtime effect.

### Step 3: Failing test — keyset rebuilds when occupants change

**RED**: New test:

> "When `lanOccupantHostnames` changes (e.g. WiFi switch), rehydration refetches with the new ids and Realtime channels rotate."

Render with `lanOccupantHostnames=['mainframe-1a2b3c4d']`. Wait for initial fetch. Update prop to `['rocket-bbccdd11']` via a controlled wrapper (similar pattern to existing keyset-change tests around line 700+). Assert: (a) a second `mockedListPatchesForMachines` call fires with the new id, (b) Realtime subscribes to the new channel, (c) the old channel was unsubscribed (assert via `subscribeToMachine`'s returned cleanup fn or equivalent — match existing pattern).

**GREEN**: Should pass automatically — `machineIdsKey` is the dep for both effects, and adding `lanOccupantHostnames` to its deps was done in Step 1.

**MUTATE**: Skip — characterization of dep behaviour. The dep array correctness is the contract; mutation testing on `useMemo` deps is noisy.

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: Test green.

### Step 4: Wire from `GameSession.tsx`

**RED**: New test or extend existing — `GameSession.test.tsx` (if exists) or a render-test of GameSession asserting:

> "GameSession passes the lanOccupants' hostnames to FileSystemProvider."

If `GameSession.test.tsx` doesn't exist OR mocking the whole tree is heavyweight, downgrade to: lean on Steps 1–3 unit coverage of FileSystemContext + the Step 5 manual smoke. Don't invent a fragile integration test for one line of prop-passing.

**GREEN**: In `src/game/GameSession.tsx`, derive hostnames from `lanOccupants` (already destructured at line 39) and pass:

```tsx
const lanOccupantHostnames = useMemo(
  () => lanOccupants.map((o) => o.hostname),
  [lanOccupants],
);

// ...

<FileSystemProvider
  localhostFileSystem={localhostResult.fileSystem}
  missionFileSystems={missionState.activeMission?.fileSystems}
  homeFileSystems={mergedHomeFileSystems}
  lanOccupantHostnames={lanOccupantHostnames}
>
```

The `useMemo` keeps reference stability across renders — without it, every render creates a new array and `machineIdsKey`'s `useMemo` would recompute, potentially causing unnecessary refetches.

**MUTATE**: Run mutation testing on the `lanOccupants.map((o) => o.hostname)` line. Likely surviving mutants:

- `o.hostname` → `o.lan_ip` or `o.network_id` — kill via asserting the prop value equals the expected hostname (Step 1's test indirectly covers this if we're disciplined about fixture data).
- Empty `[]` vs `lanOccupants.map(...)` — kill via Step 1 test having ≥ 1 hostname.

**KILL MUTANTS**: Address.

**REFACTOR**: Assess.

**Done when**: GameSession compiles, type-checks, and the wiring is straightforward to read.

### Step 5: Two-browser manual smoke

**Why manual**: Per `feedback_e2e_scope.md` memory — Playwright is reserved for browser-only behavior. This is a multi-identity cross-player flow that needs two real Supabase sessions; mirrors the smoke pattern from chunks #1, #1b, world-networks. Watch the network tab.

**Smoke procedure**:

1. **Browser A**: NEW GAME with workstation `alice-box`, username `alice`. Crack any local WiFi to land on a home network (e.g. `essid='HomeNet1'`).
2. **Browser B (incognito or different profile)**: NEW GAME with `bob-box`, `bob`. Crack the SAME WiFi → both occupants on the same LAN.
3. **In B's terminal**: `nmap <A's LAN IP>`. Confirm A's workstation appears, port 22 currently CLOSED (no sshd running).
4. **In A's terminal**: `systemctl start sshd` (or however sshd starts in-game — check `commands/systemctl.ts` for the verb). Confirm `/var/run/sshd.pid` is created on A's machine.
5. **Wait for the Realtime hint debounce window** (typically <500ms).
6. **In B's terminal**: `nmap <A's LAN IP>` again. Expect: port 22 NOW OPEN.
7. **In A's terminal**: `kill <pid>` (or `systemctl stop sshd`). Confirm pid file removed.
8. **In B's terminal**: `nmap <A's LAN IP>`. Expect: port 22 CLOSED again.
9. **Bonus**: B `ssh root@<A's LAN IP>` with the right password — connection succeeds (further validates chunk #1b L2 workstation enforcement on the read path side; this is what was blocked yesterday).

**Verification scripts**:

- `npx tsx scripts/testL2BypassWorkstation.ts` — should still pass 3/3 (this fix doesn't touch L2 enforcement, just visibility).
- `npm run test:run` — all unit tests green including the new ones.

**Done when**: Smoke procedure passes end-to-end on a real Supabase dev project.

### Step 6: Memory + version + docs

**Memory updates**:

- `project_workstation_visibility_bug.md` — mark CLOSED with date and PR ref. Or delete the file and add a CLOSED note pointing to the PR (consistent with how the L2 follow-ups memory marks closed chunks).
- `MEMORY.md` index — remove the bug from the "Known Bugs" section. Update "Upcoming Work" / "Active theme" accordingly: chunk #1b L2 workstation smoke is now unblocked, read-path privacy is the next chunk.

**Docs**:

- `src/filesystem/README.md` — if it documents the subscription model, add a line about lan-occupant hostnames being part of the keyset.
- `docs/architecture.md` — if it has a cross-player visibility section, mention workstations are now covered.
- No CLAUDE.md change expected (no new debug scripts).

**Version bump**:

- `package.json` patch bump (this is a bug fix, not a feature). Update `package-lock.json` via `npm install --package-lock-only`.

**Done when**: Memory reflects new state; version bumped; docs updated.

## PR Breakdown

**Single PR.** Steps 1–6 cluster around one mechanism (extending `machineIdsKey`) and one wiring point (GameSession). Splitting "mechanism" from "wiring" produces a PR1 with dead code (a new prop nobody passes) — net negative for reviewability. Total expected: ~30–80 production LOC + ~50–100 test LOC.

If during Step 1 the mutation testing pass surfaces unexpected gaps in adjacent code (e.g. existing `machineIdsKey` paths weren't well-tested), pull those out into a follow-up PR rather than ballooning this one.

## Pre-PR Quality Gate

Per project CLAUDE.md, before opening the PR:

1. `mutation-testing` skill on `FileSystemContext.tsx` (Step 1) and `GameSession.tsx` (Step 4).
2. `refactoring` skill assessment.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
4. Two-browser smoke (Step 5) verified on dev Supabase.
5. `scripts/testL2BypassWorkstation.ts` still 3/3.
6. DDD glossary unchanged.

## Risks

1. **Reference instability on `lanOccupantHostnames`**. If GameSession passes `lanOccupants.map(...)` inline (no memo), every render creates a new array, `machineIdsKey`'s useMemo dep diff fires by reference, and the rehydration debounced effect re-arms unnecessarily. The string-join in `machineIdsKey` itself stabilizes via content equality so the inner effects don't re-trigger, but the upstream useMemo still recomputes per render. Mitigation: wrap the map in `useMemo` (Step 4).

2. **Occupant churn during initial fetch**. `lanOccupants` populates after `HomeNetworksContext` resolves the active network and runs `listOccupants`. If the rehydration fetch fires BEFORE occupants populate, the initial fetch misses them; a subsequent keyset-change refetch picks them up once they arrive. Acceptable — same pattern as world/mission networks today (they too arrive after mount and trigger a second fetch). The REHYDRATION_DEBOUNCE_MS already accommodates this; verify in smoke that the second fetch fires after occupant load.

3. **Subscription explosion on busy LANs**. Each occupant adds one Realtime channel. If a popular home network has 20+ players, that's 20+ extra channels per client. Acceptable for v1 — Supabase Realtime channel limits are generous and home networks are designed to be small (handful of slots). Worth measuring once we have real traffic; not a blocker.

4. **Cross-LAN scope creep**. A reviewer might ask "what about `joinedNetworks` occupants the player isn't actively connected to?" Answer: out of scope per Non-Goals. Adding it later is purely additive (a different prop or a wider list). Don't gold-plate.

5. **Test brittleness on Realtime mock shape**. The Realtime tests mock `subscribeToMachine` directly; if the production code's call signature drifts (e.g. adds a new arg), tests need updating. Mitigation: keep the Step 2/3 assertions narrow to the machine_id arg.

---

_Delete this file when the plan is complete. If `plans/` is empty afterward, delete the directory._
