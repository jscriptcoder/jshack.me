# Plan: D7 — a player reads (and rewrites) a machine's key-value store (`rediscli`)

**Branch**: `docs/plan-d7-redis` (this plan) → `feat/d7-*` per slice
**Status**: Active — slice 1 ready for acceptance-criteria approval

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

### Slice 1: A box runs a key-value store

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
    its own `/etc/passwd` — and never `guest`.
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
- **The `workstation` cell is a no-op and should not be written.** The locked number is `0.05`, and
  the catalog's flat rate is also `0.05`, so `placementOf` returns the same value with or without
  it — while `rolePlacement`'s own contract says a role names only the services it has something to
  say about. Landing **three** cells (`webserver: 0.35`, `database: 0.3`, `iot: 0`) implements
  decision 7's numbers exactly; a fourth would be decoration the module warns against. Flagged
  rather than assumed, because the decision text says five.
- **Legacy's conf carries `requirepass` and names no host; v2's does the opposite.** The
  `requirepass` line is dropped (decision 5), and a `# {{hostname}}` header is added, because every
  config template in `configFiles.ts` names the box it sits on and a guest-readable file that could
  not be told from any other box's is recon worth nothing.
- **`configDb` is the one legacy key generator that manufactures a right-name/wrong-secret pair.**
  It draws a username from the box's own accounts and pairs it with a password from a hardcoded
  pool: `mysql://<real-user>:s3cret!@localhost:3306/app_prod`. On the ~27% of database boxes running
  both daemons that is a real account of a real door on the same box, attached to a secret that will
  never work — the exact failure family D6 shipped in slice 2 and the grill cites. **Recommendation:
  keep the generator, but draw its db_url username from the database-name pool rather than the box's
  users**, so it names nobody real. The other credential-shaped generators (`config:smtp`,
  `config:ldap`, `config:s3`, `api:key`, `webhook:*`) point at services that do not exist in the
  world at all, so nothing can be tried against them and decision 11 holds as written.
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

**GREEN**: The catalog row; three cells in `PLACEMENT_BY_ROLE`; `RedisStore` + `parseRedisStore` in
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

**Value**: The walking skeleton and the 4-in-10 case — the door where the find *is* the whole play.
**Path**: `rediscli <host>` → the sub-shell → the target's datadir → an arrival line in the target's
`/var/log/redis.log`.
**Class**: Behavior change. **Skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `rediscli <host>` prints `Connecting to <ip>:6379…` / `Connected to Redis
<hostname>.` and reaches `redis> `; `KEYS`, `GET`, `DBSIZE`, `QUIT`/`EXIT` answer; unknown input
answers `(error) ERR unknown command '…'`; the arrival line lands in the target's log; the shell
never moved (`subShellPrompt()` gains its third rung and no session row is minted).
**Both type ghosts deleted here** — `SessionKind`'s `'redis'` and `ModeChange`'s redis overlay, plus
the `state.ts` narrow comment that says redis "stays a no-op until its door lands".
**RED**: Command-level behavior tests plus a `scripts/test*.ts` **wire-check**.
**Done when**: criteria met, wire-check green, commit approved.

### Slice 3: A player cracks a locked store

**Value**: The 6-in-10 that are shut become openable, by the tool that opens every other door.
**Path**: `hydra <host> redis` → the sweep handler → the target's `requirepassHash` → attempt lines
in the target's log.
**Class**: Behavior change. **Skills**: as slice 2.
**Acceptance criteria**: `ServiceSpec` gains optional `secretOn` and `accountsOn` becomes optional,
with **no existing row changing shape**; the sweep line omits the login field entirely
(`[6379][redis] host: …   password: …`); an open store answers *no password set (open access)*; a
host with no redis answers `service_not_running`; `NOAUTH Authentication required.` refuses every
statement before `AUTH`; attempt lines append to the target's log.
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
