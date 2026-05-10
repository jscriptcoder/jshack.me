# Plan: Cross-Player Base FS Replication + Server-Authoritative Auth + CVE Read Endpoint

**Status**: Active — PR 1 ✅ merged (#124); PR 2 ✅ merged (#125); PR 3 ✅ merged (#126); PR 4 ✅ merged (#127); PR 5 ✅ merged (#128, commit 1ea6d3b)
**Started**: 2026-05-07
**Estimate**: 7 PRs, ~3-4 weeks total
**Why this chunk exists**: PvP cracking is the multiplayer pitch. Without this, cross-player attacks against player workstations don't work — SSH login fails, FTP login fails, file_read CVE fails, post-login `cat`/`ls` returns empty. User explicitly reversed the prior deferral on 2026-05-07 ("not gonna be happy to release the game without this").

---

## Goal

Player A can fully attack Player B's workstation cross-player: brute-force credentials with hydra, SSH/SCP/FTP/MySQL/Redis/su login, run CVE exploits (including `file_read` and `dir_list`), and read B's actual filesystem content from inside any resulting shell — all gated server-side so a Burp/curl/forged-envelope client cannot bypass read permissions.

## Acceptance Criteria

Behaviour-driven; each criterion describes an observable outcome.

- [ ] Player A on the same LAN as Player B can `ssh user@<B's-LAN-IP>` with B's actual password and land in a working shell on B's machine. `cat /home/<B's-user>/README.txt` returns the real content B's machine generated, filtered by A's session userType.
- [ ] Player A can `hydra ssh://<B's-LAN-IP>` with a wordlist; on a hit, A successfully establishes an SSH session against B's server-validated credentials.
- [ ] Player A can `ftp <B's-LAN-IP>`, `mysql -u <user> -p <B's-LAN-IP>`, `rediscli -a <pass> <B's-LAN-IP>` and authenticate against the server-projected credential files on B's machine.
- [ ] Once on B's box, A can `su` cross-tier (e.g. guest → root with B's root password) and the validation hits B's server-side `/etc/passwd`.
- [ ] A `nc <B's-LAN-IP> <port>` to a backdoor B opened (via `nc -l` or via a CVE) drops A into a session at the tier encoded in B's projected `/var/run/<svc>.pid`.
- [ ] Running a `file_read` CVE against B's machine returns the real content of the requested path, filtered by the effect's tier (not by A's tier).
- [ ] A `dir_list` CVE against B returns B's real directory listing at the effect's tier.
- [ ] A forged HTTP request (Burp/curl/non-game-client) cannot retrieve B's secret file content beyond what A's session userType allows. The wire payload is the threat surface.
- [ ] B logs into B's own machine and sees no regression — own-workstation flows are unchanged.
- [ ] Two-browser smoke test on a shared LAN: A and B running concurrently, A successfully cracks and reads B's box, B sees the activity in their own logs.

## Reference memories

These memories are the design context. Read them before resuming work.

- **`project_cross_player_base_fs_gap.md`** — Original chunk shape, problem statement, layered-bug warning. Status header at the top of the memory is OUTDATED (says DEFERRED); reversed 2026-05-07.
- **`project_machine_access_vector_catalog.md`** — Six-category enumeration of every way someone gets onto a machine. Source of truth for "what flows need server-authoritative variants."
- **`project_selective_fs_content_projection.md`** — The `FS_PROJECTED_CONTENT_PATHS` pattern (added by PR #122). One-line addition + backfill rerun extends the projection.
- **`project_read_path_privacy_gap.md`** — Read-path privacy filter (PR #119). Already shipped; hard prerequisite. This chunk reuses the three-tier filter (owner / session+walker / no-session+allowlist).
- **`project_users_passwordhash_drift.md`** — `/etc/passwd` is canonical for credentials (PR #122). `RemoteUser.passwordHash` is gone; sabotage-via-garble is real; `password_reset` invalidates pre-saved `.ssh_keys`.
- **`project_workstation_id_model.md`** — `${workstation_name}-${first-8-hex(player_key)}` is the workstation_id everywhere. Don't introduce a parallel ID.
- **`project_bash_command_load_bearing.md`** — DEFERRED. nc-restricted shells need `bash <path>` to start daemons. Don't propose deleting bash; revisit during mission redesign.
- **`feedback_no_backward_compat.md`** — DB wipe is on the table. No sentinel-value backfills for missing columns; just wipe affected rows and let players re-register.
- **`feedback_e2e_test_new_primitives.md`** — Unit tests aren't enough for new server primitives. Smoke-test through the UI before declaring done.
- **`reference_l2_verification_scripts.md`** — Forged-envelope test patterns. Mandatory smoke for any PR touching server enforcement.

## Decisions made (2026-05-07 — durable record)

These decisions are settled. Don't re-litigate without an explicit user prompt.

1. **Hybrid storage**: Option A (extend `FS_PROJECTED_CONTENT_PATHS`) for auth-critical files server reads at request-time; Option B (regen from `seed` server-side) for arbitrary base-FS content (post-login `cat`/`ls`, `file_read` of dynamic paths). Workstations get a new `seed` column for this; home/world/mission machines already have `seed` in their tables.
2. **`root_password_hash` is NOT a separate column.** It's already in projected `/etc/passwd` content (via PR #122). Don't add a parallel storage location — that's the drift bug we just resolved.
3. **Threat-model shift acknowledged**: server holds `/etc/passwd` content (with inline MD5 hashes) for all machine types. This shipped implicitly with PR #122. No new threat-model decision needed — already done.
4. **Eager bulk-fetch on session establish**, not lazy on-demand. When A logs into B, server returns the full filtered base FS for A's tier; A caches it; subsequent reads are local. Patches stream via existing Realtime.
5. **DB wipe on schema migration is fine.** No sentinel-value backfills, no "best-effort migration paths" for missing seed. Wipe affected tables and let players re-register. Rule sunsets at multiplayer announce.
6. **Tier propagation for CVE effects**: server endpoints trust the effect tier in the signed envelope, NOT re-derive from `/etc/passwd`. CVEs grant tiers that aren't represented in credential files.
7. **Saved-key fingerprint validation server-side**: fingerprint = `md5(target_user_passwordhash)`. Server recomputes from current `/etc/passwd` on every auth attempt; never cache.
8. **Universal coverage** for the read-path filter (already shipped PR #119) extends to this chunk: every server endpoint applies the filter regardless of machine type.

## Decisions deferred

These are open questions. Do NOT decide them implicitly inside this chunk.

- **`bash` command + nc-restricted-shell + closure-mission gameplay**: tangled, deferred to mission redesign. See `project_bash_command_load_bearing.md`.
- **`script_exec` server execution model**: server-side execution vs A's-browser-as-if-on-B. Decision needed before PR 6 if scripts are read-affecting; otherwise can defer further.
- **`apt upgrade` on cross-player machines**: gameplay question. Should A be able to patch B's vulnerable service after rooting? Falls under Category A flows once decided.
- **Hydra strategy — client iterates vs server iterates**: decided as part of PR 7 once SSH/FTP server-auth endpoints are in place; either approach is implementable.

## Accepted regression: cross-player log writes overwrite

**Status (decided 2026-05-09)**: PR 2 enables cross-player SSH/SCP/`su` login, which fires auth-log writes (`/var/log/auth.log`) on the target machine. Because A's local cache for B's machine doesn't yet contain B's full `/var/log/auth.log` content (cross-player base FS replication is PR 6's scope), `appendToMachineLog`'s client-side read-modify-write reads `null` → falls into the "create new file" branch → upserts a patch row with ONLY the new entry. The patch broadcasts to B; B's existing log content is overwritten with just A's login entry.

This is the same gap that motivates PR 6 — every cross-player file read goes through A's incomplete local cache. Auth log is the first symptom to surface because PR 2 is the first feature that triggers cross-player file writes from A's tab.

**Why we accept it here, not solve it here**: an in-PR-2 server-side fix (option C in the discussion — move auth-log generation into `handleAuthCreateSession`) would solve this single case but leave every other cross-player write with the same shape (`~/.ssh_keys`, future log files, manual `>>` redirects, etc.). PR 6's eager bulk-fetch on session establish populates A's cache with B's full base FS at session-create time, after which client-side read-modify-write merges correctly for ALL paths. Solving auth-log alone is duplicate work.

**Known concurrent-write race remains after PR 6**: even with PR 6's cache-consistency fix, two clients writing the same file simultaneously can clobber each other (A reads → B writes → A appends-to-stale → A's write overwrites B's). For `auth.log` specifically this is rare (sparse login events). For high-frequency logs (`hydra.log`, syslog under attack), a server-side log-append endpoint becomes the right answer. Defer until those flows are stress-tested.

**Resume signal**: after PR 6 ships and `scripts/testServerAuth.ts` is extended with a "post-login auth.log read returns prior + new entry" assertion, the regression closes.

## Accepted regression: mission machines

**Status (decided 2026-05-08)**: PR 2 introduces a known regression for mission machines. **Accepted; will be resolved by the upcoming mission rework, not by this chunk.**

The regression: missions don't have rows in `machine_filesystems` (deferred to `mission_instances` migration). After PR 2 step 5, `createSession` for `kind:'ssh'|'scp'|'su'` is rejected; after step 7b, SSH routes through `authCreateSession` which reads `/etc/passwd` from `machine_filesystems`. Mission machines have no `/etc/passwd` row → the server returns `401 invalid_credentials` → mission SSH/SCP/su login fails.

Subsequent PRs in this chunk extend the same pattern to FTP / MySQL / Redis / nc backdoors / file_read CVE / dir_list CVE / hydra. All of these break for mission targets while the chunk is in flight.

**Consequence after merge to main**: solo mission gameplay does not work end-to-end until mission rework lands the `mission_instances` migration + projects mission `machine_filesystems` rows. Acceptable per `feedback_no_backward_compat` (no live players).

**Why this is acceptable here, not solved here**: see the discussion in PR 2 step 7b — the alternative (client-side fallback for missions only) reintroduces the forge hole for the gameplay slice with the highest impact (mission rewards). The right fix is `mission_instances`, not a security shortcut. Mission rework is already on the roadmap and will absorb this work naturally.

**Resume signal for the mission rework**: after `mission_instances` lands and the mission-machine backfill populates `machine_filesystems` (with `/etc/passwd` and the other projected paths), the regression evaporates with no code changes in this chunk. Verify by running `scripts/testServerAuth.ts` against a mission target.

---

## PR roadmap

| PR  | Status                             | Goal                                                                 |
| --- | ---------------------------------- | -------------------------------------------------------------------- |
| 1   | ✅ Merged (#124, commit `699f5f7`) | Foundation — workstations seed migration + projection list extension |
| 2   | ✅ Merged (#125, commit `6d73df7`) | Server-authoritative auth — SSH / SCP / `su`                         |
| 3   | ✅ Merged (#126, commit `275270c`) | Server-authoritative auth — FTP                                      |
| 4   | ✅ Merged (#127, commit `f92996d`) | Server-authoritative auth — MySQL / Redis / SNMP                     |
| 5   | ✅ Merged (#128, commit `1ea6d3b`) | Backdoor connect (nc) — cross-player tier from projected pidfile     |
| 6   | Pending PRs 1-5                    | Base FS replication endpoint (eager bulk-fetch on session establish) |
| 7   | Pending PR 6                       | `/api/exploit-read` for `file_read` / `dir_list` CVE effects         |
| 8   | Pending PRs 2-3                    | Hydra adaptation + rate-limit tuning                                 |

Ordering rationale:

- PR 1 is the foundation; nothing else can land without it (workstations need real seed; auth files need projection).
- PRs 2-5 are independent server-auth endpoints; can be parallelized after PR 1.
- PR 6 (base-FS replication) needs PR 1 (seed) and benefits from PRs 2-5 (so all auth flows work end-to-end during smoke).
- PR 7 (exploit-read) has its own scope; could go earlier but has a dependency on tier-aware filtering already used in PR 6.
- PR 8 (hydra) needs at least PR 2 done (its primary target is SSH).

---

## PR 1: Foundation — workstations seed + projection list extension

**Goal**: Workstations carry their real seed server-side; `machine_filesystems.content` is projected for every credential file the server needs to read for cross-player auth flows.

**Acceptance**:

- [ ] `workstations` table has a `seed` column.
- [ ] `/api/register-workstation` accepts and persists seed.
- [ ] `regenWorkstationRows` uses the real seed (no `PLACEHOLDER_SEED`).
- [ ] `FS_PROJECTED_CONTENT_PATHS` includes the auth-critical set: `/etc/passwd`, `/etc/vsftpd/virtual_users.conf`, `/var/lib/mysql/data.json`, `/etc/redis/redis.conf`, `/etc/snmp/snmpd.conf`, and `/var/run/*.pid` (glob).
- [ ] All three backfills (workstation, home, world) re-run cleanly after a DB wipe and populate the new paths' content.
- [ ] `scripts/testRegisterWorkstation.ts` smoke remains 8/8 green after seed plumb-through.
- [ ] A new smoke (or extension of an existing one) reads back projected content for each new path on a freshly-registered workstation and an NPC home network machine.

### Step 1: Wipe affected DB rows; add `seed` to workstations table

**RED**: Migration test that asserts `seed` exists on workstations as `TEXT NOT NULL` and that the column is populated for every existing row. (Test against a local Supabase; will fail before the migration runs.)

**GREEN**: New migration `supabase/migrations/<ts>_workstations_seed.sql` that:

1. `TRUNCATE workstations CASCADE` (wipes dependent `machine_filesystems` and `sessions` rows for those workstations).
2. `ALTER TABLE workstations ADD COLUMN seed TEXT NOT NULL`.
3. Documentation comment explaining "DB wipe acceptable — pre-launch — no live state, see feedback_no_backward_compat.md."

**MUTATE**: Run mutation testing on any TS code that reads from workstations. Expected: low yield (migrations are SQL).

**KILL MUTANTS**: N/A for SQL.

**REFACTOR**: N/A.

**Done when**: Migration applies cleanly to a fresh local DB; workstations table has seed column; existing dependent rows are gone.

### Step 2: Extend `registerWorkstationSignedPayloadSchema` to require seed + rootPassword

**RED**: Schema test in `src/workstationRegistry/types.test.ts` (create if absent) that:

- Asserts a payload missing `seed` fails Zod validation.
- Asserts a payload missing `rootPassword` fails Zod validation.
- Asserts a payload with `seed` of incorrect type/length fails validation.
- Asserts a valid payload with both fields parses into `RegisterWorkstationPayload` correctly.

**GREEN**: Add `seed: z.string().min(1).max(64)` and `rootPassword: z.string().min(1).max(64)` (verify bounds against the IntroScreen UX limits) to the schema in `src/workstationRegistry/types.ts`. Update the inferred type.

**MUTATE**: Run `mutation-testing` skill on `types.ts` schema changes.

**KILL MUTANTS**: Address surviving mutants — likely bounds-checking edge cases.

**REFACTOR**: If `seed` bounds appear elsewhere (e.g. mission/world generation), consolidate into a shared zod schema.

**Done when**: Schema rejects no-seed payloads; tests pass.

### Step 3: Persist seed and pass rootPassword through handler → populateBaseFs

**RED**: `handler.test.ts` tests:

- When the verified payload has `seed: 'abc123'`, the `upsertWorkstation` adapter is called with a `WorkstationRow` whose `seed` field is `'abc123'`.
- When the verified payload has `rootPassword: 'pw'`, the `populateBaseFs` adapter is called with `rootPassword: 'pw'` (passed alongside the row, NOT in the row).
- `WorkstationRow` (the persistence shape) does NOT include `rootPassword` — only `seed` joins the row.

**GREEN**:

- Add `seed: string` to `WorkstationRow` in `types.ts`.
- Introduce `PopulateBaseFsInput` (or extend the existing call) carrying `{ row: WorkstationRow, rootPassword: string }` so populate has what it needs without leaking rootPassword into persistence.
- Wire `verified.payload.seed` into the row; wire `verified.payload.rootPassword` into the populate call.
- Update `supabaseUpsert.ts` row mapping to include seed (rootPassword does NOT appear here).
- Update `handler.test.ts` fixtures.

**MUTATE**: Mutation testing on handler.ts and supabaseUpsert.ts.

**KILL MUTANTS**: Likely "missing seed in upsert" mutants — the new test catches them.

**REFACTOR**: None expected.

**Done when**: handler tests pass; integration smoke (next step) passes.

### Step 4: `regenWorkstationRows` uses real seed + rootPassword (drop placeholders)

**RED**: `populateWorkstationBaseFs.test.ts` tests:

- When called with `seed: 'real-seed'` and `rootPassword: 'rootpw'`, the resulting `/etc/passwd` row's content includes `md5('rootpw')` for the root user's hash.
- Guest password hash in `/etc/passwd` matches `md5(guestPasswordsForSeed('real-seed'))`.
- The function NO LONGER references `PLACEHOLDER_SEED` or `PLACEHOLDER_ROOT_PASSWORD` (dead-code check).

**GREEN**:

- Update `RegenWorkstationInput` in `populateWorkstationBaseFs.ts` to require `seed: string` and `rootPassword: string`.
- Drop `PLACEHOLDER_SEED` and `PLACEHOLDER_ROOT_PASSWORD` constants entirely.
- Thread seed and rootPassword into `generateLocalhost(...)` call.
- Update the backfill script (`scripts/backfillWorkstationBaseFs.ts`) to read the seed from the workstations row (it's now a column) AND figure out rootPassword for backfill — open question for backfill (see below).

**Backfill rootPassword question**: existing rows post-wipe will have correct content because re-registration goes through the new envelope. But what if we ever need to rebackfill? The workstations table doesn't store rootPassword (by design). Two answers:

- (a) The backfill becomes "operate on workstations registered AFTER this PR." Existing rows from before the wipe don't exist (we wiped). Future rows always have correct content via the live register flow. Backfill becomes a safety net for content drift, not an initialization tool.
- (b) Add a "regenerate /etc/passwd content" hook that the client can trigger if it detects drift (e.g., after a rotation event). Out of scope for PR 1.

Decision: (a). The backfill script's purpose narrows to "fix-up after schema migrations that don't change content." For PR 1, after wiping and re-registration, all workstations have correct content end-to-end via the live register flow.

**Resolved (2026-05-07 during PR 1 kickoff)**: Today `populateBaseFs` calls `regenWorkstationRows` with `PLACEHOLDER_SEED` + `PLACEHOLDER_ROOT_PASSWORD`, so `machine_filesystems.content['/etc/passwd']` for workstations currently holds **wrong hashes**. Server-side `createSession` userType validation (PR #122) works because it only inspects username/userType columns, not the hash; but PR 2's cross-player password validation will fail without the real hash.

**Decision**: registration envelope carries both `seed` and `rootPassword` (raw). Server uses both at register-time to regen correct content; `seed` persists in `workstations` table; `rootPassword` is hashed and embedded in `/etc/passwd` content via the existing `generateLocalhost` flow, then discarded — never persisted as a separate field. This honors decision #2 (no separate `root_password_hash` column) while ensuring projected content is correct.

**Privacy posture**: raw `rootPassword` transits the server briefly (HTTPS-encrypted in flight, in-memory only during the request). The hash that lands in projected `/etc/passwd` is the same hash that's already there post-PR #122; this is not a new threat-model shift, just fixing the value being stored.

**MUTATE**: Mutation testing on populateWorkstationBaseFs.

**KILL MUTANTS**: N/A.

**REFACTOR**: Remove placeholder constants and any tests that pinned the placeholder behaviour.

**Done when**: A freshly-registered workstation has correct seed-derived content in `machine_filesystems.content` for `/etc/passwd` (test via SQL query in a smoke script).

### Step 5: Decide glob support for `FS_PROJECTED_CONTENT_PATHS`

**RED**: `projectedContentPaths.test.ts` test that asserts `shouldProjectFsContent('/var/run/sshd.pid')` returns `true` when the allowlist contains the glob `/var/run/*.pid`.

**GREEN**: Two options — pick during implementation:

- **5a**: Replace `Set<string>` with `readonly string[]` of glob patterns + a glob matcher (reuse the matcher from `src/patchRegistry/readAllowlist.ts`).
- **5b**: Keep `Set<string>` for exact paths, add a separate `PROJECTED_GLOB_PATTERNS: readonly string[]` and an `OR` check in `shouldProjectFsContent`.

5a is cleaner. Verify the readAllowlist glob matcher handles the patterns we need (`*` segment-bound, `**` recursive — already documented as supporting both).

**MUTATE**: Mutation testing on the new helper.

**KILL MUTANTS**: Boundary cases (`*` matching across segments; `.pid` suffix match).

**REFACTOR**: If the glob matcher is genuinely shared between `readAllowlist` and `projectedContentPaths`, factor it to a common helper.

**Done when**: `shouldProjectFsContent` correctly distinguishes glob matches from non-matches; tests pass.

### Step 6: Add auth-critical paths to the projection allowlist

**RED**: `projectedContentPaths.test.ts` test that pins the exact allowlist after this step. Lock in:

- `/etc/passwd` ✅
- `/etc/vsftpd/virtual_users.conf`
- `/var/lib/mysql/data.json`
- `/etc/redis/redis.conf`
- `/etc/snmp/snmpd.conf`
- `/var/run/*.pid`

**GREEN**: Add the new entries to `FS_PROJECTED_CONTENT_PATHS` in `src/machineFilesystems/projectedContentPaths.ts`.

**MUTATE**: Mutation on the file.

**KILL MUTANTS**: List membership tests should catch any mutants.

**REFACTOR**: None.

**Done when**: Allowlist test pins the canonical set; `shouldProjectFsContent` returns true for each new path.

### Step 7: Re-run all backfills and verify content population

**RED**: A new smoke script `scripts/testProjectedContentBackfill.ts` (or extension of an existing backfill script) that:

- Picks one workstation, one home-network machine, one world-network machine.
- For each new projected path, queries `machine_filesystems.content WHERE machine_id=$1 AND path=$2` and asserts content is non-NULL and non-empty.

**GREEN**:

- Run `scripts/backfillWorkstationBaseFs.ts` (live).
- Run `scripts/backfillHomeNetworkBaseFs.ts` (live).
- Run `scripts/backfillWorldNetworkBaseFs.ts` (live).
- Verify the smoke script reports all-green.

The backfill scripts ALREADY use the dual-write path that respects `shouldProjectFsContent`, so the new paths should be populated automatically once the allowlist is extended (Step 6) and the FS regeneration produces them (which it does — `vsftpd/virtual_users.conf`, `mysql/data.json`, etc. are part of the FS pools).

**MUTATE**: N/A — operational verification.

**REFACTOR**: None.

**Done when**: Smoke script reports content present for all six projected paths on all three machine types.

### Step 8: Two-browser smoke + register-workstation E2E pass

**RED**: Existing E2E test `npm run test:e2e` (mission playthrough) — should still pass end-to-end after PR 1.

Plus a manual two-browser smoke:

1. Wipe DB.
2. Browser A: NEW GAME, register workstation. Verify in DB: `workstations` row has expected seed.
3. Browser A: `cat /etc/passwd` from own shell — verify the content is what would be generated from the registered seed.
4. Browser B: NEW GAME with a different player_key, register workstation. Verify a separate row exists.
5. Both A and B can log into their own workstations and operate normally.

**GREEN**: Whatever fixes the E2E test surfaces.

**Done when**: E2E test green; manual smoke passes; PR ready for review.

---

## PR 2: Server-authoritative auth — SSH / SCP / `su`

**Goal**: SSH/SCP/su credential validation moves from client-side (the player's IndexedDB) to a server endpoint that reads `/etc/passwd` content from `machine_filesystems`. Validation + session creation collapse into a single atomic operation, fixing the post-login race documented in `project_known_race_post_login_create_session`. Saved-key fingerprint validation moves server-side too.

**Acceptance**:

- [ ] `POST /api/sessions` with `action: 'authCreateSession'` and a valid `(username, password)` against the target's `/etc/passwd` returns `201` with a `session_id` and the `userType` derived from `/etc/passwd`.
- [ ] Same envelope with a wrong password returns `401 invalid_credentials`. No user-existence leak — non-existent username also returns `401 invalid_credentials`.
- [ ] Same envelope with a valid saved-key fingerprint (computed from current `/etc/passwd` hash) returns `201`. Fingerprint mismatch returns `401`.
- [ ] Submitting `action: 'createSession'` (the old kind-based action) for `kind: 'ssh' | 'scp' | 'su'` is rejected (`400` or `403`) — the auth-required kinds force callers through `authCreateSession`.
- [ ] Existing in-game SSH login (against the player's own workstation) still works — IntroScreen → SSH session goes through `authCreateSession` and lands in a working shell.
- [ ] Cross-player flow on a freshly-registered Tab B: Tab A `ssh user@<B's-LAN-IP>` with B's actual password lands in a session at the correct `userType`.
- [ ] Forge smoke (`scripts/testServerAuth.ts`): wire-payload tests for valid / wrong-password / non-existent-user / saved-key / forge-with-wrong-fingerprint, all 5 scenarios pass against `vercel:dev`.
- [ ] No regression in handler tests (`sessionRegistry/handler.test.ts`).

### Step 1: Add `authCreateSession` action to the sessions schema

**RED**: New tests in `sessionRegistry/types.test.ts` (or extend if it exists) that pin the new discriminated-union arm:

- Valid envelope with `kind: 'ssh'`, `target_machine_id`, `username`, `password` parses.
- Same with `savedKeyFingerprint` instead of `password` parses.
- Envelope with both `password` AND `savedKeyFingerprint` is rejected (mutual exclusion).
- Envelope with neither is rejected.
- `kind` outside `'ssh' | 'scp' | 'su'` is rejected (other kinds use the existing `createSession`).
- Bounds: password/fingerprint min/max length pinned.

**GREEN**: Add a new `z.object({ action: z.literal('authCreateSession'), ... })` arm to `sessionsSignedPayloadSchema` and the `SessionsPayload` discriminated union.

**MUTATE**: Bounds, kind enum membership, mutual-exclusion XOR check.

**Done when**: schema tests green; existing `createSession` arm continues to parse correctly.

### Step 2: `/etc/passwd` parser — reusable helper

**RED**: Test in `src/filesystem/etcPasswdHelpers.test.ts` (or new file) that pins:

- Parses real-shape `/etc/passwd` content into `Map<username, { passwordHash, userType }>`.
- Empty-content / malformed lines are skipped, not thrown.
- `userType` correctly derived from `(uid, gid)` columns per game convention (root: uid=0; user: uid in user range; guest: known username).

**GREEN**: Implement the parser. Likely already partially exists in `etcPasswdHelpers.ts` — refactor/expose if so.

**MUTATE**: Field-position robustness (extra whitespace, missing fields), userType derivation correctness.

**Done when**: parser produces expected map for canonical `/etc/passwd` shapes including the multi-user content from the world-network smoke.

### Step 3: Server handler arm — `handleAuthCreateSession`

**RED**: New tests in `sessionRegistry/handler.test.ts`:

- Reads `/etc/passwd` from `machine_filesystems` (via injected adapter), parses, validates password — returns `201` with `session_id` and the correct `userType`.
- `insertSession` is called with `kind` from the envelope and `credentials.userType` from the parsed `/etc/passwd` (NOT trusted from the envelope).
- Wrong password → `401 invalid_credentials`; insertSession NOT called.
- Username not in `/etc/passwd` → `401 invalid_credentials`; insertSession NOT called (no enumeration).
- Machine has no `/etc/passwd` row → `404 machine_not_found` or `401` (decide based on info-leak posture; default 401).
- Saved-key path: fingerprint-match returns `201`; mismatch returns `401`.
- L1 / L2 are NOT bypassed by this endpoint — it's a session-CREATING endpoint, not a write endpoint, so the existing layers apply downstream as before.

**GREEN**: Add `handleAuthCreateSession` arm in `sessionRegistry/handler.ts`. Inject a `findEtcPasswdContent(machine_id) → string | null` adapter (mirror of how other lookups are injected).

**MUTATE**: Wrong-password vs unknown-user equivalence (no leak), userType derivation source (envelope vs parsed), session insert call shape.

**Done when**: handler tests green; `sessionRegistry/handler.test.ts` keeps all existing tests passing.

### Step 4: Server adapter — `findEtcPasswdContent`

**RED**: Test in `sessionRegistry/supabaseFindEtcPasswdContent.test.ts` (or extend existing):

- Returns content for an existing row.
- Returns null when no row exists.
- Returns null on Supabase error.

**GREEN**: Helper that does `SELECT content FROM machine_filesystems WHERE machine_id=$1 AND path='/etc/passwd'`. Existing `supabaseFindEtcPasswdContent.ts` may already do this — if so, reuse.

**Done when**: adapter unit-tested; wired into `api/sessions.ts` as a dep for the new handler arm.

### Step 5: Reject `createSession` for auth-required kinds

**RED**: Handler tests asserting that `action: 'createSession'` with `kind: 'ssh' | 'scp' | 'su'` returns `400 use_authcreatesession` (or similar) and does NOT call `insertSession`. Other kinds (`'exploit' | 'snmp' | 'nc' | 'effect_one_shot' | 'ftp' | 'mysql' | 'redis'`) continue to work — FTP/MySQL/Redis migrate to authCreateSession in PR 3+4.

**GREEN**: Add the kind-list check to `handleCreateSession`. Document the auth-required vs auth-optional partition in a comment.

**MUTATE**: Kind enum membership, error response shape.

**Done when**: malicious client cannot bypass server validation by posting `createSession` with `kind:'ssh'`.

### Step 6: Client-side `authCreateSession` wrapper

**RED**: `sessionRegistry/client.test.ts` test for the new function:

- Signs `authCreateSession` envelope with given fields.
- POSTs to `/api/sessions`.
- Returns `{ session_id, userType }` on 201.
- Throws (or returns a Result type) on 401 / 4xx / 5xx with reason captured.

**GREEN**: Add `authCreateSession` to `sessionRegistry/client.ts`. Mirror `createSession`'s shape but with the new payload + return-userType-from-server (don't trust client-side for userType).

**Done when**: client wrapper unit-tested; existing `createSession` keeps working.

### Step 7: Wire SSH path to `authCreateSession`

**RED**: Updates to `useAuthentication.test.ts` (or wherever SSH login is tested):

- SSH password login no longer reads `/etc/passwd` locally for validation; it calls `authCreateSession` with the password.
- On 201, the new sessionId is set and the user is logged in.
- On 401, the in-game error message is `"Permission denied (publickey,password)"` (preserve UX).

**GREEN**: Replace local md5(password) check in `useAuthentication.ts` SSH branch with an `authCreateSession` call. Remove the `pushSession` follow-up (auth+create is now atomic). Keep local UX state updates (snapshot stack, currentPath, etc.).

**Tricky**: Some existing tests pin local validation behaviour. Those tests now belong on the server (handler tests) — delete them client-side, or refactor to test the request shape.

**MUTATE**: Error-path coverage (401 → correct UX), success-path (sessionId from server is propagated).

**Done when**: SSH login E2E (against vercel:dev with a registered workstation) works end-to-end; handler.test + useAuthentication.test all green.

### Step 8: Wire SCP path to `authCreateSession`

**RED**: SCP test updates — same shape as SSH (kind='scp').

**GREEN**: Update `commands/scp.ts` (or its withTransientSession call) to use `authCreateSession` instead of local validation + `withTransientSession(createSession)`. The transient session shape is preserved; just the create-call changes.

**Done when**: SCP file copy across machines works against vercel:dev.

### Step 9: Wire `su` path to `authCreateSession`

**RED**: `su` tests — kind='su', target_machine_id is the current machine.

**GREEN**: Update `commands/su.ts` (or wherever `su` validates) to call `authCreateSession` instead of local md5 check.

**Note**: `su` has a different UX — same machine, just changing tier. The session row created has `kind:'su'` and a parent_session_id pointing to the current shell session.

**Done when**: `su root` with correct password promotes tier; wrong password fails with the standard error.

### Step 10: Saved-key fingerprint server-side

**RED**: Handler tests for the saved-key arm (covered in step 3 partially, but expand):

- Server recomputes `expectedFingerprint = md5(currentHashFromEtcPasswd + ...)` matching the existing client-side derivation.
- Match → 201; mismatch → 401.
- After `password_reset` modifies `/etc/passwd`, the saved key's fingerprint no longer matches the new hash → 401 (memory: `project_users_passwordhash_drift` confirms this is the intended behavior).

**GREEN**: Implement the saved-key validation path in `handleAuthCreateSession`. The fingerprint derivation must MATCH `useAuthentication.ts:119-180` — identical hash inputs.

**MUTATE**: Hash-input ordering (target_user, target_ip, port, current_hash) — pin the canonical order; off-by-one would silently break.

**Done when**: pre-saved key login works post-PR-2 against a workstation with a fresh /etc/passwd hash.

### Step 11: E2E forge smoke — `scripts/testServerAuth.ts`

**RED**: New script that:

1. Registers a workstation with seed + rootPassword via `/api/register-workstation`.
2. Forges 5 envelopes:
   - Valid password → expect 201, sessionId returned.
   - Wrong password → expect 401 invalid_credentials.
   - Non-existent username → expect 401 (same code, no leak).
   - Valid saved-key fingerprint → expect 201.
   - Forged saved-key fingerprint (random bytes) → expect 401.
3. Verifies session row exists in DB for the success cases.
4. Cleans up.

**GREEN**: The script doesn't drive code; it validates production code. As steps 1-10 land, this smoke goes from 0/5 to 5/5.

**Done when**: 5/5 scenarios pass against `vercel:dev`.

### Step 12: Two-browser smoke

Manual verification:

1. Browser A: NEW GAME, register workstation A.
2. Browser B: NEW GAME, register workstation B.
3. Connect both to the same WiFi (use the cross-player setup script).
4. Browser A: `ssh <B's-username>@<B's-LAN-IP>` with B's actual password → lands in a session.
5. Network tab confirms the request is `authCreateSession`, not `createSession`.
6. Wrong password → in-game "Permission denied" message.
7. After landing, A can see B's `/home/<user>/README.txt` content (filtered by guest tier — since A logged in as `<B's-username>` which is `user` tier, A sees user-tier-readable content).

**Done when**: cross-player SSH login fully works through the UI.

---

## PR 3: Server-authoritative auth — FTP

**Goal**: FTP login validates against `/etc/vsftpd/virtual_users.conf` (overlay) and `/etc/passwd` (fallback) server-side. Mirrors PR 2 shape, extends `authCreateSession` to accept `kind:'ftp'`.

**Acceptance**:

- [ ] `POST /api/sessions` with `action:'authCreateSession'`, `kind:'ftp'`, valid `(username, password)` returns `201` with `session_id` and `userType` derived server-side from `/etc/passwd`.
- [ ] When `virtual_users.conf` lists the username, server validates against the virtual hash. When it doesn't, server falls back to `/etc/passwd` hash. Mirrors `authenticateFtpInline` precedence.
- [ ] Username absent from `/etc/passwd` → `401 invalid_credentials` (userType cannot be derived).
- [ ] `kind:'ftp'` + `method:'savedKey'` → `401 invalid_credentials` (no `.ssh_keys` for ftp).
- [ ] `createSession` with `kind:'ftp'` is rejected `403 use_authcreatesession` (closes the bypass that PR 2 closed for ssh/scp/su).
- [ ] In-game `ftp <host>` flow: own-workstation login still works; cross-player login against another tab's FTP works end-to-end.
- [ ] `scripts/testServerAuth.ts` extended with FTP scenarios; all pass.

### Step 1: Add `'ftp'` to `AUTH_REQUIRED_KINDS`

**RED**: Schema test in `types.test.ts`: `kind:'ftp' + auth:password` parses; `createSession` with `kind:'ftp'` continues to parse (the auth-required check is in handler, not schema).

**GREEN**: `AUTH_REQUIRED_KINDS = ['ssh', 'scp', 'su', 'ftp'] as const`.

**Done when**: types tests green; FTP-flagged tests in handler still fail (expected).

### Step 2: New adapter `findVirtualUsersConfContent`

**RED**: Adapter test mirroring `supabaseFindEtcPasswdContent.test.ts` — returns content for an existing row with `path='/etc/vsftpd/virtual_users.conf'`, returns `found:false` when no row exists, `ok:false` on Supabase error.

**GREEN**: New file `src/sessionRegistry/supabaseFindVirtualUsersConfContent.ts` mirroring the /etc/passwd one. (Generalization to a parameterized `findFsContent({path})` deferred to PR 4 when MySQL/Redis/SNMP add more credential files.)

**Done when**: adapter unit-tested; ready to wire into handler.

### Step 3: Handler dispatch for `kind:'ftp'`

**RED**: `handler.test.ts` tests:

- `kind:'ftp'` + valid password against `virtual_users.conf` overlay → 201 with userType from /etc/passwd.
- `kind:'ftp'` + valid password against /etc/passwd (when virtual_users.conf has no entry for username) → 201.
- `kind:'ftp'` + wrong password → 401 invalid_credentials.
- `kind:'ftp'` + username not in /etc/passwd → 401 invalid_credentials.
- `kind:'ftp'` + `method:'savedKey'` → 401 invalid_credentials.
- `kind:'ftp'` + missing virtual_users.conf row + valid /etc/passwd password → 201 (fallback).
- ssh/scp/su tests still pass (existing single-file flow unchanged).

**GREEN**: Extend `HandlerDeps` with `findVirtualUsersConfContent`. In `handleAuthCreateSession`, branch on `payload.kind`:

- `'ssh' | 'scp' | 'su'` → existing /etc/passwd-only flow.
- `'ftp'` → fetch both files; rejection of savedKey method; virtual-overlay precedence; userType always from /etc/passwd entry.

**MUTATE**: Overlay precedence (virtual_users wins when present), savedKey rejection, fallback path.

**Done when**: handler test suite green for all five FTP scenarios + no regression on PR 2 tests.

### Step 4: Wire adapter into `api/sessions.ts`

**RED**: handler-level test alone won't catch wire-up bugs. The forge smoke covers it (Step 7).

**GREEN**: Inject `findVirtualUsersConfContent` into the handler deps in `api/sessions.ts`.

**Done when**: vercel:dev boots without errors; forge smoke step 7 passes.

### Step 5: Reject `createSession` with `kind:'ftp'`

This is automatic — Step 1 added 'ftp' to AUTH_REQUIRED_KINDS, and `handleCreateSession` already rejects auth-required kinds with 403 use_authcreatesession (PR 2 step 5). Just verify a regression test pins the behaviour.

**RED**: Handler test that `createSession` + `kind:'ftp'` returns 403 use_authcreatesession.

**GREEN**: Should already pass — no code change needed.

**Done when**: regression test green.

### Step 6: Replace `authenticateFtpInline` with `authCreateSession`

**RED**: `useAuthentication.test.ts` updates — FTP password login no longer reads files locally; calls `authCreateSession` with `kind:'ftp'`. On 201, FTP session enters with server-returned userType. On 401, "530 Login incorrect." line is shown.

**GREEN**: Refactor `authenticateFtpInline` in `src/hooks/useAuthentication.ts`:

- Remove the `readFileFromMachine` calls for `/etc/vsftpd/virtual_users.conf` and `/etc/passwd`.
- Call `authCreateSession({ kind:'ftp', machine_id: resolveTargetMachineId(resolvedIp), username, auth: { method:'password', password } })`.
- On `ok:true` → `enterFtpMode` with server-returned userType + sessionId.
- On `ok:false, reason:'invalid_credentials'` → `addLine('error', '530 Login incorrect.')` + `onFtpAuth` failure.
- Remove the userType-from-cached-RemoteUser pattern; userType is now server-authoritative.

**Tricky**: `enterFtpMode` currently expects FtpSession with `sessionId: null` (backfilled later). New flow has sessionId at creation time — pass it directly. Remove the post-create `pushSession`/dual-write code path for FTP.

**Done when**: in-game ftp login works against vercel:dev; tests green.

### Step 7: Forge smoke extension — `scripts/testServerAuth.ts`

**RED**: Add 4 FTP scenarios to the existing script:

- `kind:'ftp'` virtual_users.conf overlay path → 201, sessionId returned, userType matches /etc/passwd.
- `kind:'ftp'` /etc/passwd fallback path (delete the virtual_users row in DB to force fallback) → 201.
- `kind:'ftp'` wrong password → 401 invalid_credentials.
- `kind:'ftp'` + savedKey → 401 invalid_credentials.

**GREEN**: Existing handler code from steps 1-3 already handles these.

**Done when**: 13/13 (existing 9 + new 4) scenarios pass against vercel:dev.

### Step 8: Two-browser smoke

Manual verification on vercel:dev:

1. Browsers A and B with cross-player setup.
2. A: `ftp <B's-LAN-IP>` → username/password prompt.
3. Enter B's FTP virtual user credentials → "230 Login successful." enters FTP mode at correct tier.
4. Wrong password → "530 Login incorrect."
5. Network tab: `authCreateSession` call with `kind:'ftp'`.

**Done when**: cross-player FTP login works through the UI.

---

## PR 4: Server-authoritative auth — MySQL / Redis / SNMP

**Goal**: Extend `authCreateSession` to accept `kind:'mysql' | 'redis' | 'snmp'`. Closes the same forge bypass that PRs 2-3 closed for ssh/scp/su/ftp — a forge caller can no longer mint a `kind:'mysql'` session with `userType:'root'` claim.

**Three credential file shapes**:

- **MySQL** — `/var/lib/mysql/data.json`. Multi-user JSON with `{credentials: [{username, passwordHash, ...}]}`. Mirrors FTP `virtual_users.conf` shape.
- **Redis** — `/etc/redis/redis.conf`. Shared password via `requirepass <plaintext>`. No username concept; the wire payload uses `username:'redis'` as a sentinel.
- **SNMP** — `/etc/snmp/snmpd.conf`. Two community strings: `rocommunity <string>` (read-only) and `rwcommunity <string>` (read-write). For PR 4, migrate only `snmpset` (the single SNMP path that creates a session today) — match against `rwcommunity` → userType `'root'`. snmpwalk stays read-only/sessionless until PR 7's `/api/exploit-read`.

**Acceptance**:

- [ ] `authCreateSession` accepts `kind:'mysql'` with valid `(username, password)` against `/var/lib/mysql/data.json`; mismatch → 401.
- [ ] `authCreateSession` accepts `kind:'redis'` with sentinel `username:'redis'` and the `requirepass` value; mismatch → 401. Missing `requirepass` (no auth required) → also 401 (redis with auth disabled is a different code path that doesn't go through authCreateSession).
- [ ] `authCreateSession` accepts `kind:'snmp'` with sentinel `username:'snmp'` and the `rwcommunity` string; mismatch → 401.
- [ ] `createSession` with any of these three kinds → `403 use_authcreatesession`.
- [ ] Client `connectMysql`, `connectRedis`, and `snmpset`'s session-create hop route through `authCreateSession` instead of local-validation + `createSession`/`withTransientSession`.
- [ ] In-game flow: own-workstation MySQL/Redis/SNMP login still works; cross-player paths follow the same accepted regression as PRs 2-3 (auth works but post-login reads fail until PR 6).
- [ ] Forge smoke (`scripts/testServerAuth.ts`) extended with at least 6 new scenarios (2 per protocol: success + wrong credential).

### Step 1: Generalize the FS-content adapter (refactor)

**RED**: Adapter test for new `createSupabaseFindFsContent({ path })` factory — accepts `{ machine_id, path }`, returns same `{ ok, found, content }` shape.

**GREEN**: New file `src/sessionRegistry/supabaseFindFsContent.ts`. Migrate `findEtcPasswdContent` and `findVirtualUsersConfContent` callers in `api/sessions.ts` to use the generic factory; keep the per-file adapters as thin re-exports if they have direct test coverage worth preserving (or delete them — feedback_no_backward_compat applies).

**Done when**: api/sessions.ts uses one adapter factory; all existing tests still pass.

### Step 2: Add `'mysql' | 'redis' | 'snmp'` to `AUTH_REQUIRED_KINDS`

**RED**: Schema test in `types.test.ts` — `kind:'mysql'` / `'redis'` / `'snmp'` parse on authCreateSession; `kind:'mysql'` on createSession parses (handler will reject), etc.

**GREEN**: Extend the `AUTH_REQUIRED_KINDS` const tuple. Update the kind-list comment to clarify the three new shapes (multi-user JSON, shared-secret, dual-community).

**Done when**: schema tests green; existing tests still pass.

### Step 3: Per-protocol credential parsers

Three small parser helpers in `src/filesystem/`:

- `mysqlCredentialsHelpers.ts` — `findMysqlUserHash(content, username) → string | undefined`. Parses JSON, returns `credentials[].passwordHash` for the matching username. Mirrors `findVirtualUserHash` shape.
- `redisConfHelpers.ts` — `findRedisRequirepass(content) → string | undefined`. Extracts `requirepass <value>` from the conf.
- `snmpConfHelpers.ts` — `findSnmpRwCommunity(content) → string | undefined`. Extracts `rwcommunity <value>`.

**RED**: Unit tests covering: present/absent/empty content, malformed lines, multi-line edge cases, sentinel strings (e.g. `requirepass ""`).

**GREEN**: Implement each parser. Reuse `parseMysqlDatabase` from `commands/mysql/types` if it's safe to import server-side (no browser deps); otherwise inline a smaller server-side JSON parser.

**Done when**: parser tests green for each.

### Step 4: Handler dispatch per kind

**RED**: handler.test.ts tests:

- `kind:'mysql'` + valid (username, password) against the JSON → 201 with userType from /etc/passwd or from the JSON itself (see decision below).
- `kind:'mysql'` wrong password → 401.
- `kind:'mysql'` + savedKey → 401 (rejected like FTP).
- `kind:'redis'` + sentinel username + correct requirepass → 201 with userType `'root'` (Redis AUTH grants full access in real Redis; the game model matches).
- `kind:'redis'` wrong password → 401.
- `kind:'redis'` requirepass absent → 401 (no-auth Redis is out of scope; only the AUTH'd path goes through this endpoint).
- `kind:'snmp'` + sentinel username + correct rwcommunity → 201 with userType `'root'`.
- `kind:'snmp'` wrong community → 401.
- `kind:'snmp'` rocommunity match → 401 (snmpset needs rwcommunity).
- ssh/scp/su/ftp tests still pass.

**Decision needed during step 4**: where does MySQL's userType come from? Two options:

- **A**: from `/etc/passwd` (same machine; usernames overlap). Consistent with FTP overlay precedence.
- **B**: from the MySQL JSON itself (each `credentials[].userType`). Independent of /etc/passwd.

Looking at `parseMysqlDatabase`, the JSON already carries userType per credential. Going with **B** simpler; no second file lookup.

**GREEN**: Branch in `handleAuthCreateSession` per kind. mysql/redis/snmp each construct their own session row with userType from the credential file.

**Done when**: handler tests green; no regression on PR 2/3 tests.

### Step 5: Wire api/sessions.ts

Inject the three new credential-file lookups (or one generic adapter, depending on Step 1's outcome).

**Done when**: vercel:dev boots without errors.

### Step 6: Client refactors

- `connectMysql` + `authenticateMysqlInline` → call `authCreateSession` with kind='mysql', username, password.
- `connectRedis` → call `authCreateSession` with kind='redis', sentinel username, password.
- `snmpset` → replace `withTransientSession` with `withTransientAuthSession` (introduced in PR 2).
- `enterMysqlMode` and `enterRedisMode`: drop their fire-and-forget `createServerSession` push (mirrors PR 3's `enterFtpMode` simplification).
- Add `authCreateMysqlSession` / `authCreateRedisSession` methods to SessionContext (mirrors `authCreateFtpSession`).

**Done when**: in-game MySQL / Redis login works against vercel:dev; existing tests updated or skipped (cross-test leak precedent).

### Step 7: Forge smoke extension

Extend `scripts/testServerAuth.ts` with:

- mysql: insert `/var/lib/mysql/data.json` row → success match + wrong password.
- redis: insert `/etc/redis/redis.conf` with requirepass → success + wrong password.
- snmp: insert `/etc/snmp/snmpd.conf` with rwcommunity → success + wrong community.
- All three kinds: createSession bypass closure.

**Done when**: forge smoke goes from 14 → ~20 scenarios.

### Step 8: Two-browser smoke

Manual cross-player verification on `vercel:dev`. Same accepted regression as PR 2/3 (auth works; post-login reads fail until PR 6).

---

## PR 5: Backdoor connect (nc) cross-player tier

**Goal**: When A runs `nc <B's-IP> <port>` to a `nc -l`-opened backdoor on B, the server reads B's projected `/var/run/nc-<port>.pid` content from `machine_filesystems` to determine the tier and creates the `kind:'nc'` session at that tier. Forge clients can no longer mint a cross-player nc session at an arbitrary userType against a `nc -l`-opened port.

**Scope clarification (decided 2026-05-09 during PR 5 kickoff)**: PR 5 covers ONLY the `nc -l`-opened backdoor path (where a real pidfile pre-exists at `/var/run/nc-<port>.pid`). The msfconsole `shell_limited` effect path — which yields `NcPromptData` directly without writing a pidfile — keeps its current `createSession({ kind:'nc' })` flow and remains forge-able until PR 7 hardens it via effect-grant validation. Therefore `'nc'` does NOT enter `AUTH_REQUIRED_KINDS` in PR 5; it joins after PR 7 closes the msfconsole-side gap.

**Approach**: extend `authCreateSession` with a third `authMethod` arm `{ method:'pidfile', port:number }`. Server reads `/var/run/nc-<port>.pid` via the existing generic `findFsContent` adapter (PR 4), parses the `nc:port=…,user=…,userType=…,home=…` line, derives credentials + currentPath, and inserts `kind:'nc'` with server-derived `userType` (never trusted from envelope).

**Note on `Port.owner`**: client-side derivation via `parseNcPidFiles` continues for own-machine UX (kill, ps). For cross-player nc-connect, the canonical tier source becomes the server's pidfile read.

**Acceptance**:

- [ ] `POST /api/sessions` with `action:'authCreateSession'`, `kind:'nc'`, `auth:{method:'pidfile',port}` against a target whose `/var/run/nc-<port>.pid` is present and well-formed returns `201` with `session_id`, `username`, `userType`, and `homePath` (all server-derived from pidfile content).
- [ ] Same envelope against a port with no pidfile row → `401 invalid_credentials` (no enumeration).
- [ ] Same envelope against a malformed pidfile (random content, missing fields) → `401 invalid_credentials`.
- [ ] `auth:{method:'password',…}` and `auth:{method:'savedKey',…}` with `kind:'nc'` → `401 invalid_credentials` (only the pidfile method is valid for nc).
- [ ] `createSession` with `kind:'nc'` continues to work (msfconsole shell_limited path) — known forge gap, deferred to PR 7.
- [ ] In-game flow: own-workstation `nc -l 4444` followed by another tab's `nc <publicIP> 4444` lands cross-player at the listener's tier (the server reads B's pidfile).
- [ ] Forge smoke (`scripts/testServerAuth.ts`): 3 new scenarios — pidfile present + valid → 201 with correct userType; pidfile missing → 401; pidfile malformed → 401.
- [ ] No regression on PRs 2-4 forge tests (24/24 still green).
- [ ] Two-browser smoke verifies cross-player nc-to-listener works end-to-end.

### Step 1: Extend `authMethodSchema` with `'pidfile'` arm

**RED**: Schema test in `sessionRegistry/types.test.ts`:

- `auth:{method:'pidfile',port:4444}` parses on `authCreateSession` envelopes.
- `auth:{method:'pidfile'}` (missing port) is rejected.
- `auth:{method:'pidfile',port:0}` / `port:65536` are rejected.
- `auth:{method:'pidfile',port:4444,extra:'…'}` is rejected (strict).
- `auth:{method:'pidfile',port:4444,password:'…'}` is rejected (mutual exclusion via discriminated union).

**GREEN**: Add a third arm to the `authMethodSchema` discriminated union — `z.object({ method: z.literal('pidfile'), port: z.number().int().min(1).max(65535) }).strict()`. Update the `AuthMethod` inferred type and the comment block above the schema.

**MUTATE**: Bounds (port range), method-literal value, mutual exclusion.

**KILL MUTANTS**: Address surviving mutants.

**REFACTOR**: None expected.

**Done when**: schema tests green; existing `password` / `savedKey` arms unchanged.

### Step 2: Pure pidfile parser helper

**RED**: Tests in `src/filesystem/ncPidHelpers.test.ts`:

- Well-formed line `nc:port=4444,user=alice,userType=user,home=/home/alice` → `{ port:4444, username:'alice', userType:'user', homePath:'/home/alice' }`.
- Empty / null / undefined content → `undefined`.
- Missing fields, wrong order, extra commas → `undefined`.
- userType outside `'root'|'user'|'guest'` (e.g. `userType=admin`) → `undefined`.
- Port out of range (`port=70000`, `port=0`, `port=-1`) → `undefined`.
- home path containing additional commas — present approach: `home=…` is the last field and uses `(.+)$` so commas in path are preserved.

**GREEN**: New file `src/filesystem/ncPidHelpers.ts` exporting `parseNcPid(content) → ParsedNcPid | undefined`. Reuse the existing `PID_PATTERN` regex from `network/ncStateParser.ts`. Keep the existing client-side `parseNcPidContent` in place; it can later delegate to the new helper to avoid drift, but PR 5 stays surgical.

**MUTATE**: Regex anchors, bounds, userType enum membership, optional-chain handling on undefined content.

**KILL MUTANTS**: Bounds and enum mutants.

**REFACTOR**: If `parseNcPidContent` and the new helper share enough, fold to a single source-of-truth function. Defer if it inflates the diff; ship as follow-up.

**Done when**: parser tests green; helper exported from a server-safe module (no React / no DOM imports).

### Step 3: Handler dispatch — `kind:'nc'` + `method:'pidfile'`

**RED**: New tests in `sessionRegistry/handler.test.ts`:

- `kind:'nc'` + `method:'pidfile'` + present-and-well-formed pidfile content for `/var/run/nc-<port>.pid` → 201; `insertSession` called with `credentials.userType` and `credentials.username` from parsed pidfile (NOT from envelope); response body includes `username`, `userType`, `homePath`.
- `kind:'nc'` + `method:'pidfile'` + missing pidfile row (`findFsContent` returns `found:false`) → `401 invalid_credentials`; insertSession NOT called.
- `kind:'nc'` + `method:'pidfile'` + malformed pidfile content (parser returns undefined) → `401 invalid_credentials`.
- `kind:'nc'` + `method:'password'` → `401 invalid_credentials` (no fallback to /etc/passwd for nc).
- `kind:'nc'` + `method:'savedKey'` → `401 invalid_credentials`.
- `kind:'nc'` + `method:'pidfile'` + `findFsContent` returns `ok:false` (DB error) → `500`.
- ssh/scp/su/ftp/mysql/redis/snmp tests still pass (existing arms unchanged).

**GREEN**: Add branch in `handleAuthCreateSession` for `kind:'nc'`:

- Reject password/savedKey methods upfront with `401 invalid_credentials`.
- For `method:'pidfile'`: build path `/var/run/nc-${port}.pid`, call `findFsContent({machine_id, path})`, on `ok:false` → 500, on `found:false` → 401, on found+content parse via `parseNcPid`, on parse fail → 401.
- Build `SessionRow` with `credentials.username` and `credentials.userType` from parsed pidfile; insert.
- Response body: `{ session_id, username, userType, homePath }` so the client can populate `NcSession.currentPath` from server (mirrors the FTP shape where userType comes from server).

**MUTATE**: Method-literal dispatch, pidfile-not-found vs malformed-content error code parity (no enumeration), userType source (envelope vs parsed).

**KILL MUTANTS**: Address surviving mutants.

**REFACTOR**: If the per-kind branches in `handleAuthCreateSession` are getting unwieldy, extract per-kind handlers to private functions. Defer if cosmetic.

**Done when**: handler tests green; no regression on PRs 2-4 tests.

### Step 4: Wire api/sessions.ts

`findFsContent` is already injected (PR 4); the new handler arm uses it. No additional adapter wiring needed unless test deps require it.

**Done when**: vercel:dev boots cleanly; smoke (Step 6) passes.

### Step 5: Client refactor — `authCreateNcSession` + Terminal split

**RED**: Tests in `SessionContext.test.tsx`:

- New method `authCreateNcSession({machine_id, port, parent_session_id, source_ip})` posts an `authCreateSession` envelope with `kind:'nc'` + `method:'pidfile'`.
- On 201 returns `{session_id, username, userType, homePath}`; on 401 returns a typed failure result.
- `enterNcMode` no longer issues a fire-and-forget `createServerSession` push for the pidfile path; it is state-only when called from the new flow.

Tests in `Terminal.test.tsx` (or `useNetworkCommands.test.ts` if that's where the wiring lives):

- nc command's resulting `NcPromptData` (carrying a new `proof:'pidfile'` discriminator) routes through `authCreateNcSession`. On 401, an error line is added; `enterNcMode` is NOT called.
- msfconsole's `shell_limited` `NcPromptData` (with `proof:'effect'`) keeps the existing `enterNcMode` + fire-and-forget createServerSession path (deferred to PR 7).

**GREEN**:

- `NcPromptData` gains a `proof:'pidfile'|'effect'` discriminator. nc command sets `'pidfile'`; msfconsole sets `'effect'`. Update the type and both call sites.
- Add `authCreateNcSession` to `SessionContext`. Mirror the shape of `authCreateFtpSession` (PR 3).
- `enterNcMode` becomes state-only (drop the fire-and-forget createServerSession push). The single remaining caller for the forge-able path becomes a separate small helper that does the createServerSession + state mutation explicitly (msfconsole-shell_limited only).
- `Terminal.tsx` `isNcPrompt` branch: switch on `proof`. `'pidfile'` → `authCreateNcSession({machine_id, port})`, on success build `NcSession` from server response and `enterNcMode(ncSession)`; on failure addLine error. `'effect'` → existing path (createServerSession kind:'nc').

**Tricky points**:

- The current `enterNcMode` does `setNcSession(...)` THEN fires createServerSession asynchronously and back-fills `sessionId`. With `authCreateNcSession`, `sessionId` is known before state-mutate, so a one-shot `enterNcMode(sessionWithSessionId)` works without back-fill plumbing.
- `currentPath` on the new NcSession comes from the server's `homePath`, not the envelope. Client supplies port/machineId; server supplies username/userType/homePath.

**MUTATE**: Method-literal routing in Terminal.tsx, success-vs-error handling (no zombie enterNcMode on error).

**KILL MUTANTS**: Address surviving mutants.

**REFACTOR**: None planned; mirror PR 3 patterns.

**Done when**: in-game `nc <ip> <port>` to own listener works end-to-end against vercel:dev; tests green.

### Step 6: Forge smoke — `scripts/testServerAuth.ts` extension

**RED**: Add 3 (or 4) scenarios:

- Insert a row into `machine_filesystems` with `path=/var/run/nc-9999.pid` and well-formed content. Forge `authCreateSession` envelope `kind:'nc', method:'pidfile', port:9999` → expect 201; assert response `userType` matches pidfile content; assert session row created in DB.
- Same machine, `port:9998` (no row) → expect 401 invalid_credentials; no session row.
- Insert a row with malformed content (`port=4444,user=alice` without `nc:` prefix) → expect 401.
- Optional: forge `kind:'nc', method:'password'` → expect 401 (closes the password fallback).

Cleanup: delete inserted machine_filesystems rows and any sessions created.

**GREEN**: Ride on PRs 2-4 plumbing; existing handler code from Step 3 covers it.

**Done when**: scenarios go from 24 → 27/28 passing; existing scenarios still green.

### Step 7: Two-browser smoke

Manual cross-player verification on `vercel:dev`:

1. Browsers A and B with cross-player setup (same WiFi).
2. B: `nc -l 4444` from B's localhost (writes pidfile under B's tier).
3. Patch propagates to B's machine_filesystems row (verify via SQL).
4. A: `nc <B's-LAN-IP> 4444` → expect "Connecting…" → "Connected." → `# 4444 #` prompt at B's listener tier.
5. Network tab: `authCreateSession` POST with `kind:'nc'`, `method:'pidfile'`.
6. A's prompt shows tier matching what B used to start the listener (e.g. if B was logged in as `user`, A lands as `user`).
7. Stop B's listener; A retry → connection refused.

**Done when**: cross-player nc-to-listener fully works through the UI.

### Step 8: Plan + memory updates, lint/format/build/test, PR

- Update plan status table: PR 5 ✅ merged.
- Add a note in the plan about the deferred msfconsole-shell_limited gap (PR 7).
- Run `npm run build && npm run lint && npm run format && npm run test:run`.
- PR description references the pidfile method, the deferred forge gap, and the 27/28 forge smoke result.

---

## PR 6: Base FS replication endpoint (eager bulk-fetch on session establish)

**Goal**: When Player A establishes a session on Player B's workstation, A's client fetches a server-regenerated, tier-filtered copy of B's full base filesystem and merges it into A's local `fileSystems[B.workstation_id]`. Subsequent `cat`/`ls`/`grep` etc. reads against B's box layer onto a real base FS, not an empty placeholder, so cross-player attacks finally produce real content.

**Scope clarification (decided 2026-05-10 during PR 6 kickoff)**: PR 6 covers ONLY cross-player **workstation** machines. NPC home/world network base FS already works cross-player today via local seed-regen — every player generates the same FS deterministically from `home_networks.seed` / `world_networks.seed`. Mission machines stay broken until `mission_instances` ships (per the "Accepted regression: mission machines" section above). Workstations are the only machine type where B's `gameState.seed` lives in B's browser and is unreachable to A — they're the entire scope of this PR.

**Why this PR is high-impact**: PRs 2-5 unlocked cross-player **session creation** (SSH/SCP/su/FTP/MySQL/Redis/SNMP/nc all authenticate against B's projected credential files). But once A is on B's box, every read returns `null` because A's `fileSystems[B.workstation_id]` is undefined. The session works; the shell is empty. This is the gap the user flagged with "right now when you get a session, you don't get the patches for that session's tier, and the behaviour is strange." This PR fills it.

**Approach**:

- New action `getBaseFs` on `/api/patches` (sibling to `listPatchesForMachines`). Signed envelope carries `{ machine_id }`.
- Server detects the workstation_id pattern (`^.+-[0-9a-f]{8}$`); rejects non-workstation patterns with `400 unsupported_machine_type`.
- Server queries `workstations` for the row matching the parsed name + verified suffix; on missing row → `404 workstation_not_found`.
- Server regens the workstation's base FS via `generateLocalhost(...)` using the row's stored `seed` and a placeholder `rootPassword`. (The /etc/passwd content this regen produces would have the WRONG hash because the real rootPassword isn't persisted; see overlay step.)
- Server overlays projected-path content from `machine_filesystems` (via existing `findFsContent` style adapter) — this restores the **correct** /etc/passwd content (real hash from PR 1's projection) and any other projected files (vsftpd, mysql, redis, snmp, nc-pidfiles).
- Server stamps in any patches recorded against this machine_id (via existing `listPatchesForMachines` adapter call) — not strictly required (the client merges patches separately), but prevents the "empty for one tick" race on session establish.
- Server determines the caller's effective tier:
  - **Owner** (workstation_id suffix matches verified player_key) → return unfiltered FS.
  - **Session** (active session row for caller on this machine) → walk every `(path, owner, permissions)` through `permissionWalker` at the session's userType; drop nodes that fail read or whose ancestor fails traverse.
  - **No session** → return `null` baseFs (defense in depth — eager fetch is only fired post-session by the client; a forger calling pre-session gets nothing).
- Returns `{ baseFs: FileNode | null }`.
- Client integration: `useFileSystemSync`'s existing session-change useEffect already refetches patches at the new tier. Add a sibling call: when the foreground session lands on a workstation_id that ISN'T the player's own and ISN'T already in `fileSystems`, call `getBaseFs` and merge the returned tree into `fileSystems[machineId]` via `setFileSystems`.

**Why merge into `fileSystems` (not patches)**: patches are deltas over a base. The base FS is the foundation. Two separate state slices in `useFileSystemSync` track them; PR 6 wires the missing base for cross-player workstations. Existing patch state and read filtering keep working unchanged.

**Why the projected-content overlay**: `generateLocalhost` bakes `md5(rootPassword)` into /etc/passwd content. The workstations table doesn't store `rootPassword` (decision #2). If we just shipped the regen result, A would see `md5("PLACEHOLDER_ROOT")` for B's root hash — useless for credential cracking gameplay AND inconsistent with the projected content that PR 2's auth path already validates against. Overlaying restores parity: the FS A sees on B IS the FS the server uses for auth. (Other projected files — vsftpd, mysql, redis, snmp, nc pidfiles — also benefit; they may have changed via in-game writes since the workstation was registered.)

**Critical concerns checked**:

- ✅ Server-safe imports verified: `generateLocalhost` flows through `commands/availability.ts` whose only non-data import is `import type { Command }` (type-erased at runtime); no React/DOM deps. Already imported successfully by `scripts/backfillWorkstationBaseFs.ts` which runs under `tsx` with no browser shim.
- ✅ Performance: single-workstation regen is in-memory recursion over a ~30-50KB tree; sub-50ms wall-time on dev hardware. The DB round-trips (workstations row + projected-content batch + active-session lookup) are the dominant cost (~50-100ms in vercel:dev). Total: ~150ms per cross-player session establish. Acceptable.
- ✅ Memory growth: A's `fileSystems` gains one entry per cross-player workstation A has SSH'd into in this session. ~50KB per entry. Even with 10 cross-player attacks per session this is sub-MB.
- ✅ Read-path privacy filter (PR #119) compatibility: tiered filter applies to PATCHES specifically. Base FS gets its own walker pass at the same userType. No double-filter concern.
- ✅ Mission regression (already accepted): non-workstation machine_id pattern returns 400; mission machines are filtered out at the dispatcher. No new regression added.

### Acceptance

- [ ] A SSH-logs into B's workstation as a non-root user. `ls /home` returns B's username dir; `cat /home/<B's-user>/README.txt` returns the real "WELCOME TO JSHACK.ME" content B's machine generated at `generateLocalhost` time.
- [ ] A logged into B as `guest` runs `cat /etc/passwd` → "Permission denied" (B's /etc/passwd has `read: ['root', 'user']`, guest excluded by walker).
- [ ] A logged into B as `user` runs `cat /etc/passwd` → returns B's real /etc/passwd content with the **correct** root hash (from projection, not placeholder).
- [ ] A logged into B as `root` runs `cat /root/.note` → returns the real .note content.
- [ ] B logged into B's own workstation: zero regression. The own-box bypass keeps the existing path; getBaseFs is never called for the player's own workstation (suffix-match early-out).
- [ ] Forge envelope: `getBaseFs` for B's workstation_id with NO session → returns `{baseFs: null}` (no content leak; allowlist-only is reserved for the patches read filter and doesn't apply to base FS).
- [ ] Forge envelope: `getBaseFs` for B's workstation_id with a session row at userType=guest → returns FS with /etc/passwd, /root/, and any user-only files dropped.
- [ ] Forge envelope: `getBaseFs` for a non-workstation machine_id (IPv4 like `192.168.1.50`) → 400 unsupported_machine_type. (No cross-player home/world support in this PR.)
- [ ] Forge envelope: `getBaseFs` for a workstation_id with no `workstations` row → 404 workstation_not_found.
- [ ] No regression on PRs 2-5 forge tests (29/29 still green).
- [ ] Two-browser smoke: A and B running concurrently, A SSH's into B, A's terminal shows real B-content for `cat`/`ls` calls; B sees the auth-log entry for A's login (PR 2 path unchanged).
- [ ] Wall-time on session-establish (network tab measurement): authCreateSession + getBaseFs together complete under 500ms in vercel:dev.

### Step 1: Add `getBaseFs` action arm to the patches schema

**RED**: Schema tests in `src/patchRegistry/types.test.ts`:

- `{action:'getBaseFs', ts, nonce, machine_id:'omen-4a3b1c2d'}` parses.
- Missing `machine_id` rejected.
- Empty `machine_id` rejected (`min(1)`).
- `machine_id` over 256 chars rejected.
- Extra fields rejected (strict).

**GREEN**: Add `getBaseFsSignedPayloadSchema` to `src/patchRegistry/types.ts` and append it to the `patchesSignedPayloadSchema` discriminated union. Export `GetBaseFsPayload` inferred type.

**MUTATE**: Bounds, action literal, strict mode.

**KILL MUTANTS**: Address surviving mutants.

**REFACTOR**: None.

**Done when**: schema tests green; existing arms unchanged.

### Step 2: Pure helper — `parseWorkstationId`

**RED**: Tests in `src/homeNetworks/homeNetworkHelpers.test.ts` (consolidate per `feedback_consolidate_small_helpers`):

- `parseWorkstationId('omen-4a3b1c2d')` → `{name:'omen', suffix:'4a3b1c2d'}`.
- `parseWorkstationId('skylab-prime-deadbeef')` → `{name:'skylab-prime', suffix:'deadbeef'}` (multi-segment names with internal hyphens — last 8 hex are the suffix).
- `parseWorkstationId('192.168.1.50')` → `undefined` (not a workstation pattern).
- `parseWorkstationId('omen')` → `undefined` (no suffix).
- `parseWorkstationId('omen-1234')` → `undefined` (4-hex, wrong length).
- `parseWorkstationId('omen-XYZGHIJK')` → `undefined` (non-hex chars).

**GREEN**: New helper in `src/homeNetworks/homeNetworkHelpers.ts`:

```ts
const WORKSTATION_ID_RE = /^(.+)-([0-9a-f]{8})$/;
export const parseWorkstationId = (
  id: string,
): { readonly name: string; readonly suffix: string } | undefined => {
  const match = WORKSTATION_ID_RE.exec(id);
  if (!match) return undefined;
  return { name: match[1], suffix: match[2] };
};
```

**MUTATE**: Regex anchors, suffix length, character class.

**KILL MUTANTS**: Address surviving mutants.

**REFACTOR**: If `deriveHostnameSuffix` and the parser share enough of the suffix shape, expose a `WORKSTATION_SUFFIX_LENGTH` constant. Defer if cosmetic.

**Done when**: helper exported, tests green; no client/server divergence.

### Step 3: Pure helper — `overlayProjectedContent`

**RED**: Tests in `src/filesystem/baseFsOverlay.test.ts` (new file):

- Given a FileNode tree containing `/etc/passwd` with placeholder content + a `Map<path, content>` mapping `/etc/passwd → 'real:hash:0...'`, the overlaid tree's `/etc/passwd` node has `content: 'real:hash:0...'` and other nodes are unchanged.
- Multiple projected paths overlay independently.
- Path not in the map: node unchanged.
- Path in the map but missing in the tree: silently ignored (no insertion — the map only OVERLAYS, doesn't ADD paths).
- Directory nodes ignored (overlay only applies to file nodes).
- Empty map → tree returned identical (referentially equal allowed).
- Recursion preserves owner + permissions (only `content` changes).

**GREEN**: New file `src/filesystem/baseFsOverlay.ts`:

```ts
import type { FileNode } from './types';
export const overlayProjectedContent = (
  node: FileNode,
  contentByPath: ReadonlyMap<string, string>,
  basePath = '/',
): FileNode => {
  /* recursive walk, substitute file content */
};
```

Pure recursion mirroring `flattenFileNode`'s shape.

**MUTATE**: Path joining, file/dir branching, content substitution.

**KILL MUTANTS**: Boundary cases (root path `/`, deep nesting, empty children).

**REFACTOR**: None.

**Done when**: overlay tests green; helper exported.

### Step 4: Pure helper — `filterFileNodeForRead`

**RED**: Tests in `src/filesystem/baseFsFilter.test.ts` (new file):

- userType=root: returns the tree referentially equal (no filtering).
- userType=user, file with `read: ['root']` only: returns null (file dropped).
- userType=user, dir with `execute: ['root']` only: returns null (whole subtree dropped — can't traverse).
- userType=user, dir with `execute: ['root','user']` containing files at `read: ['root','user']` and `read: ['root']`: returns dir with only the user-readable file.
- Nested structures: 3-level tree with mixed perms returns the correct filtered subset.
- Empty children after filter: returns dir with `children: {}` (NOT null — the dir itself is traversable, just empty).

**GREEN**: New file `src/filesystem/baseFsFilter.ts`:

```ts
import { canRead, canExecute } from './permissionWalker';
import type { FileNode } from './types';
import type { UserType } from '../session/types';

export const filterFileNodeForRead = (node: FileNode, userType: UserType): FileNode | null => {
  /* recursive walk; drop unreadable files; drop subtrees behind un-traversable dirs; preserve dirs with empty children */
};
```

Walks the tree; for each file decides via `canRead`; for each directory decides via `canExecute` AND recursively filters children. Root bypass naturally handled by `canRead` returning allowed for root.

**MUTATE**: file vs dir branching, traversal-failed early-out, children empty-after-filter handling.

**KILL MUTANTS**: Subtree-drop boundary, root bypass, empty-dir survival.

**REFACTOR**: None.

**Done when**: filter tests green; helper exported.

### Step 5: Server adapter — `findWorkstationById`

**RED**: Tests in `src/sessionRegistry/supabaseFindWorkstation.test.ts` (or extend an existing nearby file if naming fits):

- Given a query that returns a row `{player_key, workstation_name, username, seed}`, the adapter resolves to `{ok:true, found:true, row}`.
- Given an empty result set, resolves to `{ok:true, found:false}`.
- Given a query error, resolves to `{ok:false}`.

**GREEN**: New adapter `src/sessionRegistry/supabaseFindWorkstation.ts` (it conceptually belongs to a base-FS module — but we'll co-locate near other session-adjacent fs lookups for now):

Actually, place under `src/patchRegistry/supabaseFindWorkstation.ts` — getBaseFs is a patches action. The adapter takes a `machine_id`, parses it via `parseWorkstationId`, queries `workstations WHERE workstation_name = $name`, and returns rows whose computed workstation_id matches. (Multiple players could choose the same workstation_name; we return all matches and the handler picks the one whose suffix matches the parsed suffix.)

**MUTATE**: Empty-result handling, error handling.

**KILL MUTANTS**: Address.

**Done when**: adapter unit-tests green.

### Step 6: Server adapter — `findFsContentBatch` for projected paths

**RED**: Tests:

- Adapter takes `(machine_id, paths[])`, returns Map<path, content> for rows present.
- Empty paths array: returns empty Map.
- Query error: returns `{ok:false}`.

**GREEN**: New adapter `src/patchRegistry/supabaseFindFsContentBatch.ts` that does `WHERE machine_id = $1 AND path IN ($paths) AND content IS NOT NULL`. Returns `{ok:true, contentByPath: Map<string, string>}` or `{ok:false}`.

**MUTATE**: WHERE clause, NULL handling.

**KILL MUTANTS**: Address.

**REFACTOR**: If this overlaps `supabaseFindMachineFsBatch` (the read-path filter's batch select), confirm they don't collide. The existing batch fetches `(machine_id, path, permissions)`; this one fetches `(path, content)`. Different projections; coexistence is fine.

**Done when**: adapter unit-tests green.

### Step 7: Pure handler — `handleGetBaseFs`

**RED**: Tests in `src/patchRegistry/handler.test.ts`:

- machine_id is a non-workstation pattern (IPv4): `400 unsupported_machine_type`. No workstation lookup attempted.
- machine_id is a workstation pattern but `findWorkstationById` returns `found:false`: `404 workstation_not_found`.
- machine_id matches caller's own workstation suffix: full FS regen + projected overlay returned WITHOUT filtering (owner bypass).
- machine_id is another player's workstation, no active session: `200 {baseFs: null}` (defense-in-depth: eager fetch is post-auth; pre-auth callers get nothing).
- machine_id is another player's workstation, active session at `userType: 'guest'`: regen + overlay + filter; result excludes /root/, /etc/passwd, etc. (whatever guest can't read at the projected perms).
- machine_id matches another player's workstation, active session at `userType: 'user'`: result includes /etc/passwd (readable to user) but excludes /root/.
- machine_id matches another player's workstation, active session at `userType: 'root'`: result includes everything.
- `findWorkstationById` returns `ok:false`: `500 workstation_lookup_failed`.
- `findFsContentBatch` returns `ok:false`: `500 fs_lookup_failed`.
- `findActiveSession` returns `ok:false`: `500 session_lookup_failed`.
- Projected content overlay verified: regen produces /etc/passwd with placeholder hash; after overlay the returned tree has the projected content's real hash (one assertion via deep-walking the returned tree).

**GREEN**: New handler arm in `src/patchRegistry/handler.ts`:

```ts
const handleGetBaseFs = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'getBaseFs' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const parsed = parseWorkstationId(payload.machine_id);
  if (!parsed) return { status: 400, body: { error: 'unsupported_machine_type' } };

  const wsResult = await deps.findWorkstationById({ machine_id: payload.machine_id });
  if (!wsResult.ok) return { status: 500, body: { error: 'workstation_lookup_failed' } };
  if (!wsResult.found) return { status: 404, body: { error: 'workstation_not_found' } };

  // Regen with placeholder rootPassword — projected overlay restores real hash.
  const regen = generateLocalhost(
    {
      seed: wsResult.row.seed,
      workstationName: wsResult.row.workstation_name,
      username: wsResult.row.username,
      rootPassword: PLACEHOLDER_ROOT_PASSWORD,
    },
    payload.machine_id,
  );

  const projectedPaths = listProjectedExactPaths(); // see helper note below
  const fsResult = await deps.findFsContentBatch({
    machine_id: payload.machine_id,
    paths: projectedPaths,
  });
  if (!fsResult.ok) return { status: 500, body: { error: 'fs_lookup_failed' } };
  const overlaid = overlayProjectedContent(regen.fileSystem, fsResult.contentByPath);

  // Tier dispatch.
  if (isOwnWorkstationOnServer(payload.machine_id, publicKey)) {
    return { status: 200, body: { baseFs: overlaid } };
  }
  const sessionResult = await deps.findActiveSession({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (!sessionResult.ok) return { status: 500, body: { error: 'session_lookup_failed' } };
  if (!sessionResult.exists) {
    return { status: 200, body: { baseFs: null } };
  }
  const filtered = filterFileNodeForRead(overlaid, sessionResult.credentials.userType);
  return { status: 200, body: { baseFs: filtered } };
};
```

**Helper note for `listProjectedExactPaths`**: `FS_PROJECTED_CONTENT_PATHS` includes globs (`/var/run/*.pid`); the overlay's content map keys on exact paths. Two options:

- **7a**: Add a sibling helper `listProjectedExactPathsForMachine(machine_id)` that lists every concrete path in machine_filesystems that matches the projection patterns. One extra DB round-trip but fully accurate.
- **7b**: Iterate the regen tree, collect every file path, intersect with `shouldProjectFsContent(path)`, fetch those paths' content from machine_filesystems. No extra round-trip; uses the regen's own path inventory as the projection-target list.

**Decision: 7b**. The regen result has the exact file inventory; checking `shouldProjectFsContent` per file is O(N) cheap. The fetch query becomes `paths IN (filtered list)`. Simpler than maintaining a separate concrete-path projection.

**MUTATE**: Tier dispatch order, owner-bypass branch, error code parity.

**KILL MUTANTS**: Address surviving mutants. Particular focus on the no-session vs. session-with-no-row distinction.

**REFACTOR**: If the tier dispatch shape mirrors `handleListPatchesForMachines`, factor a shared `resolveCallerTier(publicKey, machine_id, deps)` helper. Defer if it's only used by one site post-merge.

**Done when**: handler tests green; no regression on existing patch tests.

### Step 8: Wire api/patches.ts — inject the new adapters

- Add `findWorkstationById` and `findFsContentBatch` to `HandlerDeps`.
- Wire concrete adapters in `api/patches.ts`.
- Add the `getBaseFs` dispatch arm in `dispatchAction`.

**Done when**: vercel:dev boots cleanly and serves the new action.

### Step 9: Client wrapper — `getBaseFs` in patchRegistry/client.ts

**RED**: Tests in `src/patchRegistry/client.test.ts`:

- Successful 200 with `{baseFs: <FileNode>}` returns the FileNode.
- Successful 200 with `{baseFs: null}` returns null.
- 400 unsupported_machine_type → throws (envelope-level error; client should not retry).
- 404 workstation_not_found → returns null (treat as "no base FS to merge"; not an error).
- 401 envelope-level → throws.
- 429 rate-limited → throws.
- Network error → throws.
- Malformed response (missing `baseFs` field) → throws.

**GREEN**: New wrapper:

```ts
export type GetBaseFsResult = { readonly baseFs: FileNode | null };

export const getBaseFs = async (
  identity: Identity,
  machine_id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FileNode | null> => {
  /* signed POST, parse, return baseFs or null on 404 */
};
```

**MUTATE**: 404 handling, malformed response handling.

**Done when**: wrapper tests green.

### Step 10: Client integration — fire `getBaseFs` on session-change for cross-player workstations

**RED**: Tests in `src/filesystem/useFileSystemSync.test.tsx` (or an integration test):

- When the session changes from `(machineA, root)` to `(machineB, user)` where `machineB` has the workstation_id pattern AND is not the player's own workstation AND not yet in `fileSystems`, `getBaseFs(machineB)` is called and on resolve `fileSystems[machineB]` is the returned FileNode tree.
- When the session changes to a non-workstation machine_id (IPv4): no getBaseFs call.
- When the session changes to the player's own workstation: no getBaseFs call.
- When `fileSystems[machineB]` already has an entry (re-entry into existing session): no second getBaseFs call.
- getBaseFs failure: error logged, no state mutation, no exception propagated.
- Subsequent patches refetch (existing path) layers on top of the freshly-merged base FS correctly.

**GREEN**: In `src/filesystem/useFileSystemSync.ts`, extend the existing session-change useEffect (lines ~424-444 today):

```ts
useEffect(() => {
  // ... existing pendingHintMachinesRef + refetchAffectedMachines logic ...

  // PR 6: fetch base FS for cross-player workstations on session establish.
  if (
    isCrossPlayerWorkstation(curr.machine, ownPubkeyRef.current) &&
    !(curr.machine in fileSystemsRef.current)
  ) {
    void getBaseFs(getIdentity(), curr.machine)
      .then((baseFs) => {
        if (!baseFs) return;
        setFileSystems((prev) => ({ ...prev, [curr.machine]: baseFs }));
      })
      .catch((error) => {
        console.error('[fs] base-FS fetch failed:', error);
      });
  }
}, [session.machine, session.userType, refetchAffectedMachines]);
```

`isCrossPlayerWorkstation` reuses `parseWorkstationId` + the suffix mismatch check against the player's own pubkey suffix.

`fileSystemsRef` is a new ref that mirrors the `fileSystems` state (the existing pattern with `patchesRef`). Using a ref avoids triggering the effect on every fileSystems update (stable dep array) while still seeing the latest "is this machine already loaded" answer.

**MUTATE**: Cross-player detection, suffix match logic, "already loaded" guard.

**KILL MUTANTS**: Particular attention to the pubkey-suffix comparison — getting it wrong silently makes either own-box re-fetched (wasted) or cross-player skipped (broken).

**REFACTOR**: None planned.

**Done when**: in-game cross-player SSH lands A in a working shell with B's real FS visible.

### Step 11: Forge smoke — `scripts/testGetBaseFs.ts`

**RED**: New script forging `getBaseFs` envelopes against vercel:dev. Scenarios:

1. **Owner bypass**: forge as Player A on A's own workstation_id → expect 200 with full unfiltered FS (assert `/etc/passwd` content present, `/root/.note` content present).
2. **Non-workstation pattern**: forge with `machine_id: '192.168.1.50'` → 400 unsupported_machine_type.
3. **Missing workstation row**: forge with a workstation_id pattern but no DB row (e.g., `ghost-ffffffff`) → 404 workstation_not_found.
4. **Cross-player no-session**: forge as A on B's workstation_id with no active session row → 200 with `baseFs: null`.
5. **Cross-player guest session**: insert an active session for A on B's workstation_id at `userType: 'guest'`, forge → 200 with FS that excludes /etc/passwd and /root/.
6. **Cross-player user session**: same setup at `userType: 'user'` → /etc/passwd present (real hash from projection), /root/ excluded.
7. **Cross-player root session**: at `userType: 'root'` → everything visible.
8. **Projected overlay verification**: in scenario 7 (root), confirm `/etc/passwd` content matches what's stored in `machine_filesystems`, NOT the placeholder regen.

Self-cleaning: each scenario inserts/deletes its session rows; no test workstations are created (use existing rows from a real registration).

**GREEN**: Ride on Step 1-8; existing handler covers it.

**Done when**: scenarios go from 29 → 36/37 passing depending on count; existing scenarios still green.

### Step 12: Two-browser smoke

Manual cross-player verification on `vercel:dev`:

1. Browsers A and B with cross-player setup (same WiFi, registered identities).
2. B logs in normally; runs `cat /etc/passwd` to capture the expected content.
3. A `nmap`s B's LAN-IP — sees port 22 (sshd auto-running on workstations).
4. A `ssh <B's-username>@<B's-LAN-IP>` (PR 2's server-auth path). Enter B's user password.
5. Network tab: `authCreateSession` 201 → immediately followed by `getBaseFs` 200.
6. A's terminal lands at `<B's-username>@<B's-hostname>:/home/<B's-username>$`.
7. A `cat README.txt` → returns the welcome text from B's box.
8. A `cat /etc/passwd` → returns the same content B captured in step 2 (same root hash).
9. A `su root` with B's root password (which A can guess/crack because the hash is now visible to A as user). Lands as root.
10. A `cat /root/.note` → returns the real .note content.
11. B (still logged into B's own machine) sees auth.log entries for A's logins.
12. Performance check: total time A enters password → A's prompt is interactive: target sub-1s; flag if visibly laggy.

**Done when**: cross-player attack flow fully works through the UI.

### Step 13: Plan + memory updates, lint/format/build/test, PR

- Update plan status table: PR 6 ✅ merged.
- Update memory: `project_cross_player_base_fs_gap.md` (status from "DEFERRED" → "PR 6 SHIPPED — workstations only; mission still parked").
- Add a one-line entry to `MEMORY.md` if PR 6 surfaces any architectural insight worth memorizing (e.g., a layered bug like PR 5's projected-paths-need-dualWrite).
- Run `npm run build && npm run lint && npm run format && npm run test:run`.
- Bump version (`package.json` + `package-lock.json`) — minor bump per `feedback_consolidate_small_helpers` and the version-on-features rule.
- PR description: pidfile-style summary referencing the workstation-only scope, the projected-overlay design, the deferred home/world/mission cases, and the 36/37 forge smoke result.

---

## PR 7: `/api/exploit-read` for `file_read` and `dir_list`

**Goal**: CVE effects `file_read` and `dir_list` work cross-player. Today they run locally against A's incomplete view of B's FS.

**Approach**:

- New `/api/exploit-read` action. Signed envelope: `{ machine_id, path, effect_tier, kind: 'file_read' | 'dir_list' }`.
- Server validates the envelope (signature, replay, etc.).
- **Server validates the effect is real**: the caller must have a recent active session on the target with `kind: 'effect_one_shot'` OR a corresponding entry in a "recent-effects" record (TBD: do CVE effects leave a server-side trace?). This prevents a forger from claiming any tier.
- Server regens the path's content (or directory listing) at the effect tier.
- Returns content/listing.

**Open question on validation**: how does the server know the player ran a real CVE that grants `effect_tier`? Options: (a) the msfconsole flow already creates `effect_one_shot` sessions — extend their semantics to grant cross-machine read; (b) introduce an "effect_grants" table that records active CVE-granted permissions per (player, machine, tier); (c) trust the signed envelope post-rate-limit (weakest).

**Decision needed before implementation.**

---

## PR 8: Hydra adaptation + rate-limit tuning

**Goal**: Hydra brute-forces SSH/FTP cross-player using the server-auth endpoints from PRs 2-3.

**Approach** — two flavors, decide during implementation:

- **8a (client iterates)**: hydra calls the auth endpoint per password attempt; rate limit per (player, target, kind) tuned to allow gameplay (e.g. 50 attempts/sec); slow but UX-equivalent to today.
- **8b (server iterates)**: hydra signs an envelope with a wordlist; server iterates and returns the first hit. Faster but the wordlist hits the wire.

8a is more flexible (player can stop early, see progress); 8b is simpler. Decision deferred to PR start.

---

## Pre-PR Quality Gate (every sub-PR)

Before opening each PR for review:

1. **TDD compliance** — every non-trivial change has a failing test that drove it. No production code without RED first.
2. **Mutation testing** — run the `mutation-testing` skill on changed source files. Document surviving mutants in the PR description; address the meaningful ones.
3. **Refactoring assessment** — run the `refactoring` skill. If improvements add value, do them in a follow-up commit (not the same commit as the GREEN).
4. **`npm run build`, `npm run lint`, `npm run format`, `npm run test:run`** — all pass.
5. **Forged-envelope smoke** — for any PR touching server enforcement (PRs 2-7), write or extend a `scripts/test*.ts` script that forges a non-game-client request and verifies the server rejects/filters correctly. This is non-negotiable per `feedback_e2e_test_new_primitives` and the `multiplayer_security_model` memory.
6. **Two-browser smoke** — for any PR with cross-player visible behaviour, manual two-browser test on `vercel:dev`. Watch the network tab.
7. **Memory + plan update** — after merge, update this plan's status table and the relevant memories. If a sub-PR closes a known-bug or chunk, update MEMORY.md.

---

## How to resume (for context-cleared sessions)

If you (Claude or user) are reading this with no conversation context:

1. Read **all reference memories** at the top — they contain the design rationale.
2. Check the **PR roadmap status table** above — find the first row with status "Not started" or "In progress."
3. Each PR section has its goal + approach. PR 1 has detailed TDD steps; PRs 2-8 have outlines that need to be expanded into TDD steps when their turn comes.
4. The **Decisions made** section is durable — those are settled. The **Decisions deferred** section flags open questions that must be resolved in their respective PRs.
5. The branch `feat/cross-player-base-fs-replication` is the umbrella branch; consider sub-branches per PR (`feat/cpbfs-pr1-foundation`, etc.) for isolation. **Or**: each sub-PR gets its own branch off main, with this plan file maintained on each branch (and merged back to main with each PR). Pattern decision deferred to PR 1 start.
6. Don't re-litigate decisions in the **Decisions made** section without an explicit user prompt.
7. Don't expand scope — DEFERRED items stay deferred until their listed gating event.

When you finish a sub-PR, update the **status table** above (e.g., "PR 1: Merged 2026-05-XX (PR #NNN)") and add a brief one-line note about anything unexpected that surfaced — layered bugs, extra steps, etc.

---

_Delete this file when ALL sub-PRs are merged AND the chunk is verified end-to-end via two-browser smoke. If `plans/` is empty afterward, delete the directory._
