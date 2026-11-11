# Reaching a state

## Fresh player → connected, with nmap

The single most common starting state. Every step below has a trap.

```
NEW GAME → fill Workstation / Username / Root password ×2 → START
```

**The form's four fields are `<input>`s too, and a `fill` right after clicking NEW GAME
silently no-ops.** Two traps in one: the refs from the start-screen snapshot are stale on the
form, and polling `document.querySelector('input') !== null` to decide "the terminal is ready"
returns true while you are still LOOKING AT the form. Snapshot after the click, fill, then
**read the values back** before pressing START — an empty form answers with `Enter a name for
your workstation` and nothing else moves. Wait for the shell by polling the text for the prompt
(`$`), not for an input:

```bash
agent-browser --session <name> eval "(()=>[...document.querySelectorAll('input')].map(e=>e.value).join('|'))()"
```

**A fresh player stands in the town their key draws**, any of the eleven, in proportion to the
town's size (Ridgemont about 30%, Kingsford 28%, a village about 3%). Their scan shows only that
town's networks, and `nmcli connect` to any other town's answers `403 network_not_joinable`.
Nothing on screen names the town, so read it offline from the key:

```bash
agent-browser --session <name> eval "JSON.parse(localStorage.getItem('jshack.identity')).publicKeyHex"
npx tsx -e "import('./src/core/generation/startingTown.ts').then(({ startingTown }) => console.log(startingTown('<key>')))"
```

To see the town in game, `whois` the joined network's public address: `city:` and `region:`, or
`<Town> Broadband` for a home. Two traps: `whois` is not preinstalled (`su root`, `apt install
whois`, `exit`), and `ifconfig` shows only the LAN address, never the public one. Read the public
address offline: find the network's key in `wifiPoolOf(startingTown(key))` by its `essidOf`, then
`publicAddress(networkKey)` (`core/generation/world.ts`). Verified 2026-10-23 (v0.428.0) on
EASTFIELD-CAFE, Hollowmere: `whois 87.172.170.223`.

**Predict the scan instead of re-scanning blind.** A scan is a pure function of the key and
the scan index, and the first `airodump-ng` is index 1, each later one the next. So
`generateWifi({ seedPubkeyHex: key, town, scanIndex })` for 1, 2, … (`core/generation/generateWifi.ts`)
lists offline which scan offers the network a run needs; filter `crackable` and name each by
`essidOf`. The occupied network the scan may add is drawn after its picks, so it never moves
them. Verified 2026-10-23 (v0.429.0): a Wexcombe player's scans 1 and 2 matched it row for row,
LUKES-DINER on the second.

**Travel to another town** (verified 2026-10-23, v0.432.0, Wexcombe to Ridgemont). From a
connected player:

1. `su root`, then `apt install lynx`, `apt install whois` and `apt install wallet`, one package
   each, then `exit`. **`wallet` is not preinstalled either**: `wallet init` answers
   `bash: wallet: command not found`.
2. `wallet init` as the player, then mint to the address it prints, locally:
   `npx dotenv -e .env.development.local -- npx tsx scripts/mintCoins.ts <address> 100`.
3. `lynx rideit.io/ticket` quotes the trip address (offline: `tripAddress(key, trips)`,
   `core/rideit/fare.ts`). `q`, then `wallet send <address> 25`.
4. `lynx rideit.io/ticket` again: it reads `25 of 25 JSC`, and the cursor rests on the first
   town's `[ Board ]` (Ridgemont). `ArrowDown` to another, `Enter` boards. The arrival page shows
   LINK OFFLINE and `WLAN0 DOWN`.

**A reload resets the scan index**, so the first `airodump-ng` after one is scan 1 again: predict
it with the new town. The town a player stands in is their `player_locations` row
(`docker exec supabase_db_jshack-me psql -U postgres -tAc "select town, trips from player_locations where owner_key = '<key>'"`).
The old town's network is refused by the client before the server asks (`nmcli: network "X" not
found`), since it is out of range; the server's `403` is `scripts/testTravel.ts`'s to prove.

A recipe below that names a Ridgemont network (a landmark such as `SHINRA-5G`, or a key
`r0/t0/n…`) needs a player who starts in Ridgemont: `localStorage.clear()`, reload, NEW GAME, and
read the town again until it says Ridgemont (about one try in three).

Then, in the terminal:

| # | Command | Trap |
|---|---|---|
| 1 | `airmon-ng start wlan0` | `airodump-ng` fails without this (`airodump-ng: monitor mode not enabled — run airmon-ng start wlan0 first`). **And it refuses while you are CONNECTED** (`airmon-ng: wlan0 is already connected to a network`) — the exact mirror of step 4, so to re-scan later you must `nmcli disconnect` FIRST. Check its output: piping this step to `/dev/null` and looping `airodump-ng` gives eight identical `monitor mode not enabled` errors that read like eight unlucky scans |
| 2 | `airodump-ng` | **The whole aircrack-ng suite carries the `-ng` suffix** — the real binary names. `airmon`, `airodump`, `aircrack` bare all die `bash: <name>: command not found`, which reads exactly like an uninstalled tool (they are preinstalled). It is `airodump-ng`, never `airodump` or `airdump` |
| 3 | `aircrack-ng <BSSID>` | Use a **WPA2** row from the crackable pool: the player's own town's networks (in Ridgemont landmarks like `SHINRA-5G`, `ACME-CORP`, `WEYLAND-NET`; elsewhere `TOWN-HALL-WIFI`, a café, a home), each shown by its name. WPA3 rows and the noise pool are not crackable. Prints `KEY FOUND! [ <pw> ]` |
| 4 | `airmon-ng stop wlan0` | `nmcli` refuses while monitor mode is ON (`nmcli: wlan0 is in monitor mode — run 'airmon-ng stop wlan0' first`) — the mirror of step 1 |
| 5 | `nmcli connect <ESSID> <password>` | Prints `assigned 192.168.<subnet>.<host>` — note the subnet, the gateway is `.1` |
| 6 | `su root` then the root password | `apt` needs root (dpkg lock error otherwise) |
| 7 | `apt install nmap` | `nmap` is NOT preinstalled |
| 8 | `nmap 192.168.<subnet>.1` | Now works |

Typing into the terminal:
```bash
agent-browser keyboard type "airmon-ng start wlan0"; agent-browser press Enter
```

Allow generous sleeps — `aircrack-ng` runs ~14 s of simulated key testing, `nmcli` and `nmap` pace
their output deliberately.

### Then: the data doors (`redis-cli`, `mysql`)

Every one of these refuses in a way that reads like a broken feature. **Each door's usage string
is the authority** — when a call is rejected, print it (`redis-cli` with no argument) or read the
`USAGE` constant in `src/core/commands/<name>.ts` rather than trying flag spellings.

| Trap | What actually works |
|---|---|
| `nmap 192.168.x.0/24` → `nmap: usage: ...` | CIDR is not a target. One host, or a range: `nmap 192.168.x.1-254` |
| `redis-cli -h <ip>` → `unrecognized option: -h` | There are no `-h`/`-a` flags: `redis-cli [-p port] <host> [password]`, the password positional |
| `mysql: command not found` | `apt install mysql` and `apt install redis` — the clients are not preinstalled, and neither is `nmap` |
| `apt install snmpd` → `E: Unable to locate package snmpd` | The package is `snmp`. It prints its read-write community once, always a word from the stock wordlist, but does NOT start the agent: `systemctl start snmpd` first, or every walk of it times out (verified 2026-10-19) |
| `mysql -u root -p` | `mysql [-p port] <host> [user]`, then it prompts `Enter password:` on its own line |
| `SELECT * FROM t WHERE id = 6;` → `ERROR 1064 (42000)` | **Quote every WHERE value and drop the semicolon**: `SELECT * FROM t WHERE id = '6'`. `CONDITION` is `/^(\w+)\s*=\s*'([^']*)'\s*$/` |
| `SELECT ... LIMIT 3` → `ERROR 1064` | There is no `LIMIT`, `ORDER BY`, `JOIN` or operator but `=`; conditions join with `AND` only |

Inside either door the prompt is `redis> ` / `mysql> `, so **a prompt poller that only matches
`#`/`$` times out on every statement you send** ([driving-the-terminal.md](driving-the-terminal.md) covers this — match `>` too). Leave with
`exit`.

Redis speaks `AUTH`, `KEYS <glob>` (only `*` is a wildcard), `GET`, `DBSIZE`, `SET`, `DEL`. Every
value is a string; structured ones are JSON. There is no `TTL`, `TYPE` or `SCAN`.

**Getting in without cracking.** Both doors' secrets are seeded, so derive them per [offline-secrets.md](offline-secrets.md) rather than
running `hydra` for minutes. The game holds only hashes (the uncrackable pool ships as md5s);
recover the plaintext with the test-only helper, which reads the raw lists from the gitignored
`__plaintext.ts`:

```ts
import { drawDatabaseCredentials } from './src/core/generation/generateDatabase.js';
import { drawStoreLock } from './src/core/generation/generateRedisStore.js';
import { plaintextFor } from './src/test/passwords.js';

const wanted = drawDatabaseCredentials(`mysql-db-${ESSID}-${IP}`); // and drawStoreLock(`redis-store-${ESSID}-${IP}`)
for (const credential of wanted) console.log(credential.username, plaintextFor(credential.passwordHash));
```

A store whose `requirepassHash` is `null` is open and takes no `AUTH` at all. To pick a target
before touching the browser, walk `generateHomeLan(essid).hosts`, keep the ones whose
`hostServices(essid, host)` include redis (match `spec.service`, NOT `spec.name` — that is
`undefined` and silently matches nothing), and read `storeIn(fs)` / `databaseIn(fs)`. **The
element is `{ spec, port }`, so it is `entry.spec.service` — `entry.service` is `undefined` too**,
and every wrong read here fails the same silent way: an empty list, no error, which reads as a
world where nothing runs. 2026-09-23 it produced "**0** boxes in the world have both a mailbox and
an ssh door" and nearly got a shipped feature reported as unreachable in play; the true number was
22 of 51. Print the mapped values once before filtering on them. Only a box
carrying both lets you check a cached row against its `SELECT`. **Which networks a player can see
is drawn from their own identity** (2–3 per scan), so choose the target AFTER the first
`airodump-ng`, or re-scan to re-roll.

### Then: the ftp door (`ftp`, `get`, `put`)

| Trap | What actually works |
|---|---|
| `ftp: command not found` | `su root`, `apt install ftp`, `exit` — the client is not preinstalled, like `nmap` and `mysql` |
| `ftp <host>` then a user prompt | `ftp <host> <user>`, the user positional; it then asks `Password:` on its own line |
| Looking for a `local_root` or a chroot | There is none: every login lands in its own home and can `cd` anywhere its tier allows, so `cd /srv` works for `guest` |
| `local: <path>: File too large` on `get` | The copy would sign past `MAX_SIGNED_PAYLOAD` (65,536) characters of JSON, so the client refused it before sending. A generated file that big is a content bug (`carryHome.test.ts` should have caught it); a live log grown by play can genuinely pass it. Check the file's `JSON.stringify(content).length` |
| `local: <path>: I/O error` on `get` | The save's round-trip failed, or the server answered with a status the client does not map — check that `vercel dev` and supabase are up, then the `vercel dev` log |
| Reading another box's mailbox | `ftp <host> <user>` as that box's own user, then `get /var/mail/<user> inbox` — a mailbox is user-tier, so `guest` is refused |
| `cat <path>` at `ftp> ` → `?Invalid command: cat` | There is no remote `cat`: `get <remote> <local>`, `quit`, then `cat`/`strings` the local copy |
| A door on a non-default port | `ftp -p 2121 <host> <user>` — the port is a flag BEFORE the host, as nmap reported it |
| `lynx: command not found` | `apt install lynx` as root, like `nmap`. It takes a URL or a bare address — `lynx printer-111`, `lynx ridgemont.edu` (no scheme means `http://`, since v0.268.0; `ftp://`/`https://` are still rejected). It is interactive: `ArrowDown` moves between the numbered links AND form fields and buttons, in page order, `Enter` follows a link or sends a GET form, `q` quits. **Inside a text field every key types, `q` and `Backspace` included** (`Escape` leaves the field; only then do `q` quit and `←` go back) — a page that opens on a field, like findit's, opens typing |

**A device's own files** (every IoT box is one — see the tests under `generation/device/`): each
keeps its daemon's config world-readable under `/etc/<daemon>/` and its data under
`/var/lib/<daemon>/` at its account's tier. A camera keeps `/var/lib/motion/events.log` and
`snapshots/`; a recorder keeps `/var/lib/nvr/<camera>.<zone>.lan/<date>/<snapshot>.jpg`, byte for
byte the camera's own, and an `index.log`; a printer keeps its spool, `/var/log/cups/page_log.1`
and `/etc/cups` for root only. A sensor or thermostat keeps `/var/lib/sensord/readings.csv` (and a
thermostat `schedule.conf`); a TV or speaker `/var/lib/mediad/{paired.conf,recent.log,apps.list}`,
its pairings the network's real phones; a plug `/var/lib/plugd/{schedule.conf,energy.csv}`; a lock
`/var/lib/lockd/slots.conf` and, root only, `/var/log/lockd/access.log.1`, naming who came in and
the phone (hostname and IP) they came in by. Where one runs http it publishes its own pages (a
printer's Jobs page shows `Withheld`; a lock's name nobody). No LAN
printer in the catalog runs ftp or ssh, so its root-only spool is unreachable in play on the LAN;
a recorder beside real cameras is `nvr-12` on LIB-2ND-FLOOR (ftp on 2121) with `doorbell-125`
serving its Events page.

The prompt inside is `ftp> `, so a prompt poller must match `>` as well as `#`/`$` ([driving-the-terminal.md](driving-the-terminal.md)). `get`
prints `<n> bytes received`, where `n` is the file's length in characters, the same number the
transfer log records. A file server's share is at `/srv/share` or `/srv/backup/<date>`; find one
offline by walking `generateHomeLan(essid).hosts` for a `share-`/`files-`/`nas-`/`backup-`/`vault-`
hostname whose `hostServices` include `ftp`, and recover its guest password by matching
`/etc/passwd`'s md5 with `plaintextFor` (`src/test/passwords.ts`), as for the data doors.

A LAN file server running vsftpd keeps `/var/log/vsftpd.log.1`, readable by guest: `get` it, then
`grep <file name>` to find the upload that put a share file there — the client IP is the author's
machine (`nmap` it), the byte count is what `get` printed for the file, and on a working share the
time is the PDF's `ModDate` to the second.

### Then: a box on a deep layer

Verified 2026-10-10 (v0.349.0) on ABSTERGO-NET. No forward is needed: a gateway stands on the
layer it fronts, so it is two logins.

```
ssh root@<inner gateway's LAN ip>   →  password = plaintextFor(seedInnerGatewayAdminHash(<key>, <octet>))
ssh root@<deep box's 10.x ip>       →  password from its /etc/passwd md5 ([offline-secrets.md](offline-secrets.md))
```

Find the box offline: walk `chainLinks(key)`, call `generateDeepLayer(key, { machineId, kind },
{ hangsChild })` for each link, and read `readOpenPorts(buildDeepHostFs(key, layer.host))`. Every
deep box runs sshd; 18 in the whole world run a store.

| Trap | What actually works |
|---|---|
| Rescanning for one named network | A scan shows two or three of the player's town's networks: 178 in Ridgemont, 15 in Fenwick. Build the list of every network that would do, and take the first that shows (five scans for one of eleven in Ridgemont) |
| `wifiPoolOf(town)` holds keys like `r0/t0/n120` | A drawn network's key is not its name. `essidOf(key)` is what `airodump-ng` shows and `nmcli` takes; the generators take the key |
| `ps` on the box shows no `redis-server` although the generator says it runs | `scripts/testRedisDeep.ts` stops the daemon on the first deep store it finds and leaves that row in the local database. Check `select path, content is null from patches where machine_id like '<hostname>%'` before reading it as a defect |
| `mysql localhost <the box's own user>` → `Access denied` | A database's accounts are not the box's. Draw them with `drawDatabaseCredentials('mysql-db-<key>-<ip>')` (above) |

### Then: a local hole on your own box

A new workstation's LIBRARIES are born at their first release, every one with a published hole
(`apt list -u` names them), so `msfconsole --local` needs no rollback: `su root`,
`apt install metasploit`, `exit`, fire. What a hole does is drawn per command and release, so
compute it rather than guess — `localExploitOutcome(command, new Map([[library, version]]),
gameDayAt(now))` from `core/cve/localExploit.ts`. On 2026-10-10: `msfconsole --local rm
<source>:<target>` writes a file as root (libpcre 10.43.0), and `msfconsole --local node
<script>` runs a script as root (libreadline 8.2.10, after `apt install node`).

To tell a kept mode from a reset one, give the target a mode that is nobody's default first:
`chmod o+r <file>` shows as `-rwxrw-r--` in `ls -l`, against the user default `-rwxrw----`.

### Then: two tiers on one generated machine, and a local hole there

Verified 2026-10-13 (v0.375.0) on CITY-PARK-WIFI, `vault-43`. A generated machine is served
like a player's box, so two players at two tiers on it show what the read filter prunes.

```
A: ssh <user>@<host>          →  echo secret > /tmp/note.txt     (-rwxrw----, user tier)
B: ssh guest@<host>           →  ls /tmp shows nothing; cat answers No such file or directory
B: su <user>                  →  the file opens; a `su` row appears in `sessions`
B: scp /usr/bin/msfconsole guest@<host>:/tmp/msfconsole    (from B's own box, after apt install metasploit)
B: /tmp/msfconsole --local kill   →  [+] Full shell as root@<host>, an `exploit` row
B: reboot                     →  A's next line: Connection to <host> closed by remote host.
```

Pick the machine offline: every account's password is `plaintextFor` of its `/etc/passwd` md5
([offline-secrets.md](offline-secrets.md)), and `localExploitOutcome(command, parseDpkgVersions(
readDpkgStatus(fs)), gameDayAt(now))` says what each command's hole grants there today. On
2026-10-13 each of the twelve machines checked, on six networks, fell to `kill`, `su`,
`systemctl` and `reboot` at root.

| Trap | What actually works |
|---|---|
| `nmcli connect <ESSID> <password>` after computing the password offline | It works with no `aircrack-ng` run. The network only has to be in the latest scan |
| `which msfconsole` → `bash: which: command not found` | `ls -l /usr/bin/msfconsole`. A generated machine holds no `msfconsole`, so it is carried in by `scp` and run by its path |
| `nmap <deep ip>` from a shell on a switch → `command not found` | A gateway holds no `nmap`. To see `acl.conf` bite, `ssh guest@<deep ip>` before and after `echo deny 22 >> /etc/switch/acl.conf`: the second answers `Connection refused` |
| Looking for a shell below `root` on a switch | Gateways and switches carry only `root`, and on 2026-10-13 every hole live on CITY-PARK-WIFI's switch and two routers granted a limited effect. Check `exploitOutcome`/`firmwareExploitOutcome` for the day before planning on one |
| `chmod u-x <file>` at `guest` | Refused since v0.375.0: `cannot resolve 'u' ... /etc/passwd: No such file or directory` on a served box, `Permission denied` on the player's own. `o`, `g` and `a` go through |
| A file two players appended to has two rows in `patches` | One row per writer (`writer_key`); the tree is the journal replayed, so `cat` shows one file |

### Then: an NPC phone or tablet

An `android-`, `iphone-` or `tablet-` keeps a device's storage in its person's home instead of
dotfiles. Only about one in three catalog LANs has one that runs sshd, so pick it offline and
AFTER a scan ([reaching-a-state.md](reaching-a-state.md)): walk `generateHomeLan(essid).hosts` for those prefixes, keep the ones whose
`hostServices` include `ssh` (`entry.spec.service`), and recover the account's password as
`plaintextFor` of its `/etc/passwd` md5 ([offline-secrets.md](offline-secrets.md)). `deviceModel(essid, host)`
(`generation/phoneHome.ts`) names the make and model its photos will carry. Played 2026-09-25 on
ESPRESSO-EXPRESS: `ssh agarcia@192.168.232.180`, password `letmein` (a Galaxy Tab A8).

| Trap | What actually works |
|---|---|
| `ls -a ~` → `cannot access '~'` | `ls` does not expand `~`; you land in the home, so `ls -a` there |
| Looking for `Download/` on an iPhone | The layout follows the MAKER: Android devices (and non-Apple tablets) keep `DCIM/Camera/IMG_YYYYMMDD_HHMMSS.jpg`, `Download/`, `Documents/`, `Movies/`, `Music/`, `Pictures/`; an iPhone or iPad keeps `DCIM/100APPLE/IMG_NNNN.JPG`, `Downloads/`, `Documents/` |
| `cat` on a photo or PDF shows noise | `strings` it: a photo gives `JFIF`, `Exif`, make, model, the moment it was taken (no artist line); a PDF's Info line gives its title and author |

A phone's photos carry the model that file servers' photos, media boxes' pairings and locks'
logs already credit to it. On a home LAN a download may be the place's own paperwork (a café's
`menu.pdf`, an office's `expenses-policy.pdf`): its `/Author` is a real inhabitant, whose machine
`peopleOn(essid)` names and `ping` reaches — on ESPRESSO-EXPRESS, `menu.pdf` is Nina Williams at
`workstation-140`. Every other PDF is credited to an invented issuer.

---

## Shell on the AP gateway

The gateway is the `.1` of the connected LAN. Its credentials seed from the **ESSID**, so derive
them offline ([offline-secrets.md](offline-secrets.md)) rather than cracking in-game:

```
ssh root@192.168.<subnet>.1     →  password = plaintextFor(seedApGatewayAdminHash(<ESSID>))
```

The prompt becomes `root@ap-gw:/root#`. Verify the **server-served** tree actually arrived —
an empty foreign tree means the hop resolved but the fetch didn't:

- `cat /etc/iptables/rules.v4` → the seeded NAT table with its comment header
- `cat /etc/passwd` → root-only, exactly one line, no guest account

**What the gateway knows of its network** — every router hands out the addresses of the segment
it serves, and every switch keeps a table of the card on each port:

- `cat /var/lib/misc/dnsmasq.leases` (routers) → one row per generated machine on the segment:
  expiry, MAC, IP, hostname, `*`. On the AP that is every NPC `nmap` finds on the LAN, never a
  player; on an inner or deep router, the one machine on the layer it fronts.
- `cat /etc/dnsmasq.conf` → the `dhcp-range` and a `dhcp-host=<mac>,<ip>,<name>` reservation
  for each other gateway on the segment (the AP reserves the inner router and switch).
- `cat /var/lib/switch/mac-table` (switches) → one port row: the MAC the routers give that host,
  and a description naming it and its IP.

A MAC is one fact of the network (`hostMac(machineId)`), so the same host carries the same MAC
in every table that names it.

**What the gateway remembers** — who ran it, and what they left:

- `ls /root/backups` (root-only) → dated exports in the firmware vendor's own format (one on the
  AP, two to four elsewhere; the vendor is the `<vendor>-firmware` row in `/var/lib/dpkg/status`).
  Each states the live box: hostname, address, DHCP range and reservations, ACL denies, agent on
  or off. Secrets read as the vendor's mask (`<removed>`, `********`, `xxxxx`); MikroTik's omit
  them.
- `cat /root/.bash_history` → the admin at work, and a `ping` of their own machine. A LAN
  gateway's admin sits at a desk machine on the LAN (else a phone or tablet, else any machine); a
  gateway below the LAN is run from its parent's `.1`. `gatewayAdminIp(essid, machineId)` gives it
  offline.
- `/var/log/{syslog,auth.log,kern.log,snmpd.log}.1` → 2026-07-11: the morning's logrotate, a
  `DHCPACK` for every lease at the second it was granted, the admin's root logins from their
  machine, links dropping, and the admin's machine polling the agent.
- The vendor's admin pages (`/www`, `/usr/local/www` or `/usr/share/<vendor>/www`, never
  `/var/www`) and a web server config bound to `127.0.0.1`; nothing new answers on the network.

To go on to the admin's machine, pick a network offline whose AP admin runs sshd, and recover
their password as `plaintextFor` of its `/etc/passwd` md5 ([offline-secrets.md](offline-secrets.md)). On HOOLI-SEC the
AP's admin is `workstation-130` (`rjohnson`, ssh on 22); `nmap` it, `ssh` in, and their home is
there.

The gateway is nobody's own box, so it always routes through the cross-player path. Its
hostname in scans and log traces is `seedApGatewayHostname(<ESSID>)`; note the shell prompt
shows the machine-id name part (`ap-gw`) instead, which is a known cosmetic mismatch.

**The same mismatch happens on NPC routers and switches, so do not read it as a lost session.**
An inner gateway scanned as `switch-core` answers its shell prompt as `root@inner-gw`; the scan
shows the generated hostname while the prompt shows the machine-id name part, which is keyed by
DEVICE ROLE rather than by that hostname. Confirmed 2026-08-26 on `192.168.216.48`. Identify the
box you landed on by the IP you typed, never by the prompt.

### Then: the gateway's read-write SNMP community

Verified 2026-10-19 (v0.408.0) on APERTURE-WIFI. Skip `hydra`: in a root shell on the gateway,
`cat /var/lib/snmp/snmpd.conf` prints `rwcommunity <md5>`, and `plaintextFor('<md5>')` turns it
into the word ([offline-secrets.md](offline-secrets.md)). Then `snmpset localhost <rw>
inputPort.<port>=deny` from that shell sets the gateway's own filter, and `=permit` undoes it.
**`cat` output on the gateway is paced**: the prompt comes back before the lines arrive, so read
the screen a few seconds later, not straight after the prompt returns.

### Then: flash the gateway's firmware, forward and back

Verified 2026-10-18 (v0.403.0) on CYBERDYNE-5G, two players root on its gateway. A write that
moves the firmware row reboots the gateway: everyone on it is dropped, the writer at once and
anyone else on their next line.

| # | Command | Trap |
|---|---|---|
| 1 | `apt upgrade` on the gateway | **A generated gateway always starts on its vendor's OLDEST release** (all six ESSIDs checked: 24.0.1, 15.9.3, 2.7.2 — the first entry of `packageTimeline`), so there is nothing to roll back to yet. Flash forward first: this is already a reboot, and it drops you |
| 2 | `ssh root@<gateway>` again, then `apt install <vendor>-firmware=<old>` | The vendor is the `*-firmware` row in `/var/lib/dpkg/status`. `apt` only hands over releases backwards, so this fails until step 1 has moved the box |
| 3 | From your own box: `su root`, `apt install snmp`, `snmpwalk <gateway>` | `snmpwalk` is NOT preinstalled (`command not found. Install with: apt install snmp`). `sysDescr` names the live image, e.g. `DD-WRT v24.0.1 fw-dmz` |
| 4 | Back on the gateway: `tail -n 4 /var/log/dpkg.log` and `/var/log/kern.log` | `dpkg.log` gains a line for a ROLLBACK only (`downgrade <pkg> <from> <to> Client "<your LAN ip>"`); a forward flash writes none. `kern.log` gets one `[reboot]` line per flash. Both use the scan hostname (`fw-dmz`), not the prompt's `ap-gw` |

A player who only holds a shell sees nothing until they type: their next command answers
`Connection to ap-gw closed by remote host.` and leaves them at home. That is the drop, not a
lag — the closed line names the PROMPT's hostname.

---

## A contract network (mission)

Verified 2026-11-01 (v0.438.0), local full browser journey + a prod key-door check. A contract
is a 24-bit number; its 195 address answers as a reachable network (gateway + key box) only
while accepted, completed or abandoned. The one guaranteed route roots the key box, which holds
a root-only key file the server lays in from `MISSION_KEY_SECRET`.

**Pick the contract offline first** — a temp file in the repo ([offline-secrets.md](offline-secrets.md)), run with
`npx dotenv -e .env.development.local -- npx tsx ./m.tmp.ts` so `MISSION_KEY_SECRET` is in env
for the expected-key assertion:

```ts
import { isMissionNumber, missionAddressForNumber, missionEssid } from './src/core/missions/missionNetwork.js';
import { missionShape } from './src/core/missions/missionShape.js';
import { missionKey, missionKeyPath } from './src/core/missions/missionSecret.js';
import { generateHomeLan } from './src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from './src/core/generation/lanTopology.js';
// A number whose route is 'msfconsole' (no password step) or 'hydra'; walk up from any base.
const n = 100000; // missionShape(n).route === 'msfconsole', address 195.1.134.160, forward :80
const essid = missionEssid(n);                         // mission-100000 (CANNOT be joined — 403)
const keyBox = generateHomeLan(essid).hosts.find((h) => h.kind === 'machine')!;
machineIdForLanHost(keyBox, essid);                    // key box id, e.g. halden-files-...
missionShape(n).forwards;                              // msf: [{80,80}]; hydra: [{2222,22}]; a leak route has two
missionKeyPath(n);                                     // e.g. /etc/contract/access.key
missionKey(n, process.env.MISSION_KEY_SECRET!);        // the exact ACCESS- token `cat` must print
```

**Stage it** — the mission must be ACCEPTED for a handle that owns a mailbox; the FIRING player
is any player, not the handle. The operator refuses a handle with no `email_accounts` row, so
insert one first (`signed_up_by` has a CHECK — it must be a 64-hex key, e.g. `md5(a)+md5(b)`),
then:

```
npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts accept <handle> --number 100000
```

It prints `Accepted contract 100000 for <handle>: 195.1.134.160`. Now reach it as a fresh player:

| # | Command | Trap |
|---|---|---|
| 1 | join a wifi (airmon/airodump/nmcli, above) | **A fresh player is OFFLINE** (`WLAN0 DOWN`, `ESSID —`). A public 195 target does not resolve until the player stands on SOME network, so join a crackable town network first — the contract is reached FROM a vantage, not from the bare box |
| 2 | `su root` → `apt install nmap` → `apt install metasploit` → `exit` | Neither is preinstalled. `cat` the installs' prompt back before Enter as always |
| 3 | `nmap 195.1.134.160` | Lists `22/tcp ssh` (the gateway's OWN sshd) AND the forwarded route port (`80/tcp http` here). The forward is the way in; the gateway's `:22` is not |
| 4a | msfconsole route: `msfconsole 195.1.134.160 80` | `[+] Full shell as root@195.1.134.160`, and the prompt becomes `root@<key-box-name>` (the machine-id name part, e.g. `halden-files`, not the scan hostname — the same cosmetic mismatch the AP gateway shows). No password: the critical CVE on the forwarded service lands root |
| 4b | hydra route: `ssh root@195.1.134.163 -p 2222` | The forward is public `:2222` → the box's own `:22`. Derive the root password offline — `plaintextFor(missionShape(n).keyBoxRootHash)` ([offline-secrets.md](offline-secrets.md)) — rather than running `hydra` for minutes; the key box's own sshd answers behind the forward |
| 5 | `cat /etc/contract/access.key` | Prints the `ACCESS-XXXX-XXXX-XXXX` token. **`cat` on the served key box is PACED** — the prompt returns before the line arrives, so read the screen a few seconds later (exactly like `cat` on the AP gateway). An empty read or `mission_secret_missing` means the deployment's `MISSION_KEY_SECRET` is unset |

The msfconsole route is the cleaner browser recipe — it roots the box with no password step.

**The whole key-box reach, offline.** To prove the key door (e.g. that a deployment's secret is
bound) without the browser journey, skip the crack/exploit: seed a root `sessions` row on the key
box standing on the mission essid, then POST a signed `resolveCrossPlayerFs { machine_id }` (the
server lays the key in `findMissionKeyFile`). This is how `scripts/testMissions.ts` reads it, and
how the prod secret was checked on 2026-11-01 — a well-formed `ACCESS-` token back means the
secret is bound; it needs the supabase creds, not the secret itself.

### Then: the whole job through the board, to a payout

Verified 2026-11-03 (v0.441.0), the epic's close-out: alice applied, accepted, rooted and was paid;
bob, handed the address, rooted the same box and was refused. No operator staging: the board
posts the offers itself.

| # | Command | Trap |
|---|---|---|
| 1 | `su root` → `apt install mailutils` / `lynx` / `nmap` / `metasploit` / `wallet`, one each → `exit` → `wallet init` | None of them is preinstalled. Note the `jsc…` address `wallet init` prints: the proof mail needs it |
| 2 | `curl -d "handle=<h>&password=<pw>" http://emailit.io/signup`, then `mail login` | `mail login` asks `Address:` then `Password:` on two prompts; type each as its own command. The poller sees `:` as a prompt, so it works |
| 3 | `curl -d "email=<h>" http://hireme.io/apply`, then `mail`, `mail read 2` | The bare handle is enough. The board's address is only in that mail |
| 4 | Pick the offer offline BEFORE accepting | The board never shows an address. Read the numbers: `select number, ref from hireme_missions where handle = '<h>' and state = 'offered'` (local psql), then `missionShape(n).route` and `missionKeyPath(n)` per number. All three were msfconsole on the run, but a hydra one needs `plaintextFor(missionShape(n).keyBoxRootHash)` |
| 5 | `lynx http://<board>/`, the cursor opens on the FIRST `[ Accept ]`; `Enter` | Read `[aria-current="true"]`'s `textContent` before `Enter`. `ArrowDown` from there reaches the next offer's `[ Accept ]` directly. `curl -d "offer=<ref>" http://<board>/accept` is the same door without lynx |
| 6 | `q`, then `mail` and `mail read <n>` for `Contract: <target>` | The briefing comes from `<client>@emailit.io` and gives the 195 address |
| 7 | `msfconsole <address> <forward port>` → `cat <key path>` → `exit` | The forward's port is `missionShape(n).forwards[0].publicPort`, always `80` since v0.446.1 (an ftp draw could not be rooted). `cat` is paced (above) |
| 8 | `mail reply <briefing n>`, type `ACCESS-… jsc…` on the top line, `^O`, `^X` | The caret lands at the END of the quote: see [driving-the-terminal.md](driving-the-terminal.md), "Composing mail". Lines starting `>` are never read, so the key must be typed, not quoted |
| 9 | `mail`, `mail read <n>`, `wallet balance` | The reply is instant: "Key received. <pay> JSC sent to jsc…", and the balance is the pay |

A second player who mails the right key gets "We have no contract with you." (subject `No
contract`); the same key again from the contractor gets "That job is already closed." and no mint.
`curl -d "confirm=yes" http://<board>/drop` drops a job and the client mails one line. An offer
line shows only client, pay and pitch, so two different offers can read alike; tell them apart by
ref, never by the words.

**Clean up.** `hireme.ts drop <handle>` only ABANDONS the contract — the network stays reachable
for good by design. True removal is a service-role `delete()` of the `hireme_missions` row (plus
the mailbox and the key box / gateway `patches` rows a run leaves), the way the wire-check's
`cleanup()` does it.

### Then: a route that leaks a login

Verified 2026-11-04 (v0.445.0), one player working all four, paid each time. Find a number per
route with `missionShape(n).route`, and `missionLeakPath(n)` names the file. `missionLeakWord(n,
process.env.JSHACK_SECRETS)` gives the word, so **write words and keys to a scratch file and mask
them on every read of the screen**: they must not reach a transcript. Compare before you slice
the text, because a word cut in half by `slice(-n)` isn't masked. `hireme.ts accept` mails no
briefing and holds one job per handle, so finish or drop each job before the next.

| Route | Commands | Trap |
| --- | --- | --- |
| web | `gobuster http://<address>`, `curl http://<address>/<file>` | `gobuster <address>` answers `(3) URL rejected`: it needs the scheme. `gobuster` isn't preinstalled |
| ftp | `ftp <address> anonymous`, any password, `cd pub`, `get <file> <local>`, `quit`, `cat <local>` | You land in `/srv/ftp`, so `ls` shows only `pub`. There's no remote `cat` |
| mysql | `hydra <address> mysql`, `mysql <address> <account>`, its password, `SELECT * FROM settings`, `exit` | `hydra` isn't preinstalled either. Root's word is the `admin_pass` row |
| snmp | `snmpwalk <address> monitor`, or `netops`, or `hydra <address> snmp` then `snmpwalk <address> <found>` | A plain walk and the wrong name both answer `Timeout: No Response`, which is the route working. The package is `snmp` |

Then every route: `ssh root@<address> -p 2222`, the word at `password:`, `cat <key path>` (paced),
`exit`. To mail the key without a briefing: `mail send <client>@emailit.io <subject>`, click the
textarea, type `ACCESS-… jsc…`, `^O`, `^X`. The reply's subject is `Contract: <target>`, and a client's
handle is `missionTerms(n).client.handle`.

### Then: a contract with decoys

Verified 2026-11-09 (v0.449.0), contract 410091: the msfconsole route behind mysql, ftp and snmp
decoys, each worked to its empty end, then paid. Pick the number offline by
`missionShape(n).route` and `missionShape(n).decoys` (every gateway forwards 3 or 4 ports, so
hydra and msfconsole draw 2-3 decoys). Each decoy is worked exactly like the leak route of its
kind (table above) and ends empty: `pub` holds nothing, the walk shows `netops@corp.local` and
`hydra <address> snmp` finds no read-write community, and the database has no `settings` table.

| Trap | |
| --- | --- |
| `apt install mysql-client` | There is no such package; `mysql` works without an install |
| `SHOW DATABASES` | Answers a syntax error; `SHOW TABLES` lists the one database |
| The masked read | A helper that masks the key must hand node a Windows path (`cygpath -w`): with `MSYS_NO_PATHCONV=1` set, a `/c/...` path never opens and the key prints unmasked |

### Then: a two-hop contract, worked from the front box

Verified 2026-11-10 (v0.452.0), contract 6920654: hydra in front, the ftp route on the key box,
database storage, a web decoy inside. Accepted from the board, paid §2,700 once. One contract in
three is two-hop; the board names it `retrieve an internal access key`. Classify the offered
numbers offline before accepting: `missionShape(n).frontBox` (null on single-hop), its `route`,
`keyBox.route`, `storage` and `keyBox.decoys` (the inside decoys, 0–3).

| # | Command | Trap |
| --- | --- | --- |
| 1 | Read the board, classify its offers offline | Three offers can all be single-hop (the run saw 18 in a row, at a 0.33 share). Turn the board over by back-dating: `update hireme_missions set posted_at = now() - interval '25 hours' where handle = '<h>' and state = 'offered'`, then read it again. A key box can also run no inside decoy (2 real doors), so check `keyBox.decoys` if the run needs one |
| 2 | `nmap <address>` | Shows the gateway's `22` and the FRONT box's forwards only. The key box's doors never show from outside |
| 3 | The front route, as on a single-hop contract | It lands on `root@<stem>-web`. Derive a hydra root offline: `plaintextFor(missionShape(n).frontBox.rootHash)` |
| 4 | `ifconfig`, then `apt install nmap` (and `gobuster`, `ftp`, `hydra` as the key route needs) ON the front box | The front box has none of them. Install there, not at home: the hop runs its own tools |
| 5 | `nmap -sV 192.168.<x>.1-254` | **`nmap` takes a range, never a CIDR block**: `192.168.<x>.0/24` answers the usage line. The range lists three hosts: `<stem>-gw`, `<stem>-files` (the key box) and `<stem>-web`. `nmap -sV <key box>` is paced: read the screen a few seconds after the prompt |
| 6 | Work each inside decoy, then the key route, against the key box's LAN address on its own ports | hydra is the key box's `:22`; a leak word logs in with `ssh root@<key box>`, no `-p 2222` |
| 7 | `exit` twice, then mail the key from home | `exit` from the key box returns to the front box, and a second to your own box |

Work out the leak word and the key root offline with `missionLeakWord({ missionNumber: n, role:
'key' }, process.env.JSHACK_SECRETS)` and `plaintextFor(missionShape(n).keyBox.rootHash)`; the
front box's leak takes `role: 'front'`. Keep them in a scratch file and type them from it, so they
never pass through a command line you read back.

### Then: a tamper job, changed or erased, to a payout

Verified 2026-11-11 (v0.457.0), the tamper close-out: a club erase in a database broken on
purpose by an `UPDATE` with no `WHERE` and refused, a university change in a database paid
§1,350, a motor registry erase in files paid §1,550. Half the contracts are tamper jobs; the board
names one `alter a/an <setting> record` or `erase a/an <setting> record` (`internal` on two-hop).

**Classify each offer offline.** Read the offered numbers from `hireme_missions` and, per number:
`missionKind(n)`, `missionRecords(n)` (its `setting`, `target.action`, `target.table`,
`target.namedBy`, and on a change `column`, `from`, `to`), `recordsStorage(n)` (`database` or
`file`), `recordsFilePath(n)` on a file job, `missionShape(n).frontBox` and `keyBox.route`.
Take the words from the box itself: `plaintextFor(missionShape(n).keyBox.rootHash)` on the hydra
route, and the application account from `databaseIn(buildMissionKeyBoxFs(n))?.credentials`
(the `userType === 'user'` one, `plaintextFor` its `passwordHash`). Write them to a scratch file.

| # | Command | Trap |
| --- | --- | --- |
| 1 | Turn the board over until the job you need is offered | **A turnover burns every offer on the board**, a good one included: accept the moment a match shows. A combination such as a single-hop file erase on a hydra or msfconsole box is about 7% of a round, so script the back-date, the read and the classify in a loop that stops on a match |
| 2 | Accept, read the briefing | **One job at a time**: the board's three slots hold the offers and the current job together, so finish or drop (`curl -d "confirm=yes" http://<board>/drop`) before the next |
| 3a | Database: `hydra <address> mysql`, then `mysql <address> <account>` and its password at `Enter password:` | A single-hop database job forwards `:3306` whatever its route, so no root is needed. `SHOW TABLES` lists the target table, its two neighbours and `credentials`, beside whatever else the box keeps |
| 3b | Database: `UPDATE <table> SET <column> = '<to>' WHERE <col> = '<name>'` or `DELETE FROM <table> WHERE …`, `exit` | Match the briefing's names (`namedBy`). **An `UPDATE` with no `WHERE` is not worth undoing**: putting 20–40 rows back means one `UPDATE … WHERE` per row (a `DELETE` with no `WHERE` cannot be undone at all; there is no `INSERT`). So a deliberate failure costs the job: do it on a job you then drop |
| 4a | File: root over the route (`ssh root@<address> -p 2222` on hydra), then `ls /srv/<stem>/records` | No `:3306` in the scan. The directory holds the target CSV and its two neighbours |
| 4b | File: `nano <the target CSV>`, delete or edit the line, `^O`, then `close-nano.sh` | Delete a whole line from the textarea: find its start and end in `.value`, `setSelectionRange(start, end + 1)` (the `\n` included), press `Backspace`, then read `.value` back before saving |
| 5 | `exit`, then `mail reply <briefing n>` with the wallet address on the top line | The client's words don't matter, only the wallet. "The records look right. §<pay> sent to jsc…" pays at once; "Our records don't look right. No change, no money." leaves the job open |

Mail is limited to 20 sends an hour per player (`email_sends`); a scripted run that mails many
clients as one player gets a `429` from the twenty-first.
