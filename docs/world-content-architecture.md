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
3. **Every reference is true, and stays within its network unless a relation leads out.** A
   host, IP, hostname, `.lan` name, port, URL or path that would live in the game exists:
   `/etc/hosts`, `known_hosts`, `.ssh/config`, histories, crontabs, app configs, intranet
   links, leases. References stay inside the box's own network (its LAN and gateway chain),
   name generated hosts only (never player occupants, who come and go), and things outside the
   game (github.com, vendor URLs) are fiction and exempt. A person's name is not a world
   reference. The one way out is a **relation** of the box's own network
   (`generation/relations.ts`): a contractor's shortcut, an offsite backup job or a head
   office's shortcut to its branch may name another network's public address, at a port
   open there. A backup copy is its source's
   files, so it states its source's network, never the box it sits on. Even a template's
   example names a real neighbour or none: the workstation `ssh_config` shortcuts name a
   neighbour that answers ssh on that port, and `rules.v4`'s example forward says
   `<internal_ip>`.
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
   and the `e2e` skill's derived secrets.
8. **A network persona plus a box inhabitant.** The persona comes from the ESSID's category
   (`pools/essidCatalog.ts`; uncatalogued ESSIDs seed one from every category, findit's is fixed
   in `finditNetwork.ts` so a new category never re-rolls a box players reach) and gives an
   organisation, a kind of place, its vocabulary and a `.lan` domain. The inhabitant comes from the box's existing
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
| `network-profile-<key>` | how much stands behind the gateway of a network the world draws: `lone`, `flat` or `deep`, weighed by its category |
| `gw-forwards-<key>` | the services the gateway of a network the world draws forwards beside its site: which, and on which public port (a home forwards ssh first when a machine there runs it) |
| `town-businesses-<town key>` | how many businesses a town keeps (a village 3–6, a town 12–24, a city 40–80) |
| `town-hospital-<town key>` | whether a town bigger than a village keeps a general hospital |
| `town-business-kinds-<town key>` | each business's category and kind, no kind twice while its category has another |
| `town-business-names-<town key>` | each business's name, from its kind's templates |
| `town-practices-<town key>` | how many practices a town keeps beside its businesses (a village 1–2, a town 2–4), and whether each is a clinic or a dentist |
| `town-practice-names-<town key>` | each practice's name, from its kind's templates, clear of every name drawn before it |
| `corporations` | how many corporations the world draws beyond the landmarks, and each one's kind, no kind twice while another is left |
| `corporation-names` | each corporation's name, from the corporations' own grammar, clear of every name drawn before it |
| `town-branches-<town key>` | how many branches of the corporations a town keeps (a village 1–2, a town 2–3), and each one's corporation, none twice |
| `town-homes-<town key>` | how many homes a town keeps (a village 4–8, a town 12–24), then each one's form, template and words, clear of every wifi and word its homes already hold |
| `relations-<key>` | the leads that go to a network: how many, from whom, of which kind, from which box |
| `relation-host-key-<key>-<ip>` | the host key every desk or head office that has met a client or branch box records for it |
| `relation-cron-`, `relation-cron-log-` | an offsite backup job's time of night; its `syslog.1`/`auth.log.1` lines |
| `town-unlisted-<town key>` | which of a town's publishers keep their site off every search |
| `relation-supplier-<key>` | which listed customer, and which of its working shares, keeps an unlisted business's invoice |
| `relation-invoice-<key>-<ip>` | an invoice's number, date, total and the person who filed it |

## How big a network is

A network the world draws declares a **profile** (`world.ts`), and `generateHomeLan` builds
the LAN it allows:

- `lone`: the `.1` gateway and one machine.
- `flat`: the `.1` gateway and 2–5 machines; an office 3–5, room for a box serving its site,
  a working share and a desk.
- `deep`: the `.1` gateway, an inner router, a switch and 3–8 machines, with a chain of hidden
  segments behind the inner router (`generateDeepLayer`). A landmark declares no profile and
  is always this shape.

Only `deep` hides anything, so only a council, an office or a big shop is worth walking down.
A home or a café is never `deep`, and a council, an office or a place of care never
`lone`. A publisher's LAN
always holds the web server its site answers from. Every reader of the shape (scans, ssh
reach, the inner-gateway lookups, the DNS zone, snmp, the gateway's own files) asks the LAN,
never the profile, so a network with no inner gateway has none anywhere.

## The towns

Every town is a row the world declares and generates (`world.ts`), and so is Ridgemont, a
city, beyond its 57 **landmarks**: the catalog's networks, written by hand and keyed by the
name each broadcasts. Harrow Valley holds eleven towns: Ridgemont (`r0/t0`); the villages Millbrook
(`r0/t1`), Ashby (`r0/t2`), Fenwick (`r0/t5`), Thornbury (`r0/t6`), Hollowmere (`r0/t7`) and
Ely (`r0/t8`); the towns Oakhurst (`r0/t3`), Wexcombe (`r0/t9`) and Stonebury (`r0/t10`); and
the city of Kingsford (`r0/t4`). A town's index is part of every key and address inside it, so
rows are only ever appended. Millbrook is declared before the corporations; every later town is
a row of `TOWN_ROWS`, declared by one fold in row order, each one's names drawn clear of every
network declared before it, so declaring it moved nothing of theirs but the gateways of the
corporations that keep a branch there.

**Ridgemont beyond its landmarks** is drawn last, after Stonebury, as a city is: 121 networks
keyed `r0/t0/n57`–`r0/t0/n177` after the landmarks, answering after them in Ridgemont's block.
Its council, police, library and courthouse are landmarks already, so of a city's
institutions it draws only the general hospital (`ridgemonthospital.org`); then 65
businesses, 44 homes, 8 practices and the branches of three corporations. They are drawn as
any town's networks: a profile, leads among them, forwards beyond a site, `, Ridgemont` after
a place's name on its site, findit's listing but for the unlisted. The landmarks are the
exception, and every rule that leaves them out asks `isLandmark(key)` rather than the town: a
landmark declares no profile or kind, keeps and receives no lead, forwards nothing beyond its
site, and its site reads as it was written.

Everybody stands in Ridgemont, so a scan draws from all 178 of its networks
(`crackableEssidPool` in `generateWifi.ts`: the landmarks in the catalog's order, then the
drawn networks in key order), each held by its **key**: the scan entry, the association, the
join, the BSSID, the cracked password and the remembered connection all carry it, as every
generator does. A player only ever reads the name a network broadcasts (`essidOf(key)` in
`world.ts`): `airodump-ng`'s rows, `aircrack-ng`'s capture line, `nmcli`'s messages and the
HUD show it, and `nmcli connect` matches what was typed against it. A landmark's key is its
name, so nothing changed for one.

A row is a name and a **size class**, and the class is one table (`SIZE_CLASSES`) of how many
of each kind of place the town draws beyond its institutions:

| Size | Businesses | Homes | Practices | Branches |
|---|---|---|---|---|
| village | 3–6 | 4–8 | 1–2 | 1–2 |
| town | 12–24 | 12–24 | 2–4 | 2–3 |
| city | 40–80 | 40–80 | 5–8 | 3–5 |

Oakhurst draws 47 networks: five institutions, 18 businesses, 20 homes, a clinic and a
dentist, and branches of Dunmore Group and Sheridan & Mortimer. Kingsford draws 166: five
institutions, 71 businesses, 80 homes, six practices and four corporations' branches. The later
villages draw 15 to 20 networks each, Wexcombe 38 and Stonebury 51; the world declares 491.

- **Its institutions** come from one rule on the town's name (`institutionsOf`): the council
  (`{Town} Town Council`, `{town}.gov`, `TOWN-HALL-WIFI`, which keeps the town's directory),
  the police (`{Town} Police Department`, `{town}pd.gov`, `{TOWN}-PD`) and the library
  (`{Town} Public Library`, `{town}library.org`, `LIBRARY-PUBLIC`). A town bigger than a
  village also keeps a **courthouse** (`{Town} County Court`, `{town}courts.gov`,
  `COURTHOUSE-WIFI`, "the courthouse"), and draws a **general hospital** or none on
  `town-hospital-<town key>` (`{Town} General Hospital`, `{town}hospital.org`,
  `GENERAL-HOSPITAL`, "the hospital", kind `hospital`). Both stand after the library and are
  on the council's directory; a village keeps neither. A city draws its hospital as a town
  does, there being no city whose draw keeps none to tell the two apart. Oakhurst, Kingsford
  and Stonebury keep both; Wexcombe's draw keeps no hospital. Millbrook's
  cottage hospital is its own, declared after its homes.
- **The rest is drawn** on the town's own streams, keyed `r<region>/t<town>`: its
  businesses, then its homes, then its practices, then the corporations' branches there, each
  keyed as the town's next network and answering in the town's own block (`87.98.x.y` for
  Millbrook, `87.195.x.y` for Ashby, `87.38.x.y` for Oakhurst, `87.135.x.y` for Kingsford,
  and so on, one second octet a town). A corporation may keep branches in several towns: its
  headquarters' gateway then keeps a lead to each.
- **Names.** No domain repeats anywhere in the world, and no wifi repeats within a town: a
  scan shows one town's wifi at a time, so two towns' town halls both broadcast
  `TOWN-HALL-WIFI`, and two villages may each keep a Rose Cottage. Every wifi is at most 32
  characters.
- **No word names two places a town draws.** A word is what fills a slot of a name: a
  surname, a street or a filler of a business's or a practice's, a surname, a plant or a
  description of a home's. Among a town's businesses, practices and homes, a name using a
  word the town already holds is drawn again, as one whose wifi or domain is held is, so no
  town reads as written from one short list. A template's own text is no word: one town may
  keep Rose Cottage and Ivy Cottage. A branch carries its company's name and is drawn by no
  town's grammar, so it is outside the rule. The corporations, drawn as one list, hold it
  among themselves.
- **A town keeps an office a search lists.** The leads to its homes start on an office's
  desk, so the unlisted draw is drawn again when it would leave the town no listed office
  (`unlistedOf`), and a lead only ever starts on a listed publisher (`relations.ts`).

## What a business is

A town's businesses (`world.ts`) each draw a category, cafe 30, retail 40 or corporate 30,
and then a **kind** from that category's list (`pools/businessKinds.ts`): a grocer, a bakery,
a pharmacy, a bookshop, an electronics shop, a hardware shop, a pawn shop or a florist; a
café, a tea room or a coffee bar; a consultancy, a logistics firm, an insurer, an IT firm or
an accountant. No kind repeats in a town while its category has another left. Institutions,
homes and Ridgemont's networks have no kind.

- **Its name** comes from its kind's templates (`{surname}'s Bakery`, `{street} Hardware`,
  `{filler} Market`), each with one slot filled from the 72 surnames, 36 streets or 60
  fillers of `NAME_WORDS`, so every kind can form 150 names or more (the least, the coffee
  bar, 156). A name whose wifi, domain or word another network already holds is drawn again.
  The wifi and the domain are spelt from the name without its accents or apostrophes
  (`Whitlock's Café` is `WHITLOCKS-CAFE`, `whitlockscafe.com`). The templates and lists only
  grow at the end, and freeze at launch.
- **Every name fits its wifi**, not only the names drawn: a test spells every name each
  template can form, a corporation's with each declared town's name after it as its
  branch's wifi, and holds them all to 32 characters. The words are chosen so a town named
  in ten letters fits too: no surname runs past 10 letters, nor a filler past 12, so a later
  town never forces a rename.
- **Its site** says what it sells or does. Its category's search description and front
  pages carry slots (`{goods}`, `{service}`, and a shop's `{daily}` and `{range}`, an
  office's `{work}`) that its kind fills (`SITE_WORDS` in `pools/webSites.ts`). A shop,
  café or office with no kind fills them with the words its category always had
  (`CATEGORY_WORDS`), so the landmarks' sites read as they always did. Every other page, and
  everything else on its boxes, is its category's.
- **Every town keeps an office.** The leads to a town's homes and hidden sites start on an
  office's desk or its file share, so when a town draws no office its last business is one.
  A town's office names every workstation a desk and every file server a working share, and
  when none of its machines drew one, the lowest free machines (never the one serving its
  site) become a file server and a desk.

## What a home is

A village keeps 4–8 homes and a town 12–24, drawn on `town-homes-<town key>`: the count first, then
each home's name from the homes' own grammar (`pools/homeNames.ts`), named the way people
name their own. A home publishes nothing (see `discovery-architecture.md`, "Leads"). Each
draws a form by weight, then one of the form's templates, then its words:

| Form | Weight | Wifi | Place |
|---|---|---|---|
| family | 35 | `THE-{SURNAME}S`, `{SURNAME}-FAMILY`, `{SURNAME}-WIFI` | "the {Surname}s' house", "the {Surname} family home" |
| house | 30 | `{PLANT}-{COTTAGE/HOUSE/VIEW/LODGE}`, or one that stands alone (`THE-OLD-RECTORY`) | its name: "Rose Cottage", "the Old Rectory" |
| flat | 15 | `FLAT-{1–9}{A–D}`, `{GARDEN/TOP/BASEMENT}-FLAT` | "flat 2A", "the garden flat" |
| router default | 20 | `{NETGEAR/LINKSYS/TP-LINK/BT-HUB}-{four hex digits}` | a description: "the house on the corner" |

A surname ending in "s" takes no more (`THE-HARGREAVES`, "the Hargreaves' house"). Every
place reads after "at" ("bills at Rose Cottage"). The homes' surnames, plants and
descriptions are lists of their own, sharing no word with a business's, so no home reads as
the family behind a shop of its town. No two homes of a town share a wifi or a word, and no
form names a wifi Ridgemont broadcasts.

## What a corporation is

Beyond the twenty landmark corporations the world draws 20–40 more (`world.ts`), declared
after every town and keyed `c0`, `c1`, …, so no town's key moves. Each is one head office
that **stands in no town**: its declaration names no town or region, `whois` prints no
`city:` or `region:` for it, its people never name a town, and a join to it is refused as to
any network outside Ridgemont. It answers in the placeless `193` block after findit and the
landmark corporations (`c<n>` at the block's position 21 + n).

In every other rule it is an office: one of the five corporate kinds, no kind twice while
another is left; the corporate profile row, so `flat` or `deep`; a desk and a working share
beside its site server; its site forward and one or two more. It always publishes and is
always listed (the unlisted draw is a town's), so findit is the one way in. It receives no
lead, as leads are drawn among the networks of one town, and keeps one only to each of its
branches.

- **Its name** comes from a grammar of its own (`CORPORATION_NAME_TEMPLATES` in
  `pools/businessKinds.ts`): `{surname} Group`, `{filler} Holdings`, `{surname} & {surname}`,
  filled from the businesses' word lists (`{filler} International` would have held a filler
  to 7 letters in a branch's wifi). Every slot is filled and no word fills two slots of one
  name (the name draw does this for every template, and a business's one slot draws as it
  always did), and no two corporations share a word. It is drawn after every other name,
  clear of them all, and spelt into its wifi and `.com` domain as a business's is (`Quayle &
  Bellamy` is `QUAYLE-BELLAMY`, `quaylebellamy.com`).
- **Its branches**: a village draws 1–2 offices of the corporations and a town 2–3 (on
  `town-branches-<town key>`, no corporation twice), keyed as the town's next networks after
  its practices but declared last of all, after the corporations whose names they carry.
  A branch declares its `parent`; it is `corporate` with its parent's kind, its wifi
  `<PARENT-ESSID>-<TOWN>`, its place "the <Town> office"; it publishes nothing and draws the
  corporate profile and forwards. Its IT is the head office's: no network of its town leads
  to it and it leads to none. The head office's gateway keeps the one lead, in root's
  `.ssh/config` and `known_hosts` (`buildBranchSshDirectory` in `sshContent.ts`), so a head
  office's access point holds up to 12 files of its own where any other holds 10, and its
  files name no town but in that shortcut. `whois` names the branch's line after its parent's
  site, in the branch's town. Millbrook keeps one, `r0/t1/n17` `SUMMIT-HOLDINGS-MILLBROOK`, an
  office of `c6` Summit Holdings. Its own files speak for "the Millbrook office", not for the
  company.

## What a place of care is

`healthcare` is the tenth category, appended to `NETWORK_CATEGORIES`, so every category pool
holds its entry: front pages, site pages, people roles, API endpoints, MOTDs, notes, work
history, personal mail, phone downloads, share departments (admissions, radiology, pharmacy,
estates, rotas) and unnamed places. Millbrook's is **the cottage hospital** (`COTTAGE-HOSPITAL`,
`millbrookhospital.org`), an institution declared after the town's homes (`MILLBROOK_LATER_INSTITUTIONS`
in `world.ts`) so no earlier key or address moves, but listed on the directory with the other
institutions. It is `flat` or `deep`, never `lone`. A town's general hospital (above) is
one too, Oakhurst's `r0/t3/n4`, standing among its institutions.

A village also keeps 1–2 **practices** and a town 2–4, a clinic or a dentist each (`PRACTICE_SUBTYPES` in
`pools/businessKinds.ts`), no kind twice while the other is left. They are counted apart from
the businesses, on streams of their own, and appended after the institutions declared later,
so no earlier key moves. A practice is a business in every rule but its count: it always
publishes under a name from its kind's templates (`{street} Medical Centre`, `{surname} Dental
Care`), spelt into its wifi and `.com` domain as a business's is, it is in its town's unlisted
draw, it receives leads as a business does (an unlisted practice gets a supplier), and the
council's directory no more lists it than a shop. Its name is drawn after every other network's,
so it avoids them all and moves none. Millbrook keeps one, **Gateway Dental** (`r0/t1/n16`,
`gatewaydental.com`, `flat`).

- **Its site** fills a `{care}` slot: the hospital (`SITE_WORDS.hospital`) with wards, visiting
  hours and outpatient clinics, a clinic with GP appointments, vaccinations and blood tests, a
  dentist with check-ups, fillings and the hygienist, and a place of care with no kind
  (`CATEGORY_WORDS.healthcare`) with appointments, check-ups and advice. Its team page is `clinicians.html`, "Our clinicians".
- **Its database** is the `appointments` archetype: patients (`PT-` numbers, a name, a date of
  birth kept as text, since the schema has no DATE type and a row's first DATETIME dates it),
  clinicians, appointments, and sometimes rooms and a waiting list. Nothing clinical: no table
  holds a diagnosis, a condition, a treatment or a note.
- **Its boxes** carry no desk, mail server or file server in Millbrook's draw, so its notes,
  history, mail and share departments are proven on healthcare networks outside the catalog
  (`HealthCentre-WiFi`, `Practice-Staff`, `Patient-Staff` in `src/test/worldContent.ts`).

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
lines name real neighbours in v2 syntax, `.gitconfig`, 2–5 notes drawn. **No two people on one
network keep the same note**: a desk drops any note a desk at a lower address on its LAN keeps,
drawing nothing in its place, so it may keep fewer than two. A desk's notes are the first draw
on its `home-content-` stream, so its neighbours' are read without building their homes; a
deep-layer desk stands alone on its layer.

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
name; `api-` serves JSON) — except on an institution's site server, which always serves the
public site whatever its prefix, so a published homepage never maps a LAN or documents an API.
A network runs one API, on the first `api-` box a player reaches there (its LAN, then down its
chain); another box named for one keeps a site as any web server does, since two would answer
every endpoint with the same document;
breadcrumbs (`robots.txt`, `sitemap.xml`, one HTML comment) whose every
path is served; and 1–4 unlinked paths drawn from the shipped dirlist so a default `gobuster`
pays. `dump.sql` is schema-only and always present on a mysql webserver. The web tools resolve
`.lan` names through `resolveLanName`. Other http hosts serve one version-free page.

**Databases** (`generateDatabase.ts`, `databaseApp.ts`, `pools/databaseApps.ts`): 18 application
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
and `/etc/aliases`; any box whose crontab prints gets `/var/mail/root`. A network one person has
to themselves keeps no correspondence, so its mail server carries none: no mailbox, not even an
empty one, no `mail.log.1` and no `/etc/aliases`, only the empty `mail.log` its role opens. `peopleKnownOn` is the one
roster mail and the share read.

**File servers** (`share.ts`, `documentFormats.ts`, `pools/shareFiles.ts`): `/srv` holds the
category's departments — a working share, or dated nightly snapshots on backup prefixes — as PDF,
JPEG and office stubs whose metadata `strings` reads (office files never give up their author).
No department holds more than ten files, a supplier's invoice included: a working share that is
sent invoices draws its own `invoices` department, when it keeps one, with room for them
(`buildServerShare` in `supplierInvoices.ts`).
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
  because Stryker aborts its dry run on any failure. Vercel's build runs the bundle check
  only; the timing is a local gate, since Vercel's build machine is several times slower. At
  close-out: 221,518 B and ~0.86 ms/box. Base trees are NOT
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
  network and every network the world draws, LAN and deep, for: no dead reference, no version (`softwareVersionsIn`), no unfilled
  slot, no account but root where one is forbidden, no date after the epoch, no password-pool
  word, every pool entry reachable. Shared helpers: `src/test/worldContent.ts`,
  `src/test/deviceBoxes.ts`.
- **Leads out of a town network have their own properties** (`relations.test.ts`): every
  public address a Millbrook box, a branch or its head office names is its own or a
  relation's, every private one is on
  the network whose facts the file states, and both ends of each relation agree. The
  whole-world tests read the same leads through `leadsKeptOn(box)`, and a one-person network
  keeps no correspondence: there is nobody for its person to write to.
- **Variety has a number.** Within a network no two boxes share a byte-identical free-text file;
  across the catalog each category meets a distinct-body ratio (e.g. ≥ 95% root histories).
  Files that state one network fact (`resolv.conf`) are exempt, and so are those that state one
  policy of the whole organisation, which a real one copies to every box: a department's
  `README.md` on its shares and a site's `robots.txt` on its web servers.
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
