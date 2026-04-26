# Plan: Server-authoritative sessions

**Branch**: `feat/server-sessions`
**Status**: Active

## Goal

Replace the client-side session stack with a server-authoritative `sessions` table on Supabase, queried via signed Vercel endpoints. Server becomes the truth on "does player X have an active session on machine Y?".

## Acceptance Criteria

- [ ] `sessions` table exists in Supabase with the planned columns + RLS (SELECT own rows; INSERT/UPDATE/DELETE denied for anon)
- [ ] Single signed Vercel endpoint `POST /api/sessions` with action-dispatch (`createSession` / `endSession` / `listSessions`). One verify+rate-limit+nonce path, action-handler routing from there. Reuses `signedRequest` machinery.
- [ ] Client wrappers (`createSession`, `endSession`, `listSessions`) with full unit tests
- [ ] `SessionContext.pushSession` and `popSession` round-trip through the server
- [ ] `popAllSessions` cascades end on the server (children inherit `end_reason='cascade'`)
- [ ] Page-load rehydrates the local stack from `GET /api/sessions`
- [ ] Smoke test: marking a session ended via SQL is reflected on the next client interaction
- [ ] All existing session tests pass (no regressions)
- [ ] No Realtime subscription (deferred to Phase 2 PR)
- [ ] No patch-validation integration (deferred to Phase 4 PR)

## Schema reference

```
sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key        TEXT NOT NULL,                -- hex Ed25519 pubkey
  machine_id        TEXT NOT NULL,                -- target machine IP
  credentials       JSONB NOT NULL,               -- { username, userType }
  parent_session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  source_ip         TEXT,                         -- parent's machine_id, denormalized for access.log realism
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT
);
```

RLS: `SELECT` allowed where `player_key = <verified pubkey from JWT/header>` (or use service-role-only access via Vercel function — TBD per security model). `INSERT/UPDATE/DELETE` denied for anon.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test (except migrations — see Step 1 note).

### Step 1: Migration — sessions table + RLS policies

**Acceptance criteria**: `npx supabase db reset` succeeds; `sessions` table exists with the planned columns and types; RLS is enabled; `SELECT` policy allows reading rows where `player_key` matches a placeholder (TBD how to extract verified pubkey at the SQL level — service-role-only for now is simplest; if so, all reads also go via Vercel function); `INSERT/UPDATE/DELETE` have no policies (denied by default for anon/authenticated).
**RED**: Migration is config — no traditional unit test. Verification is `supabase db reset` clean apply + manual `INSERT` succeeds with service_role key, fails with anon key. Subsequent steps' tests will indirectly verify schema correctness.
**GREEN**: Write `supabase/migrations/<timestamp>_sessions.sql` with table + RLS policies.
**MUTATE**: N/A for SQL migration.
**KILL MUTANTS**: N/A.
**REFACTOR**: N/A.
**Done when**: Migration applies cleanly locally, manual insert/select via service_role works, anon-key insert is denied.

### Step 2: `POST /api/sessions` handler

**Acceptance criteria**: A signed envelope with `action: 'createSession'` and `{machine_id, credentials, parent_session_id?, source_ip?}` returns `{session_id}` on success. owner stamped from verified pubkey (clients can't claim ownership). Strict zod schema rejects unknown fields. All `verifySignedRequest` failure modes (envelope_invalid / signature_invalid / replay / etc.) return appropriate statuses.
**RED**: Write handler test asserting 200 on valid envelope, owner stamped, row inserted with correct shape.
**GREEN**: New module `src/sessionRegistry/` with `handler.ts` + `types.ts` + `supabaseInsert.ts`. Mirror `ipRegistry/` structure.
**MUTATE**: Run mutation testing skill on the handler.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Assess shared structure with `ipRegistry/handler.ts` — possible helper extraction for the verify+rate-limit boilerplate.
**Done when**: Handler unit tests pass; mutation report reviewed; commit approved.

### Step 3: `DELETE /api/sessions/:id` handler — end session

**Acceptance criteria**: Signed envelope with `action: 'endSession'` and `{session_id, reason}` marks `ended_at = NOW(), end_reason = reason` on the row. Rejects 403 if `session_id` belongs to another `player_key`. 404 if session doesn't exist or is already ended.
**RED**: Handler tests for owner-end success, non-owner rejection, already-ended rejection.
**GREEN**: Add `endSession` action to handler (single endpoint dispatching by action, or separate handler module — TBD).
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: All end-session tests pass; mutation report reviewed; commit approved.

### Step 4: `GET /api/sessions` handler — list my active sessions

**Acceptance criteria**: Signed envelope with `action: 'listSessions'` returns array of active sessions where `player_key = verified pubkey` (filtered server-side). Ended sessions excluded. Replay/signature checks apply normally.
**RED**: Handler tests for return-shape, player-isolation (only own rows).
**GREEN**: Add `listSessions` action.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: List-session tests pass; mutation report reviewed; commit approved.

### Step 5: Cascade-end logic

**Acceptance criteria**: When a session is ended (Step 3), all child sessions (where `parent_session_id = ended_id`) are also marked `ended_at = NOW(), end_reason = 'cascade'`. Recursively for grandchildren. Single SQL operation server-side.
**RED**: Handler test for parent-end → grandchild ended.
**GREEN**: Add recursive CTE or trigger on the end-session SQL path.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: Cascade tests pass; mutation report reviewed; commit approved.

### Step 6: Client wrappers — `createSession`, `endSession`, `listSessions`

**Acceptance criteria**: Browser-side functions take `Identity` and request fields, sign via `signedRequest`, POST/DELETE/GET `/api/sessions[*]`, return parsed response. Throw on non-2xx. Match the pattern of `allocatePublicIp`.
**RED**: Client wrapper tests with mocked fetch — assert signed envelope shape, response parsing, error-throwing.
**GREEN**: New file `src/sessionRegistry/client.ts`.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: Client wrapper tests pass; mutation report reviewed; commit approved.

### Step 7: Wire `createSession` into `SessionContext.pushSession`

**Acceptance criteria**: `pushSession(reason)` becomes async, calls `createSession({machine_id, credentials, parent_session_id?, source_ip?})`, stores returned `session_id` in the local stack entry. Existing tests for the local stack still pass (with awaits added). New test: pushing creates a server record with the right shape.
**RED**: SessionContext test asserting `createSession` is called with correct payload on `pushSession`.
**GREEN**: Update `SessionContext.tsx` to await server call before mutating local state. Update affected tests with `await`.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: All session context tests pass; mutation report reviewed; commit approved.

### Step 8: Wire `endSession` into `popSession` and `popAllSessions`

**Acceptance criteria**: `popSession()` ends the top-of-stack session server-side (using stored `session_id`), then mutates local state. `popAllSessions()` ends the bottom-of-stack server-side (cascade does the rest). Both async. Existing tests pass.
**RED**: SessionContext tests asserting `endSession` is called on pop / popAll, with appropriate `reason`.
**GREEN**: Update `popSession` and `popAllSessions` to await server calls.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: All pop-session tests pass; mutation report reviewed; commit approved.

### Step 9: Rehydrate stack from server on page load

**Acceptance criteria**: On `SessionProvider` mount, call `listSessions()` and rebuild the local stack from server state (most-recent-first ordering). UI shows a brief "Restoring sessions…" indicator during the await. If server returns empty, stack is empty (no synthetic localhost entry).
**RED**: SessionProvider test: mount → fetch returns sessions → stack populated.
**GREEN**: `useEffect` in SessionProvider calling `listSessions`. Loading state via existing `useState<boolean>`.
**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: Rehydration tests pass; manual smoke test (refresh page, sessions restore); commit approved.

### Step 10: Pre-PR quality gate

**Acceptance criteria**: Build, lint, format:check, full test suite pass. Mutation testing summary across new modules. Refactoring assessment per `refactoring` skill.
**Done when**: All green; PR description drafted; ready to push.

## Pre-PR Quality Gate

Before pushing the PR:

1. Mutation testing across new code in `src/sessionRegistry/` and modified code in `src/session/` — run `mutation-testing` skill.
2. Refactoring assessment — run `refactoring` skill. Check for shared abstractions with `ipRegistry/`.
3. `npm run build` + `npm run lint` + `npm run format:check` + `npm run test:run` all pass.
4. Smoke test in `vercel:dev`: console-test create + list + end session round-trip; verify rows in Supabase Studio.
5. Update `docs/technology-choices.md` if any new design decisions emerged (e.g., cascade strategy, RLS approach).
6. Add `src/sessionRegistry/README.md` mirroring the `ipRegistry/README.md` pattern.

---

_Delete this file when the plan is complete._
