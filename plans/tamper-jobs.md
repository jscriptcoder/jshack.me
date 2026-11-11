# Plan: a contract that asks for a record to be changed

**Status:** Grilled and planned 2026-11-11. Four slices, one PR each, merged in order. Slice 1
merged (#766, v0.454.0). Slice 2 in progress on `feat/tamper-erase`; its criteria were approved
with an erase target that always holds an F, erase pitches of its own, and a `show` line
`Erase: <student>, <subject> (F)`.

A second kind of contract. Every contract today is a key job: find the key, mail it back, and the
client compares the string. A **tamper job** asks the player to change or erase one record in the
target's own data (a grade at a school, a warrant at a police department, an age at a members
club), and the client checks the records themselves. It draws on legacy's `tamper` and `db_tamper`
objectives ([`docs/mission-ideas/objectives.md`](../docs/mission-ideas/objectives.md) §3 and §5),
without legacy's substring check. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The proof

1. **The client checks the world (2026-11-11).** Any mail from the contractor to the client
   triggers the check; what it says does not matter ("it's done", "I did it", anything), and a
   wallet in it is read for the pay as today. The server materializes the records box as a reader
   would see it, journal and every visitor's edits included, and reads the target. Completion
   freezes the job, so nothing done to the box afterwards matters. This amends the rule in
   `missions-architecture.md` ("the proof is a key, not the network's state") to: **key jobs compare
   a key, tamper jobs read the box.** Rejected: a receipt the box emits on the change (a token can be
   copied, leaked or forged by writing the log line by hand, and every target needs machinery that
   watches for the change).

2. **The target is right and nothing else in its table moved (2026-11-11).** A change passes when
   the target cell holds the new value and every other row and column of that table or file equals
   what the box was generated with. An erase passes when the target row is gone and every other row
   is unchanged. `UPDATE grades SET grade='A'` with no `WHERE` loses the job. "Unchanged" means equal
   to the generated content, so a row deleted and restored exactly counts as unchanged. A rival
   holding the address can sabotage a job by touching any row, which is part of the shared-network
   race, not a bug. Rejected: the target field alone (a careless statement passes); the whole box
   untouched (any visitor's `/tmp` file would fail it).

3. **Retry forever (2026-11-11).** A failed check leaves the job accepted; the contractor fixes
   things and mails again, held only to the 20-sends-an-hour limit. The client never burns a job. A
   wrecked database table can be repaired by a root editing `/var/lib/mysql/data.json`; anyone else
   drops the job. Rejected: burning the job on a wreck (a rival could burn your contract by changing
   one stray row and waiting); a capped number of tries.

4. **One reply for every failure (2026-11-11):** "Our records don't look right. No change, no
   money." Old value still there, a third value, the target right but other rows touched, the
   records missing: the player works out which. Rejected: separate "nothing changed yet" and "you
   made a mess" replies (a nudge; the owner wants players to learn the hard way).

5. **No records means failed (2026-11-11).** A deleted CSV or datadir, or a bricked records box,
   fails the check with the same reply. A root can retype a deleted file; a bricked box can never
   pass, and the contractor drops the job. Bricking stays a weapon a rival can use. Rejected: a
   bricked box counting as erased (bricking becomes a shortcut for every erase job); the client
   reading a backup (a second source of truth; it belongs to the "two copies" twist below).

6. **Exact text after unquoting and trimming (2026-11-11).** Surrounding spaces and the CSV's or
   SQL's quotes do not count; the value itself must be exactly what the briefing quoted, case
   included, numbers compared as text (`Cleared` and `21.0` fail against `cleared` and `21`). The
   same rule holds the other rows to their exact generated values. Rejected: case-insensitive, with
   numbers compared as numbers (a second set of rules to explain and test).

### The job

7. **Storage is drawn per contract, database or file, half each (2026-11-11).** A database job keeps
   the records in a table of the box's datadir; a file job keeps them in a CSV with a header row. The
   client parses either into rows and compares values, so a file's formatting (spacing, quotes, line
   endings) does not count. Rejected: database only; loose text formats such as a `key: value`
   report or a `.conf` (each needs its own parser and its own idea of "unchanged"; more formats can
   come later).

8. **Change and erase (2026-11-11).** Both work today in either storage, and the check is one
   checker plus "row gone". **Add** waits: the game's `mysql` has no `INSERT`, and how strictly a
   typed row must match (column order, required fields, an id nobody gave) is its own decision.

9. **Access mirrors where the key is stored today (2026-11-11).** A database job's box runs `mysqld`
   behind a `:3306` forward with a crackable application login and a shut database root, as database
   key storage does: `hydra <address> mysql`, then `UPDATE … WHERE` or `DELETE … WHERE`, no shell
   needed (the application tier may `UPDATE` and `DELETE`; `DROP` is database root's,
   `WRITERS` in `src/core/mysql/statements.ts`). A file job's CSV is root-only under
   `/srv/<stem>/records/`, reached by the route's root and edited with `nano`. Either way the route
   roots the box, and a root can edit `data.json`. Today's six routes, the decoys and the
   one-in-three two-hop layout all apply, with the records box in the key box's place. Rejected:
   database jobs needing a shell first (hides the database behind the route and makes the two
   storages play alike); a file owned by an app user whose login leaks (a new leak target; it is the
   "harder leaks" backlog item).

10. **Eight settings, one target table each (2026-11-11).** A tamper contract draws a setting, which
    names the target (stem + institution word) and brings the table's columns, 20–40 generated rows,
    and which column a change targets and what an erase removes:

    | Setting    | Target (stem +)  | Table / file | Columns                            | Change                     | Erase                    |
    | ---------- | ---------------- | ------------ | ---------------------------------- | -------------------------- | ------------------------ |
    | School     | Academy          | `grades`     | id, student, subject, grade        | a grade, D → A             | a failing grade          |
    | Police     | Police Dept      | `warrants`   | id, name, dob, offence, status     | status `active` → `cleared` | a warrant                |
    | Payroll    | Holdings         | `payroll`    | id, name, dept, salary             | a salary, raised           | — (change only)          |
    | DMV        | Motor Registry   | `offences`   | id, licence, name, offence, points | points → 0                 | an offence               |
    | Tournament | Esports League   | `scores`     | id, player, game, score            | a score, raised            | a rival's score          |
    | Admissions | University       | `applicants` | id, name, dob, program, status     | `rejected` → `admitted`    | a rival applicant        |
    | Club       | Members Club     | `members`    | id, name, age, tier, status        | an age, 17 → 21            | a ban                    |
    | Registry   | Vehicle Registry | `vehicles`   | plate, owner, make, model          | the owner's name           | a stolen-vehicle flag row |

    One table per job: no joins, and "nothing else moved" is about that one table. Ages and names
    are fields like any other. A setting may support one action only (Payroll is change-only), which
    is content, not a rule. Rejected: trimming the list to start.

11. **Neighbour tables (2026-11-11).** Each setting brings 2–3 tables or CSVs and the job targets
    one (School: `grades`, `attendance`, `staff`; Police: `warrants`, `incidents`, `officers`). In
    the database `SHOW TABLES` lists them all; a file job's CSVs sit together in
    `/srv/<stem>/records/`. Neighbours are plain rows the check never reads, and they share no people
    with the target table, so a `WHERE` on a name cannot land in the wrong table. Rejected: the
    target alone (nothing to look for); neighbours that also hold the target person (a trap that
    only wastes effort, since the check ignores them).

12. **The briefing says who, which field, old → new (2026-11-11).** A change: "Mara Quill's
    Chemistry grade reads D. It should read A." An erase: "There is an active warrant for Jonas Reid.
    It should not exist." Never the row id, the table or file name, the box or the path. The
    generator makes exactly one row fit the description: names are unique within a table (name and
    subject for School, where a student appears once per subject). Rejected: giving the row id (the
    search becomes pointless); withholding the old value (it is in the table anyway, and it lets the
    player confirm the row).

### The board

13. **The same ten clients, as fixers (2026-11-11),** each setting bringing 3–5 pitches of its own
    ("A client of ours needs a report card to read better before Friday."). No new reserved handles,
    and the one-client-per-offer rule is unchanged. Rejected: a client per setting (a parent, a
    lawyer, a rival gamer: more handles, and the handle would tell the setting before the board
    does); a mix. Direct clients can join later as content.

14. **Pay 1,000–2,500 JSC single-hop, 2,500–5,000 two-hop (2026-11-11),** whatever the storage, a
    premium over key jobs' 500–2,000 and 2,000–4,000 for the stricter check. The pay never tells
    database from file, as it never tells a key's storage today. Rejected: file jobs paying more
    because they need root (the board would tell the storage); key jobs' ranges.

15. **Half the contracts are tamper jobs (2026-11-11),** the kind drawn from the number on a stream
    of its own, so no contract's topology, route, hashes, key, storage or pay moves. Two-hop stays
    one in three within each kind; storage, setting and action are drawn on streams of their own.
    The kind is drawn, not stored, so about half of today's accepted key contracts re-roll into
    tamper jobs on ship (same address, the key box becomes a records box). That costs nothing while
    prod has only test players. Rejected: one in three; weighting toward the new kind; storing the
    kind in `hireme_missions` (breaks "nothing about the network is stored").

16. **The board line names the action and the setting (2026-11-11):** `alter a school record`,
    `erase a police record`, `alter a payroll record`, and `internal` for two-hop
    (`alter an internal school record`). The storage stays hidden. Rejected: the action alone; a
    bare `tamper with a record`.

## Given, not chosen

Carried over from key jobs unchanged, confirmed with the owner at the end of the grill:

- **A passing mail with a wallet** completes the job, mints the pay and lands the reply ("Records
  received. §N sent to jsc…", wording set in the plan) in one transaction under the handle's lock,
  so two passing mails sent together pay once.
- **A passing mail with no wallet** completes the job and pays nothing.
- **A mail after completion** gets "That job is already closed." and the box is not read.
- **A mail from anyone who is not the contractor** gets "We have no contract with you."
- **`/etc/hireme/contracts`** is unchanged: one line per accepted job, no kind.
- **`hireme.ts show`** prints the kind, setting, action, target record and storage beside today's
  routes and services.
- **The generator ships in the bundle and the seed is public**, so the records' generated content
  is not a secret, and the server can rebuild it to compare. Nothing here needs `MISSION_KEY_SECRET`.

## Later, set aside in the grill

- **Add a record** (needs `INSERT`, or a file-only add).
- **Two copies**: the record also sits in a nightly CSV export or a `.bak`, and the client checks
  both.
- **Stealth**: a `changes.log` or `audit_log` table the client also wants clean (the backlog's
  stealth template).
- **White-hat fix**: restore a corrupted value, legacy's `db_fix`.
- **Direct clients** per setting, and more settings.

---

## Where it plugs in

Read before slice 1; every path is today's code.

- **The shape** (`src/core/missions/missionShape.ts`) draws everything from the number on named
  streams. A new stream, `mission-kind-<n>`, decides key or tamper, so no key contract's topology,
  route, hashes, storage, decoys or two-hop draw moves. On a tamper contract the key box is the
  **records box**: same octet, same route, same decoys, same two-hop placement, same hostname
  (`<stem>-files`, so no machine id moves). Its storage is drawn on a stream of its own, not
  `mission-storage-<n>`, which stays the key's.
- **Database records reuse database key storage.** A key contract on `database` storage already
  gives the key box `mysqld`, a crackable application account, a shut database root and a `:3306`
  forward (`keptInDatabase`). A tamper contract on database storage takes exactly that path, and
  `datadirFile` (`src/core/missions/missionLeak.ts`) lays the records tables where it lays
  `api_keys`, beside `settings` on the mysql route. The records are generated from the number
  alone (no secret), so the client generator and the server agree on them.
- **Reading the box at mail time** is `generatedLanBox(findPatches, essid, ip, findMissionFiles)`
  (`src/core/network/generatedLanBox.ts`): base tree, the server's lay-in, the journal replayed,
  and `absent` when the box cannot boot. That is exactly the world decisions 2 and 5 describe: one
  call, no new materialization path.
- **The client's door** is `answerClientMail` (`src/core/missions/clientMail.ts`), reached from
  `handleResolveMail` (`src/core/emailit/handleResolveMail.ts`), wired in `api/network.ts`. It
  gains one dep, the records box read, built in `api/network.ts` from the `findPatches` and
  `findMissionFiles` the web doors already use there.
- **Terms** (`src/core/missions/missionTerms.ts`): `kind`, `targetCompany`, `pay` and the pitch
  are drawn on `mission-terms-<n>`. A tamper contract takes its line, its target name (stem + the
  setting's institution word, in place of a trade) and its pitches from the setting, and its pay
  from the tamper ranges.
- **What re-rolls on ship:** about half of all numbers turn tamper, so every pinned wire-check
  number and test factory that lands tamper is re-picked to a key number, as the two-hop epic
  re-picked numbers that turned two-hop.

## Given by the plan, not the grill

- **The records box keeps `<stem>-files`.** A new suffix would move every records box's machine id
  for no visible gain; a scan after accepting tells nothing the briefing has not.
- **The pass replies:** "The records look right. §1,850 sent to jsc…. Pleasure doing business."
  and, with no wallet, "The records look right. You sent no wallet, so there is nothing to pay. No
  wallet, no money." The failure reply is the grill's.
- **"Already closed" for a tamper job** answers a mail from the contractor when they have no
  accepted job with that client and a completed tamper job with it, as a completed job's key does
  today. When a contractor holds an accepted job with the client, that job answers, as today.
- **Generated people** come from one name pool shared by all settings; the generator draws
  without replacement within a table, so names are unique there (name and subject for School).

---

## Slices

Four slices, one PR each, merged in order. The browser run waits for the close-out after slice 4.
Every slice loads `tdd`, `testing` and `refactoring` before code, and `mutation-testing` at its PR
gate.

### Slice 1 — a school hires a contractor to change a grade, and pays when it reads right (v0.454.0)

**Value:** a contractor takes an `alter a school record` job off the board, cracks the records
box's database login, `UPDATE`s one grade, mails the client anything, and is paid once; a careless
`UPDATE`, an untouched grade or a bricked box gets "Our records don't look right."
**Class:** behavior change. **Branch:** `feat/tamper-change-database`.

This is the walking skeleton: one setting (School), one action (change), one storage (database).
Everything the grill decided about the proof lands here; later slices only widen the content.

**Acceptance criteria**

- About half the numbers are tamper, drawn on `mission-kind-<n>`. For every key number the shape
  and terms are exactly what they were (a sample of 2,000 deep-equals a fixture captured from
  `main`, captured and deleted inside the PR).
- A tamper number's records box runs the database as database key storage does (mysqld on a safe
  release, a crackable application account, a shut database root, a `:3306` forward on single-hop
  and the inside door on two-hop) and holds no key: no key file, no `api_keys`.
- Its datadir holds a `grades` table (`id`, `student`, `subject`, `grade`) of 20–40 rows drawn from
  the number, with exactly one row matching the target student and subject, holding the old
  grade. On the mysql route the same datadir also holds `settings`.
- The board line reads `<Client> — alter a school record — §<pay>`, and `alter an internal school
  record` on two-hop. Pay is 1,000–2,500 single-hop and 2,500–5,000 two-hop, rounded to 50. The
  target is `<Stem> Academy`.
- The briefing names the student, the subject, the old and new grade, and the address; never the
  row id, the table, the box or the path. It carries the two-hop "inside" sentence where it does
  today.
- Any mail from the contractor on an accepted tamper job reads the records box:
  - the target's grade is exactly the new one (unquoted, trimmed, case-sensitive) and every other
    row equals the generated row → completed, paid once, "The records look right." reply;
  - anything else (unchanged, a third value, another row touched or gone, the table or datadir
    gone, the box bricked) → "Our records don't look right. No change, no money.", the job still
    accepted.
- A later mail on the completed job → "That job is already closed.", without reading the box.
- A box read that fails (journal or lay-in error) answers nothing, as a store failure does today
  (`null`, 500 at the handler), never a guessed reply.
- `hireme.ts show` prints the kind, the setting, the action, the target (student, subject, old →
  new) and the storage.
- Key jobs complete, refuse and close exactly as before.

**TDD order (RED first, each at its public surface)**

1. `missionShape`: the kind share over a sample; key numbers unchanged.
2. The records generator: rows from the number, one target row, unique student and subject, the
   old grade on it.
3. `missionFiles` on a tamper records box: the datadir holds `grades` (and `settings` on the
   mysql route), no key files. `missionFilePaths` likewise.
4. The check, pure over a tree: pass, and each failure kind from the criteria.
5. `missionTerms`: the school line, the internal line, the pay ranges, the target name.
6. The briefing for a tamper job.
7. `answerClientMail` with a records-box dep: pass pays once, failure replies, closed, a failed
   read answers null; key jobs unchanged.
8. `handleResolveMail` passes the box read through; `showReport` for a tamper number.
9. Factories and pinned wire-check numbers moved to key numbers where they landed tamper.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling for the pools).
- Wire-check `scripts/testMissionTamper.ts` (new), staging numbers with `hireme.ts accept
  --number`: mail before any change → failure reply; `hydra <address> mysql`, then an `UPDATE`
  with no `WHERE` → failure reply; a fresh contract, the right `UPDATE … WHERE` → paid once, a
  second mail → closed; a contract whose records box is rooted, `rm /boot/vmlinuz` and rebooted →
  failure reply. One two-hop tamper contract worked from the front box. The ten existing mission
  wire-checks re-run green.
- Mutation gate on the changed lines of `missionShape.ts`, `missionTerms.ts`, `missionLeak.ts`,
  `clientMail.ts`, the records generator and the check.
- `docs/missions-architecture.md`: the "one idea" section amended (key jobs compare a key, tamper
  jobs read the box), and a "Tamper jobs" section for what this slice built.
- v0.454.0 in `package.json` and `package-lock.json`.

**Carried risk:** the check must see what a player's `UPDATE` wrote, through the same lay-in and
journal every door reads. As-built says an application account's `DELETE` from `api_keys` sticks,
so this should hold, but measure it first: before RED, stage one database key contract, `UPDATE`
a row as the application account, and read the box with `generatedLanBox` from a throwaway script.
If the write does not show, the fix lands in this slice when small, or becomes its own slice
ahead of it with the owner's approval.

### Slice 2 — a job can ask for a record to be erased (v0.455.0)

**Value:** a contractor takes an `erase a school record` job, deletes one failing grade with
`DELETE … WHERE`, and is paid; deleting more, or nothing, fails.
**Class:** behavior change. **Branch:** `feat/tamper-erase`.

**Acceptance criteria**

- A tamper contract draws change or erase on a stream of its own, about half each where the
  setting supports both. Slice 1's change contracts that stay change keep their target, rows and
  pay.
- An erase target is one row the briefing names by who and what ("There is a failing Chemistry
  grade for Mara Quill. It should not exist."), unique in the table.
- The check passes when the target row is gone and every other row equals its generated row;
  otherwise the one failure reply.
- The board reads `erase a school record` (`erase an internal school record` on two-hop).
- `show` prints the action and the target row.

**Gates:** the usual; `testMissionTamper.ts` gains an erase contract: `DELETE` with no `WHERE` →
failure; the right `DELETE … WHERE` → paid once. Mutation on the changed lines. v0.455.0.

### Slice 3 — half the tamper jobs keep their records in a CSV file (v0.456.0)

**Value:** a contractor on a file job finds no records database on the box, roots it by the
route, edits one line of a root-only CSV in `nano`, and is paid; a broken line fails.
**Class:** behavior change. **Branch:** `feat/tamper-csv`.

**Acceptance criteria**

- A tamper contract draws database or file on a stream of its own, about half each. A file
  contract's records box runs no mysqld for the records and has no `:3306` forward for them
  (the mysql route keeps its own door).
- The records sit in `/srv/<stem>/records/grades.csv`, a header row then one line per row,
  root-only, from the same generated rows a database contract would hold.
- The check parses the CSV into rows by its header: quotes, surrounding spaces and line endings do
  not count; a missing or unparseable file, or a header that no longer names the columns, fails.
  Otherwise the same pass and fail rules as the table.
- The briefing and the board do not say which storage; the pay ranges are the same.
- `show` prints the storage and the file's path.

**Gates:** the usual; `testMissionTamper.ts` gains a file contract worked by the route's root:
`nano` the right line → paid; a contract with another line deleted → failure. Mutation on the
changed lines, the CSV reader first. v0.456.0.

**Carried risk:** `nano` is the only editor, and a save writes the whole file. Confirm before RED
that a root's `nano` save on a mission box lands as one journal row the check reads back, as any
root write there does today.

### Slice 4 — eight settings, each with neighbours (v0.457.0)

**Value:** the board offers police, payroll, motor registry, tournament, admissions, members club
and vehicle registry jobs beside the school's, and each records box holds the target's
neighbours to look past.
**Class:** behavior change. **Branch:** `feat/tamper-settings`.

**Acceptance criteria**

- A tamper contract draws one of the eight settings in the grill's table, each with its target
  name, board noun, table and columns, change column and values, erase row (none for Payroll),
  and 3–5 pitches. Payroll draws change only.
- Each setting lays 2–3 tables (or CSVs in the one directory) with the target among them;
  neighbours share no person with the target table, and the check reads only the target.
- Every setting meets every storage, action (where allowed), route and two-hop placement; a
  2,000-number test proves each target is unique, its old value present, and its new value
  different from its old.
- Club ages are numbers in the database and digits in the CSV; the check compares them as text.

**Gates:** the usual; `testMissionTamper.ts` runs one contract per setting through its check
(changed by the script as root in the datadir or CSV, not by hand play). Mutation on the changed
lines. v0.457.0.

### Close-out

One browser run on a fresh player: a database change job and a file erase job worked from the
board to the payout, with one deliberate failure (an `UPDATE` with no `WHERE`) answered by the
failure reply. Then `docs/missions-architecture.md` finished, `docs/project-status.md` given its
entry, the deferred list ("Later, set aside in the grill" above) moved to `docs/backlog.md` under
"missions — deferred", the plan retired, and the story offered for valleynews.io `/dev`.
