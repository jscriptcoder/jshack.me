# Plan: /etc/passwd as canonical credential source

**Branch**: `feat/etc-passwd-canonical`
**Status**: Active

## Goal

Make `/etc/passwd` the single source of truth for usernames, password hashes, and userTypes everywhere — removing the static `users[].passwordHash` cache that drifts on mutation. Enables sabotage-via-garble as a real attack vector and unblocks server-side userType validation at session create.

## Context

- `users[].passwordHash` is a snapshot captured at machine generation. It does not update when `/etc/passwd` is mutated (e.g., by the `password_reset` CVE effect, or a future `passwd` command).
- Five consumers still read the cache today, so any change to a hash silently fails to propagate to:
  - SSH/SCP password auth (`useAuthentication.validateAgainstEtcPasswd` — `/etc/passwd`-first with cache fallback)
  - FTP password auth (`useAuthentication` virtual-users path with cache fallback)
  - SSH key fingerprinting (`useAuthentication.computeKeyFingerprint` — cache only)
  - hydra brute-force (`hydra.ts` lines 338, 525, 581 — cache only)
  - Server-side `createSession` userType validation (the gap from `project_l2_followups` chunk #3 — no-op today, would consume cache if implemented as-is)
- Memory entry `project_users_passwordhash_drift` flags this as a known bug. The fix has been "remove the cache, make `/etc/passwd` canonical everywhere" since it was filed.
- The fallback in `validateAgainstEtcPasswd` was added defensively when the SSH/SCP path was first migrated. It currently masks sabotage attempts: garbled `/etc/passwd` → fingerprint lookup misses → falls back to cache → legitimate password still works.
- We want sabotage to be a feature: a player who garbles a remote `/etc/passwd` should lock out password-based logins.
- `/etc/passwd` perms are `read: ['root', 'user']`, `write: ['root']`. Forging fingerprints still requires at least user-tier read access on the target — so removing the cache does not weaken `.ssh_keys` unforgeability. See discussion thread for the threat-model walkthrough.
- `/etc/passwd` is in `machine_filesystems` for home + world + workstations after the L2 base-FS backfills. Mission machines remain blocked by `mission_instances`.

## Acceptance Criteria

- [ ] Garbling `/etc/passwd` on a remote machine locks out SSH / SCP / FTP password auth for the affected user, and prevents hydra from cracking accounts on that machine.
- [ ] Running `password_reset` against a machine invalidates `.ssh_keys` entries that were saved before the reset (player must re-auth with the new password to re-establish the key).
- [ ] Server-side `createSession` derives `userType` from the target's `/etc/passwd` and rejects (or overrides) claimed values that don't match.
- [ ] No code path reads `users[].passwordHash` after the chunk lands; the field is removed from `RemoteUser` (or its equivalent) without breaking the build.
- [ ] All existing SSH/SCP/FTP/hydra/su tests pass, plus new tests covering the garble and post-reset behaviours.

## Out of Scope

- Mission-machine server-side userType validation. Blocked on `mission_instances` (see `project_l2_followups` step 2). Mission machines remain on the leaf-only L2 path; userType validation no-ops for them with a TODO.
- Removing the `RemoteUser` type entirely. The `username` and `userType` fields are still load-bearing for routing and display. Only `passwordHash` is removed.
- A new `passwd` command. Out of scope here — the `password_reset` CVE effect is the only existing mutator and that path already writes `/etc/passwd` correctly.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Step 1: Drop SSH/SCP cache fallback in `validateAgainstEtcPasswd`

**Acceptance criteria**:

- Garbled `/etc/passwd` on the target → SSH password auth fails with "Permission denied". Same for SCP.
- Missing user line in `/etc/passwd` → auth fails (no fallback to cache).
- After `password_reset` rotates the hash, the old password fails and the new one succeeds (regression check — already works today, must keep working).

**RED**: Add unit tests in `useAuthentication.test.ts` for the three scenarios above. The garble/missing-line cases currently pass-through to the cache and return true — the new tests fail.

**GREEN**: Remove the `?? remoteUser.passwordHash` fallback at line 646. Return `false` if `/etc/passwd` is unreadable, missing the user, or has an empty hash field. Update the comment block at lines 619–627 to reflect that `/etc/passwd` is now sole source.

**MUTATE**: Run `mutation-testing` skill on `useAuthentication.ts:validateAgainstEtcPasswd`.

**KILL MUTANTS**: Address survivors. Likely candidates: boundary on the `entry?.split(':')[1]` extraction (empty hash vs missing field).

**REFACTOR**: Consider extracting the `/etc/passwd` parsing into a pure helper (`parseEtcPasswdEntry(content, username)`) since multiple consumers will need it in later steps. Only if it makes the test cleaner.

**Done when**: All criteria met, tests pass, mutation report clean, commit approved.

### Step 2: Drop FTP cache fallback

**Acceptance criteria**:

- Garbled `/etc/passwd` on an FTP target → 530 Login incorrect, even when the credential matches the (now-stale) cache.
- Virtual-users config still takes precedence when present (no regression — already works).
- Missing user → 530.

**RED**: Tests in `useAuthentication.test.ts` for the FTP path equivalent of step 1.

**GREEN**: Remove the `?? remoteUser.passwordHash` fallback at line 673. Reuse the helper from step 1's refactor (if extracted).

**MUTATE / KILL MUTANTS / REFACTOR / Done when**: Same shape as step 1.

### Step 3: hydra reads `/etc/passwd` instead of the cache

**Acceptance criteria**:

- Garbled `/etc/passwd` on the target → hydra finds 0 cracked accounts (no candidates to test against the wordlist).
- After `password_reset` rotates a hash, hydra against that machine reflects the new hash (i.e., the rolled credential is the one that needs to be in the wordlist, not the original).
- Normal hydra runs against an unmutated `/etc/passwd` produce identical results to today (regression check).

**RED**: Tests in `hydra.test.ts` for the three scenarios.

**GREEN**: In `hydra.ts`, replace the `user.passwordHash` references at lines 338, 525, and 581 with a parse of `/etc/passwd` from the target machine. Iterate the parsed entries instead of `users`. The username + userType context for the result rows can come from the cache (or a parallel parse of `/etc/passwd` for uid → userType derivation; pick whichever is cleaner once the parse helper exists).

**MUTATE / KILL MUTANTS / REFACTOR / Done when**: Same shape.

### Step 4: `computeKeyFingerprint` reads from `/etc/passwd`

**Acceptance criteria**:

- After `password_reset` rotates a target user's hash, a previously-saved `.ssh_keys` entry for that user fails fingerprint validation, and the user is prompted for the password.
- Garbled `/etc/passwd` on the target → no fingerprint computable → saved keys fail (in addition to password auth failing per step 1).
- Forging a `.ssh_keys` line by hand without prior auth still fails (the fingerprint anchor is the live `/etc/passwd` hash, which requires user-tier read perms on the target).
- Initial save-and-replay of an `.ssh_keys` entry against an unmutated machine still works (regression check).

**RED**: Tests in `useAuthentication.test.ts` for `hasAuthorizedKey` / `saveAuthorizedKey` covering the four scenarios. Most existing tests should continue to pass; new ones cover the post-reset invalidation.

**GREEN**: In `computeKeyFingerprint`, replace `remoteUser.passwordHash` with a `/etc/passwd` parse against the resolved IP. Return `null` when the file is unreadable / user missing / hash empty.

**MUTATE / KILL MUTANTS / REFACTOR / Done when**: Same shape.

### Step 5: Server-side userType validation in `createSession`

**Acceptance criteria**:

- A `createSession` payload claiming `userType: 'root'` for a non-root user (per `/etc/passwd`) is rejected with 400 + a clear error code (decision: **strict reject**).
- A `createSession` payload for a guest user claiming `userType: 'root'` is rejected (same path).
- Mission machines (no `/etc/passwd` in `machine_filesystems`) no-op — accept the client's claim with a TODO comment referencing `mission_instances`. Logged at debug level so we can audit usage pre-launch (decision: **no-op until missions catch up**).
- Garbled `/etc/passwd` → reject session create with 400. Same code path as a userType mismatch — both surface as "cannot derive userType from target".
- Existing session-create flows (legitimate root / user / guest logins) continue to work unchanged.

**RED**: Tests in `api/createSession` (or wherever the handler lives — verify path before writing). New `scripts/testCreateSessionUserType.ts` smoke for end-to-end forge-and-reject.

**GREEN**: In the createSession handler, after the L1 session check and before persisting the session row: read `/etc/passwd` from `machine_filesystems` for the target machine_id. If no row exists (mission machine), no-op with a TODO log line and accept the claim. Otherwise parse the user line, derive `userType` (uid 0 → root, username 'guest' → guest, else → user), compare against claim. Mismatch → reject 400 with error code `usertype_mismatch`. Garbled file (no parseable line for the username) → reject 400 with error code `usertype_underivable`.

**MUTATE / KILL MUTANTS / REFACTOR / Done when**: Same shape, plus the smoke script proves end-to-end behaviour against `vercel:dev`.

### Step 6: Drop `users[].passwordHash` field

**Acceptance criteria**:

- The `passwordHash` field is removed from `RemoteUser` (and any related types).
- Build passes, lint passes, all tests pass, no references to the field remain.
- The static `users` array passed around at runtime is purely structural (`username`, `userType`, `uid`).

**RED**: This is a type-only cleanup; the safety net is the typecheck pass. No new tests.

**GREEN**: Remove the field from the type definition. Walk the build errors; each one should already have been migrated by steps 1–5. Any remaining reference is a bug — fix it (or, more likely, delete it).

**MUTATE**: N/A (no behavior change).

**REFACTOR**: While here, audit whether `RemoteUser` is still the right shape, or whether the structural fields should live as a derived view from `/etc/passwd` everywhere. Defer to a follow-up if the audit turns up significant refactor work.

**Done when**: Typecheck + lint + tests all green; commit approved.

## Sequencing & PR Boundaries

**All steps stacked in a single PR** (decided during step 1 — six steps form one coherent "make `/etc/passwd` canonical" theme; reviewer holds one concept across the diff). Each step is still its own commit on the branch so revert and bisect remain clean. Order matters:

- 1 → 2: same fallback pattern, FTP after SSH/SCP keeps the diff small.
- 2 → 3: hydra is the largest behavior-shift among the client-side consumers; lands after the simpler removals to reduce blast radius if something regresses.
- 3 → 4: keys-invalidate-on-reset is the most player-visible behaviour change. Lands deliberately, with a release note.
- 4 → 5: server-side validation depends on the principle being established client-side (otherwise client and server disagree on what `/etc/passwd` means at session create).
- 5 → 6: cleanup must come last; the cache is still consumed until step 5 finishes.

## Verification

Per CLAUDE.md and the testing skill:

- Steps 1–4: unit tests in vitest + targeted manual UI smoke (per the "E2E test new primitives through the UI before done" memory rule). Garble `/etc/passwd` via `nano`, attempt SSH / SCP / FTP / hydra, confirm rejection.
- Step 5: unit tests + a new `scripts/testCreateSessionUserType.ts` modelled on `testL2Bypass.ts` — forge an envelope claiming `userType: 'root'` for a non-root user, expect rejection.
- Step 6: typecheck + lint + full test suite.

## Resolved Decisions

1. **Step 5 strict vs lenient**: **strict reject** (400 + error code). Surfaces client bugs faster, matches the "zero-trust patch validation" stance.
2. **Step 4 `password_reset` invalidation**: confirmed as a desirable gameplay feature. Release note required when step 4 ships.
3. **Mission machines in step 5**: **no-op-with-TODO** until `mission_instances` lands. Closes the gap on home/world/workstation immediately; missions remain leaf-only L2 (unchanged from today).

## Pre-PR Quality Gate (each PR)

1. `npm run test:run` — all green.
2. `npm run build` — passes.
3. `npm run lint` — passes.
4. `npm run format` — applied.
5. Mutation testing report on touched files.
6. Manual UI smoke for steps 1–4.
7. `scripts/testL2Bypass.ts` regression check (no L2 enforcement should regress).

## Memory Updates (after merge)

- Update `project_users_passwordhash_drift` to "RESOLVED in [PR list]".
- Update `project_l2_followups` to mark step 3 as shipped.
- Add a feedback memory if anything surprising surfaces during implementation.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
