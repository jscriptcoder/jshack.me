# Plan: Realtime Patches Subscriptions (PR 2 of N)

**Branch**: feat/patches-realtime-subscriptions
**Status**: Active

## Goal

Cross-player patch updates appear live in every viewer's browser, no page reload needed. After this PR, Player A's write to a shared machine reaches Player B's browser within ~1s and applies via the existing `applyPatches` reducer.

## Acceptance Criteria

- [ ] Server publishes a broadcast event on every successful upsertPatch / removePatch
- [ ] Client subscribes to a Supabase Realtime channel per machine_id in current view
- [ ] On event, client applies the patch via existing patches state + applyPatches
- [ ] Subscriptions clean up on unmount AND on machine_id keyset change
- [ ] React Strict Mode double-effect handled cleanly (no leaked subscriptions)
- [ ] Broadcast publish failures don't fail the request (fire-and-forget; logged)

## Out of scope (later PRs)

- Per-player visibility rules on subscriptions (PR 3, blocked on home-network occupants table)
- Signed broadcast payloads — for now we trust broadcasts and accept transient local divergence on forgery (server-truth wins on next reload)
- Rate limiting / authorization on the Realtime layer (Supabase Realtime authorization rules are a separate hardening pass)
- Mid-session home/mission transition refetch (the gap from PR 1 — Realtime obviates it for shared machines, since live updates fill in)

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.

### Step 1: Server-side `publishPatchChange` helper

**Acceptance criteria**: A pure helper `publishPatchChange(broadcastFn, payload)` wraps a thin `broadcastFn` adapter. Channel name = `patches:${machine_id}`, event = `'patch_change'`, payload = the wire `PatchSummary` shape (so subscribers can pass it straight into the existing wire→FileSystemPatch converter). Adapter signature stays Supabase-agnostic. Failures of `broadcastFn` are caught and logged but never thrown.
**RED**: `broadcast.test.ts` — mock adapter, verify channel/event/payload for both upsert and remove cases (remove publishes a tombstone payload with `content: null`).
**GREEN**: New `src/patchRegistry/broadcast.ts`.
**MUTATE**: Walk the channel-name and event-name mutations.
**Done when**: tests pass, mutation report clean, human approves commit.

### Step 2: Wire publish into `api/patches.ts`

**Acceptance criteria**: After `upsertPatch` returns ok, the handler fires `publishPatchChange` with the row. Same for `removePatch`. Broadcast errors don't fail the HTTP request — caught and logged. Adapter wired via the Vercel function using the existing service_role Supabase client (`supabase.realtime` REST or `.channel().send()`).
**RED**: Handler-level test asserts publishPatchChange called with the right args after a successful upsert/remove. Failed broadcast doesn't propagate.
**GREEN**: Add `publishPatchChange` to `HandlerDeps`, call after success.
**Done when**: tests pass, mutation report clean, human approves commit.

### Step 3: Client-side `subscribeToMachine` helper

**Acceptance criteria**: `subscribeToMachine(supabaseClient, machine_id, onPatch) → () => void` wraps `supabase.channel(...).on('broadcast', { event: 'patch_change' }, ...).subscribe()`. The returned unsubscribe disposes the channel. The wire payload is converted to FileSystemPatch before invoking `onPatch` (reusing `toFileSystemPatch` from client.ts). The wrapper accepts an injectable Supabase client for testability.
**RED**: `realtime.test.ts` — mock Supabase client, assert subscribe call shape, assert callback fires on event with the converted patch, assert unsubscribe disposes.
**GREEN**: New `src/patchRegistry/realtime.ts` (or extend `client.ts`). Export `subscribeToMachine`, plus a helper to construct the anon-key Supabase client (factored so tests can inject a fake).
**Done when**: tests pass, mutation report clean, human approves commit.

### Step 4: Wire subscriptions into `FileSystemContext`

**Acceptance criteria**: A new `useEffect` watches the `machine_ids` set (same one computed for rehydration). On change, unsubscribe the stale machines and subscribe to the new ones. Inbound patches update the patches state via the existing `broadcastAndRecordPatch` plumbing (or a focused setPatches call that reuses applyPatches). Strict Mode double-effect is handled — the cleanup unsubscribes cleanly so the second effect run gets fresh subscriptions.
**RED**: FileSystemContext test — mock subscribeToMachine, assert subscriptions for each visible machine_id; trigger an event, assert patches state updates; change props (add/remove machines), assert subscriptions update.
**GREEN**: New useEffect with dep on the deduped machine_ids list. Subscribe map kept in a ref. Cleanup on unmount.
**Done when**: tests pass, mutation report clean, human approves commit.

### Step 5: Pre-PR quality gate + manual smoke

**Acceptance criteria**: `npm run build` clean, `npm run lint` clean, `npm run format:check` clean, `npm run test:run` green, mutation walks for new code, README + technology-choices.md updated to mention Realtime broadcasts.

Manual smoke (limited surfaces in PR 2 — the playground-network test fixture is its own follow-up after PR 3):

- Two tabs of same identity on localhost: write in tab A, see it live in tab B (proves the wire works end-to-end). The localhost player_key filter from PR 1 still applies, so this only works WITHIN one identity — same-identity tabs share the player_key.
- Bonus (if playground network exists by then): two browsers different identities, write to playground, see live updates.

**Done when**: gate green, smoke pass, human approves commit.

## Pre-PR Quality Gate

Before opening the PR:

1. Mutation testing on new code
2. Refactoring assessment
3. Typecheck and lint pass
4. README + technology-choices.md updated

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
