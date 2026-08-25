# Plan: D7 — a player reads (and rewrites) a machine's key-value store (`rediscli`)

**Branch**: `docs/plan-d7-redis` (this plan) → `feat/d7-*` per slice
**Status**: Active — **slices 1–3 SHIPPED (v0.174.0 #452, v0.175.0 #453, v0.176.0 #454)**;
**slice 4 BUILT, criteria approved 2026-08-25** on `feat/d7-redis-write-store`

> Decisions are LOCKED in [`legacy-parity-epic.md`](legacy-parity-epic.md) §"D7 — resolved scope &
> decisions (grill-me, 2026-08-24)". This file sequences them; it does not re-open them. Where
> grounding during planning changed how a decision lands, it is called out as **PLANNING
> CORRECTION** with the reason.

## Goal

A generated `www-07` stops being a page with nothing behind it and becomes a box holding the
sessions that page issued — a store a player can find, read without asking, crack when it is
locked, rewrite, and be caught rewriting.

## Acceptance Criteria (the row's, across all slices)

- [ ] `nmap` a LAN and a store box reports `6379/tcp open redis`; `nc <host> 6379` answers with the
      daemon's own error line
- [ ] A box running `redis` holds a real generated store at `/var/lib/redis/data.json` and an
      `/etc/redis/redis.conf` naming it; a box that is not running one holds neither
- [ ] `rediscli <host>` against the 4-in-10 that are open reaches `redis> ` with no credential, and
      `KEYS *` / `GET` return the box's own sessions, caches and permissions
- [ ] `hydra <host> redis` returns a password with **no login field**, and answers *no password set
      (open access)* against an open store
- [ ] `NOAUTH Authentication required.` refuses every statement on a locked store before `AUTH`
- [ ] `SET` and `DEL` succeed for anyone who reaches an open store, and append to
      `/var/log/redis.log`; `GET`, `KEYS` and `DBSIZE` never append
- [ ] A redis connection reads no file on the target other than the datadir
- [ ] `systemctl stop redis` / `kill <pid>` drops a connected player on their next statement
- [ ] A player's own store carries their box's root password, and a second player reaching it
      across the wire must crack that to get in

## Slices

**Slice 1 is the only slice that can be proven without bringing the stack up.** Slices 2–5 and 7
touch `api/` and each needs a `scripts/test*.ts` wire-check against `vercel dev` + supabase before
it counts — `tsc` cannot see DB columns or constraints.

---

### Slice 1: A box runs a key-value store — SHIPPED v0.174.0 (#452)

**As built.** All 13 criteria met; 3438 tests, typecheck and lint green. What the slice
learned, beyond what was planned:

- **The `/var/lib` collision was real and was caught by criterion 5.** Composed as two
  spreads the second `lib` replaces the first, so a box running both daemons keeps only
  one datadir — about a quarter of every `db-` box would have lost the database it held
  the day before, silently.
- **The conf follows the SERVICE**, planted under `servesRedis` beside the datadir and the
  log. First `/etc` file in v2 to do so, and the first nested directory under `/etc` on a
  generated box.
- **Both open questions closed the way mysql already answered them.** Three placement
  cells, not five — the `workstation` number IS the flat rate, and every other cell in the
  table differs from its flat rate. And `configDb` draws its username from
  `MYSQL_USERNAMES`, because `generateDatabase` already keeps real people in content and
  every secret in a separate namespace. Checked against all sixteen generators: `configDb`
  was the only one that crossed that line.
- **Two test defects, both found before production was wrong.** A lock-rate claim measured
  over one network read 0.476 against a 0.6 setting and prompted a production reorder that
  measurement then showed changed nothing (0.582 vs 0.573 across eight networks) — reverted,
  and the test now samples the width its claim needs. And a substring check for "a real name
  paired with a secret" flagged boxes whose unix account is literally `mysql`, because every
  connection URL begins `mysql://`.
- **`generateRedisStore` costs 0.22ms against `generateDatabase`'s 0.19ms**; a fifth door
  makes whole-host generation ~11% slower (134.3ms vs 120.6ms per 253 hosts).
- **Mutation: 131/316 killed**, four real gaps closed (ten unrendered month names, the
  conf's `bind`/`daemonize`/`join`, and `parseRedisStore`'s uncovered catch), two equivalent
  mutants left, two speculative exports deleted rather than tested. The score understates
  the tests: see the two tooling traps now recorded in `conventions-and-gotchas.md` §4.

**Value**: A player scanning a LAN, or standing on a box they have taken, can tell it holds a
key-value store and find it where the box's own config says it is.
**Path**: `nmap <subnet>` / `nc <host> 6379` / `ssh` + `cat /etc/redis/redis.conf` → the generated
per-host filesystem (`buildRemoteHostFs`) → `/var/run/redis.pid` + `/etc/redis/redis.conf` +
`/var/lib/redis/data.json` + empty `/var/log/redis.log` → read back by the existing pidfile and
filesystem readers, which need no changes.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A` (net-additive slice, no mechanism retired).
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present to human before any code):

1. A `SERVICE_CATALOG.redis` row exists — `service: 'redis'`, `pidfile: 'redis.pid'`,
   `defaultPort: 6379`, `runUser: 'redis'`, `banner: '-ERR unknown command'`, `placement: 0.05`,
   `altPorts: []` — and `nmap` reports `6379/tcp open redis` on a host that draws it, with no change
   to `nmap`, `ps`, `readOpenPorts` or `systemctl`.
2. Across a population sweep: `webserver` hosts run redis most often, `database` hosts close behind,
   every other role at the flat rate, and **`iot` hosts never**.
3. A host running redis holds `/var/lib/redis/data.json` parsing as a store of 8–15 keys whose
   values are the shapes legacy generated (sessions, user caches, permissions, counters, locks).
4. A host **not** running redis holds **no `/var/lib/redis` directory at all** — the rule
   `/var/www` and `/var/lib/mysql` both follow.
5. **A host running both mysql and redis holds BOTH datadirs**, each parsing as its own thing.
6. The store file is **root-read-only** (`read: ['root']`) and is **not** on the
   externally-observable allowlist, so no no-session reader can see it.
7. `/etc/redis/redis.conf` exists on **every** host running redis whatever its role, is
   guest-readable, names the host it sits on, and states `port 6379`, `dir /var/lib/redis`,
   `logfile /var/log/redis.log`, `pidfile /var/run/redis.pid`, `bind` and `daemonize` — and
   contains **no `requirepass` line on any box in the world**.
8. A host not running redis holds **no `/etc/redis`**.
9. `/var/log/redis.log` exists empty on a host running redis and is absent otherwise — the rule
   `access.log`, `vsftpd.log` and `mysql.log` already follow.
10. Around 6 stores in 10 carry a `requirepassHash` that is an md5 of a drawn password; the rest
    carry none. Both cases are reachable in a population sweep.
11. The store's keys name the box's **real** non-guest accounts — the `root` and uid-1000 rows of
    its own `/etc/passwd` — and never `guest`; and **no generated value pairs one of those names with
    a secret**, on any box in the world.
12. **Every existing generation golden holds**: no NPC octet, port, account name, password,
    machine_id, served page, `/etc` config or **mysql database** moves anywhere in the world.
13. `nc <host> 6379` prints the banner, and a generated redis box carries `/usr/sbin/redis` so
    `systemctl stop redis` shuts the door.

**PLANNING CORRECTIONS to record with these criteria:**

- **`/var/lib` must be composed once, not spread twice — the sharpest trap in this slice.**
  `buildRemoteHostFs` builds `var: dir({ log, run, ...datadir, ...webRoot })`, where `datadir` is
  the object `{ lib: dir({ mysql: … }) }`. A second conditional spreading its own `lib` key
  **overwrites** the first: last spread wins. The boxes that run both are not rare — `database`
  rolls mysql 0.9 × redis 0.3, `webserver` rolls mysql 0.2 × redis 0.35 — so roughly **a quarter of
  every database box in the world would silently lose its mysql database**, breaking D6 on boxes
  that had it yesterday. Criterion 5 is what catches it. **Legacy hit this exact bug and worked
  around it by mutating an existing `lib` node in place** (`machineConfig.ts:435-451`); v2 composes
  the two entries into one `lib` immutably instead.
- **The conf follows the SERVICE, not the role — unlike `mysql.cnf`.** `roleConfigFile` hands a box
  **one** `/etc` file keyed by `CONFIG_BY_ROLE[role]`, which is why a webserver running mysql at 0.2
  carries no `mysql.cnf` at all. Redis's **largest** placement cell is `webserver: 0.35`, and that
  role's config slot is already spoken for by `httpd.conf` — so routing redis's conf through
  `CONFIG_BY_ROLE` would leave most redis boxes with no conf, contradicting the epic's own forced
  item that `/var/lib/redis/` and `/var/log/redis.log` *are named by the conf the box publishes*.
  It is therefore planted in `buildRemoteHostFs` under `servesRedis`, beside the datadir and the
  log. **This is the first `/etc` file in v2 that follows a service**, and the first nested
  directory under `/etc` on a generated box; a `database` box running both correctly carries
  `/etc/mysql.cnf` **and** `/etc/redis/redis.conf`.
- **The store's seed stream is its own** — `redis-store-${essid}-${host.ip}`, exactly as
  `mysql-db-`, `web-page-`, `etc-config-` and `backdoor-` each take theirs. This closes the epic's
  open question with the house answer: appending these draws to the host-fs sequence would move the
  octets the lease allocator excludes and put an occupant on top of an NPC. Criterion 12 is the
  tripwire.
- **The `requirepass` draw belongs in THIS slice, not slice 3.** Whether a store is locked is a
  generation fact, and drawing it later would re-roll every value picked after it in the store's
  stream. Slice 3 lands only the `secretOn` column that *reads* the hash this slice writes.
- **RESOLVED — the `workstation` cell is not written.** Three cells land: `webserver: 0.35`,
  `database: 0.3`, `iot: 0`. The locked `0.05` for workstations arrives through the catalog's flat
  rate, which is also `0.05`, so `placementOf` returns decision 7's number exactly either way.
  **mysql writes a workstation cell because it has something to say** — `0.03` against a flat `0.08`,
  with the reason on the row: the flat rate *"would put one on a twelfth of all laptops"*. Redis has
  no such correction to make. All nine cells in the table today differ from their flat rate, so a
  redis workstation cell would be the first that changes nothing — and `rolePlacement`'s own contract
  is that a role names only the services it has something to say about. The comment on that same row
  settles the pin-it-for-later argument too: workstation is *"the world's default sort of box: it is
  what the flat rates were tuned against"*, so the flat rate already IS the workstation rate.
- **Legacy's conf carries `requirepass` and names no host; v2's does the opposite.** The
  `requirepass` line is dropped (decision 5), and a `# {{hostname}}` header is added, because every
  config template in `configFiles.ts` names the box it sits on and a guest-readable file that could
  not be told from any other box's is recon worth nothing.
- **RESOLVED — `configDb` draws its username from `MYSQL_USERNAMES`, the way mysql already does.**
  Legacy draws it from the box's own accounts and attaches a password:
  `mysql://<real-user>:s3cret!@localhost:3306/app_prod`. That crosses a line `generateDatabase`
  draws deliberately: the box's REAL uid-1000 account leads the `users` table as **content**, while
  every secret-bearing row is drawn from a separate namespace — `'root'` plus `MYSQL_USERNAMES`
  (`app_user`, `webapp`, `service`, `api_svc`…), whose pool comment states the rule outright:
  *"never a system account, which is the whole point of the door: `/etc/passwd` cannot answer who
  you are to a database."* **A real person's name never carries a secret.** Drawing `configDb`'s
  username from that same pool keeps the value a believable mysql URL while making it a name no
  `ssh` can be pointed at — and `MYSQL_USERNAMES` is the right pool by construction, because the
  value IS a mysql connection string. It is a shared vocabulary, not a shared draw, so no stream
  moves.
- **`configDb` is the ONLY generator that crosses that line — the other fifteen port as-is.**
  `config:smtp`, `config:ldap`, `config:s3`, `api:key` and `webhook:*` carry secrets but name only
  service identities that exist nowhere in the world, so nothing can be tried against them.
  `sess:*`, `cache:user:*`, `perms:*`, `token:reset:*` and `lock:*` name the box's real people but
  attach no secret at all — which is decision 12's disclosure feature working exactly as intended.
- **`corp.local` becomes the box's own name.** Legacy hardcodes `@corp.local`, `auth.corp.local` and
  `dc=corp,dc=local`. D6 met this and answered it: `config.site_name` is the **hostname**, because
  every generated page is titled `{{hostname}}` and no company identity exists anywhere in v2. The
  same substitution closes the epic's open question about how a webserver's store reaches the site
  it serves — both generators already seed off the same host, so the store agrees with the page by
  construction and the two generators stay uncoupled.
- **`hostServices` iterates `Object.values(SERVICE_CATALOG)`**, so the row alone makes every machine
  in the world roll for redis. The placement cells are not decoration — without them criterion 2
  fails on the day the row lands.
- **The package rename touches one existing assertion**: `availability.test.ts:295` asserts
  `['rediscli', 'redis-tools']`, and `packageForBinary` feeds the player-visible install hint.
- **Knowingly accepted until slice 6**: `daemons: ['redis']` is what puts `/usr/sbin/redis` on a
  generated box (criterion 13, the rule slice 6b shipped), and it also makes `apt install redis` +
  `systemctl start redis` work on the player's OWN box before that box has any store. Unlike mysql —
  whose `daemons` and `extraFiles` landed together — redis is briefly a daemon with nothing behind
  it. This is honest rather than broken: a freshly installed redis holds zero keys, no door exists
  to connect with until slice 2, and slice 6 is where the player's own store arrives.

**RED**: Behavior tests, before any production change:
- `remoteHostFs.test.ts` — a host seeded to run redis holds a parseable store at the datadir whose
  keys name the host's own accounts; a host that does not run it holds no `/var/lib/redis`, no
  `/etc/redis` and no `redis.log`; the store file refuses a `guest` and a `user` read; **a host
  running both daemons holds both datadirs** (criterion 5, the collision test).
- The conf: present on a redis host of a role whose config slot belongs to another daemon (a
  `webserver`, deliberately), guest-readable, naming its own host, and carrying **no** `requirepass`
  on any box swept.
- A population sweep (the shape D5b established — sweep a population once per block, never sample
  two hosts) asserting the ordering in criterion 2 with `iot` at exactly zero, and the ~60/40 split
  in criterion 10.
- `serviceCatalog`/`nmap` level: a host with the redis pidfile reports `6379/tcp open redis`.
- A generator-stability test proving criterion 12 — the existing goldens are the oracle, and the
  mysql datadir is now one of them.

**GREEN**: The catalog row; three cells in `PLACEMENT_BY_ROLE` (`webserver`, `database`, `iot` — no
`workstation` cell); `RedisStore` + `parseRedisStore` in
`core/redis/types.ts` (a zod schema at the trust boundary, exactly as `parseMysqlDatabase` — the
file is root-owned, and root on a box is a tier a player reaches); `generateRedisStore` +
`pools/redis.ts` ported into `core/generation/`, with the corrections above; the conditional conf,
datadir and empty log in `buildRemoteHostFs`, with `/var/lib` composed from both datadir
conditionals; the package row renamed to `redis` with `binaries: ['rediscli', 'redis']` and
`daemons: ['redis']`.

**MUTATE**: Run Stryker over the new generation code. Expect the D5b lesson to bite: an entry no
test ever DRAWS can be blanked without anything failing, so the population sweep must be computed
**once per block**, not per assertion, or timeouts convert survivors into false kills.
**KILL MUTANTS**: Address survivors; ask when a survivor's value is ambiguous.
**REFACTOR**: Assess whether the now-five conditional stanzas in `buildRemoteHostFs` (web root,
access log, vsftpd log, mysql datadir + log, redis conf + datadir + log) want collapsing — **only
if** it adds value. D6 asked the same question at four and left them literal; the `/var/lib`
composition is the one place where a shared helper is load-bearing rather than tidy.
**Version**: bump `0.173.0` → `0.174.0` in `v2/package.json` + `v2/package-lock.json`.
**Done when**: criteria 1–13 met, mutation report presented, human approves the commit.

---

### Slice 2: A player opens an unlocked store — SHIPPED v0.175.0 (#453)

**As built.** All 14 criteria met; 3523 tests, typecheck and lint green, wire-check 12/12
live. What the slice learned, beyond what was planned:

- **The shared reach was one line from being two files.** `reachMysqlHost` turned out to be
  347 lines of vantage resolution with exactly ONE naming a service, so the rename to
  `reachServiceHost` was a parameter rather than an extraction — landed first, green on the
  same 80 mysql tests before and after, and merged as its own commit so a regression in the
  reach stays attributable to the rename rather than to the new door.
- **Twelve production sites already share the listening predicate**, with differing checks —
  some port-only, some port+service. Collapsing them would prevent the port-without-service
  bug family D6 shipped once, but it is a repo-wide sweep and NOT this slice's; the REFACTOR
  step was assessed and deliberately applied nothing. `ownBoxSource` crossing doors from
  `mysqlOwnBox.ts` was left for the same reason — slice 6 gives it a real forcing function.
- **The NOAUTH wall stands without a door until slice 3, knowingly.** A player who finds one
  of the 6-in-10 locked stores reads `NOAUTH Authentication required.` and is told
  `unknown command 'AUTH'` if they act on it. Honest — there is no way in yet — but it reads
  as broken, and it is the one thing in this slice a player could mistake for a defect.
- **Two pieces of machinery were deleted rather than tested**: the tokenizer's quoted-run
  handling, which no verb in this slice uses and which belongs with `SET`, and a `trim()` the
  filter already made redundant.
- **The glob escape was a live crash in legacy.** `KEYS ?` compiles to `/^?$/` — "Nothing to
  repeat" — so a player could take the daemon down by typing a question mark. v2 escapes `?`
  as a literal and has the test that proves it.
- **Mutation: 299/343 (87.2%)** across three rounds from 76.1%. Real gaps closed: the
  `exit`/`quit` regex unanchored at BOTH ends, the glob escape untested against `.`, three
  untouched preflight branches, and neither handler refusing a malformed signed payload.
- **A second mis-scoring family found.** `rediscli.ts:99` reported Survived; hand-applying
  that mutant took two tests in the same file red. Their fixtures are built at module scope,
  so `perTest` attributes no test to the mutant and never runs the ones that kill it.
  Recorded in `conventions-and-gotchas.md` §4 — hand-applying a suspicious survivor is now
  the cheapest first step in triage.

**Value**: The walking skeleton, and the 4-in-10 case where the FIND is the whole play with no crack
in between. A player who scanned a box in slice 1 and read the conf naming its datadir can now stand
at that datadir's own prompt and read what it holds, with no credential at all.
**Path**: `rediscli <host>` → the signed `redisConnect` round-trip → the four-vantage reach → the
target's REAL `/var/lib/redis/data.json` (journal replayed over the seeded base) → `redis> ` → one
`redisStatement` round-trip per line → one arrival line in the target's `/var/log/redis.log`.
**Class**: Behavior change, carrying one behavior-preserving refactor as its first commit.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A`: the refactor below avoids a duplicate rather than retiring a
mechanism, so there is no net-reduction claim to make.
**Reduction program**: `N/A`. **Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present to human before any code):

1. `rediscli <host>` against a box running redis prints `Connecting to <ip>:6379...`, then
   `Connected to Redis <hostname>.`, and leaves the terminal at `redis> `. The shell behind it has
   not moved — cwd, tier and host are what they were, and `QUIT` hands it straight back.
2. While the prompt is held, **every** typed line is answered by the redis sub-shell rather than the
   command registry: `ls`, `cat /etc/passwd` and `rm -rf /` at `redis> ` answer
   `(error) ERR unknown command '<word>'` and read nothing on the box the player is standing on.
3. `KEYS *` lists the store's keys as `1) "<key>"` numbered from one; `KEYS <glob>` filters by the
   glob; a pattern matching nothing answers `(empty list or set)`.
4. `GET <key>` answers `"<value>"` for a key the store holds, `(nil)` for one it does not, and
   `(error) ERR wrong number of arguments for 'get' command` for a bare `GET`.
5. `DBSIZE` answers `(integer) <n>`, and `<n>` is the count `KEYS *` just listed.
6. `QUIT` and `EXIT` in any case leave the prompt and print nothing; a bare Enter answers nothing and
   holds it. Neither costs a round-trip, so leaving still works with the box already gone.
7. On a **locked** store — the 6 in 10 slice 1 generates — the connection opens and greets exactly as
   an open one does, and then `KEYS`, `GET` and `DBSIZE` each answer
   `(error) NOAUTH Authentication required.` Not one key, value or count crosses the wire.
8. **One** arrival line lands on the TARGET per connection —
   `<pid>:M <DD Mon YYYY HH:MM:SS.000> * Client connected from <ip>` — appended to what
   `/var/log/redis.log` already held rather than replacing it, under the target's own writer key,
   root-owned and readable by `root`, `user` and `guest`.
9. **Reads write nothing else.** A session of `KEYS`/`GET`/`DBSIZE`, an unknown command and a NOAUTH
   refusal leave the target byte-identical to how the connection found it: no second log line, no
   datadir patch, no row anywhere.
10. **No `sessions` row is created**, at any tier, and `subShellPrompt()` answers `redis> ` while the
    connection is held — the third rung, with `mysql>` and `ftp>` unchanged.
11. A target whose daemon is stopped mid-session drops the player on their NEXT statement with
    `Error: Server closed the connection`, closing the prompt and printing no farewell.
12. `rediscli` with no argument answers `usage: rediscli <host>`; a host running no redis, an address
    on no LAN, and the player's own box (which holds no store until slice 6) each answer
    `Could not connect to Redis at <ip>:6379: Connection refused`.
13. **Both redis type ghosts are gone** — `SessionKind`'s `'redis'` and `ModeChange`'s
    `{ kind: 'redis' }` overlay — and with them the `state.ts` narrow that existed only to keep the
    overlay out of the screen path. `man rediscli` and `help` list the command.
14. A `scripts/testRedisConnect.ts` **wire-check** runs green against live `vercel dev` + supabase.

**PLANNING CORRECTIONS to record with these criteria:**

- **`reachMysqlHost` is generalized, not copied — and that is the slice's FIRST commit.** All four
  vantages, the boot gate, the journal replay and the pidfile check are 347 lines in
  `sessions/mysqlHost.ts`, of which **exactly one** names a service: line 225's
  `open.service === SERVICE_CATALOG.mysql.service`. So the service becomes a parameter and the
  module is renamed to what it has actually been since D6 — `reachServiceHost` in
  `sessions/serviceHost.ts`, with `MysqlHostLookup` / `ReachedMysqlHost` / `MysqlHostReach`
  following. It lands as a pure behavior-preserving refactor with the existing
  `mysqlConnect.test.ts` (1220 lines) and `mysqlStatement.test.ts` (1283 lines) as the preservation
  baseline, committed green BEFORE any redis code, so a regression in the shared reach is
  attributable to the rename rather than to the new door. **Slice 5 is why this is not optional**:
  the deep-layer seeded-tree trap lives in this file, §9 records it as "the resolver's to close for
  every door at once", and two copies means fixing it twice — or fixing it once and leaving one
  door broken.
- **The NOAUTH guard ships HERE, though `AUTH` ships in slice 3.** The slice is named for the open
  store, but the same handler reads the datadir of a locked one, and shipping reads that answer a
  locked store with no credential would leave 60% of the world's stores wide open for the life of a
  slice — the exact vacuous-authorization family decision 12 names D6 as having shipped in ITS slice
  2. The guard belongs where the datadir is read, which is here; the way PAST it — `AUTH`, the
  `[password]` positional, `secretOn`, `hydra`, the attempt lines — is slice 3's whole subject.
  Between the two slices a locked store connects, greets, and refuses every statement, which is
  precisely what the real client does against a store whose password you do not have.
- **`rediscli` takes no positional password in this slice.** Decision 9 locks
  `rediscli <host> [password]`, but that argument exists only to pre-send an `AUTH` that does not
  exist yet, and a command that accepts a word and silently ignores it is worse than one that does
  not accept it. `USAGE` and `man` say `rediscli <host>` here, and gain the second argument in
  slice 3 alongside the verb that gives it meaning.
- **`help` answers at `redis> `, though it is not one of the seven verbs.** `mysql>` lists its verbs
  and wrote down why: a player told a verb is unsupported "goes hunting for a syntax they already
  have". That applies harder here, where the surface is seven words and the real client's vocabulary
  is hundreds. It is the SUB-SHELL's word rather than the store's — answered before the verb table
  and never sent, exactly as `mysql>`'s is — so decision 9's seven stay seven.
- **Leaving prints nothing, unlike `mysql>`'s `Bye`.** Legacy returns empty output for `QUIT`, and
  the real client says nothing either. The feedback is the prompt itself changing back; inventing a
  farewell this tool does not have would be the door imitating the wrong neighbour.
- **The greeting does not say whether the store is locked.** Legacy banners `NOAUTH` at connect time;
  v2 does not, because the real client does not, and because a greeting that announced the lock
  state would hand a scanner the answer without a single statement typed. Finding out costs one
  line — and from slice 3, `hydra` is the tool whose job is to answer it up front.
- **The two new actions land in `api/sessions.ts`, never a new `api/` file.** Every `*.ts` under
  `api/` is a published Vercel function, so `api/redis.ts` would publish an endpoint the game never
  calls. The dispatcher already routes on `actionOf(req.body)`; `redisConnect` and `redisStatement`
  are two more branches beside `mysqlConnect` and `mysqlStatement`, wired with the same
  supabase-backed deps.
- **The statement door writes NOTHING in this slice, and a test says so.** Criterion 9 is not
  housekeeping: slice 4 is where `SET` and `DEL` arrive, and the rule that separates them —
  "mutations append, reads never" (decision 10, and D6 slice 4's rule) — can only be proven to hold
  by a test that existed before the first write landed. `handleMysqlStatement` records the same
  thing about itself: what used to be structural is now a rule, "which is why there are tests
  standing on it".
- **The own box needs no path yet.** `mysql` routes its own box entirely client-side because the
  player's machine has a real filesystem this client holds. Before slice 6 the player's box has no
  store, so `rediscli 127.0.0.1` finds no `redis.pid` in its own tree and is refused by the
  preflight — honest, free, and exactly what criterion 12 asserts. Slice 6 is where the own-box
  conversation arrives, alongside the mirrored root hash.

**RED** — behavior tests, before any production change:

- **The refactor's baseline first**: the two existing mysql handler suites run green, are renamed
  through, and run green again. No new test is written for the rename, and none should be —
  asserting the shape of a parameter is not a behavior claim.
- `rediscli.test.ts` — the connect line, the greeting, the prompt handed over, the shell that did
  not move, and each refusal in criterion 12 (no host argument, no daemon, no route, own box).
- `redisShell.test.ts` — the sub-shell's own answers: `QUIT` / `EXIT` in both cases, a bare Enter,
  `help`, and the registry refusal of criterion 2 (an outer `cat` at `redis> `).
- `core/redis/statements.test.ts` — the verb table against a store built from the real
  `redisStoreSchema`: `KEYS` with and without a glob, the empty-match answer, `GET` hit / miss /
  bare, `DBSIZE` agreeing with `KEYS`, and the unknown-command error naming the word as typed.
- `sessions/redisConnect.test.ts` — the four vantages reached, the arrival line's content, owner and
  permissions, that it APPENDS rather than replaces, and that no session row is minted.
- `sessions/redisStatement.test.ts` — NOAUTH on a locked store for every verb; the answered shape on
  an open one; the stopped daemon becoming `lost`; and **the write-nothing test**: a session of reads
  hands the fake `upsertPatch` exactly zero rows.
- `state.test.ts` — `subShellPrompt()` returns `redis> ` while held, and the typed line routes to the
  redis shell rather than to the registry or the ftp map.

**GREEN**: `sessions/serviceHost.ts` (the renamed, service-parameterized reach);
`core/redis/statements.ts` (legacy's 59-line parser and 68-line executor ported into one module —
reads only, NOAUTH included, `SET` / `DEL` deliberately absent until slice 4);
`sessions/redisConnect.ts` + `sessions/redisStatement.ts`; two branches in `api/sessions.ts`;
the client pair in `adapters/sessionsApi.ts`; `RedisApi` in `commands/types.ts` with both ghosts
deleted; the signal, `REDIS_PROMPT` and the third `subShellPrompt()` rung in `state.ts`;
`commands/rediscli.ts` + `commands/redisShell.ts`; the registry row.

**MUTATE**: Stryker over `core/redis/statements.ts`, `sessions/redisConnect.ts`,
`sessions/redisStatement.ts` and `commands/rediscli.ts`. Use the scoped-runner recipe in
`conventions-and-gotchas.md` §4 rather than a whole-repo run, and expect the load-throw trap the same
section records: a mutant that throws while a NEIGHBOURING describe block builds its population is
scored SURVIVED though the suite is red, so the new blocks stay lazy.
**KILL MUTANTS**: Address survivors; ask when a survivor's value is ambiguous.
**REFACTOR**: Two candidates, both to be assessed only if they earn it. `ownDaemonListening` in
`mysqlOwnBox.ts` hardcodes mysql's service in three lines, and `rediscli`'s preflight wants the same
question asked about redis — a shared `daemonListening(fs, port, service)` may be worth extracting,
or may be two lines each door keeps. And `mysqlShell.ts` and `redisShell.ts` will share the
"leave and help ahead of the verb table" shape; D6 asked the same question of `ftpShell` and left
them separate.
**Wire-check** (`scripts/testRedisConnect.ts`), for what only a live stack can prove: that the two
new actions are DISPATCHED at all; that the arrival line lands at the target's `/var/log/redis.log`
with its owner and permissions accepted by the real `patches` table; that **no** row appears in
`sessions`; that a store edited THROUGH `patches` reads back through the statement door, so the
journal is really replayed; and that a locked store's NOAUTH refusal is what crosses the wire rather
than a body carrying keys.
**Version**: bump `0.174.0` → `0.175.0` in `v2/package.json` + `v2/package-lock.json`.
**Done when**: criteria 1–14 met, wire-check green, mutation report presented, human approves the
commit.

### Slice 3: A player cracks a locked store — SHIPPED v0.176.0 (#454)

**As built.** All 13 criteria met; 3572 tests, typecheck and lint green, both wire-checks
green live against the FINAL tree (18/18 and 10/10). What the slice learned, beyond what
was planned:

- **`AUTH` took any number of words, and mutation is what said so.** The door split on
  whitespace and read the first token, so `AUTH secret typo` authenticated — while the
  prompt's pattern was anchored at both ends and refused to hold a password off a line with
  a tail. One extra word got a player in for exactly one statement and locked them out on
  the next, with nothing on screen to explain it. `AUTH` now takes exactly one word, fixed
  RED-first; the client's trailing anchor came off with it, because against a strict server
  that anchor is not redundant but the fragile half — it would re-create the bug the day the
  server loosened.
- **`hydra <host> <unknown-service>` threw before it sent anything.** An `OptionalChaining`
  survivor showed that nothing exercised the catalog lookup deciding how to describe a door,
  and a service name is player input. The refusal has a test standing on it now.
- **Both defects were disagreements between two SIDES of one rule** — the door's parser
  against the prompt's pattern, the catalog against a client lookup — and neither side was
  wrong on its own, which is why no unit test could see either. Slice 4 adds a second such
  pair: `SET` and `DEL` need client and server to agree on what a typed line means.
- **`secretOn` survived an attempt to collapse it — mine.** Passing the secret as a nameless
  `SweepableAccount` would have deleted the column and read as tidier. It is the column's
  PRESENCE that criterion 4 stands on: a static, client-readable fact that this door has no
  accounts, which is how `hydra` stops printing *Enumerating accounts* at a store.
- **Mutation 85.7%, up from 83.9% on the first run.** Five survivors hand-verified as
  genuinely equivalent (a log formatter ignoring the field it is handed, twice; a junk entry
  in the secret spread; two conditional spreads whose explicit `undefined` JSON drops
  anyway), and one more was the load-throw family §4 already records — hand-applying it took
  the file red with "no tests".
- **Evidence had to be re-run, because production moved after it.** The arity fix and the
  anchor removal both landed AFTER the first live pass, so both wire-checks were run again
  rather than cited from before the change.
- **REFACTOR assessed and applied nothing, as the plan predicted.** The three sweep handlers
  now run four consecutive identical guards; collapsing them is the same repo-wide sweep
  slice 2 named and left, not a redis slice's.

**Value**: The 6-in-10 that are shut become openable, by the tool that opens every other door — and
the wall slice 2 put in front of them gains its way through. A player who reached `redis> ` and was
told `NOAUTH Authentication required.` can now go and get the password, and spend it.
**Path**: `hydra <host> redis` → the sweep handler → the target's `requirepassHash` → a password with
no login → `rediscli <host> [password]`, or `AUTH <password>` at the prompt → one `redisStatement`
round-trip per line, now carrying it → attempt lines in the target's `/var/log/redis.log`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A`: this slice adds a verb and a column and retires nothing, so
there is no net-reduction claim to make.
**Reduction program**: `N/A`. **Transition/terminal evidence**: `N/A`.

**Already shipped by slice 2, not re-litigated here**: the `NOAUTH Authentication required.` refusal
itself. It landed with the statement door because leaving locked stores readable for the life of a
slice was the vacuous-authorization bug D6 shipped in its own slice 2. Slice 3 owns the way PAST it,
not the wall.

**Acceptance criteria** (present to human before any code):

1. `hydra <host> redis` against a locked store whose password is in the caller's wordlist prints
   `[6379][redis] host: <ip>   password: <password>` — with **no `login:` field at all** — and
   `1 valid password(s) found`. The password it prints is the one `AUTH` then accepts.
2. A locked store whose password was drawn from the uncrackable pool answers
   `0 valid passwords found — nothing in your wordlist matched`. Membership in the file is still the
   only thing that decides it: roughly 3 in 10 locked stores hold until their password is harvested
   by hand and appended.
3. `hydra <host> redis` against an OPEN store — or against a running daemon with no datadir at all —
   answers `hydra: that store has no password set (open access) — connect with rediscli`, and leaves
   the target's log exactly as it found it. A box with no redis still answers `no such service on
   that host — scan it first with nmap`, so "open" and "absent" stay distinguishable.
4. A door with no logins is not described as though it had them. `hydra <host> redis` prints
   `This service has no logins — attacking the store's own password` where the other doors print
   `Enumerating accounts from the target...`, and `hydra <host> redis root` prints that same line and
   sweeps the store's secret anyway instead of reporting a store that held.
5. Every password tried lands on the TARGET as one `/var/log/redis.log` line —
   `<pid>:M <stamp> # Client <ip> authentication failed`, with the matched one as
   `* Client <ip> authenticated successfully` — appended to what the file already held, under the
   target's own writer key. One line per password tried, none after the match, and nothing at all
   when nothing was tried.
6. `AUTH <password>` at `redis> ` answers `OK` on a locked store whose password it is,
   `(error) ERR invalid password` on one it is not, and
   `(error) ERR wrong number of arguments for 'auth' command` for a bare `AUTH`.
7. `AUTH <anything>` against an OPEN store answers
   `(error) ERR Client sent AUTH, but no password is set` — and writes no attempt line, because
   nothing was judged.
8. After an accepted `AUTH`, `KEYS` / `GET` / `DBSIZE` answer from the store for the rest of the
   connection. After a refused one they still answer `(error) NOAUTH Authentication required.`, and
   so does every statement on a connection that never sent one.
9. Nothing is remembered server-side: the accepted password is re-sent with every statement, an
   `AUTH` mints no `sessions` row (wire-check), and a store whose `requirepassHash` changes under a
   held connection refuses that connection's very next statement.
10. One attempt line per typed `AUTH` on a locked store, success or failure, appended to the target's
    log. `KEYS`, `GET` and `DBSIZE` still write nothing — the rule slice 2's write-nothing test
    stands on survives the handler learning to write.
11. `rediscli <host> <password>` connects, sends that `AUTH` as its first statement and prints what
    came back. A wrong password leaves the player at `redis> ` with the store still locked and free
    to `AUTH` again; a right one leaves them able to read.
12. `help` at `redis> ` lists `AUTH <password>` alongside the read verbs, aligned by the same
    computed column, and `rediscli`'s own usage line and manual name the optional password.
13. No vantage silently sweeps nothing: all three sweep handlers pass the store's secret, so a store
    behind a published forward falls to `hydra -p <port> <public-ip> redis` by the rule the LAN one
    falls to. The inner-gateway path inherits the seeded-tree caveat slice 5 owns — proven at unit
    level here, live there.

**PLANNING CORRECTIONS** — what grounding changed about the sketch above:

- **`accountsOn` stays REQUIRED; only `secretOn` is new.** The sketch had both columns become
  optional. Redis's row already carries `accountsOn: () => []` with a comment stating why a store has
  no accounts to attack, and that statement is true and worth keeping — making the column optional
  would delete it and churn three handler call sites to say the same thing with a gap. What
  `secretOn`'s PRESENCE buys is not on the server at all: it is the static fact `hydra` reads
  client-side, to stop telling a player it is enumerating accounts at a door that has none.
- **The store's secret does not travel as a nameless account.** It enters `sweepAccounts` as its own
  `secret: string | undefined` and comes back as a `CrackedCredential` whose `username` is optional —
  `SweepableAccount` is not touched. Inventing a username to fill the field is exactly what the
  catalog's redis row already forbids ("the right name against the wrong secret, which reads to a
  player as a working credential until they spend it"), and redis's own log formatter ignores the
  field already: `redisLog.test.ts` passes `user: ''` and asserts a named user changes nothing.
- **A named login must not filter the secret out.** `accountsUnderAttack` drops every account whose
  name was not asked for; run over a nameless secret that rule turns `hydra <host> redis root` into
  `0 valid passwords found`, which reads as a hardened store rather than as a question the door
  cannot be asked. A store has one lock, and naming a person does not change which lock it is.
- **What the prompt HOLDS is no longer what `connect` was given.** Slice 2's `RedisApi` doc says
  exactly that, and it stops being true here: the connection acquires a password.
  `RedisConnection = RedisConnectParams & { password?: string }` keeps the credential off the connect
  round-trip — a door that judges nothing at connect time must not be handed a secret there — and
  that doc comment changes with it.
- **The prompt NOTICES an accepted `AUTH`; it never answers one.** `redisShell` deliberately does not
  recognise its own vocabulary, so that a player whose box died an hour ago finds out instead of
  being politely corrected. That rule is about ANSWERING and survives intact: the line still makes
  the trip, the daemon still judges it, and a store that died between two statements still answers
  `lost` rather than `OK`. What the client adds is one rule — hold the password from an `AUTH` line
  the box did not refuse.
- **The statement handler starts writing, one slice earlier than slice 2 predicted.** Its
  `upsertPatch` dep was declared unused there "because the write verbs land next"; its first real use
  is the attempt line, not a mutation. Slice 2's module doc opens with "This handler writes NOTHING"
  — that sentence changes, and the write-nothing test for READS stays exactly where it is, which is
  criterion 10.
- **`rediscli <host> <password>` prints its `AUTH` answer, `OK` included.** Real redis-cli is silent
  on success. Departing because the greeting is already two chatty lines, and a silent success is
  indistinguishable from a client that ignored the argument it was given.
- **The wire-check fixture needs a locked store that is CRACKABLE.** The requirepass is drawn at
  `CRACK_CHANCE.npcUser` (0.7), so roughly 3 in 10 locked stores cannot fall to the shipped wordlist
  at all. The selector in `testRedisConnect.ts` already probes the generated LAN and fails loudly
  with "pick another ESSID"; the sweep script extends it with that third condition rather than
  hardcoding a host.
- **If review asks for a split, `AUTH` ships first and hydra second — never the reverse.** Hydra
  first strands a cracked password with no verb to spend it on, which is a worse dangling state than
  today's. `AUTH` first stands alone: root on a box can already `cat` the datadir's md5, and cracking
  a reachable hash with real tools is a route this world is deliberately built for. Recommending ONE
  slice regardless — neither half closes the loop the criteria describe.

**RED** — behavior tests, before any production change:

- `core/redis/statements.test.ts` — `AUTH` accepted, refused and bare; the open-store answer; the
  gate now keyed on the password SUPPLIED rather than on the hash alone; and the reported attempt
  outcome present for a judged `AUTH` and absent for every other line.
- `sessions/redisStatement.test.ts` — a locked store answering with the right password and refusing
  with the wrong one; the attempt line's content, owner and permissions, and that it APPENDS; an open
  store's `AUTH` writing nothing; reads still handing the fake `upsertPatch` exactly zero rows.
- `sessions/hydraCrack.test.ts` — the secret swept, the credential coming back with no username, the
  trace's content and volume, the open-store refusal leaving the log untouched, and a named login
  failing to suppress the sweep.
- `sessions/hydraCrackPublic.test.ts` — the same secret swept from that vantage, so no door is
  crackable from one direction only.
- `commands/hydra.test.ts` — the login-less result line, the no-logins status line, and the
  `no_password_set` refusal in the player's words.
- `commands/redisShell.test.ts` — the held password re-sent with each statement, an accepted `AUTH`
  changing what is held, a refused one leaving it alone, and `AUTH` in the help list.
- `commands/rediscli.test.ts` — the positional's pre-sent `AUTH` and its printed answer, and a wrong
  password leaving the prompt held rather than dropping the player.
- Watch the registry help-row assertion while doing it: `rediscli <host> [password]` becomes the
  longest synopsis in its column, and slice 2 already had one test mis-model `padEnd` when a column
  moved.

**GREEN**: `services/serviceCatalog.ts` (the `secretOn?` column and redis's row reading
`storeIn(fs)?.requirepassHash`); `wordlist/passwordSweep.ts` (the `secret` input and the login-less
`CrackedCredential`); the `secret` argument and the no-secret guard in `sessions/hydraCrack.ts`,
`hydraCrackPublic.ts` and `hydraCrackInnerGateway.ts`; the `AUTH` verb, the password-keyed gate and
the reported attempt in `core/redis/statements.ts`; the password and the attempt-line write in
`sessions/redisStatement.ts` (with the `now` and `readRedisLog` deps `redisConnect` already takes);
the redisStatement branch in `api/sessions.ts`; the optional cracked username and the statement
password in `adapters/sessionsApi.ts`; `RedisConnection` in `commands/types.ts`; `redisShell.ts`,
`rediscli.ts`, `hydra.ts` and the held-connection signal in `ui/state.ts`.

**MUTATE**: Stryker over `core/redis/statements.ts`, `sessions/redisStatement.ts`,
`wordlist/passwordSweep.ts` and `commands/hydra.ts`. Scoped-runner recipe from
`conventions-and-gotchas.md` §4 rather than a whole-repo run, and expect BOTH mis-scoring families
that section now records — the load-throw one and the `perTest` module-scope-fixture one slice 2
found. Hand-apply a suspicious survivor before treating it as a real gap; it is the cheapest first
step in triage.
**KILL MUTANTS**: Address survivors; ask when a survivor's value is ambiguous.
**REFACTOR**: One candidate, to be assessed only if it earns it. The three sweep handlers now run
four consecutive identical guards — unknown service, nothing listening, no wordlist, and the new no
secret — around three near-identical `sweepAccounts` calls. That is the same repo-wide family slice 2
named and deliberately left (`readOpenPorts(...).some(...)` in twelve places): collapsing it is a
sweep of its own, not a redis slice's, and the expectation is to leave it again with the reason
recorded.
**Wire-check**, for what only a live stack can prove:
- extend `scripts/testRedisConnect.ts` — an `AUTH` accepted and refused across the wire; the attempt
  line landing in the real `patches` table with its owner and permissions accepted; still ZERO rows
  in `sessions`; and a locked store answering `KEYS` once authenticated.
- new `scripts/testRedisSweep.ts` — `hydraCrack` with `service: 'redis'` against a crackable locked
  store returning a password with no login field; the trace landing in that box's
  `/var/log/redis.log` rather than in `auth.log`; and an open store answering `no_password_set` with
  its log untouched.

**Version**: bump `0.175.0` → `0.176.0` in `v2/package.json` + `v2/package-lock.json`.
**Done when**: criteria 1–13 met, both wire-checks green, mutation report presented, human approves
the commit.

### Slice 4: A player changes a store

**Value**: The game's first no-credential write. Every door before this one asked who you were
before it let you change anything; an open store asks nothing, so a player who found one in slice 2
can rewrite what it holds — and the box's own log is the only thing that will say they were there.
**Path**: `SET`/`DEL` at `redis> ` → one `redisStatement` round-trip per line → the verb table, past
the same gate the reads pass → the whole document written back to the target's
`/var/lib/redis/data.json` → one mutation line appended to the target's `/var/log/redis.log`,
beside the arrival line the connection left.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A`: this slice adds two verbs and one formatter and retires
nothing, so there is no net-reduction claim to make.
**Reduction program**: `N/A`. **Transition/terminal evidence**: `N/A`.

**Already shipped, not re-litigated here**: the `NOAUTH` gate (slice 2) and the statement handler's
ability to write at all (slice 3, for the attempt line). What is new is that the content of a write
comes off the wire rather than out of the server.

**Acceptance criteria** (present to human before any code):

1. `SET <key> <value>` on an open store answers `OK`, and a `GET <key>` in a SEPARATE round-trip
   returns it — the change is on the box, not in a client's copy. Setting a key the store already
   holds replaces the value and leaves `DBSIZE` where it was; setting a new one raises it by one.
2. `SET <key> "<value with spaces>"` stores the value without its surrounding quotes. A bare
   `SET <key>` and a three-word `SET <key> a b` each answer
   `(error) ERR wrong number of arguments for 'set' command` and change nothing: a quoted run is one
   value, and it is the only way to give a value a space.
3. `DEL <key>` answers `(integer) 1` for a key the store holds, removes it, and leaves `GET` at
   `(nil)` with `DBSIZE` one lower. For a key the store does not hold it answers `(integer) 0`,
   changes nothing and **writes no line at all** — nothing happened, so the record says nothing
   happened. A bare `DEL` answers `(error) ERR wrong number of arguments for 'del' command`.
4. A store that changed is persisted as the WHOLE document at `/var/lib/redis/data.json`, under the
   target's own writer key, root-owned and `read: ['root']` — owner and permissions re-stated on
   every write rather than inherited, so a rewrite can never widen the one file on the box that
   holds a hash a sweep has to work for. **`requirepassHash` survives every `SET` and `DEL`
   untouched**: a write verb is not a way to unlock a store, or to lock someone else's.
5. A write that could not be persisted never reports success. The handler answers 500, the client
   turns that into `lost`, and the player is dropped with `Error: Server closed the connection`
   rather than being told `OK` about a change that did not land.
6. Every mutation that performed a write appends ONE line to the target's `/var/log/redis.log`,
   appended to what the file already held, under the target's own writer key, root-owned and
   world-readable, beside the arrival line the connection left:
   - `<pid>:M <stamp> * Client <ip> SET <key> "<value>"`
   - `<pid>:M <stamp> * Client <ip> DEL <key>`
7. The logged detail is **normalized and capped**. Every run of whitespace collapses to one space
   and no control character survives, so a crafted client cannot forge a second entry or a false
   `authenticated successfully`; and a value longer than 100 characters is cut with a trailing `...`
   so one `SET` cannot bury a file every visitor appends to. A statement carrying `\n`, `\t` and 500
   characters produces exactly ONE line, of bounded length.
8. **Reads still write nothing.** A session of `KEYS`/`GET`/`DBSIZE`, an unknown command, a `NOAUTH`
   refusal, a rejected arity and a `DEL` that matched nothing leave the target byte-identical to how
   the connection found it — no datadir patch, no log line, no row. Slice 2's write-nothing test now
   guards READS specifically rather than the handler.
9. **A locked store refuses a write exactly as it refuses a read.** `SET` and `DEL` answer
   `(error) NOAUTH Authentication required.` before `AUTH`, change nothing and write nothing; after
   an accepted `AUTH` on the same connection they land. A store whose `requirepassHash` changes
   under a held connection refuses that connection's next `SET`.
10. **An open store accepts a write from anyone who reaches it** — no account, no tier, no
    credential, and one test that says so in those words. This is the game's first write with
    nothing behind it, and the criterion exists so a later slice cannot quietly add a gate here and
    call it a fix.
11. A box running the daemon with **no readable store** gains one on its first write: the file is
    created at the declared path with the declared owner and permissions, holding that one key and
    `requirepassHash: null`. Reader and writer name the file from ONE declaration, so a write can
    never land somewhere nothing reads it.
12. `help` at `redis> ` lists `SET <key> <value>` and `DEL <key>` beside the read verbs, aligned by
    the same computed column, and `man rediscli` names both. **The help text states the quoting
    rule**, because a row promising an unquoted multi-word value would contradict criterion 2.
13. The `scripts/testRedisConnect.ts` **wire-check** runs green live: a `SET` crossing the wire
    lands in the real `patches` table at the datadir path with its owner and permissions accepted,
    reads back through a second round-trip, `DEL` removes it, both mutation lines land in the
    target's `redis.log` beside the arrival, a session of reads adds nothing, and there are still
    ZERO rows in `sessions`.

**PLANNING CORRECTIONS to record with these criteria:**

- **The epic's open question is ANSWERED: verbatim, normalized, capped** (decided 2026-08-25).
  D6 settled the same question for the database door — its `Query` line carries the statement, and
  its test says why the objection dissolves: *"it is normalized first"*, so a player can neither
  forge a second entry nor fake the columns. Two doors telling one story about their own general
  log is worth more than a rule invented here. **What settled it was noticing the summary form buys
  less than it looks**: the KEY is player-chosen too, so `SET <insult> x` writes graffiti into the
  file under any form. The choice was payload size, not presence — and a defender being able to
  tell a poisoned session from a deleted one is worth the difference. The cap is redis's own
  addition, because a mysql statement is a statement and a redis value can be a blob.
- **The normalization is the CRAFTED-CLIENT boundary, not the prompt's.** A player at `redis> `
  cannot type a newline; the `statement` field on the wire can hold one. So control characters die
  server-side at the parse, where slice 3's arity fix went and for the same reason — the client is
  not the thing being defended against.
- **Control characters die at the trust boundary; whitespace runs live only inside a quoted value.**
  Unlike mysql, which normalizes BEFORE parsing so the collapse reaches the stored value too. Here
  a value may legitimately hold a run of spaces, and a store that silently squeezed `"a  b"` would
  answer `GET` with something the player did not write. But a stored newline would forge lines in
  another player's `GET` output, so control characters go from the whole statement while runs
  survive in the value and collapse only in the rendered log detail.
- **`SET` takes exactly a key and a value, and a quoted run is one value** (decided 2026-08-25).
  Following slice 3's arity fix rather than legacy's `parts.slice(2).join(' ')`, which carries a
  reachable bug of the `KEYS ?` family slice 2 fixed: `SET k "a" "b"` strips the outer quotes and
  stores `a" "b`. Real redis answers a syntax error for a stray third word, and a strict rule is one
  the help row can state completely.
- **The quoted-run tokenizing slice 2 DELETED comes back here, which is what it was deleted for.**
  Its comment says the handling *"belongs with the verb that needs it, and would be untestable
  machinery until then"*. `SET` is that verb. It returns as a token rule — a double-quoted run is
  one token — not as legacy's post-hoc strip of a joined remainder.
- **The datadir write is keyed on the verb having WRITTEN, not on the verb.** mysql names the trap:
  *"a caller deciding from the verb would persist an unchanged database and record a mutation that
  never happened"*. Legacy already classifies this door's two cases the same way — `SET` is always a
  mutation, `DEL` only when the key was there — so precedent and principle agree. A `SET` of the
  value a key already holds still counts: real Redis performs it, and hiding a write that happened
  from the one file a defender reads, to save a patch, is the wrong trade.
- **The datadir's owner and permissions have to move into `redis/datadir.ts`.** Today they live only
  in the generator, which plants `DATADIR_FILE` from `baseFs`; a writer naming its own would be a
  second declaration of one fact, and on the day they disagree a written store is a store the reader
  can no longer read. `DATADIR_PATH`'s own comment already states that rule for the path — the owner
  joins it as `DATADIR_OWNER`, exactly as `mysql/datadir.ts` exports one, with the shared
  `DATADIR_FILE` permissions reused rather than restated.
- **The client changes only in `help` and the manual.** The statement string already crosses and
  `output`/`failed` already come back, so there is no adapter work. But `HELP_WIDTH` is computed
  from the longest synopsis, and `SET <key> <value>` (17) is longer than `AUTH <password>` (15) — so
  **the column moves again**. Slice 2 had a test mis-model `padEnd` when it moved and slice 3 broke
  the row-count assertion; expect both.
- **The two sides of one rule to watch, per slice 3's lesson.** The help row and the parser must
  agree about quoting: a row reading `SET <key> <value>` while the parser demands a quoted run for a
  spaced value is exactly the shape of slice 3's `AUTH` defect, where each side was correct alone.
  Criterion 12 is what catches it. The second candidate pair is the log formatter and the
  normalizer — a formatter that quoted a value the normalizer had already truncated would produce a
  line neither side thinks it wrote.
- **This is the first time this door writes something a PLAYER chose.** Slice 3 taught the handler
  to write, but the attempt line's content is entirely the server's. That is why criterion 7 is a
  test about a crafted client rather than about a player at a prompt.

**RED** — behavior tests, before any production change:

- `core/redis/statements.test.ts` — `SET` creating and replacing; the quoted value; both arity
  refusals; `DEL` hit, miss and bare; the written store present only when the verb wrote and absent
  for every read, refusal and missed `DEL`; the logged detail keyed the same way; the control
  characters stripped, the runs collapsed and the value capped; `requirepassHash` surviving; and
  `NOAUTH` covering both write verbs on a locked store.
- `sessions/redisStatement.test.ts` — the datadir patch's path, content, owner and permissions; the
  mutation line's content, appended beside the arrival rather than replacing it; a 500 and NO log
  line when the patch fails; reads and a missed `DEL` handing the fake `upsertPatch` exactly zero
  rows; a locked store refusing a write without the password and accepting it with; and the store
  created on a box that had none.
- `logging/redisLog.test.ts` — the two line shapes, and the cap at its boundary.
- `commands/redisShell.test.ts` — the two new help rows, the moved column, and a `SET` line still
  making the trip rather than being answered locally.
- `commands/rediscli.test.ts` — the manual naming both verbs and the quoting rule.

**GREEN**: `set` and `del` in `core/redis/statements.ts` (the quoted-run tokenizer back, the
control-character strip, and `store?` / `logged?` on the result, keyed on having written);
`formatRedisMutationLine` in `core/logging/redisLog.ts`; `DATADIR_OWNER` in `core/redis/datadir.ts`;
the datadir write and the mutation append in `sessions/redisStatement.ts`; two rows in
`redisShell.ts`'s `HELP_ROWS`; the manual in `rediscli.ts`.

**MUTATE**: Stryker over `core/redis/statements.ts`, `sessions/redisStatement.ts` and
`core/logging/redisLog.ts`. Scoped-runner recipe from `conventions-and-gotchas.md` §4 rather than a
whole-repo run, and both mis-scoring families that section records — hand-apply a suspicious
survivor before treating it as a real gap. Expect the valuable survivors on the length cap's
boundary and the two arity checks, which is where slice 3's real defect lived.
**KILL MUTANTS**: Address survivors; ask when a survivor's value is ambiguous.
**REFACTOR**: One candidate, to be assessed only if it earns it. `redisStatement.ts` and
`mysqlStatement.ts` now share a three-step shape — run, persist the document if it changed, append a
line if one is owed. The expectation is to leave them: the two doors persist different things behind
that shape, and this epic has twice declined to collapse a repo-wide family from inside one slice.
**Wire-check**: extend `scripts/testRedisConnect.ts` rather than adding a script — the sweep script
is hydra's. What only a live stack can prove: that a `SET`'s document is accepted by the real
`patches` table at the datadir path with root-only permissions; that a second statement round-trip
reads back what the first wrote, so the journal is really replayed over the seeded base rather than
a client's copy being echoed; that both mutation lines land in the target's own `redis.log` beside
the arrival; that reads add nothing; and that `sessions` still holds zero rows.
**Version**: bump `0.176.0` → `0.177.0` in `v2/package.json` + `v2/package-lock.json`.
**Done when**: criteria 1–13 met, wire-check green, mutation report presented, human approves the
commit.

### Slice 5: A store on a deep layer answers

**Value**: The inner-gateway vantage, for statements and for hydra.
**Acceptance criteria**: both paths answer from behind a gateway with the terminal box's **live**
tree, not its seeded one. **Walks into the resolver trap D6 slice 5 recorded** — the chain resolver
hands back the terminal box's SEEDED tree, survivable for a door authenticating against seeded
accounts and fatal for one answering with DATA. Decide here whether to close it for every door at
once or repeat `reachMysqlHost`'s local workaround. **Class**: Behavior change. Wire-check required.

### Slice 6: A player runs their own store

**Value**: The player's box becomes a target worth defending.
**Acceptance criteria**: `apt install redis` → `systemctl start redis` plants a store whose
`requirepassHash` **mirrors the box's root password hash**, with no opt-out; it composes against the
machine (`env.fs.reload()`) per the v0.172.0 invariant, not against this client's copy.
**Class**: Behavior change. Wire-check required.

### Slice 7: A player reaches another player's store

**Value**: The door's whole point — cross-player reach.
**Acceptance criteria**: all four vantages (own-LAN, inner-gateway, public-IP, same-LAN) answer, and
a wire-check proves it live. Always locked, so the vacuous-authorization case never arises between
players. **Class**: Behavior change. Wire-check required.

**No 6b analogue** — slice 6b's rule already shipped, so `daemons: ['redis']` makes a generated redis
box's doors closable for free.

## Pre-PR Quality Gate

Before each PR, from `v2/`:

1. Mutation testing over the changed surface; survivors addressed or explicitly accepted
2. Refactoring assessment (`reduce-system-complexity` `N/A` — every slice here is net-additive)
3. `npm run typecheck` and `npm run lint` pass
4. Version bumped in `package.json` **and** `package-lock.json`
5. From slice 2 on: the slice's `scripts/test*.ts` wire-check run green against `vercel dev` +
   supabase — an `api/` change is unproven until it runs live

---
*Delete this file when D7 is complete, recording the as-built in `legacy-parity-epic.md` first.*
