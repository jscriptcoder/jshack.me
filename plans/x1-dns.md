# Plan: X1 — DNS, `nslookup` and `dig`

**Status**: Active — **slice 1 has SHIPPED** (v0.206.0, #487). A name is an address everywhere an
address was. Slices 2-4 are grilled but unplanned; **the next action is planning slice 2**, which
is independent of slice 1 and needs no re-grilling. This is the first door of **Phase 2 —
discovery**, and the first whose world legacy could not hand over.
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
3. **The next action is planning slice 2** — a box answers as a name server. Slice 1's as-built is
   below and is the thing to read first: the resolver it left behind is what slice 2 writes a zone
   file against.
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
| 2 | a box answers as a name server | `nmap` finds `53 open`; rooting it and `cat`-ing the zone shows the deep layers | — |
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
