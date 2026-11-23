# missions architecture (as-built)

How a player takes paid work: a contract offered on their hireme.io board, accepted with a form,
briefed by mail, worked on a network of its own and paid by mailing the client the key — or, on
a tamper job, by changing or erasing one of the client's records and mailing them anything, or, on
a sabotage job, by leaving one of the target's machines unable to boot and mailing them, or, on a
file job, by mailing them one of the target's files as an attachment, or, on a backdoor job, by
leaving a listener on one of the target's machines and mailing them while it listens, or, on an
infiltrate job, by putting the file the client mailed them at a path on one of the target's
machines and mailing them while it is there, or, on a portforward job, by making the target's
router send a public port to one of its machines and mailing them while it does, or, on a
credential job, by mailing them root's password on one of its machines, or, on a destroy job, by
getting rid of one of its files, or, on a wipe job, by emptying one of its tables, or, on a chain
job, by leaving a listener on its edge and then doing one of those last three things to the
machine behind it, or, on a cleanup job, the first white-hat kind, by getting an intruder's
listener and implant off one of its customer's machines, or, on a close-the-door job, by
shutting a forward someone laid on a customer's router into one of its machines, or, on a
lock-them-out job, by locking someone out of a customer's machine they hold root's password
on. This is
the shipped model of the missions epic, complete at **v0.441.0** (four slices, v0.438.0–v0.441.0,
PRs #746–#749, 2026-11-01 to 2026-11-03), with the routes that leak a login added by the epic
that followed (four slices, v0.442.0–v0.445.0, PRs #750–#753, 2026-11-03 to 2026-11-04), and a
second template, a key box behind a front box ("Two hops", four slices, v0.450.0–v0.452.0, PRs
#761–#764, 2026-11-09 to 2026-11-10), and a second kind of job, a record changed or erased
("Tamper jobs", four slices, v0.454.0–v0.457.0, PRs #766–#769, 2026-11-11), and a third, a
machine taken down ("Sabotage jobs", two slices, v0.458.0–v0.459.0, PRs #770–#771, 2026-11-12),
and a fourth, a file brought back ("File jobs", from v0.461.0, on mail that carries a file,
v0.460.0, PR #772), and a fifth, a listener left on a machine ("Backdoor jobs", v0.464.0), and
a sixth, the client's own file put in place ("Infiltrate jobs", v0.465.0–v0.466.0), and a
seventh, a port forwarded into a machine ("Portforward jobs", v0.467.0), and four black-hat
kinds, a root login stolen, a file destroyed, a table wiped and a two-step chain ("Four black-hat
kinds", v0.471.0–v0.475.0, PRs #785–#789, 2026-11-18 to 2026-11-20), and the first white-hat
kind, an intruder's work removed ("Cleanup jobs", v0.479.0, PR #801, 2026-11-22), and the
second, a way in shut ("Close-the-door jobs", v0.480.0, PR #802, 2026-11-23), and the third,
an intruder locked out ("Lock-them-out jobs", v0.481.0, PR #803, 2026-11-23).
It sits
on top of the contractor boards
([`hireme-architecture.md`](./hireme-architecture.md)), emailit.io
([`email-architecture.md`](./email-architecture.md)) and the wallet
([`wallet-architecture.md`](./wallet-architecture.md)) without changing their machines,
addresses or lookups. Legacy's design and scenarios, the input to the grill, are in
[`mission-ideas/`](./mission-ideas/README.md). The grill records and slice plans were retired on
close-out; the black-hat kinds' grill decisions are folded into their sections below. When this doc and the code disagree, the code wins — fix the doc.

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
- **A sabotage job's proof is the network's state too**, and the plainest one: the client reads
  its target on every mail and pays once it no longer boots, however it was broken and by whoever.
  A completed job is closed without reading it. See [Sabotage jobs](#sabotage-jobs).
- **A backdoor job's proof is the network's state as well:** the client reads its target on
  every mail and pays while a listener holds the port the briefing named, whoever left it. A
  completed job is closed without reading it, so a listener killed after payment takes nothing
  back. See [Backdoor jobs](#backdoor-jobs).
- **An infiltrate job's proof is the network's state again:** the client reads its target on
  every mail and pays while the file at the path its briefing named is, character for character,
  the file it mailed with that briefing, whoever put it there. A completed job is closed without
  reading it. See [Infiltrate jobs](#infiltrate-jobs).
- **A portforward job's proof is the router's state:** the client reads the contract's router,
  never the machine, on every mail and pays while the public port its briefing named reaches the
  machine on the machine's own port, whoever wrote the forward. A completed job is closed without
  reading it. See [Portforward jobs](#portforward-jobs).
- **A key comes from a server-only secret**, because the generator ships in the bundle and the
  seed is public. A tamper, sabotage, backdoor or portforward job needs none: what it asks for
  is in its briefing, and the box only has to read right, not come up at all, or listen, or the
  router only has to route. A file or
  infiltrate job's files are drawn from the same secret, so nobody makes them from the bundle.

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
  and msfconsole, two on a leak route. A portforward job is the one exception: its job is the
  gateway, so it falls to a route of its own, a crackable admin or a firmware hole
  ([Portforward jobs](#portforward-jobs)).
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
  two-hop), so a contract's shape stays a function of its number and computable offline. A
  portforward job is never two-hop: its machine sits behind the router itself, so a portforward
  number is single-hop whatever its template draw, and the third holds over the other kinds
  ([Portforward jobs](#portforward-jobs)). A stream
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
`mission-kind-<n>`, a third each for tamper, sabotage and key (`missionKind`,
`core/missions/missionShape.ts`; see [Sabotage jobs](#sabotage-jobs) for the split); a tamper job's
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
  own for each action. `MissionTerms` is a union on `job: 'key' | 'tamper' | 'sabotage'`, and only
  a key job has `keyOpens`.
- **The briefing** names who, which field and old to new, or that the record should not exist,
  in the setting's words: "Their records give Amara Okafor a D in Chemistry. It should be an A.",
  "Their records hold an active warrant for Ben Holloway, for fraud. It should read cleared.",
  "The club has Zoe Lambert down as 17. It should say 21.", "Their registry flags KX21 LMR as
  stolen. That record should not exist." Never the row's id, a table, a file, the box or the
  path. A two-hop briefing says the records are on a machine inside their network. It ends "No
  change, no money. No wallet, no money."
- **Any mail from the contractor reads the box.** `answerClientMail` asks for the records box
  (`readTargetBox`, wired by `handleResolveMail` through `generatedLanBox`, so the read sees the
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

## Sabotage jobs

The third kind of contract (v0.458.0): a client wants one of the target's machines taken down
for good. `mission-kind-<n>` is split in thirds: below ⅓ tamper, from ⅓ to ⅔ sabotage, from ⅔
key. The middle third was carved out of both older kinds, so some numbers that were key or tamper
jobs are now sabotage jobs. That was accepted before launch. Every number that kept its kind kept
its shape, terms and LAN exactly. Each later kind took its share the same way, and since v0.467.0
each kind is a seventh ([Portforward jobs](#portforward-jobs)).

- **The target is the key box's slot with nothing in it.** It has the same octet, route, decoys
  and front box. On two-hop it is the inside box. It has no storage (`MissionShape.storage` is
  `null`): no key, no records, no mysqld for them, and no doors but the ones its route and leak
  route run. Its hostname names its role (`sabotageRole`, `keyBoxSuffix`,
  `core/missions/targetRoles.ts`), one of seven drawn on `mission-sabotage-role-<n>` (v0.459.0),
  so no earlier draw moved:

  | Role                   | Hostname         |
  | ---------------------- | ---------------- |
  | CCTV recorder          | `<stem>-nvr`     |
  | backup server          | `<stem>-backup`  |
  | monitoring station     | `<stem>-mon`     |
  | build server           | `<stem>-ci`      |
  | licence server         | `<stem>-lic`     |
  | door-access controller | `<stem>-access`  |
  | billing server         | `<stem>-billing` |

  The role names the box and nothing else: no role lays files or runs a service of its own, as
  filler on one kind of box alone would tell a contractor which box the job is on. The hostname is
  the one thing the LAN generator asks of the kind, so the roles ride in the bundle.

- **The terms**: `<Client> — take down a backup server — §<pay>`, and `take down an internal …`
  on two-hop. The pay is the key job's: 500–2,000 single-hop and 2,000–4,000 two-hop, to the
  nearest 50. The target company is drawn as a key job's is. Each role pitches three to six
  reasons of its own, shared with no other role.
- **The briefing** names the role only: "Take their backup server offline." On two-hop it adds "It
  is a machine inside their network, not on the edge." It never names the box, its address or its
  hostname. It ends "No outage, no money. No wallet, no money."
- **Any mail from the contractor reads the target** through the same `readTargetBox` a tamper job
  uses. A read of `absent` means the box no longer boots. On a contract network that means it was
  bricked: a tombstone on `/boot/vmlinuz` or `/boot/initrd.img` makes `canBoot` false. The job is
  then done, with no reboot needed and no matter whose `rm` it was. The mail's words do not
  matter; only its wallet does.

  | The target                   | The reply                                                | What changes              |
  | ---------------------------- | -------------------------------------------------------- | ------------------------- |
  | Does not boot, with a wallet | "The machine is down. §1,450 sent to jsc…. Pleasure …"   | completed, the pay minted |
  | Does not boot, no wallet     | "The machine is down. You sent no wallet, so there is …" | completed, nothing minted |
  | Still boots                  | "Their machine is still up. No outage, no money."        | nothing                   |
  | A completed job              | "That job is already closed." (the target is not read)   | nothing                   |
  | The read itself fails        | nothing: 500, as any store failure                       | nothing                   |

- **Bricking the front box loses a two-hop job.** The target behind it still boots, so the client
  says it is still up. The front box was the only way in, so the target is now out of reach. No
  warning is given.
- `hireme.ts show` prints `Kind: sabotage, <role>`, calls the slot `target` in the forwards and
  services, prints no storage, key path or key, and on two-hop heads the inside section
  `Target box:`.

## File jobs

The fourth kind of contract (v0.461.0): a client wants one file from the target's network,
mailed back as an attachment ([`email-architecture.md`](./email-architecture.md), "Attachments").
`mission-kind-<n>` is split in quarters: below ¼ tamper, ⅓ to 7⁄12 sabotage, from ¾ key, and file
jobs in the two gaps, ¼ to ⅓ and 7⁄12 to ¾. The gaps are what tamper, sabotage and key gave up as
they shrank from thirds, so a number is the kind it was or has become a file job; none turned
from one older kind into another. Every number that kept its kind kept its shape, terms and LAN
exactly. Since v0.464.0 each kind was a fifth ([Backdoor jobs](#backdoor-jobs)), since v0.465.0
a sixth ([Infiltrate jobs](#infiltrate-jobs)), and since v0.467.0 a seventh
([Portforward jobs](#portforward-jobs)).

- **The target is the key box's slot,** as a sabotage target is: the same octet, route, decoys
  and front box, the inside box on two-hop. It keeps the key box's hostname, `<stem>-files`, and
  has no storage (`MissionShape.storage` is `null`): no key, no records, and no mysqld for them.
- **The file** (`core/missions/missionFileItem.ts`, server only) is one of six items (v0.462.0),
  drawn one in six on `mission-file-item-<n>`. Its name, directory and the parts of its name are
  drawn from the number on `mission-file-<n>` and kept off the wire, as the key's path is:

  | Item             | Keepers     | Name                          | Directories                               | Content                                                   |
  | ---------------- | ----------- | ----------------------------- | ----------------------------------------- | --------------------------------------------------------- |
  | prototype render | designers   | `<code>-render-<stage>.jpg`   | `/srv/design/`, `/opt/cad/renders/`       | jpeg; Exif names a renderer, when, and the designer       |
  | site photo       | surveyors   | `IMG_<YYYYMMDD>_<HHMMSS>.jpg` | `/var/lib/uploads/`, `/srv/media/photos/` | jpeg; Exif names a camera and the moment its name gives   |
  | signed contract  | lawyers     | `<project>-<deal>-signed.pdf` | `/srv/legal/`, `/var/archive/contracts/`  | pdf; Info gives the title, the author and two dates       |
  | firmware image   | engineers   | `<device>-fw-<version>.bin`   | `/opt/firmware/`, `/srv/releases/`        | `FWIMG v<version> <device>`, then noise                   |
  | customer export  | salespeople | `customers-<YYYY>-<MM>.dat`   | `/var/backups/`, `/srv/exports/`          | `CUSTDB01`, then noise                                    |
  | key ring         | admins      | `keyring.dat`                 | `/root/.vault/`, `/etc/<stem>/`           | `KEYRING v2`, then noise                                  |

  A jpeg or pdf is rendered by `renderDocument` (`core/generation/documentFormats.ts`), so
  `strings` gives up what a real one would; a header item is its header, then 1,000 to 3,000
  characters of noise. Every date falls in the 300 days before `WORLD_EPOCH`, as a share's
  documents do. Every byte is drawn from an HMAC of `file:<n>` under `MISSION_KEY_SECRET`, so
  nobody makes the file without taking it, and the two deployments lay different files. Noise is
  Latin-1 from `¡` to `ÿ` less the soft hyphen, and only a pdf has line breaks, so the file
  survives the signed write and the TEXT column of every copy (`scp`, `ftp get`, `mail save`);
  every item is under the 8,000 characters an attachment may be. No item sits in a user's home:
  the NPC user owns theirs, and `rm -r` needs write only on the containing directory, so the
  file's parent could go without root. The server lays it root-only (`ROOT_FILE`, owned by root)
  beside nothing else; it is in `missionFilePaths`, so only root may write the path, and a root's
  `rm` of it sticks for everyone, the job lost with no warning.
- **The terms**: `<Client> — retrieve a <item> — §<pay>`, and `retrieve an internal …` on
  two-hop, at the key job's pay (500–2,000 single-hop, 2,000–4,000 two-hop, to the nearest 50).
  The target company is drawn as a key job's is, the pitch from the item's own four.
- **The briefing** names the file and never where it sits:

  ```text
  Their <keepers> keep a <item>. Bring it to us. Its name is:

    harbour-bid-signed.pdf

  Mail it to this address as an attachment, with your wallet address.
  No file, no money. No wallet, no money.
  ```

  On two-hop it adds "The file is on a machine inside their network, not on the edge."

- **The client compares the attachment with the file it laid**, character for character. The
  name the file travels under does not matter, and the client never reads the box, so nothing a
  later visitor does there breaks a completion. A key in the text proves nothing. The first row
  that fits answers:

  | The mail                                                         | The reply                                                      | What changes              |
  | ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- |
  | No accepted job with this client, and not a completed job's file | "We have no contract with you."                                | nothing                   |
  | An accepted file job, no attachment                              | "No file, no money. Send the file."                            | nothing                   |
  | The file laid, with a wallet                                     | "File received. §1,450 sent to jsc…. Pleasure doing business." | completed, the pay minted |
  | The file laid, no wallet                                         | "File received. You sent no wallet, so there is nothing to …"  | completed, nothing minted |
  | A completed job's file                                           | "That job is already closed."                                  | nothing                   |
  | An accepted job, any other attachment                            | "That's not the file we asked for."                            | nothing                   |

  A file changed on the way, by one character or a newline `nano` added, is another file, and the
  reply does not say why. Key, tamper and sabotage jobs ignore an attachment.

- `hireme.ts show` prints `Kind: file, <item>` and `File: <path>, <size> bytes`, and no
  storage, key path or key.

## Backdoor jobs

The fifth kind of contract (v0.464.0): a client wants a way into one of the target's machines
that stays open, a listener left on it on a port the briefing names. `mission-kind-<n>` is split
in fifths: each older kind gave up a twentieth at one edge, and backdoor jobs fill those four
gaps, so a number is the kind it was, with its shape, terms and LAN exactly, or has become a
backdoor job. None turned from one older kind into another.

| Draw         | Kind     |
| ------------ | -------- |
| 0 to 1⁄5     | tamper   |
| 1⁄5 to ¼     | backdoor |
| ¼ to ⅓       | file     |
| ⅓ to 8⁄15    | sabotage |
| 8⁄15 to 7⁄12 | backdoor |
| 7⁄12 to 7⁄10 | file     |
| 7⁄10 to ¾    | backdoor |
| ¾ to 19⁄20   | key      |
| 19⁄20 to 1   | backdoor |

- **The target is the key box's slot,** as a sabotage or file target is: the same octet, route,
  decoys and front box, the inside box on two-hop. It has no storage (`MissionShape.storage` is
  `null`) and runs no service of its own.
- **One stream, `mission-backdoor-<n>`, draws the machine and then the port**
  (`backdoorJob`, `core/missions/targetRoles.ts`), so no earlier draw moved. The machine is one
  of sabotage's seven, which names the box as a sabotage target is named (`<stem>-nvr`, `-backup`,
  `-mon`, `-ci`, `-lic`, `-access`, `-billing`), so a hostname never says which of the two jobs a
  box is. Each machine brings three backdoor pitches of its own, shared with no sabotage pitch and
  no other machine.
- **The port** is one of eight classic listener ports: 1337, 4444, 5555, 6666, 7777, 9001, 12345
  and 31337. No service in the catalog defaults to any of them, so the target never already holds
  the one named and `nc -l` on it is never refused as in use; a test fails if a service ever
  takes one.
- **The target ships without netcat.** A root there runs `apt install netcat` first, as a root on
  a gpg key box runs `apt install gpg`. `nc -l` is root-only, so every listener is a root's, and
  writes `/var/run/nc-<port>.pid` through the journal as on any box; the write gate fences only
  the files the server lays on a contract box.
- **The terms**: `<Client> — plant a backdoor on a build server — §<pay>`, and `plant a backdoor
on an internal …` on two-hop, at the key job's pay (500–2,000 single-hop, 2,000–4,000 two-hop,
  to the nearest 50). The target company is drawn as a key job's is.
- **The briefing** names the machine and the port, never the box, its address, a path, `nc` or
  netcat:

  ```text
  We want a way into their build server that stays open.
  Leave a listener on it, on port 31337.

  Write to this address with your wallet address while it is listening.
  No listener, no money. No wallet, no money.
  ```

  On two-hop it adds "It is a machine inside their network, not on the edge."

- **Any mail from the contractor reads the target** through the same `readTargetBox` a tamper or
  sabotage job uses, and asks `listenerOn` whether a listener holds the port named. The mail's
  words do not matter; only its wallet does. Anyone's listener counts, as anyone's brick counts on
  a sabotage job. The first row that fits answers:

  | The mail                                    | The reply                                                     | What changes              |
  | ------------------------------------------- | ------------------------------------------------------------- | ------------------------- |
  | No accepted job with this client            | "We have no contract with you."                               | nothing                   |
  | A completed job                             | "That job is already closed." (the target is not read)        | nothing                   |
  | A listener on the port named, with a wallet | "We're in. §1,450 sent to jsc…. Pleasure doing business."     | completed, the pay minted |
  | A listener on the port named, no wallet     | "We're in. You sent no wallet, so there is nothing to pay. …" | completed, nothing minted |
  | Anything else                               | "Nothing is listening on port 31337. No listener, no money."  | nothing                   |
  | The read itself fails                       | nothing: 500, as any store failure                            | nothing                   |

  "Anything else" is one reply for no listener, a listener on another port, and a target that no
  longer boots; it never says which. A bricked target loses the job for good, and a listener left
  on a two-hop job's front box is not on the target.

- `hireme.ts show` prints `Kind: backdoor, <machine>` and `Port: <n>`, calls the slot the target
  (`Target box:` on two-hop), and prints no storage, key path or key.

## Infiltrate jobs

The sixth kind of contract (v0.465.0), the reverse of a file job: the client mails the contractor
a file with the briefing and wants it put at a path on one of the target's machines, in place of
the company's own, and reads that machine for it when the contractor mails in. `mission-kind-<n>`
is split in sixths: each of the five older kinds gave up a thirtieth at the top of one of its
pieces, and infiltrate jobs fill those five gaps, so a number is the kind it was, with its shape,
terms and LAN exactly, or has become an infiltrate job. None turned from one older kind into
another. In sixtieths (`KIND_CUTS`, `core/missions/missionShape.ts`):

| Draw (×1⁄60) | Kind       |
| ------------ | ---------- |
| 0 to 10      | tamper     |
| 10 to 12     | infiltrate |
| 12 to 15     | backdoor   |
| 15 to 20     | file       |
| 20 to 30     | sabotage   |
| 30 to 32     | infiltrate |
| 32 to 35     | backdoor   |
| 35 to 40     | file       |
| 40 to 42     | infiltrate |
| 42 to 45     | backdoor   |
| 45 to 55     | key        |
| 55 to 57     | infiltrate |
| 57 to 58     | backdoor   |
| 58 to 60     | infiltrate |

- **The target is the file job's:** the key box's slot (same octet, route, decoys and front box;
  the inside box on two-hop), hostname `<stem>-files`, no storage and no service of its own, so a
  scan never tells a file job from an infiltrate job.
- **The item is one of seven** (v0.466.0; only the firmware image at v0.465.0), drawn one in
  seven on `mission-file-item-<n>`: the six a file job asks for, each with its file-job name,
  directory and format (`mission-file-<n>`), and a boot script, which only an infiltrate job asks
  for (a file job still draws one in six, so no file job's item moved). Each item carries four
  infiltrate pitches beside its file-job ones (`infiltratePitches`,
  `core/missions/missionFileItem.ts`), 28 in all, shared with no other pitch.

  | Item        | Keepers | Name                                         | Directory                          | What it is                                                                                  |
  | ----------- | ------- | -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
  | boot script | admins  | a housekeeping service (`backup-sync`, …, 6) | `/etc/init.d/`, `/etc/rc.d/init.d/` | a SysV init script: `#!/bin/sh`, the `INIT INFO` block, the service's housekeeping at start |

  The boot script is the virus a client wants among the scripts the company's servers run when
  they start: the company's copy runs its housekeeping, and the client's is the same script with
  one line more in `start)`, `<program> --token <16 hex> &`, the program's path and the token drawn
  from the secret's stream (`plant` beside `render` on the drawn file; every other item's client
  copy is the same renderer on another stream). It is story only: the game runs no script at
  boot, and the client checks the bytes as for every other item. No box carries `/etc/init.d`, so
  the lay-in makes the directory, as it makes `/opt/firmware`.
- **Two files, one path.** The server lays the company's genuine image at the path, root-only
  (`ROOT_FILE`), from an HMAC of `file:<n>` (`missionFileContent`), exactly as it lays a file
  job's (`holdsFile`, `core/missions/missionLeak.ts`), and the path is in `missionFilePaths`, so
  only root may write it. The client's file (`missionPlantContent`) is the same item rendered from
  an HMAC of `infiltrate:<n>`: the same name and place, opening the same way (a header, a jpeg's
  Exif, a pdf's Info, a boot script's lines before its housekeeping), never the same bytes, and under the
  8,000 characters an attachment may be. A root's write over the path goes through the journal, so
  it is what every later read sees.
- **The briefing carries the client's file.** `ContractMail` has an optional `attachment`, and an
  infiltrate briefing's is `{missionFileName(n), missionPlantContent(n, secret)}`, so `mail save`
  gives the right file under the right name. The board's accept door takes the mission secret
  (`missionSecret` on `ResolveHttpFetchDeps`, read from `MISSION_KEY_SECRET` in `api/network.ts`);
  with it unset an infiltrate accept answers 500 `board_failed` before the store is asked, so no
  job is taken without its file, and every other kind's accept is unchanged.
  `hireme_accept` (`20261116000000_hireme_accept_attachment.sql`) takes the file as two more
  arguments, an empty name for none, as `email_send` does. The client sends the file once: a
  contractor who loses it can drop the contract.
- **The terms**: `<Client> — infiltrate a <item> — §<pay>`, and `infiltrate an internal <item>`
  on two-hop, at the key job's pay (500–2,000 single-hop, 2,000–4,000 two-hop, to
  the nearest 50). The target company is drawn as a key job's is.
- **The briefing** names the whole path, never the box or its address:

  ```text
  Their engineers keep a firmware image. We want ours in its place.
  Put the attached file at:

    /opt/firmware/hmi-fw-1.2.7.bin

  Write to this address with your wallet address once it is there.
  No file in place, no money. No wallet, no money.
  ```

  On two-hop it adds "The path is on a machine inside their network, not on the edge."

- **Any mail from the contractor reads the target** through the same `readTargetBox` a tamper,
  sabotage or backdoor job uses (`checkPlanted`, `core/missions/clientMail.ts`), and compares
  what root reads at the path with the client's file. The mail's words and any attachment do not
  matter; only its wallet does. Anyone's placing counts. The first row that fits answers:

  | The mail                            | The reply                                                                             | What changes              |
  | ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
  | No accepted job with this client    | "We have no contract with you."                                                       | nothing                   |
  | A completed job                     | "That job is already closed." (the target is not read)                                | nothing                   |
  | Its file at the path, with a wallet | "It's in place. §1,450 sent to jsc…. Pleasure doing business."                        | completed, the pay minted |
  | Its file at the path, no wallet     | "It's in place. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
  | Anything else                       | "Our file is not at /opt/firmware/hmi-fw-1.2.7.bin. No file in place, no money."      | nothing                   |
  | The read itself fails               | nothing: 500, as any store failure                                                    | nothing                   |

  "Anything else" is one reply for nothing at the path, the company's file still there, a file
  one character off (a newline `nano` added is one), and a target that no longer boots; it never
  says which. A bricked target loses the job for good, and a file put on a two-hop job's front box
  is not on the target.

- **No new tool carries the file.** `scp` ships on every box and writes through the gate an `ssh`
  session's write does, so the target's root password is enough: `scp <file>
  root@<target>:<path>`, through the front box on two-hop.
- `hireme.ts show` prints `Kind: infiltrate, <item>` and `File: <path>, theirs <n> bytes, ours <m>
  bytes`, calls the slot the target (`Target box:` on two-hop), and prints no storage, key path or
  key.

## Portforward jobs

The seventh kind of contract (v0.467.0): a client wants to reach one of the target's machines
from outside, and asks for the target's router to send a public port the briefing names to it.
Nobody roots the machine. The contractor roots the router and adds the forward to
`/etc/iptables/rules.v4`, and the client reads the router when the contractor mails in.
Since v0.474.0 each kind is an eleventh ([Four black-hat kinds](#four-black-hat-kinds)); the
table below is the split portforward jobs made.
`mission-kind-<n>` is split in sevenths: each of the six older kinds gave up a forty-second at
the top of one of its pieces, and portforward jobs fill those six gaps, so a number is the kind
it was, with its shape, terms and LAN exactly, or has become a portforward job. None turned from
one older kind into another. In 420ths (`KIND_CUTS`, `core/missions/missionShape.ts`):

| Draw (×1⁄420) | Kind        |
| ------------- | ----------- |
| 0 to 60       | tamper      |
| 60 to 70      | portforward |
| 70 to 84      | infiltrate  |
| 84 to 95      | backdoor    |
| 95 to 105     | portforward |
| 105 to 140    | file        |
| 140 to 200    | sabotage    |
| 200 to 210    | portforward |
| 210 to 224    | infiltrate  |
| 224 to 245    | backdoor    |
| 245 to 270    | file        |
| 270 to 280    | portforward |
| 280 to 294    | infiltrate  |
| 294 to 315    | backdoor    |
| 315 to 375    | key         |
| 375 to 385    | portforward |
| 385 to 399    | infiltrate  |
| 399 to 406    | backdoor    |
| 406 to 410    | infiltrate  |
| 410 to 420    | portforward |

- **Single-hop only.** A portforward number never draws a front box: the machine sits behind the
  router itself, so no front box stands between them.
- **One stream, `mission-portforward-<n>`, draws the machine and then the public port**
  (`portforwardJob`, `core/missions/portforwardJob.ts`). The machine is one of four, each running
  one service on its usual port and named for it (`keyBoxSuffix`):

  | Machine            | Host        | Service | Inside port | Public port  |
  | ------------------ | ----------- | ------- | ----------- | ------------ |
  | customer database  | `-db`       | mysql   | 3306        | 13306        |
  | cache server       | `-cache`    | redis   | 6379        | 16379        |
  | staff intranet     | `-intranet` | web     | 80          | 8080 or 8443 |
  | development server | `-dev`      | ssh     | 22          | 2022 or 8022 |

  Each machine brings three pitches of its own, twelve in all, shared with no other pitch.

- **The router is the way in, on one of two routes drawn half and half** (`routerRoute`, on
  `mission-router-<n>`; since v0.468.0):
  - **hydra**: its admin is a crackable word (`gatewayAdminHash` from `crackableHash`), so
    `hydra` over the router's own `:22` finds it, and `ssh` lands root on the router. Its
    firmware is pinned safe, on whichever vendor the router builder draws.
  - **msfconsole**: its admin is shut, and it runs one of the four vendors with a firmware
    release published by `MISSION_ROUTE_DAY` whose hole is `critical` or `high` and lands a full
    shell. The vendor is drawn on the same stream (`routerVendor`) and handed to the router
    builder, where it wins over the builder's own draw. The firmware is pinned to that vendor's
    newest such release:

    | Vendor   | Release | Severity |
    | -------- | ------- | -------- |
    | cisco    | 17.0.5  | high     |
    | openwrt  | 24.4.1  | high     |
    | pfsense  | 3.0.3   | high     |
    | ubiquiti | 3.3.0   | critical |

    mikrotik's critical release writes a file and ddwrt's read a file or open a port, so neither
    is a route vendor. Firmware answers to no port, so a scan shows the same safe `:22` on both
    routes. `msfconsole <address> 22` fires at sshd, and the firmware's higher severity answers
    over sshd's low or medium hole (`higherSeverityOutcome`), landing root. A test walks the four
    vendors' timelines and fails if one loses its release.

  Every other package on the router sits on a low or medium release, and every other kind's
  router admin stays shut.

- **A router's own sshd can root it too, and that is accepted.** A router holds only root, so
  whatever tier sshd's safe hole grants lands on root. About one portforward router in three falls
  to `msfconsole <address> 22` through sshd itself, by a password reset, a listener or a script,
  as any router in the world does. It only adds a way in: the drawn route stays open, and a
  listener opens on a port no job names (4444, 31337, 8888, 1337, 9999, 5555, 6666 or 1234), so
  it never takes the public port from the forward.
- **The target is sealed.** It sits in the key box's slot with no route (`MissionBox.route` is
  `null`), and its own draws are on `mission-portforward-target-<n>`, so no older draw moved. Its
  `root` is shut; a customer database's accounts are shut; a cache server lays
  `/var/lib/redis/data.json` with a shut `requirepass` (`MissionBox.storeHash`) and keys behind
  it. It carries no storage and no mission files. Its service runs a safe release, beside sshd and
  three or four decoys, never one of the service's own kind. So the router forwards only decoys as
  it generates: the public port named is never one the router serves.
- **The terms**: `<Client> — open a way into a customer database — §<pay>`, at the single-hop
  key job's pay (500–2,000, to the nearest 50). The target company is drawn as a key job's is.
- **The briefing** names the machine, the public port and the machine's port, never the box, its
  address, the rules file, `iptables` or `nano`:

  ```text
  We want to reach their customer database from outside.
  Their router should send port 13306 to it, on 3306.

  Write to this address with your wallet address once it is open.
  No way in, no money. No wallet, no money.
  ```

- **Any mail from the contractor reads the router** (`readRouter`, beside `readTargetBox`, in
  `core/missions/clientMail.ts`). On the server, `handleResolveMail` replays the router's journal
  over its generated tree (`materializeApGatewayFs`) and checks that it still boots (`canBoot`).
  The router's routing decides, not the file's text (`machineServing`): a port the router itself
  answers on reaches the router, whatever a forward says. The mail's words do not matter; only its
  wallet does. Anyone's forward counts. The first row that fits answers:

  | The mail                                 | The reply                                                                | What changes              |
  | ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------- |
  | No accepted job with this client         | "We have no contract with you."                                          | nothing                   |
  | A completed job                          | "That job is already closed." (the router is not read)                   | nothing                   |
  | The port named reaches it, with a wallet | "We're through. §1,450 sent to jsc…. Pleasure doing business."           | completed, the pay minted |
  | The port named reaches it, no wallet     | "We're through. You sent no wallet, so there is nothing to pay. …"       | completed, nothing minted |
  | Anything else                            | "Port 13306 doesn't reach their customer database. No way in, no money." | nothing                   |
  | The read itself fails                    | nothing: 500, as any store failure                                       | nothing                   |

  "Anything else" is one reply for no forward, one to another machine, one to the machine on
  another port, one to the router's own address, and a router that no longer boots; it never says
  which. A bricked router loses the job for good.

- **A public scan shows the forward working.** Once it is written, the port named answers on the
  contract's address as the machine's service (`mysql`, `redis`, `http` or `ssh`), as any live
  forward does.
- `hireme.ts show` prints `Kind: portforward, <machine>, :<public> -> :<inside>` and
  `Router: hydra` or `Router: msfconsole, <vendor> <version>`, calls the slot the target, prints `Route: none (sealed)`, the decoy forwards
  and the services, and no storage, key path or key.

## Four black-hat kinds

Four more kinds shipped one after another, each in its own PR (v0.471.0–v0.475.0, PRs
#785–#789, 2026-11-18 to 2026-11-20): a root login stolen, a file destroyed, a table wiped, and a
chain job that leaves a listener on the edge and then does one of three things to the machine
behind it. Each took its share of `mission-kind-<n>` the way portforward jobs did: every older
kind gave up an equal slice at the top of one or more of its pieces, so a number is the kind it
was, with its shape, terms and LAN exactly, or has become the new kind. None turned from one older
kind into another. Credential jobs made each kind an eighth, destroy jobs a ninth, wipe jobs a
tenth and chain jobs an eleventh. `KIND_CUTS` (`core/missions/missionShape.ts`) now holds 53
pieces in 27,720ths, and every kind's pieces add up to 2,520, one eleventh each.

Credential, destroy and wipe jobs are two-hop on the same `mission-template-<n>` draw as the older
kinds, about one in three. A chain job is always two-hop. On two-hop the target is the inside
box, and the briefing adds "It is a machine inside their network, not on the edge." or the kind's
own form of it ("The file is …", "The records are …").

### Credential jobs

The eighth kind (v0.471.0): a client wants root's password on one of the target's machines.

- **The target is the key box's slot, named for one of the seven machines** sabotage and backdoor
  jobs use (`credentialRole`, on `mission-credential-role-<n>`, `core/missions/targetRoles.ts`),
  its hostname the machine's suffix (`<stem>-backup`, `-nvr`, …). It has no storage. Each machine
  brings three credential pitches of its own.
- **The terms**: `<Client> — steal the root login for a backup server — §<pay>`, `… for an
  internal backup server` on two-hop, at the key job's pay (500–2,000 single-hop, 2,000–4,000
  two-hop, to the nearest 50).
- **The briefing** names the machine and asks for one labelled line:

  ```text
  Bring us the root login for their backup server.
  Put the password on a line of its own, like this:

    password: <the password>

  Reply to this address with that line and your wallet address.
  No login, no money. No wallet, no money.
  ```

- **The proof is a password that works now.** The client reads the first body line outside the
  quote that starts with `password:`, whatever the label's case or the spaces before it, and tests
  what follows, trimmed and case-sensitive: `md5` of it against root's current entry in the
  target's `/etc/passwd` (`opensRoot`, `core/missions/clientMail.ts`). The subject is never read,
  because `mail reply` fills it in. So a password found and a password set with `passwd` from a
  root shell both pay, on every route, and one changed since the job was done does not. One line
  is one guess: a mail cannot try a list of words, and every proof mail counts toward the hourly
  send limit.
- **Every miss gets one reply**: "That login doesn't open their backup server. No login, no
  money." It covers no line, an empty password, a wrong one, the front box's password on two-hop
  (unless it happens to open the target too), and a target that no longer boots. A paid job opens
  "That login works."
- `hireme.ts show` prints `Kind: credential, <machine>` and calls the slot the target.

### Destroy jobs

The ninth kind (v0.472.0): a client wants one of the target's files gone.

- **The file is one of the file job's six items** (`missionFileItem`), laid root-only at the
  item's path on the target, which keeps the hostname `<stem>-files` and has no storage. Each item
  brings four destroy pitches of its own.
- **The terms**: `<Client> — destroy a signed contract — §<pay>`, `destroy an internal …` on
  two-hop, at the key job's pay.
- **The briefing** gives the file's name and never where it sits:

  ```text
  Their lawyers keep a signed contract. We want it gone. Its name is:

    harbour-bid-signed.pdf

  Write to this address with your wallet address once it is gone.
  Not gone, no money. No wallet, no money.
  ```

- **The client reads the target as it stands** and completes the job once the file's path no
  longer holds exactly the bytes the server laid, whether it was deleted, overwritten or moved,
  and whoever did it. The same bytes put back count as still there. A paid job opens "It's gone."
- **Every miss gets one reply**: "We can't confirm that file is gone. Not gone, no money." A
  target that no longer boots cannot be looked at, so it gets the same words, even if the file
  went first, and the job is lost.
- `hireme.ts show` prints `Kind: destroy, <item>` and the file's path and size.

### Wipe jobs

The tenth kind (v0.473.0): a client wants one table of the target's records emptied.

- **The records are a tamper job's** ([Tamper jobs](#tamper-jobs)): one of the eight settings,
  three tables, kept in a database or in CSV files (`recordsStorage`). The target is always the
  setting's main table. Each setting brings three wipe pitches of its own, and the target company
  is `<Stem> <institution>`, as on a tamper job.
- **The terms**: `<Client> — wipe police records — §<pay>`, `wipe internal police records` on
  two-hop, at the tamper job's pay (1,000–2,500 single-hop, 2,500–5,000 two-hop).
- **The briefing describes the data and never names the table** (`WIPE_DESCRIPTIONS`,
  `core/hireme/contracts.ts`), so working out which of the three fits is part of the job. It never
  warns the player off the other two:

  | Setting    | Table      | The briefing asks to wipe                |
  | ---------- | ---------- | ---------------------------------------- |
  | school     | grades     | what each student scored in each subject |
  | police     | warrants   | everyone they want arrested              |
  | payroll    | payroll    | what they pay each of their people       |
  | dmv        | offences   | the points held against each driver      |
  | tournament | scores     | what each player has racked up           |
  | admissions | applicants | everyone waiting on a place              |
  | club       | members    | everyone who belongs to the club         |
  | registry   | vehicles   | who owns which car                       |

  ```text
  Their records hold everyone they want arrested. We want all of it gone.

  Mail this address when it is done, with your wallet address.
  Not wiped, no money. No wallet, no money.
  ```

- **The check** (`recordsWiped`, `core/missions/missionRecords.ts`): the target table must be
  empty and the other two must read exactly as generated, every row and value in order with
  nothing added. Empty is a table with no rows or no table at all, or a CSV that is deleted, zero
  bytes, blank lines or only its header. A CSV with uneven lines may still hold the data, so it is
  not empty; finishing the wipe puts it right. Any other table in the database, such as the mysql
  route's `settings`, is never read. A paid job opens "The records are gone."
- **Every miss gets one reply**: "That's not what we asked for. Not wiped, no money." It covers
  rows left, either table beside it touched, and a target that no longer boots. Wiping the wrong
  table effectively loses the job, because the game's `mysql` has no `INSERT`.
- **Database root stays shut.** A player empties the table with `DELETE` as the application
  account, or edits the files as root. `DROP` is refused to the application account.
- `hireme.ts show` prints `Kind: wipe, <setting>`, the storage and the target table.

### Chain jobs

The eleventh kind (v0.474.0, with the last step's three endings at v0.475.0): two steps on two
boxes, the most work in the game and the highest pay.

- **Always two-hop.** The first step is a listener on the front box, on a port drawn from the
  backdoor job's eight (`chainJob`, on `mission-chain-<n>`, `core/missions/targetRoles.ts`). The
  last step is on the machine behind it.
- **The last step is an even draw** (`chainFinal`, on `mission-chain-final-<n>`,
  `core/missions/missionShape.ts`) between a sabotage job's outage, a destroy job's file gone and a
  wipe job's table emptied. It is on a stream of its own, so drawing it moved no chain job's port,
  pay, client or front box. `keyBoxKind(n)` answers the kind the step borrows, and the inside box
  is built as that kind's target would be: on a takedown it is named for the machine
  (`chainJob(n).role`, one of the seven); on a destroy or a wipe it is `<stem>-files`, laid with the
  destroy job's file or the wipe job's three tables, in a database (which gives it a database
  server) or in CSV files.
- **The terms**: `<Client> — break in and take down an internal backup server — §<pay>`,
  `break in and destroy an internal signed contract`, or `break in and wipe internal police
  records`, at 4,000–7,000 to the nearest 50. A wipe's target company is `<Stem> <institution>`;
  the others draw a trade, and the trade is drawn on every chain job so a wipe moves no pay. Each
  ending brings four pitches of its own.
- **The briefing** names the port and the last step in its own kind's words, and never a host:

  ```text
  This job has two parts. We pay for both or for neither.

  First, leave a listener on the machine on the edge of their network, on port 5555.
  Then get rid of a site photo their surveyors keep. Its name is:

    IMG_20260424_071457.jpg

  The file is on a machine inside their network, not on the edge.
  Write to this address with your wallet address once both are done.
  Both done or no money. No wallet, no money.
  ```

  A takedown reads "Then take their backup server offline. It is a machine inside their network,
  not on the edge."; a wipe reads "Then wipe their records of everyone they want arrested." and
  "The records are on a machine inside their network, not on the edge."
- **The client reads both boxes on every mail** and answers with the first unfinished step, so
  the steps can be done in either order and anyone's counts. It reads the front box first
  (`readFrontBox`, beside `readTargetBox`); a missing listener answers "Nothing is listening on
  port 5555 on the edge. No listener, no money." whatever state the last step is in. That covers
  no listener, one on another port, one on the inside machine, and a bricked front box, which
  loses the job. With the listener in place, the last step is checked by its kind's own rule
  (`stepMiss`, `core/missions/clientMail.ts`, which the sabotage, destroy and wipe jobs use too),
  and an unfinished one gets that kind's miss reply. With both done the job completes and pays
  once: "Both done. §6,100 sent to jsc…. Pleasure doing business."
- `hireme.ts show` prints `Kind: chain, <ending>, <what it asks for>` (`chain, sabotage, backup
  server`, `chain, destroy, site photo`, `chain, wipe, police`) and `Listener: :<port> on the front
  box`, then the file's path, or the storage and table, under the target box.

## Cleanup jobs

The twelfth kind and the first white-hat one (v0.479.0, PR #801, 2026-11-22): an intruder left an
implant on one of the client's customer's machines and a listener it holds open, and the client
pays to have both gone. It is the backdoor job's mirror. Every kind before it has the contractor
break in; on a white-hat job the client lets them in, so the difficulty moves from getting in to
the hunt. Close the door and lock them out followed (below); four more white-hat kinds are
grilled but not yet built (patch it, restore the record, forensics, incident response), each
its own story, in
`plans/white-hat-jobs.md` while the white-hat work is in flight. The rules every white-hat kind
shares are below with cleanup, the first to use them.

- **A twelfth of the draw.** Each of the eleven older kinds gave up a hundred-and-thirty-second
  of `mission-kind-<n>` at the top of its largest piece, the lowest on a tie, so the top of the
  draw stays portforward and no number turned from one older kind into another. `KIND_CUTS` now
  holds 65 pieces in 27,720ths, 2,310 for each kind. Two-hop on the usual `mission-template-<n>`
  draw, about one in three; on two-hop the target is the inside box.
- **The client hands over root** (`cleanupShape`, `core/missions/missionShape.ts`). Every box in
  scope has route `null`, runs nothing but sshd on safe releases besides its decoys, and has root's
  hash drawn on `mission-cleanup-login-<n>` from `WHITE_HAT_HASHES`. The gateway forwards public
  `:2222` to the first box's `:22`: the target, or on two-hop the front box, from which the target
  is reached on its own `:22` at its LAN address. The router's admin is shut. The route draw still
  happens on the shape stream, so no other stream moved.
- **The words are a list of their own**, `WHITE_HAT_PASSWORDS` in `JSHACK_SECRETS`. The build
  bundles only their hashes; the server turns a hash back into its word for the briefing and for
  `show` (`whiteHatWord`, `core/missions/whiteHatLogin.ts`), which answers only for a white-hat
  hash. `parseSecrets` refuses a word that is also uncrackable or in a list a player can read, so
  no world box, fixed site, black-hat contract or leak route can draw one, and a handed-over word
  opens white-hat boxes only. Without the list in the env, `encode` refuses to build and a
  cleanup accept fails whole. The logins keep working after the job closes: the network stays
  reachable as every mission network does, and a leaked briefing stays a root door for good.
- **The target is the key box's slot**, named for one of the seven machines on
  `mission-cleanup-<n>` (`cleanupJob`, `core/missions/targetRoles.ts`), with the port drawn after
  it from the backdoor job's eight. No storage. Each machine has a locked service account of its
  own (`recorder`, `backup`, `nagios`, `jenkins`, `flexlm`, `doorctl`, `billing`), laid in the
  target's `/etc/passwd`, and three white-hat pitches.
- **The server lays the intruder's work** (`cleanupFiles`, `core/missions/cleanupPlant.ts`),
  drawn from the number under `MISSION_KEY_SECRET`, so nobody can say from the bundle where it is:
  - the implant, one of 24 written for the machine it suits (three or four per machine, in six
    families: cryptominer, exfiltrator, reverse shell, ransomware, credential harvester, botnet
    agent), root-owned, in one of seven places: `/etc/cron.d`, `/etc/cron.daily`,
    `/etc/cron.hourly`, `/etc/init.d`, `/etc/network/if-up.d`, `/etc/systemd/system` or `/etc`
    beside `rc.local`;
  - in a cron directory, dot-named half the time, so a plain `ls` misses it. Each cron directory
    always holds Debian's stock `.placeholder`, so a dot-file there is never a tell;
  - four of the 24 are compiled. `grep -r` skips a binary and `strings` reads it; the rest are
    text, a unit, a cron line or a SysV script that starts a disguised program with flags naming
    the port and an outside host;
  - two to four ordinary scripts beside it, none naming a classic port;
  - its listener, `/var/run/nc-<port>.pid`, under the machine's service account, so `ps` shows
    `nc` on the port with a real PID and `kill` stops it.

  The outside host is a public address no network holds, outside the 195 block and every address
  the world assigns, so it answers nothing. Every implant is story, never working code: the game
  runs nothing at boot, and the client checks only bytes and the listener. `cleanupFilePaths`
  lists every laid path for the write gate (`api/patches.ts`); without the secret it lists none,
  so a root's `rm` there fails closed as the read doors do.
- **The terms**: `<Client> — clean up a build server — §<pay>`, `clean up an internal …` on
  two-hop. White-hat work pays about three fifths of breaking in: 300–1,200 single-hop and
  1,200–2,400 two-hop, to the nearest 50. The same ten clients post it as a middleman for the
  target company ("Our customer is Meridian Records."), so their doors and handles are unchanged.
- **The briefing names the symptom and hands over the login**, never a path, a tool or the
  implant's family:

  ```text
  Our customer is Meridian Records. Their network is at 195.85.65.53.
  Something on their build server answers on port 1337, and nobody there put it there.
  Find what runs it, stop it, and get it off the machine.
  They have given you root:
    ssh root@195.85.65.53 -p 2222
    password: <word>
  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is gone.
  Still there, no money. No wallet, no money.
  ```

  On two-hop the first login is for "the machine on the edge of their network", followed by "The
  billing server is inside their network, at 192.168.70.138. From the edge machine:" and the
  second login, and the warning reads "Leave both machines running. If either no longer boots,
  there is no money."
- **Any mail from the contractor reads the machines in scope** (`readTargetBox`, and
  `readFrontBox` on two-hop). The first row that fits answers, and anyone's `kill` and `rm` count:

  | The mail                                               | The reply                                                                | What changes                   |
  | ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------ |
  | No accepted job with this client                       | "We have no contract with you."                                          | nothing                        |
  | A completed job                                        | "That job is already closed." (nothing read)                             | nothing                        |
  | A machine in scope no longer boots (the front box too) | "You took our machine down. No money."                                   | nothing; the job can never pay |
  | Any listener on the port                               | "Something still answers on port 1337. Still there, no money."           | nothing                        |
  | The implant's path still holds the laid bytes          | "It has stopped, but it is still on the machine. Still there, no money." | nothing                        |
  | Both gone, with a wallet                               | "It's gone. §300 sent to jsc…. Thank you for the help."                  | completed, the pay minted      |
  | Both gone, no wallet                                   | "It's gone. You sent no wallet, so there is nothing to pay. …"           | completed, nothing minted      |

  The boot check comes first and is shared by every white-hat kind: help that broke what it was
  meant to mend is never paid, and since a brick is permanent the job stays open until dropped,
  as a bricked black-hat target's does. "Gone" is the destroy job's rule, so deleting, overwriting
  and `mv` all count. Any listener on the port is a miss, since the client only knows the port
  answers: a fresh `nc -l` there after the laid one is killed keeps the job unpaid. A killed
  listener stays dead whether or not the implant is still there.
- `hireme.ts show` prints `Kind: cleanup, <machine>`, `Port: <n>`, `Implant: <path>, <family>`
  (`, binary` on a compiled one), the decoys' paths, and each box's `Login: root / <word>` with its
  route as `none (handed over)`.

## Close-the-door jobs

The thirteenth kind and the second white-hat one (v0.480.0, PR #802, 2026-11-23): someone laid a
forward on the router of one of the client's customers, so one of its machines answers from
outside, and the client pays to have that way in shut while every other forward stays. It is the
portforward job's mirror, on the rules cleanup set: root handed over in the briefing, the same
clients posting as a middleman, white-hat pay, and no money for a machine that no longer boots.

- **A thirteenth of the draw.** Each of the twelve older kinds gave up a hundred-and-fifty-sixth
  of `mission-kind-<n>` at the top of its largest piece, the lowest on a tie, as cleanup's split
  did, so no number turned from one older kind into another. 27,720ths do not split into
  thirteenths, so `KIND_CUTS` moved to 360,360ths, every older cut times 13, 27,720 for each
  kind. Always single-hop: the door is on the router, so `drawTopology` never gives one a front
  box, as for portforward jobs.
- **The job** (`closeDoorJob`, `core/missions/closeDoorJob.ts`, on `mission-closedoor-<n>`): one
  of the portforward job's four machines, then a public port from its list. The two kinds read
  one table (`EXPOSABLE_MACHINES` in `portforwardJob.ts`), so a machine looks and answers the same
  whether a client wants a way into it or one shut:

  | Machine            | Service | Public port  | Inside port |
  | ------------------ | ------- | ------------ | ----------- |
  | customer database  | mysql   | 13306        | 3306        |
  | cache server       | redis   | 16379        | 6379        |
  | staff intranet     | web     | 8080 or 8443 | 80          |
  | development server | ssh     | 2022 or 8022 | 22          |

  Each machine has three close-the-door pitches of its own, in the client's voice as a middleman.

- **The shape** (`closeDoorShape`, `missionShape.ts`). The target sits sealed in the key box's
  slot as on a portforward job, its service on a safe release and its decoys never of its kind (a
  cache server has none). The router's root hash is drawn from `WHITE_HAT_HASHES` on
  `mission-closedoor-login-<n>`. Its `routerRoute` and `routerVendor` are `null` and its firmware
  stays on safe versions, so the handed-over word is the only way on. Its forwards are the
  decoys' onto the target plus the rogue one, `:<public>` to the machine's inside port, three or
  four lines in all. The rogue line's place among them is drawn on `mission-closedoor-place-<n>`:
  a mission router writes its real forwards first, so a rogue line laid as one would always top
  `rules.v4`.
- **The terms**: `<Client> — close a way into a <machine> — §<pay>`, 300–1,200 to the nearest
  50, the single-hop white-hat pay.
- **The briefing names the machine and hands over the router's login**, never the port, the rules
  file or a tool, since which forward reaches the machine is the job:

  ```text
  Our customer's development server takes logins from outside, and nobody there set that up.

  Our customer is Meridian Logistics. Their network is at 195.108.91.238.

  Someone opened a way into their development server from outside, and nobody there did it.
  Shut it. Leave the rest of what their router forwards as it is.

  They have given you root on their router:

    ssh root@195.108.91.238
    password: <word>

  Leave the router running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is shut.
  Still open, no money. No wallet, no money.
  ```

- **Any mail from the contractor reads the router** (`readRouter`, then `closeDoorMiss` in
  `core/missions/clientMail.ts`). The router's own routing decides, through `machineServing` as on
  a portforward job. The first row that fits answers, and anyone's edit counts, since the word is
  in every briefing of the job:

  | The mail                                                     | The reply                                                                                 | What changes                   |
  | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------ |
  | No accepted job with this client                             | "We have no contract with you."                                                           | nothing                        |
  | A completed job                                              | "That job is already closed." (nothing read)                                              | nothing                        |
  | The router no longer boots                                   | "You took our machine down. No money."                                                    | nothing; the job can never pay |
  | Any forward in the rules still reaches the machine's service | "Their development server still answers from outside. Still open, no money."              | nothing                        |
  | A forward the customer keeps no longer reaches where it did  | "That's not all you closed. Something they use no longer answers from outside. No money." | nothing                        |
  | Shut, with a wallet                                          | "It's shut. §950 sent to jsc…. Thank you for the help."                                   | completed, the pay minted      |
  | Shut, no wallet                                              | "It's shut. You sent no wallet, so there is nothing to pay. No wallet, no money."         | completed, nothing minted      |

  "Still open" asks of every forward in the file, not only the one laid, so a fresh forward onto
  the machine's service from any port is still open. A router `deny` on the port stops no
  forward, so it is still open too. The rogue line removed, pointed at another machine or another
  port, or shadowed by a router listener answering first on its port, shuts it. A kept forward is
  checked against where it reached: removed, re-pointed or shadowed is the collateral miss, and
  put back it pays.

- `hireme.ts show` prints `Kind: closedoor, <machine>, :<public> -> :<inside>`, then
  `Router: none (handed over)` with the router's `Login: root / <word>`, and every forward in
  the order the rules hold them, tagged `(rogue)` or `(keep)`, so the report shows where the
  rogue line sits.

## Lock-them-out jobs

The fourteenth kind and the third white-hat one (v0.481.0, PR #803, 2026-11-23): someone outside
holds root's password on one of the client's customer's machines and has added an account of their
own with it, and the client pays to have them locked out while the customer's own accounts stay as
they are. It is the credential job's mirror, on the rules cleanup set: root handed over in the
briefing, the same clients posting as a middleman, white-hat pay, and no money for a machine that
no longer boots. Its lesson is that a password change is not the whole lockout: uid 0 is root,
whatever the account is called.

- **A fourteenth of the draw.** Each of the thirteen older kinds gave up 1,980 of the 360,360ths of
  `mission-kind-<n>` at the top of its largest piece, the lowest on a tie, as the two splits
  before it did, so no number turned from one older kind into another. Portforward's largest
  piece is the top of the draw, so a draw past the last cut is now a lock-them-out job. Two hops
  on the usual `mission-template-<n>` draw, about one in three.
- **The job** (`lockoutJob`, `core/missions/targetRoles.ts`, on `mission-lockout-<n>`): one of the
  credential job's seven machines (`TARGET_ROLES`), then the added account's name from
  `INTRUDER_ACCOUNTS` (`sysadm`, `toor`, `ntpd`, `syslogd`, `dbus`, `systemd-sync`, `sshd-agent`,
  `netadm`, none of them in a username pool or a service account), then its place among the rows,
  any slot after root's. Each machine has three lock-them-out pitches of its own.
- **The shape** (`handedOverShape`, `missionShape.ts`, shared with cleanup): every box in scope
  gets a root drawn from `WHITE_HAT_HASHES` on `mission-lockout-login-<n>`, the target's first,
  which is the leaked word, route `null`, safe releases, and public `:2222` onto the first box's
  `:22`.
- **The target's rows** (`buildMissionKeyBoxFs`): root, the staff user (uid 1000), `guest` (1001),
  the machine's locked service account (`*`, 999, `nologin`) as on a cleanup target, and the added
  row at its drawn place: `<name>:<root's hash>:0:0:<name>:/var/lib/<name>:/bin/bash`, the
  intruder having reused the word. ssh admits on the first row with the name, so the leaked word
  logs in as root and as the added account, both landing root.
- **The terms**: `<Client> — lock an intruder out of a <machine> — §<pay>`, `… of an internal
  <machine>` on two hops, at the white-hat pay.
- **The briefing says someone outside has root's password and hands over root with it**, never an
  added account, a file or a tool, since finding the second way in is the job. On two hops the
  edge machine's login comes first, then the inside address and the leaked word's login from the
  edge machine:

  ```text
  Our customer's billing server takes root logins from someone outside. They want that door shut.
  Our customer is Corva Holdings. Their network is at 195.105.40.165.
  Someone outside has root's password on their billing server, and nobody there gave it to them.
  Lock them out. Leave their own accounts as they are.
  This is the password they have. The customer has given you root with it:
    ssh root@195.105.40.165 -p 2222
    password: <word>
  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once they are locked out.
  Still open, no money. No wallet, no money.
  ```

- **Any mail from the contractor reads the target's `/etc/passwd`** (`checkLockout`, then
  `lockoutMiss` in `core/missions/clientMail.ts`), and on two hops the edge machine for the boot
  rule. The rows are matched by name against the ones the server laid, and the first row of the
  table that fits answers:

  | The mail                              | The reply                                                                                        | What changes                   |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
  | No accepted job with this client      | "We have no contract with you."                                                                  | nothing                        |
  | A completed job                       | "That job is already closed." (nothing read)                                                     | nothing                        |
  | A machine in scope no longer boots    | "You took our machine down. No money."                                                           | nothing; the job can never pay |
  | Still open                            | "Whoever has that password can still get into their billing server. Still open, no money."      | nothing                        |
  | One of their own rows gone or changed | "That's not all you changed. One of their own accounts no longer works as it did. No money."     | nothing                        |
  | Locked out, with a wallet             | "They're locked out. §450 sent to jsc…. Thank you for the help."                                 | completed, the pay minted      |
  | Locked out, no wallet                 | "They're locked out. You sent no wallet, so there is nothing to pay. No wallet, no money."       | completed, nothing minted      |

  "Still open" is root's hash still the leaked word's or empty (`su` and `passwd` treat an empty
  hash as no password), or any row under a name the customer never had, or a second row under one
  of theirs. So `passwd root` alone, the added account's word changed too, or the account taken
  off uid 0 or renamed each stay open, and so does an account anyone adds. "Gone or changed" is a
  customer's name with no row, or a row that differs from the laid one in any field but root's
  hash, an extra field included; put back as it was, it pays. Row order is free, and anyone's
  change counts, since the word is in every briefing of the job. A way still in answers before an
  account of theirs spoiled, and neither reply says which.

- `hireme.ts show` prints `Kind: lockout, <machine>`, each box's `Login: root / <word>` with its
  route `none (handed over)`, the target's services, and `Accounts:` with the target's rows in
  file order, the added one tagged `(intruder)`.

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
pools. The sabotage kind added its draw and its seven roles. The LAN names the target for its role, so
each role's noun and pitches ride along with its hostname suffix. The file kind added only its
share of the draw: its item, the file's name and place, and its bytes are the server's. Each feature raises the main
chunk's ceiling by its measured growth; at v0.459.0 the chunk is 300,450 B gzipped against a
ceiling of 300,575 B (a tamper setting's content is not in it). The four black-hat kinds added
their shares of the draw, the chain job's port and last step, and the credential pitches beside
each machine's other pitches; at v0.475.0 the chunk is 304,564 B against a ceiling of 304,675 B.
Cleanup jobs added the kind's shape, terms and replies and the white-hat hashes; the implant
catalog is the server's. At v0.479.0 the chunk is 309,469 B against a ceiling of 309,575 B.
Close-the-door jobs added the kind's shape, terms and replies and the router read the client
does, 587 B; at v0.480.0 the chunk is 310,162 B against a ceiling of 310,175 B. Lock-them-out
jobs added the kind's shape and cuts, its machines' pitches, the intruder's names and the accounts
read the client does, 914 B; at v0.481.0 the chunk is 311,076 B against a ceiling of 311,175 B.

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
  paid); `testMissionSabotage.ts` (26: a mail before anything told the machine is still up, root over `:2222` and `rm /boot/vmlinuz` with no reboot
  paid once then closed, a second player's brick paying the contractor, `rm /boot/initrd.img`
  alone paid, a two-hop job's front box bricked: still up, and the target out of reach; and one
  job per machine, `show` naming it and its `-<suffix>` box, root landing there and its brick
  paid); `testMissionFile.ts` (10: `show` naming the item and the file, root over `:2222` reading
  it root-only at its path with the secret's bytes, a mail with no file and one with a newline
  added refused, the file mailed back renamed paid once then closed, and a root's `rm` of it
  sticking); `testMissionInfiltrate.ts` (21: a job accepted through a board's `/accept` whose
  briefing carries the client's file byte for byte, `show` naming the item and the path, a mail
  while the company's file is there and one with a newline added told it is not in place, root
  over `:2222` writing the client's file paid once then closed, a second player's placing paying
  the contractor, the file removed or the target bricked before the mail a miss, and on a two-hop
  job the file put at the same path on the front box a miss; then a boot script, a signed
  contract and a site photo, each accepted through the board, its file carried byte for byte and
  paid once it is at the path); `testMissionPortforward.ts` (19: `show` naming the machine and
  the forward asked for, a scan showing the router's `:22` and the decoys but not the port named,
  a mail before anything told the port doesn't reach the machine, `hydra` over the router's `:22`
  and `ssh` landing root on it, the port named forwarded to the machine on another port and to the
  router's own address each a miss, the right forward answering a scan as the machine's service
  and paid once then closed, a second player's forward paying the contractor, the forward taken
  out or the router bricked before the mail a miss, one job per machine, each reached through
  its forward, and on a msfconsole-route router `show` naming the vendor and release, `hydra`
  finding no admin, `msfconsole` at its `:22` landing root and the forward written as that root
  paid); `testMissionCredential.ts` (14: `show` naming the machine, a mail with no password line
  and one with a wrong password refused, `hydra` and `ssh` landing root on the target, root's
  password paid once then closed, a password set with `passwd` paying and the old one refused, no
  wallet completing with nothing paid, a bricked target refusing the right password, and the
  front box's password refused unless it also opens the target); `testMissionDestroy.ts` (14: the
  briefing naming the file and never its path, `show` naming the item and the path, an untouched
  target refused, the file deleted, overwritten or moved each paying, the same bytes put back
  counting as still there and one byte more not, a second player's delete paying the contractor,
  no wallet, a bricked target refused even with the file gone first, and on two hops the front box
  alone a miss and the file removed from the inside machine paid); `testMissionWipe.ts` (25: the
  briefing naming no table or file, `show` naming the setting, storage and table, an untouched
  table and one with a row left refused, the sweep finding the application account and never
  database root and its `DROP` refused, every row deleted paid once then closed, a table beside it
  emptied refused, no wallet, a bricked box refused, the mysql route's `settings` emptied changing
  nothing, a CSV removed paid, uneven lines refused and the CSV cut to its header then paid, on two
  hops the table emptied over the LAN from the front box paid, and one job in each of the eight
  settings); `testMissionChain.ts` (17: on a takedown ending, `show`, a mail before anything and a
  listener on another port told nothing is listening on the edge, the listener alone told the
  machine is up, the machine bricked over the LAN paid once then closed, the machine down first
  with no listener told so and the listener left after it paid, a listener on the inside machine
  and a bricked front box told nothing is listening; then a destroy ending and a wipe ending kept
  in files, each with the listener in place and the step unfinished given that kind's miss, and the
  file or the CSV removed from the inside machine paid once); `testMissionCleanup.ts` (16:
  accepted through a board's `/accept`, the briefing's word opening root over `:2222` on the
  target and the files laid as `show` names them, a mail before anything told something still
  answers, the listener killed told the implant is still there, both gone paid once then closed,
  a rival's `kill` and `rm` with the leaked word paying the contractor, a listener started again
  a miss, an overwritten implant gone, no wallet completing unpaid, a bricked target and a
  bricked edge machine told they were taken down, and on two hops the inside word from the edge
  machine and the inside machine cleaned paid); `testMissionCloseDoor.ts` (19: four single-hop
  jobs, one per machine, each rogue port scanning as its machine's service; a customer database
  accepted through a board's `/accept`, the briefing and `show` naming the machine and no port,
  a mail before anything told it is still open, the word opening root on the router's `:22`, a
  `deny` and a fresh forward onto the machine each still open, a kept forward taken with the
  rogue one the collateral miss, put back and paid once then closed; a rival with the word
  closing a cache server and the contractor paid; a bricked router told it was taken down; and
  no wallet completing unpaid); `testMissionLockout.ts` (20: a job accepted through a board's
  `/accept`, the briefing naming the machine and no account, file or tool, `show` tagging the
  intruder, a mail before anything told it is still open, the leaked word logging in over
  `:2222` as root and as the added account, both landing root, the added row read at its place,
  `passwd root` through `passwdChange` alone still open, the row removed through a real
  `/etc/passwd` write paid once then closed; the added account's word changed and then taken off
  uid 0 each still open; the row removed before `passwd root` still open, then paid with the rows
  reordered; `guest` removed with the intruder the collateral miss, put back and paid; no wallet
  completing unpaid; a bricked target and a bricked edge machine told they were taken down; and
  on two hops the leaked word from the edge machine and the inside machine locked paid). The
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
- **One browser run at the sabotage close-out** (2026-11-12, v0.459.0), one fresh player on
  THE-REILLYS in Ridgemont. The board was turned over by back-dating; across fourteen boards it
  offered a licence server, a build server, a backup server, a monitoring station, a door-access
  controller and CCTV recorders, on one hop and on two. First a single-hop licence server on the
  hydra route (contract 8428464): the briefing opened "Their whole office runs on software that
  checks in with that box every morning. Make the check fail." and asked "Take their licence
  server offline." A reply sent before anything was done got "Their machine is still up. No
  outage, no money." and the balance stayed 0. `nmap` showed `:2222` beside the `:80` and `:21`
  decoys; root over `:2222` landed on `northgate-lic`, `rm /boot/vmlinuz` left `initrd.img`
  alone in `/boot`, and the next reply paid §900. Then a two-hop CCTV recorder (contract
  10490619), its briefing adding "It is a machine inside their network, not on the edge.": root
  over `:2222` landed on `draycott-web`, `nmap 192.168.177.1-254` there listed `draycott-gw`,
  `draycott-web` and `draycott-nvr`, `ssh root@192.168.177.158` landed on `draycott-nvr`, and
  after `rm /boot/vmlinuz` and two `exit`s the reply paid §3,950, the balance 4,850. Both pays
  matched the terms. No defect. Passwords stayed in a scratch file, never on a read line.
- **One browser run at the black-hat close-out** (2026-11-20, v0.475.0), one fresh player on
  LORIMERS-TEA-ROOM, the board turned over by back-dating until each of the chain job's two new
  endings came up. Each earlier kind had its own run when it shipped. A destroy ending (contract
  11795709, the web route in front, ftp inside): the board read "Ashgrove Capital — break in and
  destroy an internal site photo — §6,100", and the briefing gave port 5555, "Then get rid of a
  site photo their surveyors keep. Its name is:", the file's name and "The file is on a machine
  inside their network, not on the edge." A mail before anything got the listener reply. Root over
  `:2222` landed on `sternco-web`, `nc -l 5555` left `nc-5555.pid` in `/var/run`, and the next
  mail got "We can't confirm that file is gone." A sweep there listed `sternco-files`; `ssh` to it,
  `find / IMG_20260424_071457.jpg` found it root-only under `/srv/media/photos`, and after `rm` and
  two `exit`s the mail paid "Both done. §6,100". A wipe ending kept in a database (contract
  5112806, ftp on both boxes): "Bellwether Group — break in and wipe internal tournament records —
  §5,300", the target company Pellic Esports League, the briefing asking to wipe "what each player
  has racked up". From the front box, `mysql 192.168.152.239 data_admin` listed `scores`, `teams`
  and `matches` beside the box's filler tables; `DROP TABLE scores` was denied to `data_admin`, and
  one row deleted with no listener got the listener reply. With `nc -l 4444` left on `pellic-web`,
  the mail got "That's not what we asked for. Not wiped". `DELETE FROM scores` emptied the other
  35, and the mail paid §5,300, the balance §11,400. On both jobs a later mail got "That job is
  already closed." and no second mint, and `hireme.ts show` read `chain, destroy, site photo` and
  `chain, wipe, tournament`. No defect. Announced on valleynews.io `/dev` (story 24).
- **One browser run at the cleanup close-out** (2026-11-22, v0.479.0), one fresh player on
  LIBRARY-PUBLIC in Oakhurst, the board turned over by a script. A single-hop build server
  (contract 5587253): "Wexley Partners — clean up a build server — §300", the briefing naming
  Meridian Records, port 1337 and the login. A mail before anything got "Something still answers
  on port 1337." Root over `:2222` landed on `meridian-ci`; `ps` showed `nc` on 1337 as
  `jenkins`, `kill` removed it, and `grep -r 1337 /etc` found `runner-health.service` among three
  other units, its `ExecStart` naming a program that is not on the box and an outside host. With
  the unit still there the mail got "It has stopped, but it is still on the machine."; after
  `rm` it paid §300. A two-hop billing server (contract 16209784, §1,350): the briefing gave both
  logins and the inside address; on `sternco-billing`, `nc` on 7777 ran as `billing`, `grep -r
  7777 /etc` found `/etc/cron.d/.invoice-replica`, which a plain `ls` missed and `ls -la` showed
  beside `.placeholder`, and after `kill`, `rm` and two `exit`s the mail paid. A later mail on
  each was told the job is closed, with no second mint. No defect.
- **One browser run at the close-the-door close-out** (2026-11-23, v0.480.0), one fresh player
  on STONEBRIDGE-CAFE, the board turned over by a script, which matched on round 2. A development
  server (contract 7101422): "Redfern Media — close a way into a development server — §950",
  the briefing naming Meridian Logistics, the router's address and its login. A mail before
  anything got "Their development server still answers from outside. Still open, no money."
  `ssh root@<address>` with the word landed on `ap-gw`, whose `rules.v4` held `forward 80`,
  `forward 21` and the rogue `forward 2022` to the machine's `:22`, last of the three. With
  both the `2022` and the `21` lines removed in `nano`, `nmap` from home showed only 22 and 80
  and the mail got "That's not all you closed."; with `forward 21` put back, `nmap` showed 21
  again and the mail paid §950, the wallet reading §950. A later mail was told the job is
  closed, with no second mint. No defect. Announced on valleynews.io `/dev` (story 26).
- **One browser run at the lock-them-out close-out** (2026-11-23, v0.481.0), one fresh player in
  Ridgemont on BARN-CONVERSION, the board turned over by a script, which matched on round 3. A
  billing server (contract 6891685, §450, Copper Systems for Corva Holdings): the briefing gave
  the leaked word as root's login over `:2222` and named no account. A mail before anything got
  "Whoever has that password can still get into their billing server. Still open, no money."
  `ssh root@<address> -p 2222` with the word landed on `corva-billing`, whose `/etc/passwd` held
  root, `admin`, `guest`, `billing` (`*`, 999) and, last, `ntpd` with uid 0 and root's hash.
  `passwd root` alone got the same still-open reply. The leaked word still logged in as `ntpd`,
  at a `#` prompt; from that shell `nano /etc/passwd` lost the `ntpd` row, and the mail paid §450,
  the wallet reading §450. The leaked word was then refused as root, and a later mail was told
  the job is closed, with no second mint. No defect.

## What follows

Deferred, in `backlog.md` under "missions — deferred": believable filler behind real doors and
decoys alike; further templates (deep chains, switches, the gpg passphrase on a third box, the
library route, stealth, deadlines, a harder leak); a lead to the key box on the front box, as a
seventh inside route; recognition for completed jobs; a second, darknet operator; and for tamper
jobs, adding a record, a second copy the client also checks, an audit log to keep clean, a
white-hat fix, and clients and settings of their own. Set aside by the black-hat kinds: a hidden
second copy of a destroyed file the client also wants gone, and chains longer than two steps.
The white-hat kinds still to come are in `plans/white-hat-jobs.md`; set aside from them, in
`backlog.md`, are the script jobs (legacy's `script_fix` and `script_auto`).

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
  tables, and `recordsWiped`, a wipe job's check); `targetRoles.ts` (the seven machines a
  sabotage job can ask down, a backdoor job a way into, a credential job the root login of, a
  cleanup job an implant off or a lock-them-out job an intruder out of: each target's hostname,
  noun and five kinds' pitches, a
  backdoor or chain job's draw of the machine and the port, a lock-them-out job's draw of the
  machine, the intruder's account and its place, and `keyBoxSuffix`); `missionFileItem.ts` (a file or infiltrate job's item and its pitches,
  its file's name and place, and the bytes of the company's file and the client's, server only);
  `portforwardJob.ts` (a portforward job's machine, its public and inside ports, and its
  pitches); `closeDoorJob.ts` (a close-the-door job's machine and its rogue public port, from
  the portforward job's table); `cleanupPlant.ts` (a cleanup target's implant, decoys, listener
  and placeholders, server only) and `whiteHatLogin.ts` (a white-hat hash back to its word,
  server only).
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
