# Plan: L2 Own-Workstation Base-FS Backfill

**Branch**: `l2-own-workstation-backfill`
**Status**: Active
**Tracks**: `project_l2_followups.md` chunk #1b — currently the highest-severity open L2 gap.

## Goal

Close the leaf-only fallback on the player's own workstation by populating `machine_filesystems` with the workstation's base FS at first boot, so non-owner sessions (intruders with cracked credentials) hit a real walker check instead of the silent permit branch.

## Background

L2 shipped 2026-05-03 (PR #98) for home networks; world networks followed 2026-05-04. Both chunks rely on `machine_filesystems` having one row per FileNode in the base FS. The own-workstation case was deliberately deferred — the OWNER is bypassed via `isOwnWorkstationOnServer`, so the absence of rows didn't matter for own writes.

**The gap**: `enforceL2` falls into `if (!fsResult.found) return null;` (permissive) when no rows exist. For non-owners the bypass DOES NOT trigger — but the leaf-only fallback still permits, because the player's own workstation has zero rows in `machine_filesystems`.

**Concrete attack**: Player B cracks SSH guest on Player A's workstation (legit gameplay). B forges a signed envelope to overwrite `/etc/shadow` on A's machine_id. L1 passes (B has a session). L2 finds no rows for A's machine_id → fallback permits. The patch lands. After landing, `dual_write=true` for B (B isn't the owner), so B's chosen permissions are now in the projection — every subsequent write by B walks against B's own permissive perms. Effective root via guest session.

## Acceptance Criteria

Behaviour-driven outcomes — what an outside observer of the system can verify:

- [ ] An intruder with a cracked guest session on Player A's workstation cannot overwrite root-owned files on A's machine_id via forged envelope. The `/api/patches` response is 403 `permission_denied`.
- [ ] Player A's own writes to A's workstation continue to succeed (the own-workstation bypass for the owner is unchanged).
- [ ] After "NEW GAME" completes, Player A's workstation has rows in `machine_filesystems` covering the full base FS (including `/etc/passwd`, `/etc/shadow`, `/root/*`, `/home/<username>/*`).
- [ ] `npx tsx scripts/testL2Bypass.ts --machine-id <A's-workstation-id>` passes 3/3 scenarios (no_session 403, permission_denied 403, root 200).
- [ ] Existing players (none currently, but the script is future-proof) can be backfilled idempotently via a one-shot script.
- [ ] `generateLocalhost` is documented and tested as producing FS structure (paths/owners/perms) that's invariant under `(seed, rootPassword, hostname)` — only `username` shifts the structure.

## Steps

Each step follows RED-GREEN-MUTATE-KILL-REFACTOR per project CLAUDE.md.

### Step 1: Lock in `generateLocalhost` structural invariant

**Why first**: Steps 3+ rely on the server passing placeholder values for `seed`, `rootPassword`, and `hostname`. If any of those affect FS _structure_ (paths/owners/perms — what L2 stores), the placeholder-regen produces wrong rows and L2 walks against a fiction. This step turns the assumption into a contract.

**RED**: Test in `src/generation/generateLocalhost.test.ts` (new or extending the existing one):

> "FS structure (paths, owners, permissions) is identical when only seed/rootPassword/hostname differ — username being equal."

Two `generateLocalhost` calls with the same `username`, different everything-else; structurally compare the `FileNode` tree (deep equal on owner+permissions+children-keys, ignoring `content`). Should pass with current code.

**GREEN**: No production code change expected. If the test fails, that's a real pre-existing bug — surface it, decide whether to fix or to expand the workstations table to include the missing axis.

**MUTATE**: Skip — this is a characterization test, not new behaviour. (If we changed `generateLocalhost`, mutate it.)

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: Invariant test green; PR comment links it as the contract Step 3 relies on.

### Step 2: `workstations` table + RLS migration + verification script

**RED**: New script `scripts/verifyWorkstationsRls.ts` mirroring `verifyMachineFilesystemsRls.ts`:

1. Anon SELECT → denied
2. Anon INSERT → denied
3. Anon UPDATE → denied
4. Anon DELETE → denied
5. service_role INSERT → allowed

5/5 expected after migration applies.

**GREEN**: New migration `supabase/migrations/<ts>_workstations.sql`:

```sql
CREATE TABLE workstations (
  player_key       text PRIMARY KEY,
  workstation_name text NOT NULL,
  username         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workstations ENABLE ROW LEVEL SECURITY;
-- No policies → anon denied; service_role bypasses RLS.
```

`workstation_name` and `username` are the only fields strictly needed to regen the FS structure server-side (Step 1 contract). `created_at` is operational.

**MUTATE**: N/A (schema/policy, not branching behaviour).

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: `npx dotenv -e .env.development.local -- npx tsx scripts/verifyWorkstationsRls.ts` passes 5/5; CLAUDE.md gains a debug-scripts entry for it.

### Step 3: `regenWorkstationRows` helper + unit tests

**RED**: New file `src/machineFilesystems/populateWorkstationBaseFs.test.ts`:

1. Returns rows whose `machine_id` is `${workstationName}-${deriveHostnameSuffix(playerKey)}`. Boundary: distinct playerKeys produce distinct machine_ids.
2. Includes restrictive perms on `/etc/shadow` (owner=root, write=['root']).
3. Includes a `/home/<username>/...` path; does NOT include `/home/<other-username>/`.
4. Two calls with same inputs produce identical rows (determinism).
5. Calls with same `username` but different `playerKey` differ ONLY in `machine_id` (per Step 1's contract — structure invariant under suffix-only changes).

**GREEN**: New file `src/machineFilesystems/populateWorkstationBaseFs.ts`:

```ts
import { generateLocalhost } from '../generation/generateLocalhost';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers';
import { flattenFileSystemsToRows, type MachineFsRow } from './flattenFileNode';

export type RegenWorkstationInput = {
  readonly playerKey: string;
  readonly workstationName: string;
  readonly username: string;
};

// Placeholder values for fields that don't affect FS structure (verified
// by the invariant test in src/generation/generateLocalhost.test.ts).
// L2 only consumes owner + permissions, both deterministic from username.
const PLACEHOLDER_SEED = 'regen-only';
const PLACEHOLDER_ROOT_PASSWORD = 'regen-only';

export const regenWorkstationRows = (input: RegenWorkstationInput): readonly MachineFsRow[] => {
  const machineId = `${input.workstationName}-${deriveHostnameSuffix(input.playerKey)}`;
  const result = generateLocalhost(
    {
      seed: PLACEHOLDER_SEED,
      workstationName: input.workstationName,
      username: input.username,
      rootPassword: PLACEHOLDER_ROOT_PASSWORD,
    },
    machineId,
  );
  return flattenFileSystemsToRows({ [machineId]: result.fileSystem });
};
```

**MUTATE**: Run `mutation-testing` skill on the helper. Likely surviving mutants:

- `slice(0, 8)` → `slice(0, 7)` (boundary on suffix length)
- Constant strings (`PLACEHOLDER_SEED` value) — equivalent mutants if structure truly is invariant
- Position swap: `input.playerKey` ↔ `input.workstationName` in `${...}-${...}` — make sure tests catch the swap

**KILL MUTANTS**: Add boundary tests for surviving mutants. For Step 1's invariant verifying the placeholder doesn't matter, equivalent mutants on the placeholder constants are expected and should be documented inline.

**REFACTOR**: Assess.

**Done when**: All tests green; mutation score ≥ 90% on the helper; equivalent mutants documented.

### Step 4: `/api/register-workstation` endpoint

**RED**: New script `scripts/testRegisterWorkstation.ts` (or integration tests against `vercel:dev`) covering:

1. Valid signed envelope `{action: 'register', workstationName, username}` → 201, workstations row inserted, `machine_filesystems` populated for that machine_id.
2. Same player_key calling twice (idempotency) → 200, no duplicate workstations row, machine_filesystems unchanged.
3. Same player_key with DIFFERENT `(workstationName, username)` second call → reject 409 `already_registered` (no silent overwrite, since changing `username` reshapes the FS structure).
4. Missing/invalid signature → 401 `invalid_envelope`.
5. Body `playerKey` doesn't match envelope-derived pubkey → 401.
6. Rate-limited beyond threshold → 429.

**GREEN**: New file `api/register-workstation.ts` mirroring `api/sessions.ts`:

- Service-role Supabase client (mirrors `api/join-home-network.ts`).
- Upstash rate limiter (low threshold — 5/min per pubkey is plenty; this is a once-per-game endpoint).
- Nonce store for replay protection.
- Verify signed envelope; extract `playerKey` from signature.
- Insert into `workstations` with ON CONFLICT player_key DO NOTHING.
  - If conflict: read existing row. If `(workstation_name, username)` matches → 200 (idempotent). If differs → 409.
- On fresh insert: `regenWorkstationRows(...)` → `bulkInsertMachineFs` (best-effort, mirrors `populateBaseFsBestEffort` in `api/join-home-network.ts:199`).
- Return 201 on fresh insert; 200 on idempotent repeat.

Business-logic separation: handler in `src/workstationRegistry/handler.ts` (mirrors `src/sessionRegistry/handler.ts`); api/register-workstation.ts is glue.

**MUTATE**: Run mutation testing on the handler. Focus areas:

- Idempotency branch: `(name, username) match` vs differ
- Status code mapping (201 vs 200 vs 409 vs 401 vs 429)
- ON CONFLICT path

**KILL MUTANTS**: Address.

**REFACTOR**: Assess.

**Done when**: All scenarios green; verifying script passes 6/6.

### Step 5: Wire `/api/register-workstation` into IntroScreen "NEW GAME" flow

**RED**: Vitest test in `src/components/IntroScreen.test.tsx`:

> "Submitting NEW GAME with valid form fires POST /api/register-workstation with a signed envelope wrapping `{action: 'register', workstationName, username}`."

Mock `fetch`; assert body shape and signature presence.

**GREEN**: In `IntroScreen.handleSubmit`, after `onStart(...)`, fire-and-forget POST to `/api/register-workstation` (per memory note: don't make `onStart` async; fire alongside).

```ts
// Pseudo:
onStart(gameState, true);
void registerWorkstation({ workstationName: trimmedHostname, username: trimmedUsername });
```

The `registerWorkstation` helper signs the envelope using the player's identity (already exists via `getIdentity()`), POSTs, and logs but doesn't surface failures to the UI. If the POST fails (network blip), the player can still play; the backfill script catches them later.

**MUTATE**: Run mutation testing on `registerWorkstation` (the helper). Endpoint URL, action string, payload shape are all candidates.

**KILL MUTANTS**: Address.

**REFACTOR**: Assess.

**Done when**: New game flow registers workstation server-side; visible in `machine_filesystems` rows after a fresh start.

### Step 6: One-time backfill script for existing workstations

**RED**: N/A — operational script. Verify by running `--dry-run` and inspecting row count vs expected.

**GREEN**: New file `scripts/backfillWorkstationBaseFs.ts` mirroring `backfillHomeNetworkBaseFs.ts`:

- Walk every `workstations` row.
- Call `regenWorkstationRows(row)`.
- Bulk-insert into `machine_filesystems` with ON CONFLICT DO NOTHING.
- `--dry-run` flag to preview row counts before writing.
- Idempotent: re-runnable safely.

**MUTATE**: N/A.

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: Script runs cleanly against a dev DB with at least one workstations row.

### Step 7: Two-browser smoke + verification + docs/memory updates

**Why manual smoke**: Memory note "E2E reserved for browser-only behavior" — Playwright is for keyboard/focus etc., not for cross-player-attack scenarios that depend on two real identities + a running Vercel function. Two-browser manual mirrors the world-network smoke approach used in chunk #1.

**Smoke test (manual, watch network tab)**:

1. Browser A: NEW GAME with `(workstationName='alice-box', username='alice', root password 'pwA')`.
2. Verify `/api/register-workstation` POST 201 in network tab; one row in `workstations`; ~50+ rows in `machine_filesystems` for `machine_id='alice-box-<8hex>'`.
3. Browser B: NEW GAME with different identity. Crack SSH guest on A's workstation through normal gameplay. (Or seed the session manually in dev for speed.)
4. Browser B's terminal: attempt `echo "compromised" > /etc/shadow` while in A's session. Expect: 403 `permission_denied`.
5. Browser A: continue using own workstation. All edits succeed (own-workstation bypass intact).

**Verification scripts**:

- `npx tsx scripts/testL2Bypass.ts --machine-id <A's-workstation-id>` → 3/3.
- `npx tsx scripts/verifyWorkstationsRls.ts` → 5/5.
- `npx tsx scripts/verifyDualWrite.ts` → still green (we haven't changed dual-write SQL).

**Docs + memory updates**:

- `CLAUDE.md` — add `backfillWorkstationBaseFs.ts`, `verifyWorkstationsRls.ts`, `testRegisterWorkstation.ts` (if added) to the debug-scripts section.
- `docs/architecture.md` — update L2 section: own-workstation now covered.
- `src/machineFilesystems/README.md` (if exists) — note workstation backfill helper.
- Memory: update `project_l2_followups.md` to mark chunk #1b CLOSED with date and PR ref. Demote `/etc/passwd` userType validation (#3) to top of remaining queue. Update `MEMORY.md` index entry.

**Done when**: Smoke verified; verification scripts pass; docs and memory updated.

## PR Breakdown

Two PRs to keep each independently mergeable and reviewable:

**PR 1 — Foundation (no externally visible behaviour change)**

Steps 1–3. Adds the invariant test, the table+RLS, and the regen helper with unit tests. No endpoint, no UI wiring. Reviewer can verify L2 stays correct (no regression — owners still bypass) and the helper's tests are strong.

**PR 2 — Activation + smoke + docs**

Steps 4–7. Endpoint, IntroScreen wiring, backfill script, two-browser smoke, docs/memory. This is the chunk that changes user-observable behaviour (and closes the attack window).

If at PR 2 mutation testing on the handler surfaces deep gaps, split out the verification + docs into a PR 3.

## Pre-PR Quality Gate

Per project CLAUDE.md, before each PR:

1. `mutation-testing` skill on changed source files (Steps 3 helper, Step 4 handler, Step 5 client helper).
2. `refactoring` skill assessment.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
4. For PR 2: `testL2Bypass.ts --machine-id <workstation-id>` 3/3, `verifyWorkstationsRls.ts` 5/5, `verifyDualWrite.ts` still green, two-browser smoke verified.
5. DDD glossary unchanged (no new domain terms — workstation/player/identity are existing).

## Risks

1. **`generateLocalhost` structural-invariant breakage** (Step 1). If a future PR adds seed-driven path randomization to `generateLocalhost` and the invariant test fails to catch it, the placeholder regen produces wrong perms server-side. Mitigation: Step 1's test pins the contract; document inline in `populateWorkstationBaseFs.ts` that the test is load-bearing.

2. **Race between IntroScreen submit and first patch** (Step 5). If the player types a patch-generating command before `/api/register-workstation` completes, that patch's L2 check falls into the leaf-only fallback (no rows yet) and permits unchecked. Mitigation: register-workstation is fire-and-forget at intro time, so it kicks off well before any gameplay happens (player is on intro screen). For belt-and-braces: register-workstation can be `await`ed at game-start before the terminal mounts. Decide during Step 5 implementation.

3. **Workstation rename / username change** is currently out of scope. The data model assumes `(workstationName, username)` is immutable per `player_key`. If we ever support rename, that's a separate chunk — invalidate old rows in `machine_filesystems`, regen with new params. Step 4's 409 on differing inputs makes the immutability explicit at the API boundary.

4. **Identity loss → orphan workstations row**. If a player loses their localStorage identity (clears storage, switches device), they get a fresh keypair → fresh workstation_id → no L2 conflict. The orphan row is harmless (no one can ever claim that machine_id again). Mitigation: none needed.

5. **Defense-in-depth opportunity** (deferred): change `enforceL2`'s leaf-only fallback to deny-by-default for machine_ids matching the workstation suffix shape. Closes the race window in Risk 2 entirely. Out of scope here because it adds shape detection, but note it for follow-up if the race materially bites.

---

_Delete this file when the plan is complete. If `plans/` is empty afterward, delete the directory._
