# Plan: World Content Slice 5 — A Database Holds an Application

**Epic:** `plans/world-content-epic.md`, slice 5. Grill record: the epic's "Locked decisions"
1–25. **Four owner decisions were taken at planning** (2026-09-22). They are recorded under
"Decided at planning" below and in the epic's status log.

**Status:** In progress on `feat/a-database-holds-an-application`.

**Delivery:** one independent PR against trunk.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 5 | `feat/a-database-holds-an-application` | v0.253.0 | app archetypes on every NPC database, the stream split, the player's fresh-install database |

The PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who gets into a database on any generated box finds a real application's data. It is
the kind of application its place would run: a café's till, a company's helpdesk, a university's
enrolments. It is staffed by that network's real people, it holds rows that agree with each
other, and it is dated inside the box's life.

## Scope boundary

**In:**
- **Every NPC database** (every role that runs mysqld, LAN and deep, every catalog and
  uncatalogued network) holds one **app archetype**. The archetype names the database and its
  schema: 4–8 tables including `users`, 5–40 rows each.
- **The stream split** (decided at planning). `mysql-db-<essid>-<ip>` draws only the credentials.
  A new `db-app-<essid>-<ip>` stream draws the application.
- **The player's own bought database is a fresh install** (decided at planning): a `users` table
  whose only row is the owner.
- **The generic pool retires**: the seven drawn templates, `company.local` / `corp.internal` /
  `acme.local`, the 2024 and 2025 dates, and the `DB_NAME_PREFIXES` / `DB_NAME_SUFFIXES` name
  draw (decisions 20 and 22).
- The consumers that already read the built database follow it with no code change:
  - slice 4's `dump.sql`
  - slice 3's `mysql.log.1` queries
  - slice 2's root history naming the database

**Not built here, deliberately:**
- **Redis paired with the app**: slice 6. The store keeps its 16 generic generators for now.
- **Site ↔ database agreement** (decided at planning: deferred). A café's menu page need not list
  its `menu_items` rows.
- **Rows in `dump.sql`**: it stays schema-only, as slice 4 decided. With 5–40 rows a table, the
  mysql door is how you read rows, and a world-readable file of usernames would break slice 4's
  rule that nothing under `/var/www` names an account except root.
- **New SQL surface** (decision 3): no new column type (no `DECIMAL`, no `DATE`), no `LIMIT`, no
  `COUNT`, no `SHOW DATABASES`. Content fits the shipped six types.
- **Credential ladder changes** (decision 14): same accounts, same crack chances, same
  `MYSQL_USERNAMES`.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. No row pairs an in-game account with a working secret. `password_hash` is bcrypt-shaped and no in-game tool reverses it. API keys and tokens in rows open nothing. |
| 3 | The shipped surface only: `SHOW TABLES` / `DESCRIBE` / `SELECT`, the six column types. |
| 4 | A row that names a host, IP, `.lan` name or path names a real one on the box's own network. People by name are not world references. |
| 5 / 22 | Every `DATETIME` falls in the box's life, on or before 2026-07-11. |
| 6 | NPC boxes get archetypes. The player's own database is a fresh install. |
| 8 | Staff are the network's real inhabitants, and the box's own inhabitant leads `users`. |
| 12 | The archetype names the schema and the database. 4–8 tables of 5–40 rows. The inert-hash rule. |
| 15 (amended) | `db-app-` is new, and `mysql-db-` re-rolls its credentials once (see below). No other stream moves. |
| 16 | Archetypes are static data, authored fresh. |
| 17 | Variety tested within and across networks. |
| 20 | Every email in a database is on the network's `.lan` zone. |
| 21 | Version-free: no version string in any cell. |
| 23 | Database pins move deliberately. Content rules become property tests. |

## Decided at planning (2026-09-22)

1. **Decision 15 is amended: the credentials re-roll once.** Today the credentials are drawn
   after the tables on `mysql-db-`, so any new schema moves them. `mysql-db-` now draws only the
   credentials (root, the application account, the optional read-only one), in the same ladder
   order, and `db-app-` draws everything else. Every NPC database password re-rolls once.
   **Why this is acceptable:** nothing pins them hash-for-hash. Tests and `testMysqlDeep` recover
   plaintexts by matching the pool, and each account's crack chance is unchanged. **Rejected:**
   running the old draws just to advance the stream, which would keep the retired generic pool in
   the bundle as dead weight.
2. **The player's own database is a fresh install.** `ownDatabase` builds a `users` table whose
   one row is the box's user, with no drawn tables, colleagues or app. Its credentials keep their
   own stream (`mysql-db-own-<pubkey>`), and root still mirrors the box's root password. The
   player is that box's only person (decision 6).
3. **Every archetype keeps `users`**, the application's login table: `id`, `username`, `email`,
   `password_hash`, `role`, `created_at`. `password_hash` is bcrypt-shaped: `$2y$10$` plus 53
   characters of the bcrypt alphabet. john only reverses md5, so no in-game tool cracks it
   (decision 12). The SQL door's fixtures and wire-check keep the `users`/`role`/`id='1'` shape
   they use today.
4. **Site ↔ database agreement is deferred.**

---

## The archetypes

**Selection.** One rule, read top to bottom:

1. `portal-` → **CMS**
2. `api-` → **API platform**
3. mail-server role → **mail directory**
4. workstation role → **the network's archetype**, named `<name>_dev`, with fewer rows (a
   developer's local copy)
5. anything else → **the network's archetype**, drawn from the network category's list below

The network's archetype is drawn once per network, from the network's category, on the ESSID's
own `db-app-network-<essid>` stream. Every database on one network that falls to this rule then
runs the same application, as one organisation's would. Different networks in one category
differ by the draw and by their rows.

| Category | Archetypes (drawn) | Tables beyond `users` (examples) |
|---|---|---|
| corporate | helpdesk · CRM · stock | `tickets`, `ticket_comments`, `sla_policies` · `accounts`, `contacts`, `deals`, `activities` · `products`, `stock_levels`, `suppliers`, `purchase_orders` |
| cafe | till | `menu_items`, `orders`, `order_lines`, `shifts`, `suppliers` |
| residential | media library · household | `titles`, `episodes`, `watch_history` · `recipes`, `bills`, `shopping_list` |
| university | enrolment · library | `students`, `courses`, `enrolments`, `timetable` · `books`, `members`, `loans` |
| public | library · bookings | `books`, `members`, `loans` · `rooms`, `bookings`, `notices` |
| iot | telemetry | `devices`, `readings`, `alerts` |
| hacker | scoreboard · wiki | `teams`, `challenges`, `solves` · `wiki_pages`, `revisions` |
| (any) `portal-` | CMS | `posts`, `pages`, `comments`, `categories` |
| (any) `api-` | API platform | `api_clients`, `request_log`, `webhooks`, `rate_limits` |
| (any) mail server | mail directory | `mailboxes`, `aliases`, `delivery_log`, `spam_rules` |

The exact table lists are settled at implementation. Each archetype has at least 4 tables
including `users`, and draws a subset up to 8 so that two databases on one archetype differ.
The database name comes from the archetype (`helpdesk`, `till_prod`, `enrolment`, `mail`…),
drawn from a small per-archetype list.

### Who is in the rows

- **`users`**: the box's own account first, as `admin`, and on the LAN the accounts of every
  other machine on it (`npcUsername`), each once. No floor: a LAN with few machines has a short
  `users` table (owner, 2026-09-22), because every login is someone whose box `nmap` shows. A deep box has no neighbours (slice 1's rule), so its
  `users` holds its own account plus the application's other logins, drawn from the
  role-keyed username pool as today. Email is `<username>@<zone>`. `users` sits behind the
  database door, so usernames are allowed here (decision 12: "the helpdesk agent IS
  `mrodriguez`").
- **Staff references** in other tables (`tickets.assignee_id`, `shifts.user_id`,
  `revisions.author_id`) point at `users.id`.
- **Customers, members, students, contacts** are fictional people by full name (the
  `people.ts` pools), with **no email**. The rule is: an email appears only on a `users` row and
  is always on the zone. There is no invented public domain (decision 20), and a café customer
  on the café's `.lan` zone would be a lie.
- **A mail directory's mailboxes** are one per `users` login plus the shared ones an
  organisation keeps (`info`, `sales`, `postmaster`…, `user_id` NULL). They store only the
  `local_part`, never a full address, so the "email only on `users`" rule holds with no
  exception, and the shared mailboxes keep the table above the 5-row floor. There is no
  `domains` table: it would hold one row, the zone.

### What "true" means here (decision 4, applied)

- **Referential integrity:** every `<table>_id` / `*_id` column value names a row that exists in
  the table it refers to.
- **Keys:** `PRI` values are unique and ascending, and `UNI` values are unique.
- **Types:** every cell matches its column type (INT an integer, BOOLEAN 0 or 1, DATETIME
  `YYYY-MM-DD HH:MM:SS`). Money is `INT` whole euros, and no archetype uses `FLOAT` for it. A `nullable: false` column never holds `NULL`.
- **Calendar:** every DATETIME is on or before 2026-07-11 23:59:59 and after the database's
  install date. Within a table, rows ascend in time with `id`. A child row is dated no earlier
  than the parent it references.
- **People:** every `users.username` is the box's own account, a real LAN neighbour's account,
  or (deep only) a role-pool login. Every email is `<username>@<zone>` of a `users` row.
- **No version, no unfilled slot** (`{…}`, `undefined`, `NaN`) in any cell.
- **Inert:** no `password_hash` is an md5 of any pool word (john's wordlist). No cell holds a
  value an in-game door accepts as a credential.

---

## PR 5 — A database holds an application

**Class:** behaviour change. **Required skills:** `tdd`, `testing` and `functional`, then
`refactoring` after green and `mutation-testing` at PR readiness.

**Value:** A player who cracks the application account on `records-170` and types `SHOW TABLES`
sees `tickets`, `ticket_comments` and `users`. `SELECT * FROM users` lists the box's own
inhabitant and the neighbours they share an office with. `SELECT * FROM tickets` shows who was
assigned what, and when, before the world stopped.

**Path:** `buildRemoteHostFs` / `buildDeepHostFs` (`servesDatabase`) → `generateDatabase`
(credentials from `mysql-db-`, archetype from `db-app-` via new `generation/databaseApp.ts`) →
`/var/lib/mysql/data.json` → `databaseIn` → `mysql` door (`SHOW TABLES` / `DESCRIBE` /
`SELECT`) → rendered rows. The existing readers are unchanged: `dump.sql`, `mysql.log.1` and
root history.

### Acceptance criteria

- [ ] Every NPC database (every role, LAN and deep, every catalog and uncatalogued network)
      holds one archetype: 4–8 tables including `users`, 5–40 rows in each table beyond `users`,
      and a database name from its archetype.
- [ ] The archetype follows the selection rule: `portal-` → CMS, `api-` → API platform, a mail
      server → mail directory, a workstation → the network's archetype as `<name>_dev`, anything
      else → the network's archetype. Every database on one network that falls to the network's
      archetype runs the same one.
- [ ] A café network's database (catalog and uncatalogued) holds a till: `menu_items`, `orders`,
      `order_lines`, `shifts` and `users`, and its `users` names that network's real inhabitants.
- [ ] `users` has `id`, `username`, `email`, `password_hash`, `role` and `created_at`. The box's
      own account leads as `admin`. On the LAN the other rows are exactly the distinct accounts
      of every other machine on it, with no floor (owner, 2026-09-22: 3–8 rows). A deep box
      keeps its account plus 4–9 role-pool logins.
      Every email is `<username>@<zone>`. Every `password_hash` is bcrypt-shaped and matches the
      md5 of no word in the password pools.
- [ ] Referential integrity, unique ascending primary keys, unique `UNI` values, cells true to
      their types, and no `NULL` in a non-nullable column, on every database.
- [ ] Every DATETIME is on or before 2026-07-11, ascends with `id` within a table, and no child
      row predates its parent.
- [ ] No cell holds a version, an unfilled slot, an email off the zone, or a non-`users` email.
      Money is whole euros (`INT`), so every cell is scanned for versions with no carve-out.
- [ ] Credentials: every NPC database still has root, one application account from
      `MYSQL_USERNAMES` and a read-only account about half the time, with the ladder's crack
      rates. The `mysql-db-` stream draws nothing but them, and no stream other than
      `mysql-db-` / `db-app-` moves: every other pinned tree, page and password is unchanged.
- [ ] The player's own bought database holds exactly one table, `users`, with exactly one row
      (the box's user), and its root still answers to the box's root password.
- [ ] The generic pool is gone: no `company.local` / `corp.internal` / `acme.local` and no
      2024/2025 date anywhere in a generated database.
- [ ] `dump.sql` still matches its database's schema, and `mysql.log.1` still queries real
      tables (their existing tests stay green on the new schemas).
- [ ] Variety: within one network no two databases hold byte-identical rows for any table. Across
      the catalog, ≥ 90% of `users` tables and ≥ 90% of the archetypes' main tables are distinct
      (numbers confirmed at implementation and recorded in the as-built).
- [ ] Budgets hold: bundle and per-box build time stay under their ceilings (`npm run build`).

**Evidence:**
- Property tests in a new `generation/database.test.ts` over every network, LAN and deep, built
  inside each test (never a file-level cache, because of Stryker attribution). They absorb the
  existing database checks in `remoteHostFs.test.ts` where those move.
- `ownDatabase` / `mysqlOwnBox` tests for the fresh install.
- `mysql.test.ts`, `mysqlConnect.test.ts` and `testMysqlDeep` stay green through the
  pool-matched fixtures.
- A played run via `v2-e2e`:
  - `nmap -sV` a LAN, find a mysql box, and crack its application account with hydra.
  - `mysql` → `SHOW TABLES` → `SELECT * FROM users` names people whose boxes `nmap` shows.
  - `SELECT` a child table and check that its ids resolve.

---

## Risks

- **Credential re-roll.** Anything that remembered a specific database password goes stale:
  - a player journal: acceptable, since there's no backward-compat burden before launch
  - a wire-check that hard-codes one: `testMysqlDeep` recovers plaintexts from the pool, so
    none is known
  - an e2e note: the `v2-e2e` skill derives no database secret offline

  Confirmed at RED by running the wire-check list's mysql scripts.
- **Money is whole units** (owner, 2026-09-22). A price like `4.50` would look like a version
  to `softwareVersionsIn`, so prices, amounts and totals are `INT` whole euros, as slice 4's
  pages already are. The "no version" property then scans every cell with no carve-out.
- **Terminal width.** `SELECT *` on a 40-row table with long `TEXT` cells (ticket bodies) is
  printed whole. Keep `TEXT` cells to one short line.
- **Budget.** About ten archetypes of static data: an estimated +8–15 KB gzipped against about
  120 KB of headroom. Rows stay generated from slots, not written out.
- **Stream discipline.** The network-level archetype draw uses its own
  `db-app-network-<essid>` stream, so no per-box stream gains a draw.
