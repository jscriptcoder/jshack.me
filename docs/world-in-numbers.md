# The world in numbers

A census of the game as shipped: the world's towns and networks, the public web, every
generated machine and what it runs, the command surface, and the ways into a box. Every
number here was measured by running the generators over the whole declared world, not
copied from another doc. **Measured at v0.478.0 (2026-11-22).**

The world is a pure function of its declaration, so these numbers move only when a change
moves them: a new town, a new kind of place, a retuned placement rate, a new command. Such a
change should refresh this doc in the same PR (see "Refreshing the census"). The design behind
each number is in [`procedural-world-architecture.md`](./procedural-world-architecture.md)
(towns, keys, addresses), [`world-content-architecture.md`](./world-content-architecture.md)
(kinds of place, profiles, box contents) and
[`vulnerability-architecture.md`](./vulnerability-architecture.md) (the CVE axes).

## The world

One region, **Harrow Valley**, holds **11 towns** and **655 declared networks**, plus 10 boxes
that live on the internet alone (below).

| Town                               | Size    | Networks | Landmarks | NPC machines |
| ---------------------------------- | ------- | -------- | --------- | ------------ |
| Ridgemont                          | city    | 178      | 57        | 900          |
| Kingsford                          | city    | 176      | 10        | 649          |
| Stonebury                          | town    | 56       | 5         | 205          |
| Oakhurst                           | town    | 52       | 5         | 212          |
| Wexcombe                           | town    | 43       | 5         | 206          |
| Thornbury                          | village | 23       | 3         | 123          |
| Millbrook                          | village | 21       | 3         | 93           |
| Ashby                              | village | 21       | 3         | 119          |
| Hollowmere                         | village | 20       | 3         | 113          |
| Ely                                | village | 19       | 3         | 100          |
| Fenwick                            | village | 18       | 3         | 77           |
| Corporation head offices (no town) | —       | 28       | —         | 180          |

- **Landmarks:** 100 hand-written networks, Ridgemont's 57 (`pools/essidCatalog.ts`) and 43
  across the other towns (`pools/townLandmarks.ts`). Every other network a town holds is drawn.
- **Joinable over WiFi:** every town's networks, 627 in all, each only from inside its own
  town. A player starts in the town their key draws and moves with rideit.io. The 28 head
  offices stand in no town and are reached from the internet.
- **Corporate branches:** 22, each standing in a town; a head office leads to its branches.
- **Seeded gateway forwards** beyond a network's site: 386.
- **Contract networks** are not counted here: each is generated on demand from its contract
  number, at a `195` address ([`missions-architecture.md`](./missions-architecture.md)).

**By category**

| Category    | Networks |
| ----------- | -------- |
| residential | 227      |
| corporate   | 143      |
| retail      | 106      |
| cafe        | 79       |
| healthcare  | 36       |
| government  | 27       |
| public      | 15       |
| hacker      | 9        |
| iot         | 8        |
| university  | 5        |

**By profile** (how much stands behind the gateway): flat 281, lone 157, deep 117, and the 100
landmarks, which are always deep.

**By kind** (businesses, practices and hospitals a town draws)

| Kind        | Networks | Kind        | Networks |
| ----------- | -------- | ----------- | -------- |
| it-services | 26       | electronics | 14       |
| consulting  | 26       | hardware    | 13       |
| logistics   | 23       | bookshop    | 13       |
| tea-room    | 23       | bakery      | 12       |
| cafe        | 20       | grocer      | 12       |
| insurance   | 20       | florist     | 12       |
| accounting  | 20       | pharmacy    | 10       |
| coffee-bar  | 19       | pawn        | 7        |
| dentist     | 17       | hospital    | 5        |
| clinic      | 14       |             |          |

## The public web

- **Network websites:** 385, of which 45 are unlisted (no search shows them; a lead on
  another network's machines is the way there).
- **Fixed sites**, each a single box owning its public address with no WiFi and no LAN
  (`generation/fixedSites.ts`):

| Site          | What it is                             |
| ------------- | -------------------------------------- |
| findit.io     | the search engine                      |
| hackademy.io  | the tutorials (eleven chapters)        |
| mapit.io      | the map of Harrow Valley and its towns |
| emailit.io    | mail                                   |
| chainit.io    | the JSC block explorer                 |
| talkit.io     | the forum                              |
| hireme.io     | the contractor-board front door        |
| valleynews.io | the valley's paper                     |
| rideit.io     | coach and rail tickets to every town   |

- **One hidden fixed box**, `boards.hireme.io`, which answers at every board address hireme.io
  mails out and is listed nowhere.
- **Routes between networks:** findit search, each council's `/directory.html`, `whois`,
  mapit.io, and leads (an IT contractor's ssh shortcut, an offsite backup job, a supplier's
  invoice, a head office's shortcut to its branch).

## Machines

**4,274 boxes**: 4,264 generated across the declared networks, plus the 10 fixed boxes.

| Kind                                                        | Count |
| ----------------------------------------------------------- | ----- |
| Machines on a network's LAN                                 | 2,345 |
| Machines on deep layers                                     | 632   |
| LAN routers (655 access-point gateways + 217 inner routers) | 872   |
| LAN switches                                                | 217   |
| Deep routers                                                | 138   |
| Deep switches                                               | 60    |
| Fixed boxes                                                 | 10    |

217 networks (the 117 drawn deep ones and the 100 landmarks) hide a deep chain, 1–3 layers
behind the inner router.

**Roles of the 2,977 NPC machines**

| Role        | Machines |
| ----------- | -------- |
| workstation | 875      |
| webserver   | 693      |
| iot         | 652      |
| fileserver  | 396      |
| database    | 195      |
| mailserver  | 92       |
| dns         | 74       |

IoT boxes come in seven kinds over eleven hostname prefixes: printer, camera (`cam`,
`doorbell`, `babycam`), recorder (`nvr`), climate (`sensor`, `thermostat`), media (`tv`,
`speaker`), plug and lock.

**Services.** 2,388 machines run at least one service, 4,333 services in all:

| Service | Machines | Programs               |
| ------- | -------- | ---------------------- |
| http    | 1,369    | nginx 758, apache2 611 |
| ftp     | 1,162    | vsftpd                 |
| ssh     | 976      | sshd                   |
| redis   | 398      | redis-server           |
| mysql   | 361      | mysqld                 |
| dns     | 67       | named                  |

SNMP is not counted here: it runs on gateway firmware, not on machines.

## Commands

**73 builtins** (`commands/registry.ts`):

| Group        | Commands                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WiFi         | `airmon-ng`, `airodump-ng`, `aircrack-ng`, `nmcli`                                                                                                                                                                         |
| Recon        | `nmap`, `ping`, `ifconfig`, `dig`, `nslookup`, `whois`, `gobuster`                                                                                                                                                         |
| Web and mail | `curl`, `lynx`, `mail`                                                                                                                                                                                                     |
| Getting in   | `ssh`, `scp`, `ftp`, `mysql`, `redis-cli`, `snmpwalk`, `snmpset`, `nc`, `hydra`, `john`, `msfconsole`, `su`, `passwd`                                                                                                      |
| On a box     | `ls`, `cd`, `pwd`, `cat`, `echo`, `head`, `tail`, `grep`, `find`, `wc`, `strings`, `touch`, `mkdir`, `cp`, `mv`, `rm`, `chmod`, `nano`, `node`, `gpg`, `ldd`, `ps`, `kill`, `systemctl`, `reboot`, `apt`, `whoami`, `exit` |
| Daemons      | `sshd`, `nginx`, `apache2`, `vsftpd`, `mysqld`, `redis-server`, `named`, `snmpd`                                                                                                                                           |
| Game         | `help`, `man`, `clear`, `theme`, `effects`, `identity`, `wallet`, `author`, `xterm`, `new-game`                                                                                                                            |

## Doors

The ways into a box, and up once on one:

1. **WiFi.** Crack the key with `aircrack-ng`, join with `nmcli`.
2. **Credentials.** Six services take a login and log a sweep: ssh, ftp, mysql, redis, snmp
   and http basic auth. `hydra` sweeps them with the player's wordlist, `john` cracks hashes,
   `su` climbs to root.
3. **Service CVEs.** `msfconsole <host> <port>` against 8 packages: OpenSSH, nginx, Apache,
   vsftpd, MySQL, Redis, BIND and net-snmp. Severity sets the tier: critical root, high user,
   medium and low guest.
4. **Router firmware CVEs.** 6 vendors: Cisco IOS, MikroTik RouterOS, DD-WRT, OpenWRT, pfSense
   and EdgeOS. Patching the services does not close this door.
5. **Library CVEs.** `msfconsole --local <command>` escalates through 8 libraries: libpam,
   libcrypt, libsystemd, libreadline, OpenSSL, zlib, libxml2 and PCRE2.
6. **Backdoors.** About one NPC machine in ten (`BACKDOOR_PLACEMENT`, 0.1) carries a listener on
   one of 8 ports (`BACKDOOR_PORTS`: 4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234); `nc`
   opens a limited user-tier shell.
7. **Pivots.** Gateway forwards (`ssh user@<gateway>:<port>`), walking down a deep chain, and
   rewriting a gateway's `rules.v4` / `acl.conf` or reconfiguring it over SNMP.

That makes 22 packages with a CVE timeline (`packages/packageVersions.ts`), all derived from
package, version and game day on one world clock, never stored.

## Refreshing the census

Run `npx tsx scripts/worldCensus.ts`. It walks `DECLARED_NETWORKS` (`generation/world.ts`)
offline in a few seconds and prints every number above except the per-town landmark counts
(filter `DECLARED_NETWORKS` by `town` and `isLandmark`):

- **Networks:** each entry's `town`, `category`, `profile`, `subtype`, `site`, `unlisted` and
  `parent`; `isLandmark(key)` for the landmarks; `seededForwards(key)` for the forwards.
- **Machines:** `generateHomeLan(key).hosts` for the LAN (by `kind`), then `chainLinks(key)`.
  Each link fronts one layer whose machine is `generateDeepLayer(key, link).host`, and each
  link with a `parentMachineId` is a deep gateway. `FIXED_BOXES` adds the fixed boxes.
- **Roles and services:** `roleOfHostname(host.hostname)` and `hostServices(key, host)` on
  every machine, LAN and deep.
- **Commands:** `commandRegistry.size`.

`checkBudgets` (`npm run build`'s `postbuild`) also prints each set's box count, which
cross-checks the machine total.
