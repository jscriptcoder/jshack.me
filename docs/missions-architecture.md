# missions architecture (as-built)

How a player takes paid work: a contract offered on their hireme.io board, accepted with a form,
briefed by mail, worked on a network of its own and paid by mailing the client the key — or, on
a tamper job, by changing or erasing one of the client's records and mailing them anything. This is
the shipped model of the missions epic, complete at **v0.441.0** (four slices, v0.438.0–v0.441.0,
PRs #746–#749, 2026-11-01 to 2026-11-03), with the routes that leak a login added by the epic
that followed (four slices, v0.442.0–v0.445.0, PRs #750–#753, 2026-11-03 to 2026-11-04), and a
second template, a key box behind a front box ("Two hops", four slices, v0.450.0–v0.452.0, PRs
#761–#764, 2026-11-09 to 2026-11-10), and a second kind of job, a record changed or erased
("Tamper jobs", four slices, v0.454.0–v0.457.0, PRs #766–#769, 2026-11-11). It sits
on top of the contractor boards
([`hireme-architecture.md`](./hireme-architecture.md)), emailit.io
([`email-architecture.md`](./email-architecture.md)) and the wallet
([`wallet-architecture.md`](./wallet-architecture.md)) without changing their machines,
addresses or lookups. Legacy's design and scenarios, the input to the grill, are in
[`mission-ideas/`](./mission-ideas/README.md). The grill record and slice plans were retired on
close-out. When this doc and the code disagree, the code wins — fix the doc.

## The one idea the design turns on

**A contract is a 24-bit number, and the number is its address.** `195.a.b.c` decodes to
`a·65536 + b·256 + c`, so the address is the seed: the same number always generates the same
network, no two contracts share an address, and every door finds the network from the address
alone. Nothing about the network is stored. The missions table records only who was given which
number and where the job stands.

From that follow the rest:

- **Only accepted contracts exist.** A 195 address nobody accepted answers exactly as an empty
  address does at every door, so a guess tells a prober nothing.
- **The network is persistent and shared.** Whoever holds the address reaches it: the
  contractor, someone they told, or someone who read it where it leaked. What one visitor changes
  stays for the next. Sharing an address is how a mission is shared; there is no other code.
- **A key job's proof is a key, not the network's state.** Completion compares the mailed key with
  the contract's key and never reads the boxes, so nothing a later visitor does there can break a
  completion.
- **A tamper job's proof is the network's state.** The job asks for a record changed or erased,
  so the client reads its own records box on every mail and pays when the records read right. What a
  later visitor does there can break the job until it is paid, and never after: a completed job is
  closed without reading the box. See [Tamper jobs](#tamper-jobs).
- **A key comes from a server-only secret**, because the generator ships in the bundle and the
  seed is public. A tamper job needs none: what it asks for is in its briefing, and the box only
  has to read right.

## 1. The block and the lookup

- **The 195 block** is `MISSION_FIRST_OCTET`, beside the boards' 194 (`generation/world.ts`).
  `isPublicIp` accepts it, so every cross-network command routes a `195.` target to the server.
  Only host octets 2–254 are numbers (`core/missions/missionNetwork.ts`: `isMissionNumber`,
  `missionAddressForNumber`, `missionNumberForAddress`).
- **One lookup for every door.** `networkByPublicIp` (`core/hireme/boards.ts`) finds a `195.`
  address's network, `mission-<number>`, when its row is `accepted`, `completed` or `abandoned`,
  and nothing otherwise; a failed read is the lookup's error, never a guess. The twelve door
  wirings in `api/network.ts` and `api/sessions.ts` reach it through their `networkByPublicIpVia`
  helpers, as they reach a board.
- **The ESSID is `mission-<number>`, and nobody joins it.** It is on no town's scan list, and the
  server's join refuses it with 403 `network_not_joinable` before anything else, even with
  `JSHACK_ADMIT_LAB_NETWORKS` on, so a crafted client cannot stand on a mission LAN as an
  occupant.
- **`whois` answers for the whole block** from the client, accepted or not, as a small
  business's line: `inetnum: 195.0.0.0 - 195.255.255.255`, `netname: SMALLBIZ-NET`,
  `org-name: Harrow Valley Business Broadband` (`commands/whois.ts`). findit, mapit and the web
  see nothing: a mission network is not a place.
- **Working from a mission box traces as its 195 address**: `derivedPublicIpByEssid` knows the
  mission ESSID, so a scan typed on the key box writes that address into the scanned box's
  `kern.log`.

## 2. The network

**The shape is in `core/` and ships in the bundle; the secrets and the prose do not.** A shell
standing on a remote box works out that box's network on the client, from its ESSID
(`generateHomeLan`, `resolveLanHostIdentity` and their callers: `nmap`, `ssh`, `scp`, `ftp`, `nc`,
`ping` and the data doors from a hop). So a mission is one branch in each of `generateHomeLan`,
`buildApGatewayBaseFs` and `baseFsForLanHost`, every hop command works unchanged, and the journal,
the write validation and every reader treat a mission box like any other. Anyone holding the
generator can compute any number's hostnames, services and versions offline; that is accepted,
since without the address it says nothing about which contracts exist.

`missionShape(number)` (`core/missions/missionShape.ts`) draws from the number alone, never the
clock:

- **Two boxes**: a **gateway** at `.1` and a **key box** at a drawn octet, named from a
  target-stem pool (`halden-gw`, `halden-files`; `core/missions/pools.ts`). One contract in three
  is two-hop and adds a front box (`halden-web`) the gateway forwards to instead ("Two hops",
  below); everything in this section holds for each box.
- **One guaranteed route**, a flat draw over the six in `ROUTES`:
  - **hydra**: a crackable `root` (a word from the crackable pool) on the key box's sshd,
    reached through a public `:2222` forwarded to its `:22`;
  - **msfconsole**: a service on the key box pinned to a release whose hole is `critical`,
    reached through a forward of its own port. The hole has to land a root shell, because the
    gateway forwards nothing else and a hole that only lists or reads files leaves the key out of
    reach. So the service is always the web server: no vsftpd hole grants a shell, and until
    v0.446.1 an ftp draw landed `dir_list` and the job could not be done;
  - **web, ftp, mysql, snmp**: the four that leak `root`'s password from a door on `:80`, `:21`,
    `:3306` or `:161`, with `:2222` to log in with it ("The routes that leak a login", below).
- **The gateway is passed through, not broken.** It has router firmware as every gateway does, an
  admin password from the uncrackable pool, and the route's forwards in `rules.v4`: one on hydra
  and msfconsole, two on a leak route.
- **The key box is built by a mission builder of its own**, not by `buildRemoteHostFs`'s role
  draws, so nothing the world scatters on an NPC (a database login, a backup, a backdoor) opens a
  way in nobody guaranteed. Its `root` is uncrackable on the msfconsole and leak routes; `guest`
  and the NPC user keep the world's odds, shells to look around in that cannot climb.
- **Nothing but the route climbs, by what each hole grants, never by when it publishes.**
  **Every** package on both boxes that is not the route (sshd, vsftpd, the firmware and the
  libraries included) is pinned to a release whose one hole is `low` or `medium`: a guest shell at
  most, which cannot read the root-only key, so `msfconsole --local` finds no climb
  (`safeBaseVersions`, `safeFirmwareVersions`). A release whose hole has not published is never
  used for this: the generator cannot know what it will grant. The gateway's admin and, on the
  msfconsole route, the key box's `root` are the doors that stay shut. A leak route's door sits on
  a safe release too, so `msfconsole` finds no root through it. Decoys (below) sit on safe
  releases as well.
- **`MISSION_ROUTE_DAY = 111`.** A route release is one whose `critical` hole published on or
  before that day. The clock only moves forward, so every route stays open for good, and
  `liveCve` keeps a published hole live on every box still on its release. A test walks every
  service package's timeline and fails if the template could draw a route package without such a
  release. Moving the cutoff changes the network of every existing number: free until launch,
  never after it without a plan for the contracts already accepted. Growing `ROUTES` is the same:
  it re-rolls every number's route, though never its address, key or key path, so a key already
  read still pays.

**Whoever roots a box can close its route** for later visitors (`apt upgrade`, `passwd`, `rm` of
the key), as anywhere in the world. The guardian's rounds and `guardian.ts restore` never touch a
mission box, which also keeps the old releases the routes rest on pinned. A wrecked network is
left as it is: a contractor who already read the key still completes; one who did not drops the
job.

## Decoys

Without them a scan told the route: `2222` alone was hydra, `80` alone msfconsole, a door beside
`2222` a leak. Since v0.449.0 **every gateway forwards 3 or 4 ports**, each about half the time,
and decoys fill the gap above the real forwards (the route's, then `:3306` on database storage).
A contract has 1–3 real forwards, so every route reaches both counts and the count says nothing:
`2222, 80, 21` could be hydra, msfconsole, a web leak or an ftp leak. With the gateway's own `22`
a scan shows 4–5 ports.

- **A decoy is a forward plus a real door, and opens no way in.** It is one of the five kinds some
  route is won through (`MissionDecoy`, `missionShape.ts`), since a port that is never a way in
  is dismissed at a glance: `ssh` (`:2222` onto the key box's own sshd, the forward alone, `root`
  as the route drew it), `web` (`:80`), `ftp` (`:21`), `mysql` (`:3306`), `snmp` (`:161`). Never a
  kind whose public port the contract already forwards, never one twice.
- **It lets a player in as far as the real door of its kind, onto nothing.** It is the real
  door's generated build minus what the server lays in, so the two cannot differ on the surface:
  the stock `It works!` page with no forgotten file; `anonymous_enable=YES` and an empty
  `/srv/ftp/pub`; the generated application behind a crackable account, with no `settings` and
  no `api_keys`; an agent whose `/etc/snmp/snmpd.conf` (generated with the box, since it holds no
  secret) answers a guessable read-only community (`GUESSABLE_COMMUNITIES`, `pools.ts`, shared with
  the snmp route) with the contact `netops@corp.local`. The server lays nothing for a decoy.
- **An snmp decoy's read-write community is from `SHUT_HASHES`.** The real snmp route's word comes
  through the read-only walk, so the decoy matches it along that path. A crackable one would hand
  anyone on about half of all contracts a root-free `snmpset inputPort.22=deny` that shuts
  `:2222` for good.
- **Every decoy daemon sits on a safe release**, so the 2,000-number shape test still proves
  nothing but the route climbs. Accepted: a `:2222` or `:21` decoy lets `hydra` win a guest or
  user shell where the route offered none, a shell that cannot read the root-only key.
- **Drawn last, on a stream of its own** (`mission-decoys-<n>`), so no contract's topology, route,
  hashes, key, key path, storage or pay moved; contracts accepted before v0.449.0 only gained
  doors. A key box an snmp decoy configures draws its community last on `mission-keybox-<n>`.
- **The forwards' order is not shuffled**: real first, decoys after. Only `rules.v4` shows it,
  and the gateway's admin is shut and it runs no agent.
- `show` tags each decoy forward and service `(decoy)`.
- **Pay is unchanged.** Decoys land on every contract alike, so no job is harder than another.
- **Rejected:** daemons on the key box with no forward (only a shell there sees them, and whoever
  has one already found the route; on a two-hop contract a shell on the front box is how the key
  box is scanned, so there they are exactly what "Two hops" adds); a flat 0–2 decoys (two ports would still mostly mean hydra or
  msfconsole); every gateway forwarding all five kinds (every scan alike, so players skip it);
  decoys whose doors stay shut (one failed `hydra` rules each out, saving the player barely
  anything over the old scan).
- **Seen in the close-out run (2026-11-09):** the mysql decoy's `credentials` table shows a root
  md5, the generated application's, neither the box's root nor in the default wordlist, so it is
  a dead end like the rest of the decoy.

**To add a decoy kind:** `DECOY_KINDS` and `DECOY_SERVICES` in `missionShape.ts`, and whatever
the key box must carry for its door in `missionKeyBoxFs.ts`. A new route whose door is a new kind
should add it here too, or the scan tells that route again; if its door is not ssh, add it to
`INSIDE_DECOY_KINDS` as well, or an inside scan tells it.

## Two hops

Since v0.450.0 one contract in three puts its key box behind a **front box**. The gateway
forwards only to the front box; the key box has no forward and is reached from inside, by a player
standing on the front box. Storage, the key and completion are as on a single-hop contract.

- **The template is drawn from the number** on `mission-template-<n>` (under one third is
  two-hop), so a contract's shape stays a function of its number and computable offline. A stream
  of its own meant no single-hop contract's route, hashes, key or storage moved; an accepted
  contract that landed in the share turned two-hop, which cost nothing while prod had only test
  players. Rejected: choosing the template at posting and storing it (every door would need a
  table read, and the client could no longer work out the shape).
- **Three hosts, no filler:** the gateway at `.1`, the key box at its octet as before, and the
  front box (`<stem>-web`) at an octet of its own drawn on `mission-front-<n>`. An inside scan
  shows one host besides the gateway and the front box: finding the key box is not the job,
  working its route from a hop is. Filler boxes to rule out belong with "believable filler" in
  `backlog.md`.
- **The front box falls to its own route**, a draw from the same six continuing on
  `mission-front-<n>` with its own safe versions and hashes. The two draws are independent, so a
  contract can draw the same route twice and the two boxes' words can coincide. The front box
  holds no key, no storage and no lead, and is built by the same mission builder
  (`buildMissionFrontBoxFs`, `missionKeyBoxFs.ts`) on streams of its own: `mission-frontbox-<n>`
  (its NPC user and guest), `mission-front-database-<n>` (its application) and
  `mission-front-leak-<n>` (its forgotten file and agent community).
- **Outside, the front box takes the key box's place** in the forward and decoy rules: its route's
  forwards, then decoys filling to 3 or 4, so a two-hop contract's public scan reads like a
  single-hop one. On database storage `3306` is the key box's and is reached inside, so it is no
  forward.
- **Inside, a route's door is the key box's own port**: hydra is its `:22`, and a leak word logs in
  with `ssh root@<key box>` on `22`, not `-p 2222`. Every route roots the box it lands on, so the
  front box always ends rooted, and `apt install` works there.
- **The key box blurs an inside scan** (v0.451.0): it runs **2 or 3 service doors besides `22`**,
  about half each, the real ones first (the route's door, and `3306` on database storage), then
  inside decoys from `web`, `ftp`, `mysql` and `snmp` (`INSIDE_DECOY_KINDS`), never a kind twice
  or a port it already runs, drawn on `mission-inside-decoys-<n>`. Each is built by the same helper
  as the gateway's decoys (`withDecoyDaemons`), so it is the real door's build with nothing laid
  in, on a safe release. sshd always runs, so ssh is never an inside decoy. Rejected: no inside
  decoys, which would have made the second hop a free read after a first that made the player
  work.
- **Any shell on the front box is a foothold.** Its `guest` and NPC user keep the world's odds, so
  a player can often `hydra` a guest shell through `:2222` without working the front route. From it
  the stock tools (`ifconfig`, `ping`, `curl`, `ssh`, `scp`) reach the key box; everything else
  needs `apt`, so root in practice. One rule, no carve-out: tier decides what a shell can do.
  Rejected: the key box answering only a root on the front box; shutting the front box's guest
  and user.
- **The LAN reads `missionTopology(n)`**, the stem and both octets, because the whole shape takes
  about 2 ms to draw and every hop command reads the LAN. `missionBoxAt(essid, machineId)`
  (`lanHostIdentity.ts`) answers `{ missionNumber, role: 'key' | 'front' }`, and every per-box
  function in `missionLeak.ts` takes that reference, so the server lays each box's files on that
  box alone (the front route's leak on the front box, the key's files and the key route's leak on
  the key box) and the write gate in `api/patches.ts` lists each box's paths for it. No inside
  door needed a change: each of the six routes reached the key box from the front box and laid its
  files there, measured before the first slice's RED.
- **The board names the job and pays more** (v0.452.0). A two-hop offer reads `<Client> —
  retrieve an internal access key — <pay>` and pays 2,000–4,000 JSC rounded to 50. Pay is still the
  last draw on `mission-terms-<n>`, only its range following the template, so no single-hop
  contract's terms moved; a two-hop job at exactly 2,000 ties the top single-hop pay, which the
  owner kept. The briefing adds one line, `The key is on a machine inside their network, not on
  the edge.`, and never says pivot, front box, how many machines, a route or the key box's
  address: working out what "inside" means is the job. Rejected: hiding the template (its pay
  range would tell anyway).
- **Closing a hop is as anywhere**: whoever roots the front box can `passwd` or `apt upgrade` it.
- **`show`** names every report's template; a two-hop report gives each box a section, front box
  first, with its route, services (decoys tagged, inside ones too) and leak, and the forwards say
  `-> front box`.
- **Rejected in the grill (2026-11-09):** the gpg passphrase on a third box behind the key box (it
  touches only gpg contracts, so it is a twist, not a template); both at once (three boxes deep
  before the first hop was known to be fun); a lead to the key box's root on the front box (a
  deploy script, `.bash_history`, a cron line), a new route kind that can join later as a seventh
  inside route. There is no key-based ssh login in the game, so "an ssh key on the front box" was
  never an option.

## 3. The key and the secret

- **The key** is `ACCESS-XXXX-XXXX-XXXX`, twelve symbols of Crockford's alphabet
  (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) formatted from an HMAC-SHA256 of the number under
  `MISSION_KEY_SECRET` (`missionKey`, `core/missions/missionSecret.ts`). It lives in no table.
- **The key file** sits at a path drawn from a pool of believable places (`/etc/contract/access.key`,
  `/root/.config/vault/key`, `/var/backups/vault.key`, …; `missionKeyPath`), mode 600, owned by
  root. The server lays it into the key box **before the journal is replayed** (`withMissionFiles`,
  `core/network/missionBoxFiles.ts`), at each door that builds the box from its id: the read
  (`resolveCrossPlayerFs`, through `findMissionFiles`, at every tier, the read filter keeping it off
  the wire below root), the web, database and SNMP doors, and the write gate
  (`remoteWritePermission`, through `missionFilePathsOf`). So a root's `rm` of the key sticks for
  the next reader.
- **The secret is one per deployment, never rotated, and fails closed.** It is set for Preview
  (`jshack-dev`), Production (`jshack-prod`) and `.env.development.local`, each value different,
  so a key read on dev never pays on prod. Rotating it changes every contract's key at once,
  including keys read and not yet mailed, so a rotation is an operator incident. A door that
  needs it and finds none answers 500 `mission_secret_missing`; there is never a default. Only
  the server and `scripts/hireme.ts show` read it, and nothing prints it: only `show`'s derived
  key.
- **The modules that know the secret or the prose are server-only by discipline**: imported
  from `api/` and `scripts/` alone (`missionSecret.ts`, `missionLeak.ts`, `missionTerms.ts`,
  `clientMail.ts`, `contractsList.ts`, `hireme/contractBoard.ts`, `hireme/contracts.ts`).

## Where the key is stored

A contract draws where its key box keeps the key, `file`, `gpg` or `database`, each one time in
three (`missionShape(n).storage`, v0.447.0). It is drawn on a stream of its own
(`mission-storage-<n>`), so adding it moved no contract's topology, route or hashes, and it is
independent of the route: any of the six ways in meets any of the three, rather than each storage
pinned to routes of its own, which would be more rules for fewer combinations. Pay, the offer and
the briefing never say which, and completion is unchanged: the mailed key is compared with the
contract's key.

- **`file`** is the plain key file of §3.
- **`gpg`**: the key is sealed. The server lays three files where the plain key would have been
  (`keyFiles`, `core/missions/missionLeak.ts`):
  - `<key path>.gpg`, root-only, the key encrypted with the codec `gpg -c` uses
    (`core/crypto/gpgCodec.ts`), so `gpg -d <file> <passphrase>` opens it. Nothing sits at the plain
    path.
  - `/usr/local/bin/<stem>-vault`, a program the box's admin sealed the key with: a binary stub
    (`binaryStub`) followed by a few readable runs, a usage line naming `--seal` and `--open`, two
    messages, a compiler banner, and the passphrase. The runs are separated by U+0001, never NUL,
    because a root's edit lands in a TEXT column. Any tier may read and run it, which costs nothing
    while the sealed key stays root-only. It is the only thing in `/usr/local/bin`, which exists only
    on a gpg box.
  - `/root/.bash_history`, root-only: `<stem>-vault --seal <key path>` then `rm <key path>`. It
    points at the program without saying the passphrase is in it. It is laid by the server and not
    generated with the box, because it names the key path, whose pool never ships.
- **Why `strings` is the way in:** `grep` skips any file that starts with the ELF magic, even under
  `-r`, so a sweep for the passphrase finds nothing; `strings` prints it on a line of its own.
- **The passphrase** is `hv-XXXX-XXXX` in the key's alphabet, an HMAC-SHA256 under
  `MISSION_KEY_SECRET` of `passphrase:<n>` (`missionPassphrase`), a message of its own, so it shares
  nothing with the key and one job's passphrase says nothing about the next. Stored nowhere. Not a
  word from a pool: players would collect those and skip `strings`.
- **The key box ships without `gpg`.** A root there runs `apt install gpg` before `gpg -d`, one
  more thing for the player to find (seen in the close-out run, 2026-11-09).
- **`database`** (v0.448.0): no key file is laid. The key is the `portal` row of an `api_keys`
  table in the key box's datadir (`/var/lib/mysql/data.json`), beside three keys to other services
  (`sk_live_…`, `SG.…`, `pk.…`, drawn from the number) none of which is in the key's shape. It is
  worked **from outside, as a database user**: on every route the key box runs `mysqld` on a safe
  release, the gateway forwards `:3306` onto it after the route's own forwards (on the mysql route
  that forward already is the door), and the database's application account is drawn from the
  crackable pool while its root stays shut (`missionShape`, drawn after everything else so the
  route reads the same whatever the storage). So `hydra <address> mysql`, `mysql <address> <user>`,
  `SELECT * FROM api_keys` reaches the key with no shell. The route still roots the box, a second
  way: a root reads the key out of `data.json`. The datadir is laid once with every table the
  contract adds (`datadirFile`), so on the mysql route it holds both `settings` and `api_keys`.
- A root's `rm` of the sealed key, the program or the datadir sticks like the key's; the write gate
  lists them all (`missionFilePaths`). An application account's `DELETE` from `api_keys` sticks too;
  `DROP` is database root's alone, which stays shut. With the secret unset, the doors answer 500
  `mission_secret_missing`.

**To add a storage:** `STORAGES` in `missionShape.ts` (and anything the box must run for it), and
`keyFilePaths`, `keyFiles` and `missionKeyFilePath` in `missionLeak.ts`.

## The routes that leak a login

On a leak route a forgotten file or setting gives away `root`'s password, and the player keeps the
word. **That closes the gap the credential layer had left open (D2.6b):** cracking only ever taught a
player words their list already held. A leaked word comes from the uncrackable pool, so
`defaultWordlist.test.ts`'s "covers the uncrackable pool not at all" is what gives it its value, and
appended to `passwords.txt` it lets `hydra` open doors it could not before.

| Route | Forwards | The player does | The word is in |
| ----- | -------- | --------------- | -------------- |
| web | `80`, `2222` | `gobuster http://<address>`, then `curl` | a file under `/var/www/html`, root-only, its name already on the default list |
| ftp | `21`, `2222` | `ftp <address> anonymous`, any password, then `get` | a file in `/srv/ftp/pub`, readable by a guest |
| mysql | `3306`, `2222` | `hydra <address> mysql`, then `SELECT` | a `settings` table, in the root-only datadir |
| snmp | `161`, `2222` | guess a community, or `hydra <address> snmp`, then `snmpwalk` | `syscontact` in `/etc/snmp/snmpd.conf`, world-readable |

Then every route is the same: `ssh root@<address> -p 2222` with the word, the key, the reply, the pay.

- **The word opens `root` directly**, because the key is root-only and nothing but the route climbs.
  A file shows the word and never names the account: working out that it is a login, and whose, by hand
  or by `hydra`, is the job. Every wrong try is an `auth.log` line.
- **The words are a fixed slice of the uncrackable pool** (`LEAKABLE_HASHES`,
  `core/missions/leakablePool.ts`), because a word is kept and can be shared, and accepting and dropping
  a job costs nothing. So over enough jobs a player holds every word that can leak. 13 words open 25.7%
  of Ridgemont's 1,263 uncrackable doors, measured, which is the cap: about a quarter of the world's NPC
  doors can fall to a shared list, and that is accepted.
- **No door that should stay shut holds a slice word.** The slice comes from positions no fixed box's
  root holds, and a mission gateway and the msfconsole root draw from `SHUT_HASHES`, the rest of the
  pool, as database root does on the mysql route. A test fails if any of them lands on one, which also
  catches a pool rotation. A workstation's root is what its owner chose, so no word touches a player.
- **The bundle holds hashes and the server holds the words.** `missionLeak.ts` reads `JSHACK_SECRETS` at
  runtime with `parseSecrets`, so there is no new variable and the words a deployment hands out cannot
  drift from the hashes it ships. It refuses any hash outside the slice, so no bug in a caller can turn it
  into a lookup for the shut words. Unset, a door that needs the file answers 500
  `mission_secret_missing`, and `hydra`, which sweeps what is in the base, still works. Everything the
  word sits in is built on the server: the file, the table's rows, `snmpd.conf`, and with it the read-only
  community (`monitor` or `netops`, the second hinted by the `netops@corp.local` contact on ordinary
  devices).
- **Each file is laid in like the key**, before the journal replays, by the doors that read it, so a root's
  `rm` or edit sticks and any root can close a route. A database route lays in the whole datadir, so a
  statement's write-back carries the table through the journal, and the application account can `DELETE`
  the row. The other way to close one without root: whoever holds the read-write community can `snmpset`
  the key box's filter and shut `:2222` for good. `forward` on a key box lands and does nothing.
- **Anonymous FTP is a real login, switched on by the box's config.** Only an ftp route's key box carries
  `anonymous_enable=YES`, and the door reads the file (`core/sessions/doorAdmission.ts`), so a root who
  sets it to `NO` closes it. No account joins `/etc/passwd`, and `ssh` as `anonymous` fails.
- **An SNMP route's agent refuses `public`**, so `snmpwalk <address>` gets silence, which is why the manual
  says most agents answer to it. `/etc/snmp/snmpd.conf` is on the externally observable list, so a caller
  whose session closed can still read it. Someone who never held a session gets nothing.
- **Pay does not change**, and offers show no route, so pay gives no hint of one.
- **Accepted:** everything under `/var/www` reaches any session's client, because anyone can `curl` it, so
  someone reading the traffic can see the web route's word without leaving an `access.log` line. A guest
  shell can read the ftp and SNMP files, and `curl localhost` the web one.

**To add a route:** `ROUTES` and `LEAK_ROUTE_DOORS` in `missionShape.ts`, `leakPlaceOf` and `leakContent` in
`missionLeak.ts`, and `findMissionFiles` at any door in `api/sessions.ts` that reads the file. If the new
route's door is a new kind, add it as a decoy kind too ("Decoys", above). A route serves both boxes
of a two-hop contract ("Two hops"): its lay-in takes a `MissionBoxRef`, so it must work on the front
box behind a forward and on the key box on its own port, and both need a test. Two harder
templates were left for later: a user login then a second leak for root, and a path off the default list
with a pointer to it.

## 4. The table and its states

**`hireme_missions`** (`20261101000000_hireme_missions.sql`, `20261102000000_hireme_contracts.sql`):
`number` (primary key, CHECKed to a mission number), `handle` (references `email_accounts`),
`state`, `ref` (an offer's random name, unique per handle; the operator's rows have none),
`posted_at`, `accepted_at`, `closed_at`. A partial unique index on `handle` where the state is
`accepted` keeps one active job per handle. RLS on with no policies, so only the service role
that `api/` uses reads it.

| State       | Reached by                             | Reachable     |
| ----------- | -------------------------------------- | ------------- |
| `offered`   | posted to a board, its number reserved | no            |
| `burned`    | an offer the 24-hour turnover replaced | never         |
| `accepted`  | `POST /accept`                         | yes           |
| `completed` | the right key mailed by the contractor | yes, for good |
| `abandoned` | `POST /drop`                           | yes, for good |

**An address is reachable if and only if its number was ever accepted.** Completion is recorded
by state alone; which wallet a job paid is kept only in the mint's own ledger row.

Every write is a store function, STRICT, `EXECUTE` for `service_role` alone, under a lock on the
handle's `email_accounts` row, answering one word, as `hireme_apply` does: `hireme_post_offers`,
`hireme_accept`, `hireme_drop`, `hireme_proof_open`, `hireme_complete` and `hireme_client_reply`
(`20261103000000_hireme_completion.sql`). Numbers and refs are drawn by the caller with
`node:crypto`'s `randomInt`, as board addresses are.

## 5. The board: offers, accept, drop

The board page moved out of the bundle into `core/hireme/contractBoard.ts`, answered by the
boards' server's fetch handler (`resolveHttpFetch.ts`); the doors and their words are in
`core/hireme/contracts.ts`.

- **Offers are posted lazily, on a board read.** A `GET /` tops the board up until offers plus
  the active job make **three**. Each offer has its own 24 hours from `posted_at`: an older one
  is `burned` on the next read and replaced in the same top-up, so offers turn over one by one,
  and a completed or dropped job's slot fills on the next read. The read and the top-up are one
  transaction, so two reads at once cannot post six. Anyone reading a leaked board tops it up
  too, which is harmless.
- **An offer** is one block: `<Client> — retrieve an access key — <pay>` (`retrieve an internal
  access key` on a two-hop contract), a one-line pitch, its
  ref and an `[ Accept ]` form posting `offer=<ref>` in a hidden field (`curl -d "offer=<ref>"`
  does the same). **It never shows the address**, so the form cannot carry the number; a page
  whose offer has since turned over is refused rather than swapped for another job.
- **The terms** come from the number, as the shape does (`missionTerms`,
  `core/missions/missionTerms.ts`): the client (a company and its handle, from ten), the target
  company (named on the shape's stem, so `halden-gw` belongs to Halden something), the pitch
  (black-hat or grey, from six), what the key opens, the kind of job and the pay, 500 to 2,000 JSC
  rounded to 50 ("§1,350"), or 2,000 to 4,000 on a two-hop contract. An offer's line shows only client, kind, pay and pitch, so two
  different jobs can read alike (about once in 620 boards); the briefing tells them apart.
- **Accepting** turns the offer `accepted` and mails the briefing as system mail, always
  delivered. While a job is active the board shows a **Current contract** block above the offers
  (client, target company, pay, `[ Drop contract ]`), never the address: a leaked board says who
  you work for and against whom, not where.
- **Dropping** (`curl -d "confirm=yes" …/drop` or the button) records the job `abandoned`, pays
  nothing and mails one line from the client ("Understood. We will not be in touch again."). The
  network stays reachable; its address may already be out.
- **The words**, each under the button it answers in hireme's `role="alert"` style, or at the top
  when that button is gone: "Contract accepted. <Client> has sent you a briefing.", "Contract
  dropped. <Client> will not be in touch again.", "Finish or drop your current contract first",
  "That offer is no longer available.", "You have no current contract."
- **Whoever holds a board's address can accept its offers and drop its job**, since the address is
  the board's only key. An accept they make still mails the briefing to the board's own inbox,
  so it tells them nothing, and a drop costs the job, never pay already earned.
- `GET /accept` and `GET /drop` answer the board and change nothing; any other POST there is 405.
  Every `POST /accept` and `POST /drop` is an `access.log` line on the boards' server naming the
  board asked, never the form.

## 6. The briefing and the client's door

- **A client writes from a reserved emailit.io handle of its own** (`copper-ops`,
  `bellwether-desk`, …). Every client handle is in `RESERVED_HANDLES`, so no player signs up as
  one, and each fits the handle alphabet, so `mail` sends to it unchanged.
- **The briefing**, from `<client handle>@emailit.io`, subject `Contract: <target company>`: the
  pitch, the target company, the mission address, what the key opens, the key's form, that the
  reply goes to this address with the key and a wallet address, and "No key, no money. No wallet,
  no money." A two-hop briefing adds that the key is on a machine inside their network, not on
  the edge. Never the way in, the path or the key's file.
- **A client has no inbox.** `handleResolveMail` hands a send to a client handle to the client's
  door (`answerClientMail`, `core/missions/clientMail.ts`) instead of to `email_send`. The mail is
  read when it is sent, answered with system mail in the sender's inbox, and kept nowhere. The send
  answers 200 once the reply is in, so `mail` prints what it prints for any send.
- **The proof is found by its shape**: the first key and the first wallet (`jsc` + 40 hex) in the
  subject, then the body, in any case, **skipping body lines that start with `>`** — the quoted
  briefing's own example has a key's shape, and a quote is someone else's words. Typing the key
  above or below the quote of `mail reply` works the same.
- **Only the contractor is paid.** The door looks at the sender's jobs with this client in
  `accepted` or `completed`; an `abandoned` job is no contract. The first row that fits answers:

  | The mail                                                        | The reply (subject `Contract: <target>`)                                             | What changes              |
  | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
  | No accepted job with this client, and not a completed job's key | "We have no contract with you." (subject `No contract`)                              | nothing                   |
  | An accepted job, no key                                         | "No key, no money. Send the key."                                                    | nothing                   |
  | The accepted job's key, with a wallet                           | "Key received. §1,350 sent to jsc…. Pleasure doing business."                        | completed, the pay minted |
  | The accepted job's key, no wallet                               | "Key received. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
  | A completed job's key                                           | "That job is already closed."                                                        | nothing                   |
  | An accepted job, any other key                                  | "That key opens nothing of ours."                                                    | nothing                   |

- **A job is paid once.** `hireme_complete` turns the row `completed`, mints with `wallet_mint` and
  lands the reply in one transaction under the handle's lock, so two right mails sent together pay
  once and the second gets "That job is already closed." A mint the ledger refuses takes the
  completion back: 500 `mail_failed`, the job still accepted, nothing mailed.
- **Proof mails count as sends.** The 20-an-hour count lives in one helper, `email_count_send`,
  that `email_send` and `hireme_proof_open` both call, so retries are unlimited in kind, never in
  rate. A wrong password is `login_failed`, as for any send.
- **The hole stays on purpose**: whoever holds a contractor's `~/.mailrc` can mail the client as
  them and name their own wallet, and the payout goes there.
- **No secret, no proof**: with `MISSION_KEY_SECRET` unset a mail to a client handle answers 500
  `mission_secret_missing` before anything is counted; mail between players is untouched.
- **A payout shows on chainit as any mint does**: a mint to an address, never which job paid it.
  Recognition for completed jobs (the other half of a reward) is not built.

## Tamper jobs

The second kind of contract: a client wants one record changed (v0.454.0) or erased (v0.455.0),
kept in a database or in CSV files (v0.456.0), in one of eight settings, each with tables beside
the target to look past (v0.457.0). The number decides the kind on its own stream,
`mission-kind-<n>`, half and half (`missionKind`, `core/missions/missionShape.ts`); a tamper job's
setting on another, `mission-setting-<n>`, an eighth each (`missionSetting`,
`core/missions/missionRecords.ts`); its action on a third, `mission-action-<n>`, half change and
half erase, but always a change in a setting with nothing worth erasing (`missionAction`); and its
storage on a fourth, `mission-records-storage-<n>`, half database and half file
(`recordsStorage`, `missionShape.ts`). A key number's shape and terms are exactly what they were
before the kind existed, and a tamper number's shape, client and pay exactly what they were before
settings existed; each is a new stream, never a new draw on an old one.

- **The records box is the key box with records instead of a key.** Same octet, route, decoys,
  front box and hostname (`<stem>-files`). It holds no key file and no `api_keys`, so laying it in
  needs no `MISSION_KEY_SECRET`.
  - **Database storage**: it runs mysqld as database key storage does — a crackable application
    account, a shut database root, `:3306` forwarded on single-hop, the inside door on two-hop —
    and the setting's three tables sit in its datadir, so `SHOW TABLES` lists them all. On the
    mysql leak route the datadir also holds `settings`.
  - **File storage**: no mysqld and no `:3306` for the records (the mysql route keeps its own
    door, and its datadir holds only `settings`). Each table is a root-only file
    `/srv/<stem>/records/<table>.csv` (`recordsFiles`; the target's is `recordsFilePath`): a header
    naming the columns, then one line per row and a final newline. The route's root reads them and
    edits them in `nano`; they are in `missionFilePaths`, so the write gate lets that root save
    them, and a save is one journal row the client's read replays over the lay-in.
- **The settings** (`core/missions/recordSettings.ts`, rows on `mission-records-<n>`). Each brings
  the table the job is about, which column a change moves and what an erase takes, and two tables
  beside it:

  | Setting    | Target           | Table                                         | Change                   | Erase                    | Beside it                  |
  | ---------- | ---------------- | --------------------------------------------- | ------------------------ | ------------------------ | -------------------------- |
  | school     | Academy          | `grades` id, student, subject, grade          | a C, D or F to an A or B | a failing grade          | `attendance`, `staff`      |
  | police     | Police Dept      | `warrants` id, name, dob, offence, status     | `active` to `cleared`    | an active warrant        | `incidents`, `officers`    |
  | payroll    | Holdings         | `payroll` id, name, dept, salary              | raised by 10,000–30,000  | none: a change only      | `departments`, `expenses`  |
  | dmv        | Motor Registry   | `offences` id, licence, name, offence, points | 3–12 points to 0         | an offence               | `inspections`, `examiners` |
  | tournament | Esports League   | `scores` id, player, game, score              | raised by 300–900        | a rival's score          | `teams`, `matches`         |
  | admissions | University       | `applicants` id, name, dob, program, status   | `rejected` to `admitted` | an application           | `programs`, `staff`        |
  | club       | Members Club     | `members` id, name, age, tier, status         | an age of 17 to 21       | a `banned` member        | `events`, `staff`          |
  | registry   | Vehicle Registry | `vehicles` plate, owner, make, model, status  | the owner to a new name  | the one `stolen` vehicle | `dealers`, `inspections`   |

  A target table holds 20–40 rows (School: 5–8 students by 4–5 subjects), named people unique
  within it (a student and a subject together at a school; a plate in the registry), so the names
  the briefing gives fit exactly one row (`RecordTarget.namedBy`). People come from one pool of
  first and last names. The tables beside it hold 5–15 rows each, drawn on
  `mission-neighbours-<n>` so the target never moves for them, and name nobody the target does.
  Numeric columns (id, salary, points, score, age) are numbers in the datadir and digits in a CSV.
  No value holds a quote, a comma or the word "and", since a player types each back into a quoted
  condition or a comma-separated line.

- **The terms**: `<Client> — alter a school record — §<pay>`, the setting's noun on the board
  (`alter a police record`, `erase an admissions record`, `alter a vehicle registry record`), and
  `alter an internal … record` two-hop. Pay is 1,000–2,500 single-hop and 2,500–5,000 two-hop,
  rounded to 50, whatever the setting, action or storage. The target is `<Stem> <institution>`
  (`Halden Academy`, `Halden Police Dept`). Each setting pitches from three to six reasons of its
  own for each action. `MissionTerms` is a union on `job: 'key' | 'tamper'`, and only a key job
  has `keyOpens`.
- **The briefing** names who, which field and old to new, or that the record should not exist,
  in the setting's words: "Their records give Amara Okafor a D in Chemistry. It should be an A.",
  "Their records hold an active warrant for Ben Holloway, for fraud. It should read cleared.",
  "The club has Zoe Lambert down as 17. It should say 21.", "Their registry flags KX21 LMR as
  stolen. That record should not exist." Never the row's id, a table, a file, the box or the
  path. A two-hop briefing says the records are on a machine inside their network. It ends "No
  change, no money. No wallet, no money."
- **Any mail from the contractor reads the box.** `answerClientMail` asks for the records box
  (`readRecordsBox`, wired by `handleResolveMail` through `generatedLanBox`, so the read sees the
  lay-in, every journal row and whether the box still boots). `recordsLookRight` reads only the
  target table, and passes when it has exactly the generated rows in order, every cell equal as
  text to the generated one, except the target's changed column, which must equal the value asked
  for after trimming, case-sensitive (an age set to `21` passes, `21.0` does not). On an erase it
  passes when the table holds exactly the generated rows but the target, in order, each equal as
  text. The tables beside it are never read: emptying or deleting them costs nothing. A file job's
  CSV is read into the same rows first: LF or CRLF line endings, blank lines skipped, each value
  trimmed and out of its surrounding double quotes, every row keyed by the header's names (so
  column order does not count), and a line with more or fewer values than the header has no rows
  at all. A header naming a column missing, extra or renamed leaves rows that cannot equal the
  generated ones. The mail's words do not matter; only its wallet does.

  | The box                                                                | The reply                                                   | What changes              |
  | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
  | The records read right, with a wallet                                  | "The records look right. §1,450 sent to jsc…. Pleasure …"   | completed, the pay minted |
  | The records read right, no wallet                                      | "The records look right. You sent no wallet, so there is …" | completed, nothing minted |
  | Unchanged, a third value, another row touched or gone, no target table | "Our records don't look right. No change, no money."        | nothing                   |
  | The box does not boot, or has no datadir or readable CSV               | "Our records don't look right. No change, no money."        | nothing                   |
  | A completed job                                                        | "That job is already closed." (the box is not read)         | nothing                   |
  | The read itself fails                                                  | nothing: 500, as any store failure                          | nothing                   |

- **A careless statement costs the job's pay until it is undone.** An `UPDATE` with no `WHERE`
  gives every row the value, and the records no longer read right; putting the other rows back
  makes them read right again. A `DELETE` with no `WHERE` takes every row, and the game's `mysql`
  has no `INSERT`, so only a root retyping the datadir can bring them back. A visitor who bricks
  the box before the contractor mails costs the contractor the job, which is the shared network
  working as designed.
- `hireme.ts show` adds `Kind: tamper, <setting>, <action>` and, in place of the key lines, the
  storage (`database, table <table>` and the datadir's path, or `file, <the target CSV's path>`)
  and the change (`Change: <names>: <column> <from> -> <to>`) or the row to erase
  (`Erase: <names>`).

## 7. What a root finds

On the boards' server, beside `/etc/hireme/boards`, **`/etc/hireme/contracts`**: one
`<handle> <client handle> <mission address> <pay>` line per `accepted` job, earliest accepted
first, the pay as the bare number of JSC so every line splits into four fields
(`withContractsList`, `core/missions/contractsList.ts`). It is built from the table on each read
and laid in before the journal is replayed (`resolveCrossPlayerFs`, `findContracts` in
`api/network.ts`), so a root's rewrite changes what the next root reads and nobody's job. It is
read for a root session there alone: below root the table is not read and nothing of it reaches
the wire; a failed read is 500 `contracts_lookup_failed`, never an empty file. No key is in it, so
it needs no secret. A root learns every live contract and who works it: they cannot claim
another's job, but they can race its contractor to the key box, or find that contractor's board in
`boards` and go after their `~/.mailrc` for the payout. Rooting the boards' server takes a
root-tier CVE on `:80` or `:22`, as for every fixed site.

## 8. The operator

`scripts/hireme.ts`, run against dev or local with `npx dotenv -e .env.development.local -- npx
tsx scripts/hireme.ts …`, never needed in play (orders parsed in `core/missions/hiremeOrders.ts`):

- `accept <handle> [--number N]` accepts a job directly, mailing nothing (refused for a handle
  with an active job or no mailbox); prints the address. `--number` is how a dev gets a network
  with given axes: search for a number that has them.
- `post <handle>` burns the board's offers and posts three fresh ones now.
- `show <address>` prints the client, target, pay, template, route, forwards, the key box's
  services, the storage (with the passphrase on a gpg contract), the file the key is in and the
  key, and on a leak route the file's path and the word. A two-hop report gives the front box and
  the key box a section each. It reads the secrets
  from the env; only its derived key and that word are ever printed.
- `drop <handle>` abandons the active job.

It cannot complete a job: completion only happens through `mail`, so every test of a payout goes
through the real door. `drop` only abandons; truly removing a contract is a service-role delete
of its row and the patches it left, as the wire-checks' cleanup does.

## 9. The bundle

The client carries the 195 block in `isPublicIp`, the `whois` record and the network's shape.
The key, its paths, the terms, the board, the briefing, the replies and the root view are built
on the server only. The leak routes added the slice's hashes and the route shapes, and the two-hop
template the front box and the inside decoys, and the tamper kind its draw and the records'
pools. Each feature raises the main chunk's ceiling by its measured growth; at v0.457.0 the chunk
is 299,557 B gzipped against a ceiling of 299,575 B (the settings' content is not in it).

## 10. Proving it

- **Unit**: the address codec and block (`missionNetwork.test.ts`, `ip.test.ts`,
  `whois.test.ts`); the shape over 2,000 numbers — the route reachable through the forward and
  granting root, no other `critical` or `high` hole on either box on any day, the same network on
  client and server on any day (`missionShape.test.ts`); the key and its dependence on the secret
  (`missionSecret.test.ts`); the terms (`missionTerms.test.ts`); the lookup over the five states
  (`boards.test.ts`); the board and its doors (`contractBoard.test.ts`, `contracts.test.ts`,
  `resolveHttpFetch.test.ts`); the proof reader and every row of the reply table
  (`clientMail.test.ts`); the root view (`contractsList.test.ts`, `resolveCrossPlayerFs.test.ts`);
  the operator's orders (`hiremeOrders.test.ts`).
- **Wire-checks** (vs `vercel dev` + local supabase): `scripts/testMissions.ts` (19: the network,
  both routes, the key, the join refusal, the trace, `rm` sticking); `testMissionBoard.ts` (19:
  offers, the turnover by back-dating `posted_at`, accept and drop with both races fired
  together); `testMissionPay.ts` (15: every reply, the race paying once, the hole, the send
  limit); `testMissionContracts.ts` (11: the root view, through real accepts, a drop and a
  completion); one per leak route, each from the scan to the payout and each way a route closes:
  `testMissionLeak.ts` (16), `testMissionFtp.ts` (27), `testMissionMysql.ts` (28),
  `testMissionSnmp.ts` (35); `testMissionDecoys.ts` (15: every decoy kind worked to its empty
  end on two staged contracts, then the hydra route paid beside three decoys); and
  `testMissionTwoHop.ts` (64: one web-fronted contract per key-box route, the key box absent from
  a public scan, the front route worked to root, the LAN scanned from it, every inside decoy worked
  to its empty end, the key box's route worked from the hop, the key paid once);
  `testMissionTamper.ts` (38: `show`, the scan, a mail before any change and after an `UPDATE`
  with no `WHERE` refused, the right `UPDATE` paid once then closed, a box bricked by its own root
  refused, a two-hop job changed from a root shell on the front box and paid, and on erase jobs a
  `DELETE` with no `WHERE` refused and the right `DELETE … WHERE` paid once then closed, and on
  file jobs `show` naming the CSV, no `:3306`, the route's root reading the CSV, a save as `nano`
  makes it with the target line right paid once then closed, and one with another line deleted
  refused; and one job in each of the eight settings, four kept in a database and four in files,
  holding both tables beside the target, worked by a root saving the datadir or the CSV right and
  paid). The
  board and pay checks each post a two-hop offer on a chosen number (21 and 17 checks at
  v0.452.0). The decoys' doors are also proven in `decoyMissionDoors.test.ts`.
- **Mutation**: every slice's scoped run left no survivor but equivalents.
- **One browser run at the epic's close-out** (2026-11-03, v0.441.0), two players in headed
  browsers, each in a different town. alice signed up on emailit.io, applied with `curl -d`, read
  the mail and opened her board: three offers. She accepted Copper Systems (1,650 JSC) through the
  lynx form; the board showed the current contract, and a second accept was refused. The briefing
  from `copper-ops` named Ferro Engineering at `195.43.236.35`. bob, handed that address, saw `22`
  and `80` in `nmap`, rooted `ferro-files` with `msfconsole` and read the key; his mail of it with
  his wallet got "We have no contract with you." and his wallet stayed at 0. alice rooted the box
  herself and replied to the briefing with the key and her wallet above the quote: "Key received.
  1,650 JSC sent to jsc…", her balance 1,650. The key again got "That job is already closed." and
  no second mint; her board showed no current contract and a fresh offer. An accept and a drop by
  `curl -d` answered the drop's words, mailed the client's line and refilled the slot, and bob's
  `nmap` still reached the closed job's network. No defect. The root view rests on its
  wire-check, re-run against the same server (11/11). The contract work was announced on
  valleynews.io `/dev` (story 16).
- **One browser run at the leak routes' close-out** (2026-11-04, v0.445.0), one player from a
  town network, the four jobs accepted in turn through the operator. Web: `nmap` showed `22`,
  `80`, `2222`, `gobuster` found `/dump.sql`, and `curl` printed the word. FTP: at the real `ftp>`
  prompt an anonymous login, `ls`, `cd pub`, `get`, `quit`, `cat`. Database: `hydra` found the
  application account, and at the real `mysql>` prompt `SHOW TABLES` and `SELECT * FROM settings`
  showed the word. SNMP: `161/udp` in the scan, silence for a plain walk, a wrong name and one of
  the two guessable communities, `READ-ONLY` for the other, then `hydra` found the read-write
  community and a walk with it showed the word and the port table. On each, the word logged in as
  root over `:2222`, `cat` read the key, and a mail of it got "Key received", the wallet going
  1,650, 2,800, 3,300, 5,050 JSC. No defect. The closures, the guest shell, `snmpset` and the
  `msfconsole` refusals rest on the wire-checks. Announced on valleynews.io `/dev` (story 17).
  Words and keys were masked on every read of the screen, so the run's record holds neither.
- **One browser run at the two-hop close-out** (2026-11-10, v0.452.0), one fresh player on
  LIBRARY-PATRON. The first board read offered "Saltmarsh Energy — retrieve an internal access key
  — §3,100" beside two single-hop offers. Its key box ran only its real doors, so the board was
  turned over by back-dating its offers until a two-hop offer with an inside decoy came up:
  contract 6920654, hydra in front, the ftp route on the key box, database storage, a web decoy.
  The player accepted it with `curl -d`, and the briefing carried the "inside" line. A public scan
  showed `22`, `2222`, `3306` and `80` and no ftp. `ssh root@<address> -p 2222` landed on
  `northgate-web`, where `apt install` gave `nmap`, `gobuster` and `ftp`. `nmap -sV
  192.168.211.1-254` found the gateway, `northgate-files` and `northgate-web`; the key box showed
  `22`, `21`, `3306` and `80`. `gobuster` on the decoy found only the stock page. Anonymous `ftp`,
  `get` of `pub/old`, and `ssh root@<key box>` with its word landed on `northgate-files`, whose
  `data.json` held the key. The mailed key got "Key received. §2,700", the balance 2,700; the key
  again got "That job is already closed." and one mint stood. No defect. `nmap` takes a range,
  not a CIDR block.
- **One browser run at the tamper close-out** (2026-11-11, v0.457.0), one fresh player on
  LINKSYS-1D41. The board's lines read "alter an admissions record", "erase an internal admissions
  record" and "alter an internal vehicle registry record"; it was turned over by back-dating until
  each job came up. The failure first: a club erase kept in a database (contract 5275525), its
  briefing "The club has Hannah Demir banned. That ban should not exist." `hydra <address> mysql`
  found the application account, `SHOW TABLES` listed `members` beside `events` and `staff`, and
  `UPDATE members SET status = 'active'` with no `WHERE` changed 20 of 32 rows. The reply said
  "Our records don't look right. No change, no money.", the balance stayed 0, and the job was
  dropped. Then a university change in a database (contract 3540213), accepted through the lynx
  form: "Their records have Fatima Haddad rejected for Economics. It should read admitted." The
  `UPDATE … WHERE name = 'Fatima Haddad'` changed one row, and the reply paid §1,350. Then a motor
  registry erase in files (contract 4195674): no `:3306` in the scan, root over `:2222`,
  `/srv/halden/records/` holding `offences.csv`, `inspections.csv` and `examiners.csv`, and
  Isaac Okafor's line deleted in `nano`. The reply paid §1,550, the balance 2,900. No defect.
  Words were masked on every read of the screen.

## What follows

Deferred, in `backlog.md` under "missions — deferred": believable filler behind real doors and
decoys alike; further templates (deep chains, switches, the gpg passphrase on a third box, the
library route, stealth, deadlines, a harder leak); a lead to the key box on the front box, as a
seventh inside route; file exfiltration, which
needs attachments; recognition for completed jobs; a second, darknet operator; and for tamper
jobs, adding a record, a second copy the client also checks, an audit log to keep clean, a
white-hat fix, and clients and settings of their own.

## Key files

- **Server**: `supabase/migrations/20261101000000_hireme_missions.sql`,
  `20261102000000_hireme_contracts.sql`, `20261103000000_hireme_completion.sql`;
  `api/network.ts` (the board doors, `findMissionFiles`, `findContracts`, the client's door's
  store), `api/sessions.ts` (the lookup at each door, `findMissionFiles` for the database and SNMP
  doors) and `api/patches.ts` (`missionFilePathsOf`).
- **missions** (`core/missions/`): `missionNetwork.ts`, `missionShape.ts`, `pools.ts`,
  `leakablePool.ts` (bundle); `missionSecret.ts`, `missionLeak.ts`, `missionTerms.ts`,
  `clientMail.ts`, `contractsList.ts`, `hiremeOrders.ts` (server and scripts); `missionRecords.ts`
  (a tamper job's setting, records and the check) and `recordSettings.ts` (the eight settings'
  tables).
- **The lay-in and the doors**: `core/network/missionBoxFiles.ts`, `core/sessions/doorAdmission.ts`,
  `core/generation/missionKeyBoxFs.ts`, `core/crypto/gpgCodec.ts` (the cipher the server seals a
  gpg contract's key with).
- **hireme**: `core/hireme/boards.ts` (the lookup), `contractBoard.ts`, `contracts.ts`.
- **Wiring**: `core/network/resolveHttpFetch.ts`, `core/network/resolveCrossPlayerFs.ts`,
  `core/patches/remoteWritePermission.ts`, `core/emailit/handleResolveMail.ts`,
  `core/emailit/signup.ts` (`RESERVED_HANDLES`), `core/commands/whois.ts`,
  `core/generation/generateHomeLan.ts`, `core/generation/lanHostIdentity.ts` (`missionBoxAt`),
  `core/generation/world.ts`.
- **Operator**: `scripts/hireme.ts`.
