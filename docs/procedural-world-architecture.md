# The procedural world (as-built)

Beyond the WiFi a player stands in lies a declared, generated world: a region of eleven towns,
each with its council, police and library, its shops, cafés, offices, homes and places of care,
and a few dozen corporations that stand in no town. Every network answers at an address worked
out from its place in the world, so any of them can be scanned, fetched or looked up from
anywhere, and nothing about the world is stored. A player finds a network by searching findit,
by following a town council's directory, by asking `whois` who holds an address, or by a lead
found on another network's machines.

This is the shipped model of the procedural world epic (#572–#596, v0.284.0–v0.306.0, closed
2026-10-03). The epic's plan file was retired on close-out; this doc holds its design, its
standing rules and the calls worth not re-opening, and its deferred work is in
`conventions-and-gotchas.md` §9 under "Procedural world deferred".

It sits on top of two docs it does not repeat:

- [`world-content-architecture.md`](./world-content-architecture.md): what each kind of place is
  (a business, a home, a corporation, a place of care), how big a network is (its profile), and
  what every generated box holds. Every procedural network obeys its 16 rules unchanged; rule 3
  loosened to let a reference cross to a relation (below).
- [`discovery-architecture.md`](./discovery-architecture.md): the routes between networks
  (findit, the town directory, `whois`, leads, unlisted sites, the head office's road to its
  branches).

Source: `src/core/generation/world.ts` (the declaration, keys, names and addresses),
`relations.ts` (leads), `seededForwards.ts` (forwards), `pools/businessKinds.ts` and
`pools/homeNames.ts` (the name grammars), `generateWifi.ts` (the scan) and
`network/registerNetwork.ts` (the join).

## The shape

The world is **regions → towns → networks**, each level an append-only list.

- **A region** is a name and a first octet. There is one, Harrow Valley (`87`).
- **A town** is a row: a name and a size class (village, town or city). Its index in the region
  is part of every key and address inside it.
- **A network** is drawn from its town's row, or is one of two hand-written kinds: Ridgemont's
  57 **landmarks** (the catalog, `pools/essidCatalog.ts`) and Millbrook's cottage hospital.
- **A corporation** is a head office answering in the placeless `193` block. The twenty landmark
  corporations are declared in Ridgemont, so a scan offers them and they can be joined; the 28
  the world draws stand in no town, and nobody can join one.

The world declares **612 networks**, plus findit, which broadcasts no WiFi and is not declared:

| Town                     | Key                | Size    | Block                      | Networks | Sites (unlisted) | Homes |
| ------------------------ | ------------------ | ------- | -------------------------- | -------- | ---------------- | ----- |
| Ridgemont: the landmarks | the ESSID          | city    | `87.1`, corporations `193` | 57       | 39 (0)           | 6     |
| Ridgemont: drawn         | `r0/t0/n57`–`n177` | city    | `87.1`                     | 121      | 74 (11)          | 44    |
| Millbrook                | `r0/t1`            | village | `87.98`                    | 18       | 11 (2)           | 6     |
| Ashby                    | `r0/t2`            | village | `87.195`                   | 18       | 10 (2)           | 6     |
| Oakhurst                 | `r0/t3`            | town    | `87.38`                    | 47       | 25 (4)           | 20    |
| Kingsford                | `r0/t4`            | city    | `87.135`                   | 166      | 82 (12)          | 80    |
| Fenwick                  | `r0/t5`            | village | `87.232`                   | 15       | 9 (1)            | 5     |
| Thornbury                | `r0/t6`            | village | `87.75`                    | 20       | 10 (2)           | 8     |
| Hollowmere               | `r0/t7`            | village | `87.172`                   | 17       | 11 (2)           | 4     |
| Ely                      | `r0/t8`            | village | `87.15`                    | 16       | 7 (1)            | 8     |
| Wexcombe                 | `r0/t9`            | town    | `87.112`                   | 38       | 24 (4)           | 12    |
| Stonebury                | `r0/t10`           | town    | `87.209`                   | 51       | 27 (4)           | 22    |
| The corporations         | `c0`–`c27`         |         | `193`                      | 28       | 28 (0)           |       |

357 networks publish a site and 45 of them are unlisted. The counts are as of v0.306.0; the
size classes and what each draws are in `world-content-architecture.md`, "The towns".

## The declaration

`DECLARED_NETWORKS` (`world.ts`) is the whole world as one list, built once when the module
loads: Ridgemont's landmarks, Millbrook's networks, the corporations, Millbrook's branches, each
later town of `TOWN_ROWS` with its branches, then the networks Ridgemont draws. Each entry is a
`DeclaredNetwork`: its key and ESSID, category, place, site, town, region, and for a drawn one
its profile, subtype, `unlisted` flag, `parent` (a branch) or `directory` (a council).
`declaredNetwork(key)` looks one up. Anything that must list the world (findit's index, the
reverse address lookup, `whois`, the reachability test, the sweeps) walks this list.

**A town is drawn by one function** (`networksOf`), on streams keyed by the town (`town-*-r0/t3`
and the like, listed in `world-content-architecture.md`, "Seeds and streams"). Its networks come
in a fixed order: the institutions, the businesses, the homes, any institution declared later,
the practices, then the corporations' branches. Each is keyed as the town's next network
(`r0/t3/n0`, `n1`, …) and answers at the town's next address. The towns after Millbrook are one
fold over `TOWN_ROWS`: each draws its names clear of every network declared before it, so
declaring a town moves no earlier network's name, key or address, only the gateways of the
corporations that open a branch there.

**Ridgemont is a city row too** (`RIDGEMONT_ROW`), drawn last, after Stonebury. Its council,
police, library and courthouse are landmarks, so of a city's institutions it keeps only the
hospital (`GENERAL-HOSPITAL`, `ridgemonthospital.org`). Its drawn networks are keyed after the
57 landmarks (`r0/t0/n57` on) and answer after them in its block. **The catalog closes at 57**:
a hand-written Ridgemont network added later is declared after the drawn ones, as Millbrook's
cottage hospital is declared after its homes.

**The landmarks are the exception, and each rule says so.** `isLandmark(key)` marks a network
written by hand. A landmark declares no profile or kind (it keeps the `deep` shape it was
written with), keeps and receives no lead, forwards nothing beyond its site, and its site reads
as written: nothing drawn names its town after a place. Every rule that leaves the landmarks out
asks `isLandmark`, never the town, so Ridgemont's drawn networks are an ordinary town's. AC-7 of
the epic held throughout: every landmark's LAN, content and passwords are pinned by a
fingerprint test, and only its public address moved, once.

### Keys and names

**A network is known by its key everywhere; a player only ever reads the name it broadcasts.**

- A landmark's key is its ESSID (`CITY-HALL-WIFI`). A town's network is `r<region>/t<town>/n<k>`,
  a drawn corporation `c<n>`, and findit `findit.io`.
- Every seed and everything stored takes the key: the LAN (`home-lan-`), the WiFi password
  (`wifi-pw-`), the BSSID, the persona, the occupancy and lease rows, the journal, the scan's
  entries, the association and the remembered connection. Two towns' `TOWN-HALL-WIFI` therefore
  have different passwords, BSSIDs and LANs.
- What a player reads takes the ESSID, through `essidOf(key)`: `airodump-ng`'s rows,
  `aircrack-ng`'s capture line, `nmcli`'s messages, the HUD and the `.lan` zone
  (`lanZoneName`, so `town-hall-wifi.lan`, never `r0-t3-n0.lan`). `nmcli connect` matches what
  was typed against each scan entry's `essidOf`. `whois` prints the ESSID as `netname:`;
  findit, broadcasting nothing, is `FINDIT-IO`.
- A network the world does not declare (a player's lab network, a router's factory name) is
  known by its name: `essidOf` returns it unchanged.

### Names

The rules, enforced by tests over the whole declaration:

- **No domain repeats anywhere, and no ESSID repeats within a town.** A scan shows one town, so
  every town hall broadcasts `TOWN-HALL-WIFI`. Ridgemont's 178 ESSIDs are distinct and none is a
  noise network's.
- **Every ESSID is at most 32 characters**, and so is every name a template _can_ form, not only
  the ones drawn: a branch's ESSID is `<PARENT>-<TOWN>`, and the word lists are chosen so a town
  name of ten letters still fits. A later row or word can fail this test and force a rename at
  authoring time, never in play.
- **No word names two places a town draws** (`world-content-architecture.md`, "The towns").
- **Every kind of place can form 150 names or more**, so no town runs a kind dry.
- **Pools and rows only grow at the end, and freeze at launch.** `pick` maps one draw onto a
  pool's current length, so reshaping a pool renames what was drawn from it. After launch, new
  names go into new pools that only new towns read.

## Addresses

**Every network's public address is its position in the world**, worked out on demand by
`publicAddress(key)`, with `networkAt(address)` the same derivation run backwards. Nothing is
drawn or stored, so two networks cannot collide by construction; a test over the whole world
still checks it.

- **A town's network** answers at `<region octet>.<town octet>.<x>.<y>`. The town octet is
  `(town index × 97 mod 254) + 1`; the last two octets step through the town's block by 24,681,
  a stride sharing no factor with its 64,768 slots, so neighbouring networks land far apart
  and the fourth octet stays 2–254.
- **A placeless network** answers in `193`, by index: findit at 0, the 20 landmark corporations
  at 1–20 in catalog order, the drawn corporations after them (`c<n>` at 21 + n).
- **Ridgemont's landmarks** answer in `87.1` by their catalog position, its drawn networks after
  them.
- **No network answers at a `.1` address**, so a wire-check that needs an address where nobody
  answers uses one (`87.1.0.1`, `193.0.0.1`), true for any world.
- **Only `87` and `193` are public** (`isPublicIp`). A network the world does not declare has no
  address at all: a lab network a wire-check joins is reachable only from its own LAN, and a
  trace names a player standing on one as `unknown`.

The random allocator, its 12 first octets and its `network_public_ips` table were retired by a
`reduce-system-complexity` program (#575, #576); the table was dropped on jshack-dev and
jshack-prod on 2026-09-29.

## Joining

Everybody stands in Ridgemont until travel exists, so only Ridgemont's 178 networks can be
joined. `handleRegisterNetwork` asks the world before it leases anything: a key outside
Ridgemont (another town's, a drawn corporation's) is refused `403 network_not_joinable` and writes
nothing. A key the world does not declare is refused the same way unless the local-only flag
`JSHACK_ADMIT_LAB_NETWORKS=1` is set, which `vercel dev` needs for the wire-checks' lab
networks (`MYSQL-LAB-3`, `LEASE-TEST-NET`, …) and which is set on neither Preview nor
Production. An out-of-town key is refused with or without it. Procedural keys are guessable,
so a modified client is the threat this closes.

The cracked WiFi password itself is still checked only by the client (deferred, §9).

## The scan

`generateWifi` (`wifi-<player key>-<scan index>`; each `airodump-ng` bumps the index) draws:

- **2–3 crackable networks from Ridgemont's 178** (`crackableEssidPool`): the landmarks in the
  catalog's order, then the drawn networks in key order. The scan picks by position, so this
  order decides what every player is offered, and the golden scans in `generateWifi.test.ts`
  pin it.
- **3–5 noise networks**, each failing exactly one `aircrack-ng` gate.
- **Another player's network, rarely.** `airodump-ng` fetches the names everyone currently
  occupies (`resolveOccupiedEssids`, name-only and ungated). Of those, only Ridgemont's that the
  scan does not already show are in range, read in the pool's order so the order the server
  lists them in never changes a scan. With one or more in range the scan rolls once against
  `INJECT_CHANCE` (5%) and on a hit shows one of them; with none it takes no draw at all.

The injector is the only way a stranger stumbles onto another player's network, and it is meant
to be rare. Any one Ridgemont network shows in about 1.4% of base draws, so a network one other
player occupies shows in about 6% of scans: about 16 rescans for two players who mean to meet,
and nothing in 50 rescans about one time in 26. Deleting the injector was rejected: it would
make chance encounters impossible and leave the shared-LAN machinery with no live consumer.
`e2e-shared-network-verification.md` §4 tells a two-player run how to wait for it.

## How every network is reached

A test over the whole declaration (`world.test.ts`) proves every network is one of
these, or is led to from one of these:

- **listed on findit** (every publisher whose site is not unlisted, every corporation);
- **standing in Ridgemont**, so in some scan;
- **an institution on its town's directory** (`/directory.html` on the council's site, which
  links every institution of the town, listed or not; Ridgemont's landmark council keeps none);
- **the target of a lead** from one of the above: an IT contractor's ssh shortcut, an offsite
  backup job, a supplier's invoice (the way to an unlisted business), or a head office's
  shortcut to its branch. Leads are drawn from the target's side (`relations-<key>`), so every
  home and every unlisted business has at least one, and a lead only ever starts on a listed
  publisher of the same town. A branch is reached only from its head office, across towns.

`whois` adds no route of its own but turns any address (a trace, a scan, a forward) into the
network, organisation, town and region behind it. Sweeping public ranges with `nmap` was
rejected: it would make every other route pointless.

A reference in a box's content may cross to another network only along one of its own leads, by
public address or domain and a port that answers there, never by a LAN address: world-content
rule 3, as loosened. Each drawn network's gateway forwards 0–2 services beside its site
(`gw-forwards-<key>`), so a lead has something to point at and an unpublished network shows more
than its gateway's ssh from outside.

## How it is tested

- **Whole-declaration tests** (`world.test.ts`, `relations.test.ts`, `whois.test.ts`,
  `landmarks.test.ts`): distinct addresses, address ↔ key round trips, no `.1`, names and their
  limits, per-town goldens, the branch golden, reachability, rule 3, and every landmark's
  fingerprint.
- **The content sweeps take a fixed sample.** The whole-world content tests
  (`src/test/worldContent.ts`, `ALL_ESSIDS`) read every landmark and uncatalogued key, all of
  Millbrook and the corporations, and from every other town the first network in key order of
  each shape it holds (category, subtype, profile, branch or not, unlisted or not). The sample
  is fixed so a red run reproduces. `WORLD_SWEEP=full` sweeps every declared network, and a PR
  that touches generated content runs it once and records it: it took 1,604 s of file time at
  v0.306.0, against about 880 s sampled.
- **A dump against `main`** proves what a world change moved: every declared network's address,
  persona, forwards, relations, gateways, LAN and deep boxes, and findit's pages, compared key
  by key. A new town expects only itself and the gateways of the corporations branching there.
- **`checkBudgets`** (`npm run build`'s `postbuild`) times the box builds a set at a time (the
  Ridgemont landmarks, each drawn town, the corporations, Ridgemont's drawn networks), best of
  three, under 2 ms a box each, and findit's generated web built from nothing under 1,000 ms
  (542–915 ms at v0.306.0, by how loaded the machine was, so watch it as the world grows). The
  timings run on developer machines only.
- **Wire-checks** against `vercel dev` and local supabase: `testTowns` (every town's council by
  domain, its courthouse and hospital where kept, a site found by "<town> <kind>", `whois`, a
  join refused; Ridgemont's hospital and a drawn shop), `testMillbrook`, `testFindit` and
  `testJoinRefusal` (a drawn Ridgemont network joins; another town's and a drawn corporation's are
  refused).

## Adding to the world

- **A town**: append a row to `TOWN_ROWS` with the next index, a name and a size class. Its
  name must keep every branch ESSID within 32 characters (ten letters fits). Expect its own
  networks and the gateways of the corporations branching there to move, and nothing else;
  prove it with the dump. Add it to `testTowns` and run `WORLD_SWEEP=full` and `checkBudgets`.
- **A region**: append to `REGIONS` with a first octet that is realistic and not `193`, and
  teach `isPublicIp` nothing: it reads `REGION_FIRST_OCTETS`.
- **A hand-written network in a drawn town or in Ridgemont**: declare it after what the town
  already draws, as Millbrook's cottage hospital is (`MILLBROOK_LATER_INSTITUTIONS`). Never
  insert into the catalog or a town's order: every later key and address would move.
- **Words or templates**: append only, and only before launch; the name-space and fit tests say
  whether the lists still hold.
- **A category**: append it to `NETWORK_CATEGORIES` and give every `Record<NetworkCategory, …>`
  pool its entry in the same change, as `healthcare` did.

## Calls worth not re-opening

- **The landmarks stay hand-written** beside the drawn networks, never becoming templates; the
  grammars borrow the catalog's categories and vocabulary, not its entries.
- **Rows are authored, everything inside a town is drawn.** A drawn town name would be renamed
  by any change to its pool, moving every domain and address in it.
- **Addresses are derived, never allocated.** Rejected: keeping the table for lab networks
  (a flag-dependent read in production) and hashing lab networks into a block of their own.
- **A town's IP block, a registry and its pages signal where it is.** Map coordinates and ping
  latency wait for the map epic: nothing could read them yet.
- **The size class is a row's, not drawn from a region's character**: with one region, nothing
  could observe the weighting.
- **A drawn corporation stands in no town and nobody can join one.** A town draws its branches,
  not a corporation its towns, so a town's keys never depend on the corporations. The landmark
  corporations keep no branches, since their content cannot change.
- **The sample is fixed, not rotating**: a rotating sample turns a PR red for what it did not
  cause, and a failure may not reproduce.
- **No go-live clock**: adding a town is already a one-row deploy.
- **No periodic world reset**: it would destroy the persistence that makes damage between
  players mean something.
- **Two routers of one make, hostname and subnet show one status page**, as real ones do; two
  people on one network keeping one note is not accepted, and a desk drops a note a neighbour
  keeps.
- **Ridgemont is a city like Kingsford**, drawn from the city's ranges unchanged. Rejected: a
  denser class of its own to reach the old "150–300", which no player could see.
