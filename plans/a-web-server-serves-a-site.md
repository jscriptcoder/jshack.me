# Plan: World Content Slice 4 — A Web Server Serves a Site

**Epic:** `plans/world-content-epic.md` — slice 4. Grill record: the epic's "Locked decisions"
1–25. **Six owner decisions were taken at planning** (2026-09-21), recorded under "Decided at
planning" below and in the epic's status log.

**Status:** Active — 4a merged 2026-09-21 (#537, 5c42ce5f, v0.251.0); 4b in progress.

**Delivery:** **Two independent PRs against trunk, in order** (decided at planning). PR 4a is
independently valuable (a player's own hand-written page with a table renders) and merges first;
PR 4b branches from trunk after 4a lands. Not a stack: 4b does not start before 4a merges.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 4a | `feat/lynx-tables-and-pre` | v0.251.0 | lynx renders `<table>` and `<pre>` — ✅ merged #537 |
| 4b | `feat/a-web-server-serves-a-site` | v0.252.0 | the three-layer site, `.lan` names in web tools, the link-resolution property test — 🔨 in progress |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who points lynx at a web server on their network finds a real site, not a status blurb:
pages that link to each other and to the network's other real web hosts, a `robots.txt` and
`sitemap.xml` naming paths that are really served, and a few unlinked paths that a default
`gobuster` sweep turns up — every one of them true.

## Scope boundary

**In:**
- **Webserver-role hosts only** (`web|www|portal|nginx|api` prefixes), LAN and deep, get the three
  layers (decided at planning).
- **lynx renders `<table>` and `<pre>`** (PR 4a) — display plumbing, not a verb (decision 3).
- **Web tools resolve the network's `.lan` names** (PR 4b): lynx, link-following inside lynx and
  gobuster reach `http://<host>.<essid-slug>.lan/` the way `curl` already does (decided at
  planning). Display plumbing — the resolver already exists (`resolveLanName`).
- **Every other http host's one page is rewritten version-free** (decision 21): the general,
  workstation and IoT buckets in `pools/webPages.ts` lose their `Build 4.2.1` / `nginx/1.24.0` /
  `Firmware 2.1.4`. They stay one page, unlinked.
- **`access.log.1` on a webserver requests its real public pages** (slice 3's history, extended):
  each line's path is a page the site serves and its size is that page's byte length.

**Not built here, deliberately:**
- **Sites on non-webserver hosts** — a laptop's dev server, a database box's page keep one page
  (decided at planning). **Accepted cost:** a default `gobuster` against them finds only
  `index.html`.
- **Camera/printer device pages** → slice 9 (prefix overlays). **Gateway admin pages** → slice 10.
- **Directory listings (autoindex).** A directory is found by a sweep only when it holds an
  `index.html` (`webSweep.ts`), and stamping a fake listing file on disk would be a lie a rooted
  player sees with `ls`. So hidden directories are ones that naturally carry a page (`old/`,
  `staging/`, `test/`, `admin/`, `dashboard/`, `internal/`), and dirlist words that only make sense
  as listings (`backup/`, `backups/`, `uploads/`, `files/`, `images/`) are not served. Teaching the
  server autoindex is a server behaviour change (it would also list a player's own `mkdir`s) and is
  out.
- **`config.php`, `.git`, `wp-admin`** — a real server executes PHP (a blank response would be the
  honest one and pays nothing), git object stores are out (decision 9), and WordPress is a product
  this world does not run.
- **Login forms that submit** (decision 11: decoration), rows in `dump.sql` (decided at planning).
- Any server change beyond what the shared `core/` web path already runs on both ends.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert: `.env` holds external-service keys that open nothing; no DB password anywhere on the site. |
| 3 | No new verbs — `<table>`/`<pre>` and `.lan` names in web tools are display plumbing. |
| 4 | Every link, robots path, sitemap URL, host and port a site names is true — see "What 'true' means". |
| 5 / 22 | Any date on a site falls in the box's life, on or before 2026-07-11. |
| 6 | NPC hosts only; the player's own page is untouched. |
| 11 | The three layers; the link-resolution property test; lynx tables/pre where first needed. |
| 13 | Web files are world-readable (and `/var/www/**` is on the no-session allowlist already). |
| 15 | One new stream, `web-site-<essid>-<ip>`. No existing stream gains a draw (webservers stop reading `web-page-`, which moves nothing else). |
| 16 | Pools authored fresh, as static data. |
| 17 | Variety tested within and across networks. |
| 20 | The persona's domain is the network's `.lan` zone; role mailboxes live there. |
| 21 | Version-free: no version in any page (`softwareVersionsIn`). |
| 23 | The general-page md5 pin, the pool-width pin and the "leaks a version" test move deliberately. |

## Decided at planning (2026-09-21)

1. **Webservers only.** The three layers go on webserver-role hosts; every other http host keeps
   one page, rewritten version-free. IoT device pages wait for slice 9, gateway admin pages for
   slice 10.
2. **Cross-host links use `.lan` names.** A link to another web host reads
   `http://www-04.<essid-slug>.lan/`, as a real intranet does, and the web tools resolve LAN names
   through the same resolver `curl` uses. A deep box names no neighbour (slice 1's rule), so deep
   sites link only themselves, and name themselves by IP (no `.lan` name resolves on a deep layer).
3. **Two PRs, in order** — 4a lynx `<table>`/`<pre>`, 4b the site.
4. **`robots.txt` may name one off-dirlist path.** A seeded share of sites `Disallow` one served,
   unlinked path that is NOT on the default dirlist, found only by reading `robots.txt` and adding
   it to your own dirlist — the loop `dirlist.txt`'s design already invites. It sits on the same
   box, so it is not decision 11's rejected cross-box alternative.
5. **Full names, never usernames.** A web tree is readable with no session at all, so it keeps
   slices 2–3's single rule — **no account a door accepts, except `root`**. Pages name the box's
   inhabitant and real neighbours' inhabitants by display name (`Maria Rodriguez, IT`) and give
   role mailboxes on the persona domain (`info@`, `webmaster@`, `helpdesk@<slug>.lan`). No login
   name appears anywhere under `/var/www`. **Accepted cost:** a full name hints at the username
   pattern; hydra sweeps every account regardless.
6. **`dump.sql` is schema-only.** A `mysqldump --no-data`-shaped snapshot of the box's real
   database — `CREATE TABLE` for its real tables and columns, no rows — present only on a webserver
   that runs mysql. It is true, names nobody, and makes the mysql door the next step. Slice 5's
   archetypes may revisit rows.

## Resolved from "Open for planning"

- **How many dirlist paths a web host serves:** 1–4 hidden paths per webserver site, drawn from
  the servable subset of `DEFAULT_DIRLIST` (below), plus the off-dirlist robots path when drawn.
- **Web file permissions:** reuse `WEB_PAGE_FILE` (world-readable, root-write) for every file under
  `/var/www/html`, and the existing traversable directory constant for its subdirectories.

---

## PR 4a — lynx renders tables and preformatted text

**Class:** Behavior change. **Required skills:** `tdd`, `testing`, `functional`; `refactoring`
after green; `mutation-testing` at PR readiness.

**Value:** A player reading a page with a table or a code block in lynx sees columns and the
block's own line breaks instead of one run-on line — for their own hand-written pages today, and
for 4b's menus, timetables and API examples.

**Path:** `lynx <url>` → `renderPage` (`ui/renderPage.ts`) → rendered lines in the lynx screen.
`curl` is unchanged (it prints source).

**Acceptance criteria:**
- [ ] A `<table>` renders one line per row, its cells aligned in columns padded to the widest cell
      of each column, separated by at least two spaces; a `<th>` row reads like any other row.
- [ ] A table is a block: blank line before and after, like a paragraph.
- [ ] A link inside a cell is numbered and followable, in reading order (row by row, left to right).
- [ ] Ragged rows (fewer cells than the widest row) render without error, short cells empty.
- [ ] `<caption>` renders as its own line above the table; `<thead>`/`<tbody>`/`<tfoot>` are
      transparent.
- [ ] A `<pre>` block keeps its text exactly: its line breaks and runs of spaces survive, no
      collapsing; leading and trailing blank lines inside it are dropped.
- [ ] A link inside `<pre>` is numbered and followable.
- [ ] A table or `<pre>` nested inside a `div` or list item renders the same way.
- [ ] Nothing else a page renders today changes (existing `renderPage.test.ts` stays green
      untouched); the module doc's "tables and preformatted blocks are absent deliberately" note
      is replaced by the new rule.
- [ ] `lynx`'s manual mentions tables and preformatted text.

**Evidence:** `renderPage.test.ts` (jsdom), one browser run of a hand-written table page via the
`v2-e2e` skill (the player's own `/var/www/html` edited with `nano`, read with `lynx
http://localhost`).

---

## PR 4b — A web server serves a site

**Class:** Behavior change. **Required skills:** `tdd`, `testing`, `functional`; `refactoring`
after green; `mutation-testing` at PR readiness.

**Value:** A player who finds `www-04` on `nmap` and opens it in lynx walks a site that belongs to
the place the network is — a café's menu, a company's services and team, an office wiki linking
the other intranet hosts — and a default `gobuster` against it turns up something no page links.

**Path:** `buildRemoteHostFs` (webserver role) → new `generation/webSite.ts` → files under
`/var/www/html` → `reachWebHost` (now resolving `.lan` names) → `curl` / `lynx` / link-following /
`gobuster` → `access.log` trace as today. Slice 3's `buildLogHistory` reads the built site for
`access.log.1`.

### The three layers

**1. The public tree — 4 to 12 pages, linked.** `index.html` links every public page (directly or
through a page it links); every public page links back to `/`. Shape keys on prefix × persona
category:

| Prefix | Site | Pages drawn from (examples) |
|---|---|---|
| `web-`, `www-`, `nginx-` | the place's public site | corporate: services, team, careers, news, contact · café: menu (table), hours (table), events, about · residential: a personal homepage, a few posts, links · university: department, courses (table), people, seminars · public: opening hours (table), notices, events, contact · iot: a home-automation dashboard, device list (table) · hacker: projects, meetups, wiki, contact |
| `portal-` | an intranet wiki | how-tos (with `<pre>` commands), team pages, a "services on the network" page linking every other LAN web host by `.lan` name and naming the file server and mail host by `.lan` name when the LAN has them |
| `api-` | an API with a doc page | `index.html` documents the endpoints (links, `<pre>` example responses); JSON files at `/api/v1/…` and `/health` that `curl` returns |

People appear by display name only (decision 5): the box's own inhabitant as webmaster or author,
and inhabitants of real neighbouring LAN boxes as staff/colleagues. Contact is a role mailbox on
`<slug>.lan` (a `mailto:` renders as text, never a numbered link — `resolveHref` already refuses
it).

**2. The breadcrumb layer.**
- `robots.txt` (most sites): `User-agent: *` and `Disallow:` lines, each naming a path the host
  serves — hidden-layer paths, and on a seeded share of sites one off-dirlist path (decision 4).
- `sitemap.xml` (some sites): one `<url><loc>` per public page, absolute, using the host's own
  `.lan` name (LAN) or IP (deep), with its real port when not 80. Hidden paths never appear.
- HTML comments on some pages naming a served path (`<!-- old site kept at /old/ until the
  migration is signed off -->`).

**3. The unlinked layer — 1 to 4 paths, from the default dirlist,** never linked from a page or
listed in the sitemap:

| Kind | Dirlist words it may use |
|---|---|
| a page in a directory (`<dir>/index.html`) | `old`, `staging`, `test`, `admin`, `dashboard`, `internal` — `old/` is a previous version of the site; `staging/`/`test/` a draft copy; `admin/`/`dashboard/` a login form that submits nowhere (decoration) |
| a text file | `notes.txt`, `todo.txt`, `readme.txt` (the webmaster's, by display name, naming true paths/hosts) |
| a status endpoint | `status`, `health`, `server-status`, `metrics` — version-free |
| `.env` | external-service keys only (fiction: payment/mail/analytics keys in shapes no in-game tool accepts); `APP_URL` is the site's own true URL; no DB password (decision 2) |
| `dump.sql` | schema-only snapshot of the box's real database (decision 6) — only when the box runs mysql |

The off-dirlist robots path (decision 4) is drawn from its own small pool of directory names
(`drafts/`, `archive-2025/`, `intranet-old/` …), each served with an `index.html`; a test pins
that no entry of that pool is on `DEFAULT_DIRLIST`.

### `.lan` names in web tools

`reachWebHost` resolves a LAN name (`resolveLanName`, generated hosts) before choosing the tree, so
`lynx http://www-04.<slug>.lan/`, a followed link written that way, and `gobuster` against a name
all reach the same box `curl` reaches. A name that does not resolve answers `(6) Could not resolve
host`, as today. The trace keys by the resolved address, as today.

### What "true" means here (decision 4, applied)

- **Every link** resolves (via `resolveHref` against the page's own URL) either to a path this host
  serves — read through `resolveWebPath` and the same fs view a fetch uses — or to a path served by
  a generated web host on the same LAN at the port it really listens on. `mailto:`/`#` are text.
- **Every `robots.txt` path and every sitemap URL** resolves the same way.
- **Every host named** in page text by `.lan` name or IP is a generated neighbour on the same LAN
  (never a player occupant, never a gateway); a named file server runs ftp, a named mail host is a
  mailserver-role box.
- **Hidden means hidden:** no hidden path is linked from any page or listed in the sitemap; each is
  on `DEFAULT_DIRLIST` or is the one off-dirlist path `robots.txt` names.
- **No account but root** under `/var/www` (the account-positions check from slices 2–3, extended
  to `mailto:`, `@<slug>.lan` addresses and `/home/<x>` paths); **no version** (decision 21); **no
  date after 2026-07-11**; **no unfilled slot** (`{{…}}`, `undefined`, `NaN`).
- **`dump.sql`** names exactly the tables and columns of the box's database, in its order.
- **`access.log.1`** lines on a webserver request public pages only, each with that page's size.

### Acceptance criteria

- [ ] Every webserver-role host (LAN and deep, every catalog and uncatalogued network) serves
      4–12 linked public pages under `/var/www/html`; `lynx` on `/` shows numbered links that
      open other pages of the same site.
- [ ] A `portal-` site links at least one other LAN web host by `.lan` name whenever the LAN has
      another web host, and following it in lynx opens that host's site.
- [ ] Every link, `robots.txt` path and sitemap URL on every webserver resolves (the property test
      over every network, replacing "never invites a reader to a path the host does not serve"),
      with the "recognises an unserved link" guard kept so it cannot pass vacuously.
- [ ] Every webserver serves 1–4 hidden paths; a sweep of `DEFAULT_DIRLIST` (through `sweepWord`,
      as gobuster does) finds at least one path on every webserver beyond `index.html`,
      `robots.txt` and `sitemap.xml`.
- [ ] A seeded share of `robots.txt` files names one served, unlinked, off-dirlist path; the share
      is pinned inside a band.
- [ ] `dump.sql` appears only on webservers running mysql and matches the database's schema, with
      no `INSERT`.
- [ ] `.env` holds no line naming a DB password, and its `APP_URL` is the site's own URL.
- [ ] No account but root, no version, no date after 2026-07-11, no unfilled slot anywhere under
      `/var/www` on any generated box (webserver or not).
- [ ] `lynx`, link-following and `gobuster` reach a LAN host by `.lan` name; an unknown name still
      answers `Could not resolve host`.
- [ ] Every other http host still serves exactly one page, now version-free; its pool widths stay
      pinned; the general-page md5 pin and the "leaks a version" test are replaced deliberately.
- [ ] `access.log.1` on a webserver requests only its public pages, each with the page's real size.
- [ ] Variety: within one network no two webservers serve a byte-identical page; across the
      catalog, ≥ 90% of `index.html` bodies on webservers are distinct (numbers confirmed at
      implementation and recorded in the as-built).
- [ ] Budgets hold: bundle and per-box build time under their ceilings (`npm run build`).

**Evidence:** property tests in a new `generation/webSite.test.ts` built inside each test (never a
file-level fixture cache — Stryker attribution); `webHost`/`lynx`/`gobuster` tests for name
resolution; a played run via `v2-e2e`: `nmap` a LAN → `lynx` a `www-`/`portal-` host → follow a link
across pages and to another host by name → `curl` `robots.txt` → default `gobuster` finds a hidden
path → `curl` it.

---

## Risks

- **Budget.** A webserver gains ~10–20 files; webservers are ~16% of drawn roles. Bundle growth is
  the new pools (estimate +10–15 KB gzipped). Both measured at PR readiness.
- **Pins.** The general-page md5, the pool-width `4`, and the version-leak test move; slice 3's
  `access.log.1` sizes now read the site. `falsehoodIn`'s `curl` rule (only `/` counts as served)
  stays correct because histories still curl `/` only.
- **Stream discipline.** The site draws only from `web-site-`; the `web-page-` draw stays exactly
  where it is for non-webservers, so no other host's page re-rolls.
