# Plan: two log lines landing together both land

**Status:** grill complete + plan drafted (2026-10-30) — ready to implement (TDD). Not yet started.

Every system log line (an `sshd` login, a scan's `kern.log`, a web hit's `access.log`, and the
rest) lands through `appendMachineLog` (`src/core/patches/appendMachineLog.ts`), which reads the
log as a reader sees it, adds the line and writes the file back. Two appends to one log at the
same moment can each build on the same read, and the second write drops the first one's line.
Found in the talkit epic (2026-10-19): three parallel talkit fetches left two lines in
`access.log`, and `scripts/testTalkit.ts` has fetched in turn since. In play it costs a defender
a line of evidence whenever two visitors hit one box at once, which multiplayer makes common.

The fix moves the append into the database: one function locks the log's path, reads the latest
row the way a reader orders them, and writes the appended row, all in one transaction.

---

## Grill record (2026-10-30)

1. **Shape: a database-side append.** A new SQL function (an RPC, as `talkit_post` and the email
   functions are) takes `pg_advisory_xact_lock` on the log's `(machine_id, path)`, reads the
   latest row at the path by the reader's order, appends the text and upserts the writer's row,
   in one transaction. Callers make one call where they made a read and a write. Readers are
   unchanged. Rejected: a row per line (every reader of a log, and root's truncate and `rm`,
   would learn a new shape) and an optimistic retry on conflict (a capped retry loop, which can
   still drop a line under load).

2. **`updated_at` is stamped by `clock_timestamp()` for every write.** The trigger and the
   column default move off `NOW()`, which is the transaction's START: an append that waited on
   the lock would otherwise write a row a reader ranks below the row it built on. One stamping
   rule for the whole journal. Every write through supabase-js is its own transaction, so an
   ordinary write stamps what it stamps today. Rejected: stamping only the append's row (the
   trigger would need to let one function through: two rules in one table).

3. **Only system appends take the lock.** A player's own write to a log (root's `> auth.log`,
   `rm`) still goes through the ordinary write path. If a wipe lands in the milliseconds between
   an append's read and its write, the append wins and the wiped lines come back; the root wipes
   again. Recorded as an accepted limit in `backlog.md`. Rejected: moving `handleUpsertPatch`
   onto a locked function too (it rewrites the write path every command uses, a slice of its
   own).

4. **Handlers take one `appendLog` dep.** `AppendMachineLogDeps` becomes `{ appendLog }`, the one
   call to the database function. Core still turns the lines into one-line text (`onOneLine`
   stays the single place a line is held to one line); the database adds it to the latest row.
   Tests share one in-memory fake that appends the way the function does. A handler keeps
   `upsertPatch` only where it also writes something other than a log. Rejected: keeping
   `{ readLog, upsertPatch }` and changing only the wiring behind them (`readLog` becomes dead
   wiring and the fakes model a read-then-write the server no longer does).

5. **Proof: a new race wire-check.** `scripts/testLogAppend.ts` against `vercel dev` + supabase
   fires about 20 fetches of one site at once and asserts `access.log` gained all 20 lines; checks
   a root wipe sticks (the next line lands on an empty log, not on the wiped lines); and checks
   the next line builds on another writer's newer row. `testTalkit` goes back to fetching in
   parallel; the wire-checks that already read logs run as regression. No browser run (no client
   change). Rejected: re-running the existing checks only (three parallel fetches lose a line only
   some of the time, so a pass proves little, and nothing checks the ordering rule).

6. **Defaults, applied with the plan (the owner may overrule):**
   - **The own-box log endpoints are in scope.** `handleAppendAuthLog` and `handleAppendKernLog`
     run the same read-then-write on the player's own box, and race a visitor's `sshd` line just
     the same, so they move onto `appendLog` too. They keep answering `500` on a failed append
     (the player asked for that line), where `appendMachineLog` stays fire-and-forget.
   - **The guardian is out of scope.** `scripts/guardian.ts` appends its `passwd` lines to
     `auth.log` in the decider from the journal it already read. An operator round racing a live
     login is rare, and a dropped guardian line is the operator's own. Noted beside decision 3.
   - **`api/patches.ts`'s four hand-copied `readLog` closures go away** with the reads, which
     closes that backlog item.
   - One slice, one PR, a patch version bump (a fix, as #743 was).

---

## Design (how the decisions map to the engine)

**Migration (`supabase/migrations/20261030000000_append_machine_log.sql`).**

- `patches_set_updated_at()` sets `NEW.updated_at = clock_timestamp()`; `patches.updated_at`
  defaults to `clock_timestamp()`.
- `append_machine_log(append_machine_id, append_path, append_writer_key, append_owner,
  append_permissions JSONB, append_text) RETURNS void`, `LANGUAGE plpgsql`:
  1. `PERFORM pg_advisory_xact_lock(hashtextextended('machine_log:' || append_machine_id || ':'
     || append_path, 0))`.
  2. The current log: the content of the row at `(machine_id, path)` ordered
     `updated_at DESC, writer_key COLLATE "C" DESC LIMIT 1`, and `''` when there is none or it is
     a tombstone (`content IS NULL`). This restates `orderPatchesForReplay`, whose tiebreak is a
     JS code-unit compare; `COLLATE "C"` makes Postgres compare bytes, so a same-instant tie
     breaks the same way in both. The SQL header names the TS rule it restates.
  3. `INSERT … VALUES (…, current || append_text, …, 'file') ON CONFLICT (machine_id, path,
     writer_key) DO UPDATE SET content, owner, permissions, node_type` (not `is_new`, which the
     supabase-js upsert never sent either). The trigger stamps it.
- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`, as
  `talkit_post` does.

**Core (`src/core/patches/appendMachineLog.ts`).** `AppendMachineLogDeps = { appendLog }`, where
`appendLog: (append: MachineLogAppend) => Promise<{ readonly error: unknown }>` and
`MachineLogAppend` carries `machine_id`, `path`, `writer_key`, `owner`, `permissions`, `text`.
`appendMachineLogLines` builds `text` (`lines.map(onOneLine).join('\n') + '\n'`) and calls it,
ignoring the error as today. `logAsReadersSeeIt` and `MachineLogReadQuery`/`Result` go once
nothing reads them (the two own-box handlers are the other readers). The header's
"read-modify-write" paragraph becomes "the database appends under a lock" and keeps the why of
building on every writer's latest row.

**The shared fake (`src/test/fakes/machineLogJournal.ts`, beside the existing factories).** An
in-memory journal whose `appendLog` appends to the latest row by `orderPatchesForReplay`, and a
reader of a log as it stands. Every handler test that faked `readLog` + `upsertPatch` for a log
moves onto it.

**The glue.** Each endpoint file (`api/network.ts`, `api/patches.ts`, `api/sessions.ts`) gets an
`appendLogVia({ supabase, label })` beside its `listPathPatchesVia`, calling
`supabase.rpc('append_machine_log', …)` and logging the label on error. Module scope in each
endpoint, not a shared `api/` file (every `api/*.ts` is a published function). The scripts that
build handler deps directly (`testFtpSession`, `testFtpSweepTrace`, `testLocalExploitTraces`,
`testLogFieldEscaping`, `testMysqlSweepTrace`, `testOwnBoxLogin`, `testScpTransfer`) move too.

**Unchanged:** every reader of the journal, `handleUpsertPatch`, the guardian.

---

## TDD slices (each leaves the tree green)

1. **RED: the race wire-check.** Write `scripts/testLogAppend.ts` and run it against the stack as
   it is: the parallel fetches must lose lines (if 20 never lose one, raise the count until they
   do, so the check can fail). Commit nothing yet.
2. **The migration.** Write it, `supabase db reset` locally, and prove by hand that an ordinary
   upsert still stamps and orders as before (the unit suite does not see SQL).
3. **Core onto `appendLog` (behaviour-preserving).** The shared fake first, then
   `appendMachineLog` and every handler and test that logs, with the unit suite green throughout.
   The `appendMachineLog` tests keep their behaviour claims (one line per break, several lines in
   one append, the line lands after every writer's latest row, a tombstone restarts the log, a
   failed append is silent) against the fake.
4. **The own-box endpoints.** `handleAppendAuthLog` and `handleAppendKernLog` onto `appendLog`,
   keeping their `500` on a failed append (a test per handler).
5. **Glue + GREEN.** `appendLogVia` in the three endpoints and the scripts' deps.
   `testLogAppend` passes; `testTalkit` fetches in parallel again and passes; the log-reading
   wire-checks pass (the scripts above plus `testGuardian`, `testInnerGatewayReach` and the sweep
   traces).
6. **Docs.** `conventions-and-gotchas.md` (the journal stamps with `clock_timestamp()`, and a
   system line goes through `append_machine_log`), the `appendMachineLog` entry in
   `cross-player-architecture.md` if it describes the read-then-write, `backlog.md` (close the
   lost-line item and the `readLog` closures item; add decision 3's accepted limit and the
   guardian note), `project-status.md`. Version bump in `package.json` + `package-lock.json`.

## Evidence & gates

- `npm run typecheck`, `npm run lint`, the unit suite.
- Wire-checks against `vercel dev` + local supabase: `testLogAppend` (new) and the regression set
  in slice 5. The `api/` layer is unproven until they run.
- Mutation gate (Stryker, json reporter) on `appendMachineLog.ts`, `appendAuthLog.ts` and
  `appendKernLog.ts` at PR readiness. The SQL has no mutation harness: `testLogAppend` is its
  evidence.
- Browser: none (no client change).
- The migration goes to jshack-dev, then jshack-prod, with the owner's go, link → push → unlink
  per project, BEFORE the PR merges: a merge deploys, and code calling a function prod lacks would
  drop every system line silently and fail the own-box endpoints. The migration alone is safe to
  land early (the stamp change orders ordinary writes as before; nothing calls the function yet).

## Out of scope

- Player writes taking the lock (decision 3).
- The guardian's `auth.log` lines (decision 6).
