# Plan: D7 — a player reads (and rewrites) a machine's key-value store (`rediscli`)

**Branch**: `docs/plan-d7-redis` (this plan) → `feat/d7-*` per slice
**Status**: Active — **slice 1 SHIPPED v0.174.0 (#452)**; **slice 2 PLANNED, awaiting
approval of its 14 criteria** on `feat/d7-redis-open-store`

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

### Slice 2: A player opens an unlocked store

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

### Slice 3: A player cracks a locked store

**Value**: The 6-in-10 that are shut become openable, by the tool that opens every other door —
and the wall slice 2 put in front of them gains its way through.
**Path**: `hydra <host> redis` → the sweep handler → the target's `requirepassHash` → attempt lines
in the target's log.
**Class**: Behavior change. **Skills**: as slice 2.
**Acceptance criteria**: `ServiceSpec` gains optional `secretOn` and `accountsOn` becomes optional,
with **no existing row changing shape**; the sweep line omits the login field entirely
(`[6379][redis] host: …   password: …`); an open store answers *no password set (open access)*; a
host with no redis answers `service_not_running`; `AUTH <password>` opens a locked store's prompt
and a wrong one answers `(error) ERR invalid password`; `AUTH` against an OPEN store answers
`(error) ERR Client sent AUTH, but no password is set`; the `[password]` positional joins
`rediscli` and pre-sends that same `AUTH`; attempt lines append to the target's log.
**Already shipped by slice 2, not re-litigated here**: the `NOAUTH Authentication required.` refusal
itself. It landed with the statement door because leaving locked stores readable for the life of a
slice was the vacuous-authorization bug D6 shipped in its own slice 2. Slice 3 owns the way PAST it,
not the wall.
**RED**: Handler tests plus a `scripts/testRedisSweep.ts` wire-check.

### Slice 4: A player changes a store

**Value**: The game's first no-credential write.
**Acceptance criteria**: `SET` and `DEL` land and append to the target's log; `GET`/`KEYS`/`DBSIZE`
never do; an open store accepts a write from anyone who reaches it; a locked store accepts one only
after `AUTH`. **Carries the epic's open question** on whether a mutation line records the key and
value verbatim or a summary — verbatim writes player-typed text into a file other players `cat`.
**Class**: Behavior change. Wire-check required.

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
