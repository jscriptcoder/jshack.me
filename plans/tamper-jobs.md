# Plan: a contract that asks for a record to be changed

**Status:** Grilled 2026-11-11. Slice plan to follow. Nothing is built.

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
