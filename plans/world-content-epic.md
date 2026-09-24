# Epic: Generated World Content (v2) — every box reads as somebody's

> **Picking this up cold?** Read "Locked decisions", then the slice table — it carries the live
> status. The grounding section records what v2 held on the day this was grilled; the code wins
> wherever the two disagree.
> Grilled 2026-09-21 (`grilling`), 25 locked decisions. Slices 0–8 delivered (as-built below).
> Slice 9 grilled and planned 2026-09-24 in `a-device-is-the-device-it-says.md`; PR 9a shipped
> (#545, v0.259.0); PR 9b is next.

**Where we are now (2026-09-24):** **v0.258.0**. The legacy-parity epic's V-series is closed and
its next line was "the ship gate". **Ship now waits for this epic** (decision 1). Grilled to 25
locked decisions and a twelve-slice spine. **Slices 0–8 are DONE** (#533, #534, #535, #536,
#537 + #538, #539, #540, #541 + #542, #543 + #544) — the build budgets, NPC
workstation homes, every NPC box's `/etc`, `/root`, `.ssh/` and `/home/guest`, every NPC box's
rotated `.1` history plus `syslog`, a
three-layer site on every webserver (with lynx tables/`<pre>` and `.lan` names in the web tools),
an application in every NPC database, that application's working set in every NPC store, the
network's own correspondence in `/var/mail` with the mail server's records agreeing with it, and
a department share under `/srv` on every file server with the server's own records agreeing
with it; their
as-built is folded into the slice spine and the "As-built" sections below.
**Decision 19 was amended at planning** (budget first, memoize on breach) and **decision 6 was
narrowed at slice 2's planning** (the player workstation gains an empty `/home/guest`). Slice 3's
planning took three owner decisions (rotated logs name only root and the daemons, gateways wait
for slice 10, remote lines are neighbours doing routine things); slice 4's took six (recorded in
its as-built); slice 5's took four at planning (one amends decision 15) and one during the
build (recorded in its as-built). Slice 6's took three at planning (one amends decision 15 again)
and one during the build (no counter in a spec counts part of another). Slice 7's took eleven at
planning and four derived from precedent, with no decision-15 amendment — mail is new content on
new streams, so nothing already generated re-rolled. Slice 8's took four at planning with eleven
confirmed recommendations, and three during the build (recorded in its as-built), again with no
re-roll.

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
| 6 | **A store serves that application** — Redis keyspaces paired with the app | `KEYS sess:*` returns sessions for that app's real users | ✅ DONE (#540, v0.254.0) — 43 stores, all reading differently; decision 15 amended (store locks re-rolled once); a bought store is a fresh install; see as-built below |
| 7 | **Somebody wrote to somebody** — workstation mailboxes, the mail server's spool | a thread in `/var/mail/<user>` is between two real inhabitants of the network | ✅ **DONE** (#541 v0.255.0, #542 v0.256.0) — the correspondence, desk mailboxes, the spool and its database agreement; then `mail.log.1` carrying the spool's own queue ids, `/etc/aliases`, the postfix config honesty fixes and cron's mail to root. A phone keeps no mailbox but may hold cron's |
| 8 | **A share holds a department** — fileserver `/srv`, metadata docs | `strings` on a shared PDF names its author, an inhabitant | ✅ **DONE** (#543 v0.257.0, #544 v0.258.0) — `/srv` on every file server, LAN and deep: a working share or dated snapshots by prefix, the category's departments, PDF/JPEG/office stubs whose metadata `strings` reads, authors from the one roster mail uses, `vsftpd.conf` stops claiming doors; then `vsftpd.log.1` recording every arrival from its author's machine to the byte, the `/srv` data disk in `fstab`, an allow-list `/etc/vsftpd.userlist`, and root's history naming `/srv` instead of samba, nfs and zfs. See as-built below |
| 9 | **A device is the device it says** — IoT prefix overlays + prefix growth (the one re-roll: refresh pins, wire-checks, the `v2-e2e` skill) | a printer serves a CUPS page and holds spool jobs; a camera a recordings index | ⏳ 9a ✅ (#545, v0.259.0) — 9b printer/camera/recorder next, then 9c climate/media/plug/lock |
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

## As-built: slice 6 (delivered 2026-09-22)

Retired here from `a-store-serves-that-application.md` on close-out. One PR (#540, v0.254.0).

**Owner decisions.** At planning (2026-09-22): (1) **decision 15 amended again**:
`redis-store-<essid>-<ip>` draws only the lock, and a new `redis-app-<essid>-<ip>` draws the keys,
so every NPC store's lock — and whether it has one — re-rolled once; (2) **a store with no database
beside it serves the box's own application**, the rows `db-app-<essid>-<ip>` would hold, never a
neighbour's; (3) a bought store is a **fresh install**: empty, lock mirroring root. During the
build: (4) **no counter in a spec counts part of another** — a till whose takeaways outnumbered its
orders would be caught lying by its own two keys, so the pairs were swapped out.

**What shipped.**
- `generateDatabase.ts` splits: `generateApplication({appSeed, essid, host, account, role})` holds
  the people and `buildApplication`, and `generateDatabase({seed, ...application})` adds
  `drawDatabaseCredentials(seed)`. One function both doors call, which is what makes a cached row
  the real row wherever mysqld runs.
- `generateRedisStore.ts` rewritten: `drawStoreLock(seed)` alone on the lock stream, and the keys
  drawn on `appSeed` from `STORE_SPECS[databaseArchetype(essid, host)]` — sessions, cache, queues,
  locks, permissions, rate limits, counters, flags, webhooks — then shuffled, because a real
  `KEYS *` answers in hash-table order and never grouped by purpose.
- `pools/storeApps.ts` (new): `StoreSpec` as data for all 15 archetypes — `cached`, `queues`
  (name/kind/table), `locks`, `counters`, `flags`, `routes`, `webhooks`. `pools/redis.ts` deleted.
- `redis/ownStore.ts`: `{keys: {}, requirepassHash: root's hash}`, with
  `redis-store-own-<pubkey>` left only as the fallback for a box whose passwd names no root. The
  hostname parameter went with the generic keys that used it.
- Families: `sess:<32hex>`, `cache:<table>:<id>` (users rows minus `password_hash`),
  `queue:<name>` (jobs with consecutive ids), `lock:<job>`, `perms:<username>` (admin always
  writes), `ratelimit:<route>:<ip>`, `stats:<name>`, `flag:<feature>`, `config:webhook:<vendor>`.
- Sessions reach the box from the machine that person really uses: a neighbour's box on a LAN, the
  box itself deep in the chain.

**Shares and variety (43 stores: 30 LAN, 13 deep).** 25 locked, 18 open; 13 share a box with a
database. Keys min 21, max 79, mean 45 — 1,242 cached rows, 149 sessions, 113 counters, 103 rate
limits, 86 queues, 86 permission sets, 79 flags, 43 webhooks, 42 locks. **43 of 43 read
differently** with session tokens set aside. Archetypes: library 7, helpdesk 6, cms 6, stock 4,
api 4, till 3, scoreboard 3, crm 2, household 2, bookings 2, telemetry 2, media 1, wiki 1.

**Evidence.**
- `generation/store.test.ts` (30 tests): the lock and its stream, sessions against the application's
  real users, what a store holds (volume, families, cache fidelity, queues, locks, permissions,
  rate limits, vocabulary, reachability), the shape of a store (key grammar per family, job naming
  and consecutive ids, permissions, flag mix), what it never holds (password fields and pool words,
  versions, unfilled slots, off-zone addresses, dates outside the application's life), the spread
  of its moments, and that no two stores read alike.
- Budgets: bundle **173,240 B** gzipped (ceiling 284,975), build **0.949 ms/box** (ceiling 2).
- Mutation (0 timeouts): `generateRedisStore.ts` 82.0% → **87.8%**; `ownStore.ts`, `aptPackages.ts`
  and `remoteHostFs.ts`'s changed lines 100%; `generateDatabase.ts` 89.2%. `storeApps.ts` scores
  30% and stays there: its 348 survivors are `StringLiteral`/`ArrayDeclaration` mutants on a data
  table, equivalent data labels that the reachability test already pins as non-empty and reached.
  The survivors elsewhere are equivalent fallbacks and unreachable guards, plus five deliberate
  knobs (two probability inversions that still yield a mix, the session-count `min`, the
  `LAST_SECOND` ±1 boundary). The gate added the tests for key grammar, job ids, permissions, flag
  mix and the two draw windows.
- Wire-checks: `testRedisConnect` 28/28, `Sweep` 10/10, `Deep` 20/20, `SameLan` 16/16,
  `CrossPlayer` 13/13; `testSnmpFilter` 13/13, `Install` 15/15, `Scan` 12/12.
- Played via `v2-e2e` on CASA-DE-RAMIREZ (v0.254.0): `datastore-123` runs both doors, its store
  open. `KEYS sess:*` → one key; `GET` it → `dbsvc` from `192.168.199.170`, which `nmap` listed as
  `records-170`. `GET cache:recipes:6` matched `SELECT * FROM recipes WHERE id = '6'` field for
  field, and `cache:users:4` held every column but the `password_hash` the table still shows.

**Known gaps, inside the rules.** A counter is a plausible number, not a count of the rows the
application holds: `stats:pages_total` need not equal the `wiki_pages` row count. Cached rows are
drawn to fill the key budget, so a store may cache a row its own queues never mention.

## As-built: slice 7 (delivered 2026-09-23)

Retired here from `somebody-wrote-to-somebody.md` on close-out. Two PRs: **7a** (#541, v0.255.0) —
the network's correspondence, `/var/mail/<user>` on desks, the mail server's spool, and the roster
and delivery agreement with the mail database; **7b** (#542, v0.256.0) — the mail server's own
records agreeing with that spool.

**Owner decisions.** Eleven at planning (2026-09-23), four derived from precedent and confirmed.
The load-bearing ones: (1) desks get `/var/mail/<user>`, mailserver-role boxes get the network's
spool, and every NPC box whose crontab really prints gets a root-only `/var/mail/root`; phones,
tablets, IoT and the player's box get nothing; (2) **one correspondence per network**, drawn once
on `mail-network-<essid>`, so a thread read on the desk that sent it and on the server that carried
it is the same thread message for message; (3) mbox, one file per mailbox, never Maildir; (4) the
roster is the box's own application's; (5) `delivery_log` names real deliveries and its six-subject
pick list retires; (6) tiers — a desk's mailbox is user-tier, the spool and every `/var/mail/root`
are root-only. **No decision-15 amendment and no re-roll:** mail is new content on new streams
(`mail-network-<essid>`, `mail-box-<essid>-<ip>`, and 7b's `mail-log-…` / `mail-cron-…`), so
nothing already generated moved.

### PR 7a — somebody wrote to somebody

Six RED-GREEN increments, plus one test commit from the mutation gate and the version bump.

**Deviations from the plan.** Increments 4 and 5 swapped: `oneOfEach()`'s synthetic mail box is
off-LAN and no real mail server runs mysqld, so off-LAN mail had to exist before the database could
agree with it. `MAIL_SPECS` has **12** entries, not 15 — `cms`, `api` and `mail` are box-level
archetypes `networkArchetype` can never return, so the record keys on `NetworkArchetypeKey` and the
compiler enforces the set. `delivery_log`'s pick list was retired rather than extended, which
needed a new `before` bound on `Draft` so a mailbox row is opened *before* its first delivery.

**Found during the build.** A body line beginning `From ` splits an mbox — one authored line did,
silently turning a mailbox into five malformed messages; fixed at the renderer with real `>From `
quoting, not by rewording prose. The inert sweep must read **bodies**, not whole files
(`OSCORP-GUEST` → zone `oscorp-guest.lan` fails on the word *guest*). Reachability splits in two:
all 128 authored threads are written, but 25 land only on networks of phones with no mail server.
The emptiness guard in `mboxFor` is unreachable on a desk and was recorded `N/A` with measured
evidence rather than tested into existence.

**Mutation gate.** Headline claims were unproven: removing the mail server so nothing carries mail,
dating role-mailbox mail to 1970, and never quoting the message a reply answers all passed the full
suite. Ten tests closed them — `mailbox.ts` 78.47% → 88.89%, `networkMail.ts` 77.39% → 86.43%.
`networkMail.ts`'s 11 timeouts are genuine non-terminating loops, hand-verified.

**Verified:** 5,739 tests; wire-checks 47/47; bundle 192,258 B (+15.2 KB, all authored prose);
build 0.559 ms/box; played run on `WAYSTAR-WIFI`, `guest` refused on the same file.

### PR 7b — a mail box corroborates itself

Four RED-GREEN increments, plus one commit closing the mutation gate and the version bump.

**The queue id is the message's own.** `mail.log.1`'s per-delivery id is the id the delivered copy
carries in its `Received:` header and inside its `Message-ID`, so one `grep` pairs the log against
the mailbox. The spool and the log come out of **one** derivation (`mailEntries` returns both), so a
second pass cannot drift from the first.

**Deviations from the plan.**
- **`/etc/aliases` is built in `mailbox.ts`, not `buildEtcContent`.** `buildEtcContent` cannot see
  the box's application, so building it there would mean a second derivation that could name a
  mailbox `/var/mail` does not keep — the one thing that file can get wrong.
- **`mail.log.1` spans the correspondence, not the last day** — the only rotation that does.
  Postfix's logrotate is size-bound and a dozen people never trip it. A one-day mail log would
  corroborate almost nothing, which is the whole point of the PR. `boxMemory`'s day rule now names
  this exception so no future spanning rotation can be added silently.
- **The config fixes are the two the decisions named**, not every path. The line, stated in
  `pools/configFiles.ts`: a setting that describes where data already is can be read against that
  data and must agree with it (`virtual_mailbox_base`, `mynetworks`); one that names what a running
  daemon would create stays true on a box whose daemon is down (`queue_directory`,
  `data_directory`, the TLS paths). Decision 3 rules out shipping `/var/spool/postfix`, so making
  those true was not available. `virtual_mailbox_domains` was fixed too — it pointed at a
  `vdomains` file no box has, and now names the zone.

**Found during the build.**
- **No output line may carry a decimal.** `dsn=2.0.0`, `delay=0.31` and `1.2G` all read as versions
  to the world's own version sweep. Real postfix writes `delay=`/`dsn=`; both are dropped, on the
  same ground `mysql.log` stamps `.000000` — the world keeps no time finer than a second.
- **`root` is both an alias and a mailbox** on a mail server, which is true of any Debian one: cron
  delivers to `/var/mail/root` locally while `/etc/aliases` forwards what arrives for root.
- **`/etc/aliases` sits at `/etc/passwd`'s tier**, not `/etc`'s usual guest-readable one: every line
  of it is an account name. `mail.log` is narrower still — root-only, like the spool it indexes.
- **Tree pins moved, deliberately** (decision 23): the spool listings exclude `root` (root's mailbox
  is cron's, not the directory's); a phone keeps no person's mailbox but may hold cron's;
  `remoteHostFs.test.ts`'s "one role config in `/etc`" now names `aliases` as a table postfix READS
  rather than a config; and root's `.bash_history` gained `mail.log.1` as a log it can tail.
- **`systemctl is-active snmpd` is scheduled on 0 of 428 boxes.** Unreachable content predating this
  slice; recorded rather than tested into existence.

**Mutation gate.** Run twice, **0 timeouts both times**, so the scores compare honestly.
`pools/cronMail.ts` 30.95% → **97.62%**, `logging/mailLog.ts` 69.23% → **100%**, `mailbox.ts`
86.86% → **90.15%**, `pools/configFiles.ts` **100%** throughout; survivors 72 → 28. Seven real
holes, all passing the full suite: a mail log only root could READ but anyone could write; a
weekday branch forced always-on, dating every daily and hourly job's mail six days early; a byte
count that could stop matching the gibibytes beside it; and the loopback, ordering, `size=`/`nrcpt=`
and daemon tags unpinned. Every remaining survivor accounted for: 16 on lines 7a shipped, one
hand-proven false survivor, four equivalent (two hand-proven), two unreachable on measured evidence,
four the `/etc/aliases` comment header.

**No existing stream gained a draw** — proved by building the whole world on `main` and on the
branch and diffing every file: **31,801 identical**. Everything that moved is the mail surface, plus
one line each in `/root/.bash_history` on 10 boxes, all mail servers.

**Verified:** 5,772 tests (241 files); wire-checks 17/17; bundle 193,843 B; build 0.617 ms/box;
played run on `NULL-BYTE`/`mx-159` tracing queue id `8574C4` from `mail.log.1` into
`/var/mail/bpatel`, with `/var/mail/root` holding one `fstrim -av` message at Sat Jul 11 14:24:00
matching `24 14 * * 6` in the crontab, the silent `ntpdate -s` job leaving nothing, and a `guest`
session refused the spool, the log and the alias table while still reading `postfix.conf`.

## As-built: slice 8 (delivered 2026-09-24)

Retired here from `a-share-holds-a-department.md` on close-out. Two PRs: **8a** (#543, v0.257.0) —
`/srv` on every file server, its documents in their real formats, and an honest `vsftpd.conf`;
**8b** (#544, v0.258.0) — the file server's own records agreeing with that share.

**Owner decisions.** Four at planning (2026-09-23) and eleven confirmed recommendations, recorded
in the status log below: the share is `/srv`, reached through the existing ftp door with no door
change; documents are binary-shaped NUL-free stubs whose metadata `strings` reads, and office
files never give up their author; the network's category decides what a share holds and the
hostname prefix its shape; no archive files. Three more during 8b's build, below. **No
decision-15 amendment and no re-roll:** the share, its disk and its log are new content on new
streams (`share-<essid>-<ip>`, `share-phone-<essid>-<ip>`, `document-noise`, and 8b's
`share-log-<essid>-<ip>` and `share-disk-<essid>-<ip>`); the edits to existing pools change text
at unchanged pick indices.

### PR 8a — a share holds a department

Six RED-GREEN increments as planned, then one test commit from the mutation gate and one fix from
the played run.

**Shapes that changed on contact, and why.**
- **Noise is Latin-1 (`¡` to `ÿ`), not control characters.** The played run failed a guest `get`
  of an `.xlsx` with `I/O error`: saving a fetched file is one signed write whose JSON payload is
  capped at 8192 characters (`signedEnvelopeSchema`), and JSON writes a control character as six,
  so a 2.3 KB spreadsheet came to 14 KB. Latin-1 is just as invisible to `strings`, JSON writes it
  as itself, and `cat` shows the mojibake a real binary shows. Nothing in the game counts real
  bytes (`get` and the transfer log both measure `content.length`).
- **Noise is one 4 KB block drawn once, cut at a drawn offset.** Drawing it a character at a time
  made a share cost more than the rest of its file server (114 ms a world against 18).
- **`buildShare` takes a budget, not a per-folder range**: a working share's 25–60 files and a
  backup box's 80-across-all-snapshots are totals, divided among the departments drawn.
- **Snapshots are a timeline.** Each file enters in one snapshot, may be revised in a later one,
  and every later night adds at least one file. A version renders once, so an untouched file is
  byte-identical across snapshots. Photos and notes are never revised.
- **Phones are drawn per phone** on `share-phone-<essid>-<ip>`, so every file server on a network
  agrees which model each phone is. Deep boxes see no phones and use cameras.
- **`peopleKnownOn`** (`mailbox.ts`) is the one roster mail and the share read: the network's
  people on the LAN, a deep box's own application's logins below it (`boxPeople`).
- **`iot` shares are a device owner's documentation** — the catalog's `iot` networks are single
  devices (`SMART-FRIDGE-NET`), not factories.
- **The `vsftpd.conf` swaps:** `anonymous_enable=YES`→`NO`, `anon_root`→`connect_from_port_20=YES`,
  `chroot_local_user`→`use_localtime=YES`, `local_root`→`pam_service_name=vsftpd`.

**Mutation gate.** `share.ts` 71.30% → 93.17%, `documentFormats.ts` 82.65% → 92.31%,
`pools/shareFiles.ts` 50.73% → 100%, 0 timeouts. The first run showed **the whole revision path
could be deleted with every test passing** — the snapshot test was satisfied by the forced nightly
arrival alone.

**Verified:** 5,841 tests; wire-checks 37/37; bundle 203,638 B (+9.8 KB); build 0.635 ms/box;
world byte-diff only `/srv` added and the four `vsftpd.conf` swaps; played run on DEFCON-VILLAGE
`files-143` finding a PDF's author in Sunil Thompson's mailbox on `workstation-252`.

### PR 8b — a share corroborates itself

Four RED-GREEN increments as planned, then one test commit from the mutation gate and one fix from
the played run.

**What a file server now says about its share.**
- **`/var/log/vsftpd.log.1`** on the 40 LAN file servers running vsftpd: one `OK UPLOAD` line per
  arrival, naming the box's account, the author's machine (`127.0.0.1` when they sit at the file
  server), the path and the exact `content.length`. `buildShare` returns `{ tree, uploads }`, so
  the log and `/srv` are one derivation, as `mailEntries` is for the spool and `mail.log.1`. It is
  the second rotation that spans more than a day; `boxMemory.test.ts` names both. Deep boxes keep
  none. Pids on `share-log-<essid>-<ip>`.
- **`/etc/fstab`** mounts a data disk at `/srv` (`ext4 defaults 0 2`, after `/boot`, before swap)
  on every file server, LAN and deep, and on no other role.
- **`/etc/vsftpd.userlist`** where the config names it (18 boxes), at `/etc/aliases`'s tier.
- **Root's history** swaps `smbstatus`, `zpool status`, `exportfs -v` and `testparm` in place for
  `du -sh /srv`, `df -h /srv`, `findmnt /srv` and `ls -l /srv`.

**Where it differs from the plan, and why.**
- **A backup box logs nightly pushes (owner decision).** Its files live in
  `/srv/backup/<YYYY-MM-DD>/`, so an upload dated when the file was saved would write into a
  directory named for a night that had not come. Each desk pushes what it saved since the night
  before while the job runs (02:00–03:00), to that night's snapshot; an untouched file is not sent
  again. Only a working share's lines are dated at the file's own save, which is the PDF's
  `ModDate` to the second.
- **One line per arrival, not a visit (owner decision, reversed on evidence).** Increment 1 wrote
  each upload as CONNECT, OK LOGIN and OK UPLOAD under one pid. The played run's guest
  `get /var/log/vsftpd.log.1` then failed with `I/O error` on most boxes: the logs were 4.3–13.6K
  characters of JSON against the 8192 cap on the one signed write that saves a fetched file. The
  UPLOAD lines alone are 2.0–6.3K. A test now sends every transfer log in the world through the
  real `createPatchApi` and checks each request against `signedEnvelopeSchema`.
- **The user list is an allow list (owner decision).** The template enabled a list without
  `userlist_deny`, and real vsftpd refuses everyone such a list names — so a list naming the
  account would have claimed the account that uploaded everything was refused. The template gains
  `userlist_deny=NO`, and the list names every account in `passwd` (root, the account, guest),
  since the ftp door admits any of them.
- **The disk's UUID is on `share-disk-<essid>-<ip>`, not `share-log-`.** The plan named the log's
  stream; sharing one seed between the upload pids and the UUID would have correlated their first
  draws. Still a new stream, so nothing re-rolled.
- **The history lines name `/srv`, not `/srv/share`**, because a backup box has no `/srv/share`.
- **The log names the box's account**, which the rotated logs' "no account but root" rule forbids
  elsewhere. `ls /home` and `ls -l /srv` already show that account to every tier, so the rule's
  wording now says so rather than carving out an exception.

**Mutation gate.** Two runs scoped to the changed lines, 0 timeouts: `share.ts` 100% (49/49), the
transfer log 94.74%. One real gap: deleting the userlist's blank-line filter went unseen, because
the test read the file through a helper that drops blank lines; it now checks the exact content.
The rest are equivalent (the pid stream's seed, the userlist regex's anchors) or pre-existing
`fstab` lines that fell inside the mutated range.

**Verified:** 5,856 tests; wire-checks 53/53 (`testSameLanConnect`, `testCrossPlayerRead`,
`testDeepChainReach`, `testFtpRemoteRead`, `testFtpTransferTrace`, `testFtpPut`,
`testFtpSession`); bundle 204,101 B (+463 B); build 0.752 ms/box; world byte-diff 34,672
identical, 58 added (40 `vsftpd.log.1`, 18 userlists), 142 changed (65 `fstab`, 18
`vsftpd.conf`, 59 root histories), all on file servers — on 29 of those histories a log-reading
line also picks a different log, since the log list it picks from grew by one. Played run on
DEFCON-VILLAGE `files-143` as a fresh guest: `get` of `special-issue.pdf` (1024 bytes) and of
`vsftpd.log.1` (4769 bytes); the log's line for the PDF names `192.168.97.252`, 1024 bytes, at the
PDF's `ModDate` second; `strings` names Sunil Thompson; `nmap 192.168.97.252` reports
`workstation-252`; the carried `fstab` mounts `/srv`; the userlist refused with `550`.

**Found beyond the slice.** The same cap already bites content earlier slices generate: `auth.log.1`
is over it on 102 boxes, and every tier reads it, so a guest who `get`s it meets the same
`I/O error`. Backlogged in `v2/docs/conventions-and-gotchas.md` §9.

---

## Open for planning (named, deliberately not decided)

- The memoization key and cache bound on each end (client, serverless instance), and whether the
  derived network population is memoized alongside the tree — only if the build-time budget breaks.
- Whether IoT (slice 9) and gateways (slice 10) take archetypes of their own. Slice 6 settled the
  store keyspaces: one `StoreSpec` per database archetype. `dump.sql` stays schema-only (slice 5
  kept it).
- **Site ↔ database agreement** (deferred at slice 5's planning): a café's menu page need not
  list its `menu_items`, and a portal's CMS posts are not its pages. Decide if a slice leans on it.
- Where each remaining file's permission constant comes from — reuse `baseFs.ts` constants (now
  including `HOME_FILE`, `ROOT_FILE`, `GUEST_HOME_*`) or add the Debian-default few still missing —
  for logs (web files settled on `WEB_PAGE_FILE` / `TRAVERSABLE_DIR`). Slice 7's
  planning settled mail's tiers: a desk's own mailbox is user-tier, the mail server's spool and
  every `/var/mail/root` are root-only, since three tiers cannot express per-user ownership.
  Slice 8's planning settled `/srv`'s: every tier reads it, root and the box's one account write
  it, because that account is who uploaded everything on the share.
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
- **2026-09-22** — slice 6 planned in `a-store-serves-that-application.md` (one PR, v0.254.0).
  Owner decisions at planning: `redis-store-` keeps only the lock and a new `redis-app-` stream
  draws the keys (every NPC store's lock re-rolls once, amending decision 15); a store with no
  database beside it serves the box's own application (the rows `db-app-` would hold), never a
  neighbour's; a bought store is a fresh install (empty, lock mirrors root).
- **2026-09-22** — slice 6 shipped (#540, v0.254.0); played run on CASA-DE-RAMIREZ recorded, where
  a cached row matched the `SELECT` on the same box; slice plan retired into "As-built: slice 6"
  above and its file deleted. Owner decision during the build: no counter in a spec counts part of
  another. Next: slice 7 (not yet planned).
- **2026-09-23** — slice 7 planned in `somebody-wrote-to-somebody.md` (two PRs in order, v0.255.0
  and v0.256.0). Eleven owner decisions at planning: mail goes to desks, mail servers and root's
  cron mail; ONE correspondence per network on `mail-network-<essid>`, so both ends of a thread
  agree; no smtp/imap door, but mailserver-role boxes get `mail.log` + `mail.log.1`; mbox
  everywhere and the `postfix.conf` that promised `/var/mail/vhosts` is rewritten; the spool's
  roster is the application's `mailboxes`, pinned to agree where mysqld runs; every address on the
  `.lan` zone, with real machines among the senders; topics from `MAIL_SPECS` keyed by archetype
  plus a category-keyed personal layer; 3–6 threads of 1–4 messages; `/etc/aliases` shipped and
  `mynetworks = 10.0.0.0/24` fixed; desk mailboxes user-tier, spool and root mail root-only;
  `delivery_log` names real deliveries and its pick list retires. Confirmed as derived: no
  decision-15 amendment and **no re-roll** (mail is new streams only), deep boxes take their cast
  from the role pool as deep databases do, the two copies of a message differ by their true
  `Received:` chain so decision 17 needs no exemption, and headers stay version-free.
- **2026-09-23** — **slice 7's PR 7a shipped** (#541, v0.255.0): `networkMail.ts`, `mailbox.ts`,
  `pools/mailThreads.ts`, `/var/mail` in the `var:` assembly, and `delivery_log` redrafted from
  real deliveries. Played run on `WAYSTAR-WIFI` recorded; `guest` refused on the same file.
  Two planned shapes changed on contact: increments 4 and 5 swapped (off-LAN mail had to exist
  before the database could agree with it, because `oneOfEach()`'s synthetic mail box is off-LAN
  and no real mail server runs mysqld), and `MAIL_SPECS` keys on the twelve archetypes a *network*
  can be drawn as rather than all fifteen — `cms`, `api` and `mail` belong to a box, so keying on
  `NetworkArchetypeKey` keeps every entry reachable and compiler-enforced. The `delivery_log`
  rewrite needed a `before` bound on `Draft` so a mailbox is opened before its first delivery.
  The mutation gate earned its place here: removing the mail server entirely — so nothing carries
  mail and every message arrives in one hop — passed all 5,730 tests, as did dating role-mailbox
  mail to 1970 and never quoting the message a reply answers; ten tests closed those. One survivor
  is recorded `N/A` as unreachable rather than tested into existence (a desk never has an empty
  mailbox; only a deep spool does). PR 7a's as-built stays in the slice plan, which is kept until
  7b ships. Next: **PR 7b** (`feat/a-mail-box-corroborates-itself`, v0.256.0).
- **2026-09-23** — **slice 7 COMPLETE**: PR 7b shipped (#542, v0.256.0) after 7a (#541,
  v0.255.0). 7b gave every mailserver-role box a `mail.log` and a `mail.log.1` whose per-delivery
  queue id IS the id the delivered copy carries, an `/etc/aliases` built from the same directory as
  the spool, the two config falsehoods fixed (`mynetworks` was nobody's network; the virtual-mailbox
  template named a spool the box does not keep), and `/var/mail/root` holding the output of jobs the
  box's own crontab really schedules. Three shapes changed on contact: `/etc/aliases` is built in
  `mailbox.ts` rather than `buildEtcContent`, because only one derivation can guarantee no alias
  dangles; `mail.log.1` spans the correspondence rather than the last day, the one rotation that
  does, and `boxMemory` now names that exception; and the config fixes are the two the decisions
  named, with the rule written into the pool — a setting describing where data already is must agree
  with it, one naming what a running daemon would create need not. The mutation gate ran twice at 0
  timeouts: `cronMail.ts` 30.95% → 97.62%, `mailLog.ts` 69.23% → 100%, `mailbox.ts` 86.86% → 90.15%.
  Its best find was a **self-referential test** — the `/var/mail/root` placement test read the very
  table it was checking, so flipping any job between silent and reporting was invisible. That the
  `perTest` false-survivor family reached **9/9** with a new shape (a method-chain collapse), the
  self-referential-test lesson, and the whole-world byte-diff technique are recorded in
  `v2/docs/conventions-and-gotchas.md`. Slice plan retired into "As-built: slice 7" above and its
  file deleted. Next: **slice 8** (a share holds a department), not yet planned.
- **2026-09-23** — slice 8 grilled and planned in `a-share-holds-a-department.md` (two PRs in
  order, v0.257.0 and v0.258.0). Four owner decisions, then the owner said "from now on, go with your
  recommendation" and confirmed the rest as shared understanding. **Owner:** (1) every
  fileserver-role box gets a `/srv`, LAN and deep (44 + 21), whether or not ftp is up; (2) documents
  are binary-shaped NUL-free imitations of the real format, like the ELF stubs, the version sweep
  skipping the format signature (`%PDF-1.7`) and producer names staying version-free; (3) PDF and
  JPEG carry metadata `strings` reads, while `.docx`/`.xlsx` are faithful zips whose `strings` shows
  member names and **never the author** (Word deflates `core.xml`), amending decision 9's wording;
  (4) the network category decides what a share holds, the hostname prefix its shape —
  `share-`/`files-`/`nas-` a working tree, `backup-`/`vault-` dated snapshots of one. **Confirmed
  recommendations:** `/srv/share/…` and `/srv/backup/<date>/…` with **no archive files** (a `.tar`
  or `.gz` implies a verb, as decision 10 reasoned; amends decision 9's "backup archives"); authors
  are the network's own people — the LAN roster slice 7's mail uses (11 of the 31 networks with a
  fileserver have no desk), a deep box's own application's logins by slice 7's deep rule; JPEG
  make/model from the network's own phones where it has any; every date on the calendar; plain
  `.txt`/`.csv`/`.md` beside the documents, 25–60 files on a working share and ≤ ~80 on a backup
  box; `/srv` readable by every tier and writable by root and the account; `vsftpd.conf` stops
  claiming an anonymous door, a chroot and a `local_root` the door does not have, with the door
  itself unchanged; PR 8b adds `vsftpd.log.1` (each file's upload from its author's machine, byte
  count exact), a `/srv` mount in `fstab`, `/etc/vsftpd.userlist`, and root's fileserver history
  purged of samba/nfs/zfs; deep shares take no transfer history; new streams only, proven by the
  whole-world byte-diff; no new pointer into the share from existing pools.
- **2026-09-24** — **slice 8's PR 8a shipped** (#543, v0.257.0): `share.ts`, `documentFormats.ts`,
  `pools/shareFiles.ts`, a `srv:` branch in `buildRemoteHostFs`, `SHARE_DIR`/`SHARE_FILE`, and the
  three `vsftpd.conf` templates made honest in place. Two shapes changed on contact. **Noise
  became Latin-1**: the played run's guest `get` of an `.xlsx` failed with `I/O error`, because the
  signed write that saves a fetched file caps its JSON at 8192 characters and JSON writes a control
  character as six — the plan's patch-store risk, found where it said only a played run could find
  it, and now held by a test that sends the world's hardest files through the real client adapter.
  And **the share is a timeline**, each file entering one snapshot and perhaps revised in a later
  one, so a backup is the tree as it stood that night. The mutation gate's best find: the whole
  revision path could be deleted with every test passing. `iot` shares read as a device owner's
  documentation, since the catalog's `iot` networks are single devices. World byte-diff: only
  `/srv` added and the four `vsftpd.conf` line swaps. Next: **PR 8b**.
- **2026-09-24** — **slice 8's PR 8b shipped** (#544, v0.258.0), **closing slice 8**: `vsftpd.log.1`
  on the 40 LAN file servers running vsftpd, one line per arrival read from the share itself; a
  `/srv` data disk in every file server's `fstab`; an allow-list `/etc/vsftpd.userlist` where the
  config names one; root's history naming `/srv` rather than samba, nfs or zfs. Three owner
  decisions during the build: a backup box logs each desk's nightly push into that night's
  snapshot; the user list lets in every account the box has (`userlist_deny=NO`); and one line per
  arrival rather than a whole visit — reversed after the played run's guest `get` of the log failed
  the 8192-character signed-write cap, 8a's lesson found again on a log. The same audit found
  `auth.log.1` over the cap on 102 boxes (backlogged). The disk's UUID is on its own
  `share-disk-` stream. World byte-diff: only file servers moved. Slice plan retired into the
  as-built above. Next: **slice 9**, not yet planned.
- **2026-09-24** — **slice 9 grilled** (a device is the device it says). Measured first: 104 IoT
  boxes (70 LAN, 34 deep) — sensor 20, printer 16, speaker 15, doorbell 14, thermostat 14, tv 14,
  cam 11 — of which only 29 serve http (3 of 16 printers); `device.conf` quotes versions
  (`BusyBox v1.31.1`, `firmware=v2.1.4`) against decision 21 and no test reads it; the camera page
  advertises `rtsp://…:554`, a port nothing serves (decision 4); growing the prefix list renames
  IoT boxes only, because `prng.pick` takes one draw whatever the list's length, and an http
  door is also an exploit route (nginx CVEs grant `shell_full`). Twelve owner decisions:
  (1) **an IoT box stays the small Linux board** slices 2–3 made it, with a device layer on top;
  only the falsehoods are fixed; (2) iot gains **`plug`, `lock`, `nvr`, `babycam`** — the one
  re-roll, IoT hostnames only; (3) **seven device kinds** key the overlays: camera (`cam`,
  `doorbell`, `babycam`), recorder (`nvr`), printer, climate (`sensor`, `thermostat`), media (`tv`,
  `speaker`), plug, lock — prefixes share one only when they are the same device in another
  flavour; (4) **placement is unchanged**: the device UI shows wherever http already runs, and the
  device's data is on disk behind the doors players have; (5) a device serves **a small UI of 2–4
  linked pages per kind** under slice 4's no-dead-link test, with no robots, sitemap or hidden
  layer (still webserver-only); (6) **print jobs are real people at their real machines printing
  real documents** — share documents where the network has a file server, the category's titles
  where it has none; control files are NUL-free stubs whose attributes `strings` reads, and a
  `page_log.1` agrees with them; (7) a camera's recordings are **an event index with JPEG
  snapshots** (slice 8's stub, the camera's own model), and a recorder archives the network's real
  cameras by `.lan` name, byte-identical to each camera's own — no video format, decision 9 not
  amended; (8) climate keeps readings and a thermostat's schedule, media its paired devices (the
  network's real phones), recently played and apps, a plug its schedule and daily energy, a lock
  an access log of real people from their real phones plus its code slots; MQTT stays on
  `127.0.0.1`, since mqtt is no service in the game; (9) **each kind's own config replaces the
  generic `device.conf`** on the existing `etc-config-` pick, text only; (10) **deep devices get
  the same overlay, self-contained**: a printer's jobs are its own people at `localhost`, a
  recorder's cameras are PoE channels on its own ports, a lock's people use keypad codes, media
  pairs nothing; no transfer history; (11) **tiers follow Debian**, with the box's one account as
  the device's daemon user: device data is user-tier; the CUPS spool, its logs, `/etc/cups` and
  the lock's access log are root-only, and the UI's job list shows "Withheld" for user and title,
  as CUPS does by default; (12) **three PRs in order** — 9a the re-roll alone (v0.259.0), so the
  world byte-diff shows only renames and the files naming them; 9b printer, camera and recorder
  (v0.260.0); 9c climate, media, plug and lock, retiring `device.conf` (v0.261.0).
  **Derived from precedent and confirmed:** device content on a new `device-<essid>-<ip>` stream,
  an IoT page moving from `web-page-` to the device UI (IoT text only); 9a refreshes the three
  pins naming IoT boxes (`generateHomeLan`, the deep layer, the DNS zone), the conventions doc's
  `speaker-26` example, confirms every wire-check picks its host dynamically, and resets the
  local journal; `page_log.1` spans more than a day beside an empty live `page_log`, the third
  such rotation in `boxMemory`'s list; every device file passes the 8192-character carry-cap test
  through the real `createPatchApi`; version-free, one calendar, no account in a world-readable
  file, a variety test, and the budgets.
- **2026-09-24** — **slice 9's PR 9a shipped** (#545, v0.259.0): `plug`, `lock`, `nvr` and
  `babycam` join iot's hostname pool. The re-roll was the one predicted: 90 IoT boxes renamed in
  place, no role, service or file added or moved, and the whole-world byte-diff explained by
  substituting each network's old→new names into `main`'s side, plus the page sizes, mail sizes
  and zone padding that depend on a name's length. The three pins and the conventions doc's
  `babycam-26` example moved on purpose; no wire-check, skill or doc named an IoT box. The
  mutation gate found a gap on an unchanged line — a name without the octet had no test saying it
  claims no role, so a player's `nas1` could have read as a file server — now held. Next:
  **PR 9b** (printer, camera, recorder).
