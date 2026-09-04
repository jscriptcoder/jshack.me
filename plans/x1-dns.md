# Plan: X1 — DNS, `nslookup` and `dig`

**Status**: Active — **slice 1 has SHIPPED** (v0.206.0, #487) and **slice 2 is CODE-COMPLETE** on
`feat/x1-a-box-answers`, cut from trunk at v0.206.0. All ten increments are done and green
(4427 tests); **the pre-PR gate is next**. Slices 3-4 are grilled but unplanned. This is the first
door of **Phase 2 — discovery**, and the first whose world legacy could not hand over.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "X1 — resolved scope & decisions
(grill-me, 2026-09-04)", fourteen locked decisions.

## Picking this up cold

1. Read the epic's X1 section — the fourteen decisions, the "Grounding that reshaped the scope",
   the four forced-rather-than-chosen entries and the "Deliberately NOT built" list. **Public
   domains, resolution poisoning, MX/CNAME/TXT and pacing are refused, not deferred.** Do not
   re-grill the door.
2. **Legacy is reference only.** `src/commands/nslookup.ts` and `src/commands/dig.ts` port for
   wording and output shape; `src/generation/filesystem/networkConfig.ts`
   (`generateDnsZoneContent`, `generateDnsNamedConf`) ports for the FILE format. Legacy's
   `resolveDomain`/`dnsRecords` do **not** port — they are mission scaffolding for a mechanic v2
   does not have.
3. **The next action is slice 2's pre-PR gate** — the version bump to 0.207.0, mutation over the
   accumulated scope, and the browser close-out, all specified under "Pre-PR gate" below. Increments
   0-9 are committed on `feat/x1-a-box-answers`; the per-increment record is under "RED-GREEN
   increments — as run". Read slice 1's as-built too — the resolver it left behind is what the zone
   is written against, and its `lanZoneName` is the zone's own origin.
4. Cut a fresh `feat/…` branch per slice off an up-to-date `main` — check `git status -sb` for
   ahead/behind, per conventions §8, which distinguishes ahead from level where
   `git pull --ff-only` does not.
5. All commands run from `v2/`. Gates: `npm run typecheck`, `npm run lint`, the full non-watch test
   suite. Bump the version in `package.json` + `package-lock.json`. Wait for commit approval before
   every commit.

## Goal

A player stops reading addresses. They connect to a network, type the name they saw in a scan, and
it works — everywhere an address works. And on roughly one network in seven they find a box running
BIND whose zone describes the **whole** network, deep layers included: addresses on segments behind
gateways they have never rooted, handed over by one command, with a log line left behind naming
them.

## Read before starting

- Epic §"X1 — resolved scope & decisions" — the fourteen decisions. **Do not re-litigate them.**
- [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2 (no single-letter names,
  no plan/decision tags in code or test titles), §3 (the gates), §4 (the mutation gate, the
  false-survivor rule and the golden-vector rule), §5 (per-player WiFi neighbourhoods — **two
  players never share an ESSID**, which shapes every close-out run), §7 (the `env.fs.reload()`
  rule, the binary gate, and the unenforced-metadata finding).
- `core/generation/generateHomeLan.ts` — `generateHomeLan(essid)` returns `{ subnet, hosts }` with
  `{ ip, hostname, kind }` per host, `.1` first. **That is the gateway resolver's whole data
  source.**
- `core/generation/lanHostIdentity.ts` — the single chain walk to `seedNetworkDepth(essid)`. Slice 2
  reuses it; do not write a second traversal.
- `core/commands/types.ts` — `Command`, `CommandEnv`, `ScanApi` (`resolveOccupants` is slice 1's
  fallback seam), `PublicScanResolution`.
- `core/packages/aptPackages.ts` — `{ name: 'aircrack-ng', binaries: [...] }` is the exact shape
  slice 1's row takes.
- `core/generation/binaries.ts` — `SYSTEM_UTILITY_NAMES`, where `dig` and `nslookup` sit today as
  phantoms and from which slice 1 removes them.

## Slice spine

| # | Slice | Observable | Status |
|---|-------|-----------|--------|
| 1 | a name resolves | `nslookup web-04` answers, and `ssh root@web-04` lands | ✅ **SHIPPED** v0.206.0 (#487) |
| 2 | a box answers as a name server | `nmap` finds `53 open`; rooting it and `cat`-ing the zone shows the deep layers | 🚧 **CODE-COMPLETE** — all ten increments done, pre-PR gate next |
| 3 | the zone transfers | `dig @<server> axfr` hands over the whole address plan | — |
| 4 | the transfer leaves a trace | `named.log` names whoever transferred it | — |

Plan each slice when its predecessor lands. **Slices 1 and 2 are independent** — the resolver needs
no DNS box, the DNS box needs no resolver — so if slice 2 turns out to be the more interesting
review, the order is free to swap. 3 needs 2; 4 needs 3.

**No `api/` change in slices 1-3, so the wire-check is `N/A` for each** (epic §"Forced rather than
chosen": resolution is client-side because generation is deterministic). **Slice 4 is the
exception** and the only `api/` work in the door — one signed fire-and-forget action plus a
`scripts/test*.ts` wire-check, mirroring `nmapScanDeep`.

---

## Slice 1: a name resolves — ✅ SHIPPED (v0.206.0, #487)

All fifteen acceptance criteria met, plus `dig`'s plain lookup, which was pulled forward from slice
3 during the build (see "What changed against the plan"). The **as-built** is at the end of this
section; the plan above it is kept because slices 2-4 build on the same reasoning.

**Value**: Every target in this game is typed as an address. The scan prints `web-04` and the
player types `192.168.188.37` — the name is decoration, and the game says so in its own source:
`network/http.ts:29` calls the host *"an IP address today; a name once DNS lands."* Two of the six
phantom binaries in `/bin` are the tools that would fix it.

This slice makes a name an address. It also, deliberately, needs no DNS box: the AP gateway
resolves its own LAN, which is what a real home router does, so the player gets this on the first
network they crack rather than on the one in seven that happens to draw a `dns` role.

**Path**: `apt install dnsutils` → `/usr/bin/dig` + `/usr/bin/nslookup` stamped world-executable →
`nslookup <name>` resolves through the binary gate → the connected ESSID gives the LAN
(`connectedWlan0` → `generateHomeLan`) → the name is matched against that LAN's hostnames, bare or
fully qualified as `<host>.<essid-slug>.lan` → a miss falls back to `env.scan.resolveOccupants` →
an answer prints legacy's `Server:`/`Address:`/`Non-authoritative answer:` block, a miss prints
`NXDOMAIN`. In parallel, the same resolution runs as one shared step inside `ssh`, `curl`, `nmap`,
`ftp`, `nc` and `scp`, before each command's existing address path.

**Class**: Behaviour change.

**Delivery**: Independent PR against trunk, cut from `main` at v0.205.0 on
`feat/x1-a-name-resolves`. No stack.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness for the accumulated scope.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### What planning verified before any of it was written

- **`APT_PACKAGES` needs no extension.** `{ name: 'aircrack-ng', binaries: [...] }` and
  `{ name: 'snmp', binaries: ['snmpwalk','snmpset','snmpd'] }` already ship several binaries from
  one row; `apt.ts:88` documents the rule. `dnsutils` is one line.
- **Removing the two names from `SYSTEM_UTILITY_NAMES` IS the gating.** The binary gate resolves by
  command NAME across `/bin`, `/usr/bin`, `/usr/sbin`, and the install hint comes from
  `packageForBinary(name)` reading the apt catalog — so `availability` metadata is documentation
  (conventions §7) and the filesystem is the authority.
- **`generateHomeLan(essid)` is the whole resolver data source** — `{ ip, hostname, kind }` per
  host, gateway `.1` first, deterministic from the ESSID. No round-trip, no new generation.
- **`resolveOccupants` already returns what the fallback needs** (`machineName`, `localIp`) and is
  already how `nmap` renders a fellow player as a real host. Additive by design: it degrades to an
  empty list rather than failing, so a server-down case answers NXDOMAIN rather than erroring.
- **Six target parses, not ten contexts.** `ssh` (`parseTarget`), `curl` (`parseUrl` in
  `network/http.ts`), `nmap` (`parseScanTarget`), plus `ftp`, `nc` and `scp`. Legacy threaded
  `resolveDomain` through ten command contexts; this is one helper called six times.

### The decision this plan made that the grill left open

**An unresolvable name is passed through unchanged, and the existing target path answers.** The
helper resolves or returns its input, so `ssh root@nosuchbox` gives ssh's own `No route to host`
exactly as it does today — no new error surface, no six-way wording decision, and nothing to keep
consistent across six commands. `nslookup` remains the one place a resolution failure is reported
as a resolution failure (`** server can't find <name>: NXDOMAIN`), which is also true of a real
shell. Revisit only if a distinct `Could not resolve hostname` proves worth six messages.

### Acceptance criteria — all fifteen met

1. Before installing, `nslookup` and `dig` answer `command not found` with an
   `apt install dnsutils` hint, on the player's box and on every generated machine.
2. `ls /bin` on a fresh box no longer lists `dig` or `nslookup`; `apt install dnsutils` places both
   in `/usr/bin`, world-executable.
3. `apt list` shows `dnsutils` among the installable packages, and `apt list --installed` shows it
   only after installation.
4. Connected to a network, `nslookup <hostname>` prints the resolver block — `Server:` and
   `Address: <gateway>#53`, a blank line, `Non-authoritative answer:`, `Name:` with the fully
   qualified `<host>.<essid-slug>.lan`, and `Address:` with the host's LAN IP.
5. The fully qualified form `nslookup web-04.acme-corp.lan` resolves identically to the bare form.
6. A name qualified with a DIFFERENT network's slug answers `** server can't find <name>:
   NXDOMAIN` — a player resolves the network they are standing on, not the world.
7. An unknown name answers `NXDOMAIN`.
8. The AP gateway resolves by its own seeded hostname, and so does the inner gateway — the boxes a
   player most wants to name are not special cases.
9. A fellow occupant's workstation name resolves to their LAN address, through the occupant
   fallback; with the server unreachable the same lookup answers `NXDOMAIN` rather than failing.
10. Offline, or online with no associated network, `nslookup` refuses in the same voice every other
    network command uses.
11. `ssh root@<hostname>` reaches the same box as `ssh root@<ip>` — same prompt, same tree, same
    authorisation.
12. `curl http://<hostname>` fetches what `curl http://<ip>` fetches, and `curl
    http://<hostname>/path` keeps the path.
13. `nmap <hostname>` scans that host; `ftp`, `nc` and `scp` each accept a name where they accept an
    address.
14. An unresolvable name reaches each command's existing unknown-target path unchanged — `ssh
    root@nosuchbox` answers exactly as it does today.
15. `nslookup` answers instantly — no pacing, no abort seam (epic decision 12).

### RED-GREEN increments — as run

Ten increments, in the planned order. Two deviations, both recorded honestly:

1. **RED 1** — `nslookup`/`dig` not-found before install, found after. `APT_HINT_PAIRS` gained both
   rows, `/bin` lost both names, and `apt.test.ts` gained the two-binary install. GREEN was the
   catalog row plus the two deletions.
2. **RED 2-3** — the resolver: a bare hostname resolves against `generateHomeLan`; the fully
   qualified form resolves identically; a foreign slug does not.
3. **Increment 4 had no RED.** Unknown names answering nothing, and the gateways resolving by their
   own seeded names, both fell out of increments 2-3 already. The tests were written and passed on
   arrival; they pin the behaviour rather than having driven it.
4. **RED 5-6, 8** — `nslookup`'s rendered block, `NXDOMAIN`, the offline refusal, usage, and the
   sync result that is the whole of "instant".
5. **RED 7** — the occupant fallback, and the generated population winning a name tie.
6. **Registration** — proven through the real registry, both directions, mirroring how `gpg` is
   proven: gated with the `apt install dnsutils` hint, reached once `/usr/bin/<tool>` exists.
7. **RED 9-10** — one per command for `ssh`, `curl`, `nmap`, `ftp`, `nc`, `scp`, then the
   fall-through for a name nothing answers to.

**REFACTOR**: the resolver landed where the plan predicted — `core/network/resolveName.ts`, a pure
function plus an async occupant step, called by both commands and by the six target parses. No seam
on `env`. The only change made after green was reading order (the caller moved below what it calls),
and `essidSlug` was left PRIVATE rather than exported for slice 2 — an export nothing outside uses
is a guess about the future.

### As built

**What shipped.** `core/network/resolveName.ts` (`resolveLanName` pure over `generateHomeLan`,
`resolveName` adding the occupant step, `addressForTarget` for the six commands), `nslookup`, `dig`,
a `dnsutils` row in `APT_PACKAGES` carrying both binaries, both names removed from
`SYSTEM_UTILITY_NAMES`, and one resolve step each in `ssh`, `curl`, `nmap`, `ftp`, `nc`, `scp`.

**The open decision resolved as planned**: an unresolvable name is passed through unchanged and the
command's existing unknown-target path answers. Proven live for three of the six — `ssh` keeps
`No route to host` (exit 255, not 1: the test expectation was wrong and the existing behaviour was
right), `curl` keeps `(6) Could not resolve host`, and `nmap` answers with its USAGE line rather
than out-of-range, because an unresolved name is not a target shape it can parse.

**One thing the plan did not anticipate: a guard on whether the target could be a name at all.**
Without it every `ssh <ip>`, `nmap <range>` and `curl http://<ip>/` would pay an occupant round trip
per invocation to learn nothing. The rule is a letter in the string — an address, an octet range and
a CIDR block are digits and separators. `ssh` goes further and resolves against the occupant list it
was already fetching, so a name costs it no request at all.

**What changed against the plan: `dig` shipped here rather than in slice 3.** Building the package
exactly as specified would have installed `/usr/bin/dig` with no command behind it for two slices,
so `dig` answered a flat `command not found` while the binary sat in plain sight. Owner's call, taken
mid-build: ship the plain A lookup now, leaving slice 3 to add only `@<server> axfr`. Its query time
is REPORTED rather than spent, seeded off the name so it is a property of the lookup;
`;; global options: +cmd`, not legacy's `+short`, which contradicted the full output above it.

**The mutation gate found a real defect.** 313 mutants, 264 killed. The occupant fallback matched on
PRESENCE rather than on the name, so any unknown name would have resolved to whichever player
happened to be first on the LAN — a typo would have handed the player somebody else's box. Also
killed on the way: `dig`'s blank separator lines (a `toContain` spot-check agreed with a build that
ran every line together), its zero-padding (the fixture clock had no single-digit fields until it
was moved to `Fri Jan 05 09:07:03`), and the query-time seed.

**Accepted survivors, and why.** 40 are the two commands' `manual`/`description` metadata —
documentation, per conventions §7. 8 sit in `BINARY_STUB` and the `binaryToPackage`/`daemonsOf`
helpers, pre-existing and untouched here. 1 is the `+` in the slug regex, which collapses runs of
non-alphanumerics: **verified unreachable** — 0 of the 90 pool ESSIDs carry two in a row.

**A world-generation wart this door made visible.** Two routers on one LAN can draw the same name
from `ROUTER_HOSTNAMES` — **8 of the 50 crackable networks** — and the lookup answers with the lower
octet. It predates this work (`nmap` already prints both rows under one name) and fixing it means
moving seeded world data, so it was left alone. Worth a decision before the zone file in slice 2
lists the same names twice.

**Wire-check**: `N/A` as planned — no `api/` change; the only server touch is the existing
`resolveOccupants` seam, unchanged.

**Browser run (v0.206.0, SHINRA-5G).** Cracked, connected at `192.168.167.63`, `su root`. Both tools
answered `command not found. Install with: apt install dnsutils` and `ls /bin` listed neither.
After `apt install dnsutils` both stood in `/usr/bin`. `nslookup warehouse-28` →
`192.168.167.28` under `warehouse-28.shinra-5g.lan`; the fully qualified form identical;
`warehouse-28.acme-corp.lan` → NXDOMAIN. `dig` both ways. **`nslookup loot-rig` resolved a real
fellow player's box** at `.164` through the occupant fallback. `ssh root@gw-main` landed on the
gateway — its prompt reading `root@192.168.167.1's password:`, the same as the address form — and
`cat /etc/passwd` there returned the server-served single root line. `nmap gw-main` reported
`Starting Nmap scan — 192.168.167.1`.

---

## Slice 2: a box answers as a name server

**Value**: A player sweeping a network they have just cracked finds one host answering
`53/tcp open domain`. They root it, `cat /etc/bind/zones/db.<slug>.lan`, and read addresses on
segments behind gateways they have never touched — the whole address plan, on a box six networks in
seven do not have. **The payout lands before `dig` exists**: the zone is a file, and a rooted box's
files are already readable.

**Path**: `nmap 192.168.x.1-254` → the dns box's pidfile → `53/tcp open domain` →
`ssh root@ns-12` → `cat /etc/bind/named.conf` (the zone stanza and its `allow-transfer` line, which
slice 3 reads as the gate) → `cat /etc/bind/zones/db.<slug>.lan` → every Layer-1 server and every
deep layer, addresses included. `systemctl stop named` takes the port down and leaves both files
standing.

**Class**: behavior change, preceded by ONE preparatory pure refactor (the import cycle, below).

**Delivery**: independent PR against trunk. Nothing in it depends on slice 1, and slices 3-4 depend
on it.

**Required implementation skills**: `tdd`, `testing`, `refactoring` (increment 0 only);
`mutation-testing` at the PR-readiness gate.

**Reduction program**: `N/A` — no mechanism-reduction claim. The five deleted config templates are
content the generated file replaces, not a mechanism retired.

**Wire-check**: `N/A`. No `api/` change — the zone is generated client-side from the ESSID, like
every other generated file. Slice 4 is the door's only `api/` work.

### What planning verified before any of it was written

Measured by walking all 50 crackable ESSIDs through `generateHomeLan` + the deep chain:

- **6 of 50 networks carry a dns-role box** (Layer 1 or deep) — the epic's "roughly one in seven"
  holds, at 1 in 8.3. The rarity is real without tuning anything. **Re-measured at increment 5: the
  split is 2 Layer-1 and 4 deep-only, which is why increment 8 places the files on both.**
- **A zone runs 5-14 records, mean 9.3.** Long enough to be worth a command, short enough to read.
- **The deep half is mostly IoT.** ACME-CORP's four deep hosts are `doorbell-87` (iot), `smtp-65`
  (mailserver), `tv-137` (iot), `cam-189` (iot). This is the measurement that forced the first
  decision below: read literally, decision 5 would have deleted three of those four.
- **8 of 50 zones would list one name twice** — two Layer-1 routers drawing the same
  `ROUTER_HOSTNAMES` entry, the wart slice 1 found and left. Deep gateways carry an octet suffix and
  never collide.
- **`roleOfHostname` returns `undefined` for routers and switches** (their `kind` already says what
  they are), so the Layer-1 rule is *not a machine, OR a machine whose role is one of the five
  server roles* — never a lookup that expects `router` back from a name.
- **The chain walk is private and eager.** `chainGateways` is not exported, and it builds a base
  filesystem for every gateway as it walks — so a zone generator cannot reuse it, and the epic
  forbids writing a second traversal. An exported, filesystem-free walk is required work.
- **⚠️ The repo already contains an import cycle, and it is fine.** `remoteHostFs → serviceCatalog →
  passwordSweep → upsertPatch → remoteWritePermission → lanHostIdentity → remoteHostFs`, unchanged
  for as long as it has existed. Planning first read this as a cycle the zone generator would
  CREATE, and that was wrong — every call across the loop happens at runtime, nothing evaluates at
  module init, and the suite has never noticed. Do not justify a refactor here by cycle-avoidance.
- **Two catalog-wide invariants already guard this** (`systemctl.test.ts`): every row's daemon must
  exist as a startable unit, and must be obtainable from a package unless it ships in the base
  image. A `dns` row that skipped either fails an existing test rather than shipping broken.
- **Every catalog row's key equals its service label today.** `dns`/`domain` is the first divergence
  and is deliberate — see decision 4.

### Decisions this plan made

Owner's, this session:

1. **The role filter runs on Layer 1 ONLY; every deep layer goes in whole.** Layer 1 is a home LAN
   whose 58% workstation/IoT population sits on DHCP leases no authoritative zone carries. A deep
   layer holds exactly ONE machine, at a fixed address, behind a gateway an admin configured — that
   is infrastructure by construction, whatever the role dice named it, and it is the intelligence
   the transfer exists to hand over.
2. **The generated `/etc/bind/named.conf` REPLACES the pooled `/etc/named.conf`** and its five
   templates are deleted. One authority per fact, the rule decisions 9 and 14 already enforce. Three
   of the five contradicted locked decisions anyway — one enabled query logging that decision 10
   says never happens, two forwarded to public resolvers in a world with no DNS beyond the LAN.
3. **`bind9` declares `dependsOn: ['dnsutils']`.** `binaryToPackage` keeps the LAST row claiming a
   binary, so a `bind9` row claiming `dig` outright would have taken slice 1's install hint on array
   position alone. One new column, consumed the moment it lands, modelling what Debian actually
   does.

Planning's, open to veto at AC confirmation:

4. **Row key `dns`, service label `domain`.** Decision 8 quotes `53/tcp open domain` verbatim, and
   that string is what `nmap` prints. The key stays `dns` because that is the world's own word for
   the role and the hostname prefixes. `hydra <ip> domain` is the consequence, and it is the right
   name for the port.
5. **Placement: flat `0`, with `dns: { domain: 0.9 }` in `rolePlacement`.** A flat rate above zero
   would put name servers on laptops and dissolve the one-in-seven rarity that is the whole balance.
   The 10% of `ns-` boxes not serving are decommissioned ones — and their zone file is still there
   to read, which is the point of the next decision.
6. **The two files are ROLE-driven, not service-driven.** They land on every dns-role box whether or
   not `named` is up — `roleConfigFile`'s own rule, that a config describes what is configured
   rather than what happens to be running. It also means `systemctl stop named` closes the port
   without deleting the intelligence, which is the correct behaviour for a file on disk.
7. **Duplicate names stay in the zone.** Two A records under one name is legal DNS and reads as
   round-robin; a real zone does exactly this. The wart slice 1 flagged turns out to cost nothing
   here, so nothing seeded moves.
8. **`accountsOn: () => []`.** A catalog row makes `hydra <ip> domain` reachable, and BIND has no
   logins to answer it. A sweep that finds nothing is the honest answer, and the empty-accounts
   shape already exists for the door that authenticates a service rather than a person.
9. **Ordering and width port from legacy**: names padded to 15, Layer 1 sorted by octet, then each
   deep layer in chain order. The `10.x` block after the `192.168.x` one is the file's own argument
   — the part a scan could not have told you comes last.
10. **`named` is NOT added to `SYSTEM_DAEMON_NAMES`.** The base image carries `sshd` and `vsftpd`
    because nothing sells them; `named` comes from `bind9`, exactly as `snmpd` comes from `snmp`.
    This closes one of the epic's four open-for-planning items.
11. **`essidSlug` is exported from `resolveName.ts`.** Slice 1 left it private on purpose rather than
    guess at this moment; the zone's origin is that same slug, and a second implementation of it
    would be two spellings of one name.
12. ~~**The banner is `DNS/53 FORMERR`**~~ — **OVERTURNED at increment 1 by a test that already
    existed.** `nc.test.ts`'s "name the protocol and the daemon, never the build" rejects it on
    sight: `DNS/53` wears the shape of `SSH-2.0`, a version-shaped identifier where DNS has no
    version, which is the dating that column forbids in the one syntax that looks most like it
    isn't. The agent row had already settled the case — a door with no greeting to quote names its
    daemon and stops. **The banner is `DNS name server`.**
13. **`generateDeepLayer.ts`'s stale `pubkey` comment is corrected** while the module is open — the
    epic asked for it, and the claim that deep layers are viewer-keyed is exactly the claim this
    slice's one-zone-per-network design depends on being false.

### Acceptance criteria — confirmed by the owner 2026-09-04

**Finding the box**

1. A dns-role host runs `named` on `53/tcp`, and `nmap` reports it as `53/tcp open domain`. 🚧 — the
   open port is tested; the rendered line is assembled but not asserted anywhere (the row omits
   `protocol`, which defaults to `tcp`, and `nmap` prints `service` verbatim). Browser close-out
   owns it.
2. No box of any other role runs it — a `domain` port appears only where the world put a name
   server. ✅
3. `nc <dns-box> 53` answers `DNS name server`. ✅ — **amended at increment 1**: confirmed reading
   `DNS/53 FORMERR`, which decision 12 records `nc.test.ts` rejecting on sight. The criterion is the
   banner, not that string.
4. `systemctl stop named` on a rooted dns box closes 53; `systemctl start named` reopens it. ✅
5. `apt install bind9` on the player's own box installs `named`, plus `dig` and `nslookup` through
   the dependency — and `apt install dnsutils` still installs exactly the two it did in slice 1. ✅

**Reading what it knows**

6. A dns-role box carries `/etc/bind/named.conf` naming exactly one zone, `<essid-slug>.lan`, with
   `file "/etc/bind/zones/db.<essid-slug>.lan"` and an `allow-transfer` line.
7. Roughly three dns boxes in four carry `allow-transfer { any; }`; the rest carry `{ none; }`. The
   draw is ESSID-and-address seeded, so the same box answers the same way on every reload and for
   every occupant.
8. The zone file is a real one: `$ORIGIN`, `$TTL`, an SOA block with all five timers, and an NS
   record naming the box itself.
9. The zone lists every Layer-1 host that is a gateway, an inner gateway or a switch, plus every
   Layer-1 machine whose role is webserver, fileserver, database, mailserver or dns.
10. The zone lists NO Layer-1 workstation and NO Layer-1 IoT host.
11. The zone lists **every** deep-layer host and **every** deep child gateway, down to
    `seedNetworkDepth(essid)`, regardless of role — including the IoT ones.
12. The zone's addresses agree with what a pivot scan of the same layer reports, host for host.
13. A network whose two Layer-1 routers share a hostname lists that name twice, with both addresses.
14. Both files are on the box whether or not `named` is running.

**Standing still**

15. A box of any other role keeps the `/etc` config its role has always kept; only the dns role's
    changes, and no box carries `/etc/named.conf` any more.
16. Every existing world-generation test still passes unchanged — no seeded address, hostname,
    account or password moves. The zone draws on its own PRNG stream or none at all.

### RED-GREEN increments

**Increments 0-2 are DONE** — committed on the branch as `41a14d22` (0) and `0508270b`
(1-2), with the whole suite green at 4398. What each one actually cost is recorded beneath it.

**0. Preparatory refactor, no behaviour change.** Give the zone generator a walk it can use: extract
`lanTopology` (`lanHostOctet`, `isInnerGateway`, `machineIdForLanHost` and a new filesystem-free
`chainLinks`), leaving `lanHostIdentity` to project trees onto it and re-export the two helpers so
no call site moves. Move `buildDeepHostFs` and `FORCE_SSHD_PATCH` into `deepHostFs` so
`generateDeepLayer` holds topology alone. Correct the stale `pubkey` comment in the same pass.
Preservation evidence: the full non-watch suite green before and after. No RED — there is no
behaviour to fail.

1. ✅ **RED — the port.** A dns-role host reports `53/tcp open domain`; a webserver never does.
   GREEN: the `dns` row in `SERVICE_CATALOG`, the `dns: { domain: 0.9 }` cell, flat `placement: 0`.
   Three tests in a new *name-service surface* block in `remoteHostFs.test.ts`.
   - **A worry that turned out not to apply**: a new catalog row does NOT shift the per-host PRNG.
     `hostServices` seeds a stream per service (`svc-<service>-<essid>-<ip>`), so a row can go
     anywhere in the catalog without moving one existing roll — 4392 tests were unmoved by adding a
     door. Position in `SERVICE_CATALOG` is a readability choice, nothing more.
   - **A third failure appeared that the plan did not predict**, and it was right to:
     `nc.test.ts`'s banner golden vector. See decision 12 above — the banner was wrong, and an
     existing invariant caught it.
2. ✅ **RED — the daemon a player can act on.** The two catalog-wide invariants went red exactly
   when the row landed, as predicted; `systemctl stop named` then `start named` on a generated
   `ns-*` box is the behaviour test in front of them, in `generatedBoxDoors.test.ts`. GREEN: the
   `NAMED` daemon spec, its `DAEMONS`/`UNITS` entries, the `bind9` package, and — driven by its own
   RED in `availability.test.ts` — the registry row plus an `APT_HINT_PAIRS` entry.
   - `namedBoxServing(prefix, service)` is new in that file: the existing `boxServing` builds
     `host-<octet>`, a name no role claims, so with a flat placement of zero it can never produce a
     name server to shut.
   - **Found and deliberately not fixed**: `snmpd` is in `DAEMONS` but NOT in the registry, so
     `apt install snmp` lays a binary that answers `command not found`. Backlogged in conventions
     §9; it is not this door's bug.
3. ✅ **RED — the dependency.** Two tests went red: `apt install bind9` laid down only
   `/usr/sbin/named`, and a generated name server carried only `named`. GREEN: the `dependsOn`
   column, `bind9` declaring `['dnsutils']`, and one resolver both callers share.
   - **The union belongs to the catalog, not to `apt`.** The plan named `binariesForService` as the
     site, but `apt install` never went through it — it had its own private `contentsOf`. Rather
     than teach two readers the same rule, `contentsOf` MOVED to `aptPackages.ts` as
     `packageContents`, and both it and `binariesForService` now compose `withDependencies` with
     `binariesLaidDownBy`. What a package contains was always the catalog's question.
   - **Daemon-ness is paired WITHIN a package, not unioned across the install.** The old code took
     one package's `daemons` list; a flat union across several would file a tool in `/usr/sbin`
     the moment any package beside it shipped a daemon of that name. No such collision exists
     today, which is exactly when the guard is free.
   - **The announce line names every package**, `  bind9 dnsutils`, as real apt does. A tool that
     appears on the box with nothing on screen accounting for it reads as the game acting behind
     the player's back — the rule `installExtraFiles` already states for shipped files.
   - **`dependsOn` resolves ONE level.** No catalog row depends on a package that itself depends on
     something; a walk for the chain that does not exist is a walk no test could fail.
   - **A generated name server now carries the clients too**, verified against a real
     `buildRemoteHostFs`: `/usr/bin` gained `dig` and `nslookup` beside `/usr/sbin/named`. It is
     what makes the box look like one somebody ran `apt install bind9` on, and it makes a rooted
     name server a place to resolve FROM.
4. ✅ **RED — the zone's shape.** Six tests against a module that did not exist. GREEN:
   `generation/generateDnsZone.ts` — `formatDnsZone({ zone, nameserver, records })`, the file format
   ported from legacy's `generateDnsZoneContent`.
   - **Decision 11 amended: `lanZoneName(essid)` is exported from `resolveName.ts`, not
     `essidSlug`.** Every caller wants `acme-corp.lan` whole — the origin, the SOA, the NS and the
     `zone "…"` line of the config all name it, and not one of them wants the bare slug. Exporting
     the piece would have invited a second spelling of `.lan` to grow beside the existing one,
     which is the bug decision 11 exists to prevent, arrived at from the other side.
   - **A formatter ONLY.** Which hosts belong in a zone is a question about the network; this
     module is handed records and writes them down. That is what lets increments 5 and 6 apply two
     different selection rules without either relearning zone syntax.
   - **`ZoneRecord` is `{ name, ip }`, deliberately not a `LanHost`.** A zone knows nothing about
     what kind of device answers a name, and the deep-layer records come from elsewhere entirely.
   - **The SOA comment column is derived from the widest timer**, not hand-aligned as legacy's was.
     A drifting comment column is the first thing a reader notices and the last thing anyone meant.
   - Verified by rendering a real one: `$ORIGIN acme-corp.lan.`, the five timers, and a 15-wide name
     column that holds `192.168.42.1` and `10.14.7.87` in the same place.
5. ✅ **RED — what Layer 1 contributes.** Four tests: ACME-CORP's exact record list, the
   keep/drop rule swept over the eight-network population sample, routing gear kept despite naming
   no role, and every address agreeing with the LAN's. GREEN: `zoneRecordsFor(essid)` beside the
   formatter.
   - **ACME-CORP is the case that punishes reading names for roles.** Its `.1` is CALLED
     `switch-core` and is a `router`; its `firewall01` is a `switch`. Routing gear is read off
     `kind`; machines are read off the NAME, which is the rule the whole world already follows.
   - **The role list is an ALLOW-list**, though the seven drawn roles make allow and deny
     equivalent today. A zone is a thing an administrator wrote, so a role nobody has decided
     about belongs outside it until somebody does. The test states the same rule the other way
     round — drop `workstation` and `iot` — so neither is a mirror of the other.
   - **No sort of its own.** `generateHomeLan` already returns hosts by ascending octet, which is
     decision 9's ordering for free; a second sort here would be a second claim about one thing.
   - Rendered live for OSCORP-GUEST, served by `bind-224`: seven records from `192.168.118.1` to
     `.253`, `iphone`/`cam` absent.
6. ✅ **RED — what the deep layers contribute.** Three tests: every host the pivot scan of each
   layer reports is in the zone, ACME-CORP's whole twelve-record address list in order, and the
   cameras dropped on Layer 1 kept down here. GREEN: `deepRecordsFor` over `chainLinks`.
   - **AC 12 is checked against `resolveDeepScanHosts`, the resolver `nmap` renders from** — not
     against a second reading of the generator. That is the difference between proving the zone
     agrees with the scan and merely sharing a seed with it.
   - **REFACTOR: `hostsOnLayer(layer)` moved into `generateDeepLayer`.** The rule "a layer holds its
     machine, plus the child gateway when one hangs" was about to exist in two places — the scan
     had it, and the zone was writing it again. Who stands on a layer is one fact, and a zone
     disagreeing with the scan a player checks it against is worse than a zone naming nothing.
   - **Two of increment 5's tests had to be narrowed**, correctly: they asserted over the WHOLE
     record list when their claim was about the home LAN, so the deep half broke them. Both now
     select the home-LAN slice by subnet, which also stops a deep host that shares a name with a
     dropped one from making an exclusion look satisfied.
   - Rendered live for APERTURE-WIFI, served by the DEEP `dns-29`: four Layer-1 records, then six
     deep ones across four `10.x` prefixes — and the box writes its own name into the SOA and NS of
     a zone for the whole network while standing three hops inside it.
7. ✅ **RED — the config file.** Six tests: one zone stanza, the zone file's path, the query and
   recursion lines, both transfer lines, the rate across a 2024-sample population, and one answer
   per box. GREEN: `formatNamedConf` + `allowsZoneTransfer` + `zoneFilePathFor`, in the same module
   as the zone.
   - **`recursion no`, where legacy's templates varied.** This box is authoritative for one zone
     and there is no DNS in this world beyond the LAN it stands on, so a config advertising
     recursion invites a player to ask it a question nothing can answer. It is also what a real
     authoritative server says, and the pooled template being deleted at increment 8 already had
     it — not a coinage.
   - **Both files in ONE module, because the config names where the zone file goes.** Two modules
     would be two statements of one path, free to disagree.
   - **`/etc/bind/named.conf` and `/etc/bind/zones/db.<zone>`** — Debian's real locations, and they
     keep the two files beside each other instead of two paths a player learns separately.

   ⚠️ **Measured after green, and it affects slice 3's demo more than this slice.** The rate is
   right — 63% open across the 19 name servers in the whole world, 70-80% over the test's 2024-pair
   sample. But the six a player can actually REACH drew badly: only **`GRAD-STUDENT-WIFI`
   (`ns-116`) and `CAMPUS-GUEST-OPEN` (`ns-196`) are open**; `OSCORP-GUEST`, `APERTURE-WIFI`,
   `ROBOVAC-AP` and `DEFCON-VILLAGE` all refuse. That is a 1-in-30 draw, not a bug, and re-seeding
   to get a prettier one would be fitting the world to a wanted result. Two consequences: **slice
   3's transfer demo must use one of those two**, and this slice's close-out on `APERTURE-WIFI`
   exercises the CLOSED branch — which is the right thing for slice 2, whose payout is reading the
   files off a rooted box rather than transferring them.
8. ✅ **RED — placement on BOTH kinds of box.** Five tests: the pair on a Layer-1 name server, the
   pair on a DEEP one, both kept on a box whose daemon is stopped, neither anywhere else with
   `/etc/named.conf` gone, and the config's `file "…"` line resolving to a file the tree really
   holds. GREEN: `nameServerFilesFor` + one role branch in `buildRemoteHostFs`, and the `dns` entry
   deleted from the pool.

   ⚠️ **CORRECTION to increment 5's finding — the deep half needed no second branch.** The
   measurement was right (2 Layer-1, 4 deep-only) and the owner's decision was right, but the
   mechanism I inferred was wrong: **`buildDeepHostFs` is a thin wrapper over `buildRemoteHostFs`**,
   adding only a forced `sshd` pidfile. A deep box's tree has always been built by the same
   function, keyed on `roleOfHostname(host.hostname)`, so a deep `dns-29` already carried the OLD
   pooled `/etc/named.conf`. One branch reaches every name server at any depth; the claim that
   `buildRemoteHostFs` alone would ship the door at 1 in 25 was false. Verified by building both
   boxes and reading `/etc` off each.

   - **The pool's `dns` entry is deleted, and the deletion is enforced by the TYPE.**
     `PooledConfigRole = Exclude<DrawnRole, 'dns'>` — so a caller reaching for a drawn template for
     a name server fails to compile rather than silently getting nothing, or worse getting a second
     file contradicting the generated one. Three of the five templates contradicted locked
     decisions: one logged every query, two forwarded to public resolvers.
   - **The strongest test is the one that reads the path back OUT of the config** and goes looking
     for it in the tree. The config states where the zone lives and the tree decides where it goes;
     that is the one drift a player would meet as a broken box, and now neither side can move alone.
   - **`ROLE_FILES` in the pooled-config block loses its `dns` row**, which is what broke three
     existing tests — correctly. That block is about the drawn pool, and dns has left it.
   - Read off a real deep name server: `/etc` is `['passwd', 'bind']`, and `/etc/bind/named.conf`
     names `/etc/bind/zones/db.aperture-wifi.lan`, which is there and holds all ten records.
9. ✅ **GREEN-on-arrival — the duplicate name.** Three tests: `GRAD-STUDENT-WIFI` listing `router01`
   at both `192.168.112.1` and `.18` in the rendered file; the resolver answering with one of the
   two addresses the zone lists; and a sweep of all fifty crackable networks proving no ADDRESS is
   ever listed twice while eight networks still list a NAME twice. No production change, as planned.

   **A test that arrives passing proves nothing until it is shown to fail**, so the guard was
   demonstrated rather than asserted: deduping `zoneRecordsFor` by name — the obvious "fix" for what
   looks like a bug — breaks two of the three, and **the other twenty tests in the file all still
   pass under it**. Before this increment a name-keyed zone would have shipped silently, dropping an
   address a player can reach and leaving nothing else in the file looking wrong.

   - **Eight of fifty, measured — the planning figure holds.** `INITECH-5G`, `DUNDER-LAN`,
     `ABSTERGO-NET`, `VANDELAY-INDUSTRIES`, `GRAD-STUDENT-WIFI`, `TRAIN-STATION-FREE`,
     `DOORBELL-CAM-OPEN` and `HACKERSPACE-2600`. Seven collide on the gateway at `.1`; only
     `HACKERSPACE-2600` collides between two non-gateway routers.
   - **The address is the identity; the name is not.** 467 records across the pool, not one repeated
     address. That pairing is the claim: a name may appear twice, an address never does — and it is
     what lets one sweep tell a dedupe apart from a double-listing bug.
   - **Two A records under one name is round-robin, not a defect**, which is why the resolver test is
     the third. `resolveLanName` finds by hostname and `generateHomeLan` sorts by ascending octet, so
     the gateway at `.1` wins — one answer out of two listed, exactly what a real resolver gives. The
     `.18` is the address the file is worth crossing a network to read.
   - `GRAD-STUDENT-WIFI` over the other seven because it is also one of the two networks whose name
     server accepts a transfer: slice 3's demo network and this collision are the same network.

### Pre-PR gate

Typecheck, lint, the full non-watch suite, and the version bumped to **0.207.0** in `package.json`
and `package-lock.json`. Mutation testing over the accumulated scope — the zone formatter is
string-shaped, so expect the golden-vector rule to matter and expect `manual`/`description` metadata
survivors, which conventions §7 accepts. Wire-check `N/A`.

**Browser close-out**: crack a network whose dns box is DEEP — `APERTURE-WIFI`, `GRAD-STUDENT-WIFI`,
`CAMPUS-GUEST-OPEN` or `ROBOVAC-AP`. A deep one exercises placement, the chain walk and the pivot
cross-check in a single pass, where a Layer-1 one exercises only the first. Sweep it, find `53/tcp
open domain`, root the box, read both files, check a deep address in the zone against a pivot scan
of that layer, and stop the daemon to prove the port closes and the files stay.
