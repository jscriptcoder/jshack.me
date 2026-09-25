# Plan: World Content Slice 10 — A Gateway Knows Its Network

**Epic:** `plans/world-content-epic.md`, slice 10. Grill record: the epic's "Locked decisions"
1–25, plus **eight owner decisions** (2026-09-25) recorded in the epic's status log and restated
under "Decided at planning" below, with the derived points that follow from them.

**Status:** Planned, not started.

**Delivery:** two independent PRs against trunk, in order. 10b starts once 10a merges.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 10a | `feat/a-gateway-knows-its-network` | v0.262.0 | per-host MACs; the ESSID reaches the deep gateway builders; dnsmasq leases and config on every router; a MAC table on every switch; the AP's serialized-size check |
| 10b | `feat/a-gateway-remembers` | v0.263.0 | vendor-format config backups; the admin UI on disk; root's history; `.1` rotations of the gateway's live logs |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who roots a gateway finds a map of its network. On the AP, `cat
/var/lib/misc/dnsmasq.leases` lists exactly the LAN's generated machines, each by its real IP,
hostname and a MAC that agrees with every other table naming that host. An inner or deep router
leases the layer it fronts, and a switch keeps a MAC table of that layer. The box also remembers who
ran it: dated backups in its vendor's own export format that agree with the live box, the vendor's
admin UI on disk, and in root's history and `auth.log.1` a real inhabitant logging in from their
own workstation.

## Grounding (verified 2026-09-25, v0.261.0)

- **200 gateways on the 50 catalog networks:** 50 AP (`.1`), 50 inner routers, 50 inner switches,
  33 deep routers, 17 deep switches. Depth 1/2/3 on 12/19/19 networks. 162 of the 200 run snmpd.
  Firmware: ddwrt 42, cisco 36, openwrt 35, ubiquiti 31, pfsense 28, mikrotik 28
  (`pickFirmwareVendor`, `routerFs.ts:177`, its own `firmware-` stream).
- **Gateways missed every earlier slice by construction.** They are built by
  `generation/routerFs.ts`: five public builders (`buildApGatewayBaseFs` `:339`,
  `buildInnerGatewayBaseFs` `:368`, `buildSwitchBaseFs` `:424`, `buildDeepGatewayBaseFs` `:392`,
  `buildDeepSwitchBaseFs` `:407`) that all funnel into `buildGatewayBaseFs` (`:189–305`). None of
  them goes through `buildRemoteHostFs`. Every gateway has the same skeleton: stubs, `/boot`, a
  root-only `/etc/passwd`, `rules.v4` (router) or `acl.conf` (switch), the snmp confs when the
  agent runs, and empty `/root`, `/tmp` and live logs (`access`, `auth`, `kern`, `snmpd`). It also
  carries `dpkg/status` with `<vendor>-firmware` last.
- **The deep builders take no ESSID.** Neither does `resolveDeepGatewayIdentity`
  (`lanHostIdentity.ts:120`) or `resolveChildGatewayHop` (`network/deepLayerHop.ts:56–65`). The
  callers that hold one are `chainGatewayBaseFs` (`lanHostIdentity.ts:193`) and
  `deepScanHosts.ts:76`.
- **Each gateway sees two populations:** the layer it stands on and, for inner and deep
  gateways, the layer it fronts (`generateDeepLayer(essid, { machineId, kind }, …)`, which holds one
  NPC plus a child gateway behind a router). `chainLinks(essid)` (`lanTopology.ts:120`) walks the
  chain. The AP's population is `generateHomeLan(essid)`: machines, the inner router and the switch.
- **No NPC host has a MAC.** Only the player's own NICs have one (`seededMac`,
  `network/interfaces.ts:139`, seeded from the pubkey).
- **No gateway serves http.** `machineServing` (`network/machineServing.ts:32–34`) answers from
  the box's own ports before it looks at forwards, so a port on the AP would shadow players'
  forwards.
- **Mutable gateway state that content must not collide with:** `rules.v4` (forwards, input
  denies; nano, `snmpset`, the snmp apt install), `acl.conf`, both snmp confs, `/boot`, every live
  log (whole-file writer rows), `dpkg/status` (apt), and `/var/run/*.pid` (systemctl, backdoors).
- **The AP tree crosses the wire.** `materializeApGatewayFs` (`network/materializeRouterFs.ts:28`)
  is called from `resolveCrossPlayerFs.ts:163–176` after tier filtering and the tier-3 allowlist,
  and the server rebuilds it for writes (`remoteWritePermission.ts:108`).
- **Firmware CVEs.** `cve/firmwareExploit.ts:30–35` rates `dir_list` weakest because "every
  router-class box has a byte-identical skeleton". That stops being true here.
- **Pins that move:** `routerFs.test.ts` byte-identical determinism (`:212`, `:255`, `:551`) keeps
  holding, but any exact file-list assertion moves. The live-logs-empty test (`:693–700`) keeps
  holding: history goes to `.1`. Hostname and password pins (`:139`, `:170`) must not move.
- **Budgets:** bundle 212,718 B gzipped of a 284,975 B ceiling; build 0.689 ms/box of 2 ms.
  `checkBudgets.ts:71–90` already times the AP and deep gateways.
- **The 8192-character carry cap** applies to every readable file (`signedRequest/types.ts:33`).

## Scope boundary

**In:**
- Every gateway kind on every layer (decision 6): leases (routers), MAC tables (switches), backups,
  an admin UI on disk, root's history, `.1` rotations.
- One MAC per generated host, so a MAC is one fact of the network.

**Not built here, deliberately:**
- **No port, no placement change.** The admin UI's httpd config listens on `127.0.0.1`; `nmap`
  shows what it shows today, and forwards are never shadowed (owner decision 1).
- **No new daemon.** dnsmasq and the UI's httpd get a binary stub and a config, no pidfile. `ps`,
  `systemctl` and the D4 daemon lists are unchanged (owner decision 7).
- **No `/etc` breadth** (`hostname`, `hosts`, `resolv.conf`, `motd`, `crontab`) (owner decision 8).
- **No MAC on NPC boxes' own files.** No `ip`/`ifconfig` output for NPC boxes exists to agree
  with; the MAC stream is what a future one reads.
- **No occupants.** Leases and tables name generated hosts only (decision 4).
- **No loot** (decision 2): backups redact every secret; no config holds the admin password, the
  community or anything that works in the game.
- **No `dpkg.log` history, no version anywhere** (decisions 10, 21): firmware history says a
  flash happened, never what version.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. Backups redact secrets as the vendor's own export does. |
| 3 | Shipped surface only: `ls`, `cat`, `grep`, `strings`, `scp`/`ftp` `get` where they already reach. |
| 4 | Every IP, hostname, `.lan` name and MAC is real on the box's network; generated hosts only. |
| 5, 22 | Frozen at the epoch; every date within the gateway's seeded life. |
| 6 | Every gateway kind, every layer; the AP modest because it crosses the wire. |
| 7 | Gateways key on kind + firmware vendor. |
| 9 | Inner/deep gateways 8–15 content files, the AP 5–10. |
| 10 | History in `.1` rotations; live logs untouched. |
| 13 | Debian tiers. |
| 15 | New streams only; no gateway password, community, hostname or vendor re-rolls. |
| 17 | Variety tested within and across networks; leases and MAC tables are facts (exempt). |
| 21 | Version-free. |
| 23 | Pins move deliberately; truth rules become property tests. |

## Decided at planning (2026-09-25)

**By the owner:**

1. **The admin UI is on disk, bound to localhost.** The vendor's web root holds the admin pages;
   the UI httpd's config listens on `127.0.0.1`. Placement is unchanged. **Rejected:** http on
   inner and deep gateways (widens attack surface, changes balance), and http everywhere (shadows
   forwards on the AP).
2. **Leases are one dnsmasq file on the Debian path**: `/var/lib/misc/dnsmasq.leases` plus
   `/etc/dnsmasq.conf` (range and reservations). The vendor shows in backups and the UI.
   **Rejected:** a lease format and path for each vendor.
3. **Routers lease, switches map.** The AP leases its LAN's machines; an inner or deep router
   leases the layer it fronts; a switch keeps a MAC address table of the layer it fronts. MACs come
   from one new per-host stream, so every table agrees.
4. **Two PRs** (above).
5. **Backups use the vendor's own export format, secrets redacted.** 2–4 dated backups under
   `/root/backups`: cisco running-config, mikrotik `.rsc`, openwrt uci, ddwrt nvram, pfsense
   `config.xml`, ubiquiti `config.boot`. Each agrees with the base box (hostname, subnet, DHCP range
   and reservations, seed forwards or ACL, snmp on or off) and redacts secrets the way that vendor's
   export does.
6. **The admin is a real inhabitant at their real machine.** On a LAN they are one of the network's
   inhabitants, logging in from their own workstation's IP; `auth.log.1`, root's `.bash_history` and
   the backups agree. A deep gateway is administered from its parent gateway's IP. Firmware lines
   are version-free.
7. **No new daemon** (see "Not built here").
8. **No `/etc` breadth** (see "Not built here").

**Derived and confirmed (2026-09-25):**

9. **Streams.** MACs draw on a new `mac-<machineId>`: one per generated host (machines and
   gateways), keyed by the id every layer already agrees on, from a small OUI pool shaped by what
   the host is (a phone, a printer, a vendor's router). Gateway network content draws on a new
   `gw-net-<gateway seed key>` (10a); history, backups and the UI on a new
   `gw-history-<gateway seed key>` (10b). The gateway seed keys are the existing ones (`ap-gw-`,
   `inner-gw-`, `inner-sw-`, `deep-gw-`, `deep-sw-`), so no existing draw moves.
10. **Leases vs reservations.** Leases hold the machines. The layer's gateways (the inner router
    and switch on a LAN, a child gateway on a deep layer) have static addresses and appear as
    `dhcp-host` reservations in `dnsmasq.conf`, not as leases. "Exactly the network's generated
    hosts" means: leases = the fronted or standing layer's machines; leases ∪ reservations = its
    hosts minus the gateway itself.
11. **Lease expiry is the one timestamp past the epoch.** dnsmasq writes an expiry, and a lease
    still held at the epoch expires after it. Grants fall on 2026-07-11, and each expiry is the
    grant plus the configured lease time. This is a clarification of decision 22, not a breach: the
    file states the day it was frozen.
12. **Rotations follow slice 3:** `auth.log.1`, `kern.log.1`, `syslog.1`, and `snmpd.log.1` where
    the agent runs, each holding 2026-07-11 alone with its live log's permissions. `access.log`
    gets no `.1`, because nothing served http. Firmware history spans the box's life through the
    backups' dates and root's history, not through a spanning rotation.
13. **Tiers (Debian):** leases, `dnsmasq.conf`, the UI's config and web root are world-readable;
    `/root/backups` and `/root/.bash_history` root-only; rotations copy their live logs.
14. **The AP stays small:** leases, `dnsmasq.conf`, one backup, 2–3 UI pages, root's history,
    rotations — within 5–10. Its tier-filtered serialized tree gets a size ceiling, set in 10a from
    a measurement across the catalog with headroom for 10b, and every gateway file passes the
    carry-cap transport test.
15. **`firmwareExploit.ts`'s `dir_list` rationale** is rewritten in 10b: the skeleton is no longer
    byte-identical. The effect weights do not change in this slice.
16. **Deep threading.** The deep builders, `resolveDeepGatewayIdentity` and
    `resolveChildGatewayHop` take the ESSID, because their callers already hold it. Machine ids do
    not change (proven by the byte-diff and the id pins).
17. **The usual sweeps:** version-free, one calendar, no unfilled slot, inert, no account name in a
    world-readable file, every pool entry reachable, variety, budgets. The whole-world byte-diff
    shows only gateway trees, with every differing path classified; NPC trees do not move.

---

## PR 10a — A gateway knows its network

**Class:** behaviour change.
**Required skills:** `tdd`, `testing`, `functional`; `refactoring` after green; `mutation-testing`
at PR readiness.

**Value:** the slice's observable. `ssh root@<subnet>.1` → `cat /var/lib/misc/dnsmasq.leases`
lists every generated machine `nmap` finds on the LAN (by IP, hostname and MAC) and nothing else;
`dnsmasq.conf` reserves the inner router and switch. On a deep router the leases are its fronted
layer's NPC; on a switch, `cat /var/lib/switch/mac-table` lists its layer's hosts by the same MACs
the router above it leased them under.

**Path:** `mac-<machineId>` → `buildGatewayBaseFs` receives the population it stands on or fronts
(ESSID threaded to the deep builders) → a `gw-net-` build per kind (router: leases + config;
switch: MAC table) → `/var/lib/misc`, `/etc`, `/var/lib/switch` at their tiers → the AP's
`materializeApGatewayFs` carries it across the wire.

### Acceptance criteria

- [ ] Every generated host has one MAC, and every table in the world that names a host names the
      same MAC for it.
- [ ] Every AP's leases list exactly its LAN's generated machines (IP, hostname, MAC), none of its
      gateways, and no player occupant; `dnsmasq.conf`'s range covers every leased address and its
      reservations are the LAN's gateways.
- [ ] Every inner and deep router leases exactly the machines of the layer it fronts and reserves
      that layer's child gateway where one hangs.
- [ ] Every switch, inner and deep, keeps a MAC table of exactly the hosts of the layer it fronts.
- [ ] Every lease is granted on 2026-07-11 and expires one lease time later; no date falls outside
      the gateway's life except that expiry.
- [ ] Leases and config are world-readable; the tier filter lets a remote reader of the AP see them
      as it sees `rules.v4`'s siblings.
- [ ] The AP's serialized, tier-filtered tree stays under its new ceiling; every gateway file
      passes the carry-cap transport test.
- [ ] Nothing else moved: the byte-diff shows new paths on gateway trees only; no hostname,
      password, community, vendor or machine id changed.
- [ ] Wire-check regression set passes; budgets hold.

**Evidence:** a new `generation/gatewayNetwork.test.ts` over every gateway in the catalog world
plus the synthetic LANs, built inside each test. The lease file is parsed by the test in dnsmasq's
own column order, and the truth checks compare against `generateHomeLan` / `generateDeepLayer`
directly. `routerFs.test.ts` exact-shape pins move on purpose. Wire-checks `testCrossPlayerRouter`,
`testInnerGatewayReach`, `testDeepChainReach`, `testDeepSwitchChain`, `testSharedApForwards`,
`testSnmpWalk`, `testExploitApGateway`, `testRouterBrick`. A played run via `v2-e2e`: root the AP,
read the leases, `nmap` the LAN and match every row; hop to a deep router and match its layer. The
`v2-e2e` skill's §4 gains the lease read.

### Increments (TDD, one commit each after approval)

1. **One MAC per host.** `macOf(machineId)` is stable, well-formed, unique within a network, and
   drawn on `mac-`.
2. **The AP leases its LAN.** Leases + `dnsmasq.conf` on the AP; exactly the machines; reservations
   for its gateways.
3. **Deep threading and router leases.** The ESSID reaches the deep builders; inner and deep routers
   lease their fronted layer.
4. **Switch MAC tables**, inner and deep.
5. **The AP's wire size and the carry cap.** The ceiling is measured and set; the transport test
   covers every gateway file.

---

## PR 10b — A gateway remembers

**Class:** behaviour change. Same skills.

**Value:** as root on a gateway, `ls /root/backups` shows dated exports in the firmware vendor's
own format; the newest agrees with `rules.v4` (or `acl.conf`), the DHCP range and the hostname, and
every secret in it reads as that vendor's redaction. `cat /root/.bash_history` shows the admin
editing and backing up; `auth.log.1` shows that admin, a real inhabitant, logging in from their own
workstation, whose IP `nmap` reaches and whose home is theirs. The vendor's UI pages sit in its
web root, and the httpd config binds `127.0.0.1`.

**Path:** a `gw-history-` build per kind × vendor → `/root/backups`, `/root/.bash_history`, the
vendor's web root and httpd config, and `buildLogHistory`-style `.1` rotations for the gateway's
live logs → merged in `buildGatewayBaseFs` beside 10a's files.

### Acceptance criteria

- [ ] Every gateway holds 2–4 backups in its vendor's format, dated within its life, ordered, the
      newest agreeing with the base box; no backup holds the admin password, the snmp community or
      any value the game accepts.
- [ ] Every LAN gateway's admin is an inhabitant of a workstation on that LAN; `auth.log.1`'s
      logins come from that workstation's IP; root's history names only paths and hosts that exist.
      A deep gateway's logins come from its parent gateway's IP.
- [ ] `auth.log.1`, `kern.log.1`, `syslog.1` (and `snmpd.log.1` where the agent runs) hold
      2026-07-11 alone, carry their live log's permissions, and name no version; live logs are still
      empty.
- [ ] Every gateway's web root holds 2–4 linked vendor UI pages, with no dead link, derived from its
      data (the lease or MAC table, the ports it forwards); the httpd config listens on `127.0.0.1`
      only; `nmap` shows the same ports as before.
- [ ] Content file counts: AP 5–10, inner and deep 8–15.
- [ ] Tiers: backups and history root-only; UI world-readable.
- [ ] `firmwareExploit.ts`'s `dir_list` rationale no longer claims a byte-identical skeleton.
- [ ] Carry cap, AP wire ceiling, sweeps, variety, reachability, byte-diff (gateways only), budgets.

**Evidence:** `gatewayHistory.test.ts` beside 10a's test, over the catalog and synthetic LANs and
every vendor × kind. `boxMemory.test.ts` extends its rotation rules to gateways. The same wire-check
set. A played run: root an AP, read a backup and root's history, `nmap` the admin's workstation,
`ssh` in and find the admin's home.

### Increments (TDD, one commit each after approval)

1. **The admin.** Picking a LAN inhabitant with a workstation (a deep gateway: its parent), and
   root's history.
2. **Rotations** for the gateway's live logs.
3. **Backups**, one vendor at a time, each agreeing with the base box and redacting secrets.
4. **The admin UI** on disk and its localhost httpd config; the `dir_list` rationale.

---

## Pre-PR quality gate (each PR)

1. Implementation and refactoring assessment complete.
2. `mutation-testing` scoped to the PR's new generation files (json reporter; cap concurrency, one
   file at a time on long runs); valuable survivors killed.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (budgets) from `v2/`.
4. Wire-check set above against `vercel dev` + local supabase.
5. Whole-world byte-diff probe (`main` vs branch), every differing path classified.
6. Version bump.

## Risks

- **The AP crosses the wire.** Its tree grows for every remote reader. The ceiling in 10a and the
  AP's 5–10 file limit are the guard; if they conflict, the AP gets fewer UI pages first.
- **Deep threading touches hop resolution.** `resolveChildGatewayHop` is on the live chain path; a
  changed signature must not change an id. The id pins, `testDeepChainReach` and
  `testDeepSwitchChain` hold it.
- **A gateway builds its population.** Leases need `generateHomeLan` or `generateDeepLayer`, one
  extra generation per gateway build. The build budget decides; memoize only on a breach
  (decision 19).
- **Six export formats.** Each vendor's backup is its own template; the variety test and one
  agreement test per vendor keep them honest.
- **Backups vs players' edits.** A player's forward makes `rules.v4` disagree with the backups.
  That is intended (backups are frozen at the epoch). The agreement test runs on base trees only.
