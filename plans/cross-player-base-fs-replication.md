# Plan: Cross-Player Base FS Replication + Server-Authoritative Auth + CVE Read Endpoint

**Status**: Active — PR 1 ✅ merged; PR 2 ready for review (steps 1-11 ✅, step 12 deferred)
**Started**: 2026-05-07
**Current branch (PR 2)**: feat/cpbfs-pr2-server-auth
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
| 2   | Ready for review                   | Server-authoritative auth — SSH / SCP / `su`                         |
| 3   | Pending PR 2                       | Server-authoritative auth — FTP                                      |
| 4   | Pending PR 2                       | Server-authoritative auth — MySQL / Redis / SNMP                     |
| 5   | Pending PR 1                       | Backdoor connect (nc) — cross-player tier from projected pidfile     |
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

**Goal**: FTP login validates against `/etc/vsftpd/virtual_users.conf` and `/etc/passwd` server-side. Mirrors PR 2's shape with FTP-specific credential file.

**Approach**: Add `kind: 'ftp'` to the auth endpoint dispatch. Server reads both files, parses, validates. On success creates `kind: 'ftp'` session row.

---

## PR 4: Server-authoritative auth — MySQL / Redis / SNMP

**Goal**: Same shape as PR 2/3 for MySQL (`/var/lib/mysql/data.json`), Redis (`/etc/redis/redis.conf`), SNMP (`/etc/snmp/snmpd.conf`).

**Approach**: Extend auth endpoint dispatch with three more kinds. Each reads its credential file from `machine_filesystems.content`, validates with the protocol's specific shape (MySQL has multiple users; Redis has a single password; SNMP has a community string).

---

## PR 5: Backdoor connect (nc) cross-player tier

**Goal**: When A runs `nc <B's-IP> <port>` to a backdoor port (CVE-opened or `nc -l`-opened), the server reads `/var/run/<svc>.pid` content from `machine_filesystems` to determine the tier and creates the `kind: 'nc'` session at that tier.

**Approach**: nc-connect goes through a `kind: 'nc_connect'` action on the auth endpoint. Server reads the pidfile content (now projected after PR 1), parses the `userType=...` field, creates session at that tier.

**Note**: the `Port.owner` field on `RemoteMachine` is populated client-side from pidfile content. After this PR, the canonical source of `Port.owner` for cross-player machines becomes server-side; client-side derivation continues for own-machine convenience.

---

## PR 6: Base FS replication endpoint (eager bulk-fetch)

**Goal**: When A establishes a session on B's machine, A receives B's full base FS filtered by A's session userType.

**Approach**:

- New `/api/base-fs` action (or extend `/api/patches` with a sibling action). Signed envelope carries `{ machine_id }`.
- Server determines machine type (workstation vs home-network vs world-network vs mission).
- Server reads `seed` from the appropriate table.
- Server regens the base FS via the appropriate generator (workstation: `generateLocalhost`; home: `generateNetwork`; world: theme-dispatched generator).
- Server applies stored patches.
- Server filters every `(path, content)` through the read-permission walker using the caller's session userType.
- Returns the filtered FileNode tree.
- Client merges into local `fileSystems[machineId]` after session-create. Subsequent reads are local. Patches stream via existing Realtime.

**Critical concern**: regen on server requires the server to import generation code. The generators (`generateLocalhost`, `generateNetwork`, themed generators) already work in TS-only mode (they're called by the backfill scripts). Verify they don't drag in browser-only dependencies.

**Performance**: bulk regen + filter is one synchronous burst per session-establish. For a workstation FS (~50KB content), this is sub-100ms. Profile if it shows in real player UX.

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
