# Plan: World Content Slice 9 — A Device Is the Device It Says

**Epic:** `plans/world-content-epic.md`, slice 9. Grill record: the epic's "Locked decisions"
1–25, plus **twelve owner decisions and the derived points confirmed with them** (2026-09-24),
recorded in the epic's status log and restated under "Decided at planning" below.

**Status:** PR 9a DELIVERED (#545, v0.259.0, 2026-09-24). PR 9b not started — it is unblocked.

**Delivery:** three independent PRs against trunk, in order. Each starts once the one before it
merges.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 9a | `feat/iot-prefix-growth` | v0.259.0 | ✅ **DONE** (#545) — `plug`, `lock`, `nvr`, `babycam` join iot; the one re-roll, its pins, docs and journal reset |
| 9b | `feat/a-device-is-the-device-it-says` | v0.260.0 | ⏳ device kinds; printer (CUPS config, spool, `page_log.1`, UI), camera (events, snapshots, UI), recorder (archive, UI), LAN and deep |
| 9c | `feat/every-device-says-what-it-is` | v0.261.0 | climate, media, plug, lock (configs, data, UIs), LAN and deep; `device.conf` and the generic IoT page pool retire |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

### As-built: PR 9a

One RED-GREEN increment as planned, then one test from the mutation gate.

- **The re-roll, measured.** 90 IoT boxes renamed in place (14 `plug`, 11 `nvr`, 7 `lock`,
  6 `babycam` among them); no box's role or services moved, no file added or removed. The three
  pins moved as predicted: `tv-187` → `nvr-187` (home LAN golden), `speaker-179` → `nvr-179`
  (deep golden), `doorbell-87`/`tv-137` → `tv-87`/`lock-137` on ACME-CORP's deep zone (`cam-189`
  and the home LAN's `cam-138` unchanged). The conventions doc's ftp example is the same `.26`
  host, now `babycam-26`. No script, skill or doc hardcoded an IoT name.
- **The byte-diff, and how 9b and 9c should run it.** The probe keyed every file by
  `<essid>/<ip>/<path>`, plus three pseudo-files per box (`#hostname`, `#role`, `#services`), so
  a moved role or service shows as a differing path rather than hiding inside content. The
  classifier builds each network's old→new name table from `#hostname`, substitutes it into the
  `main` side, and requires the result to equal the branch. That explained all but 34 files;
  those move a number or a column that depends on a name's length — an access log's page size, a
  mail log's `size=`, four zone files' padding — and pass once those are normalised, each
  access-log size also checked against the page it serves. 9b and 9c change content rather than
  names, so their classifier is per path, but the pseudo-files carry over unchanged.
- **Sizes are characters, not bytes, everywhere.** The access log's size is the page's
  `content.length`, so a page holding `—` logs a few bytes under its UTF-8 size. That is the
  game's one convention (`get` and `vsftpd.log.1` count the same way, as 8a recorded), not a
  defect; 9b's `page_log.1` and spool sizes follow it.
- **Mutation** (`pools/hostnames.ts` alone): 47 → 48 killed of 52, 0 timeouts. The gate found a
  gap on an unchanged line: nothing held that a name without the octet claims no role, so a
  player's workstation called `nas1` could have read as a file server; a test now does. Of the
  four survivors, `separator <= 0` is equivalent, and three are load-time throws (the table as
  `{}`, either map callback as `() => undefined`) that the narrowed runner reports as "no tests"
  — applied by hand, the suite fails.

**Verified:** 5,858 unit tests; wire-checks `testSameLanConnect` 4/4, `testCrossPlayerRead` 7/7,
`testDeepChainReach` 6/6, `testFtpRemoteRead` 7/7 and `testFtpSession` 14/14 on a reset local
stack; bundle 204,118 B of 284,975 B; build 0.69–1.09 ms per box of 2 ms.

---

## Goal

A player who reaches a generated device finds the device its name says. A printer keeps a CUPS
spool of jobs real people sent from their real machines, printing documents that sit on the
network's file server; `strings` on a control file names who and what, and the printer's
`page_log.1` agrees. A camera keeps an event index whose every entry names a snapshot that exists,
carrying the camera's own model; the network's recorder holds the same snapshots, byte for byte,
under that camera's `.lan` name. A lock remembers who came in, a thermostat what it read, a
television which phones it paired with. Where a device serves http, its UI shows what its disk
holds.

## Grounding (verified 2026-09-24, v0.258.0)

- **104 IoT boxes in the world** (the 50 catalog + 4 uncatalogued networks): 70 on LANs, 34 deep.
  By prefix: `sensor` 20, `printer` 16, `speaker` 15, `doorbell` 14, `thermostat` 14, `tv` 14,
  `cam` 11.
- **Doors.** http on 29 of 104 (3 of 16 printers, 3 of 11 cams), ftp on 35, sshd on 13
  (`rolePlacement.ts`: iot `ssh: 0.1`, no mysql or redis; http and ftp at the flat rate). Every
  deep box has sshd forced by `buildDeepHostFs`. **nginx is an exploit route** — its CVE effect
  pool grants `shell_full`, `file_read`, `file_write` (`cve/exploitEffect.ts:73`) — so http is
  attack surface, not only a page.
- **An IoT box is a small Debian board today.** Slices 2–3 gave it `/etc` (`hostname`, `hosts`,
  `resolv.conf`, `fstab`, `crontab`, `motd`), `/root` with a board-flavoured history (`vcgencmd
  measure_temp`, `i2cdetect -y 1`), `/home/guest`, rotated logs, and one role config: `device.conf`
  drawn from five templates on `etc-config-<essid>-<ip>` (`pools/configFiles.ts:76`). Its account is
  a service name: `device`, `iotuser`, `sensor`, `mqtt`, `telemetry`, `gateway`, `controller`,
  `monitor` (`pools/usernames.ts:76`).
- **Two falsehoods ship today.** Every `device.conf` template quotes a version (`BusyBox v1.31.1`,
  `firmware=v2.1.4`, `current=2.1.4`) against decision 21, and no test sweeps it; a printer's
  `device.conf` may call it a Zigbee coordinator or a Modbus RTU. `IOT_PAGES[0]`
  (`pools/webPages.ts:56`) advertises `rtsp://{{hostname}}:554/live`, a port nothing serves
  (decision 4), and two pages name years that may predate the box (decision 22).
- **An IoT box serving http keeps one page**, `pickWebPage({ role: 'iot', seed:
  'web-page-<essid>-<ip>' })`, from four IoT templates (`remoteHostFs.ts:402`).
- **Hostnames.** `generateHomeLan` and `generateDeepLayer` name a machine
  `${prng.pick(HOSTNAME_PREFIXES[role])}-${octet}` on a stream shared by every sibling. `pick`
  takes one draw whatever the list's length, so **growing iot's list renames iot boxes only** —
  no other role's name, no draw after it, no role and no service moves (services key on role and
  `(essid, ip)`). What does move is every file that names an IoT box (`/etc/hosts`, DNS zones,
  histories, mail, pages) and each IoT box's machine id, orphaning its journal rows.
- **Pins that name IoT boxes:** `generateHomeLan.test.ts` `GOLDEN_HOSTS` (`tv-187`),
  `generateDeepLayer.test.ts:124` (`speaker-179`), `generateDnsZone.test.ts:196,343–344`
  (`cam-138`, `doorbell-87`, `tv-137`, `cam-189`). `remoteHostFs.test.ts`'s `cam-31`/`cam-7` are
  synthetic hosts and do not move. `v2/docs/conventions-and-gotchas.md:3090` names `speaker-26` on
  `VSFTPD-LAB` as a wire-check's pick. **No wire-check script and no `.claude/skills` file names an
  IoT host**; the scripts select hosts by service at run time.
- **What 9b can reuse.** `renderDocument` (`documentFormats.ts`) renders a JPEG stub from `{ make,
  model, takenAt, artist }` and a PDF from its metadata; `buildShare` returns `{ tree, uploads }`
  and each upload names its file's path and author; `peopleKnownOn` (`mailbox.ts:350`) is the
  roster mail and the share use (LAN people with their machines; deep, the box's own
  application's logins via `boxPeople`); `phoneModel` (`share.ts:338`) draws each phone's model
  on `share-phone-<essid>-<ip>`, so every box agrees what model a phone is.
- **The 8192-character carry cap.** Saving a fetched file is one signed write whose JSON payload
  `signedEnvelopeSchema` caps at 8192 characters. Slice 8 hit it twice (an `.xlsx`, then
  `vsftpd.log.1`); `auth.log.1` is still over it on 102 boxes (backlogged).
- **Budgets today:** bundle 204,101 B gzipped of a 284,975 B ceiling (~81 KB headroom);
  0.752 ms/box of 2 ms.

## Scope boundary

**In:**
- **Four new iot prefixes** and everything that must follow the rename (9a).
- **Seven device kinds** over the eleven prefixes, each with its own config, data and — where
  http already runs — a small UI (9b, 9c).
- **Every IoT box, LAN and deep** (decision 6).
- **The falsehoods fixed:** `device.conf` retires with its versions; the generic IoT pages retire
  with their `rtsp` port and stray years (9c, once every kind has its own).

**Not built here, deliberately:**
- **No placement change.** No kind serves http, ftp or ssh more or less often (owner decision 4):
  a UI the world rarely serves is the cost of not widening nginx's exploit route.
- **No new door, service or verb.** No IPP/631, rtsp/554, mqtt/1883 or telnet service; no `lpstat`,
  `lp`, `cancel`, `ffprobe` (decision 3). A setting naming one of those ports states it on
  `localhost` or `127.0.0.1` only.
- **No video format.** Recordings are events with JPEG snapshots (owner decision 7).
- **No new pointer into device data from existing pools.** Root's IoT history, desk histories,
  notes and mail are not edited to name a spool or a snapshot: adding lines would re-roll homes
  already shipped. Devices are found where Debian and the vendor put their data.
- **No firmware-style box.** The Debian surface slices 2–3 built stays (owner decision 1).
- **No loot** (decision 2): no code slot holds a code, no config a working secret.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. A lock's code slots are named, never numbered; no config holds a secret for anything in the game. |
| 3 | The shipped surface only: `ls`, `cat`, `strings`, `grep`, ftp's `get`, lynx and `curl`. |
| 4 | Every host, IP, `.lan` name, port and path a device file names is real on its network. |
| 6 | Every IoT box on every layer. |
| 7 | Fulfilled here: prefix overlays and prefix growth, the one accepted re-roll. |
| 8 | People are the network's own; the persona supplies the place. |
| 9 | IoT 6–15 content files, excluding binary stubs; a recorder, a storage device, may hold more. |
| 13 | Tiers follow Debian (owner decision 11). |
| 15 | New streams only; the re-roll is decision 7's. |
| 17 | Variety tested within and across networks; a recorder's copies are shared by design. |
| 21 | Version-free — the reason `device.conf` goes. |
| 22 | Every date — job, event, reading, unlock, snapshot — within the box's life, before the epoch. |
| 23 | Pins move deliberately in 9a; truth rules become property tests. |

## Decided at planning (2026-09-24)

**By the owner:**

1. **An IoT box stays the small Linux board** slices 2–3 made it; a device layer goes on top.
   **Rejected:** a BusyBox/firmware box (undoes two slices on 104 boxes and moves where sessions
   land).
2. **iot gains `plug`, `lock`, `nvr`, `babycam`** — decision 7's list, the one re-roll.
3. **Seven device kinds** key the overlays: **camera** (`cam`, `doorbell`, `babycam`), **recorder**
   (`nvr`), **printer**, **climate** (`sensor`, `thermostat`), **media** (`tv`, `speaker`),
   **plug**, **lock**. Prefixes share a kind only when they are one device in another flavour; the
   flavour still shows (a doorbell's events include rings, a babycam's sound, a thermostat keeps a
   schedule a sensor does not).
4. **Placement unchanged** (see "Not built here").
5. **A small device UI, 2–4 linked pages per kind**, under slice 4's no-dead-link property, with
   no `robots.txt`, `sitemap.xml` or hidden dirlist layer.
6. **Print jobs are real people at their real machines printing real documents** — a document on
   one of the network's file servers' shares where it has one, the category's titles where it has
   none.
7. **A camera's recordings are an event index with JPEG snapshots**; a recorder archives the
   network's real cameras by `.lan` name, byte-identical to each camera's own snapshots.
8. **Climate** keeps readings and (thermostat) a schedule; **media** its paired devices (the
   network's real phones), recently played and apps; a **plug** its schedule and daily energy; a
   **lock** an access log of real people from their real phones, plus its code slots. MQTT brokers
   stay on `127.0.0.1`.
9. **Each kind's own config replaces `device.conf`**, drawn on the existing `etc-config-` pick.
10. **Deep devices get the same overlay, self-contained:** a printer's jobs are its own people at
    `localhost`, a recorder's cameras are PoE channels on its own ports, a lock's people use keypad
    codes, media pairs nothing.
11. **Tiers follow Debian, with the box's one account as the device's daemon user.** Device data is
    user-tier; the CUPS spool, `/var/log/cups`, `/etc/cups` and the lock's access log are
    root-only; the UI's job list shows `Withheld` for user and title, as CUPS does by default.
12. **Three PRs in order** (above).

**Derived and confirmed:**

13. **Streams.** Device content draws on a new `device-<essid>-<ip>`; the device UI on a new
    `device-ui-<essid>-<ip>`. An IoT box's page moves off `web-page-`, which changes page text on
    IoT boxes only. Proven by the whole-world byte-diff in 9b and 9c with every differing path
    classified.
14. **9a's refresh:** the three pins above; the conventions doc's `speaker-26`; a check that every
    wire-check still selects its host by service; `npx supabase db reset` on the local stack.
15. **`page_log.1` spans more than a day**, beside an empty live `page_log`, the third spanning
    rotation named in `boxMemory.test.ts` beside `mail.log.1` and `vsftpd.log.1`: a printer that
    prints a few pages a day never fills the log to its rotation size.
16. **Every device file fits the carry cap**, proven by sending each through the real
    `createPatchApi` against `signedEnvelopeSchema`, as 8b's transport test does.
17. **The usual sweeps:** version-free, one calendar, no unfilled slot, inert, no account name in a
    world-readable file, every pool entry reachable, a variety test, the budgets.

---

## Device kinds

| Kind | Prefixes | Config (`/etc`) | Data | UI pages |
|---|---|---|---|---|
| printer | `printer` | `cups/cupsd.conf` (pooled), `cups/printers.conf` (generated: the queue) | `/var/spool/cups/c<id>` control stubs; `d<id>-001` for the last day's jobs; `/var/log/cups/page_log` + `page_log.1` | Home, Printers, Jobs (`Withheld`) |
| camera | `cam`, `doorbell`, `babycam` | a camera config naming its event and snapshot directories | an event index; snapshot `.jpg` stubs | Live, Events |
| recorder | `nvr` | a recorder config listing the cameras it pulls | an archive per camera: `<camera .lan name>/<date>/…jpg`, plus an index | Cameras, Recordings |
| climate | `sensor`, `thermostat` | a sensor config (interval, units, local broker) | `readings.csv`; a thermostat's schedule | Readings, Schedule |
| media | `tv`, `speaker` | a cast/media config | paired devices, recently played, installed apps | Now playing, Devices |
| plug | `plug` | a plug config | schedule; daily energy log | Status, Schedule |
| lock | `lock` | a lock config | code slots (named, no codes); access log (root-only) | Status |

Paths follow what real Linux devices do (`/var/lib/<daemon>/…` for a daemon's state, `/etc/<daemon>/…`
for its config); each kind's exact paths are fixed in its increment and pinned by test.

### What "true" means here (decision 4, applied)

- **People:** every person named is of the box's cast (`peopleKnownOn`), spelled as `inhabitant()`
  spells them; account names appear only in root-only files.
- **Machines:** a job's originating host, a lock's phone, a media device's pairing and a recorder's
  camera are real machines on the box's own LAN, by the kind they are (only phones pair; only
  camera-kind boxes are recorded). Deep boxes name only themselves (`localhost`, PoE channels).
- **Documents:** a print job's title is a file on one of the network's shares, and its data file,
  where kept, is that file byte for byte.
- **Snapshots:** every event names a snapshot the box holds; a recorder's copy equals the camera's.
- **Calendar, versions, slots, inert:** as decision 17 of this plan.

---

## PR 9a — IoT grows four devices

**Class:** behaviour change (new prefixes drawn and read back as iot), with a deliberate re-roll.
**Required skills:** `tdd`, `testing`; `refactoring` after green; `mutation-testing` at PR readiness.

**Value:** a player sweeping a LAN meets `plug-`, `lock-`, `nvr-` and `babycam-` boxes, which
behave as iot (same placement, same account pool) and are named correctly everywhere the network
names them — `/etc/hosts`, the DNS zone, histories, mail.

**Path:** `HOSTNAME_PREFIXES.iot` → `generateHomeLan` / `generateDeepLayer` names → `roleOfHostname`
→ services, account, content.

### Acceptance criteria

- [ ] Each of `plug`, `lock`, `nvr`, `babycam` is read back as iot and is drawn somewhere in the
      world's LAN or deep population.
- [ ] No other role's hostname changed; no box's role, services, account or passwords changed
      (whole-world byte-diff: differing paths are IoT hostnames and the files naming them, all
      classified).
- [ ] The pins naming IoT boxes are updated on purpose, and their comments still describe what
      they pin.
- [ ] The conventions doc's wire-check example names a host that exists; every wire-check picks its
      host by service; the local journal is reset.
- [ ] Wire-check regression set passes; budgets hold.

**Evidence:** `generateHomeLan.test.ts` (new prefixes read back and drawn; existing "no shared
prefix" and "well-formed prefix" properties still hold); the byte-diff probe at the v2 root
(`main` vs branch, sha1 per file, every differing path classified); wire-checks
`testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`, `testFtpRemoteRead`.
**Mutation:** the change is one data list; run scoped to `pools/hostnames.ts` and record the
result, or `N/A` with the byte-diff as alternate evidence if Stryker has nothing to mutate but the
array literal.

### Increments

1. **The four prefixes.** RED: `roleOfHostname('nvr-12')` (and the others) is iot and each is drawn
   in the world. GREEN: extend the list. Then refresh the three pins, the conventions line, and
   reset the local journal.

---

## PR 9b — A printer prints, a camera watches

**Class:** behaviour change. Same skills.

**Value:** on a network with a file server, `ftp printer-44 <account>` → as root (after
escalation) `strings /var/spool/cups/c00042` names `sthompson`, `192.168.97.252` and
`special-issue.pdf`; `nmap` names that address `workstation-252`, and `files-143`'s share holds
`special-issue.pdf`. `page_log.1` has the job's line. `lynx printer-44` (where http runs) lists the
job with user and title `Withheld`. On a camera, `cat /var/lib/<daemon>/events.log` names
`snapshots/20260711-0412.jpg`, which `strings` shows was taken by the camera's own model at that
time; `nvr-88` holds the same file under `cam-31.<zone>.lan/2026-07-11/`.

**Path:** `buildRemoteHostFs` → `deviceKindOf(hostname)` → a `device-<essid>-<ip>` build per kind →
`/etc`, `/var/lib`, `/var/spool`, `/var/log/cups` entries at their tiers → the kind's UI on
`device-ui-<essid>-<ip>` where http runs → `buildLogHistory` gains `page_log.1` from the same job
list (one derivation, as the spool and `mail.log.1` are).

### Acceptance criteria

- [ ] Every printer, LAN and deep, holds `/etc/cups/cupsd.conf` and `/etc/cups/printers.conf`
      (root-only) and no `device.conf`; its queue name is the one its spool and log use.
- [ ] Every printer's spool holds 3–12 control-file stubs whose `strings` give the job's user, host
      and title; on a LAN printer each job names a person of the cast from the machine that person
      uses, and on a network with a file server its title is a document on a share there; a deep
      printer's jobs come from its own people at `localhost`. The last day's jobs keep a data file
      equal to the document where the document is on a share.
- [ ] `page_log.1` holds one line per job, agreeing with its control file, ordered, before the
      epoch, beside an empty live `page_log`; both root-only.
- [ ] Every camera-kind box holds a camera config, an event index and snapshots; every event names a
      snapshot it holds; every snapshot's `strings` gives the camera's make and model and the event's
      time; doorbells' events include rings and babycams' sound.
- [ ] Every LAN recorder archives exactly the network's camera-kind boxes, each under its `.lan`
      name, byte-identical to that camera's snapshots; a deep recorder archives PoE channels on its
      own ports and names no LAN host.
- [ ] Where http runs, a printer, camera or recorder serves its kind's 2–4 page UI; no link dead;
      the Jobs page shows the spool's jobs with user and title `Withheld`; the Cameras page names
      the recorder's real cameras.
- [ ] Tiers: device data user-tier, spool, CUPS logs and `/etc/cups` root-only; guest reads
      neither.
- [ ] Every device file passes the carry-cap transport test.
- [ ] Version-free, calendar, slots, inert, no account in a world-readable file; variety; every
      pool entry reachable.
- [ ] Nothing else moved: the byte-diff shows only printer, camera and recorder boxes (their
      `/etc`, `/var`, pages and root history's config and log paths), classified.
- [ ] Budgets hold.

**Evidence:** a new `generation/device.test.ts` over every IoT box in the world plus synthetic
boxes of every kind × layer, built inside each test (never a file-level cache); metadata read
through the `strings` command's own extraction; the kind → prefix table restated in the test, not
imported. `boxMemory.test.ts` names `page_log.1` as the third spanning rotation.
`remoteHostFs.test.ts`'s one-role-config test takes the kind configs. Wire-checks
`testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`, `testFtpRemoteRead`,
`testFtpTransferTrace`. A played run via `v2-e2e`: a printer reached over ftp, the control file
fetched by a root session and read with `strings`, its host `nmap`ped, its document found on the
share; a camera's snapshot fetched and its twin found on the recorder.

### Increments (TDD, one commit each after approval)

1. **Device kinds and the printer's config.** `deviceKindOf`; printers carry `/etc/cups` in place
   of `device.conf`.
2. **The spool.** Jobs from the cast, their machines and the network's shares; control stubs;
   the last day's data files. LAN, then deep.
3. **`page_log.1`** from the same job list; the spanning rotation named.
4. **Camera events and snapshots**, with the doorbell and babycam flavours and the camera config.
5. **The recorder's archive**, LAN and deep (PoE channels), with its config.
6. **The UIs** for printer, camera and recorder, and the carry-cap transport test over every device
   file so far.

---

## PR 9c — Every device says what it is

**Class:** behaviour change. Same skills.

**Value:** a thermostat's `readings.csv` and schedule agree with each other; a TV lists the
network's real phones among its paired devices; a plug's energy log follows its schedule; as root,
a lock's access log names the people who came in and the phones they used. `device.conf` is gone
from every box, and no IoT page names a port nothing serves.

**Path:** the same kind dispatch, for climate, media, plug and lock; `CONFIG_BY_ROLE.iot` and
`IOT_PAGES` retire.

### Acceptance criteria

- [ ] Every climate, media, plug and lock box, LAN and deep, holds its kind's config (no
      `device.conf` anywhere in the world) and its data files, 6–15 content files in all.
- [ ] Readings are ordered, on the calendar, within physical ranges; a thermostat's readings
      respond to its schedule's set points.
- [ ] Media pairings are the network's real phones (none on a deep box); nothing played or
      installed names a version.
- [ ] A plug's daily energy is non-zero only on days its schedule turned it on.
- [ ] A lock's access log (root-only) names people of the cast, each from their own phone where
      they have one and by a keypad slot otherwise; deep, keypad only. Code slots are named, never
      numbered.
- [ ] Where http runs, each kind serves its UI; the generic IoT page pool is gone; no IoT page names
      `rtsp`, `:554` or a year outside the box's life.
- [ ] Carry cap, sweeps, variety, reachability, byte-diff (only the four kinds' boxes), budgets.

**Evidence:** `device.test.ts` extended; `remoteHostFs.test.ts`'s page tests move from the IoT pool
to the kinds' UIs; same wire-check set; a played run reading a lock's log as root and `nmap`ping a
phone it names.

### Increments (TDD, one commit each after approval)

1. **Climate.** 2. **Media.** 3. **Plug.** 4. **Lock.** 5. **UIs for the four kinds**, then
**retire `device.conf` and `IOT_PAGES`** once nothing draws them.

---

## Risks

- **The re-roll's reach.** Every file naming an IoT box moves in 9a; the byte-diff must classify
  each differing path as "names an IoT box" or the PR stops. A draw that moved elsewhere means the
  pick assumption was wrong.
- **The UI is rare.** 29 IoT boxes serve http today (3 printers). The observable's UI half will be
  met on few boxes by design; the played run picks one that serves it.
- **A printer page on an nginx box.** The pidfile says nginx; the UI is CUPS's. Settled at 9b's UI
  increment: `cupsd.conf` listens on `localhost:631` and the UI reads as the print server's pages
  published by the box's web server, so no file claims a port the scan does not show.
- **Printers build shares.** A LAN printer on a network with file servers reads their shares'
  uploads, and a recorder derives each camera's events; both are extra builds per box. The build
  budget decides; memoize only on a breach (decision 19).
- **The carry cap.** An event index, `page_log.1`, a readings CSV or a lock log can outgrow 8192
  JSON characters; the transport test sets each file's volume.
- **Kinds that are rare after the re-roll.** Eleven prefixes over ~104 boxes leave ~9 of each; a
  kind with no LAN instance on the catalog is covered by synthetic boxes, and reachability is
  measured on the synthetic set as slice 5 did.
- **Pins move.** 9a's three pins; 9b/9c's one-role-config test, IoT page tests and IoT tree
  shapes — all deliberately (decision 23).
