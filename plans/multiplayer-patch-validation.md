# Plan: Patch validation against `sessions`

**Branch**: `feat/multiplayer-patch-validation`
**Status**: Active

## Goal

Make `/api/patches` reject any `upsertPatch` / `removePatch` whose target machine is not `localhost` AND for which the verified player has no active session in the `sessions` table. Then audit-and-fix every client-side write path that doesn't currently push a session, so legitimate writes continue working post-gate.

This is **the actual security boundary** for filesystem mutations in multiplayer, per `project_multiplayer_security_model`. Before this PR, an attacker with their own legit Ed25519 keypair could sign a patch claiming to write to any machine and the server would accept it. After this PR, the server enforces "you must have an active session on the target machine to mutate it". Privilege-escalation _within_ a session (L2 of the validation layers) is deferred — this PR is L1 only.

## Acceptance Criteria

- [ ] `upsertPatch` and `removePatch` handlers reject with 403 `no_session` when `machine_id !== 'localhost'` and the verified player has no active session on that machine
- [ ] `localhost` patches bypass the session check (player always "owns" their localhost)
- [ ] Active-session lookup hits the existing `sessions_active_by_player_idx` partial index
- [ ] FTP login pushes a session row keyed on `(player_key, ftpSession.remoteMachine, ftp credentials)`; FTP logout ends it
- [ ] mysql login pushes a session row; logout ends it
- [ ] redis login pushes a session row; logout ends it
- [ ] scp upload runs inside a `withTransientSession(...)` block that pushes-fires-ends
- [ ] snmpset runs inside `withTransientSession(...)`
- [ ] msfconsole one-shot effects (`file_write`, `password_reset`, `backdoor_port_open`) and script_exec daemon-pidfile writes (`sshd`, `vsftpd`, `nc -l`) run inside `withTransientSession(...)`
- [ ] Smoke test on `vercel:dev`: each bucket-C flow succeeds end-to-end with the gate ON
- [ ] Build, lint, format, full test suite, mutation testing all pass

## Out of scope (explicit — separate PRs)

- **L2 permission walking**: server doesn't yet check that the session's `credentials.userType` has `write` permission on the target path. A guest-session player could still ask the server to delete root-owned files; the client's `canWrite` check is the only thing stopping them. Fixing this requires server-side FS state (deterministic regen + patch replay, OR a `machine_filesystems` table). Future PR.
- **L3 "smart server" game-logic re-run**: server doesn't re-check whether the CVE leading to a session was actually published-by-now, etc. Way later.
- **`kind` field on sessions**: validation doesn't need it; UX (e.g., distinguishing "FTP session expired" from "SSH killed") would. Add when first consumer arrives.
- **Realtime fanout** on session deaths: a session ending on the server doesn't yet push a Realtime event to other tabs/clients. Phase later.
- **Race between session-end and mid-flight upsert**: the player ends FTP, but a buffered `put` upsert lands at the server right after the `endSession`. Currently the upsert would 403. Tolerable for v1.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Read `.claude/CLAUDE.md` and the testing rules before writing each step.

**Important — game breaks between Step 1 and Step 7.** After Step 1 lands, every bucket-C flow (FTP put, scp upload, mysql UPDATE, redis writes, snmpset, msfconsole one-shot effects, script_exec daemon writes) returns 403 from the server. Steps 2-7 progressively restore them. This is acceptable per the user's call (no live players); each commit is still testable in isolation.

### Step 1: Server validation gate

**Acceptance criteria**:

- New `src/sessionRegistry/supabaseSelectActive.ts`: `createSupabaseFindActiveSession(query)` — `SELECT 1 FROM sessions WHERE player_key=me AND machine_id=X AND ended_at IS NULL LIMIT 1`. Returns `{ exists: boolean }` (we don't need the row itself yet — that's L2's concern).
- `src/patchRegistry/handler.ts` extends `HandlerDeps` with `findActiveSession: (params: { player_key, machine_id }) => Promise<{ exists: boolean }>`.
- `handleUpsertPatch` and `handleRemovePatch` consult `findActiveSession` BEFORE calling their respective adapters when `payload.machine_id !== 'localhost'`. Reject with `{ status: 403, body: { error: 'no_session' } }` on miss.
- `localhost` patches bypass the check entirely (one-line `if` early return path).
- `api/patches.ts` wires the new adapter to a real Supabase query against the `sessions` table.
- The `PERSISTENT_MACHINE_ID = 'localhost'` constant from `supabaseDelete.ts` is reused so the localhost literal lives in one place across the patchRegistry module.
- The session-existence query uses the existing `sessions_active_by_player_idx` partial index (verified by query plan or by spec — comment cites it).
- Reads of patches (`listPatches`, `clearTransientPatches`, `clearOwnedPatches`) are NOT gated — they're scoped to the player's own data and don't depend on machine ownership.

**RED**: New tests in `handler.test.ts`:

- upsertPatch on `machine_id='localhost'` with no session → 200 (gate skipped)
- upsertPatch on remote machine_id with no session → 403 `no_session`
- upsertPatch on remote machine_id with active session → 200
- removePatch parity (localhost bypass, 403 on missing, 200 with session)
- player_key passed to findActiveSession matches verified pubkey (not client-claimed)
- findActiveSession DB error → bubbles as 500 distinct from 403 (the lookup itself failed, not "no session")
- New tests for `createSupabaseFindActiveSession` adapter: returns `exists: true` when query returns a row, `exists: false` when empty.

**GREEN**: Wire the adapter and gate. Pass `findActiveSession` through `HandlerDeps`. Branch on machine_id in each mutating handler. Wire the underlying `.select('session_id').eq(...).is('ended_at', null).limit(1)` in api/patches.ts.

**MUTATE**: Mutation testing on the gate condition (`machine_id !== 'localhost'`, `if (!exists)`), the early-return path, and the 403 status code.

**KILL MUTANTS**: Address survivors. Notable risks: equality vs strict-not-equal on `'localhost'`, double-negation on `exists`, status-code mutation 403→401 (different semantic).

**REFACTOR**: If `STATUS_BY_VERIFY_REASON` is now used in 4 places (allocate-ip, sessions, patches handler verify, patches gate response... actually no, the gate uses 403 directly, not the verify-reason map), revisit extraction. Likely defer.

**Done when**: All handler tests pass, mutation report clean, manual smoke: `curl` POST a signed `upsertPatch` envelope with a non-localhost machine_id and no session in DB → 403; insert a session row, retry → 200.

### Step 2: FTP login pushes session

**Acceptance criteria**:

- FTP login command (find via `grep` for `setFtpSession(...)` with non-null arg) calls `pushSession(...)` with `machine: ftpSession.remoteMachine`, `username: ftpSession.remoteUsername`, `userType: ftpSession.remoteUserType`, `currentPath: ftpSession.remoteCwd`, `reason: 'ssh'` (placeholder; `kind` field deferred).
- The push is fire-and-forget per the existing `feedback_react_context_server_integration` memory.
- FTP logout (the `setFtpSession(null)` call sites — there are several per the audit) calls `endSession(...)` for the FTP session_id with `reason: 'user_exit'` (or `'ftp_disconnect'` if we want a distinct value — the schema accepts any short string).
- The `ftpSession` state needs to track the server-issued session_id for the eventual `endSession`. Either extend `FtpSession` with `sessionId: string | null` or store the id separately. Mirrors what `Session.sessionId` does today.
- Existing FTP tests pass; new tests cover the push/end pairing.

**RED**: Tests in `ftp/login.test.ts` (or wherever the login lives) — assert `pushSession` mock called with the right args on connect; `endSession` mock called on quit/disconnect.

**GREEN**: Wire `pushSession` + `endSession` into the FTP login/logout commands. Extend `FtpSession` with `sessionId` if we go that route.

**MUTATE**: Run on the new wiring.

**KILL MUTANTS**: Address.

**REFACTOR**: Look for an "auxiliary session" abstraction emerging across FTP/mysql/redis. May be premature after just FTP — revisit at Step 4.

**Done when**: FTP `put` smoke test on `vercel:dev` passes (would 403 before this step, succeeds after).

### Step 3: mysql login pushes session

**Acceptance criteria**:

- Same pattern as Step 2, applied to mysql login/logout. The `MysqlSession` type extends with `sessionId`. mysql `EXIT`/`QUIT`/disconnect ends the session.
- All existing mysql command tests still pass; new tests cover push/end.

**RED**: Tests in `mysql.test.ts` (or wherever).

**GREEN**: Wire push/end.

**MUTATE / KILL MUTANTS / REFACTOR**: As Step 2.

**Done when**: mysql `UPDATE` smoke test passes.

### Step 4: redis login pushes session

**Acceptance criteria**:

- Same pattern, redis. `RedisSession` extends with `sessionId`.
- After this step, the auxiliary-session abstraction is well-shaped — extract a small helper if the duplication is real (`useAuxiliarySession({ machine, credentials, ... })` or similar).

**RED / GREEN / MUTATE / KILL MUTANTS / REFACTOR**: As Step 3.

**Done when**: redis `SET key value` smoke test passes.

### Step 5: scp transient session + `withTransientSession` helper

**Acceptance criteria**:

- New helper `src/session/withTransientSession.ts`:
  ```ts
  withTransientSession<T>(
    identity: Identity,
    params: { machine_id, credentials, parent_session_id?, source_ip? },
    body: (sessionId: string) => Promise<T>,
  ): Promise<T>
  ```
  Pushes a session, runs `body` (passing the new session_id in case the body wants to store it), ends the session in a `finally` block (ends regardless of body success/throw). Returns `body`'s result.
- scp's transfer code wraps the `createFileOnMachine`/`writeFileToMachine` call in `withTransientSession`. Credentials come from the scp auth args.
- `withTransientSession` has its own unit tests covering: happy path (push → run → end), body throws (push → end → re-throw), push fails (no end, error propagates), end fails (logged, doesn't shadow body's success/error).
- scp existing tests pass; new tests confirm the wrapper is invoked with the right args.

**RED**: Tests for the helper first; then for scp's wrapping.

**GREEN**: Implement helper + wire into scp.

**MUTATE**: On the helper's try/finally and the params it forwards.

**KILL MUTANTS**: Address.

**REFACTOR**: The helper's signature crystallizes here for Steps 6 + 7 to reuse.

**Done when**: scp upload smoke test passes.

### Step 6: snmpset transient session

**Acceptance criteria**:

- snmpset's write code wrapped in `withTransientSession` from Step 5. Credentials inferred from the SNMP community string handling (or a fixed "snmp_admin"-style placeholder if the game model doesn't have user-level SNMP creds).
- Existing snmpset tests pass; new tests confirm the wrapper invocation.

**RED / GREEN / MUTATE / KILL MUTANTS / REFACTOR**: As prior.

**Done when**: snmpset smoke test passes (write a value via snmpset, see the patch land server-side without 403).

### Step 7: msfconsole one-shot effects + script_exec daemon writes

**Acceptance criteria**:

- The `writeRemoteFile` (and any sibling `mutateRemote*`) callbacks in msfconsole's effect dispatcher (`useNetworkCommands.ts:471` and friends per the audit) wrap the underlying mutating call in `withTransientSession`. Credentials come from the effect's tier (`shell_full root` / `password_reset user` / etc.).
- Effect kinds covered:
  - `file_write` — already calls writeRemoteFile, gets the wrapper.
  - `password_reset` — modifies `/etc/passwd` on the target.
  - `backdoor_port_open` — writes nc pid file on the target. Verify the iptables write at the gateway IP also gets a session (it's currently flagged as risky-but-gated by the audit).
  - `script_exec`-launched daemon writes (`sshd`, `vsftpd`, `nc -l` pid files at `useNetworkCommands.ts:312-340, 385-392`) — wrap each daemon-start helper in `withTransientSession` keyed to the target.
- All existing effect tests pass; new tests confirm wrapper invocation.

**RED**: Tests for each effect kind individually, asserting the transient session is pushed-fired-ended.

**GREEN**: Wire the wrapper into each writeRemote\* callback / daemon-start path.

**MUTATE**: On each wrapper invocation, on the credentials-derivation logic.

**KILL MUTANTS**: Address.

**REFACTOR**: This step touches a lot. Look for a single point where all msfconsole-effect remote writes funnel through, and wrap once there if possible. Otherwise multiple call sites get the wrapper.

**Done when**: For each of `file_write`, `password_reset`, `backdoor_port_open`, and `script_exec` (sshd / vsftpd / nc -l), trigger an exploit on `vercel:dev` and verify the resulting patches land server-side without 403.

### Step 8: pre-PR quality gate

**Acceptance criteria**:

- `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green
- Mutation testing summary clean across all new files
- Refactoring assessment done — revisit `withTransientSession` shape now that it has 6+ call sites
- `src/sessionRegistry/README.md` — updated Files table + "Active-session lookup" section, reference the new validation responsibility
- `src/patchRegistry/README.md` — add "Server-side validation against sessions" section explaining the gate and the L1/L2/L3 layering
- `docs/technology-choices.md` — promote the Patches row's status from "validation deferred" to "L1 validation shipped; L2 (permission walk) deferred". New section "Patch validation: L1 session-existence gate, L2 permission-walk deferred" if useful.
- Version bump in `package.json` + `package-lock.json` (0.102.0 → 0.103.0)
- Plan file (this) deleted, `plans/` pruned if empty
- End-to-end smoke test on `vercel:dev`:
  - SSH-class writes still work (regression check)
  - FTP put works
  - FTP get still works (was always covered)
  - scp upload works
  - scp download still works
  - mysql UPDATE works
  - redis SET works
  - snmpset works
  - For each of the 8 msfconsole effect kinds, an exploit on a real target lands its patch
  - Direct attack: signed envelope with `machine_id` of a machine you have no session on → 403

**Done when**: PR opened, all gates pass, ready to merge.

## Pre-PR Quality Gate

Before merging:

1. Mutation testing — run `mutation-testing` skill across new files
2. Refactoring assessment — run `refactoring` skill, especially on `withTransientSession`
3. Typecheck + lint + format + tests pass
4. End-to-end smoke test (above)
5. Verify `web-security-audit` skill checklist for the new gate: confirm RLS posture unchanged on patches table, no new fields client-supplied to the validator query, the 403 leaks no info beyond "no session".

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
