# Plan: X1 — DNS, `nslookup` and `dig`

**Status**: Active — **slice 1 is planned, its acceptance criteria are confirmed, and its branch is
cut**: `feat/x1-a-name-resolves`, from trunk at v0.205.0. Nothing is built yet. This is the first
slice of **Phase 2 — discovery**, and the first door whose world legacy could not hand over.
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
3. **The next action is slice 1's RED 1** on `feat/x1-a-name-resolves`. Its plan and confirmed
   acceptance criteria are below.
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
| 1 | a name resolves | `nslookup web-04` answers, and `ssh root@web-04` lands | 📋 **planned** — ACs confirmed, branch cut |
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

## Slice 1: a name resolves

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

### What planning verified before writing any of this

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

### The decision this plan makes that the grill left open

**An unresolvable name is passed through unchanged, and the existing target path answers.** The
helper resolves or returns its input, so `ssh root@nosuchbox` gives ssh's own `No route to host`
exactly as it does today — no new error surface, no six-way wording decision, and nothing to keep
consistent across six commands. `nslookup` remains the one place a resolution failure is reported
as a resolution failure (`** server can't find <name>: NXDOMAIN`), which is also true of a real
shell. Revisit only if a distinct `Could not resolve hostname` proves worth six messages.

### Acceptance criteria (confirmed)

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

### RED-GREEN increments

1. **RED 1** — `nslookup` is not found before install and found after (`availability.test.ts`'s
   `APT_HINT_PAIRS` gains `['dig','dnsutils']` and `['nslookup','dnsutils']`; the row and the two
   `SYSTEM_UTILITY_NAMES` deletions are GREEN).
2. **RED 2** — a bare hostname on the connected LAN resolves to its address (the resolver function,
   against `generateHomeLan`).
3. **RED 3** — the fully qualified form resolves identically; a foreign slug does not.
4. **RED 4** — an unknown name resolves to nothing, and the gateway/inner-gateway names resolve.
5. **RED 5** — `nslookup`'s rendered block, verbatim to legacy's shape (AC 4).
6. **RED 6** — `NXDOMAIN` output (ACs 6, 7).
7. **RED 7** — the occupant fallback resolves a fellow player, and a failing seam degrades to
   `NXDOMAIN` (AC 9).
8. **RED 8** — offline refusal (AC 10).
9. **RED 9** — `ssh` accepts a name (AC 11), then one RED per remaining command: `curl`, `nmap`,
   `ftp`, `nc`, `scp` (ACs 12, 13).
10. **RED 10** — an unresolvable name falls through to the existing path in at least two of the six
    (AC 14).

**REFACTOR**: assess after each green. The likely candidate is where the resolver lives — a pure
function over `(essid, name)` plus an async occupant step, kept in `core/network/` and called by
both `nslookup` and the six target parses, rather than a seam on `env` that six commands would each
have to be handed.

**PRE-PR MUTATION**: run once for the accumulated scope at PR readiness. Expect survivors on the
rendered strings (conventions §4: *"a command's mutation score is mostly its manual"*) and on the
apt row's metadata (§7: `availability`/`tier`/`description` are documentation — do not write
assertions on them). Treat any non-manual survivor as unproven until a hand run agrees: three of
the last three slices reported a false `perTest` survivor.

**Wire-check**: `N/A` — no `api/` change. Resolution is client-side because generation is
deterministic; the only server touch is the existing `resolveOccupants` seam, unchanged.

**Done when**: all fifteen acceptance criteria pass, the three gates are green, the version is
bumped in both files, the mutation gate is run and its survivors triaged, and a browser run proves
the beat end to end — crack WiFi, connect, `su root`, `apt install dnsutils`, `nslookup` a host
from the scan, then reach it with `ssh` by name having never typed its address.
