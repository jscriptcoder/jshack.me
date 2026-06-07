# Plan: Server-authoritative session persistence (survive refresh)

**Branch**: feat/session-persistence
**Status**: Active

## Goal

A `su` elevation survives a browser refresh: after `su root`, reloading the page still shows the `root@… #` prompt — because the hop chain is now a server-authoritative `sessions` table, rehydrated on boot. The table/endpoints are shaped so `ssh` (cross-machine, credential-validated sessions) slots in later without reshaping.

## Why server-authoritative (not localStorage)

Decided with the user: the v2 architecture is multiplayer-first / server-authoritative, hop-chain is a named L3 anti-cheat target, and `ssh` (coming next) needs server-validated, cross-machine sessions with `source_ip` for access.log realism. A localStorage cache would be forgeable and thrown away when `ssh` lands. We port the **legacy `sessions` model** (`api/sessions.ts` + `src/sessionRegistry/*`), adapted to v2's signed-envelope infra.

## Architecture (mirrors v2's `appendAuthLog`)

- **New table** `sessions` (migration): `session_id PK`, `player_key` (server-stamped from the verified Ed25519 pubkey, never a client claim), `machine_id`, `credentials JSONB {username,userType}`, `parent_session_id`, `source_ip`, `kind`, `created_at`, `ended_at` (null = active), `end_reason`. RLS enabled, no policies — `service_role` only, same posture as `patches`.
- **New endpoint** `v2/api/sessions.ts` + pure handlers under `v2/src/core/sessions/{createSession,listSessions,endSession}.ts`, reusing `verifySignedRequest`, `isOwnWorkstation`, `STATUS_BY_VERIFY_REASON`, and the noop `nonceStore` — exactly like `core/patches/appendAuthLog.ts`.
- **New client adapter** `v2/src/adapters/sessionsApi.ts` (sign + POST), like `adapters/patchApi.ts`.
- **Client-generated `session_id`** (a uuid the client mints and sends as the row PK). This keeps `pushSession`/`popSession` **fire-and-forget** (no `await` to learn a server id — see the "server-side concerns alongside optimistic setters" rule and "real latency over fake delays") while still letting `endSession` target the exact row. The base login (`seed-session`) stays **implicit and unpersisted**, like legacy's implicit `localhost` — only *pushed* sessions get server rows.
- **Rehydration**: `startGame` seeds the base session as today, then `listSessions` (own workstation, active) and replays the rows (ordered by `created_at`) onto the stack.

### su-only scope vs ssh-readiness (don't gold-plate)

The table carries `parent_session_id` / `source_ip` / `kind` / `ended_at` columns (cheap, ssh-ready, matches legacy), but these su slices only **wire** what `su` needs: own-workstation `createSession`, `listSessions` of active rows, `endSession` on exit. **Deferred to the ssh epic:** `authCreateSession` (server-side credential validation against a *foreign* machine's `/etc/passwd`), cascade-end of child sessions, and `source_ip` realism. Listed at the bottom so they aren't lost.

## Acceptance Criteria

- [ ] After `su root`, a browser refresh keeps the active session as `root` (prompt shows `#`, root-tier reads succeed).
- [ ] A forged/non-own-workstation `createSession` is rejected (403/verify-reason), matching `appendAuthLog`'s gate.
- [ ] After `su root` then `exit`, a refresh comes back as the original `user` (de-elevation is durable; no lingering server session re-elevates).
- [ ] A stacked elevation (`su root` → `su someuser`) rehydrates both levels in original order with correct tiers.
- [ ] The base login session is never written to the `sessions` table (only pushed sessions are).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Slice 1: A `su` elevation survives a browser refresh

**Value**: A player who elevates with `su` stays elevated after reloading the page (or a crash/restore) instead of silently dropping back to their login user.
**Path**: `su` → `env.pushSession` (UI) → fire-and-forget `createSession` (signed, own-workstation, `kind='su'`, client-minted `session_id`) → `sessions` row. On reload: `startGame` seeds base → `listSessions` (own, `ended_at IS NULL`, ordered by `created_at`) → replay rows onto `sessionStack`, reconstructing `returnCwdStack` lossily (restore-to-home, named below). **Skipped this slice:** `exit` durability (server session lingers after a local pop — closed in Slice 2); exact-cwd restore on exit-after-rehydrate (we restore to the restored user's home, matching legacy's lossy `currentPath`).
**Required implementation skills**: Before code, load `tdd`, `testing`, `mutation-testing`, `refactoring`. Touches a new Vercel endpoint + Supabase migration (see CLAUDE.md verification commands; v2 uses `npm run lint`, no Prettier).
**Acceptance criteria** (confirm before coding):
  - `handleCreateSession`: a valid signed envelope for the caller's OWN workstation inserts a row with server-stamped `player_key`, `kind='su'`, the client `session_id`, `credentials={username,userType}`; a non-own `machine_id` returns 403; a bad signature/replay returns the verify-reason status.
  - `handleListSessions`: returns active (`ended_at IS NULL`) rows for the verified `player_key` + own machine, ordered by `created_at`.
  - UI: `pushSession` fires `createSession` (fire-and-forget, errors swallowed like `appendAuthLog`); the base `seed-session` is never sent.
  - UI rehydrate: `startGame` rebuilds the stack from `listSessions`; a single persisted `su root` row yields an active root session on top of the base, with `returnCwdStack` holding one entry (the base user's home).
  - Manual UI verification (v2 has no committed Playwright harness — prior v2 slices verify new primitives through the real UI + network tab): with the `sessions` migration applied and the dev server up, `su root` → reload → prompt is `root@… #` and a root-only read confirms the tier survived. Watch the network tab for the `createSession`/`listSessions` round-trips.
**RED**: handler unit tests (own-workstation insert, 403 on foreign machine, verify-reason passthrough — watch `mutator-rules` for the `isOwnWorkstation` boundary and the `ended_at IS NULL` filter being negated/dropped); a rebuild-from-rows unit test (1 row → 2-deep stack, correct order + `returnCwdStack` length); the E2E reload assertion.
**GREEN**: migration + `core/sessions/{createSession,listSessions}.ts` + `adapters/sessionsApi.ts` + `api/sessions.ts` router + wire `pushSession` and `startGame` rehydrate.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills; expect equivalent-mutant calls on type-narrowing/load-throw per the recorded Stryker rules.
**Done when**: criteria met, mutation report reviewed, human approves commit.

### Slice 2: `exit` is durable — de-elevation survives a refresh

**Value**: A player who `exit`s back down the stack stays de-elevated after a reload (and the Slice-1 gap where a lingering server row re-elevates on refresh is closed).
**Path**: `exit` → `env.popSession` (UI) → fire-and-forget `endSession(session_id, reason='user_exit')` → row's `ended_at` stamped → next `listSessions` omits it.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before coding):
  - `handleEndSession`: a valid signed envelope sets `ended_at`/`end_reason` for a row owned by the verified `player_key`; a session not owned by the caller is rejected/no-op.
  - UI: `popSession` fires `endSession` with the popped session's `session_id` (fire-and-forget, swallowed); popping the base session is a no-op (it has no server row).
  - E2E: `su root` → `exit` → reload → prompt is back to the login user.
**RED**: `handleEndSession` unit tests (ownership gate, `ended_at` set, `end_reason` recorded — watch the ownership predicate and the reason field for mutants); UI test that `popSession` calls `endSession` with the right id and base-pop does not; E2E reload-after-exit.
**GREEN**: `core/sessions/endSession.ts` + router branch + wire `popSession`.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, human approves commit.

> Slices 1 and 2 are a natural pair (persistence + its inverse). They're split for review size and because each is independently testable; they may be landed as one PR if the reviewer prefers — confirm at planning time.

## Deferred (unlocks the `ssh` epic — NOT in this plan)

- `authCreateSession`: server-side credential validation against a **foreign** machine's `/etc/passwd` (own-workstation `su` doesn't need it — the player already proved root by reading their own passwd).
- `source_ip` denormalization (immediate parent's machine) for access.log realism.
- Cascade-end: when a parent session ends, end its children (recursive `UPDATE` adapter, per legacy `supabaseUpdate.ts`).
- Cross-tab/Realtime session sync (today only patches sync cross-tab).

## Pre-PR Quality Gate

1. Mutation testing (`mutation-testing` skill) — don't run alongside the v2 dev server (recorded contention gotcha).
2. Refactoring assessment (`refactoring` skill).
3. `npm run build` + `npm run lint` (v2 has no Prettier) + `npm run test:run`; `npm run test:e2e` for the reload flow.
4. Bump version (semver) in `package.json` + `package-lock.json` after the feature lands.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
