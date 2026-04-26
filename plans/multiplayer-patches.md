# Plan: Patches → Supabase

**Branch**: `feat/multiplayer-patches`
**Status**: Active

## Goal

Migrate filesystem patches from IndexedDB-as-source-of-truth to a Supabase
`patches` table accessed via a signed `/api/patches` endpoint, so patches
follow `player_key` across browsers/devices. IndexedDB stays as a local
cache for fast initial paint. **Patch validation deferred** (later PR
consults the `sessions` table — this PR records what the client says).

## Acceptance Criteria

- [ ] `patches` table exists in Supabase with composite PK `(player_key, machine_id, path)` + RLS enabled (no policies → service-role-only)
- [ ] `POST /api/patches` accepts signed envelopes with action-dispatch on five actions: `upsertPatch`, `removePatch`, `listPatches`, `clearTransientPatches`, `clearAllPatches`
- [ ] Server stamps `player_key` from the verified Ed25519 pubkey on every write — strict schemas reject any client-supplied `player_key`
- [ ] Replay protection (nonce + ts) and per-pubkey rate limiting via Upstash, mirroring `/api/sessions`
- [ ] Browser-side wrappers in `src/patchRegistry/client.ts` sign and POST envelopes; throw on non-2xx
- [ ] On mount, `FileSystemContext` rehydrates patches from the server (replaces IndexedDB-cached state if differs); existing IndexedDB cache + optimistic state remain in place for fast initial paint
- [ ] Every `broadcastAndRecordPatch` fires a `upsertPatch`/`removePatch` server call alongside the existing local set + IndexedDB write (fire-and-forget — sync callers don't await)
- [ ] Mission/home transition cleanup fires `clearTransientPatches` (drops everything except `machine_id='localhost'`)
- [ ] `reset confirm` fires `clearAllPatches` before page reload (drops everything for this `player_key`)
- [ ] Build, lint, format, full test suite, mutation testing all pass
- [ ] Smoke test on `vercel:dev`: `nano /tmp/foo.txt` → row appears in Supabase; reload → patch survives without IndexedDB

## Out of scope (explicit — separate PRs)

- **Patch validation against `sessions`**: this PR records authoritatively but does not enforce "do you have a session on this machine?" — that's the actual security boundary and goes in the next PR.
- **Mission-instance / shared-network scoping**: machine_id is the only scope today; instance keys come later when we ship mission instances.
- **Realtime fanout**: future PR.
- **Removing IndexedDB**: it stays as a sync-readable cache for now. Pruning is a future PR after we're confident the server pipe is fast enough.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production
code without a failing test. Read `.claude/CLAUDE.md` and the testing rules
before writing each step.

### Step 1: `patches` migration + RLS

**Acceptance criteria**:

- New migration `supabase/migrations/20260427100000_patches.sql` creates the table with composite PK `(player_key, machine_id, path)` plus all FileSystemPatch fields (content, owner, permissions JSONB, is_new, node_type) and timestamps.
- RLS enabled, no policies → anon + authenticated denied; service_role bypasses (mirrors `sessions`/`public_ips`).
- Header comment explains the lifecycle (upsert on writes, hard-delete on isNew-cleanup, two bulk-deletes for transient/all clears) and security posture.
- `npm run db:reset` applies cleanly.

**RED**: Manual smoke against local Supabase — anon SELECT/INSERT denied; service_role works.
**GREEN**: Write the migration. PK doubles as the natural-key uniqueness for upsert; no extra UNIQUE needed. Index on `(player_key) WHERE machine_id != 'localhost'` for `clearTransientPatches`. The PK prefix already serves `listPatches`.
**MUTATE**: N/A (data definition).
**REFACTOR**: N/A.
**Done when**: Migration applied, RLS verified, ready to commit.

### Step 2: types + handler skeleton (TDD)

**Acceptance criteria**:

- `src/patchRegistry/types.ts` defines the discriminated-union zod schema for all five actions (`upsertPatch`, `removePatch`, `listPatches`, `clearTransientPatches`, `clearAllPatches`). Strict schemas reject unknown fields, including any client-supplied `player_key`.
- Internal types: `PatchRow` (server-stamped player_key + payload fields), result types for each adapter.
- `src/patchRegistry/handler.ts` verifies the envelope, rate-limits by pubkey, dispatches by `action`. Each branch returns the correct `{ status, body }`.
- Adapters are dependency-injected (mirroring `sessionRegistry/handler.ts`).
- `handler.test.ts` covers happy path for each action + each error class (envelope_invalid, payload_malformed, signature_invalid, rate_limited, adapter failures).

**RED**: Write `handler.test.ts` first — mocks for each adapter, asserts each status code + body shape per action variant.
**GREEN**: Write `types.ts` schemas + `handler.ts` dispatch. Reuse the `STATUS_BY_VERIFY_REASON` pattern (third copy now — flag for extraction in Step 9 refactor).
**MUTATE**: Run mutation testing on `handler.ts`.
**KILL MUTANTS**: Strengthen tests for survivors. Ask if any mutant's value is ambiguous.
**REFACTOR**: Defer extraction of shared bits — let it cluster across three handlers and revisit at Step 9.
**Done when**: All five action paths covered, mutation report clean.

### Step 3: `upsertPatch` + `removePatch` Supabase adapters

**Acceptance criteria**:

- `src/patchRegistry/supabaseUpsert.ts` exports `createSupabaseUpsertPatch(upsertRow)` — issues UPSERT (`ON CONFLICT (player_key, machine_id, path) DO UPDATE SET ...`), returns `{ ok }`.
- `src/patchRegistry/supabaseDelete.ts` exports `createSupabaseRemovePatch(deleteRows)` — DELETE WHERE `player_key=me AND machine_id=X AND (path=path OR path LIKE 'path/%')`, returns `{ ok, affected }`.
- Both adapters take an injected query function so tests assert the exact SQL shape (mirrors `supabaseInsert.ts` / `supabaseUpdate.ts` from sessions).
- Tests cover: happy path, supabase error returned, descendant cleanup happens for `removePatch`, descendant prefix calculation handles trailing-slash + non-slash paths.

**RED**: Write `supabaseUpsert.test.ts` + `supabaseDelete.test.ts` asserting the exact mock-fn arguments.
**GREEN**: Implement both adapters. Use the path-prefix logic from `FileSystemContext.broadcastAndRecordPatch` (`path.endsWith('/') ? path : path + '/'`).
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address.
**REFACTOR**: Assess.
**Done when**: Adapters tested, mutation report clean.

### Step 4: `listPatches` + `clearTransientPatches` + `clearAllPatches` Supabase adapters

**Acceptance criteria**:

- `src/patchRegistry/supabaseSelect.ts` exports `createSupabaseListPatches(selectRows)` — SELECT all where `player_key=me`, returns `{ ok, patches: ReadonlyArray<PatchRow> }` with the FileSystemPatch shape (no `player_key` echoed back — caller already knows).
- `src/patchRegistry/supabaseDelete.ts` extends with:
  - `createSupabaseClearTransientPatches(deleteRows)` — DELETE WHERE `player_key=me AND machine_id != 'localhost'`, returns `{ ok, affected }`.
  - `createSupabaseClearAllPatches(deleteRows)` — DELETE WHERE `player_key=me`, returns `{ ok, affected }`.
- All three have tests asserting the exact query shapes.
- The 'localhost' literal lives in one place (next to the existing `PERSISTENT_MACHINE_KEYS` mirror) — single source of truth.

**RED**: Write tests for each adapter.
**GREEN**: Implement.
**MUTATE**: Run.
**KILL MUTANTS**: Address.
**REFACTOR**: Assess.
**Done when**: Five total adapters working, all tests + mutation pass.

### Step 5: Vercel function `/api/patches`

**Acceptance criteria**:

- `api/patches.ts` wires Supabase + Upstash + handler, mirroring `api/sessions.ts` shape.
- Per-pubkey rate limit set higher than sessions (writes are frequent — `nano` save fires one per save). Start at 120/min; revisit if smoke testing reveals tighter need.
- `prefix: 'patches'` on Upstash ratelimit so it doesn't share budget with sessions/allocate-ip.
- All five adapters wired with their underlying supabase calls.

**RED**: N/A — wiring code.
**GREEN**: Write `api/patches.ts`.
**MUTATE**: N/A.
**REFACTOR**: N/A this step (defer to Step 9).
**Done when**: `vercel:dev` smoke test: signed call from a manual test → row visible in local Supabase.

### Step 6: client wrappers

**Acceptance criteria**:

- `src/patchRegistry/client.ts` exports five functions matching the actions: `upsertPatch`, `removePatch`, `listPatches`, `clearTransientPatches`, `clearAllPatches`. Each accepts `(identity, ...args, fetchImpl?)`, signs envelope, POSTs, throws on non-2xx.
- `listPatches` returns `ReadonlyArray<FileSystemPatch>` — server response shape converted to the existing client type.
- `client.test.ts` mocks fetch, asserts envelope shape per action, asserts response handling (success, malformed JSON, server error).

**RED**: Write `client.test.ts` covering each wrapper's success + failure paths + envelope shape assertions.
**GREEN**: Implement using `signRequest` + `postEnvelope` pattern from `sessionRegistry/client.ts`.
**MUTATE**: Run.
**KILL MUTANTS**: Address.
**REFACTOR**: If `postEnvelope` is now duplicated 3x (allocate-ip, sessions, patches) consider extracting to `signedRequest/postEnvelope.ts`. Decision deferred to Step 9.
**Done when**: All wrappers tested, mutation passes.

### Step 7: wire client into `FileSystemContext`

**Acceptance criteria**:

- New `useEffect` on mount calls `listPatches(identity)`, replaces local `patches` state and `fileSystems` (via `applyPatches`) with the server result if it differs from the IndexedDB cache.
- `broadcastAndRecordPatch` fires-and-forgets the right server call:
  - `upsert` for writes (content !== null) and base-file deletions (content === null AND !existing.isNew)
  - `remove` for isNew-cleanup deletions (content === null AND existing.isNew)
- Mission/home transition `useEffect` (FileSystemContext.tsx:168-203) fires-and-forgets `clearTransientPatches` after the local filter runs.
- All existing `FileSystemContext` tests continue to pass; new tests cover server-call dispatch (using injected client fns rather than mocking the global module).
- May need to expose an injectable `clientApi` prop or refactor the imports — keep cost low, follow whatever pattern makes tests cleanest.
- `useIdentity()` (from `src/identity/`) is the source of the player keypair for signed calls.

**RED**: New tests in (or alongside) `FileSystemContext.test.tsx` — mocks the wrapper fns, asserts they're called with expected args on each scenario (write, create, delete-isNew, delete-base, mission-transition, mount).
**GREEN**: Wire the calls. Match the SessionContext fire-and-forget pattern from `feedback_react_context_server_integration.md` — the React state setter runs synchronously, the server call runs alongside, callers don't await.
**MUTATE**: Run.
**KILL MUTANTS**: Address.
**REFACTOR**: Identify duplication with SessionContext rehydration. Probably defer extraction.
**Done when**: Patches flow client → server, server → client on mount, all tests pass. Smoke test in vercel:dev: open two browser windows on the same identity → patch in window A appears in window B after reload.

### Step 8: wire `clearAllPatches` into `reset.ts`

**Acceptance criteria**:

- `createResetCommand` accepts an optional `clearAllPatches: () => Promise<void>` in its context (or whatever shape matches the existing `getDatabase` injection style).
- Before reload, fires-and-forgets the server-side wipe alongside `clearAllData(db)`.
- Reset still completes if the server call rejects (page reload regardless — wipe is best-effort to defeat ghost-rehydration).
- App.tsx (or wherever the command is constructed) supplies the wrapper bound to the current identity.

**RED**: `reset.test.ts` — assert `clearAllPatches` is invoked when supplied; reset still completes if it rejects.
**GREEN**: Wire it.
**MUTATE**: Run.
**KILL MUTANTS**: Address.
**REFACTOR**: Assess.
**Done when**: Reset wipes server-side rows too. Smoke test: reset confirm → Supabase row count for this player_key drops to zero.

### Step 9: pre-PR quality gate

**Acceptance criteria**:

- `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green
- Mutation testing summary clean across all new files
- Refactoring assessment done — decide on STATUS_BY_VERIFY_REASON / postEnvelope extraction (or explicitly defer with a note)
- New `src/patchRegistry/README.md` mirroring `src/sessionRegistry/README.md`
- `docs/technology-choices.md` — add Patches row to "Stack at a glance" + a short Patches section explaining the upsert + transient/all-clear strategy
- `docs/architecture.md` — defer (batch with the rest of multiplayer at end of phase, per the user's preference)
- Version bump in `package.json` + `package-lock.json` (0.101.0 → 0.102.0)
- Plan file (this) deleted, `plans/` pruned if empty

**Done when**: PR opened, all gates pass, ready to merge.

## Pre-PR Quality Gate

Before merging:

1. Mutation testing — run `mutation-testing` skill across new files
2. Refactoring assessment — run `refactoring` skill
3. Typecheck + lint + format + tests pass
4. End-to-end smoke test on `vercel:dev`:
   - Write a file via `nano` in mission → row appears in Supabase
   - Reload page → patch survives (rehydrated from server)
   - Open second tab on same identity → patch visible after reload
   - Mission transition → transient rows deleted server-side
   - `reset confirm` → all rows deleted server-side

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
