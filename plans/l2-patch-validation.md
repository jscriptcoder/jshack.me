# Plan: L2 Patch Validation

**Branch**: `l2-patch-validation`
**Status**: **Attempt — may be abandoned**

> This work is exploratory. The user may abandon the L2 attempt at any step if scope balloons, determinism doesn't hold, or the cost outweighs the benefit pre-launch. If abandoned, the entire branch is reverted and project memory is unchanged. **No memory entries should be updated until the user explicitly confirms the attempt has succeeded and is being kept.**

## Goal

Close within-session privilege escalation in multiplayer by checking, server-side, that the active session's credentials actually have permission for the requested filesystem mutation on the target machine — completing the security posture started by L1 (PR #78).

## Background

L1 (shipped) gates patch mutations on "you have an active session on this machine". L2 closes the next gap: a player who legitimately holds a **guest** session on a remote machine can today still ask the server to delete `/etc/shadow` or modify `/root/*`, and the server has no way to refuse beyond the session check. The client wouldn't allow it, but the server is the only boundary that matters under the threat model (Burp/ZAP/custom-client are the same threat).

This plan implements **full L2** (not L2-narrow or L2-leaf) because the user wants a security-implementation showcase suitable for hardening ahead of launch.

## Architecture (locked in: Pattern A — eager denormalization)

A new table `machine_filesystems` mirrors current FS state, dual-written in the same transaction as every successful `upsertPatch` / `removePatch`. L2 reads `machine_filesystems` directly to walk permissions on the path and its parent chain.

**Why Pattern A (not the alternatives)**:

- _Lazy on-demand cache_: cold-start path defeats the purpose — the slowest call is the one we care about.
- _Regenerate-from-seed-on-each-check_: ~100 ms–2 s per call; unworkable inside a synchronous handler.
- _Pattern A_: always current, never wrong, no cache-invalidation logic, single-digit MB at indie scale.

**localhost / own-workstation handling**: a player's own workstation (`${workstation_name}-${first-8-hex(player_key)}`) is excluded from `machine_filesystems`. The player owns their own box; L2 is skipped there. Mission/home/themed/playground machines all go through L2.

## Acceptance Criteria

Behaviour-driven, observable from the wire / from the player's perspective. Every criterion is a separate test target.

- [ ] An attacker holding a guest-shell session on machine X cannot persist a patch that mutates a root-owned path on X — the server returns 403 with reason `permission_denied`, and `patches` and `machine_filesystems` are unchanged.
- [ ] An authenticated root session on machine X can mutate any path on X subject to existing filesystem rules; the corresponding row appears in both `patches` and `machine_filesystems`.
- [ ] Cascade-delete semantics that exist for `patches` today (`rm -rf /foo` removing `/foo/**`) are mirrored in `machine_filesystems` — no orphaned rows.
- [ ] Permission denials are written to the audit log with reason `permission_denied` and the failing path/uid/gid combination.
- [ ] Player-owned workstation patches continue to bypass L2 (no `machine_filesystems` row written, no walker invocation).
- [ ] Existing single-player mission playthroughs and the two-browser cross-player smoke test pass end-to-end with L2 enabled.
- [ ] The server-side permission walker is byte-for-byte equivalent to the client's `canRead` / `canWrite` / `canTraverseOnMachine` for a representative property-test corpus.

## Risks and Exit Ramps

| Risk | Mitigation | Exit ramp if it bites |
| --- | --- | --- |
| Determinism mismatch (FS generator differs Node vs browser) | Step 1 gate: 1k-seed cross-check before any other code lands. | Drop to **L2-leaf** (3–4 weeks): full table + dual-write, but only check leaf-file owner+perms. Skip parent-chain walk. |
| Permission walker drifts client vs server | Single shared module both sides import. Watch bundle size. | Drop to **L2-narrow** (1–2 weeks): hardcode checks on `/etc/passwd`, `/etc/shadow`, `/root/*`, `/boot/*`. No walker, no shared module. |
| 50–100 existing tests break (they simulate remote-machine patches with no matching session credentials) | Update test factories to stamp matching credentials. Address in waves per step. | None — this is unavoidable cleanup. |
| Backfill misses edge cases on live machines (nulls, malformed permissions) | Idempotent script + dry-run mode + small-batch staging run before prod. | Re-run with stricter validation. |

If at any step the work balloons beyond estimate, **stop and re-evaluate** with the user. The exit ramps above are pre-approved fallbacks; do not silently expand scope. Abandoning the attempt entirely (revert the branch, return to L1-only) is also a valid outcome at any decision point — this is an attempt, not a commitment.

## PR Sequencing

The plan-only PR (this file) is **PR 0**. Implementation lands in 8 follow-up PRs on the same branch, each independently reviewable and revertable.

| # | Title | Step |
| --- | --- | --- |
| 0 | `plan: L2 patch validation` | This file |
| 1 | `chore(security): determinism cross-check for FS generator` | Step 1 |
| 2 | `feat(security): machine_filesystems schema + RLS` | Step 2 |
| 3 | `feat(security): dual-write patches → machine_filesystems` | Step 3 |
| 4 | `feat(security): shared FS permission walker` | Step 4 |
| 5 | `feat(security): stamp verified credentials on session create` | Step 5 |
| 6 | `feat(security): wire L2 permission walk in handler` | Step 6 |
| 7 | `chore(security): backfill machine_filesystems for live data` | Step 7 |
| 8 | `docs(security): L2 architecture + tech-choices update` | Step 8 |

## Steps

Every code-bearing step follows **RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR**. Tests describe observable behaviour, not call-graphs.

---

### Step 1: Determinism gate — server-side FS generator cross-check

This is a **gate**, not a feature. If determinism doesn't hold, Pattern A is at risk and we stop and discuss with the user before proceeding. The expected outcome is "the test passes on first run" — the value is the regression guard going forward, not a discovery this run.

**RED**: A property test that, for 1000 seeded mission inputs, runs `generateFileSystems` twice — once in the existing client codepath, once via direct `import` into a Node-only test file — and asserts deep equality of the resulting filesystem trees: paths, owners, permissions JSON, content hashes, node_type, and node ordering. Test is initially expected to pass; it fails only if a generator change introduces non-determinism (Map iteration order, reliance on `Date.now()`, async race, environment globals).

**GREEN**: If the test passes on first run, no production code changes. If it fails, identify the divergence (likely candidates: unsorted `Map`/`Set` iteration, `Math.random` outside the seeded `Prng`, non-deterministic async ordering) and fix the generator to make the diff deterministic. Land the fix in this same PR.

**MUTATE**: Run `mutation-testing` skill against `src/generation/filesystem/` modules to baseline coverage. Goal: surface any mutants on the generator that current tests don't kill — these become candidates for later test additions, since L2 will lean on the generator's correctness.

**KILL MUTANTS**: Add tests for any high-value surviving mutants (e.g. mutants that flip ownership assignment or permission bits). Skip cosmetic mutants (e.g. error-message string mutations).

**REFACTOR**: Only if a determinism fix introduced new complexity worth simplifying. Otherwise skip.

**Done when**:

- 1000-seed equivalence test passes in CI (Node) and locally (browser via `vitest --browser`).
- Mutation report on the FS generator captured in the PR description.
- A short note in the plan / architecture doc records the verdict ("determinism holds, Pattern A confirmed").

---

### Step 2: `machine_filesystems` schema + migration + RLS

**RED**: An integration test (real Supabase via the project's existing test fixtures) that:
- Asserts the `machine_filesystems` table exists with the expected columns and PK.
- Asserts that an attempt to `INSERT` from an anon-keyed client is rejected by RLS.
- Asserts that an attempt to `SELECT` from anon is rejected (server-only table).
- Asserts that `service_role` writes/reads succeed.

**GREEN**: Author a single migration `supabase/migrations/<ts>_machine_filesystems.sql` matching the existing migration style. Columns mirror `patches` minus `player_key`, plus indexing for prefix queries:

```sql
CREATE TABLE machine_filesystems (
  machine_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  owner        TEXT NOT NULL,
  permissions  JSONB NOT NULL,
  node_type    TEXT NOT NULL,
  content      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (machine_id, path)
);

CREATE INDEX machine_filesystems_path_prefix
  ON machine_filesystems (machine_id, path text_pattern_ops);

ALTER TABLE machine_filesystems ENABLE ROW LEVEL SECURITY;
-- No anon policies — only service_role may read/write.
```

**MUTATE**: Limited applicability for raw SQL. Confirm any helper code introduced (e.g. column constants in TS) is mutation-tested via callers in Step 3.

**KILL MUTANTS**: N/A for this step.

**REFACTOR**: Skip; schema is intentionally minimal.

**Done when**:

- Migration applies cleanly against a fresh local DB.
- RLS integration test passes.
- No anon path can read or write the table.

---

### Step 3: Dual-write `patches` → `machine_filesystems`

**RED**: Integration tests against a real Supabase test instance:
- A successful `upsertPatch` results in a row in `machine_filesystems` with matching `(machine_id, path, owner, permissions, node_type, content)`. Subsequent `upsertPatch` on the same path replaces the row.
- A successful `removePatch` for an exact path removes the matching `machine_filesystems` row.
- A `removePatch` with a path-prefix cascade (e.g. `rm -rf /foo`) removes all `machine_filesystems` rows under `/foo/`.
- A `upsertPatch` against the player's **own** `workstation_id` does NOT create a `machine_filesystems` row (own-box bypass).
- If `machine_filesystems` write fails, the `patches` write is rolled back (transactional integrity).

**GREEN**: Modify `src/patchRegistry/supabaseUpsert.ts` and `src/patchRegistry/supabaseDelete.ts` to issue the dual write inside a single Postgres transaction (Supabase RPC or explicit `BEGIN` block). Add a small `isOwnWorkstation(machine_id, player_key)` predicate used to skip the dual-write.

**MUTATE**: Run `mutation-testing` against `supabaseUpsert.ts` / `supabaseDelete.ts`. Targets: incorrect SQL operators (`=` vs `LIKE`), inverted own-workstation check, missing transactional rollback, incorrect column mapping.

**KILL MUTANTS**: Add tests for surviving mutants. Especially important: cascade prefix-match edge cases (`/foo` should not delete `/foobar`).

**REFACTOR**: If both upsert and delete share parallel projection logic, extract a `projectToMachineFilesystems` helper and assess whether it's clearer.

**Done when**:

- All five behaviours above are covered by passing tests.
- Mutation rate ≥ 80% on the dual-write code.
- Existing handler tests still pass (no regression).

---

### Step 4: Shared FS permission walker

**RED**: Property-style tests for a single shared `walkPermission(node, parentChain, requester)` function. Cases include:
- Owner read/write/execute matches `permissions.owner` bits.
- Group membership matches `permissions.group` bits.
- Other falls back to `permissions.other` bits.
- Parent-chain traversal: missing execute on any parent dir denies access to a child even if the child's perms allow.
- Root user (uid 0) bypasses owner/group checks but still respects "no permission set" cases per Linux semantics.
- Symlinks (if present in the FS model) follow target permissions.

The test corpus is generated from the existing client-side fixtures so client and server stay in sync.

**GREEN**: Extract the existing client logic from `src/filesystem/FileSystemContext.tsx` (`canRead`, `canWrite`, `checkTraversal`) into a new pure module `src/filesystem/permissionWalker.ts`. Both `FileSystemContext.tsx` and the server handler import from this module. No behaviour change client-side.

**MUTATE**: Run `mutation-testing` on the new module. Permission logic is dense with branching — high mutation rate matters.

**KILL MUTANTS**: Address every surviving mutant. Permission code is security-critical; a missed mutant is a real bug.

**REFACTOR**: Once green, assess: are the three `canRead`/`canWrite`/`canExecute` exports thin wrappers around a single core walker? Can the parent-chain walk be a separate composable function?

**Done when**:

- Walker is a pure, importable module.
- Client `FileSystemContext` imports from it (no behaviour change in single-player playtest).
- Mutation rate ≥ 85%.

---

### Step 5: Stamp verified credentials on session create

**RED**: An integration test that creates a session via the existing flow (login / `su` / exploit) and asserts:
- The persisted session row contains the resolved `uid` (numeric) and `groups` (array) for that user on that machine, derived from `/etc/passwd` + `/etc/group` at session creation time.
- A subsequent `su` session inherits the new uid/groups, not the parent's.
- Reading the session back via `findActiveSession` returns the credentials in a typed shape consumable by the L2 walker.

**GREEN**: 
- Migration: add `uid INTEGER NOT NULL`, `groups TEXT[] NOT NULL DEFAULT '{}'` to `sessions`.
- Modify session-create paths to resolve uid/groups from `/etc/passwd` / `/etc/group` at creation. (These are server-side reads against `machine_filesystems` once Step 3 has landed — explicit dependency.)
- Update `findActiveSession` return shape and consumers.

**MUTATE**: Mutation testing on session-create resolution. Targets: wrong column read, off-by-one on group parsing, missing default-group inclusion.

**KILL MUTANTS**: Address surviving mutants in resolution logic.

**REFACTOR**: Assess whether `parseEtcPasswd` / `parseEtcGroup` deserve their own tested module.

**Done when**:

- Sessions persist verified uid + groups.
- All session-creation entry points (login / `su` / exploit / protocol sessions) populate them.
- Walker (Step 4) can consume them by type.

---

### Step 6: Wire L2 permission walk in handler

**RED**: Handler-level tests against a real Supabase test instance:
- Guest session on remote machine attempts to write to `/etc/shadow` → 403 `permission_denied`. No row in `patches` or `machine_filesystems`. Audit log entry written.
- Root session on same remote machine writes to `/etc/shadow` → success. Rows in both tables.
- Player writes to their own workstation as guest → success (own-box bypass; L2 skipped).
- Walker rejection vs. session rejection are distinguishable in the response (`reason` field).

**GREEN**: Insert L2 check in `src/patchRegistry/handler.ts` immediately after `requireActiveSession` returns. The check:
1. Looks up the target node in `machine_filesystems` (path + parent chain).
2. Calls `walkPermission(...)` with the verified credentials from the session.
3. On deny: returns 403 with `reason: 'permission_denied'`, writes audit log, no DB mutation.
4. On allow: proceeds to the existing `upsertPatch` / `removePatch` path.

**MUTATE**: Run `mutation-testing` on the handler integration. Targets: skipped own-box check, missing audit log, returning 200 on deny.

**KILL MUTANTS**: Address every surviving mutant — handler code is the security boundary.

**REFACTOR**: Assess whether the L2 check belongs as a small composable middleware-style function or stays inline. Either is fine; pick the one that keeps the handler readable.

**Done when**:

- All four handler tests pass.
- Mutation rate ≥ 85% on the L2 wiring.
- Manual two-browser playtest: cross-player guest cannot delete cross-player root-owned file.
- Existing single-player mission flow plays end-to-end without 403s on legitimate moves.

---

### Step 7: Backfill `machine_filesystems` for live data

**RED**: An integration test that runs the backfill script against a fixture DB containing:
- Patches on a normal mission machine → `machine_filesystems` rows match exactly.
- Patches on a player's own workstation → no rows written (own-box bypass).
- Re-running the script is idempotent (no duplicates, no diffs).
- A dry-run flag prints the planned writes without executing.

**GREEN**: Write `scripts/backfillMachineFilesystems.ts` mirroring the project's existing debug-script style. Reads `patches`, projects each row to `machine_filesystems`, batches inserts. Includes `--dry-run` and explicit per-machine progress logging.

**MUTATE**: Limited — script-level. Confirm core projection logic (extracted as a helper in Step 3) is already mutation-covered.

**KILL MUTANTS**: N/A for new code in this step.

**REFACTOR**: Skip; one-shot script.

**Done when**:

- Script runs idempotently against a staging snapshot of prod data with zero diffs after second run.
- Dry-run output reviewed and matches expectations.

---

### Step 8: Docs + memory updates

No production code, no tests. Doc updates only.

**Done when**:

- `docs/architecture.md` describes L2, the walker, and `machine_filesystems`.
- `docs/technology-choices.md` records the Pattern A decision and the rejected alternatives, citing this plan.
- Project `README.md` mentions L2 in the security posture section.
- Per-module READMEs updated where touched (`src/patchRegistry/README.md`, etc.).
- The L2 memory entry (`memory/project_l2_plan.md`) flipped from "deferred" to "shipped" — **only after the user explicitly confirms the L2 attempt has succeeded and is being kept**. If the user abandons the attempt at any earlier step, leave memory entirely unchanged; the branch revert handles cleanup.

---

## Pre-PR Quality Gate

Before each of PRs 1–8 (and before promoting this plan PR out of draft, for that matter):

1. **Mutation testing** — run the `mutation-testing` skill on changed files. Capture the report in the PR description.
2. **Refactoring assessment** — run the `refactoring` skill. Apply only refactors that add real value.
3. **Typecheck and lint** — `npm run build`, `npm run lint`, `npm run format:check` all pass.
4. **Test suite** — `npm run test:run` green; `npm run test:e2e` green at end of Steps 3, 6, and 7.
5. **DDD glossary check** — N/A for this project.

## Reference

- Memory: `memory/project_l2_plan.md` — original architecture decision and estimate.
- Memory: `memory/project_multiplayer_security_model.md` — threat model L2 fits within.
- Memory: `memory/feedback_multiplayer_ship_first.md` — the stance that deferred L2 originally; revisit if scope balloons.
- Memory: `memory/project_workstation_id_model.md` — own-workstation bypass relies on this.
- PR #78 — L1 implementation, the layer L2 sits on top of.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
