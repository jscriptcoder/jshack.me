# Plan: D6 — a player reads a machine's database (`mysql`)

**Branch**: one `feat/d6-*` per slice — slice 2 is `feat/d6-mysql-crack`
**Status**: Active — slice 1 LANDED (v0.158.0, #434, `29bc042`); slice 2 next, not started

> Decisions are LOCKED in [`legacy-parity-epic.md`](legacy-parity-epic.md) §"D6 — resolved scope &
> decisions (grill-me, 2026-08-19)". This file sequences them; it does not re-open them. Where
> grounding during planning changed how a decision lands, it is called out as **PLANNING
> CORRECTION** with the reason.

## Goal

A generated `db-11` stops being a name with a config file behind it and becomes a box holding a
database a player can find, crack, read, change, and be caught changing.

## Acceptance Criteria (the row's, across all slices)

- [x] `nmap` a LAN and a database box reports `3306/tcp open mysql`; `nc <host> 3306` answers with
      the daemon's own bad-handshake line — slice 1
- [x] A box running `mysqld` holds a real generated database at `/var/lib/mysql/data.json`; a box
      that is not running one holds no `/var/lib/mysql` at all — slice 1
- [ ] `hydra <host> mysql` returns database accounts — `readonly` almost always, the app account
      often, database root rarely — and leaves a wall of denials in `/var/log/mysql.log`
- [ ] `mysql <host>` + a cracked credential reaches a `mysql>` prompt where `SHOW TABLES`,
      `DESCRIBE` and `SELECT` return the box's own data in legacy's ASCII tables
- [ ] The tier ladder is observable: `readonly` is refused an `UPDATE`, the app account performs
      one, only database root may `DROP TABLE`
- [ ] Every mutation appends to `/var/log/mysql.log`; no `SELECT` ever does
- [ ] A mysql connection reads no file on the target other than the datadir, at any tier
- [ ] `systemctl stop mysqld` / `kill <pid>` drops a connected player on their next statement

## Slices

**Slice 1 is the only slice that can be proven without bringing the stack up.** Slices 2–5 and 7
touch `api/` and each needs a `scripts/test*.ts` wire-check against `vercel dev` + supabase before
it counts — `tsc` cannot see DB columns or constraints.

---

### Slice 1: A box runs a database ✔ LANDED (v0.158.0, #434, `29bc042`)

**As built** — all nine acceptance criteria met. The catalog row, the four `PLACEMENT_BY_ROLE`
cells (`database { mysql: 0.9, ftp: 0.4 }`, `webserver { mysql: 0.2 }`, `workstation { mysql: 0.03 }`,
`iot { mysql: 0 }`), `core/mysql/types.ts` (Zod, closing legacy's `as MysqlDatabase` cast),
`core/generation/generateDatabase.ts` on its own `mysql-db-${essid}-${host.ip}` stream,
`core/generation/pools/database.ts` (eight templates, mission half not ported), `core/logging/mysqlLog.ts`,
and the conditional datadir + empty `mysql.log` in `buildRemoteHostFs`. One config-pool lie fixed on
the way: a `mysql.cnf` template shipped `datadir=/srv/mysql`, which no box has ever held.

**Mutation results** (Stryker, 56 min): `serviceCatalog.ts` 100%, `rolePlacement.ts` 100%,
`generateDatabase.ts` 100%, `remoteHostFs.ts` 95.24% (1 survivor), `mysql/types.ts` 83.33%
(3 survivors + 1 no-coverage), **`pools/database.ts` 57.84% (164 survivors, and 150 of its 225
"kills" are timeouts, which Stryker scores as kills)**.

**Debt this slice left — PAID on `feat/d6-mysql-crack` before any hydra work.** The pool score was
the D5b failure repeated at ten times the scale: an entry no test ever DRAWS can be blanked without
anything failing. Fixed with D5b's own remedy — one population computed **once per block**, and
sweeps that read every pool entry across it. `pools/database.ts` 57.84% → **100%, 0 survivors**;
`generateDatabase.ts` and `remoteHostFs.ts` also 100%/0. See slice 2 for what the sweeps assert and
for the two findings that turned out to be production changes rather than test gaps.

**Value**: A player scanning or standing on a LAN can tell that a box holds a database, and find
it where the box's own config has been saying it would since v0.155.0.
**Path**: `nmap <subnet>` / `nc <host> 3306` / `ssh` + `ls /var/lib/mysql` + `cat` → the generated
per-host filesystem (`buildRemoteHostFs`) → `/var/run/mysqld.pid` + `/var/lib/mysql/data.json` →
read back by the existing pidfile and filesystem readers, which need no changes.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A` (net-additive slice, no mechanism retired).
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present to human before any code):

1. A `SERVICE_CATALOG.mysql` row exists — `service: 'mysql'`, `pidfile: 'mysqld.pid'`,
   `defaultPort: 3306`, `runUser: 'mysql'`, `banner: 'ERROR 1043 (08S01): Bad handshake'`,
   `placement: 0.08` — and `nmap` reports `3306/tcp open mysql` on a host that draws it, with no
   change to `nmap`, `ps`, `readOpenPorts` or `systemctl`.
2. Across a population sweep: `database`-named hosts run mysqld far more often than `webserver`
   ones, which run it more often than the flat rate, **`iot` hosts never do**, and `workstation`
   hosts almost never do.
3. A host running mysqld holds `/var/lib/mysql/data.json` containing a database with a name, a
   `users` table, 2–4 further tables, and three-or-two credential entries with md5 hashes.
4. A host **not** running mysqld holds **no `/var/lib/mysql` directory at all** — the same rule
   `/var/www` follows.
5. The datadir file is **root-read-only** (`read: ['root']`), and is **not** on the
   externally-observable allowlist, so no no-session reader can see it.
6. The database's `users` table contains the host's **real** NPC account among plausible
   colleagues; its `config.site_name` is the host's own hostname, matching what its served page
   says about it.
7. `/var/log/mysql.log` exists empty on a host running mysqld and is absent otherwise — the rule
   `access.log` and `vsftpd.log` already follow.
8. **Every existing generation golden holds**: no NPC octet, port, account name, password or
   machine_id moves anywhere in the world.
9. `nc <host> 3306` prints the bad-handshake banner.

**PLANNING CORRECTIONS to record with these criteria:**

- **`config.site_name` is the hostname.** Locked decision 11 said it derives from the page the box
  serves. Grounding `pools/webPages.ts` shows **every page is titled `{{hostname}}`** — there is no
  company identity anywhere in v2's world for legacy's `AcmeCorp`/`TechVault` to map onto. The
  hostname delivers the same intent ("the database is about its box"), agrees with the served page
  by construction, works on a box that serves nothing, and couples no two generators. Legacy's
  `site_name` value pool is dropped rather than ported.
- **Routers and switches need no suppression cell.** `lanHostIdentity` routes them away from
  `buildRemoteHostFs` before any catalog iteration, and `routerFs` rolls **only** ssh explicitly
  (`placementOf('router', SERVICE_CATALOG.ssh)`). Adding a catalog row therefore cannot put a
  database on a gateway. Worth a comment so a later reader does not "fix" the missing cells.
- **`hostServices` iterates `Object.values(SERVICE_CATALOG)`**, so the row alone makes every
  machine roll for mysql. The placement cells are not decoration — without them criterion 2 fails
  on the day the row lands.

**RED**: Behavior tests, before any production change:
- `remoteHostFs.test.ts` — a host seeded to run mysqld holds a parseable database at the datadir
  whose `users` table names the host's own account; a host that does not run it holds no
  `/var/lib/mysql`; the datadir file refuses a `guest` and a `user` read.
- A population sweep (the shape D5b slice 2 established — sweep a population, never sample two
  hosts) asserting the ordering in criterion 2, with `iot` at exactly zero.
- `serviceCatalog`/`nmap` level: a host with the mysqld pidfile reports `3306/tcp open mysql`.
- A generator-stability test proving criterion 8 — the existing goldens are the oracle.

**GREEN**: The catalog row; four cells in `PLACEMENT_BY_ROLE` (`database { mysql: 0.9 }`,
`webserver { mysql: 0.2 }`, `iot { mysql: 0 }`, `workstation { mysql: 0.03 }`) plus `database`'s
`ftp: 0.6 → 0.4`; `generateDatabase` + the seven table templates ported into
`core/generation/pools/database.ts` **without** the mission half (`enrichForDbExfiltrate`,
`tamperScenarios`, `fixScenarios`, `sabotageTargetTables`) and without `smtp_host`; the
`MysqlDatabase` types ported; the conditional datadir and empty `mysql.log` in `buildRemoteHostFs`,
mirroring the `webRoot`/`access.log` conditionals exactly.

**The invariant this slice most directly threatens** — it adds draws to generation, so the database
draw takes **its own seed stream** (`mysql-db-${essid}-${host.ip}`), exactly as the web page, the
`/etc` config and the backdoor each do. Appending to the host-fs stream would move the octets the
lease allocator excludes and put an occupant on top of an NPC. Criterion 8 is what catches it.

**MUTATE**: Run Stryker over the new generation code. Expect the D5b lesson to bite: an entry no
test ever DRAWS can be blanked without anything failing, so the population sweep must be computed
**once per block**, not per assertion, or timeouts convert survivors into false kills.
**KILL MUTANTS**: Address survivors; ask when a survivor's value is ambiguous.
**REFACTOR**: Assess whether the four conditional stanzas in `buildRemoteHostFs` (web root, access
log, vsftpd log, datadir + mysql log) want collapsing — **only if** it adds value; four literal
stanzas may well be clearer than a table.
**Done when**: criteria 1–9 met, mutation report presented, human approves the commit.

---

### Slice 2: A player cracks a database account

**Value**: A player obtains a credential for a database they have found. Without this the door
ships unopenable, which is why it precedes the prompt.
**Path**: `hydra <host> mysql` → the sweep handler → the target's datadir `credentials` array →
attempt lines appended to the target's `/var/log/mysql.log`.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**First commit on this branch ✔ DONE, before any hydra work.** Slice 1's mutation debt, paid while
the pool was still the thing being read. Evidenced by the surviving-mutant count falling rather
than by RED — for test-strengthening against unchanged production code, the mutants ARE the failing
evidence.

What the sweeps assert, over one population of 5 prefixes x 253 addresses built once: every datadir
parses; every row carries exactly the columns its table declares; no blank value anywhere in the
world; every content pool drawn to its declared width; database and app-account names drawn from
their full pools; row ids ascending from each table's own first number; per-table row-count bands;
prices ending in `.99`; SKUs unique within an inventory; the credential ladder's shape and rate.

Two findings were production changes, not test gaps:

- **`'DATE'` was dead** in `mysqlColumnTypeSchema` — no template emits it, against the module's own
  rule that a type no template emits is a formatter branch no player can reach. Removed.
- **`parseMysqlDatabase` had no negative tests at all**, so `mysqlColumnSchema` could be gutted to
  `z.object({})` with nothing failing — on the one function whose entire job is guarding a file a
  rooted player can edit. It now has its own eight behaviour tests.

**Left deliberately unkilled**: `catch {}` in `parseMysqlDatabase` is equivalent (an empty catch
returns `undefined` exactly as the explicit return does) — now covered rather than uncovered, which
is the part that mattered. **Deferred to slice 3**: column-METADATA mutants (`nullable` flips,
`key`, `defaultValue`) have no observable consequence until `DESCRIBE` renders them; asserting them
now would be asserting implementation shape. Slice 3 must assert `DESCRIBE` over the population,
not one table on one box, or they persist.

**Acceptance criteria**: `hydra <host> mysql` sweeps the **database's own accounts**, not
`/etc/passwd`; `readonly` falls on nearly every box, the app account often, database root rarely;
a host with no mysqld answers `service_not_running`; every attempt appends one line to the
target's `mysql.log` and nothing is written when nothing was attempted; the wordlist is still read
from the caller's machine journal, never the request.
**RED**: Handler-level behavior tests plus a `scripts/testMysqlSweep.ts` **wire-check** — an `api/`
change is unproven until it runs live.
**MUTATE**: Stryker over the handler. **Done when**: criteria met, wire-check green, commit
approved.

---

### Slice 3: A player reads a database

**Value**: The epic row's stated acceptance — a player reads generated data worth reading.
**Path**: `mysql <host>` → masked credential prompt → per-statement server action → validate
against the datadir `credentials` → parse → execute → format → result set only.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `mysql <host>` on a box with no mysqld refuses **before** prompting;
a good credential reaches `mysql>`; `SHOW TABLES` / `DESCRIBE` / `SELECT` (with `WHERE … AND …`)
return legacy's ASCII tables and `N rows in set`; a bad credential is refused with one
indistinguishable error; the prompt is **parallel** — cwd, tier and hop chain are untouched and
`quit` returns to the same shell; **every line typed at `mysql>` is SQL** and no outer command
leaks through; semicolons optional; the connect line lands in `mysql.log` with user, source IP and
database name; **no file other than the datadir is read from the target at any tier**; and killing
the daemon drops the player on their next statement.
**RED**: Command + prompt-mode tests (jsdom + `@solidjs/testing-library`), handler tests, and
`scripts/testMysqlQuery.ts` proving the round trip and the zero-filesystem-read claim live.
**Done when**: criteria met, wire-check green, commit approved.

---

### Slice 4: A player changes a database

**Value**: The three credential tiers become observable, and a database becomes a thing that can be
attacked rather than only read.
**Path**: `UPDATE`/`DELETE`/`DROP TABLE` at `mysql>` → the same per-statement action → tier check →
scoped datadir write → mutation line in `mysql.log`.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `readonly` is refused `UPDATE`/`DELETE`/`DROP`; the app account may
`UPDATE`/`DELETE` but not `DROP`; database root may do all three; a mutation **persists** and is
seen by a second occupant; each mutation appends one line to `mysql.log` and no `SELECT` ever
does; **the write reaches `/var/lib/mysql/data.json` and no other path** — proven by a test that
attempts to make it write elsewhere.
**RED**: Tier-ladder behavior tests, a two-occupant persistence test, and
`scripts/testMysqlMutate.ts` for the live write path.
**Open for this slice**: whether the log line carries the statement verbatim (a fine artefact for a
defender; also arbitrary player text in a file others `cat`) or a summary.
**Done when**: criteria met, wire-check green, commit approved.

---

### Slice 5: A database on a deep layer answers

**Value**: The vantage where the interesting boxes actually live.
**Path**: inner-gateway resolution → both the statement action and the hydra sweep.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `mysql` and `hydra <host> mysql` work against a deep-layer `db-*` through
a forward, with the same refusals as own-LAN; the trace lands on the box that ran the statement.
**RED**: Handler tests + a wire-check extending the existing inner-gateway script coverage.
**Done when**: criteria met, wire-check green, commit approved.

---

### Deferred half — after slice 5, and NOT one slice

### Slice 6: A player runs their own database

**Value**: The door becomes symmetric — a player can own the thing others attack.
**Path**: `mysqld` daemon command → own workstation `/var/run` + a boot-time datadir.
**Class**: Behavior change. **Acceptance criteria**: `mysqld` opens `:3306` on the player's own box
with a real database behind it, on the precedent `/var/www/html/index.html` states; `systemctl
stop/start/status mysqld` behaves as the other three daemons do; the player can read their own
database's credentials as root on their own box.

### Slice 7: A player reaches another player's database

**Value**: Cross-player, the point of the epic.
**Path**: public-IP and same-LAN vantages, for the statement action **and** hydra, together.
**Class**: Behavior change. **Acceptance criteria**: B cracks and reads A's database across the
world and through a shared LAN; A finds B's connect line and mutations in their own `mysql.log`;
all four vantages now answer identically.
**Note**: this slice carries two handler fan-outs and their wire-checks. If it exceeds one PR,
split by vantage — never by "endpoint first, hydra later", which would leave a door nobody can open.

## Pre-PR Quality Gate

1. Mutation testing (Stryker) — full report, or an explicit `N/A` with proportionate alternate
   evidence for the `api/`-shaped slices where a wire-check is the real oracle
2. Refactoring assessment (`refactoring`); `reduce-system-complexity` `N/A` — D6 is net-additive
3. `npm run typecheck` (`tsc -b`, covers `api/` + `scripts/`) and `npm run lint`, from `v2/`
4. Version bumped in **both** `v2/package.json` and `v2/package-lock.json`
   (`npm install --package-lock-only`)
5. For any slice touching `api/`: the `scripts/test*.ts` wire-check run **live** against
   `vercel dev` + supabase, and re-run at close-out if it raced a PR that changed the behavior it
   asserts (D5's sweep read 44/45 for two doors because check 8 asserted an exemption removed the
   same day)

---
*Delete this file when D6 is complete; graduate the durable part into
`v2/docs/conventions-and-gotchas.md` and the close-out into `plans/legacy-parity-epic.md`.*
