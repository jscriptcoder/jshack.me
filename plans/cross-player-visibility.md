# Plan: Cross-Player Visibility — read path, then Realtime, then rules

**Branch**: feat/patches-cross-player-read (PR 1 of N)
**Status**: Active

## Goal

Make every persistent mutation on a shared machine visible to every player who can see that machine. Today `listPatches` filters `WHERE player_key = me`, so each player only ever sees their own writes. The world should be one shared persistent state, not per-player overlays.

## Acceptance Criteria (full chunk, multi-PR)

- [ ] Player A's write to `/etc/hosts` on machine X is visible to Player B when B reads from machine X — via rehydration on page load (PR 1)
- [ ] Player A's write to `/etc/hosts` on machine X is visible to Player B without reload — via Realtime push (PR 2)
- [ ] Visibility rule enforced server-side: a player who shouldn't see machine X gets no rows for it (PR 3)
- [ ] Concurrent writes to the same `(machine_id, path)` from two authors resolve deterministically (last-write-wins by `updated_at`)

## Scope of PR 1 (this branch)

Replace the player-scoped `listPatches(player_key=me)` action with a machine-scoped `listPatchesForMachines(machine_ids[])` that returns ALL rows for those machines from any author, ordered `updated_at ASC`. `applyPatches` already does last-write-wins via reduce-order, so concurrent edits resolve deterministically as a side-effect.

**Out of scope (later PRs)**:

- Realtime subscriptions (PR 2)
- Server-side visibility rule (PR 3, blocked on home-network occupants table)
- PK consolidation if we want one row per `(machine_id, path)` instead of per-author

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Step 1: `listPatchesForMachines` action schema

**Acceptance criteria**: `patchesSignedPayloadSchema` accepts an envelope with `action: 'listPatchesForMachines'` and a `machine_ids` array of 1–100 strings (each 1–256 chars). Rejects empty array, missing field, non-string entries, oversized array, and unknown extra fields. Existing actions still parse.
**RED**: Schema test in `types.ts` — `parse({ action: 'listPatchesForMachines', ts, nonce, machine_ids: [...] })` succeeds; same with empty `machine_ids` fails; oversized fails; missing field fails.
**GREEN**: Add the action arm to the discriminated union; export `ListPatchesForMachinesPayload` type and the internal `ListPatchesForMachinesParams` / `ListPatchesForMachinesResult` types.
**MUTATE**: Run mutation testing on the new schema arm.
**KILL MUTANTS**: Strengthen tests for surviving mutants.
**REFACTOR**: None expected — schema is data.
**Done when**: Tests green, mutation report clean, human approves commit.

### Step 2: `selectPatchesForMachines` Supabase adapter

**Acceptance criteria**: `createSupabaseListPatchesForMachines(selectFn)` returns `{ ok: true, patches: [...] }` on success, `{ ok: false }` on error, empty patches when no rows. Forwards the `machine_ids` array verbatim to `selectFn`. Server SQL is `WHERE machine_id IN (...) ORDER BY updated_at ASC`.
**RED**: Adapter test mirrors `supabaseSelect.test.ts` shape — vi.fn returns rows-from-multiple-authors for one machine, adapter returns them in order.
**GREEN**: New file `supabaseSelectByMachine.ts` with the adapter. The actual `.in('machine_id', ids).order('updated_at', { ascending: true })` wiring lives in `api/patches.ts`.
**MUTATE**: Mutation testing on adapter.
**KILL MUTANTS**: Strengthen if needed.
**REFACTOR**: None expected.
**Done when**: Tests green, mutation report clean, human approves commit.

### Step 3: Server handler arm

**Acceptance criteria**: `POST /api/patches` with `action: 'listPatchesForMachines'` dispatches to the new adapter, returns `{ patches: [...] }`. No active-session gate (read is open to any authenticated player). Adapter failure → 500 query_failed. Schema failure → 400. Replay → 401. Rate-limit → 429.
**RED**: Handler tests — `handlePatchesRequest` with new action returns rows; with adapter error returns 500; with bad signature returns 401.
**GREEN**: Add `handleListPatchesForMachines` and dispatch arm in `handler.ts`. Add `listPatchesForMachines` to `HandlerDeps`.
**MUTATE**: Mutation testing on dispatch + handler.
**KILL MUTANTS**: Strengthen if needed.
**REFACTOR**: None expected.
**Done when**: Tests green, mutation report clean, human approves commit.

### Step 4: Client wrapper `listPatchesForMachines`

**Acceptance criteria**: `listPatchesForMachines(identity, machine_ids, fetchImpl?) → ReadonlyArray<FileSystemPatch>`. Signs envelope with the new action. Throws on non-2xx response. Returns parsed wire patches converted to `FileSystemPatch` (same camelCase conversion as existing `listPatches`).
**RED**: Client test in `client.test.ts` — mock fetch, verify envelope shape, verify response parse.
**GREEN**: New wrapper in `client.ts`.
**MUTATE**: Mutation testing on wrapper.
**KILL MUTANTS**: Strengthen if needed.
**REFACTOR**: None expected.
**Done when**: Tests green, mutation report clean, human approves commit.

### Step 5: Wire `FileSystemContext` rehydration to use new path

**Acceptance criteria**: At mount, FileSystemContext computes `machine_ids` from `localhostFileSystem` + `homeFileSystems` keys + `missionFileSystems` keys and calls `listPatchesForMachines`. Replaces patches state and rebuilds filesystems with multi-author patches applied in `updated_at` order.
**RED**: Test in `FileSystemContext.test.tsx` — mount with multi-author patches; assert all are applied; assert later `updated_at` wins on conflict.
**GREEN**: Replace `listPatchesFromServer(getIdentity())` call with `listPatchesForMachines(getIdentity(), machine_ids)`. Compute `machine_ids` inside the rehydration `useEffect`.
**MUTATE**: Mutation testing on the new useEffect logic.
**KILL MUTANTS**: Strengthen if needed.
**REFACTOR**: None expected.
**Done when**: Tests green, mutation report clean, human approves commit.

### Step 6: Pin last-write-wins in `applyPatches`

**Acceptance criteria**: Regression test: `applyPatches(base, [patchOlder, patchNewer])` with same `(machine_id, path)` yields filesystem reflecting `patchNewer.content`. (Likely no code change — just locks the contract.)
**RED**: New test in `fileSystemUtils.test.ts`.
**GREEN**: Already passes. If it doesn't, fix.
**MUTATE**: N/A — regression-only test.
**KILL MUTANTS**: N/A.
**REFACTOR**: None.
**Done when**: Test green, human approves commit.

### Step 7: Delete old player-scoped `listPatches`

**Acceptance criteria**: Old `listPatches` action / adapter / client wrapper / handler arm removed. All tests still pass. No app code references `listPatches` anymore (only `listPatchesForMachines`).
**RED**: Build + tests must stay green after removal — the "test" is the existing test suite.
**GREEN**: Delete the action arm, the `supabaseSelect.ts` file (now empty), the client wrapper, the handler arm, and the related tests. Update `HandlerDeps`.
**MUTATE**: N/A — deletion-only.
**KILL MUTANTS**: N/A.
**REFACTOR**: Audit any leftover references to `ListPatchesParams` / `ListPatchesResult`.
**Done when**: Build green, lint green, tests green, human approves commit.

### Step 8: Pre-PR quality gate

**Acceptance criteria**: `npm run build` clean, `npm run lint` clean, `npm run format` clean, `npm run test:run` green. Mutation testing pass on new code. Manual smoke test in browser: load game, write a file, refresh, verify file persists. Bonus: open second browser/incognito with a different identity and verify the first identity's writes show up after refresh.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing on new/changed code
2. Refactoring assessment
3. Typecheck and lint pass
4. Manual browser smoke test (cross-identity verification)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
