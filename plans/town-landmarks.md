# Plan: landmarks in every town

**Status**: Grilled and planned 2026-10-23; the 43 landmarks below approved by the owner. Next:
slice 1 on `feat/town-landmarks`.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

Ridgemont has 57 hand-written landmarks, most of them pop-culture parodies (`ACME-CORP`,
`KWIK-E-MART`, `NULL-BYTE`); every other town is drawn entirely from templates. Since v0.428.0 a
player can start in any of the eleven towns, so seven in ten never stand in Ridgemont and never
scan a landmark. Give every other town named corners of its own. This is the backlog item
"Hand-written places for the other towns" (`docs/backlog.md`).

## Where it starts from (facts, 2026-10-23)

- **A landmark** is a catalog row (`pools/essidCatalog.ts`): an ESSID, a category, the place as
  its people name it, and for an institution a site (domain and name). Everything behind it, its
  LAN, machines and passwords, is generated from its key. `isLandmark(key)` (`world.ts`) marks one,
  and every rule that leaves the landmarks out asks it: a landmark declares no drawn profile or
  kind, keeps and receives no lead, forwards nothing beyond its site, and its site reads as
  written.
- **Ridgemont's 57 are keyed by their ESSID** and answer in Ridgemont's block by catalog position;
  its 20 corporate landmarks are head offices answering in the placeless `193` block. 39 of the 57
  publish a site; the other 18 (six homes, four university, four IoT, four hacker spaces) are
  reached only over Ridgemont WiFi.
- **The catalog is closed at 57.** A hand-written network added to a town is declared after what
  the town already draws, as Millbrook's cottage hospital is (`MILLBROOK_LATER_INSTITUTIONS`), so
  no earlier key, name or address moves (`procedural-world-architecture.md`, "Adding to the
  world").
- **A drawn town already holds its institutions**: town hall, police, library, school and the rest
  by size class (`world-content-architecture.md`, "The towns").
- **A town's share of starting players is its share of networks** (`startingTown`), so networks
  added to a town move a few keys into it.

## Decisions (owner-confirmed 2026-10-23)

1. **A new landmark is like Ridgemont's**: a hand-written ESSID, place, category and, where it has
   one, a site; its LAN and machines generated from its key; and every landmark rule applies (no
   drawn profile, its site reads as written).
2. **How many, by size class**: a city 10, a town 5, a village 3. Kingsford 10; Stonebury, Oakhurst
   and Wexcombe 5 each; Millbrook, Ashby, Fenwick, Thornbury, Hollowmere and Ely 3 each: **43**.
   Ridgemont keeps its 57 and gets none.
3. **Flavour: pop-culture, scaled to the place.** Fictional places from film, TV and games, and
   hacker-scene easter eggs, as Ridgemont's are; Kingsford gets parody firms and venues, a village
   a fictional pub, shop or farm. Real brands stay in the noise pool.
4. **Reach: Ridgemont's rule.** No leads in or out. A place that would have a website publishes
   one, so every player reaches it over the internet (findit, mapit, `whois`); a home, a gadget or
   a hacker den publishes none and is reached only by the town's own players, until Travel.
5. **Authoring: Claude drafts all 43 into the slice plan, town by town, checked against the name
   rules** (ESSID at most 32 characters, no ESSID repeated within its town, no domain repeated
   anywhere, no real brand). The owner strikes or renames any before a line of code is written.
6. **The mix: about two-thirds with a site, and no institutions.** A village 2 sited + 1
   locals-only, a town 3 + 2, Kingsford 7 + 3. Sited landmarks are corporate, café or pub, or
   retail; locals-only ones are a home, a gadget (IoT) or a hacker den. No government, public or
   healthcare landmark, since every town already draws those.
7. **Delivery: one slice, one PR**, all ten places at once: one approved list, one declaration
   change, one shift of the town weights.
8. **The bundle ceiling rises by 2,000 B, to 288,975 B** (confirmed after the measurement). The
   43 rows measured +1,205 B gzipped, 494 B over the old ceiling; the rise is rounded as talkit's
   forum's was, and `checkBudgets.ts` says the content allowance grew for the towns' landmarks.

## What follows without a decision

- **Each town's landmarks are declared after everything it already draws**, its branches
  included, and keyed and addressed as its next networks (`r0/t<town>/n<k>`), so no existing key,
  name or address moves. The ESSID is not the key: two towns may both broadcast a name.
- **`isLandmark` covers them**, so every landmark rule applies with no new branch.
- **A sited landmark appears on findit and on its town's mapit page** with nothing written by
  hand; Millbrook's page is pinned line for line in `renderPage.test.ts` and is updated there.
- **The town weights shift**: a town's share of starting players grows with its networks, so a few
  keys draw a different town. Players already on a network stay on it through reloads; the
  accepted price of a world that grows (`procedural-world-architecture.md`, "Where a player
  stands").
- **Unchanged**: Ridgemont's catalog and its 57; every drawn network; the guardian's patrol, which
  walks government and public sites, so it gains none.

## Slices

1. **Every town has landmarks of its own.** One slice (decision 7).

## Slice 1 plan: every town has landmarks of its own

**Branch**: `feat/town-landmarks` · **Version**: 0.428.0 → 0.429.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration, no `api/` change.

**Value.** A player who starts in Kingsford, a town or a village scans, cracks and joins named
corners of their own town (`FSOCIETY`, `THE-WINCHESTER`, `TALKIE-TOASTER`); every player finds the
28 that publish a site on findit, on their town's mapit page and by `whois`.

**Path.** the town's landmark rows (a new pool) → `world.ts` declares them after everything the
town draws, keyed and addressed as its next networks, and `isLandmark` covers them →
`DECLARED_NETWORKS` → `wifiPoolOf(town)` (the scan), `handleRegisterNetwork` (the join), findit's
index, mapit's town page, `whois`, and every rule that asks `isLandmark`.

### The 43 landmarks (owner-approved 2026-10-23)

All 43 pass the name rules, checked by script against the v0.428.0 declaration: every ESSID at
most 32 characters, none repeated within its town or broadcast anywhere else in the world, none a
noise network, and no domain taken. A site's name is in brackets where it differs from the place.

**Kingsford** (city, 7 sited + 3 locals-only)

| ESSID | Kind | Place | Site | From |
|---|---|---|---|---|
| `LUMON-INDUSTRIES` | corporate | Lumon Industries | `lumon.com` | Severance |
| `E-CORP-GUEST` | corporate | E Corp | `e-corp.com` | Mr. Robot |
| `ENCOM-NET` | corporate | ENCOM | `encom.com` | Tron |
| `REYNHOLM-INDUSTRIES` | corporate | Reynholm Industries | `reynholm.com` | The IT Crowd |
| `CENTRAL-PERK` | café | Central Perk | `centralperk.com` | Friends |
| `LOS-POLLOS-HERMANOS` | café | Los Pollos Hermanos | `lospolloshermanos.com` | Breaking Bad |
| `JOJAMART` | retail | JojaMart | `jojamart.com` | Stardew Valley |
| `221B-WIFI` | home | the flat at 221B | | Sherlock |
| `HAL-9000` | gadget | the smart speaker | | 2001: A Space Odyssey |
| `FSOCIETY` | hacker | the old arcade | | Mr. Robot |

**Stonebury** (town, 3 + 2)

| ESSID | Kind | Place | Site | From |
|---|---|---|---|---|
| `WERNHAM-HOGG` | corporate | Wernham Hogg | `wernhamhogg.com` | The Office (UK) |
| `THE-WINCHESTER` | pub | the Winchester | `thewinchesterpub.com` (The Winchester) | Shaun of the Dead |
| `TROTTERS-INDEPENDENT-TRADERS` | retail | Trotters Independent Traders | `trottersindependent.com` | Only Fools and Horses |
| `METEOR-STREET-FLAT` | home | 23 Meteor Street | | Spaced |
| `THE-LONE-GUNMEN` | hacker | the Lone Gunmen's office | | The X-Files |

**Oakhurst** (town, 3 + 2)

| ESSID | Kind | Place | Site | From |
|---|---|---|---|---|
| `SARIF-INDUSTRIES` | corporate | Sarif Industries | `sarifindustries.com` | Deus Ex |
| `DOUBLE-R-DINER` | café | the Double R Diner | `doublerdiner.com` (Double R Diner) | Twin Peaks |
| `NOOKS-CRANNY` | retail | Nook's Cranny | `nookscranny.com` | Animal Crossing |
| `LOG-LADY-CABIN` | home | the Log Lady's cabin | | Twin Peaks |
| `JOHNNY-5-AP` | gadget | the garage | | Short Circuit |

**Wexcombe** (town, 3 + 2)

| ESSID | Kind | Place | Site | From |
|---|---|---|---|---|
| `INGEN-LABS` | corporate | InGen | `ingen.com` | Jurassic Park |
| `LUKES-DINER` | café | Luke's Diner | `lukesdiner.com` | Gilmore Girls |
| `SCOOPS-AHOY` | retail | Scoops Ahoy | `scoopsahoy.com` | Stranger Things |
| `BAG-END` | home | Bag End | | The Lord of the Rings |
| `SETEC-ASTRONOMY` | hacker | the warehouse | | Sneakers |

**The villages** (2 + 1 each)

| Village | ESSID | Kind | Place | Site | From |
|---|---|---|---|---|---|
| Millbrook | `THE-SLAUGHTERED-LAMB` | pub | the Slaughtered Lamb | `slaughteredlamb.com` (The Slaughtered Lamb) | An American Werewolf in London |
| Millbrook | `LOCAL-SHOP-LOCAL-PEOPLE` | retail | the Local Shop | `localshopforlocalpeople.com` (The Local Shop) | The League of Gentlemen |
| Millbrook | `WRONG-TROUSERS` | gadget | the cellar workshop | | Wallace & Gromit |
| Ashby | `THE-WOOLPACK` | pub | the Woolpack | `thewoolpack.com` (The Woolpack) | Emmerdale |
| Ashby | `GREENDALE-POST-OFFICE` | retail | the post office | `greendalepost.com` (Greendale Post Office) | Postman Pat |
| Ashby | `SKELDALE-HOUSE` | home | Skeldale House | | All Creatures Great and Small |
| Fenwick | `THE-GREEN-MAN` | pub | the Green Man | `thegreenmaninn.com` (The Green Man) | The Wicker Man |
| Fenwick | `LON-LON-RANCH` | retail | Lon Lon Ranch | `lonlonranch.com` | Zelda |
| Fenwick | `TALKIE-TOASTER` | gadget | the kitchen | | Red Dwarf |
| Thornbury | `FAWLTY-TOWERS` | café | Fawlty Towers | `fawltytowers.com` | Fawlty Towers |
| Thornbury | `PIERRES-GENERAL-STORE` | retail | Pierre's General Store | `pierresgeneralstore.com` | Stardew Valley |
| Thornbury | `THE-GIBSON` | hacker | the back room | | Hackers |
| Hollowmere | `THE-THREE-BROOMSTICKS` | pub | the Three Broomsticks | `threebroomsticks.com` (The Three Broomsticks) | Harry Potter |
| Hollowmere | `JUPITER-MINING` | corporate | Jupiter Mining Corporation | `jupitermining.com` | Red Dwarf |
| Hollowmere | `THE-BURROW` | home | the Burrow | | Harry Potter |
| Ely | `THE-HORSE-AND-GROOM` | pub | the Horse and Groom | `horseandgroom.com` (The Horse and Groom) | The Hitchhiker's Guide to the Galaxy |
| Ely | `BLACK-BOOKS` | retail | Black Books | `blackbooks.com` | Black Books |
| Ely | `DEEP-THOUGHT` | hacker | the spare room | | The Hitchhiker's Guide to the Galaxy |

A pub is the `cafe` category ("public seating, high foot traffic"); a gadget is `iot`.

### Facts read while planning (2026-10-23)

- **Nothing outside the catalog is keyed by a landmark's ESSID**: only `world.ts` reads the
  catalog. The rules that leave landmarks out are in `relations.ts` (no lead in or out),
  `seededForwards.ts` (no forwards), `webSite.ts` (the site reads as written) and
  `generateHomeLan.ts` (no profile means the `deep` shape).
- **`landmarks.test.ts` pins a fingerprint per landmark** (LAN, WiFi password, gateway and every
  box's files), walking `isLandmark`, so the 43 join it with fingerprints of their own and
  Ridgemont's 57 must not move.
- **Ridgemont's 20 corporate landmarks answer in the placeless `193` block** as head offices
  (`LANDMARK_CORPORATIONS`). A new corporate landmark is a firm in its town, answering in the
  town's block; it must stay out of `LANDMARK_CORPORATIONS`, or every placeless address after
  findit would move.
- **The scan picks by position over the town's pool**, so a town that gains networks offers its
  players different scans; Ridgemont's are untouched. The golden scan for `'a'×64` (a Stonebury
  key) changes, and a pinned Ridgemont key may now draw another town as the other towns grow
  heavier, so its pins may need a new key.
- **Counts pinned elsewhere**: mapit's legend (`mapit.test.ts`, places per town), Millbrook's page
  line for line (`renderPage.test.ts`), the world table in `procedural-world-architecture.md`,
  the counts in `world-content-architecture.md`, and `scripts/testTowns.ts`.

### Choices made while planning (to confirm with the owner)

- **The rows live in a new pool, `pools/townLandmarks.ts`**: one list per town, built with the
  catalog's own `entries` helper (shared, not copied). The catalog stays Ridgemont's 57.
- **`world.ts` appends each town's landmarks after its branches**, keys them `r0/t<town>/n<k>` from
  the town's next index and addresses them from its next address; `LANDMARK_KEYS` takes the
  union, so `isLandmark` keeps its shape.
- **Ridgemont gets no entry**; a later hand-written Ridgemont network would follow its drawn ones,
  as the docs already say.

### Acceptance criteria

1. Each of the ten towns declares exactly its landmarks above, with that ESSID, category, place
   and site, after everything it draws: 10 in Kingsford, 5 in each town, 3 in each village.
2. No network declared before moves: every v0.428.0 key keeps its ESSID, its town and its public
   address.
3. Every landmark rule holds for them: `isLandmark` is true, they draw no profile (the `deep`
   shape), keep and receive no lead, forward nothing beyond their site, and their site reads as
   written.
4. A sited landmark is listed by findit, stands on its town's mapit page, and `whois` on its
   address names its town and region. A siteless one is in none of them.
5. A player who starts in a landmark's town is offered it by the scan and joins it; a player who
   starts elsewhere is refused it `403 network_not_joinable`, as for any other town's network.
6. Every landmark's fingerprint is pinned; Ridgemont's 57 are unchanged.
7. The name rules hold over the whole declaration (the existing whole-declaration tests).
8. `npm run build` passes: the bundle within 288,975 B and every world timing budget.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The towns declare their landmarks**: `world.test.ts` asks for each town's rows in order after
   its branches, keyed and addressed as its next networks, `isLandmark` true, and every earlier
   key's ESSID, town and address unchanged; criteria 1, 2 and 7.
2. **The landmark rules reach them**: no lead (`relations.test.ts`), no forwards, a site as
   written, the `deep` shape, findit, mapit and `whois`; their fingerprints pinned in
   `landmarks.test.ts`; criteria 3, 4 and 6.
3. **A local scans and joins one**: `generateWifi.test.ts` offers a town's landmark to its locals,
   `registerNetwork.test.ts` admits it for them and refuses it to others, and the pinned counts
   and goldens that move are re-pinned on purpose; criterion 5.
4. **Budget, docs and version 0.429.0**: the ceiling and its comment, the world table and counts,
   the backlog item retired, `project-status.md`, `package.json` and `package-lock.json`;
   criterion 8.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; `npm run build` with
  `checkBudgets`.
- No `api/` change, but the join and findit read the declaration on the server, so
  `testJoinRefusal`, `testTowns`, `testFindit` and `testMapit` run live against `vercel dev` +
  local supabase.
- Mutation gate at PR readiness over the changed lines of `world.ts`.
- One browser run at close-out: a fresh player in a town with a landmark scans until it shows,
  cracks and joins it, and `lynx` opens a sited landmark's page from anywhere.
