# Plan: World Content Slice 6 — A Store Serves That Application

**Epic:** `plans/world-content-epic.md`, slice 6. Grill record: the epic's "Locked decisions"
1–25. **Three owner decisions were taken at planning** (2026-09-22). They are recorded under
"Decided at planning" below and in the epic's status log.

**Status:** Planned, not started.

**Delivery:** one independent PR against trunk.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 6 | `feat/a-store-serves-that-application` | v0.254.0 | app keyspaces on every NPC store, the stream split, the player's fresh-install store |

The PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who gets into a Redis store on any generated box finds the working set of the
application that box runs. It holds sessions for that application's real users, cached copies of
its real rows, and queues, locks, counters and flags in its own vocabulary. Every date falls inside
the box's life, and every host or IP a key names is on the box's own network.

## Grounding (verified 2026-09-22, v0.253.0)

- **43 stores in the catalog world**: 30 on LANs (15 webserver, 7 database, 5 workstation, 3
  fileserver) and 13 deep (8 webserver, 4 database, 1 fileserver). Placement is webserver 0.35,
  database 0.3, iot 0, and the flat rate elsewhere (`rolePlacement.ts`).
- **Only 13 of the 43 share a box with a database.** 8 more have a database elsewhere on their
  network, and 22 have none anywhere on it. So "follow the database" alone would leave most stores
  generic.
- **Today's store** (`generateRedisStore.ts`, `pools/redis.ts`): 8–15 keys from 16 weighted
  generic generators, with the lock drawn **after** the keys on `redis-store-<essid>-<ip>` (60%
  locked, npcUser crack chance). Its `people` are `['root', <box account>]`. It holds hard-coded
  2024 dates, `auth.<hostname>` / `smtp.<hostname>` / `ldap://dc01.<hostname>` hosts that exist
  nowhere, a `mysql://<svc>:<pw>@localhost/app_prod` URL whose password is fiction, and
  `corp-backups`-style names.
- **The door's surface** (`redis/statements.ts`): `AUTH`, `KEYS <glob>` (only `*` is a wildcard),
  `GET`, `DBSIZE`, `SET`, `DEL`. There is no `TTL`, `TYPE` or `SCAN`, and every value is a string.
- **The application seam exists.** `generateDatabase` draws the people and calls
  `buildApplication` on `db-app-<essid>-<ip>`. That part does not depend on whether mysqld runs,
  so a box with no database can still name the application it *would* hold.
- **The wire-checks pick stores live.** `testRedisConnect` and `testRedisSweep` need one open and
  one locked store on a fixed ESSID, and fail with "pick another ESSID" when a re-roll leaves
  neither.
- Slice 4's `.env` names no database at all, only external keys. That is the precedent for how a
  store talks about credentials.

## Scope boundary

**In:**
- **Every NPC store** (every role that runs redis, LAN and deep, every catalog and uncatalogued
  network) holds the **keyspace of the box's application**: the archetype slice 5's selection
  rule picks for that box, with 20–80 keys (decision 12). A workstation holds a smaller dev set of
  20–30 keys.
- **The stream split** (decided at planning). `redis-store-<essid>-<ip>` draws only the lock. A
  new `redis-app-<essid>-<ip>` stream draws the keys.
- **A store with no database beside it serves the box's own application** (decided at planning).
  It uses the rows `db-app-<essid>-<ip>` would hold. Where the box does run mysqld, those ARE the
  database's rows, so the cache agrees with `SELECT`.
- **The player's own bought store is a fresh install** (decided at planning): empty, with its lock
  still mirroring the box's root password.
- **The generic generators retire**: all 16, `APP_PASSWORDS`, the invented hosts, the 2024 dates
  and `corp-backups`-style names (decisions 4, 20 and 22).

**Not built here, deliberately:**
- **A store caching a neighbour's database** (rejected at planning, decision 2 below). No key
  names another box as the store's database.
- **Site ↔ database/store agreement**: still deferred, as slice 5 left it.
- **New Redis surface** (decision 3): no hashes, lists, `TTL`, `EXPIRE` or `SCAN`. Structured
  values stay JSON strings, and an expiry is a `ttl` field in seconds, never a date.
- **Placement changes**: which roles run redis is balance (decision 7), and stays as it is.
- **Lock policy changes**: same 60% locked, same crack chance, same md5 `requirepassHash`.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. No key pairs an in-game account with a working secret. No value is a database or box password in any form. External secret-shaped values (a webhook secret, an S3 key) are fiction and allowed. |
| 3 | The shipped surface only: `KEYS` / `GET` / `DBSIZE`, string values, JSON for structure. |
| 4 | A key or value that names a host, IP, `.lan` name, port or path names a real one on the box's own network. People by name are not world references. |
| 5 / 22 | Every timestamp is on or before 2026-07-11 23:59:59 and after the application's install. |
| 6 | NPC stores get keyspaces. The player's own store is a fresh install. |
| 8 | Sessions and holders are the application's real `users`, and the box's own inhabitant among them. |
| 12 | The store follows the box's application: sessions for its real users, cache entries for its rows, queues, rate limits and feature flags as JSON strings, 20–80 keys. |
| 15 (amended) | `redis-app-` is new, and `redis-store-` re-rolls its lock once (see below). No other stream moves. |
| 16 | Keyspaces are static data, authored fresh. |
| 17 | Variety tested within and across networks. |
| 20 | Every email or domain a value carries is on the network's `.lan` zone. |
| 21 | Version-free: no version string in any value (`app:config`'s `version` field goes). |
| 23 | Store pins move deliberately. Content rules become property tests. |

## Decided at planning (2026-09-22)

1. **Decision 15 is amended again: every NPC store's lock re-rolls once.** Today the lock is drawn
   after the keys on `redis-store-`, so any new keyspace moves it. `redis-store-` now draws only
   the lock, with the same chance and ladder. `redis-app-` draws the keys. Every NPC store's lock,
   and whether it has one at all, re-rolls once. **Why acceptable:** it is the same trade slice 5
   made for database credentials. Tests recover plaintexts by matching the pool, and the
   wire-checks choose their hosts live, so at worst one needs a different ESSID.
2. **A store with no database beside it serves the box's own application**, the collapsed option.
   Its application is the archetype and rows the box would hold on `db-app-<essid>-<ip>`, so on a
   box that does run mysqld, every cached row is the real row. **Rejected:** caching a same-archetype
   neighbour's database and naming that host. It would give 8 more stores a follow-through, at the
   cost of building a neighbour's database per store and a cross-box rule.
3. **The player's own store is a fresh install**: no keys (`DBSIZE` 0, `KEYS *` empty), like a real
   new `redis-server` and like slice 5's fresh database. Its lock keeps mirroring the box's root
   password, and the drawn lock on `redis-store-own-<pubkey>` stays only as the fallback for a box
   whose passwd names no root.

---

## The keyspace

**Whose application.** One rule: the box's application is exactly what slice 5 would build for it,
`databaseArchetype(essid, host)` and its rows from `db-app-<essid>-<ip>` with the same people.
`generateDatabase` splits so that this application is one function both the database and the
store call. The database adds credentials, and the store adds keys. Nothing about the application
is drawn twice.

**Families.** Every keyspace mixes shared families, written in the archetype's vocabulary, with
families of its own. The exact key names are settled at implementation, as data in a new
`pools/storeApps.ts` beside `databaseApps.ts`.

| Family | Shape (example) | Truth rule |
|---|---|---|
| Sessions | `sess:<32 hex>` → `{user_id, username, role, ip, created_at, last_seen, ttl}` | `user_id`/`username`/`role` are one real `users` row. `ip` is that person's own machine on the LAN (the box's own IP for its own account, a host on the same layer for a deep box). `created_at` ≤ `last_seen`, both after the user's `created_at`. |
| Cached rows | `cache:<table>:<id>` → the row as JSON | Byte-for-byte the application's row (minus `password_hash` for `users`). Only tables the archetype caches. |
| Per-user state | `perms:<username>`, `cart:<user_id>`, `prefs:<username>` | Names a real `users` row. |
| Queues | `queue:<name>` → JSON array of jobs `{id, kind, ref, queued_at}` | Every `ref` names a real row id. |
| Locks | `lock:<job>` → `{holder, acquired_at, ttl}` | `holder` is a real `users.username`. |
| Rate limits | `ratelimit:<route>:<ip>` → count | `ip` is a real host on the box's network. |
| Counters | `stats:<name>` → integer | Free numbers, but in the archetype's vocabulary (`orders_today`, `tickets_open`, `readings_ingested`). |
| Feature flags | `flag:<feature>` → `{enabled, rollout}` | Free, and vocabulary per archetype. |
| External config | `config:webhook:<vendor>`, `config:s3` | Fiction (decision 2): secret-shaped hex for services outside the world. No in-world host, and no password field. |

Per archetype, the characteristic families look like this (illustrative):

| Archetype | Characteristic keys |
|---|---|
| till | `order:open:<id>`, `cache:menu_items:<id>`, `queue:kitchen`, `stats:orders_today` |
| helpdesk | `cache:tickets:<id>`, `queue:notify`, `lock:sla_sweep`, `stats:tickets_open` |
| crm / stock | `cache:deals:<id>` / `cache:products:<id>`, `queue:import`, `lock:reorder` |
| telemetry | `device:last:<id>` (the latest `readings` row), `queue:alerts`, `stats:readings_ingested` |
| scoreboard | `leaderboard` (JSON array of teams by score), `cache:challenges:<id>` |
| cms / wiki | `cache:posts:<id>` / `cache:wiki_pages:<id>`, `queue:publish` |
| mail | `quota:<mailbox>`, `queue:outbound`, `ratelimit:smtp:<ip>` |
| api | `apikey:<client_id>` (a hashed token, never plaintext), `ratelimit:api:<ip>` |

**Volume and order.** 20–80 keys (20–30 on a workstation). `KEYS *` prints them all, so every
value stays one short line of JSON. Sessions number at most the application's `users` count.

### What "true" means here (decision 4, applied)

- **People:** every username, `user_id` or `holder` in a store is a row of the box's
  application's `users`.
- **Rows:** every `cache:<table>:<id>` value equals that application row. Every `ref` / `*_id`
  names a row that exists. On a box that runs mysqld, this is checked against
  `/var/lib/mysql/data.json` itself.
- **Hosts:** every IP a store names belongs to a host on the box's own network (its LAN, or its
  deep layer). No hostname is invented, and a zone name appears only when it resolves.
- **Calendar:** every timestamp is `YYYY-MM-DD HH:MM:SS` or ISO-8601, on or before
  2026-07-11 23:59:59, and after the application's install date. There are no epoch-second dates.
- **Inert:** no value holds a field named `password`, `pass`, `pw` or `db_url`. No value contains a
  word from the password pools as a secret. `requirepassHash` is the only secret in the file, as
  today.
- **Version-free, no unfilled slot** (`{…}`, `undefined`, `NaN`) in any key or value.

---

## PR 6 — A store serves that application

**Class:** behaviour change. **Required skills:** `tdd`, `testing` and `functional`, then
`refactoring` after green and `mutation-testing` at PR readiness.

**Value:** A player who finds an open store on `web-12` on a café network types `KEYS sess:*` and
gets sessions for the till's staff. `GET` one and it names `mrodriguez`, from the IP of the laptop
`nmap` showed as hers. `GET cache:menu_items:3` is the same row `SELECT * FROM menu_items` returns
on a box that runs both.

**Path:** `buildRemoteHostFs` / `buildDeepHostFs` (`redisService`) → the application (split out of
`generateDatabase`, on `db-app-`) → `generateRedisStore` (keys on `redis-app-` from
`pools/storeApps.ts`, lock on `redis-store-`) → `/var/lib/redis/data.json` → `storeIn` → the redis
door (`KEYS` / `GET` / `DBSIZE`). `ownStore` → the fresh install.

### Acceptance criteria

- [ ] Every NPC store (every role, LAN and deep, every catalog and uncatalogued network) holds
      the keyspace of the box's application: 20–80 keys, or 20–30 on a workstation.
- [ ] The store's application is the one slice 5's rule picks for the box. On a box that runs
      mysqld too, it is that database's application, and every cached row equals the row in
      `data.json`.
- [ ] `KEYS sess:*` on any NPC store returns at least one session, and every session names a real
      `users` row of its application, with that row's `id`, `username` and `role`.
- [ ] Every session's `ip`, and every IP any key names, is a host on the box's own network. A LAN
      session's `ip` is its user's own machine.
- [ ] Every `ref`, `*_id`, `holder` and per-user key names something that exists in the
      application.
- [ ] Every timestamp is on or before 2026-07-11 23:59:59 and after the application's install
      date, and a session's `created_at` ≤ `last_seen`.
- [ ] Inert: no password-named field, no `db_url`, no pool word as a secret, no version, no
      unfilled slot, no domain off the `.lan` zone. `requirepassHash` is the only secret.
- [ ] Lock: every NPC store is still locked about 60% of the time with the npcUser crack chance.
      `redis-store-` draws nothing but the lock, and no stream other than `redis-store-` /
      `redis-app-` moves. Every database, page, tree and password pin stays unchanged.
- [ ] The player's own bought store holds no keys (`DBSIZE` 0), and `AUTH` with the box's root
      password still opens it.
- [ ] The generic generators are gone: no 2024 date, no `auth.` / `smtp.` / `ldap` host, no
      `app_prod`, no `corp-backups` in any generated store.
- [ ] Variety: within one network no two stores hold the same key set. Across the catalog, ≥ 90%
      of stores have distinct key sets (numbers confirmed at implementation and recorded in the
      as-built).
- [ ] Budgets hold: bundle and per-box build time stay under their ceilings (`npm run build`).

**Evidence:**
- Property tests in a new `generation/store.test.ts` over every store in the world, LAN and deep,
  plus 20 stores of every archetype so that no archetype goes untested (slice 5's `manyOfEach`
  lesson). Built inside each test, never a file-level cache, because of Stryker attribution. They
  absorb the store checks in `remoteHostFs.test.ts` where those move.
- `ownStore` tests for the fresh install. `redisCli` / `redisShell` / `redisStatement` fixtures
  move off the retired key shapes.
- Wire-checks against `vercel dev` + supabase: `testRedisConnect`, `testRedisSweep`,
  `testRedisDeep`, `testRedisSameLan`, `testRedisCrossPlayer`.
- A played run via `v2-e2e`:
  - Crack a network, `nmap` its LAN, and find a redis box (hydra it if locked).
  - `redis-cli` → `KEYS sess:*` → `GET` one, which names a user whose machine `nmap` shows,
    at that machine's IP.
  - On a box that runs both, `GET cache:<table>:<id>` equals the `SELECT` row.

### Increments (TDD, one commit each after approval)

1. **Stream split.** `redis-store-` draws only the lock, and keys move to `redis-app-` (still the
   old generators). RED: a test that the lock equals a draw from the bare `redis-store-` stream.
   Fixture pins that recorded a specific lock move.
2. **The application seam.** `generateDatabase` → the application function plus credentials, a
   behaviour-preserving split proven by slice 5's `database.test.ts` staying green. No RED, since
   this is a refactor.
3. **Fresh-install own store.** RED: `ownStore` holds no keys and root's password still opens it.
4. **Sessions for the application's users.** `generateRedisStore` takes the application and the
   box's network. RED: the session properties (real rows, own-machine IPs, calendar).
5. **The archetype keyspaces.** `pools/storeApps.ts`: cached rows, queues, locks, rate limits,
   counters, flags and external config per archetype, with the volume range. RED: cache equals
   row, refs resolve, volume, and the per-archetype characteristic keys.
6. **Retire the generic generators**, plus the inert, version, slot and zone sweeps and the
   variety test. `pools/redis.ts` goes.

## Risks

- **Lock re-roll.** Anything that remembered a specific store's lock or open state goes stale:
  - player journals: acceptable, since there's no backward-compat burden before launch
  - wire-checks: `testRedisConnect` and `testRedisSweep` choose hosts live, but a fixed ESSID
    may lose its open or locked store and need another ESSID
  - the `v2-e2e` skill derives no store secret offline

  Confirmed at increment 1 by running the redis wire-checks.
- **The world gets heavier.** A store now builds its box's application even where no database
  is served (30 of 43 stores). That is cheap: an application is ~0.3 ms, and only store boxes pay.
  The per-box budget (2 ms) is checked at the gate.
- **Terminal width.** 80 keys of JSON on `KEYS *` is 80 short lines, and a `GET` of a cached
  `TEXT`-heavy row stays one line because slice 5 already keeps `TEXT` short.
- **Session IPs on deep boxes.** A deep login has no machine of its own, so its session `ip` is a
  host on the same deep layer, drawn on `redis-app-`. The truth rule still holds.
- **Budget.** Keyspace data for 15 archetypes: an estimated +4–8 KB gzipped, with ~113 KB of
  headroom. The retired `pools/redis.ts` gives some of it back.
