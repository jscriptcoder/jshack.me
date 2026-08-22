# Plan: D6 — a player reads a machine's database (`mysql`)

**Branch**: one `feat/d6-*` per slice, except slice 3, which outgrew one and landed as three —
`feat/d6-mysql-prompt` (the door), `feat/d6-mysql-verbs` (the statements), then
`feat/d6-mysql-credentials` (the account list), each stacked on the one before. Slice 4 landed on
`feat/d6-mysql-writes`; slice 5 is on `feat/d6-mysql-deep`.
**Status**: Active — slices 1, 2, 3 and 4 LANDED (v0.158.0 #434 `29bc042`; v0.159.0 #437
`a6bdead`; v0.160.0-v0.162.0 #438 `04beaa4`, #439 `36e1ae0`, #440 `b058621`; v0.163.0 #441
`3222dbd`), slice 1's mutation debt PAID (#435 `f1c4dd6`, #436 `8add9fa`). **Slice 5 IS NEXT**, on
`feat/d6-mysql-deep` — the vantage where the interesting boxes live, and where criterion 1's `-p`
stops being inert.

Slice 3 was grilled to 21 criteria (`32ef71b`) and landed as three PRs in this order:

- `feat/d6-mysql-prompt` (#438, `04beaa4`, v0.160.0): criteria 3, 4, 5, 6, 7 and 20. The door opens
  and is REGISTERED — `mysql <host>` is typeable, greets, and leaves the player at `mysql>`.
- `feat/d6-mysql-verbs` (#439, `36e1ae0`, v0.161.0): criteria 8, 9, 10, 11 and 12, with 17, 18, 19
  and 21 falling out of the same wiring.
- `feat/d6-mysql-credentials` (#440, `b058621`, v0.162.0): criteria 13, 14, 15 and 16 — the account
  list as a table, and the first tier-conditional refusal in this door.

Those are the squashes. Each merge rebased what was left of the stack onto the one before it, so
the branch SHAs this file cited while they were open no longer resolve — the commits they named are
the same content under new hashes.

**Slice 3's BEHAVIOUR is complete** — every criterion a player can see is on `main`. What it still
owes is test debt: criterion 1's `-p` (inert until slice 5), 2 (untested) and the DESCRIBE
population debt. Details under slice 3's own heading.

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
- [x] `hydra <host> mysql` returns database accounts and leaves a wall of denials in
      `/var/log/mysql.log` — slice 2. **PLANNING CORRECTION, measured over 800 networks rather
      than assumed**: `readonly` sits on 48.8% of database boxes and falls every single time, the
      app account on 67.7%, database root on 12.0%. So the APP ACCOUNT is the commonest credential
      a sweep returns — not `readonly`, which this line had first — because half the databases
      carry no `readonly` at all. Root being rarest is the only part that survived contact
- [x] `mysql <host>` + a cracked credential reaches a `mysql>` prompt where `SHOW TABLES`,
      `DESCRIBE` and `SELECT` return the box's own data in legacy's ASCII tables — slice 3. The
      behaviour is delivered; what slice 3 still owes is test debt, not a gap a player can see
- [x] The tier ladder is observable: `readonly` is refused an `UPDATE`, the app account performs
      one, only database root may `DROP TABLE` — slice 4
- [x] Every mutation appends to `/var/log/mysql.log`; no `SELECT` ever does — slice 4. A refused
      write appends one too, under `Denied`: an attempted privilege violation is the most
      interesting thing this file can hold
- [x] A database on a deep layer answers, through a forward, with the same refusals as own-LAN
      — slice 5
- [x] A mysql connection reads no file on the target other than the datadir, at any tier — slice 5,
      which found it already TRUE and unproven: the parser admits six verbs and none of them names
      a path
- [x] `systemctl stop mysqld` / `kill <pid>` drops a connected player on their next statement —
      slice 5, likewise already true: the reach re-reads the pidfiles per statement and everything
      that is not a well-formed 200 collapses to `lost`

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

### Slice 2: A player cracks a database account ✔ LANDED (v0.159.0, #437, `a6bdead`)

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

**Criterion 6 DONE — and it settled a decision slice 1 had left contradicted.**

The routing was already right: slice 1's `sweepLog` column sends a mysql sweep to `mysql.log` in
mysql's own shape, so the eight tests for it passed on first run. Proven non-vacuous by pointing
the mysql row at `SYSLOG_AUTH_SWEEP` — six of the eight failed.

**A formatter-based assertion cannot catch its own formatter changing.** Swapping the success and
failure arms of `formatMysqlAttemptLine` — denials rendered as accepted connections and the reverse,
which would completely mislead a defender — killed exactly ONE test: the SHAPE regex. The seven that
compare a line to the function that wrote it all passed the mutant. Same blind spot as comparing a
drawn name against the pool it was drawn from; the fix is the same one — assert the shape.

**The contradiction**: `formatMysqlAttemptLine`'s own docstring said an acceptance "is the connect
line above with the database this attempt is being made against", and the module docstring called a
Connect naming a database "the defender's most useful signal". The implementation named no database
— `formatAttempt` only receives a `CredentialAttempt`, so slice 1 had nowhere to put it and the
success arm quietly dropped it. **DECIDED (owner, 2026-08-20): name it, fix the code.** A sweep that
opens an account and a client that opens one are the same event to the daemon writing the file, so
there is one accepted-connection shape, not two — `formatMysqlAttemptLine`'s success arm now IS
`formatMysqlConnectLine`.

Threaded as an optional `database` on `CredentialAttempt`, a `database` option on `sweepAccounts`,
and a `databaseOn` column beside `accountsOn` — optional exactly as `sweepLog.formatArrival` is,
because only the database door opens something narrower than the box. `exactOptionalPropertyTypes`
is ON, so the sweep option is `database: string | undefined` matching the `username` beside it,
not `database?: string`.

**`mysqlLog.ts` had NO test file** — the only log formatter without one, `accessLog`, `authLog`,
`kernLog`, `syslog` and `vsftpdLog` all having theirs. Slice 1's gap, closed here with eight tests
including the one that matters most: a refusal must not name the database EVEN WHEN one is supplied,
or a sweep that opened nothing learns as much as one that opened everything.

**Mutation**: `mysqlLog.ts` **96.55% total, 100% of covered** — 28 killed, **0 survivors**. Its one
unflagged mutant is the `database ?? ''` fallback, reported **NoCoverage**, which is proof the arm is
unreachable rather than merely untested: a door with no database has no accounts to accept, so a
success always arrives with one. `mysql/datadir.ts` 71.74%, 33 killed, 13 survivors — the same four
type-narrowing guard lines as before, unchanged.

**Criterion 3 DONE — the curve is read off the world, not off two boxes.**

Eight hundred generated networks, swept ONCE for the block, yield **492 database doors**
— every `machine` a scan reports 3306 on, and no router (a gateway advertising mysql has
no datadir behind it, which is why the population takes only machines). The accounts come
from `SERVICE_CATALOG.mysql.accountsOn` and are cracked by `sweepAccounts` against
`formatWordlist(DEFAULT_WORDLIST)` — the door's own account source and the handler's own
sweep, against the list a player starts holding. Only the signed envelope is out of frame;
that the handler returns exactly this sweep is asserted per-host by criterion 1, and
signing 800 networks' worth of requests would re-prove it 492 times for nothing.

What the world actually draws, measured rather than assumed:

| rung | of 492 databases | knob |
| --- | --- | --- |
| carries a `readonly` | 240 (48.8%) | `prng.next() < 0.5` |
| `readonly` falls | 240 of 240 (**100%**) | `guest` 1 |
| app account falls | 333 (67.7%) | `npcUser` 0.70 |
| `root` falls | 59 (**12.0%**) | `npcRoot` 0.12 |

The ladder correction above is now a test rather than a paragraph: `root` (59) < `readonly`
(240) < app (333). The app account is the credential a sweep hands back most often, because
half the databases carry no `readonly` at all — the ordering the plan's original prose had
backwards.

**Green on FIRST RUN, so there was no honest RED** — the generator already drew these rates
and criterion 1 already pointed the door at the datadir. Rather than assume the tests were
therefore worth having, five mutants were applied by hand, one at a time:

| hand-applied mutant | tests killed |
| --- | --- |
| `npcRoot` ↔ `npcUser` swapped | app band, root band, ordering |
| `hasReadonly` never true | readonly, ordering |
| `drawPassword` roll flipped to `>=` | readonly, app band, root band, ordering |
| mysql row back to `accountsIn` (the shipped bug) | ladder shape, readonly, app band, ordering |
| `guest` chance 1 → 0.5 | readonly |

Every one of the five tests dies to at least one, and the bands were chosen to exclude every
retuning listed rather than to bracket the number that happened to come out. Worth recording:
the shipped-bug mutant does NOT move the root band — a box's `/etc/passwd` root falls at
roughly the same 12% its database root does, so a rate alone could never have caught the door
reading the wrong file. The ladder SHAPE is what catches it, because a passwd ladder has two
accounts that are neither `root` nor `readonly` and a database ladder has exactly one.

**No production code changed**, so the evidence is the hand-applied mutants rather than a
Stryker delta — the same footing #435 and #436 stood on.

**Criterion 4 DONE — the refusal is about the door, and now says so.**

A test for this already existed, and it was passing for a reason weaker than the claim it
made. It swept a box with no mysqld using the wordlist `['no-such-word']` — so nothing on
that box would have cracked whatever door was asked for, and the 404 could as easily have
been about the wordlist or the machine as about the database. Criterion 4 is precisely the
strengthening that closes that: the box has to be one that WOULD have fallen.

It now sweeps `www-154` — a box running ssh and http and no database — with a wordlist
holding every one of its unix passwords. The database door answers `service_not_running`
and writes nothing, while the SAME box under the SAME wordlist gives its shell up through
`hydra <host> ssh`, returning `root`, `webadmin` and `guest`. That pairing is the whole
claim: a handler reaching for `/etc/passwd` when it found no datadir would answer 200 here
and hand back three accounts, which is the loudest possible version of the bug this door
exists to avoid.

The two doors get their own `makeDeps`, because they share a journal otherwise and the ssh
sweep's own `auth.log` write lands on the counter the mysql half asserts is untouched. The
first draft of this test failed exactly that way — a useful reminder that "wrote nothing"
is a claim about one handler call, not about the test.

New helper `databaselessHostOn`, which picks a host for the property the claim needs
(runs ssh, runs no mysqld) rather than reusing `sshlessHostOn`, which selected for the
absence of a different service and only happened not to run a database.

**Green on first run** — the handler already refuses on the pidfiles before it sweeps
anything. Both halves proven load-bearing by hand-applied mutants:

| hand-applied mutant | effect |
| --- | --- |
| `readOpenPorts(...).find(port => port.service !== spec.service)` | mysql resolves to the box's ssh port, 200 instead of 404 — kills the refusal half |
| ssh row's `accountsOn` pointed at `databaseAccountsIn` | the control box gives up nothing — kills the control half |

**No production code changed.**
**Criterion 2 DONE — one half was already discharged, and checking that was the work.**

The criterion has two halves, and they turned out to be worth very different amounts.

**The hash half needed no new test.** Criterion 1's `reports the datadir's credentials rather
than the box's /etc/passwd` compares the handler's answer to
`databaseAccountsWithPasswords`, whose expected value is DEFINED as "for each stored
credential, the wordlist word whose md5 equals its `passwordHash`". Equality with that list
already means every returned credential opens the entry it names — a sweep reporting a name
against a password that does not open it could not equal it. A restatement was written
first, then removed: hand-mutating the sweep to report `words[0]` instead of the matched
word killed it along with seven other tests including criterion 1's, so it added an oracle
rooted in the stored file but no failure any other test would have missed.

`tsc` is what prompted the check. `HandlerResponse.body` is `Record<string, unknown>`, so
hashing the returned plaintext needs a narrowing helper the suite does not otherwise have —
about fifteen lines of test infrastructure for a claim already asserted. The opaque body is
the codebase saying tests read this through matchers, and routing around it to restate an
existing assertion is not what that infrastructure would have bought.

**The independence half was genuinely untested, and is now the criterion's whole weight.**
`keeps a box-s shell and its database behind two different keys` hands each door the OTHER
door's entire set of passwords — not a wordlist that merely fails, but the one that opens
the box next door — and requires both to return nothing. Both directions are checked,
because a shared stream would leak either way round.

The disjoint guard is what keeps it meaningful. If the two streams ever drew the same
password for the same box, each sweep would be handed its own key and the claim would
quietly stop being tested rather than failing. On the fixture the two sets are disjoint, and
the test says so out loud.

Non-vacuous in both directions, by hand-applied mutants:

| hand-applied mutant | direction killed |
| --- | --- |
| mysql row's `accountsOn` back to `accountsIn` | the database door opens to the shell's passwords |
| ssh row's `accountsOn` pointed at `databaseAccountsIn` | the shell opens to the database's passwords |

**No production code changed.**
**Criteria 7 and 8 DONE — and 8 was not the formality it looked like.**

**Criterion 7 — the wordlist.** The branch's whole production diff is two lines per handler,
identical in all three: `accountsIn(fs)` became `spec.accountsOn(fs)`, plus the optional
`database`. The wordlist read is untouched, which is the first half of "unchanged, and must
not regress".

The second half wanted a test that did not exist. `hydraCrackSchema` is a `looseObject`, so a
client CAN attach a `wordlist` field to the payload — it is not rejected, it is simply never
read, and nothing said so. `ignores a wordlist the request brought with it, database door
included` now does: the caller's machine holds a list that opens nothing on the target, the
request carries the one that opens the whole ladder, and the answer is `cracked: []` with
`wordlistFound: true`. Killed by teaching the handler to glance at `payload.wordlist`. The
database door is the right place to make the claim — its accounts are the ones a player is
meant to work for, so a request-supplied list would hurt most there.

**Criterion 8 — the other doors. One of them was unguarded, and this branch is what made
that possible.** Before, every door read `/etc/passwd` because the handler said so; a row
cannot point at the wrong source when there is no row. Now each row names its own source,
and pointing one at the wrong file is a new class of mistake. Each of the three legacy rows
was pointed at `databaseAccountsIn` by hand to see what noticed:

| row | tests that failed |
| --- | --- |
| `ssh` | 16 |
| `http` | 1 — `reaches the http service behind the port that forwards to it`, in the public suite |
| `ftp` | **0** |

The ftp door had nothing holding it to `/etc/passwd`. Its two existing tests assert log
ROUTING — that the trace lands in `vsftpd.log` and not in `auth.log` — and they cannot catch
a wrong source, because `ftpHostOn` finds the same box `mysqlHostOn` does (it runs ssh, ftp
AND mysql) and both of that box's ladders begin with an account called `root`. A first trace
line reading `Failed password for root` is the same line whichever file was consulted. A
coincidence of names hiding a wrong source is the same blind spot as a drawn name checked
against the pool it came from, and it is closed the same way: assert the thing that actually
differs, which is the whole list. `still sweeps /etc/passwd when the door asked for is ftp`
now fails when the ftp row moves.

**The gap that remains, measured rather than assumed.** Reverting BOTH vantage handlers to
`accountsIn(target.fs)` — the shipped bug, on the gateway and public paths — leaves all 3103
tests green. The lines themselves are exercised (the http mutant above fails a public-suite
test, so `spec.accountsOn` does run there); what has no test is the MYSQL door through those
two vantages. That is exactly what criterion 9 assigned to slices 5 and 7, which will build
the fixtures — a deep host running mysqld behind a forward, and a public IP forwarding to
3306 — rather than half-building them here. Recorded with the mutant that proves it so those
slices have a target and not a hope.

**No production code changed.**
**Wire-check GREEN — `scripts/testMysqlSweepTrace.ts`, 13/13 against live `vercel dev` + supabase.**

**What `api/` actually exposes, checked rather than assumed.** There is no `api/hydra*.ts`.
`api/` is three endpoint files, and hydra is three ACTIONS multiplexed inside `api/sessions.ts`
(`hydraCrack` at :474, `hydraCrackPublic` at :495, `hydraCrackInnerGateway`). This branch's
production diff under `api/` is **empty**, so the plan's blanket "slices 2–5 and 7 touch `api/`"
does not hold for this slice.

The two deps a database sweep newly exercises are generic despite their names.
`readAuthLogVia` is fully path-parameterised — `.eq('path', path)` — and `upsertPatchVia` takes
the row's own path. Routing a sweep to `/var/log/mysql.log` therefore needed no adapter change.
`readAuthLog` is a misleading name for a generic machine-log read, not a hardcoded path.

**So the wire-check is load-bearing, but narrowly, and not for the reason the plan gave.** The
datadir is seeded in `buildRemoteHostFs` — base FS, generated server-side, no row involved — so
there is no round-trip there to prove. What only the wire can settle is that a `patches` row at
`/var/log/mysql.log` LANDS and reads back: unit tests assert path, owner and permissions against
an injected spy, and `patches` is keyed on `(machine_id, path, writer_key)`. A sweep that wrote
both logs under one key, or lost the second row to the upsert's conflict target, or tripped a
constraint the table enforces, passes every unit test in the suite. `testFtpSweepTrace.ts` exists
for exactly this reason and says so in its own header.

Written as a port of that script, with the four claims ftp has no analogue for: the accounts come
from the datadir and not `/etc/passwd`, the accepted line names the database, the refusals name
none, and the ssh control still returns the box's OWN accounts.

**The fixture took finding.** `BEAN-THERE-WIFI` — the suite's own ESSID — is unusable: its
`laptop-74` runs all three doors, but its database gives up NOTHING to the starting wordlist, so
there would be no accepted line and the database-naming claim would have nothing to assert.
`MYSQL-LAB-3` was chosen because `records-186` runs mysql AND ssh, and all three of its rungs
fall:

    target records-186 192.168.254.186 — database "app_master",
      expecting ["data_admin:cisco","readonly:guest","root:linksys"]
      and none of ["guest:letmein","reporting:netgear"]

The two ladders share no pair, which is what makes "no unix account appears" a sharp claim rather
than a lucky one. The script guards both properties and exits 2 rather than passing quietly on a
box with nothing to find.

The expectation is computed from the DATADIR FILE, never through `spec.accountsOn` — an
expectation read through the catalog column would move with the very column the check exists to
test.

**Run it with the stack up:**

    npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlSweepTrace.ts

**Result: 13/13.** The endpoint returned exactly the datadir's three rungs —
`root:linksys`, `data_admin:cisco`, `readonly:guest` — and none of the box's own
`guest:letmein` or `reporting:netgear`, which the same wordlist opens. The trace landed as 33
lines at `/var/log/mysql.log`, root-owned and root-write, with the accepted line naming
`app_master` and no refusal naming it. `auth.log` had no row at all until the ssh control ran,
which then wrote 57 lines there and left the database log untouched.

**The two existing hydra wire-checks were run too, because criterion 8 rests on them.**
`testHydraOwnLan` passed 23/23 unchanged. `testFtpSweepTrace` did NOT run at all — it exited 2
on `ESSID VSFTPD-LAB has no host running BOTH ftp and ssh`.

That is a PRE-EXISTING breakage on `main`, not a regression here, and the proof is structural
rather than a hunch: this branch touched no file under `src/core/generation/`, and its
`serviceCatalog` diff adds only `accountsOn` and `databaseOn` — no `service`, `defaultPort`,
`altPorts`, `altPortChance` or placement value moved, and those are the only fields
`hostServices` reads. The rolls it returns for that ESSID are byte-identical to main's. Some
earlier merged change moved that network's hosts and the check has been dead since, still
recorded as 8/8 in the conventions doc.

Repaired here because criterion 8 is unverifiable while it cannot run: the ESSID moves to
`VSFTPD-LAB-3`, whose `www-197` runs both doors. One line, and the script is back to its
documented **8/8**.

The other four ftp scripts pin the same ESSID, so all four were run to see whether the fix needed
to be wider. It did not — they need a box running ftp ALONE, which `VSFTPD-LAB` still has:
`testFtpRemoteRead` 7/7, `testFtpPut` 12/12, `testFtpTransferTrace` 13/13. `testFtpSession` came
back **12/14** against its documented 14/14, failing the two BACKWARD-COMPAT checks (a login
naming no `kind` reads back `no row`; ending one without a reason reads back
`end_reason=undefined`). Also not this branch — it touches neither `authCreateSession` nor the
session path in `api/sessions.ts` — and deliberately NOT fixed here, because whether the old
login shape is still meant to work is a launch-compatibility decision rather than a test repair.
Recorded in the deferred backlog with the current baseline, so the doc stops claiming 14/14.

The general lesson, now in the conventions doc: **a wire-check that selects its own fixture can go
dead silently.** An exit 2 is not a failure, nothing runs these in CI, and the registry kept
reporting a pass count for a script that had not executed in months.
**Slice 2 is COMPLETE and MERGED** — v0.159.0, PR #437, squashed onto `main` as `a6bdead`
(17 files, +1713/-37). All nine acceptance criteria met; `testMysqlSweepTrace` **13/13** against
live `vercel dev` + supabase; `testHydraOwnLan` 23/23 and the repaired `testFtpSweepTrace` 8/8;
3104 unit tests, `tsc -b` and `eslint` clean.

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

### Slice 3: A player reads a database ✔ LANDED (v0.160.0-v0.162.0, #438 `04beaa4`, #439 `36e1ae0`, #440 `b058621`)

**Value**: The epic row's stated acceptance — a player reads generated data worth reading.
**Path**: `mysql <host>` → masked credential prompt → per-statement server action → validate
against the datadir `credentials` → parse → execute → format → result set only.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Opens owing one debt, and standing next to a second that is not its own.**

1. **OWED HERE — 42 column-METADATA mutants** in `pools/database.ts` (`nullable` flips, `key`,
   `defaultValue`) survive because nothing renders that metadata yet. `DESCRIBE` is the thing that
   renders it, so this slice is where they become killable. **`DESCRIBE` must be asserted over the
   population, not over one table on one box** — a single fixture agrees with whatever the pool
   happens to hold — or all 42 persist behind a number that looks finished.
2. **NOT owed here, but do not widen it** — no vantage fixture sweeps a database, so reverting both
   vantage handlers to `accountsIn(target.fs)` leaves the whole suite green (measured, with the
   mutant, above). Slices 5 and 7 own that. This slice adds a `mysql>` prompt on the own-LAN
   vantage only; if it invents a gateway fixture for any other reason, give that fixture a database
   box so 5 has something to build on.

**Acceptance criteria** — GRILLED AND SETTLED 2026-08-20, five owner decisions taken against the
codebase rather than against the plan's own prose. The paragraph this replaces packed eleven claims
into one sentence and hid three more. Each line below is something a test can fail.

**Reaching the door**

1. `mysql [-p port] <host> [user]`. **`-p` is the PORT**, as it is for `ftp` and `hydra` — the real
   client's `-p` means password and `-P` means port, and consistency across v2's doors beats
   fidelity to a flag letter, since slice 5 needs the port to reach a forwarded 3306. A username may
   be named on the command line because it is not a secret; the password never may (decision 10).
   No `-u` alias — one way in.
2. When no user is named, prompt for one **with no default**. `ftp` offers the player's own account;
   here that is a wrong guess every single time, because database accounts are `root`, `readonly` or
   a drawn app name and never the box's unix users. A default nobody accepts is worse than none.
3. A box with no mysqld refuses **before either prompt**, decided locally from the deterministic
   generated FS, with legacy's `ERROR 2003 (HY000): Can't connect to MySQL server on
   '<ip>:3306' (Connection refused)`. **The sharp assertion is that `env.prompt` is never called** —
   not the message. A door that takes a credential and hands it to a service that is not there is
   the failure ftp's docstring already names.
4. Ctrl-C at either prompt aborts holding nothing, exit 130, as `ftp` does.
5. A bad credential is refused with **one indistinguishable error**: an unknown user and a wrong
   password produce the same string, `ERROR 1045 (28000): Access denied for user '<u>'@'<ip>'
   (using password: YES)`. Its log half already shipped in slice 2.
6. A good credential prints `Connected to <hostname>.` then `Welcome to the MySQL monitor.
   Commands end with ;` and leaves the player at `mysql>` — ftp's shape of a client line followed by
   the server's own greeting. **Version-free**: the catalog bans version strings and MySQL's real
   greeting IS one, which is why this door's `nc` banner is the bad-handshake error. **No connection
   id**: `listenerPid` is per-BOX, so printing it as a connection id is a lie two logins apart, and
   with no session row there is nothing to count connections with.

**The prompt**

7. **Parallel, not a hop** — cwd, tier and hop chain untouched, and `quit` hands back a shell that
   never went anywhere.
8. **Every line typed is SQL.** No outer command leaks through, on `ftpShell.ts`'s stated rule: an
   outer `cat` at an inner prompt would quietly read the wrong machine.
9. **Semicolons optional.** `exit`/`quit`/`help` are parsed ahead of the verb table, so they need
   none and are never "unsupported syntax".

**The read set**

10. `SHOW TABLES`, `DESCRIBE` and `SELECT` (with `WHERE … AND …`) render legacy's ASCII tables and
    `N rows in set (0.00 sec)`. The formatter ports verbatim.
11. **A `SELECT` matching nothing renders `Empty set (0.00 sec)`** — not a table with a zero count.
    A different formatter path, which the old criterion's "and `N rows in set`" concealed.
12. **Write verbs PARSE and are refused**, unconditionally in this slice, with `ERROR 1142 (42000):
    UPDATE command denied to user '<u>'@'<ip>' for table '<t>'`. True for `readonly` and the app
    account, which between them are what nearly every player holds first. A database-root credential
    is under-told for exactly one slice — the accepted cost of never telling a player that their
    well-formed statement is a syntax error, which is what porting only the read verbs would do.
    Slice 4 turns the refusal from unconditional into tier-conditional with no visible regression
    for the common case.

**`credentials` — the database's own `/etc/passwd`**

13. The datadir's account list is reachable as a table named **`credentials`**. The name is free: the
    pool draws `api_keys`, `audit_log`, `config`, `employees`, `inventory`, `orders`, `sessions` and
    `users`, so a generated table can never collide with it.
14. It is **LISTED by `SHOW TABLES` and DESCRIBABLE at every tier**, while `SELECT` is refused below
    `user` with `ERROR 1142 (42000): SELECT command denied to user 'readonly'@'<ip>' for table
    'credentials'`. This mirrors the filesystem exactly rather than by analogy: `/etc` is traversable
    at every tier so a guest sees `passwd` in `ls`, while `PASSWD_FILE` is `read: ['root', 'user']`
    so a guest cannot read it. **The database gets the same shape one door in**, and the bottom rung
    can SEE what the next credential buys.
15. **The hashes render inline, as passwd's do — and this transfers no capability.** `john` and
    `hydra` run the same wordlist through the same `md5`, so cracking database root's hash offline
    yields root at exactly the 12% hydra already yields it. What it transfers is **silence**: hydra
    leaves a wall of denials in the target's own `mysql.log` and `john` writes nothing anywhere.
    That is the middle tier's reward, and it costs the ladder slice 2 measured nothing.
16. Note what this makes slice 3: **the slice ships one tier rung after all**, and it belongs to the
    READ set rather than being a preview of slice 4's ladder. Slice 1's `DATADIR_FILE` is unaffected
    and stays root-ONLY on the filesystem — reading the file and querying the door remain two
    different achievements.

**What the server may say back**

17. **The response carries the rendered output and nothing else**, asserted by whole-value equality
    so an added field fails. Criterion 14 is what makes this load-bearing rather than hygiene: a body
    carrying the parsed database hands `readonly` the exact rows criterion 14 refuses, in a field the
    terminal never renders and anyone watching the wire can read.
18. **No `sessions` row is minted, at any tier.** Decision 8's mechanism, and what makes
    zero-filesystem-read structural rather than enforced — there is no row, so there is nothing to
    leak, and `authorizeMachineAccess` needs no carve-out.

**Liveness**

19. A daemon stopped mid-session drops the player on their **next** statement — there is no push
    channel, so the drop is necessarily lazy — with `ERROR 2013 (HY000): Lost connection to MySQL
    server during query`. **The prompt then CLOSES**, returning the player to the shell they never
    left, and prints no `Bye`: an eviction is not a quit and the difference is the whole signal. A
    `mysql>` that answers every statement with the same error is the `->` continuation problem
    decision 10 already declined to pay for.

**Logging**

20. The connect line lands in `/var/log/mysql.log` with user, source IP and database name — slice
    2's `formatMysqlConnectLine`, reused rather than rewritten, on slice 2's finding that a sweep
    that opens an account and a client that opens one are the same event to the daemon writing the
    file.
21. **A whole session of reads leaves the log exactly ONE line longer** (decision 12: `SELECT` never
    writes). The assertion is the DELTA across a session of many statements, not the presence of the
    connect line — a log that grew by one is the claim; a log CONTAINING a connect line is satisfied
    by the login alone.

**RED**: Command + prompt-mode tests (jsdom + `@solidjs/testing-library`), handler tests, and
`scripts/testMysqlQuery.ts` for the live round trip.

**How criteria 17-18 are actually proven** — three parts, because no one of them is sufficient:
whole-value equality on the response body; an assertion that the `sessions` table gains no row; and
on the wire, a grep of the RAW response body for any `passwordHash` substring after a `readonly`
connect. The last one is shape-independent — it catches a leak down any path, including one added
later by someone who never read this list.

**How the DESCRIBE debt is discharged** — assert SHAPE over the population, never the pool. Slice 2's
lesson is that an oracle read from the same array the generator reads moves with it and can never
fail. So: every table renders exactly one `PRI`; a declared default renders non-blank while an
absent one renders `NULL`; and both `YES` and `NO` occur in the `Null` column somewhere in the
world. That kills the `nullable`, `key` and `defaultValue` mutants without freezing content into a
golden.

**Done when**: criteria met, wire-check green, commit approved.

#### Progress

**Criterion 3 ✔ LANDED** (`71aecb0`) — `src/core/commands/mysql.ts` + `mysql.test.ts`, 5 tests,
gates green at 3109. RED was real: the first version had no reachability guard and went straight to
asking, so against a box with no database it prompted TWICE, for a user and a masked password. The
test names the silence rather than the wording, which is what the criterion asked for.

**The mutant worth carrying forward.** Pointing the door at ssh's port instead of mysql's SURVIVED
the first version of these tests — the ftp finding from slice 2 in a new place. The fixture picked
the first machine running no database, and that box ran NOTHING AT ALL, so a check on 3306 and a
check on 22 refuse it alike and no test could tell which port was read. The door could have been
reading the wrong service with the suite fully green. The fixture now demands an ssh-serving host
with no database, the only place the two answers differ, and the mutant dies there. Four more were
applied and killed: guard removed, guard always refusing, the two refusal reasons swapped, and
network-unreachable rewritten as connection-refused.

Twice in two slices makes it a rule, now in the conventions doc: **a negative fixture must be
negative for the reason under test, not negative in general.**

**Criterion 4 ✔ LANDED, criterion 5 HALF landed.** Five tests, 10 in the file, suite at 3114.

The increment's real work was deciding the **shape of the server-side auth call**, which is why
these two came as a pair. `MysqlApi.connect` mints no session and takes no `sessionId` — decision
8 — and its refusal deliberately **carries no reason**: `{ ok: true } | { ok: false }`. An unknown
account and a wrong password have to read alike, and a seam that brought back WHICH one failed
would let a client leak the difference by accident. Structural beats enforced, so the reason is not
there to render.

Criterion 5's client half is proven: the refusal names the account TYPED (not the session's) and the
player's OWN address (not the target's), both a single substitution away and both now killed.
`execute` switched to `connectedWlan0`, the pattern curl/gobuster/hydra/lynx/nc already share —
which collapses four ways of being offline into one answer AND hands back the address, so the
refusal needs no fallback for an address that cannot be missing by then.

**Criterion 4 was characterisation, not RED** — the abort guard was already written without a test,
so the tests passed on arrival and the evidence is the mutants below. Recorded plainly because a
"RED" that was green the moment it was written is not evidence of anything.

**Mutants: 9 applied by hand, 9 killed**, with a behaviour-preserving control (a local rename) run
first to prove the harness discriminates rather than reporting KILLED for everything:

| | |
|---|---|
| M1 | Ctrl-C yields an empty credential instead of nothing |
| M2 / M3 | abort exits 0 / abort prints a line |
| M4 / M5 | refusal names the session's user / the target's address |
| M6 | a named account is prompted for anyway |
| M7 / M8 | wrong source address sent / account name sent as its own password |
| M9 | refusal branch inverted |

**Still written but NOT tested** — narrowed, not cleared:

- The prompt wording `Enter user: ` and the no-default rule — criterion 2. (`Enter password: ` and
  `masked: true` ARE now asserted.)

**Criterion 5's server half ✔ DISCHARGED, and criterion 20 with it.**
`core/sessions/mysqlConnect.ts` + 12 tests, plus `credentialIn` in `core/mysql/datadir.ts` —
`accountIn`'s sibling for the door whose accounts are not the box's own. RED was behavioural, not a
missing module: a skeleton that verified the envelope and refused everything failed 9 of 11 on
status and on writes, so the tests were failing about behaviour before a line of the gate existed.

The sharpest test is the one that costs nothing to get wrong: a box's OWN unix account, with its
REAL shell password, opens nothing here. `/etc/passwd` and the datadir are drawn on separate
streams, and a gate that read the wrong one would pass every other test in the file.

The two refusals are proven identical rather than merely documented — same status, same body, byte
for byte, asserted by comparing the two responses to each other rather than each to a literal.

**Mutants: 14 applied, 13 killed, 1 equivalent.** Control (a rename) survived first, so the
verdicts discriminate. Killed: the gate reading `/etc/passwd`; the account name ignored so any name
opens; the refusal naming WHICH half was wrong; the password never checked; the journal ignored so
the seeded baseline is authenticated against; the daemon never checked for listening; the listening
check reading ssh's port; a bricked box still answering; every attempt logged as an acceptance; the
trace forgetting where it came from; the log replacing history instead of appending; the trace
written on the caller instead of the target; and an opened connection reporting more than that it
opened. The equivalent one — a refusal carrying a `database` field — changes no rendered line,
because `mysqlLog.test.ts` already asserts a refusal names no database EVEN WHEN one is supplied.
That claim lives at the formatter, which is the right layer for it.

**Wire-check: `scripts/testMysqlConnect.ts`, 13/13 live** against `vercel dev` + supabase, and the
neighbouring `testMysqlSweepTrace.ts` re-run 13/13 as a regression control because the endpoint's
dispatch changed. What only the live run could prove: that the `mysqlConnect` action is DISPATCHED
at all (a new action on an existing route is invisible to unit tests, which call the handler
directly); that the row lands at the target's machine id and path with an owner and permissions the
table accepts; that an account planted by editing the datadir through `patches` really logs in; and
that **no `sessions` row appears** — criterion 18's mechanism, which is an absence in a table a spy
never sees.

The live run also corrected the test rather than the code: the log-growth check expected five lines
for what were only four attempts. It now asserts one line per attempt AND the split — 1 accepted, 3
refused — which is the stronger claim the number was standing in for.

Worth knowing for later fixtures: on `MYSQL-LAB-3` the chosen box's database account and its unix
account are BOTH named `root`. That is an accident, and a useful one — the two-locks test contrasts
the same name under two passwords, so it cannot pass by the names simply differing.

**Known simplification, owed by criterion 19.** The client adapter collapses every non-200 into the
seam's one refusal, so a daemon stopped between the local reachability check and the call reads to
the player as a wrong password. Criterion 19's liveness drop is where that arm gets added; the
window is one prompt wide.

**`env.mysql.connect` is wired to `notWired` in the UI**, the house shape for a seam with no adapter
behind it. It cannot fire — the command is still unregistered — and if someone registers it before
the endpoint exists it throws loudly instead of reporting a wrong password for a credential no
daemon ever saw.

**No version bump**, as with criterion 3: nothing a player can reach changed. The bump lands with
registration.

**Known gap, deliberate**: `-p` is declared in `flags` and named in USAGE but never read — `port` is
always `SERVICE_CATALOG.mysql.defaultPort`. `ftp` has the same shape, honouring `-p` only on its
public path, so this is slice 5's to make real rather than a defect here. Until then the flag is
inert, and criterion 1 is only PARTLY met.

**NOT registered in `registry.ts`.** It would be typeable while still answering `not implemented` on
a box that does run a database, and a command listed before it works is a worse lie than a missing
one. Registration lands with criterion 6, the increment that opens the prompt.

**Criterion 6 ✔ LANDED, and criterion 7 with it.** `mysqlShell.ts` + 4 tests, 4 more on the
command, 4 at the UI seam and 1 rendered end to end — 159 files / 3140 tests, v0.160.0, the first
player-visible change in this slice. `mysql` is in `registry.ts` and carries a manual page.

The greeting is asserted by WHOLE-VALUE equality, because what is absent is the claim. The real
monitor leads with a version string and the catalog bans those — the same reason this door's `nc`
banner is the bad-handshake error rather than a banner. No connection id either: `listenerPid` is
per-BOX, so it would read the same number two logins apart. And it names the HOSTNAME, not the
address typed to reach it, which is a single substitution away and now killed.

**The prompt turned out to be a sub-shell, not a mode.** `ModeChange` had carried a speculative
`{ kind: 'mysql' }` variant since before any of this existed; nothing ever produced it and nothing
ever will, because the database prompt holds no screen and no session — it swaps the terminal's
prompt and answers the typed line from a command map, exactly as `ftp>` does. Deleted, on the
comment already sitting above it for `nc`: a design that looks shipped invites someone to build it.

**Scope taken beyond criterion 6, deliberately.** A prompt with no way out is a trap and a prompt
that falls through to the registry is the leak criterion 8 forbids, so this increment also lands the
dispatch guard and `exit`/`quit` — which is criterion 7 in full (cwd, tier and the shell prompt all
proven untouched across a login and a `quit`). Criterion 9's semicolon rule holds for the way out
only; the verb table it sits ahead of does not exist yet.

An unrecognised line gets legacy's `ERROR: Unsupported SQL syntax…`, NOT `1064`. The two are
different buckets in the parser being ported, and the distinction is the one criterion 12 rests on:
telling a player their statement is malformed when the truth is that it is unsupported sends them to
fix spelling that was never wrong. `cat` at `mysql>` is unrecognised and stays unrecognised; when
the read verbs land they slot in AHEAD of this fallback, so nothing written here is a lie to undo.

**Mutants: 20 applied, 20 killed.** Control (a three-part rename) survived first, so the verdicts
discriminate. Killed at the command: the greeting naming the address instead of the box; the
greeting carrying a server version; the connection never held; the connection held even on a
REFUSAL, which would strand the player at a prompt no credential is behind; the password dropped
from what is held, which every later statement needs; the held connection naming the target as its
own source; and a good login reporting failure. At the prompt: the way out made case-sensitive; a
trailing semicolon kept; `quit` printing `Bye` while holding the connection; `quit` saying something
else; a bare Enter answered as unsupported syntax; and an unrecognised line logging the player out,
which would turn every typo into a logout. At the seams: the typed line falling through to the outer
registry; the command not registered at all; the terminal never swapping the prompt in; the terminal
showing `ftp>` for a database; the prompt appended to the shell's rather than replacing it; `quit`
leaving the prompt held; and the prompt losing its trailing space.

**The last four of those cost a test at a layer that had none.** The first battery left ONE survivor
— deleting the prompt swap from `Terminal.tsx` — because every other check lived at the state layer,
where `inMysqlSession()` is true and nobody looks at what the player SEES. A terminal that answered
SQL while still showing `alice@workstation:/home/alice$` passed the whole suite. `Terminal.test.tsx`
now drives one login end to end through the rendered field. Two things it taught: a masked prompt
renders `type="password"`, which has NO implicit textbox role, so `getByRole('textbox')` cannot find
the field the password is typed into; and the prompt renders `whitespace-pre`, so its trailing space
is a rendered character — the default text matcher collapses exactly the difference that is visible.

**No wire-check.** Nothing under `api/` or in `adapters/` changed; `mysqlConnect`'s round trip was
proven live at `597dd2b` and this increment only decides what the client does with the answer.

**A harness gotcha worth not repeating.** The hand-mutation script snapshots every file it will
touch when it starts and restores from that snapshot at the end. Editing one of those files while it
runs in the background silently loses the edit — a manual page written mid-run was gone by the time
the battery finished, and only the suite caught it. Snapshot, then keep hands off.

#### Criteria 8-12 — the verb table and the statement round-trip

**Landed: 8, 9, 10, 11, 12 — and 17, 18, 19 and 21 came with them**, because all four are claims
about the round-trip rather than about the verbs, and the round-trip did not exist until now.

**Where execution lives, and why.** The client sends the line; the server parses, executes, renders,
and returns text. Criterion 17 forced it: a response carrying rows hands the client every row the
account was not allowed to select, in a field the terminal never draws and anyone watching the wire
can read. Criterion 19 confirmed it — a stopped daemon can only be discovered by a request that goes
somewhere. So the client's local set is exactly what needs no database: empty, `exit`, `quit`,
`help`.

**One module, not three.** `core/mysql/statements.ts` holds parsing, execution and rendering
together. They are three views of one question — what does the player see when they type this line —
and three public contracts would invite a caller to hold a parsed statement or a raw result set,
which are the two things criterion 17 says nothing outside may hold.

**Write verbs are parsed precisely so they can be refused as a PERMISSION problem.** A well-formed
`UPDATE` told it has a syntax error sends the player to rewrite a statement that was already
correct; what they need is a better account, and `1142` is the only answer that says so. The denial
is raised BEFORE the table is resolved — one that fired only for tables that exist would answer
"does this table exist?" for an account with no right to ask.

**"Ports verbatim" was measured, not asserted.** Every golden block was captured by running legacy's
own formatter over the same fixture, then the temp harness was deleted from the frozen tree. One
deliberate departure: a row missing a column renders `NULL` rather than the JavaScript word
`undefined`, because the datadir is root-owned on a box a player can reach as root, so a row missing
a cell is something a player can arrange.

**`reachMysqlHost` is now shared** by both database doors. Checking the pidfiles per statement is
what lets a stopped daemon drop a session, since there is no session row to invalidate — criterion
19's mechanism, and the reason the extraction is load-bearing rather than tidiness.

**Mutation: 33 applied, 33 killed, control survived.** The first pass killed 28 and left 5, and all
five were blind spots in the fixture rather than equivalent mutants. In `orders` every numeric header
happens to be exactly as wide as its widest value, no column carries a default, and nothing is
referenced in the wrong case — so right-aligning headers, ignoring defaults and treating text as
numeric all render it identically. **The general rule this is an instance of: a golden-output fixture
has to VARY in the dimension each formatting rule acts on, or the rule is decoration a test cannot
see.** A second table with varying widths and a default kills all five.

**Wire-check: `scripts/testMysqlQuery.ts`, 10/10 live.** It proves the things no unit test can see —
that the action is dispatched at all, that the body carries `output` and `failed` and nothing else
over the wire, that the credential is re-checked per statement, that a session of reads leaves
`mysql.log` exactly one line longer (criterion 21's DELTA, not the presence of a line), that no
`sessions` row exists at any point (criterion 18), that a datadir edited through `patches` is really
replayed, and that deleting the pidfile stops the answers (criterion 19). `testMysqlConnect.ts` was
re-run at 13/13 to prove the `reachMysqlHost` extraction preserved the login door.

#### Criteria 13-16 — the account list as a table

**Landed: 13, 14, 15 and 16.** The datadir's accounts are readable as a table named `credentials`,
listed by `SHOW TABLES` and describable at EVERY tier while its `SELECT` is refused below `user`.

**The mirror is exact rather than an analogy, and that is what settled the design.** `/etc` is a
traversable directory, so a guest who runs `ls` sees `passwd` sitting in it; `PASSWD_FILE` is
`read: ['root', 'user']`, so that same guest cannot open it. This table has the same shape one door
in. The bottom rung sees a `password_hash` column it may not read, which is what tells it there is
something here worth a better credential — a ladder nobody can see the top of is not a ladder.

**Legacy has no `credentials` table**, so unlike every other block in this slice there was no
oracle to capture: `src/commands/mysql/executor.ts` never mentions one. The columns are chosen, not
ported — `username` / `password_hash` / `user_type`, which are `MysqlCredential`'s own field names,
so what a rooted player reads in `data.json` and what the door renders are the same three words.
`user_type` is exposed deliberately: `root` gives its tier away by its name, but app-versus-readonly
does not, and that distinction is what makes criterion 15's reward legible.

**It is a VIEW over the account list, not an entry in `tables`, and it wins over a stored table of
the same name.** The datadir is root-owned on a box a player can reach AS root, so a decoy is
something a player can arrange — and what a reader gets here has to be the list that actually
decides logins, or planting an empty `credentials` table would hide the real accounts from the next
player through the door. A stored one is also dropped from the listing, which would otherwise name
the same table twice.

**The tier is derived, never declared.** It comes off the credential the statement just validated
against; the client sends no tier and could not be believed if it did, since no session row holds
one that was decided earlier. Proven by mutation rather than by reading the code: pinning
`userType` to a constant in the handler turns two tests red.

**Two smaller calls, both following rules this door already had.** The refusal fires BEFORE the
field list is resolved — an account with no right to read the table has no right to be told which
of its columns exist, and a refusal that said `Unknown column` would be a working column oracle for
exactly the tier that must not have one. And it echoes the table as the player SPELLED it, matching
the write denial, because confirming a table's exact casing is one more thing this answer should
not say. `denyWrite` and this refusal collapsed into one `deny` — the same knowledge, which is how
this door spells a 1142.

**One existing claim changed, and the change is the point.** `SHOW TABLES` against a datadir with
no tables no longer renders an empty grid, because the account list is always there. The empty-grid
path is re-pinned where it is still reachable: `DESCRIBE` of a table a tamperer has stripped of its
columns.

**Mutation: 20 applied, 20 killed, control survived** — and unlike the last battery, no survivors to
chase, because the fixture was built with the varying-dimension rule already in hand (three
usernames of different widths, three tiers, a planted decoy).

**Wire-check: `testMysqlQuery.ts`, 16/16 live** (was 10/10). Six new checks, on `MYSQL-LAB-3`'s
`records-186`, which carries all three tiers with every password recoverable. The one worth naming:
**no stored hash appears anywhere in the RAW bytes of the refusal**, checked as a substring over
the response text rather than over a parsed shape. A whole-value assertion only guards the fields
somebody thought to name; this guards a field added later by someone who never read the file.
`testMysqlConnect.ts` re-run at 13/13.

**Criterion 16 needed no work** — it is the claim that `DATADIR_FILE` stays root-ONLY on the
filesystem, so reading the file and querying the door remain two different achievements, and
`remoteHostFs.test.ts` already asserts exactly that over a population of generated boxes.

**Next**: slice 4 — the tier ladder for WRITES. Criterion 12's unconditional denial becomes
conditional: `readonly` is refused an `UPDATE`, the app account performs one, only database root
may `DROP TABLE`, and every mutation appends to `/var/log/mysql.log` while no `SELECT` ever does.

**Still owed by slice 3**: criterion 2 (the `Enter user: ` wording and the no-default rule are
implemented but untested), criterion 1's `-p` (parsed, inert until slice 5 needs a forwarded 3306),
and **the 42 column-metadata mutants**. `DESCRIBE` now renders that metadata and the formatter's
handling of it is fully killed, but the POOL's own cells are still unpinned — the debt is a golden
assertion over the generated population, not over one table on one box, and it has not been paid.

---

### Slice 4: A player changes a database ✔ LANDED (v0.163.0, #441, `3222dbd`)

**Value**: The three credential tiers become observable, and a database becomes a thing that can be
attacked rather than only read.
**Path**: `UPDATE`/`DELETE`/`DROP TABLE` at `mysql>` → the same per-statement action → tier check →
scoped datadir write → mutation line in `mysql.log`.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**This slice destroys a structural guarantee, and that is the thing to watch.** `MysqlStatementDeps`
currently carries NO way to write — which is why "a session of reads leaves `mysql.log` exactly as
the login left it" is true by construction rather than by discipline. After this slice the door can
write, so that claim becomes a rule tests have to hold. It is criterion 14 below, and it is the one
most likely to rot silently.

**There IS a legacy oracle for the write half**, unlike the account list: `executor.ts` implements
`update`, `delete` and `drop_table` with `formatMutationResult`/`formatDropResult`. Capture it,
do not retype it. Legacy has NO tier check anywhere — no `1142`, no `userType` — so the ladder is
v2's, as the `credentials` refusal was.

**Acceptance criteria** — GRILLED AND SETTLED 2026-08-21; three owner decisions taken. The
paragraph this replaces packed seven claims into one sentence and left the log line open.

**The ladder**

1. `readonly` (guest) is refused all three write verbs with the `ERROR 1142 (42000): <VERB> command
   denied to user '<u>'@'<ip>' for table '<t>'` slice 3 already ships. No visible change for the
   commonest credential a sweep returns.
2. The application account may `UPDATE` and `DELETE`, and is refused `DROP TABLE` with that same
   1142. Editing rows and removing the thing rows live in are different powers.
3. Database root may do all three. This is the first statement in the door that only root can run,
   and at 12% recovery it is meant to stay rare.
4. The denial still fires BEFORE the table is resolved — slice 3's rule, now tier-conditional
   rather than unconditional, so a refused verb still cannot answer "does this table exist?".

**What a write says back**

5. `UPDATE` and `DELETE` render legacy's `Query OK, N row(s) affected (0.00 sec)` followed by
   `Rows matched: M  Changed: N  Warnings: 0`, captured from `formatMutationResult`.
6. `DROP TABLE` renders `Query OK, 0 rows affected (0.01 sec)`. Note the constant: legacy's
   `formatDropResult` says **0.01**, not 0.00, and is a separate function for exactly that reason.
   A shared formatter would quietly normalise the difference away.
7. **`matched` and `changed` are different numbers.** Legacy counts a row as matched when the WHERE
   selects it and as changed only when a SET actually moves a value, so `SET x = '<what it already
   holds>'` renders `Rows matched: 3  Changed: 0`. The fixture MUST contain a row already holding
   the value being set, or the two counters are indistinguishable and both mutants survive.
8. A write naming an unknown column is `ERROR 1054` in `field list` or `where clause`, as the reads
   already are — but only for a tier that may write at all; below that the 1142 wins, per 4.

**Where the write lands**

9. The write reaches `/var/lib/mysql/data.json` and NO other path — asserted over every path the
   door writes, not by reading back the one we expected.
10. It is a patch on the target machine, so a second occupant of the same LAN sees the change on
    their next statement. This is the claim that makes a database a shared object rather than a
    private one.
11. What is written back is the WHOLE database re-serialized and it must still parse. A write that
    produced an unreadable datadir would shut the door on everyone, its owner included, and the
    reader already collapses "unparseable" into "no database here".

**The record** — the open question, resolved

12. A successful mutation appends exactly ONE line, the statement VERBATIM under `Query`:
    `<stamp>\t<pid> Query\t<the normalized statement>`. This is what real MySQL's general log
    does, and the "arbitrary player text in a file others read" objection mostly dissolves:
    `normalizeStatement` collapses every tab and newline before the engine sees the line, so a
    player can neither forge a second line nor fake the tab-delimited columns. A defender who reads
    this file learns what actually changed, which is what makes a compromised box recoverable.
13. A REFUSED write appends exactly one line too:
    `<stamp>\t<pid> Denied\t<VERB> command denied to user '<u>'@'<ip>' for table '<t>'`, mirroring
    the existing `Access denied` refusal shape. Slice 2 already settled the principle — a wall of
    denials is the defender's best signal — and an attempted privilege violation is the most
    interesting thing this file can hold. It does mean a bottom-rung account can cause writes on a
    target, which hydra already does by design.
14. **No `SELECT` ever appends, refused or not.** So the file records connections and attempts to
    CHANGE things, and nothing else. The refused `credentials` read from slice 3 writes nothing,
    and slice 3's delta assertion over a session of reads must stay green unchanged.

**The account list**

15. `credentials` refuses EVERY write at EVERY tier, root included, with the 1142. It is a view
    over the account list rather than stored rows: writing it means writing `database.credentials`,
    a different path from writing `database.tables`, and it decides who may log in — which reaches
    back into the login door. Worth its own slice later; not this one.

**RED**: Tier-ladder behavior tests at the engine, a written-paths spy at the handler, a
two-occupant persistence test, and `scripts/testMysqlMutate.ts` for the live write path.

**Watch for**: `parseUpdate` currently PARSES the SET assignments and throws them away on purpose —
its comment says holding values this door will not apply would be keeping the makings of a mutation
nothing is allowed to perform. That comment marks the slice boundary exactly, and this slice is
where it stops being true.

**Also expect to touch**: `testMysqlQuery.ts` asserts that root is refused `DROP TABLE users`.
Root may drop after this slice, so that check has to move down the ladder rather than be deleted.

**Done when**: criteria met, wire-check green, commit approved.

#### As built — all fifteen criteria, three increments, squashed onto `main` as `3222dbd`

**1-8 and 15, the ladder and the answer** (`4bfd223`, v0.163.0). `WRITERS` holds the ladder as
data: nothing lists `guest`, `DROP` lists only `root`. The refusal and the account-list rule are
one condition, so both fire before the table is resolved and both spell the same 1142.

**Two parity details the criteria did not name, both found by capturing rather than assuming.**
Legacy's `DROP` carries its own error code for a missing table — `ERROR 1051 (42S02): Unknown
table '<db>.<t>'`, where the row verbs say 1146. And `matched` diverges from `changed` because
legacy compares STRING forms: `SET amount = '5'` against a numeric 5 is a match that moved
nothing, and the column keeps its number rather than being rewritten with an equal string. The
existing fixture already held a row carrying the value being set, so no fixture was invented to
make the two counters differ.

**9-11, where it lands** (`50f28c1`). The datadir goes back whole, owner and permissions
re-stated rather than inherited — a rewrite must not quietly widen the one file on the box that
holds the hashes a sweep has to work for. A failed journal write returns **500
`datadir_write_failed`** rather than `Query OK`: OWNER DECISION 2026-08-21, on the grounds that
the datadir write IS the statement rather than a note about one, and a rendered success over a
lost write would read as the game losing writes.

The datadir's location became ONE declaration that the reader walks and the writer names. It had
been a hand-rolled four-level walk plus a path string somewhere else — two facts that have to
agree, and on the day they stopped, a write would land where nothing reads it.

**12-14, the record.** A `Query` line carries the statement NORMALIZED, which is the whole answer
to holding a player's own text in a file others read: every tab and newline is gone before the
engine sees the line, so there is no forging a second entry and no faking the tab-delimited
columns. A `Denied` line carries the refusal without the error code the client was shown — the
same split the `Access denied` line beside it already makes.

**The Query line and the datadir write are one rule, not two.** A change is recorded exactly when
a change was produced, so what reached the disk and what the log says about it cannot drift
apart. Reads write neither, refused reads included: a file that logged every `SELECT` would bury
the two lines worth finding, and a player who could see what everyone read would learn more from
the log than from the database.

**Mutation across the three increments: 57 applied, 57 killed, every control survived.** One real
survivor, caught in the second: the datadir write filed against the WRONG MACHINE — `Query OK`
answered while the change lands on no box at all. Every assertion had pinned the path, the owner,
the writer key and the content, and none had pinned the box. The machine and the path are
asserted together now, against the generator rather than a constant.

**Wire-checks: `testMysqlMutate.ts` 14/14 live**, new for this slice, plus `testMysqlQuery.ts`
17/17 and `testMysqlConnect.ts` 13/13 re-run. The claim only a live run can make is the second
player: a different identity, signing as themselves, reading the change back out of the real
journal — an injected one cannot show it, because the claim is precisely that the row is keyed on
the machine and not on whoever wrote it.

**Both existing scripts moved rather than being deleted.** `testMysqlQuery.ts` asked for its write
refusal as whichever account the box drew, which is a refusal only BELOW the tier that may run the
verb; it asks as the bottom rung now, and after its reads-only log-delta claim rather than before,
since a refused write leaves a line of its own.

---

### Slice 5: A database on a deep layer answers ✔ LANDED (v0.166.0, #442, `29bba64`)

**Value**: The vantage where the interesting boxes actually live.
**Path**: inner-gateway resolution → the mysql door; the hydra sweep is proven, not built.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**RED**: Handler + command tests, then `scripts/testMysqlDeep.ts` live.
**Done when**: criteria met, wire-check green, commit approved.

#### As built — all twelve criteria, three commits, squashed onto `main` as `29bba64`

**1-3, the port stops being a lie** (client only). `-p` is THE PORT everywhere; an own-LAN port
that is not 3306 is `ERROR 2003`, and a malformed `-p` prints usage and reaches nothing rather
than falling back to a door the player never typed.

**4-7, the deep reach** (`api/`). Routing moved INTO `reachMysqlHost`, so one function serves both
vantages and the two doors cannot drift apart by hand — which is also why half of commit 3 turned
out to be already true. The greeting reads `hostname` off the server's answer, the only side that
knows the deep box's own name. `reachMysqlHost` materializes the journal on top of whatever the
resolver handed back; the resolver's own gap stays open, recorded below and in the backlog.

**8-12, the address, the record, and the proofs** (`1752475c`). Criteria 9, 11 and 12 needed no
production change at all — see the section below, and the mutation battery that is their only
evidence. Live at close-out: `testMysqlDeep.ts` 13/13 (run twice), `testMysqlConnect` 13/13,
`testMysqlQuery` 17/17, `testMysqlMutate` 14/14, `testMysqlSweepTrace` 13/13, and
`testInnerGatewayReach` 14/14 — the last proving the shared resolver path left ssh and hydra
undisturbed. `hydra -p <fwd> <gw> mysql` returned a database account off the deep box. 3269 tests,
`tsc -b` and `eslint` clean.

**Still owed, carried forward past D6's fifth slice**: criterion 2 (the `Enter user: ` wording and
the no-default rule, implemented but untested since slice 3), the **42 column-metadata mutants** in
`pools/database.ts` — which want a golden over the generated POPULATION, not one table on one box
— and the deep-terminal-NPC resolver gap, now a backlog item in
`v2/docs/conventions-and-gotchas.md` §9.

#### Grilled 2026-08-21 — twelve criteria, three commits

Grounding first, because half of the stated slice turned out to be already built:

- **The hydra half needs no production code.** `hydraCrackInnerGateway` resolves its service through
  `serviceByName(payload.service)` and reads `accountsOn` / `databaseOn` / `sweepLog` off the catalog
  row — it is service-generic, and `ftp` is already tested through it. `hydra.ts` dispatches on
  `forwardsIntoDeepLayer` with no service in the condition. DECISION: prove it with a handler test
  and a wire-check leg, write no code. If the proof fails, that failure is the RED and the work is
  real.
- **Two orphan criteria are also already true.** See the criteria list above. Slice 5 closes both,
  since a door that reaches no file matters most when it is the only way into a hidden box.
- **Mid-session loss is free.** `sessionsApi.ts` collapses everything that is not a well-formed 200
  into `lost`, so a forward pulled out of `rules.v4` mid-session already renders `ERROR 2013` and
  closes the prompt. A wire-check leg, not a code change.
- **No new sharing exposure.** `hostMachineId` is `host:<essid>:<ip>` — no player key — so own-LAN
  db boxes are ALREADY ESSID-shared and slice 4's writes carry this today. The deep datadir is shared
  the same way and inherits the open shared-file write-wipe backlog item unchanged.
- **The deep layer is worth the climb, measured over 800 networks.** 12.8% of layers run a database
  and 45% of networks hold at least one somewhere in their chains — steady at every depth (12.8 /
  12.8 / 11.3 / 13.1 / 10.7%), so following a chain keeps paying rather than front-loading. DECISION:
  leave generation alone. Also measured: only 1.3% of database-bearing deep boxes are named `db-*`
  (the rest are `mysql-*`, `datastore-*`, `warehouse-*`, `records-*`), so this file's earlier
  "deep-layer `db-*`" phrasing was wrong and is dropped.

**Shape** (DECISION): extend `reachMysqlHost` rather than add vantage modules. Every other door grew
one module per vantage — `authCreateSession` x4, `hydraCrack` x3, `nc.connect` x4 — but the mysql door
is two actions, so the precedent costs TWO twins and makes four handlers that must agree by hand.
`mysqlHost.ts` already exists precisely because "the answers have to agree" between the login and
every statement; routing inside it keeps that by construction. `reached.host` is used for exactly one
thing (`host.hostname`), so the return type collapses to `{hostname, machineId, hostFs, sourceIp}` —
which is the shape `resolveInnerGatewayTarget` already returns. The two resolvers converge on one
type rather than being adapted to each other.

**Commit 1 — the port stops being a lie** (client only, no `api/`, fully CI-provable):

1. `mysql <host>` with no `-p` connects on 3306, unchanged
2. `-p` is THE PORT everywhere, not just on a gateway: `-p 3306 <own-LAN db box>` connects, any
   other port on an own-LAN host is `ERROR 2003 (HY000): Can't connect to MySQL server on
   '<host>:<port>' (Connection refused)`. mysql has no `altPorts`, so on own LAN only 3306 answers
3. `mysql -p abc <host>` and a bare valueless `mysql -p <host>` both print
   `usage: mysql [-p port] <host> [user]` and reach nothing. DELIBERATELY UNLIKE hydra's `parsePort`,
   which falls back to the default door: a flag that silently substitutes a port the player did not
   type is the inert flag again, just quieter

**Commit 2 — the deep reach** (`api/`):

4. `mysql -p <fwd> <inner gateway>` reaches the `mysql>` prompt on the deep box the forward leads to,
   given a database credential
5. The greeting names the deep box's OWN hostname, which only the server can know: `mysqlConnect`
   answers `{ok: true, hostname}` and BOTH paths greet from that field. Own-LAN keeps its local
   lookup only for the pre-flight refusals, the one thing it is still needed for
6. A port with no forward is `No route to host`; a forward to a box with no mysqld is
   `Connection refused` — both AFTER the credential prompt. DECISION: a deep box cannot be
   pre-flighted (forwards live in the gateway's server-side journal), and a probe action would only
   duplicate what `nmap` through the forward already tells the player
7. Reads, the write ladder and every refusal answer identically to own-LAN. Free by construction:
   `runStatement` is pure over `(database, userType)` with nothing vantage-specific in it

**Commit 3 — the address, the record, and the proofs** (`api/`):

8. The address is decided by the ROUTE, not by where the player stands. The 1045 `Access denied`,
   the 1142 denial and the box's own log line all name the fronting gateway's `.1` — the same string
   on both sides, because NAT is all a deep box is ever shown. The server takes
   `reach.sourceIp ?? payload.source_ip`: the route decides when it can, the caller's claim stands
   when it cannot. The `sourceIp: null` case hydra has to keep silent about is UNREACHABLE here —
   routers run only sshd, so a mysql reach that lands on the gateway itself always dies as
   `service_not_running` before anything is written
9. A change to a deep datadir lands on the DEEP box's machine id, and its `Query` / `Denied` line
   lands in that box's `/var/log/mysql.log`. The gateway records nothing — NAT does not log
10. `hydra -p <fwd> <gw> mysql` returns the deep box's DATABASE accounts and traces at the gateway's
    `.1`. Proven, not built
11. A mysql connection reads no file on the target but the datadir, at any tier, through a forward
    exactly as on own LAN
12. A stopped mysqld drops a connected player on their next statement with `ERROR 2013 (HY000): Lost
    connection to MySQL server during query`; pulling the forward mid-session does the same, by the
    same path

#### Found while building commit 3 — criteria 9, 11 and 12 needed no production change

Every one of them was already true when commit 2 landed, and for one reason: routing
was moved into `reachMysqlHost`, so both doors take `machineId`, `hostFs` and
`sourceIp` from whatever the route resolved. The log write, the datadir write and the
per-statement reachability re-check all read those same three fields, so they followed
the route down to the deep box without being told to. The adapter's blanket
`!response.ok -> lost` covered the drop for the same kind of reason.

So commit 3 is PROOF, not behaviour: five tests that go green on arrival. That makes
mutation the only evidence that they are worth anything, and the battery is the record
— 8 real mutants, all killed, both behaviour-preserving controls surviving:

| Mutant | |
|---|---|
| deep `sourceIp` -> `null` | killed |
| deep `machineId` -> the gateway's | killed |
| drop the listening gate | killed |
| accept an unresolved forward | killed |
| `reachedPort` -> default 3306 | killed |
| statement log prefers the payload address | killed |
| connect log prefers the payload address | killed |
| a refused statement is no longer `lost` | killed |

Two things the LIVE run caught that no unit test could:

- **`testMysqlConnect.ts` still asserted the old contract.** Commit 2 made the connect
  answer carry `hostname`; the script asserted the body was exactly `{ok:true}`. It had
  been typechecked and never run since. Updated to the current contract.
- **`testMysqlDeep.ts` seeded its gateway session under a DERIVED id.** `session_id` is
  computed from the gateway, so it is identical every run, while the acting identity is
  fresh each time. Cleaning up by `player_key` alone left the previous run's row holding
  the id and the insert failed on it — surfacing as `403 no_session`, i.e. as the door
  refusing rather than as a dirty table. The first run passed only because the table was
  empty. Now deleted by `session_id` too, and the insert's error is checked rather than
  swallowed.

#### Found while building commit 2 — the terminal deep box's journal is never read

`resolveInnerGatewayTarget` replays each GATEWAY's journal down the chain (to read
`rules.v4`, and to boot-gate every hop), but the box at the END of the chain comes back as
`buildDeepHostFs(...)` — its seeded tree, with no journal replayed and no boot gate. ssh
and hydra never noticed, because seeded accounts are all they read off it.

The database door reads DATA, so it notices immediately: a write would persist to the
journal and the next statement would re-read the seeded base and show the old rows.
Criteria 4, 7 and 9 all fail without a fix.

**DECISION (2026-08-21)**: fix it in the mysql door — `reachMysqlHost` materializes on top
of whatever the resolver returned, which is what it already does for own-LAN, so both
vantages materialize in one function. ssh and hydra keep the behaviour their wire-checks
proved. The resolver's own gap stays open and is now a backlog item:

> **Deep terminal NPC is never materialized or boot-gated.** An account added to a deep
> box's `/etc/passwd` cannot log in, and a deep box bricked through its journal still
> answers. Fixing it in `resolveInnerGatewayTarget` closes it for every door at once, but
> changes ssh and hydra, so it needs `testInnerGatewayReach.ts` re-run live alongside.

**Wire-check** (DECISION): a NEW `scripts/testMysqlDeep.ts`, not an extension of
`testInnerGatewayReach.ts`. That script picks its ESSID by requiring depth >= 2; adding a mysql leg
would make it require a deep mysqld too — a 12.8% roll that moves the fixture under 13 already-passing
ssh and hydra checks. The new script matches the four existing per-capability mysql scripts and leaves
the proven ssh fixture untouched, at the cost of ~60 lines of duplicated gateway seeding.

**Out of scope**: the public-IP and same-LAN vantages, which slice 7 owns and delivers together with
their hydra fan-out. Slice 5 delivers the second of that slice's "four vantages".

---

### Deferred half — after slice 5, and NOT one slice

### Slice 6: A player runs their own database

**Value**: The door becomes symmetric — a player can own the thing others attack.
**Path**: `apt install mysql` → `mysqld` on the player's own box → the door answers from their
own chair.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**RED**: apt + daemon + generator + door tests, all client-side.
**Done when**: criteria met, gates green, commit approved. **No `api/` change**, so gate 5 is
`N/A` — the first slice since slice 1 that CI can prove end to end.

#### Grilled 2026-08-22 — fifteen criteria, three commits

**The database is BOUGHT, not born.** This file said boot-time, on the `/var/www/html/index.html`
precedent. Rejected: that precedent exists so a freshly started web server has something to serve
and the player has a real file to edit, and neither applies to a database nothing on the box can
open yet. Bought instead makes running one a CHOICE WITH A CONSEQUENCE — you installed it, you
started it, you are now a target — which is what "the door becomes symmetric" actually means. It
also agrees with the world: mysql is the rarest catalog row, and a database on a random home box
is meant to read as somebody's mistake.

**One package, two binaries.** `{ name: 'mysql', binaries: ['mysql', 'mysqld'] }`, not a second
`mysql-server` row. The catalog already ships multi-binary packages (`aircrack` three, `snmp`
two), and `packageForBinary('mysqld')` then resolves the not-found hint for free. The one visible
consequence is that after installing, `systemctl status mysqld` answers `inactive (dead)` rather
than not-found — which is what installing a server should do.

**Daemons live in `/usr/sbin`, however they arrive.** apt has exactly one destination today
(`apt.ts:230` writes `/usr/bin/<binary>`), so `nginx` and `apache2` — daemons on any real box —
sit in `/usr/bin`. The package row gains a way to say which of its binaries are daemons and apt
installs those into `/usr/sbin`, fixing all three at once. Nothing functional turns on it
(`binaryExists` searches `/bin`, `/usr/bin` and `/usr/sbin` alike); it is what the player sees
when they list a directory, and afterwards the rule has no exceptions.

**The datadir is per-player, and its root account is the player's own root password.** Drawn
through the same `generateDatabase` the NPC boxes use, seeded from the owner's pubkey, so no two
players hold the same database. A CONSTANT datadir was rejected on one chain: the first player to
crack their own `app` account would hold a credential valid on every database in the game, and
slice 7's sweep would be skippable forever. A wordlist can be a shared constant because knowing
it buys nothing; a password file cannot.

Its `root` is `md5(config.rootPassword)` — the password the player already chose for their own box
— so they reach their own prompt with nothing to look up, print, store or delete. PLAYER BOXES
ONLY; NPC generation is untouched. It costs one thing knowingly: a chosen password is almost never
in the wordlist, so db root on a player box is effectively uncrackable and an attacker will not
reach `DROP TABLE` there. Accepted — the drawn `app` and `readonly` accounts are the attack
surface, cracking them still buys nothing toward the box, and the CVE arc is the route in that
this one is not trying to provide.

**Nothing else is installed.** No `/etc/mysql.cnf`: nothing in the game reads it, `nmap` already
says `3306/tcp open mysql` more reliably, and a static `port=3306` would be contradicted the first
time a player runs `mysqld 3307`, which `parsePort` allows. No `mysql` account in `/etc/passwd`
either — `usernames.ts` draws `mysql` as one of ~13 names for a db box's ORDINARY user, so twelve
NPC db boxes in thirteen already show `ps` owner `mysql` with no such account. Adding one to the
player's box would make it the odd box, not the consistent one.

**Your own box is not the server's business.** Statements against your own database stay on the
CLIENT. The server-side door exists to stop a client writing to a box it does not own; on your own
box there is nothing to protect — you are root and can `nano` the datadir. Every decision is
already a pure shared function (`credentialIn`, `runStatement`, the log formatters), so what
differs between your path and an attacker's is ~40 lines of wiring, not the rules. Addressing
follows the web door verbatim (`webHost.ts:136`): `localhost`, `127.0.0.1` and the player's own
LAN address are ONE leased address, and the source recorded is loopback or that address exactly as
`curl` decides it. The cross-player direction still needs the server — that is slice 7's, and it
is where `reachMysqlHost` learns about player-owned boxes, rather than inventing an own-machine
authorization case here that nothing needs.

**Your own lines are in your own log.** A daemon that recorded strangers but not its owner would
be one that knows which is which. The defender's skill is READING the log — telling `127.0.0.1`
from a stranger's address — and that skill is worth less if the file arrives pre-filtered.

#### Acceptance criteria

*The purchase*

1. `mysqld` on a fresh box is `bash: mysqld: command not found. Install with: apt install mysql`,
   through the existing `packageForBinary` hint, with no new wiring
2. `apt install mysql` puts `mysql` in `/usr/bin` and `mysqld` in `/usr/sbin`; `nginx` and
   `apache2` move to `/usr/sbin` by the same change; every non-daemon package is unmoved, and
   apt's manual text stops claiming binaries go to `/usr/bin`
3. The same install writes `/var/lib/mysql/data.json` root-only (`DATADIR_FILE`), holding a
   database drawn for THIS player — name, tables, rows and accounts seeded from the owner's
   pubkey. Two players differ; one player is stable across installs
4. That database's `root` password is the player's own machine root password; `app` and
   `readonly` are drawn at the world's usual chances. Generated NPC databases stay byte-identical
5. Nothing else is written and nothing is printed: no `/etc/mysql.cnf`, no `mysql` line in
   `/etc/passwd`, no password on stdout

*The daemon*

6. `mysqld` behaves as the other three: root-only, optional `[port]` defaulting to 3306, refused
   when already running, streaming its start before the port opens, and writing
   `/var/run/mysqld.pid` as `mysqld:port=3306`
7. With it up, the box's own `nmap` and `ps` report the door — `3306/tcp open mysql`, owner
   `mysql` — through the existing pidfile readers, with no code added for either
8. `systemctl status|stop|start|restart mysqld` answers as it does for the other units, and a stop
   survives a reboot, because the pidfile is a patch row like every other

*The door, from your own chair*

9. `mysql localhost`, `mysql 127.0.0.1` and `mysql <own LAN address>` all reach the player's own
   database — one leased address, three names
10. With no daemon up, or on a port it is not holding, the answer is `Connection refused` — the
    same sentence a stranger's box gives, decided before any credential is typed
11. The tier ladder is the same on your own box as on anyone else's: `readonly` refused an
    `UPDATE`, `app` performs one, only db root may `DROP TABLE`
12. Root can `cat /var/lib/mysql/data.json` and read the account hashes; no lower tier can — the
    only way to read it directly is to already own the box
13. A connect writes a connect line to the player's own `/var/log/mysql.log`, sourced `127.0.0.1`
    or the LAN address they typed; mutations and denials write theirs; no `SELECT` writes anything
14. The log file does not exist until the first line is written, and arrives root-owned with the
    catalog's permissions — `appendMachineLog` already does this
15. No statement against your own database reaches `api/` beyond the patch write the journal
    already takes

#### Commits

1. **The daemon you can buy** — the apt destination field (`nginx`/`apache2` move too), the
   `mysqld` `Daemon` row, the `systemctl` unit. Criteria 1, 2, 6, 7, 8
2. **The database you bought** — `generateDatabase` seeded from identity, written at install.
   Criteria 3, 4, 5, 12
3. **The door from your own chair** — own-box addressing, the client-side statement path, the log.
   Criteria 9, 10, 11, 13, 14, 15

**Out of scope**: NPC boxes carrying the daemons they run, so a rooted box's doors can be closed —
`systemctl stop nginx` already fails there today, for the same reason `mysqld` would, and `kill`
cannot substitute because it refuses unit names and only removes listener pidfiles. Its own slice,
immediately after this one, because it is a world-generation change wanting evidence about
generated hosts rather than about the player's machine. Cross-player reach is slice 7's, and needs
no server change to SEE this database: the datadir is a patch, so the server's existing journal
replay already materializes it.

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
