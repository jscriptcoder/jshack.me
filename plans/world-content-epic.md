# Epic: Generated World Content (v2) — every box reads as somebody's

> **Picking this up cold?** Read "Locked decisions", then the slice table — it carries the live
> status. The grounding section records what v2 held on the day this was grilled; the code wins
> wherever the two disagree.
> Grilled 2026-09-21 (`grilling`), 25 locked decisions. Slices 0–5 delivered (as-built below).
> Slice 6 is not yet planned.

**Where we are now (2026-09-22):** **v0.253.0**. The legacy-parity epic's V-series is closed and
its next line was "the ship gate". **Ship now waits for this epic** (decision 1). Grilled to 25
locked decisions and a twelve-slice spine. **Slices 0–5 are DONE** (#533, #534, #535, #536,
#537 + #538, #539) — the build budgets, NPC workstation homes, every NPC box's `/etc`, `/root`,
`.ssh/` and `/home/guest`, every NPC box's rotated `.1` history plus `syslog`, a three-layer site on
every webserver (with lynx tables/`<pre>` and `.lan` names in the web tools), and an application
in every NPC database; their as-built is folded into the slice spine and the "As-built" sections
below.
**Decision 19 was amended at planning** (budget first, memoize on breach) and **decision 6 was
narrowed at slice 2's planning** (the player workstation gains an empty `/home/guest`). Slice 3's
planning took three owner decisions (rotated logs name only root and the daemons, gateways wait
for slice 10, remote lines are neighbours doing routine things); slice 4's took six (recorded in
its as-built); slice 5's took four at planning (one amends decision 15) and one during the
build (recorded in its as-built). **Next: slice 6, a store serves that application** (not yet
planned).

---

## Why this epic exists

Every door the parity epic built — web, hydra, ftp, scp, daemons, nc, mysql, redis, snmp, node,
DNS, the CVE axes — shipped against a world furnished **thinly on purpose**. An owner decision of
2026-08-12 (`conventions-and-gotchas.md` §9, "Generated world content") made believable content
ONE design with one shape rather than a tax on each door: "a door slice does not invent its own
content system to have something to point at". The result is correct tools on empty boxes. The
first thing a player does after cracking in is `ls`, and today that shows a stranger's machine
with nothing in it.

The owner's intent, in their words: players should explore and feel that these machines **are (or
have been) used by users or NPCs**; content should fit the kind of machine (workstation, router,
switch, IoT, DNS, servers…); databases and Redis should hold data; boxes that run servers should
serve pages; and **variety matters above all**, so big pools are fine — "let's make it interesting
to explore networks".

## Parent capability

**A player who gets into any generated machine finds a box that reads as somebody's — its files,
logs, configs, mail, pages and data fit what the machine is, the organisation it belongs to and
the person who used it, and following anything it mentions leads somewhere real on that network.**

---

## Grounding (verified 2026-09-21)

- **A generated box is almost empty.** About 45–60 files, of which ~39 are binary and `.so` stubs.
  Real content is 3–12 files: ONE role config under `/etc` (5 templates for each of 6 roles; DNS
  boxes get `bind` zone files instead), ONE `index.html` (4 templates per bucket — general, iot,
  workstation — with the webserver, database, fileserver, mail and dns roles all on the general
  bucket), and the service data files. `/home/<user>` exists and is empty; **`/home/guest` is never
  stamped although `/etc/passwd` names it**; `/root` and `/tmp` are empty. There is no
  `.bash_history`, mail, cron, `/srv`, or `syslog` anywhere in generation.
- **Every log in a base tree is empty.** Lines arrive only as gameplay traces.
- **⚠️ The appenders read the writer's OWN patch row, not the base tree.** `appendMachineLog`
  (`core/patches/appendMachineLog.ts`), `appendAuthLog`, `appendKernLog`, `recordZoneTransfer` and
  their siblings do read-modify-write on `(machine_id, path, writer_key)` and start from `''` when
  no row exists (`api/sessions.ts` `readAuthLogVia`). History seeded into a LIVE log would vanish
  from view at the box's first trace. This forced decision 10.
- **MySQL and Redis already carry generated data, thinly.** One database per box: `users` always,
  plus 2–4 of 7 generic templates (`sessions`, `api_keys`, `config`, `audit_log`, `orders`,
  `employees`, `inventory`), a handful of rows each, emails on made-up domains (`company.local`,
  `corp.internal`, `acme.local`), timestamps in 2024. `users` has no password column. Redis: 8–15
  string keys from 16 weighted generators, 60% of stores locked. The pool header already locks
  "Every row here is INERT … no password in a table is a password anywhere in the world."
- **The SQL surface has no `LIMIT` and no `COUNT`**, so `SELECT *` prints every row; `KEYS *`
  likewise prints every key. Row and key volume is bounded by what a terminal can show.
- **Web hosts serve exactly ONE page, with no links.** The links were removed on 2026-08-13 because
  every advertised path 404'd ("the server lies"). The player's shipped
  `/usr/share/wordlists/dirlist.txt` already lists `admin`, `backup`, `robots.txt`, `.env`,
  `dump.sql`, `notes.txt` … and none of them exist anywhere. lynx renders headings, paragraphs,
  lists, anchors and `br` — **no `<table>`, no `<pre>`**.
- **v2 has no mtime concept.** `ls` prints no date column and patches do not track time, so a date
  exists only INSIDE content. Traces stamp the server's real UTC clock. `WORLD_EPOCH` is
  **2026-07-12** (`core/cve/worldClock.ts`).
- **Roles and sub-types.** Drawn roles and weights (`core/generation/machineRole.ts`): workstation
  32, iot 26, webserver 16, fileserver 12, database 7, mailserver 4, dns 3; `router` and `switch`
  come from the LAN KIND, not a draw. The hostname prefix already encodes a sub-type and
  `roleOfHostname` reads it back: workstation `desktop|laptop|android|iphone|tablet|workstation`,
  iot `cam|sensor|thermostat|doorbell|printer|tv|speaker`, webserver `web|www|portal|nginx|api`,
  fileserver `nas|files|share|backup|vault`, database `db|mysql|datastore|records|warehouse`,
  mailserver `mail|smtp|imap|relay|mx`, dns `dns|ns|resolver|bind`. Gateways carry a firmware
  vendor in their dpkg manifest (Phase 3 slice 9).
- **ESSIDs already fall into categories — as comments only** (`core/generation/generateWifi.ts`):
  corporate parody, café, residential, university, public infrastructure, IoT factory defaults,
  hacker-scene easter eggs. §9 already plans to turn the 50 fixed ESSIDs into procedural naming
  templates.
- **One user-tier account per box** (`/etc/passwd` is exactly root, one uid-1000 NPC, guest),
  drawn from a per-role username pool (`jsmith`, `mrodriguez`, `hkim` … or service names like
  `www-data`, `deploy`). Tier permissions do not isolate two user-tier accounts, by design.
- **Determinism.** Mulberry32 over an FNV-1a string seed, **one stream per concern** keyed
  `(essid, ip)` for NPCs (`host-fs-`, `svc-<service>-`, `etc-config-`, `web-page-`, `mysql-db-`,
  `redis-store-` …) and by ESSID, `(essid, octet)` or `(parentMachineId, octet)` for gateways. No
  generator takes a player identity. Adding a draw to an existing stream re-rolls what follows it
  — `host-fs-` holds the passwords, and tests pin them hash for hash. Changing a hostname pool
  changes machine ids and orphans journals.
- **The base tree is rebuilt on every call, everywhere, with no memoization** — client
  (`ui/activeRoot.ts`, `commands/webHost.ts`, local `nmap`) and server (session handlers,
  `scan/nmapScan.ts` builds one tree per LAN host per request). NPC trees never cross the wire
  (the server returns rendered text); only a workstation or AP-gateway tree is serialized
  (`network/resolveCrossPlayerFs.ts`, `treeCodec`), after tier filtering.
- **Bundle today:** main chunk 425,514 bytes raw / **134,282 bytes gzipped**; `generation/pools/`
  is ~60 KB of source.
- **Live logs are world-readable** (`AUTH_LOG_PERMISSIONS` reads `root|user|guest`).
- **Legacy had this, and it was repetitive.** Legacy (`src/generation/pools/filesystem.ts` and
  siblings) gave a box ~8–20 content files keyed by nine roles, from tiny pools (4–5 templates per
  log, 3–4 pages per role, 17 distinct dotfiles, a `.gitconfig` saying `admin@corp.local` on every
  box, `known_hosts` always `192.168.1.1`), log lines on random out-of-order days, config file
  names that did not match their content, and ~30% of boxes hiding real loot inside the "noise".
  It is inspiration, not a port (decision 16).

---

## Locked decisions (grill, 2026-09-21)

Decisions 1–12 were put to the owner one at a time and each answered. At decision 12 the owner
said **"from now on, follow your recommendation"**; decisions 13–25 are the recommendations
presented in the closing summary, which the owner confirmed as shared understanding. All 25 carry
equal weight.

### 1. Its own epic, and ship waits for it

This file, not a section of the 6,400-line parity epic. **Content is inside the ship gate.** Why:
an empty box undercuts every door already built; IoT overlays and prefix growth re-roll the world,
which is free only until the no-backward-compat licence sunsets at multiplayer announce; and
legacy had content, so parity arguably already included it.

### 2. Believability only — loot stays with missions

**No generated text pairs an account or service that exists in the game with a working secret.**
Secret-SHAPED values for things outside the game world are fine and add realism (an AWS key in
`~/.aws/credentials`, a payment-provider key in a `.env`, an SMTP password for an external relay)
because nothing in the game can test them, so they never lie. A web app's `.env` names its
database without a working password for the box's real `mysqld`. Harvestable credentials — D2.6b's
option set — are a MISSIONS concern, post-ship, where placement has a purpose. D2.6b's progression
job was already discharged by the CVE `password_reset` effect (parity decision 21).
**Accepted cost:** exploration pays in discovery and atmosphere, never in a credential; the
"found the password in a file" beat does not exist in this epic.

### 3. No new player verbs

No new commands, flags, SQL statements, SQL clauses or Redis types. Content fits the shipped
surface: one database per MySQL box read with `SHOW TABLES`/`DESCRIBE`/`SELECT`; string-valued
Redis keys read with `KEYS`/`GET` (structured values stay JSON strings, as the 16 generators
already do). **Plumbing a piece of content needs to be displayed honestly is not a verb** and is
in scope: lynx rendering `<table>`/`<pre>`, and stamping the `/home/guest` that `/etc/passwd`
already names. Refused under this rule, recorded so it is not re-asked: `SHOW DATABASES`/`USE`,
`LIMIT`/`COUNT`, Redis hashes/lists, `zcat`.

### 4. Every reference is true, within its network

**If content names a host, IP, hostname, `.lan` name, port, URL or path that would live in the
game, it exists.** `/etc/hosts`, `.ssh/known_hosts`, `.ssh/config`, `.bash_history`, crontabs,
app configs, intranet links, a router's DHCP leases — all true. This makes content a MAP: rooting
a router shows its real neighbours; a workstation's history points at the real file server.
Boundaries:
- References stay **inside the box's own network** — its LAN and its gateway chain. Naming other
  ESSIDs or public IPs is X2's discovery territory (deferred, ungrilled).
- References name **generated** hosts only, never player occupants: occupants come and go and a
  base tree is static. NPC octets are already excluded from leases, so a named neighbour is never
  displaced.
- Things outside the game (github.com, a vendor update URL, an external relay) are fiction and
  exempt.
- A person's NAME is not a world reference; fictional people are allowed (decision 12).
**Cost:** a box's generator reads its network's population (`generateHomeLan(essid)` / its deep
layer) rather than seeing only `(essid, ip)`.

### 5. History is frozen and ends at the epoch

Each box gets a seeded life — an install date months to years before `WORLD_EPOCH` (2026-07-12),
activity up to it, in **chronological order on one calendar** — and afterwards only what players
cause. The base tree stays a pure function of the box's coordinates, so client and server cannot
disagree about what day it is, and it fits the whole-file patch model (living content would be
frozen into the first trace's row and hidden behind it). Living NPC activity belongs to the future
NPC-maintainer actors. **Accepted cost:** as game days pass, every NPC box reads as abandoned at
2026-07-12 — "have been used", never "in use today".

### 6. Every generated machine — never a player workstation

NPC hosts of every role on every layer (the deep builder is the LAN builder, so deep hosts come
free), and every gateway kind: AP gateway, inner router, inner switch, deep routers and switches.
**Player workstations stay a fresh install**: the player IS that box's user, so a stranger's
history there would lie about whose box it is. The AP gateway gets modest content because its tree
is serialized over the wire.

### 7. Role pools, prefix overlays, gateway vendors — no new roles, prefixes may grow

Content keys on the role, with a **prefix-level overlay wherever the prefix names a genuinely
different device**: a printer has spool jobs and a CUPS page, a camera has a recordings index and a
viewer page, a phone has `DCIM/` and `Download/` rather than dotfiles, `nginx-` gets nginx config
not apache, `api-` serves JSON. Synonym prefixes (`nas`/`files`/`share`) share the role pool.
**Gateways key on kind + firmware vendor.** **No new roles** — a role drives service placement and
rates, which is balance, not content. **Prefix lists may grow within a role** (e.g. iot gains
`plug`, `lock`, `nvr`, `babycam`): more device types is more variety. **Accepted cost:** that
re-rolls hostnames → machine ids → orphans existing journals, and every pin, wire-check host
selection and the `v2-e2e` skill's offline-derived secrets must be refreshed. It runs LAST
(slice 9) so the refresh happens once.

### 8. Content comes from a network persona plus a box inhabitant

- **Network persona**, keyed on the ESSID's category — promoted from a code comment to DATA so it
  survives the procedural-ESSID item — gives an organisation, a kind of place and its vocabulary.
  On a corporate-parody network the mail, wiki, DB rows and print jobs belong to one company; on
  a café network it is a till database, a menu page and a staff rota. This is the main source of
  variety BETWEEN networks.
- **Box inhabitant**, derived from the box's existing username (`mrodriguez` → Maria Rodriguez):
  her `.gitconfig`, history, notes, crontab, mail signature and DB `created_by` agree. Service
  accounts (`www-data`, `deploy`) get an operator persona whose name appears in their history.
- Colleagues who are named are real inhabitants of neighbouring boxes wherever the content names
  a host (decision 4).
- Roles stay drawn blind to the persona (decision 7), so **the persona adapts to what was drawn**:
  a café that rolled a mail server has a mail server.

### 9. Full breadth, volume scaled by role

| Category | What it holds |
|---|---|
| Home | dotfiles, `.bash_history`, `.ssh/config` / `known_hosts` (true), documents (notes, todo, drafts, meeting notes, CVs), `Downloads/`, small project trees; phones get `DCIM/` / `Download/` |
| `/root` | root's own history and notes — the reward for escalating |
| `/etc` | several real configs per role: `hosts`, `resolv.conf`, `fstab`, `motd`, `crontab`, service configs matching what dpkg says is installed |
| Logs | frozen history (decision 10) plus a new `syslog` |
| Mail | `/var/mail/<user>` on workstations; the organisation's spool on mail servers — threads between real inhabitants |
| Spools | cron, print jobs (printers), recordings index (cameras) |
| `/srv` | fileserver department folders and backup archives, inert names and contents |
| Web | multi-page sites (decision 11) |
| MySQL / Redis | app archetypes (decision 12) |
| Gateways | DHCP leases, config backups, admin UI pages, admin/firmware history |
| Metadata docs | PDF, JPEG and `.docx` stubs whose embedded metadata `strings` can read (author, camera model) — flavour only |

**Content files per box, excluding binary stubs:** desktop/laptop 25–60 · phone/tablet 10–25 ·
servers 20–50 (fileservers up to ~80) · IoT 6–15 · inner/deep gateways 8–15 · AP gateway 5–10.
**Out:** real git object stores, generated binaries beyond the existing stubs, encrypted `.gpg`
files (they would invite brute force against nothing).

### 10. History lives in rotated logs; live logs start empty at the epoch

logrotate ran at 2026-07-12. `auth.log.1`, `syslog.1`, `kern.log.1`, `access.log.1`,
`mail.log.1`, `mysql.log.1` … hold the frozen history, in order, ending at the epoch; the live
files hold only what players did since. **Zero server change** — none of the appenders is touched,
so no wire-check risk and no multi-writer merge rule. A defender reading a live log sees real
events, not noise. **Plain text only** (`.1`, perhaps `.2`) — no `.gz`, because `zcat` would be a
verb. **No `dpkg.log` history**: its lines carry versions (decision 21). **Accepted cost:** `cat
/var/log/auth.log` on an NPC box is empty until somebody acts; the life is one `ls /var/log` away.

### 11. A web host serves a three-layer site

1. **The public tree** — 4–12 linked pages shaped by role, prefix and persona: a company site or
   café menu on `web-`/`www-`, an intranet wiki on `portal-` linking the real LAN file share and
   mail host, JSON endpoints on `api-`, status/login pages on IoT and gateways (CUPS on printers,
   a camera viewer, a router admin page). Login forms are decoration — submitting would be a verb.
2. **The breadcrumb layer** — `robots.txt` `Disallow` lines, `sitemap.xml`, HTML comments; every
   path or host they name is served (decision 4).
3. **The unlinked layer** — each web host serves a seeded few paths **drawn from the shipped
   dirlist** (`backup/`, `old/`, `notes.txt`, `.env`, `dump.sql` …) so the default `gobuster`
   sweep pays off. Inert (decision 2): the `.env` holds external keys; `dump.sql` is a snapshot of
   the box's own tables.

The pinned "no page links a path its host does not serve" test grows into: every link, `robots.txt`
path and sitemap URL resolves on this host or on a real web host of the same network. lynx gains
`<table>`/`<pre>` in whichever slice first needs them. **Rejected alternative** (recorded):
off-dirlist paths revealed only by a breadcrumb on another box.

### 12. A database or store holds an application

The box's role, prefix and network persona pick an **app archetype**, which names the schema and
the database: CRM or helpdesk on a corporate webserver (`accounts`, `contacts`, `tickets`,
`ticket_comments`), point-of-sale on a café network (`menu_items`, `orders`, `order_lines`,
`shifts`), CMS on `portal-` (`posts`, `comments`, `pages`), telemetry for an IoT backend
(`devices`, `readings`, `alerts`), a mail directory on a mail server (`domains`, `mailboxes`,
`aliases`). **Redis follows the same app when a box runs both** — session keys for that app's real
users, cache entries for its real rows, queues, rate limits, feature flags, all JSON strings.
People in rows mix the network's real inhabitants (the helpdesk agent IS `mrodriguez`) with
fictional customers. **Volume:** 4–8 tables of 5–40 rows (no `LIMIT`), 20–80 Redis keys. **Any
password-hash column holds values no in-game tool reverses to a pool word** — a `john` that
cracked a plaintext which works nowhere would be decision 2's lie in a new place.

### 13. Permissions follow Debian

A content file takes the tier its real counterpart has. Homes and mail are user-tier (`HOME_DIR`
already keeps guest out); `/root` and private service data are root-only; `/etc`, web and `/srv`
are world-readable. **Rotated logs copy their live log's permissions exactly** (world-readable
today). `/home/guest` is stamped, thin, guest-tier. Escalation pays in content: guest sees the
surface, user sees a person, root sees the box's history.

### 14. One account per box stays

`/etc/passwd` stays three rows; hydra's sweep and the measured difficulty knobs (npcUser 0.70,
npcRoot 0.12, gateway 0.40) are untouched. Other people exist only as references.

### 15. Every content concern draws from its own new stream

Keyed like its siblings — `(essid, ip)` for NPCs, the gateway's own key for gateways. **No existing
stream gains a draw**, so no password, service, role or page already pinned re-rolls. The one
accepted re-roll is decision 7's prefix growth.

### 16. Pools are authored fresh, as static data

Static TypeScript data under `core/generation/`: slot templates filled from the two personas, plus
hand-written text, sized for variety. Legacy's pools are inspiration only (tiny, and flawed in the
ways the grounding lists). No text is synthesized at runtime.

### 17. Variety has a test

Within one network, no two boxes share a byte-identical free-text file (notes, history, mail,
pages, docs). Across many sampled networks, each category meets a minimum distinct-body ratio
(planning sets the numbers). Files that are shared BY DESIGN — they state one fact of the network,
like `resolv.conf` — are exempt because they are facts, not text.

### 18. A bundle budget

Generation stays synchronous and the pools ship in the main bundle. **The epic may grow the main
chunk by at most 150 KB gzipped** (134 KB today), enforced by a size check that lands in slice 0.

### 19. Memoize the base tree first — ⚠️ AMENDED at planning, see below

A behaviour-preserving slice keyed by machine identity, plus a per-box build-time budget, lands
BEFORE any volume grows — every rebuild site on both ends pays for content otherwise.

**Amended at planning (2026-09-21): the budget lands first; memoization waits for a breach.**
Measured across all 50 catalog networks: **~0.13 ms per box to build, ~0.18 ms per
`generatedBaseFsForMachineId` lookup** (415 boxes, 21,249 files, ~55 ms in total), so a server
`nmap`'s whole LAN costs ~2 ms. A cache (key scheme, bound, serverless lifetime, a no-mutation
argument) would buy time nobody can observe. The per-box build-time budget is what protects every
rebuild site; the slice that breaks it adds memoization with a measured reason. Sharing trees stays
safe for that day — `applyPatches` copies every map it touches. Both budgets run as a `postbuild`
script, not a vitest test: Stryker runs the whole suite under instrumentation and aborts its dry run
on any failure, so a wall-clock assertion there would break mutation runs.

### 20. The persona's domain is the network's `.lan` zone

Mail addresses and app domains use the zone X1 already resolves (`mrodriguez@<essid-slug>.lan`,
`wiki.<essid-slug>.lan` only if that name resolves). No invented public domains — those are X2's.
The generic `company.local` / `corp.internal` / `acme.local` domains in today's DB pool retire.

### 21. Content is version-free

No `Apache/2.4` footer, no versioned config comment, no version in a page, banner or history line.
`/var/lib/dpkg/status` stays the single source of truth for every version (parity Phase 3).

### 22. One calendar

Every date inside content — log lines, mail headers, history timestamps, DB `created_at`, document
metadata — falls within the box's seeded life, which ends at `WORLD_EPOCH`. Today's 2024-stamped
DB rows move onto it.

### 23. Pins are updated deliberately; rule-pins become property tests

Exact-tree and hash pins for generated boxes (e.g. the general-page md5, the exact top-level
directory lists) are updated on purpose where content lands; the player workstation's exact-tree
pin stays true, because decision 6 keeps that box a fresh install. Pins that encode a CONTENT RULE — no dead links, no unfilled `{{…}}`, no DB
data at the no-session tier, every pool entry reachable — become or extend property tests.

### 24. The docs follow

The §9 "Generated world content" backlog entry is superseded by this epic, and the parity epic's
"Next is the ship gate" line points here.

### 25. The slice spine

See below; planning refines it.

---

## Forced rather than chosen (planning should not re-litigate)

- **Rotated logs** are forced by the appenders reading the writer's own row (grounding). Seeding
  live logs means changing ~ten server writers and inventing a merge rule.
- **New streams** are forced by the hash-for-hash password pins: a draw added to `host-fs-`
  re-rolls every password in the world.
- **Memoization before volume** is forced by the rebuild-per-call architecture: `nmapScan` builds
  one tree per LAN host per request.
- **Version-free content** is forced by Phase 3's single-source rule for versions.
- **Frozen history** is forced as much as chosen: a patch holds a whole file, so a day-varying base
  would be frozen into the first trace's row.
- **Plain-text rotations** are forced by decision 3 (`zcat` is a verb).

## Out of scope (refused or deferred)

- **Loot / harvestable credentials** — missions (decision 2).
- **New verbs** — `SHOW DATABASES`/`USE`, `LIMIT`/`COUNT`, Redis hashes/lists, `zcat` (decision 3).
- **Living NPC activity** — future NPC-maintainer actors (decision 5).
- **Player workstation starter content** — authored onboarding, a separate design (decision 6).
- **New roles** — balance (decision 7).
- **References across networks** — X2 (decision 4).
- **Multiple accounts per box** (decision 14).
- **Encrypted `.gpg` files, git object stores, new binaries** (decision 9).

---

## Slice spine (each vertical + observable; walking skeleton first)

| # | Slice | Observable | Status |
|---|---|---|---|
| 0 | **The world stays cheap to build and to ship** — the per-box build-time budget and the bundle size check, as a `postbuild` script (memoization deferred until a breach — amended decision 19) | `npm run build` prints both numbers against their ceilings and fails when either breaks | ✅ DONE (#533) — `scripts/checkBudgets.ts`; bundle ceiling 284,975 B, build ceiling 2 ms/box; enforced on local `npm run build` only (Vercel builds the frozen root app) |
| 1 | **A workstation reads as somebody's** — network persona (ESSID category as data) + box inhabitant; a workstation's home gets dotfiles, a history true to its network, notes; the first variety test | `ssh` into an NPC workstation as its user → `ls -a ~` → `.bash_history` names a real neighbour that `nmap`/`ssh` reach; `.gitconfig` names the inhabitant | ✅ DONE (#534, v0.248.0) — see as-built below |
| 2 | **A box admits what it is** — `/etc` breadth, `/root`, `/home/guest` | `/etc/hosts` lists real neighbours; `su` → `/root` holds root's history | ✅ DONE (#535, v0.249.0) — also took `.ssh/` and an empty `/home/guest` on the player box; see as-built below |
| 3 | **A box remembers** — rotated `.1` log history across every role, plus `syslog` | `ls /var/log` shows `auth.log.1`; its last line is before 2026-07-12; the live `auth.log` holds only player traces | ✅ DONE (#536, v0.250.0) — NPC hosts only (gateways → slice 10); `.1` holds 2026-07-11 alone; see as-built below |
| 4 | **A web server serves a site** — three layers, lynx `<table>`/`<pre>`, the link-resolution property test | lynx follows links across pages; `robots.txt` names a served path; a default `gobuster` finds a hidden path | ✅ DONE (#537 v0.251.0, #538 v0.252.0) — webservers only; other http hosts keep one version-free page; see as-built below |
| 5 | **A database holds an application** — app archetypes | `SHOW TABLES` on a café network's DB shows a till schema whose staff are that network's inhabitants | ✅ DONE (#539, v0.253.0) — 15 archetypes; decision 15 amended (DB credentials re-rolled once); a bought DB is a fresh install; see as-built below |
| 6 | **A store serves that application** — Redis keyspaces paired with the app | `KEYS sess:*` returns sessions for that app's real users | ⏳ |
| 7 | **Somebody wrote to somebody** — workstation mailboxes, the mail server's spool | a thread in `/var/mail/<user>` is between two real inhabitants of the network | ⏳ |
| 8 | **A share holds a department** — fileserver `/srv`, metadata docs | `strings` on a shared PDF names its author, an inhabitant | ⏳ |
| 9 | **A device is the device it says** — IoT prefix overlays + prefix growth (the one re-roll: refresh pins, wire-checks, the `v2-e2e` skill) | a printer serves a CUPS page and holds spool jobs; a camera a recordings index | ⏳ |
| 10 | **A gateway knows its network** — DHCP leases, config backups, admin pages, admin/firmware history | a rooted router's lease table lists exactly the network's generated hosts | ⏳ |
| 11 | **A phone is a phone** — phone/tablet overlay | an NPC `android-` home holds `DCIM/` and `Download/`, not dotfiles | ⏳ |

## As-built: slices 0–1 (delivered 2026-09-21)

Retired here from `a-workstation-reads-as-somebodys.md` on close-out.

**Slice 0 — build budgets (#533).** `v2/scripts/checkBudgets.ts` runs as `postbuild` and fails the
build on either breach: the gzipped main chunk over **284,975 B** (134,975 baseline + the 150 KB
allowance) or the 50 catalog networks averaging over **2 ms per box** (615 boxes, ~0.15 ms measured)
through `generatedBaseFsForMachineId` plus the AP gateway direct. It is a script, not a vitest test,
so Stryker's dry run never trips on a wall-clock assertion. **Only local `npm run build` enforces
it** — the Vercel project builds the frozen repo root, so no deploy runs it. Conventions §3 names it.
No memoization was needed (amended decision 19 held).

**Slice 1 — NPC workstation homes (#534, v0.248.0).**
- New: `generation/persona.ts` (`networkPersona` — category/place/`.lan` domain, seeded for
  uncatalogued ESSIDs; `inhabitant` — full name fitting the username + email on the domain),
  `generation/npcHome.ts` (`buildNpcHome`, wired into `buildRemoteHostFs`; exported pure
  `machineCommandOptions`), and pools `essidCatalog.ts`, `people.ts`, `homeSkeleton.ts`,
  `homeNotes.ts` (84 note templates, 12/category), `homeHistory.ts` (150+ line templates).
  `npcUsername` extracted from `buildRemoteHostFs`; `HOME_FILE` added to `baseFs.ts`.
- Homes go to `desktop|laptop|workstation` NPC boxes on every layer: `.bashrc`/`.profile`/
  `.bash_logout`/`.bash_history`/`.gitconfig` + `notes/` (2–5). Phones, tablets, all other roles and
  the player's box keep empty homes. Deep desktops get a home but name no neighbour (byte-stable
  regardless of a hanging child). History network lines name real neighbours in v2 syntax; gateways
  by IP only.
- Three new streams: `network-persona-<essid>`, `inhabitant-<essid>-<ip>`, `home-content-<essid>-<ip>`.
  No existing pin moved; `crackableEssidPool` derives from `ESSID_CATALOG` in the exact scan order
  (pinned by test). Variety measured 100% distinct across the 41 catalog desktops. Bundle +9.9 KB.
- Mutation: scoped battery on `persona.ts`+`npcHome.ts`; selection-logic survivors hand-verified
  killed (Stryker mis-attributes this file's property tests); remaining survivors are pool/flavour
  text and equivalent mutants. Played via `v2-e2e`: cracked BEAN-THERE-WIFI, `ssh` to laptop-74 as
  tnguyen (Tomas Nguyen), replayed `curl http://nginx-229.bean-there-wifi.lan/` — the neighbour
  answered.

**Resolved from "Open for planning":** the variety numbers (98% histories / 90% notes across the
catalog; no within-network duplicate history/gitconfig/note); the build-time budget number (2 ms/box);
the persona data shapes (`EssidCatalogEntry` = essid/category/place; procedural ESSIDs seed a category
from `network-persona-<essid>`); `HOME_FILE` added to `baseFs.ts` for home files.

## As-built: slice 2 (delivered 2026-09-21)

Retired here from `a-box-admits-what-it-is.md` on close-out.

**Slice 2 — a box admits what it is (#535, v0.249.0).**
- New: `generation/etcContent.ts` (`buildEtcContent` — never handed the account, so no
  world-readable file can name it), `generation/rootHome.ts` (`buildRootHome`),
  `generation/sshContent.ts` (`buildSshDirectories` — root's and the desk owner's `.ssh/` from one
  stream, root first), pools `etcFiles.ts` (28 motd banners, 4 per category; generic, per-service
  and name-server cron jobs; Debian crontab/fstab/hosts stock text) and `rootContent.ts` (Debian root
  dotfiles, 54 generic + 49 role-flavoured history lines, 12 root note templates).
  `isOnHomeLan` moved into `generateHomeLan.ts`; `npcHome.ts` now exports `isDeskMachine`,
  `pastDate`, `fillSlots` and `networkLines` for reuse. `/var/log` entries are built as one `logs`
  value in `buildRemoteHostFs` so root's history names exactly the logs a box writes.
- Every NPC box (all roles, LAN and deep): `/etc/{hostname,hosts,resolv.conf,fstab,crontab,motd}`
  (`SERVICE_CONFIG_FILE` tier); `/root/{.bashrc,.profile,.bash_history}` + 0–2 notes (new
  `ROOT_FILE`); `/home/guest` with the Debian skeleton (new `GUEST_HOME_DIR`/`GUEST_HOME_FILE`,
  guest reads and writes). LAN boxes with an ssh-running neighbouring machine: `/root/.ssh/known_hosts`
  (1–4 entries, `[ip]:port` off port 22) and, on desks, `~/.ssh/{known_hosts,config}` (a drawn
  `Host *` defaults block + 1–2 shortcuts with the neighbour's real account). Deep boxes: `hosts`
  names only themselves, `resolv.conf` has no `search`, no `.ssh/`, no network history line.
- Player workstation: an empty guest-tier `/home/guest` (its exact-tree pin updated).
- Three new streams: `etc-content-`, `root-content-`, `ssh-content-` (all `<essid>-<ip>`). No
  password, username, service, role-config or page pin moved; the role-config test helper now sets
  aside the files every box keeps.
- Tests live in `generation/boxSurface.test.ts`; the shared world-content test helpers
  (`lanBoxes`, `deepBoxes`, `filesUnder`, `serialise`, `falsehoodIn`, `softwareVersionsIn`) moved to
  `src/test/worldContent.ts`. Variety: no within-network duplicate motd, root history, root note or
  `.ssh/config`; ≥ 95% root histories and ≥ 90% root notes distinct across the catalog.
- Budgets after: bundle 150,300 B gzipped (+5.4 KB), 0.334 ms/box.
- Mutation (scoped `etcContent`+`rootHome`+`sshContent`): 240 killed / 24 survived (90.9%), 0
  timeouts, before follow-up tests whose five target mutants were hand-verified killed; the rest are
  random-rate thresholds and equivalent mutants. Played via `v2-e2e` on VANDELAY-INDUSTRIES: guest on
  `workstation-31` landed in `/home/guest`; `/etc/hosts`, motd and `resolv.conf` read true;
  `jchen`'s `.ssh/config` named neighbours' real accounts; root's `systemctl status sshd` and
  `ssh dbuser@records-206` replayed true.

**Resolved from "Open for planning":** permission constants for `/etc`, `/root`, `.ssh/` and
`/home/guest` (above).

## As-built: slice 3 (delivered 2026-09-21)

Retired here from `a-box-remembers.md` on close-out.

**Slice 3 — a box remembers (#536, v0.250.0).**
- New: `generation/logHistory.ts` (`buildLogHistory` — reads the box's `/etc/crontab`, `/etc/fstab`,
  served page and database as built, so the history and the box cannot disagree) and pool
  `pools/logLines.ts` (daily systemd timers, per-service unit descriptions, a version-free kernel
  boot, redis save rules). New formatters in their own log's module: `formatRootSessionLine`
  (`authLog.ts`), `formatKernelLine` (`kernLog.ts`), `formatNamedControlLine` +
  `formatNamedZoneLoadedLine` (`namedLog.ts`), `formatRedisNoticeLine` (`redisLog.ts`);
  `SYSLOG_PERMISSIONS` in `syslog.ts`; `ZONE_SERIAL` exported from `generateDnsZone.ts`.
  `buildEtcContent` now returns a typed `EtcContent`; `buildRemoteHostFs` builds the page, the
  database and `/etc` once each as values.
- Every NPC box (all roles, LAN and deep): live `syslog` (empty) and `syslog.1`; `auth.log.1`,
  `kern.log.1`, `access.log.1`, `mysql.log.1`, `redis.log.1`, `named.log.1` where their rules put
  them. All `.1` lines are dated 2026-07-11 in order; a `.1` exists only when it holds a line and
  only beside its live log, with that log's permissions. CRON lines are the crontab's own jobs at
  every Saturday firing, with root PAM sessions around each; ~15% of boxes restart (kernel boot
  naming `/boot/vmlinuz` and the fstab root UUID, systemd starting exactly the running services,
  sshd listening on its real port); 0–3 root ssh logins from real LAN neighbours where sshd runs;
  `GET /` sized to the served page; root@127.0.0.1 queries (`SHOW TABLES`/`DESCRIBE`/`SELECT`) on
  the real tables; redis save cycles and clients; a name server's `rndc reload` at the zone
  file's serial. No line names an account but root; deep boxes name only `127.0.0.1`.
- **Deviations from the plan:** `named.log.1` carries **no lookup lines** — the live `named.log`
  deliberately does not log ordinary lookups (BIND's query log off), so a history of queries
  would contradict it. `vsftpd.log.1` never exists, as planned (every routine ftp line names an
  account).
- One new stream: `log-history-<essid>-<ip>`. No existing pin moved; root histories may now name
  the new logs (slice 2 derives its log reads from `/var/log`).
- Tests live in `generation/boxMemory.test.ts` (25 property tests over every catalog and
  non-catalog network, LAN and deep). Variety: no within-network duplicate `.1`; ≥ 95% of
  `syslog.1` and ≥ 90% of `auth.log.1` distinct across the catalog. **Lesson:** the population is
  built inside each test, not cached — a file-level cache let Stryker's per-test coverage credit
  the whole builder to the first test only (68 killed / 218 survived, a false picture).
- Budgets after: bundle 152,977 B gzipped (+2.7 KB); build ~0.2–0.3 ms/box above the same-machine
  baseline (0.73–0.98 vs 0.57–0.59 ms/box on a loaded run), under the 2 ms ceiling.
- Mutation (scoped `logHistory.ts` + the new formatters): 275 killed / 11 survived / 7 no coverage
  (93.9%), 0 timeouts; the rest are equivalent (destructuring defaults, regex anchor, `<=` on a
  float draw, seed text) or random-rate/range edges. Played via `v2-e2e` on CASA-DE-RAMIREZ
  `records-170`: `ls /var/log` showed the rotations; the live `auth.log` held only the player's
  login; `syslog.1` ended on Jul 11 with the crontab's jobs at their minutes; the admin login's
  source answered `ping`; `mysql.log.1` named the real database. **Found:** v2 has no `tail`
  (and `grep` has no `-c`) — tracked in `v2/docs/conventions-and-gotchas.md` §9.

## As-built: slice 4 (delivered 2026-09-21/22)

Retired here from `a-web-server-serves-a-site.md` on close-out. Two independent PRs in order.

**Owner decisions at planning** (2026-09-21): (1) the three layers go on webserver-role hosts only;
every other http host keeps one page, rewritten version-free (IoT → slice 9, gateways → slice 10);
(2) cross-host links use `.lan` names and the web tools resolve them; deep sites link only
themselves and name themselves by IP; (3) two PRs, in order; (4) `robots.txt` may `Disallow` one
served off-dirlist path; (5) pages name people by full name and role mailboxes, never a username
(no account but root under `/var/www`); (6) `dump.sql` is schema-only.

**Slice 4a — lynx renders tables and preformatted text (#537, v0.251.0).**
- `ui/renderPage.ts`: a `<table>` renders one line per row, each column padded to its widest cell
  (measured after link numbering, so `[12]` counts), two spaces apart; each table aligns on its
  own; short rows widen columns without trailing padding; `<caption>` is its own line;
  `thead`/`tbody`/`tfoot` are transparent. `<pre>` keeps spacing and inner blank lines, dropping
  blank edge lines; links in either are numbered and followable. Both render nested in a `div` or
  list item. lynx's manual updated.
- Mutation (scoped `renderPage.ts`): 403 killed / 6 survived / 6 no coverage (97.1%) — survivors
  equivalent, no-coverage are unreachable `?? []` fallbacks. Played on the player's own nginx page.

**Slice 4b — a web server serves a site (#538, v0.252.0).**
- New: `generation/webSite.ts` (`buildWebSite({ essid, host, port, database })` → files plus the
  public paths) and static pool `pools/webSites.ts`. `buildRemoteHostFs` publishes the site as a
  nested `/var/www/html` tree (`WEB_PAGE_FILE` / `TRAVERSABLE_DIR`) when the role is webserver and
  http is served; every other http host keeps one `pickWebPage` page. `reachWebHost` resolves a
  `.lan` name through `resolveLanName`, so lynx, followed links and gobuster reach the box `curl`
  reaches; an unknown name answers `Could not resolve host: <name>`. `buildLogHistory` takes
  `pages` (path + size), so `access.log.1` requests real public pages at their real sizes.
- **Public tree, 4–12 pages** reachable from `/`, each linking home, navigation opening with
  "Home" and naming pages by their heading; titles `<Page> — <Site>`, every page signed "Page
  maintained by <inhabitant>." Shapes: public site = front pages + the category's pages + shared
  pages (`team.html` on corporate, `people.html` on university); `portal-` = `services.html` (a
  true Web / File server / Mail table of neighbours by `.lan` name, port only when non-standard,
  "Nothing else on the network is listed yet." when empty) + `team.html` + intranet pages; `api-` =
  a reference index with the status endpoint as its worked example, JSON at `/health`,
  `/api/v1/status` and category endpoints.
- **Breadcrumbs:** `robots.txt` on ~80% of sites (51 of 66 catalog webservers), 30% of those also
  `Disallow` one off-dirlist directory (16); `sitemap.xml` on ~50% (31); one HTML comment naming a
  served path on ~50% (33), never more than one page.
- **Hidden layer:** 1–4 servable dirlist words (`old/`, `staging/`, `test/`, `admin/`,
  `dashboard/`, `internal/` with their own `index.html`; `notes`/`todo`/`readme.txt`;
  `status`/`health`/`server-status`/`metrics`; `.env` with inert external keys and the site's own
  `APP_URL`; `dump.sql`).
- **Deviations from the plan:** `webmaster@` is not a mailbox — `webmaster` is a webserver
  username, so the contact is `helpdesk@` (with `info@`, `jobs@`, `orders@`, `admissions@`).
  `dump.sql` is **always** present on a mysql webserver rather than drawn (the draw left it too
  rare to find). `sitemap.xml` has no XML declaration or `xmlns` — `1.0`/`0.9` read as versions to
  `softwareVersionsIn`. Every `pools/webPages.ts` bucket lost its versions (general-page md5 pin
  moved to `eccc0547…`), and prices are whole euros for the same reason.
- One new stream: `web-site-<essid>-<ip>`; non-webservers keep `web-page-` and no other stream
  moved (draws made conditional where `prng.pick` would consume one on a length-1 list).
- Tests in `generation/webSite.test.ts` (~37 property tests, built inside each test): no dead link,
  robots path or sitemap URL on any webserver; only self and real neighbours named; no account but
  root, no version, no slot, no date after the epoch; hidden paths unlinked and swept; `dump.sql`
  matches its database's schema; share bands. Variety: **66 of 66** catalog front pages distinct,
  even with site, place and author stripped; no byte-identical page between webservers of one
  network.
- Budgets after: bundle 165,173 B gzipped (+11.6 KB); build 0.436 ms/box on a quiet run, under
  the 2 ms ceiling.
- Mutation (scoped `webSite.ts`, the `webHost.ts` change, touched `remoteHostFs.ts`/`logHistory.ts`):
  481 killed / 66 survived / 1 no coverage (87.8%) — survivors are fixed markup text, equivalent
  share comparisons and page-count arithmetic that stays in bounds.
- Played via `v2-e2e` on OMNI-CORP (v0.252.0): `nmap` found `portal-189` (:8080) and `portal-193`
  (:80); lynx on `portal-189` → Services → followed `portal-193.omni-corp.lan` into the other
  portal, whose Services linked back to `portal-189.omni-corp.lan:8080`; `robots.txt` named
  `/readme.txt`, `/health`, `/test/` and the off-list `/archive-2025/`; a default `gobuster` by
  `.lan` name found `/health`, `/test/`, `/old/` (unlisted in robots), `/readme.txt` and more;
  `curl` of each returned its promised content, and `/readme.txt` named only served pages.

## As-built: slice 5 (delivered 2026-09-22)

Retired here from `a-database-holds-an-application.md` on close-out. One PR (#539, v0.253.0).

**Owner decisions.** At planning (2026-09-22): (1) **decision 15 amended**: `mysql-db-<essid>-<ip>`
draws only a database's accounts, in the old ladder order, and a new `db-app-<essid>-<ip>` stream
draws the application, so every NPC database password re-rolled once; (2) a bought database is a
**fresh install**; (3) every archetype keeps `users` with a bcrypt-shaped `password_hash`; (4) site
↔ database agreement deferred; plus money as whole euros (`INT`), so the version scan covers
every cell. During the build: (5) **a LAN `users` table holds everyone and has no floor**: the
box's own account plus the distinct account of every other machine on the LAN (3–8 rows), because
every login is somebody whose box `nmap` shows. The 5–40 floor applies to the tables beyond `users`.

**What shipped.**
- `generateDatabase.ts`: `drawDatabaseCredentials(seed)` (root, one `MYSQL_USERNAMES` account, a
  read-only one half the time; crack ladder unchanged) and the people: LAN neighbours via
  `npcUsername`, or 4–9 logins from `usernamePool(role)` on a deep box, never its own account.
- `databaseApp.ts`: `usersRows` (installed 400–1,500 days before the epoch, the admin at install,
  everyone else joining later, sorted), the selection rule (`databaseArchetype`: `portal-` → cms,
  `api-` → api, mailserver → mail, else `networkArchetype(essid)` drawn once on
  `db-app-network-<essid>` from `ARCHETYPES_BY_CATEGORY`), and the row engine. It builds tables in
  declared order: a `ref` picks an existing row and lifts the child's earliest moment to the
  parent's, rows are dated then sorted then numbered, and `code` columns count up with the id.
  Workstations get `<name>_dev` with 5–12 rows per table; everything else 6–40, capped by any
  unique pool.
- `pools/databaseApps.ts`: 15 archetypes as data (`Fill`: serial, stamp, ref, pick, unique, int,
  flag, person, code): helpdesk, crm, stock, till, media, household, enrolment, library, bookings,
  telemetry, scoreboard, wiki, cms, api, mail. Required tables come first; optional ones are drawn
  (up to 8 tables).
- `mysql/ownDatabase.ts`: one `users` row for the owner, `<user>@<hostname>`, dated at purchase
  (apt's `PackageFileContext` gained `now`), credentials on `mysql-db-own-<pubkey>`, root mirrors
  the box. `pools/database.ts` now holds only `MYSQL_USERNAMES`.
- **Retired:** the seven generic templates, the `DB_NAME_PREFIXES`/`SUFFIXES` name draw,
  `company.local` / `corp.internal` / `acme.local`, and their hard-coded years (retired in the
  application increment, once nothing read them).

**Deviations from the plan.**
- **Mail directory:** there is no `domains` table (it would hold one row). `mailboxes` is one per
  login plus 2–5 shared ones (`info`, `sales`, `postmaster`…, `user_id` NULL), and stores only
  the local part. So no email appears outside `users`, with no exception, and the floor holds.
- The criterion "no 2024/2025 date" was wrong as written. Applications installed one to four years
  back carry such dates; it now reads "no hard-coded year".
- The mail directory and media library occur in no catalog database today (mail servers take the
  flat mysql rate), so the tests add 20 databases of every application beside the world's.

**Shares and variety (catalog, 50 databases; 54 with the uncatalogued networks).** crm 7,
helpdesk 8, stock 5, till 5, household 7, library 9, telemetry 4, scoreboard 3, bookings 2, cms 1,
enrolment 1, api 1, wiki 1. **50 of 50** `users` tables distinct (49 of 50 by names alone), **50 of
50** main tables distinct with hashes and dates set aside, and no table repeated between two
databases on one network.

**Evidence.**
- `generation/database.test.ts` (41 tests, built inside each test) and `mysql/ownDatabase.test.ts`:
  credentials and ladder, `users` properties, selection, café till, shape, referential integrity,
  keys, types, whole euros, calendar, no version/slot/address, short TEXT, `DESCRIBE` metadata,
  ranges, codes, optional tables, reachability, identifiers, variety.
- Fixture fallout: `mysqlStatement.test.ts` moved from the drawn `orders` to `users`; `hydraCrack`'s
  two-keys test leaves out a word both doors drew by chance (the crackable pool is ~17 words); the
  store-arrival pin checks database accounts, not the name.
- Budgets: bundle **171,728 B** gzipped (+6.5 KB, under the estimate). Build **0.478 ms/box**
  measured on the branch. A later re-measure read ~1.6 ms, but the branch's earlier source read the
  same then, so that was machine state.
- Mutation (scoped to the branch's production changes, 0 timeouts): **70.0% → 75.0%** (1,250 killed
  / 417 survived); `databaseApp.ts` 78.1% → **91.4%**; `ownDatabase.ts`, `remoteHostFs.ts`,
  `aptPackages.ts` 100%. The gate found a real bug: two shared mailboxes could never be drawn
  (`slice` instead of `pickN`). The survivors left are equivalent engine fallbacks, labels and
  `required` flags the tests read from the data, and one judgment call: a deep box drawing its own
  login, which only bites on a collision.
- Wire-checks: `testMysqlConnect` 13/13, `Query` 17/17, `Mutate` 14/14, `Deep` 13/13, `SameLan`
  12/12, `CrossPlayer` 8/8, `SweepTrace` 13/13. `testMysqlDeep` needed a fix that was already
  failing on `main`: `rowAt` asked for one row where two writers had written.
- Played via `v2-e2e` on CASA-DE-RAMIREZ (v0.253.0): `nmap` showed `records-170` beside
  `backup-20`, `doorbell-89`, `datastore-123`, `share-129`; `hydra 192.168.199.170 mysql` →
  `db_admin` / `root123`; `SHOW TABLES` on `family` → `users`, `recipes`, `bills`, `shopping_list`;
  `SELECT * FROM users` → `dbsvc` as admin, then `syncuser`, `plcuser`, `reporting`, `uploads` (the
  four neighbours' accounts), all `@casa-de-ramirez.lan`; `SELECT * FROM bills` → every `paid_by`
  resolved and no bill predated its payer's sign-up.

**Known gaps, inside the rules.** A café's `orders` can predate its first `menu_items` row, since
orders do not reference menu items. An order's `total_eur` is not the sum of its lines. Prices are
drawn in a range, not per item.

## Open for planning (named, deliberately not decided)

- The memoization key and cache bound on each end (client, serverless instance), and whether the
  derived network population is memoized alongside the tree — only if the build-time budget breaks.
- Which store keyspaces pair with which of slice 5's 15 database archetypes (slice 6), and
  whether IoT (slice 9) and gateways (slice 10) take archetypes of their own. `dump.sql` stays
  schema-only (slice 5 kept it).
- **Site ↔ database agreement** (deferred at slice 5's planning): a café's menu page need not
  list its `menu_items`, and a portal's CMS posts are not its pages. Decide if a slice leans on it.
- Where each remaining file's permission constant comes from — reuse `baseFs.ts` constants (now
  including `HOME_FILE`, `ROOT_FILE`, `GUEST_HOME_*`) or add the Debian-default few still missing —
  for logs, mail and `/srv` (web files settled on `WEB_PAGE_FILE` / `TRAVERSABLE_DIR`).
- **`~` in replayed history lines.** v2's `cat`/`ls` do not expand `~` (`cd` defers it too), so a
  slice-1 history line like `cat ~/notes/todo.txt` answers "No such file" when replayed verbatim,
  while `cat notes/todo.txt` from the home works (seen in slice 2's played run). The truth tests
  expand `~` themselves. Either the shell learns tilde expansion or history lines spell home paths
  another way — decide before a slice leans on replaying them.
- Whether the AP gateway's 5–10 files need their own serialized-size check.
- **`tail` in replayed history lines.** Generated histories (slice 1's `homeHistory.ts`, slice 2's
  `rootContent.ts` and `rootHome.ts`'s log reads) type `tail` and `tail -f`, which v2 does not
  have — allowed by decision 3, but a replayed line answers `command not found`. The command
  itself is backlogged in `v2/docs/conventions-and-gotchas.md` §9; decide with the `~` item.

## Status log

- **2026-09-21** — grilled; 25 locked decisions; ship waits for this epic.
- **2026-09-21** — slices 0–1 planned (`a-workstation-reads-as-somebodys.md`); decision 19
  amended on measurement (budget first, memoize on breach). Slice 1 targets the
  `desktop|laptop|workstation` overlay only — phones and tablets keep empty homes until slice 11.
- **2026-09-21** — slices 0 (#533) and 1 (#534, v0.248.0) shipped; browser run recorded; slice plan
  retired into "As-built: slices 0–1" above and its file deleted. Next: slice 2 (not yet planned).
- **2026-09-21** — slice 2 planned (`a-box-admits-what-it-is.md`, v0.249.0 target). Owner decision
  at planning, touching decision 6: the player workstation gains an empty guest-tier `/home/guest`,
  because every `/etc/passwd` names it and a guest session lands there. `.ssh/` taken into slice 2
  as slice 1's plan assigned; gateways stay with slice 10.
- **2026-09-21** — slice 2 shipped (#535, v0.249.0); played run on VANDELAY-INDUSTRIES recorded;
  slice plan retired into "As-built: slice 2" above and its file deleted. Next: slice 3 (not yet
  planned).
- **2026-09-21** — slice 3 planned (`a-box-remembers.md`, v0.250.0 target). Owner decisions at
  planning: rotated logs are world-readable, so they name only `root` and the daemons (slice 2's
  rule kept, though `ls /home` already shows a guest the username); gateway history waits for
  slice 10; remote lines are routine activity from real LAN neighbours, no brute-force noise.
  Resolved: `.1` only (Debian's `delaycompress` makes `.2` a `.gz`), one day (2026-07-11) per file,
  a `.1` exists only when it holds a line.
- **2026-09-21** — slice 3 shipped (#536, v0.250.0); played run on CASA-DE-RAMIREZ recorded;
  slice plan retired into "As-built: slice 3" above and its file deleted. `tail` backlogged in
  conventions §9. Next: slice 4 (not yet planned).
- **2026-09-21** — slice 4 planned (`a-web-server-serves-a-site.md`; 4a v0.251.0, 4b v0.252.0).
  Owner decisions at planning: the three layers go on webserver-role hosts only (other http hosts
  keep one page, rewritten version-free; IoT → slice 9, gateways → slice 10); cross-host links use
  `.lan` names and the web tools learn to resolve them (display plumbing); two PRs in order;
  `robots.txt` may `Disallow` one served off-dirlist path; pages name people by full name and role
  mailboxes, never a username (the no-account-but-root rule holds under `/var/www`); `dump.sql` is
  schema-only. Resolved: 1–4 hidden dirlist paths per site; no autoindex, so hidden directories are
  ones that carry their own page.
- **2026-09-21** — slice 4a merged (#537, v0.251.0): lynx renders `<table>` in aligned columns
  and `<pre>` as written.
- **2026-09-22** — slice 4b shipped (#538, v0.252.0); played run on OMNI-CORP recorded; slice plan
  retired into "As-built: slice 4" above and its file deleted. Next: slice 5 (not yet planned).
- **2026-09-22** — slice 5 planned (`a-database-holds-an-application.md`, v0.253.0 target). Owner
  decisions at planning: **decision 15 amended** — `mysql-db-` keeps only the credentials and a new
  `db-app-` stream draws the application, so every NPC database password re-rolls once (nothing
  pins them hash-for-hash; crack chances unchanged), accepted like decision 7's re-roll; **the
  player's own bought database is a fresh install** — a `users` table holding its owner alone
  (decision 6); **every archetype keeps `users`** (the app's login table) and gains a bcrypt-shaped
  `password_hash` no in-game tool reverses (john is md5-only — decision 12's inert-hash rule);
  **site ↔ database agreement is deferred** (a menu page need not list `menu_items`).
- **2026-09-22** — slice 5 shipped (#539, v0.253.0); played run on CASA-DE-RAMIREZ recorded; slice
  plan retired into "As-built: slice 5" above and its file deleted. Owner decision during the build:
  a LAN `users` table holds every machine's account with no floor. `testMysqlDeep`'s pre-existing
  `rowAt` fault fixed in the same PR. Next: slice 6 (not yet planned).
