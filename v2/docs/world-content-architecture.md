# Generated world content (as-built)

Every generated machine reads as somebody's. Its files, logs, configs, mail, pages and data fit
what the machine is, the organisation it belongs to and the person who used it, and anything it
mentions leads somewhere real on that network. This is the shipped model of the generated world
content epic (#533–#550, v0.248.0–v0.264.0, closed 2026-09-25). The epic's plan file was retired
on close-out; the questions it deliberately left open are in `conventions-and-gotchas.md` §9 under
"World content deferred".

It sits on top of the generators this doc does not re-describe: role and service placement
(`machineRole.ts`, `generateHomeLan.ts`), passwords and accounts (`host-fs-` stream), the dpkg
manifest and the CVE axes (legacy-parity Phase 3). Content never changes any of those.

## The rules

These are standing invariants. Each was a locked decision at the epic's grill (2026-09-21), and
most are enforced by a property test named in "How it is tested".

1. **Believability, never loot.** No generated text pairs an account or service that exists in
   the game with a working secret. Secret-SHAPED values for things outside the game (an AWS key,
   a payment-provider key, an external SMTP relay's password) are fine because nothing in the
   game can test them. A `.env` names its database without a working password; a
   `password_hash` column holds values no in-game tool reverses to a pool word; no backup or
   config word may be any password-pool word. Harvestable credentials are a missions concern.
2. **No new player verbs.** Content fits the shipped command surface. Plumbing needed to display
   content honestly is not a verb (lynx's `<table>`/`<pre>`, stamping `/home/guest`). Refused
   and not to be re-asked: `SHOW DATABASES`/`USE`, `LIMIT`/`COUNT`, Redis hashes and lists,
   `zcat`. Generated histories may still TYPE commands v2 lacks (`tail`) — see §9.
3. **Every reference is true, within its network.** A host, IP, hostname, `.lan` name, port,
   URL or path that would live in the game exists: `/etc/hosts`, `known_hosts`, `.ssh/config`,
   histories, crontabs, app configs, intranet links, leases. References stay inside the box's
   own network (its LAN and gateway chain), name generated hosts only (never player occupants,
   who come and go), and things outside the game (github.com, vendor URLs) are fiction and
   exempt. A person's name is not a world reference.
4. **History is frozen and ends at the epoch.** Each box has a seeded life ending at
   `WORLD_EPOCH` (2026-07-12, `core/cve/worldClock.ts`) on one calendar; afterwards only players
   change it. The base tree stays a pure function of the box's coordinates. Every NPC box reads
   as abandoned at 2026-07-12 — accepted. The one timestamp past the epoch is a DHCP lease's
   expiry, and every listed lease is still held at it.
5. **History lives in rotated `.1` logs; live logs start empty.** Forced, not chosen: the log
   appenders (`appendMachineLog`, `appendAuthLog`, …) read-modify-write the WRITER's own patch
   row and start from `''`, so history seeded into a live log would vanish at the first trace.
   A `.1` exists only when it holds a line, only beside its live log, with that log's exact
   permissions. Plain text only, no `.gz`. No `dpkg.log` history (it would carry versions).
6. **Every generated machine, never a player workstation.** NPC hosts of every role on every
   layer, and every gateway kind. A player's workstation stays a fresh install — the player IS
   its user — except an empty guest-tier `/home/guest`. A bought database or store is also a
   fresh install.
7. **Content keys on role, prefix overlay and gateway vendor; no new roles.** A role drives
   service placement and rates, which is balance, not content. A hostname prefix that names a
   genuinely different device gets an overlay (printer, camera, phone, `nginx-`, `api-`);
   synonym prefixes share the role pool. Prefix lists may grow within a role, but that re-rolls
   hostnames → machine ids → orphans journals and moves every pin, wire-check host selection
   and the `v2-e2e` skill's derived secrets.
8. **A network persona plus a box inhabitant.** The persona comes from the ESSID's category
   (`pools/essidCatalog.ts`; uncatalogued ESSIDs seed one) and gives an organisation, a kind of
   place, its vocabulary and a `.lan` domain. The inhabitant comes from the box's existing
   username (`mrodriguez` → Maria Rodriguez) and agrees across `.gitconfig`, history, notes,
   mail and DB rows. Roles are drawn blind to the persona, so the persona adapts to what was
   drawn. Domains are the network's X1 `.lan` zone — no invented public domains.
9. **One account per box stays.** `/etc/passwd` is root, one uid-1000 NPC, guest; hydra's knobs
   are untouched. Other people exist only as references. Pages name people by full name and
   role mailboxes, never a username.
10. **Permissions follow Debian.** Homes and mail are user-tier; `/root`, private service data,
    spools, backups and `mail.log` are root-only; `/etc`, web and `/srv` are world-readable;
    `/etc/aliases` and `vsftpd.userlist` sit at `/etc/passwd`'s tier. Escalation pays in
    content: guest sees the surface, user sees a person, root sees the box's history.
11. **Every content concern draws on its own new stream.** No existing stream gains a draw, so
    no pinned password, service, role or page re-rolls. The accepted exceptions, each done once:
    the database and store splits (DB credentials and store locks re-rolled) and the four IoT
    prefixes (hostnames re-rolled).
12. **Pools are authored static data** under `core/generation/pools/`, filled from the two
    personas. No text is synthesized at runtime.
13. **Content is version-free.** No version in a page, banner, config comment, history line or
    log. `/var/lib/dpkg/status` is the single source of versions. In practice: **no output line
    carries a decimal** that reads as a version — `dsn=2.0.0`, `delay=0.31`, `1.2G`,
    `sitemap.xml`'s `1.0`/`0.9`, CUPS's `na_letter_8.5x11in` were all dropped; prices are whole
    euros; measurements with a unit (`21.4 °C`) are stripped by `withoutMeasurements` before the
    sweep.
14. **Sizes are characters, not bytes.** An access log's size is the page's `content.length`;
    `get`, `vsftpd.log.1` and the page log count the same way.
15. **Content that cross-references is one derivation.** When two files must agree (the mail
    spool and `mail.log.1`; `/srv` and `vsftpd.log.1`; a camera's snapshots and a recorder's
    copies; a gateway's leases, backups and admin pages), one function returns both, or the
    second re-derives the first's draws. A second independent pass is how they drift.
16. **A setting that describes where data already is must agree with that data**
    (`virtual_mailbox_base`, `mynetworks`); one that names what a running daemon would create
    stays true on a box whose daemon is down (`queue_directory`, TLS paths).

## Seeds and streams

Mulberry32 over an FNV-1a string seed, one stream per concern. NPCs key on `<essid>-<ip>`;
gateways on their own seed key or machine id.

| Stream | Draws |
|---|---|
| `network-persona-<essid>` | the persona of an uncatalogued ESSID |
| `inhabitant-`, `home-content-` | a desk's person and home |
| `etc-content-`, `root-content-`, `ssh-content-` | `/etc`, `/root`, both `.ssh/` |
| `log-history-` | every `.1` rotation except the ones below |
| `web-site-` | a webserver's site (other http hosts keep `web-page-`) |
| `mysql-db-` / `db-app-`, `db-app-network-<essid>` | DB credentials / the application, the network's archetype |
| `redis-store-` / `redis-app-` | the store's lock / its keys |
| `mail-network-<essid>`, `mail-box-`, `mail-log-`, `mail-cron-` | the network's one correspondence, a mailbox, the mail log, cron's mail |
| `share-`, `share-phone-`, `share-log-`, `share-disk-`, `document-noise` | `/srv`, phone models, the transfer log, the data disk's UUID, binary noise |
| `device-` | an IoT box's device layer (pages draw nothing) |
| `phone-content-`, `tablet-` | a phone or tablet's storage, a tablet's model |
| `mac-<machineId>`, `gw-net-<seed key>` | one MAC per host, a gateway's leases or MAC table |
| `gw-admin-`, `gw-history-`, `gw-history-logs-`, `gw-history-backups-`, `gw-history-ui-` (by machine id) | a gateway's admin, history, rotations, backups, admin UI |

## What a box holds

Assembled in `generation/remoteHostFs.ts` (`buildRemoteHostFs`), which builds the page, the
database, `/etc` and `/var/log` once each as values and hands them to whatever must agree with
them. Gateways assemble in `buildGatewayBaseFs`.

**Every NPC box** (`etcContent.ts`, `rootHome.ts`, `sshContent.ts`):
`/etc/{hostname,hosts,resolv.conf,fstab,crontab,motd}`; `/root` dotfiles, history and 0–2 notes;
`/home/guest` with the Debian skeleton. On a LAN with an ssh-running neighbour, root's
`known_hosts` and, on desks, `~/.ssh/{known_hosts,config}` naming neighbours' real accounts.
`buildEtcContent` is never handed the account, so no world-readable file can name it. Deep boxes
name only themselves and `127.0.0.1`.

**Desks** (`desktop|laptop|workstation`, `npcHome.ts`): dotfiles, `.bash_history` whose network
lines name real neighbours in v2 syntax, `.gitconfig`, 2–5 notes.

**Phones and tablets** (`phoneHome.ts`): a maker-shaped layout (Android `DCIM/Camera/`,
`Download/`…; Apple `DCIM/100APPLE/`, `Downloads/`) keyed on `make === 'Apple'`; 6–16 JPEG stubs
in bursts on real shooting days, Exif naming the device's model; 2–6 personal PDFs and sometimes a
place paper authored by a real inhabitant; 0–3 notes; 10–25 files by construction. No dotfiles,
no `.ssh/`, no person's mailbox (cron's may exist).

**Rotations** (`logHistory.ts`): `syslog.1`, `auth.log.1`, `kern.log.1`, `access.log.1`,
`mysql.log.1`, `redis.log.1`, `named.log.1` where their rules put them, all dated 2026-07-11. It
reads the box's crontab, fstab, served pages and database as built. CRON lines are the crontab's
own jobs; ~15% of boxes reboot; root ssh logins come from real neighbours; `access.log.1` requests
real pages at their real sizes. **Four rotations span more than one day**, and
`boxMemory.test.ts`'s `SPANS_MORE_THAN_A_DAY` names each so a fifth cannot land silently:
`mail.log.1`, `vsftpd.log.1`, a printer's `cups/page_log.1` and a lock's `lockd/access.log.1`. `named.log.1` has no lookup
lines because the live log does not log lookups.

**Webservers** (`webSite.ts`, `pools/webSites.ts`) serve three layers under `/var/www/html`:
4–12 linked public pages shaped by prefix and persona (`portal-` lists real neighbours by `.lan`
name; `api-` serves JSON); breadcrumbs (`robots.txt`, `sitemap.xml`, one HTML comment) whose every
path is served; and 1–4 unlinked paths drawn from the shipped dirlist so a default `gobuster`
pays. `dump.sql` is schema-only and always present on a mysql webserver. The web tools resolve
`.lan` names through `resolveLanName`. Other http hosts serve one version-free page.

**Databases** (`generateDatabase.ts`, `databaseApp.ts`, `pools/databaseApps.ts`): 15 application
archetypes as data, picked by prefix (`portal-` cms, `api-` api), role (mail) or the network's
category. A LAN `users` table holds the box's account plus every neighbour's; other tables hold
5–40 rows, referentially sound and dated inside the application's life. `generateApplication` is
the one function both doors call.

**Stores** (`generateRedisStore.ts`, `pools/storeApps.ts`): the same application's working set —
`sess:`, `cache:<table>:<id>` (real rows minus `password_hash`), `queue:`, `lock:`, `perms:`,
`ratelimit:`, `stats:`, `flag:`, `config:webhook:` — shuffled like a real `KEYS *`. A store with
no database beside it serves the box's own application. No counter in a spec counts part of
another.

**Mail** (`networkMail.ts`, `mailbox.ts`, `pools/mailThreads.ts`, `pools/cronMail.ts`): one
correspondence per network, so a thread reads the same on the desk that sent it and the server
that carried it. mbox, one file per mailbox, with real `>From ` quoting. Desks get
`/var/mail/<user>`, mail servers the spool plus `mail.log.1` whose queue ids are the messages' own,
and `/etc/aliases`; any box whose crontab prints gets `/var/mail/root`. `peopleKnownOn` is the one
roster mail and the share read.

**File servers** (`share.ts`, `documentFormats.ts`, `pools/shareFiles.ts`): `/srv` holds the
category's departments — a working share, or dated nightly snapshots on backup prefixes — as PDF,
JPEG and office stubs whose metadata `strings` reads (office files never give up their author).
Noise is Latin-1 so `strings` ignores it and JSON writes it as itself. `vsftpd.log.1` records every
arrival from its author's machine to the character; `fstab` mounts the data disk at `/srv`;
`vsftpd.userlist` is an allow list.

**IoT** (`device.ts`, `device/<kind>.ts`, `pools/devices.ts`): seven kinds over eleven prefixes —
printer, camera (`cam`, `doorbell`, `babycam`), recorder (`nvr`), climate (`sensor`,
`thermostat`), media (`tv`, `speaker`), plug, lock. Each keeps its config world-readable under
`/etc/<daemon>/` and its data at the account's tier under `/var/lib/<daemon>/`, and serves 2–3
linked pages where http already runs. Print jobs are real share documents from their last saver's
machine; a recorder's copies are its cameras' snapshots byte for byte (`cameraRecordings`
re-derives them); readings behave physically. A lock's pages never say who opened it.

**Gateways** (`gatewayNetwork.ts`, `gatewayHistory.ts`, `gatewayBackups.ts`, `gatewayAdminUi.ts`,
`hostMac.ts`): every router runs dnsmasq leases for its segment's machines with the other gateways
as reservations; every switch keeps a one-row MAC table. Every gateway has an admin who is a real
inhabitant at their real machine (a desk, else a phone or tablet, else any machine; a deep gateway
from its parent's IP), root's history, `.1` rotations, 2–4 vendor-format backups with secrets
masked, and 2–4 admin pages under the vendor's web root (never `/var/www`, which tier-3 publishes)
bound to `127.0.0.1:80`. The AP gateway keeps one backup and two pages because its tree crosses the
wire. The site is looked up ONCE per build and handed to all four builders — four lookups broke the
build budget.

## Budgets and carry limits

- **`scripts/checkBudgets.ts`** runs as `postbuild` and fails on either breach: gzipped main chunk
  over **284,975 B** (the 134,975 B pre-epic baseline + 150 KB), or the catalog networks averaging
  over **2 ms per box** through `generatedBaseFsForMachineId`. It is a script, not a vitest test,
  because Stryker aborts its dry run on any failure. Only local `npm run build` enforces it —
  Vercel builds the frozen root. At close-out: 221,518 B and ~0.86 ms/box. Base trees are NOT
  memoized; add memoization only when the build budget breaks, with the measurement as the reason.
- **The 8,192-character signed-write cap.** Saving a fetched file is one signed write capped by
  `signedEnvelopeSchema`, so generated files a player can `get` must fit in JSON. Latin-1 noise
  and UPLOAD-only transfer lines exist because of it; `share.test.ts` sends every transfer log
  through the real `createPatchApi`. Older logs still exceed it (§9, "Generated files too big to
  carry home").
- **The AP gateway's wire ceiling** is 32,768 characters of its root-tier serialized tree (at most
  25,167 used at close-out).

## How it is tested

- **Property tests over the whole world**, not examples: `npcHome`, `boxSurface`, `boxMemory`,
  `webSite`, `database`, `store`, `mailbox`/`networkMail`, `share`, `device` (+ one per kind),
  `gatewayNetwork`/`gatewayHistory`, `phoneHome`. Each reads every catalog and uncatalogued
  network, LAN and deep, for: no dead reference, no version (`softwareVersionsIn`), no unfilled
  slot, no account but root where one is forbidden, no date after the epoch, no password-pool
  word, every pool entry reachable. Shared helpers: `src/test/worldContent.ts`,
  `src/test/deviceBoxes.ts`.
- **Variety has a number.** Within a network no two boxes share a byte-identical free-text file;
  across the catalog each category meets a distinct-body ratio (e.g. ≥ 95% root histories).
  Files that state one network fact (`resolv.conf`) are exempt.
- **Rare roles get synthetic networks.** Any ESSID generates a whole network, so tests add 120
  `HOME-NET-<n>` LANs or one-of-each databases where the catalog holds too few. The synthetic deep
  boxes in `deviceBoxes.ts` share an address, so measure variety over machines a network really
  placed.
- **Build fixtures inside each test.** A file-level cache lets Stryker's per-test coverage credit
  the whole builder to the first test.
- **The world byte-diff** proves "no existing stream gained a draw": build every box on `main` and
  on the branch, key each file by `<essid>/<ip>/<path>` plus pseudo-files `#hostname`, `#role`,
  `#services`, and classify every added, changed and removed path. A content PR expects only its
  own surface to move.
- **Pins move deliberately.** Exact-tree and hash pins for generated boxes are updated where
  content lands; the player workstation's exact-tree pin stays true.

## Accepted gaps

Inside the rules, recorded so they are not rediscovered as bugs: a café's `orders` can predate
its first `menu_items` row and an order's total is not the sum of its lines; a store counter is
plausible, not a count of rows; a lock's unlocks are spread evenly over the day, some at 3 a.m.;
no file that names a phone is reachable on a catalog LAN yet, and a deep printer's spool and a
switch's MAC table wait on a deep-chain pivot recipe; Apple's phone layout has never been reached
in play.
