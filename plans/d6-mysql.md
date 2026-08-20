# Plan: D6 — a player reads a machine's database (`mysql`)

**Branch**: one `feat/d6-*` per slice — slice 2 is `feat/d6-mysql-crack`
**Status**: Active — slice 1 LANDED (v0.158.0, #434, `29bc042`) and its mutation debt PAID
(#435 `f1c4dd6`, #436 `8add9fa`); slice 2 STARTED on `feat/d6-mysql-crack`, hydra work not
yet begun

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

**Debt this slice left — PAID across #435 and #436, before any hydra work.** The pool score was the
D5b failure repeated at ten times the scale: an entry no test ever DRAWS can be blanked without
anything failing. Fixed with D5b's own remedy — one population computed **once per block**, and
sweeps that read every pool entry across it.

`pools/database.ts` **57.84% → 88.69%**, with 0 timeouts. The 44 that remain are 42 column-METADATA
mutants (slice 3's, below) and 2 equivalent float comparisons.

**Read the score before this one with suspicion.** `timeoutMS` was 30000 and Stryker scores a
timeout as a KILL, so both the 57.84% and the 100% first reported for the fix were inflated by
masked survivors — every one of the 78 timeouts turned out to be a survivor once the budget was
raised to 120000. Any mutation number in this repo measured before that config change is subject to
the same error, D5b's close-out figures included.

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

**Slice 1's mutation debt ✔ PAID AHEAD OF THIS SLICE**, as #435 (`f1c4dd6`) and #436 (`8add9fa`),
while the pool was still the thing being READ rather than the thing hydra reads THROUGH. Evidenced
by the surviving-mutant count falling rather than by RED — for test-strengthening against unchanged
production code, the mutants ARE the failing evidence. The hydra work below therefore starts from a
clean branch and owes a real RED.

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

A second pass (#436) closed what the first missed once the timeout config stopped hiding it: string
SHAPE (a timestamp that lost its padding, a token that is not hex, an address with no domain — all
present, all wrong, none blank), the database name's two halves, admin-first in `users`, session and
key rows pointing at users that exist, the slice that leaves some people without either, and
salaries that are livable. Each was proven against a hand-applied mutant, not assumed.

The name-shape sweep carries a lesson worth keeping: comparing drawn names against the imported
pool can **never** catch a blanked entry, because the test reads the same array the generator does
and both sides move together. Shape is what closes it, without freezing content into a golden.

**Left deliberately unkilled**: `catch {}` in `parseMysqlDatabase`, and `prng.next() > 0.1` → `>=`
in two places — equivalent mutants, all three (an empty catch returns `undefined` exactly as the
explicit return does; exact float equality does not occur). **Deferred to slice 3**: 42
column-METADATA mutants (`nullable` flips, `key`, `defaultValue`) have no observable consequence
until `DESCRIBE` renders them; asserting them now would be asserting implementation shape. **Slice 3
must assert `DESCRIBE` over the population, not one table on one box**, or all 42 persist behind a
number that looks finished.

**GROUNDING FOUND WHILE WRITING THESE CRITERIA — this slice fixes a SHIPPED BUG, it does not add
a missing feature.** Slice 1 added the `mysql` catalog row, which made `serviceByName('mysql')`
resolve and `readOpenPorts` report the port. `hydra <host> mysql` is therefore reachable TODAY, and
all three vantage handlers reach `sweepAccounts({ accounts: accountsIn(fs) })` unconditionally
— `hydraCrack.ts:238`, `hydraCrackInnerGateway.ts:148`, `hydraCrackPublic.ts:169`. A sweep of the
database door currently attacks the box's **`/etc/passwd`**, reports its unix accounts as database
logins, and writes them into `/var/log/mysql.log` in mysql's own format. The RED for this slice is
a real failing assertion against live behavior, not a new-feature stub.

The seam is already the right shape: `sweepAccounts` takes `NamedPasswdAccount[]` (`username`,
`hash`, `userType`) and a `formatAttempt`, and `MysqlCredential` is `username`, `passwordHash`,
`userType` over the SAME `UserType = 'guest' | 'user' | 'root'`. The adapter is lossless and the
sweep, the wordlist gate and the trace need no change. What is missing is only **which accounts a
service exposes**, and that answer belongs beside `sweepLog` in the catalog row — the one place
already trusted to say how a door is logged.

**LADDER CORRECTION.** The prose above ("`readonly` falls on nearly every box") is not what the
generator draws, and a test written to it would fail. `generateDatabase` gives every database a
`root` (`CRACK_CHANCE.npcRoot` 0.12) and an app account (`npcUser` 0.7), and a `readonly` only
`prng.next() < 0.5` of the time (`guest` 1). `DEFAULT_WORDLIST` is a superset of
`CRACKABLE_PASSWORDS`, so with the shipped list the per-box crack rates are **app 0.70 > readonly
0.50 > root 0.12** — the app account falls more often than `readonly` does, because half of
databases have no `readonly` at all. The ladder holds per-ACCOUNT (a `readonly` that exists always
falls), not per-box. Criterion 3 states it the way the world actually draws it.

**Acceptance criteria** (present to human before any code):

1. On a box running mysqld, `hydra <host> mysql` attacks **exactly the datadir's `credentials`** —
   `root`, the app account, and `readonly` when present. **No unix account of the box appears in
   the result**, even when that account's password is in the wordlist. `hydra <host>` and
   `hydra <host> ssh` still sweep `/etc/passwd`, unchanged.
2. A credential this returns is a DATABASE credential: `md5(password)` equals the matching entry's
   `passwordHash` in `/var/lib/mysql/data.json`. Cracking the box's ssh yields nothing toward its
   database and the reverse — the two are drawn on independent streams.
3. Over a population computed **once per block** (the D5b shape, never two sampled hosts): about
   half of databases carry a `readonly`; **every `readonly` that exists falls** to the default
   wordlist; app accounts fall near 0.70 and `root` near 0.12 of databases. `root` is the rarest of
   the three.
4. A host with no mysqld answers **`service_not_running`** and writes nothing — including a host
   whose `/etc/passwd` accounts would have cracked, which is what proves the refusal is about the
   database door rather than the box.
5. A host running mysqld whose datadir is **missing or unparseable** exposes **no accounts**: 200,
   `cracked: []`, and **nothing appended to `mysql.log`**. Same silence as a named account that does
   not exist — a rooted player who edits the file learns nothing about how their tampering failed.
6. Every password TRIED appends exactly one line to the target's `/var/log/mysql.log`, in mysql's
   own format — `Access denied for user '<u>'@'<ip>' (using password: YES)` per failure, the
   `Connect` line for the one that opened — appended, never replacing what was there. **Nothing is
   written when nothing was attempted**: refused, dead, serviceless, empty wordlist, unknown named
   account, or criterion 5's empty datadir.
7. The wordlist is still read from the **caller's machine journal**, machine-scoped, never from the
   request — unchanged, and must not regress.
8. **Every existing hydra behavior holds**: the ssh, ftp and http doors sweep exactly as before, and
   the existing own-LAN, inner-gateway and public tests and wire-checks stay green.
9. **The lie is not left standing behind a gateway or a public IP.** The account source is chosen in
   ONE shared place read by all three vantage handlers, so `hydra -p <fwd> <inner> mysql` and
   `hydra <public-ip> mysql` stop reporting unix accounts the moment own-LAN does. Slices 5 and 7
   then PROVE those vantages rather than implement them. — **DECIDED: yes, fix all three.**

**PROGRESS — criteria 1 and 5 DONE, uncommitted.**

RED was real: `hydra <host> mysql` against `laptop-74@192.168.29.74` on `BEAN-THERE-WIFI` returned
the box's `/etc/passwd` (`root/dovetail_7`, `tnguyen/welcome1`, `guest/changeme`) where the datadir
holds `root/undertow_11` and `api_svc/quartzite8`. That host runs ssh, ftp AND mysql and carries a
`root` in BOTH files under DIFFERENT passwords — one fixture covers the claim, the counter-claim
and the ssh control, with no invention.

GREEN is an `accountsOn` column on the catalog row, beside `sweepLog` and for the same reason: a
door's own behaviour belongs on its row, not guessed by three handlers. `ssh`/`http`/`ftp` point at
`accountsIn`; `mysql` points at `databaseAccountsIn` in the new `core/mysql/datadir.ts`. All three
vantage handlers now read `spec.accountsOn(fs)`, so criterion 9 landed with criterion 1 rather than
waiting for slices 5 and 7.

`sweepAccounts` stopped borrowing `NamedPasswdAccount` and now declares `SweepableAccount`
(`username` + `hash`) — the two fields it actually reads. A passwd row carries a tier the sweep
never looks at, and a database credential is not a passwd row at all; naming only the two lets both
doors satisfy the sweep without either pretending to be the other.

**Mutation**: `hydraCrack.ts` **100%** (116 killed), `mysql/datadir.ts` **70.45%** (31 killed),
**0 timeouts, 0 no-coverage** in both. All 13 survivors sit on the four fixed-path guard lines of
the directory walk: twelve need a box where `/var`, `/var/lib` or `/var/lib/mysql` is a FILE or
absent, and the thirteenth (`datadir.kind !== 'file'` → `false`) is provably equivalent — a
directory there yields `undefined` content, which `parseMysqlDatabase` already answers `null` for.
Type-narrowing defensive checks, the class §4 of `conventions-and-gotchas.md` says to accept.

Criteria 5's two tests passed on FIRST run, so they were never RED. Rather than assume they were
therefore worth having, the fallback mutant they exist to kill was applied by hand —
`if (database === null) return accountsIn(fs)`, the plausible wrong implementation that would
reintroduce the bug in subtler form. Exactly those two failed and nothing else.

**Still open on this slice**: criteria 2, 3, 4, 6, 7, 8 and the `scripts/testMysqlSweep.ts`
wire-check.

**RED**: Handler-level behavior tests — the account-source assertion (criterion 1) fails against
today's code, which is the honest RED. Plus a population sweep for criterion 3, edge tests for 4-6,
and `scripts/testMysqlSweep.ts` as the live oracle: an `api/` change is unproven until it runs
against `vercel dev` + supabase.
**GREEN**: An `accountsFor`-shaped answer on the catalog row (mysql reads the datadir through
`parseMysqlDatabase` and maps `passwordHash` → `hash`; every other row keeps `accountsIn`), read by
all three handlers at their existing `sweepAccounts` call.
**MUTATE**: Stryker over the handler and the new account source — with `timeoutMS` now 120000, and
the `timeout` column read before the score is believed.
**Done when**: criteria 1-9 met, wire-check green, commit approved.

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
