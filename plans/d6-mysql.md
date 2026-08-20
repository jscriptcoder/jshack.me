# Plan: D6 — a player reads a machine's database (`mysql`)

**Branch**: one `feat/d6-*` per slice — slice 3 is `feat/d6-mysql-prompt`
**Status**: Active — slices 1 and 2 LANDED (v0.158.0 #434 `29bc042`; v0.159.0 #437 `a6bdead`),
slice 1's mutation debt PAID (#435 `f1c4dd6`, #436 `8add9fa`). **Slice 3 IN PROGRESS** on
`feat/d6-mysql-prompt` — criteria grilled to 21 (`32ef71b`), criteria 3, 4, 5 and 20 landed
(`71aecb0`, `aad87b6` + the working tree). The door opens end to end; it is not yet registered.
Progress and what is written-but-untested are under slice 3's own heading.

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

### Slice 3: A player reads a database

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

**Next**: criterion 6 — the two-line greeting and the `mysql>` prompt, which is where
`registry.ts` registration lands and where the command first becomes typeable. The door opens end to
end now, so registering it no longer ships something that cannot work. That increment is also the
first player-visible change in this slice, so it carries the version bump.

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
