# Plan: mapit.io, a public map of the world

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-13 and, for the town
plans, 2026-10-14. Slices 1 to 3 are merged (v0.376.0, #673; v0.377.0, #674; v0.378.0, #675).
Slice 4 is in progress: its acceptance criteria were confirmed by the owner 2026-10-14.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

A player can see the world. `mapit.io` is a site like `findit.io`: its front page is an ASCII map
of Harrow Valley with every town on it, and following a town opens an ASCII plan of that town with
its public places marked. findit answers when a player already has a word to search for; mapit
shows what is where to a player who has none.

## Where it starts from (facts, 2026-10-13)

Read in the code or measured on this date.

- **Nothing shows a player the world's size.** The world declares 612 networks in eleven towns
  of one region. findit lists a site only in answer to a search.
- **A town has no position.** A town row is `{ region, index, name, size }` (`world.ts`,
  `TOWN_ROWS`), and no network has a position inside its town.
- **Cities, towns and villages are one level.** They are three sizes of the same row, side by
  side in a region. The world's shape is regions → towns → networks, and there is one region.
- **`lynx` renders a `<pre>` exactly as written** (`ui/renderPage.ts`, `renderPreformatted`),
  and hackademy.io's pages rely on it.
- **A link inside a `<pre>` shifts its line.** Links are numbered in reading order once the page
  is laid out, and each `[n]` is written in front of its link, so everything to the right of a
  link on a drawn line moves by the width of the number.
- **A page line wraps at the window's edge** (`ui/screens/Lynx.tsx`, `whitespace-pre-wrap`), so
  a drawing wider than the window breaks.
- **Two kinds of fixed site exist.** hackademy.io is files on its box's disk: a table of path to
  HTML written into `/var/www/html` when the box is generated (`generation/fixedSiteFs.ts`,
  `WEB_ROOTS`). findit.io answers a search from a function, a branch of its own in
  `network/resolveHttpFetch.ts`.
- **A third fixed site is a row.** `FIXED_SITES` (`generation/fixedSites.ts`) feeds the box
  generator, `scripts/restoreSite.ts <domain>`, findit's listing of every fixed site but itself,
  and the set of domains no drawn business may take. hackademy.io answers in the placeless `193`
  block after every corporation, so adding it moved no address; a site added after it does the
  same.
- **findit reads a homepage's title, description and visible text** (`findit/readPage.ts`), and
  only a site's homepage is indexed.
- **findit is pointed at once.** Hackademy's web chapter names it in prose under "Finding sites
  at all", and `tutorials-architecture.md` records that as the world's only pointer to it.
  findit's front page is its search form and nothing else, and it shares one template with the
  results page (`findit/page.ts`, `finditDocument`), where the first result is link `[1]`.
- **What the map would show, by the rule in decision 2:**

  | Town       | Size    | Declared | Publishes a site | On the map |
  | ---------- | ------- | -------- | ---------------- | ---------- |
  | Ridgemont  | city    | 178      | 113              | 102        |
  | Kingsford  | city    | 166      | 82               | 70         |
  | Stonebury  | town    | 51       | 27               | 23         |
  | Oakhurst   | town    | 47       | 25               | 21         |
  | Wexcombe   | town    | 38       | 24               | 20         |
  | Millbrook  | village | 18       | 11               | 9          |
  | Hollowmere | village | 17       | 11               | 9          |
  | Ashby      | village | 18       | 10               | 8          |
  | Fenwick    | village | 15       | 9                | 8          |
  | Thornbury  | village | 20       | 10               | 8          |
  | Ely        | village | 16       | 7                | 6          |

  284 places in all. The longest place name is 31 characters and the longest domain 29. The 28
  corporations the world draws stand in no town. A corporation's branch publishes no site.

- **The backlog already held a map** (`backlog.md`, "Procedural world deferred", proposed
  2026-10-09 and never grilled): a `map` command opening a full-screen overlay with fog of war,
  three zoom levels and a per-player exploration record on the server.

## Decisions (owner-confirmed 2026-10-13)

All grilled singly.

1. **The site replaces the backlog's `map` overlay.** mapit.io is the map, the same for every
   player. Fog of war, the per-player exploration record and `ping` latency growing with distance
   are dropped with the overlay. Rejected: shipping the site and keeping the overlay for later,
   and grilling the two as one feature.
2. **It shows towns, and the places a search would already list.** A place is on the map when it
   publishes a site, is not unlisted, and stands in a town. Homes and unlisted sites stay off, so
   the leads, the council directories and `whois` stay the way to them. Rejected: towns only
   (little to browse), and every declared network (a player would read every home off a page).
3. **It is a printed atlas.** Its pages are files on the box's disk, generated from the declared
   world, as hackademy.io's are. A shop whose box is bricked stays on the map, and a player's own
   page never appears on it. Whoever roots the box can rewrite any page for everybody. Rejected:
   a live view answered from a function that reads each town's journals, as findit's search is.
4. **Two levels are drawn: the region, and each town.** The front page is the map of Harrow
   Valley. A town's page is a plan with its places as numbered markers, and a legend of links
   beneath. Rejected: drawing only the region with each town a plain listing, and a page for
   every place.
5. **The region is drawn by hand.** The map of Harrow Valley is one ASCII constant: its river,
   hills and roads, and each town's marker and name, a marker per size. The legend beneath it is
   generated from the town rows. Rejected: coordinates authored on the town rows with a generated
   drawing, and a fully seeded region.
6. **Adding to the world later must stay cheap.** The owner asked for this of decision 5. A place
   added to a town needs nothing by hand, since town plans are generated. A town added to Harrow
   Valley needs its marker and name drawn on the region, and a test fails until it is there. A
   second region needs a drawing of its own.
7. **A town plan is a seeded street grid.** Each town draws a few streets on a stream of its own,
   on a canvas sized by its class, and its places land on the plots between them. Rejected:
   fixed quarters by kind (every town the same shape), and places scattered along one winding
   road (does not hold a city's hundred markers).
8. **It is called `mapit.io`.** Rejected: `wayfind.io`, `atlas.io`, and a path on findit.io,
   which would put the atlas on findit's disk.
9. **A legend row prints a place's name, kind and domain.** The name is the link to its site,
   so the number `lynx` writes in front of the link opens the row, as it does on a findit
   result (settled with slice 2, 2026-10-13). No address, no town's address block and no wifi
   name is printed anywhere on the map: an address is what `nslookup` is for, a town's block
   says where its hidden places answer, and matching a wifi name to a place is left to the
   player. Rejected: the domain as the link (the number lands mid-row), and dropping the kind
   to save width (for a name like `Maddox & Lindley` the kind is all that says what it is).
10. **Two things point to it.** Hackademy names it once, beside findit, and findit's front page
    links to it. Rejected: leaving it to be found by a search alone.
11. **`mapit.io/` is Harrow Valley.** There are two levels until a second region is declared; a
    page of the world's regions goes above it then. Rejected: a world page now, holding one
    region.
12. **The region's legend prints each town's size class and how many places its plan shows.**
    Rejected: the size class alone, and the count of every network the town declares, which
    would tell a player how many hidden places a town holds.

## What follows from the decisions

Forced by the above or settled as detail; none of these was a separate choice.

- **The placeless corporations are not on the map.** They stand in no town, so findit stays the
  one way to them. Ridgemont's twenty landmark corporations are declared in Ridgemont and are on
  its plan. A branch publishes nothing, so no branch is on the map.
- **A drawing holds no link.** The links are in the legend beneath it, so `lynx` shifts nothing
  and `curl` shows the drawing clean.
- **A plan's marker number is the number `lynx` gives its link.** Marker 12 is link `[12]` in the
  legend, so the legend's links are the first on the page and the link back to the region comes
  after them.
- **There is no search box.** A printed atlas has no function behind it; searching is findit's.
- **A drawing is 78 columns wide and a page at most 80.** Ridgemont's legend needs the 80: its
  longest name (31), kind (11) and domain (29) with a three-digit link number and the column
  gaps come to exactly that, where every other town fits 76. A test holds every page inside
  it, so a town that outgrows it fails rather than wraps.
- **The pages are `/` and `/<town>.html`.**
- **The front page is written to be found.** Its title and first line name the map and Harrow
  Valley, so a findit search for either returns it.
- **findit's link is on its front page only.** A link above the results would renumber them.
- **The box is an ordinary fixed site.** A web server and `sshd`, a root password no wordlist
  holds, an `access.log` that is intel to whoever roots it, and the restore script to bring it
  back (`scripts/restoreSite.ts mapit.io`).
- **Nothing in `api/` changes.** The site's reachability by name and address is still proven on
  the wire, as hackademy.io's was.
- **"Adding to the world" gains a step** (`procedural-world-architecture.md`): a new town is
  drawn on its region's map.
- **The backlog's map entry is rewritten at close-out**, and with it the note that the world
  map of regions waits for a second region.

- **A drawing is plain ASCII.** No box-drawing or other non-ASCII character, and none of `<`,
  `>` or `&`, so every font, `lynx` and `curl` show the same picture.
- **The region's legend lists cities, then towns, then villages**, each size in the order the
  world declared its towns. A town's legend keeps the order the town declares its places in.
- **A place's kind is its subtype where it has one, and its category where it has none**, as a
  landmark has none.

## Left as it is

- **findit.** Its search, its index and its results page are untouched; only its front page
  gains a link.
- **Every existing address.** mapit.io answers in the placeless block after hackademy.io, so no
  network moves.
- **Town rows.** No coordinate is added to them.
- **One browser run at close-out** covers every slice.

## Done when

- `lynx http://mapit.io` shows a drawing of Harrow Valley naming all eleven towns, and beneath
  it a link to each with its size and its count of places.
- Following a town shows its plan, one numbered marker per place, and beneath it a link to each
  place's site under the marker's number.
- The eleven plans show 284 places between them, and no home, unlisted site, branch or placeless
  corporation.
- No page prints an address, an address block or a wifi name. No line of a drawing is wider
  than 78 columns and no line of a page wider than 80.
- A test fails when the world declares a town its region's drawing does not name.
- Hackademy names mapit.io once, and findit's front page links to it.
- `scripts/restoreSite.ts mapit.io` returns a defaced map to the generated one.

## Out of scope

- Fog of war, and any record of what a player has found (decision 1).
- A live view: a dark site dropping off the map, a player's page appearing on it (decision 3).
- A search box on mapit.io.
- A page of the world's regions (decision 11).
- Coordinates as data, and anything that would read them, such as `ping` by distance.
- Travel between towns.

## Slices

One PR per slice, each cut from `main` after the one before it merges. A behaviour-changing
slice starts from a failing test; its acceptance criteria are confirmed with the owner before
any code. Each PR bumps the version. The pages are pure functions of the declared world, so
their tests are unit tests in `core/`; what `lynx` makes of a page is a jsdom test in `ui/`.

### Slice 1: mapit.io answers with the map of Harrow Valley (v0.376.0, #673, merged)

**Value**: a player who opens `mapit.io` sees the valley and every town in it.
**Path**: a third row of `FIXED_SITES` (`generation/fixedSites.ts`); its address after
hackademy.io's (`world.ts`, `ADDRESS_BY_KEY`); its pages in `WEB_ROOTS`
(`generation/fixedSiteFs.ts`), from a new `core/mapit/`.
**Branch**: `feat/mapit-valley`.
**Acceptance criteria**:

- `mapit.io` resolves from any network, and its front page is served to `curl` and `lynx`.
- The front page is a drawing of Harrow Valley. Every town the world declares in the region is
  named on it, beside the marker of its size class, and the drawing has a key to the three
  markers.
- Beneath the drawing the legend names each town with its size class: cities, then towns, then
  villages.
- No line of the page is wider than 78 columns.
- A test fails when a town is declared in the region and the drawing does not name it.
- A findit search for `map`, and one for `Harrow Valley`, returns mapit.io.
- The box is a fixed site like the other two: it scans as `22` and `80`, refuses a wrong
  password, logs a visit in its own `access.log`, and `scripts/restoreSite.ts mapit.io` is
  accepted.
- No other network's address changes.

**Shown to the owner first**: the drawing itself, before it is committed.
**First failing test**: the front page names every town of Harrow Valley.
**Wire-check**: a new `scripts/testMapit.ts`, modelled on `testHackademy.ts`: every generated
page is served byte for byte at the site's address, the visit is logged, the scan finds both
doors, and a findit search answers with it. Nothing in `api/` changes, but a fixed site's
address is resolved by the server.
**Left for the PR**: the version bump, and the "Adding to the world" step in
`docs/procedural-world-architecture.md`.
**As built**:

- mapit.io answers at `193.10.253.15`. Its pages are `MAPIT_PAGES` (`core/mapit/pages.ts`), and
  the drawing is `HARROW_VALLEY_DRAWING` there.
- The world exports its towns as `TOWNS` (name, size, region), in the order it declared them.
  `mapit.test.ts` reads them, so a town row added to the world fails that test until it is drawn.
- The drawing the owner approved was redrawn before it was built: Kingsford's name had sat on
  the row beneath its mark, and the criterion asks for every name beside its mark. The river now
  passes Kingsford on its west side, and Stonebury, Ashby and Wexcombe stand further east.
- The legend is a `<table>`, which `lynx` lays out in aligned columns.
- The legend lists every town the world declares, with no filter by region: with one region no
  test can tell the difference. The test that pins the legend's eleven rows fails when a second
  region is declared, which is when the filter is written.
- Every line of the drawing is exactly 78 columns, and a test holds each line to that, so a line
  a hand leaves a column short fails.
- Wire-checks: `testMapit` 7 of 7, `testFindit` 19 of 19, `testHackademy` 21 of 21,
  `testRestoreSite mapit.io` 13 of 13. Mutation: 55 killed, 11 survived (three module-load
  mutants killed by hand, eight HTML scaffolding a parser repairs).
- `npm run build` failed two timing budgets on the machine it ran on, and `main` failed the same
  two there: Ashby's boxes (2.15 ms against 2 ms) and findit's generated web (1,170 ms against
  1,000 ms). The bundle budget passed at 272,202 B. Not looked into.

### Slice 2: a town's page lists its places (v0.377.0, #674, merged)

**Value**: a player who follows a town on the map reads every public place in it and can follow
any of them to its site.
**Path**: `core/mapit/`: the rule for a place being on the map, a page per town, and the
region's legend turned into links.
**Branch**: `feat/mapit-town-pages`.
**Acceptance criteria**:

- Each town in the region's legend is a link to `/<town>.html`, the town's name in lower case,
  and its row gains the number of places that page lists (`[1]Ridgemont  city  102 places`).
- A town's page is headed with its name, then one line giving its size class, its region and
  its count (`A village in Harrow Valley. 9 places.`).
- Its legend has one row for every network that publishes a site, is not unlisted, and stands
  in that town, and no other row: no home, no unlisted site, no branch, no corporation that
  stands in no town.
- A row is the place's name as a link to its site (`http://<domain>/`), then its kind, then its
  domain as text. Rows keep the order the town declares its places in.
- The legend's links are the first on the page, so a row's number is the number `lynx` gives its
  link. A link back to the valley follows the legend.
- A name holding `&` or an apostrophe (`Brew & Code`, `Yates's Café`; 38 names do) reads as
  written in `lynx` and in `curl`.
- No page prints any network's public address, any town's address block, or any wifi name.
- No line of any page, as `lynx` shows it with its link numbers, is wider than 80 columns.
- The eleven pages list 284 places, and the count on the front page is the number of rows on
  that town's page.

**Confirmed by the owner** 2026-10-13.
**First failing test**: Millbrook's page lists the nine places a search would list there, and
none of its homes.
**Wire-check**: `testMapit.ts` serves every town's page byte for byte.
**As built**:

- A place is on a town's page by `placesIn` (`core/mapit/pages.ts`): it stands in the town,
  publishes a site and is not unlisted. A test holds every page to what findit's generated index
  lists for that town, so the two cannot drift apart.
- Names are written as the world declares them, with no HTML escaping, so `curl` shows
  `Brew & Code` and `Yates's Café` as `lynx` does. The owner was asked and approved it. The
  names hold only `&`, `'` and `é` beyond plain characters today; a name holding `<` would
  break its row, and nothing fails when one is declared.
- A town's page is titled `<Town> - mapit.io`. Its link back reads the region's name.
- The count line reads `places` for any count. No town lists fewer than six, so the singular
  has no test and is not written.
- The legend test pins the eleven rows with their counts and the total of 284, so a town or a
  place added to the world changes it; "Adding to the world" says so.
- Ridgemont's columns add up to 80 with their link numbers and gaps; a test holds every page,
  as `lynx` lays it out, to 80.
- Wire-checks: `testMapit` 18 of 18, `testFindit` 19 of 19, `testHackademy` 21 of 21,
  `testRestoreSite mapit.io` 13 of 13. Mutation: 96 mutants, 70 killed and 26 reported
  survived (eleven module-load mutants killed by hand, one real and now tested, fourteen HTML
  scaffolding a parser repairs).
- The full suite failed one unrelated test by timeout on the machine it ran on, and `main`
  failed the same one there: `relations.test.ts`, "keeps no shortcut to a client on any other
  box of the office", about 39 s against a 30 s limit in a full run. It passes alone. Not
  looked into.
- `npm run build` was not re-run, so the two timing budgets from slice 1 are still unexamined.

### Slice 3: a town's page draws its plan (v0.378.0, #675, merged)

**Value**: a player sees where a town's places stand, each town with a face of its own.
**Path**: `core/mapit/`: a street grid and a plot for every place, drawn on a new stream
`town-plan-<town key>`, above the legend slice 2 built.
**Branch**: `feat/mapit-town-plans`.
**Measured** (2026-10-14, a throwaway layout of all eleven towns): a seeded grid of 1–3 long
streets and 1–5 cross streets, with markers on every other row of a block, a gap between them
and a cell clear of every street, holds a hundred markers on one 78-column canvas. Ridgemont
fits its 102 at 29 rows (104 spots) and falls short at 27; at 33 it has 130. At their class
heights Kingsford has 200 spots for 70, the towns 110 to 161 for 20 to 23, and the villages
about 70 for 6 to 9. The owner was shown Ridgemont's plan and Millbrook's.
**Decisions** (owner-confirmed 2026-10-14, grilled singly):

13. **Markers are scattered.** Each place takes a plot the town's stream picks, so declared
    order shows nowhere on the plan and the plan reads as a map. Rejected: numbering the plots
    in reading order, which is easy to search but puts every town's council, police and library
    top-left and reads as a table.
14. **A plan is sized by its town's class, and grows.** 13 rows for a village, 19 for a town,
    33 for a city, all 78 columns. When a town's places outgrow the plots its streets leave,
    the plan grows two rows at a time until every place fits, so a place added never fails.
    Rejected: fixed heights with a test that fails (a hand-made change to add a place), and a
    height fitted to each town's count (a village and a town of one count look alike).
15. **A plan is framed and named.** The valley's frame, with the town's name spaced out on its
    first row (`M I L L B R O O K`). No key line: the numbered list beneath is the key.
    Rejected: a key row like the valley's, and a bare grid without frame or name.

**Acceptance criteria** (confirmed by the owner 2026-10-14):

- A town's page shows its plan between its summary line and its legend: a frame 78 columns
  wide, the town's name spaced out on its first row, streets, and one numbered marker for every
  row of the legend, numbered as the legend is.
- No two markers touch, side by side, above and below or corner to corner, and no marker
  touches a street or the frame.
- Markers do not follow reading order: Ridgemont's plan, read left to right and top to bottom,
  does not count up.
- A village's plan is 13 rows, a town's 19 and a city's 33, unless its places do not fit, when
  it is the least height two rows at a time above that which holds them all.
- The same town draws the same plan every time. Two towns of one size draw different streets.
- A town given more places than its streets leave room for draws a taller plan with every
  marker on it, with nothing changed by hand.
- The plan is plain ASCII with none of `<`, `>` or `&`, and holds no link, so `curl` shows it
  as `lynx` does and the legend's link numbers are unchanged.

**Path detail**: the plan is drawn by a function of a town and its number of places, so a
test can draw a town with more places than it has. The stream is keyed by the town's key
(`r0/t1`), which `TOWNS` exports beside its name.
**First failing test**: a village's plan carries one marker for each place in its legend.
**Wire-check**: `testMapit.ts`, unchanged in shape: the pages it compares now carry the plans.
**Left for the PR**: the new stream's row in the "Seeds and streams" table of
`docs/world-content-architecture.md`.
**As built**:

- A plan is `drawTownPlan(town, placeCount)` (`core/mapit/townPlan.ts`), and a town's page
  puts it between its summary line and its legend. `TOWNS` carries each town's `key`.
- A village lays out one long street and one or two cross streets, a town one or two and two
  or three, a city two or three and four or five. Long streets stand at least four rows apart,
  and cross streets eight columns, so every block holds a row of markers; the room left over
  is shared out at random.
- Markers stand on every other row of a block and a column apart, a cell clear of streets,
  the name and the frame, on plots the stream picks.
- Today every town fits at its class height. Millbrook's streets would hold 69 places
  numbered in two figures on 13 rows and 92 on 15; a test pins both points.
- `renderPage.test.ts` pins Millbrook's page in `lynx` line for line, plan included, so a
  place added to Millbrook is updated there; "Adding to the world" says so.
- No test holds the street counts of a town or a city; only a pinned town or city plan would.
  Left to the owner.
- Wire-checks: `testMapit` 18 of 18, `testRestoreSite mapit.io` 13 of 13. Full suite 8936
  of 8936. Mutation: Stryker reported 88 killed, 4 timeouts and 39 survived of 131, which
  misreports this module because every page is drawn when it loads. Every mutant run by hand
  was killed except the street-count ranges and one guard that can never be false. Three
  tests were added at the gate, and two pieces of dead code were removed.

### Slice 4: hackademy and findit point to the map

**Value**: a player learns the map exists from the two places they already visit.
**Path**: `core/hackademy/pages.ts`, the web chapter's "Finding sites at all";
`core/findit/page.ts`, the front page alone.
**Branch**: `feat/mapit-pointers`.
**Acceptance criteria** (confirmed by the owner 2026-10-14):

- Hackademy's web chapter names mapit.io once, in the paragraph that names findit, and no other
  page of the site names it. The sentence follows "follow what comes back.": "When you want
  where things are rather than what they say, mapit.io has the map: the valley, its towns, and
  what stands in each." The Practice list is unchanged.
- findit's front page carries a link to `http://mapit.io/`, in one line under the rule so the
  form stays first: "Looking for where a place is, not what it says? mapit.io has the map.",
  with `mapit.io` the link. findit does not index itself, so no search answers differently.
- A findit results page carries no such link, and its first result is still link `[1]`.

**First failing test**: findit's front page links to mapit.io, and a search's first result is
still link 1.
**Wire-check**: `testHackademy.ts` and `testFindit.ts`, which compare served pages with the
generated ones.
**Note**: both pages are files on their boxes. A findit or a hackademy somebody has already
rewritten in dev or prod keeps its rewritten page until `restoreSite.ts` is run on it.
**Left for the PR**: decision 7 of `docs/tutorials-architecture.md` ("findit is named once")
reworded for the second name.

### Last slice: close-out

- `docs/discovery-architecture.md` gains mapit.io as built: the rule for a place being on the
  map, the two levels, the hand-drawn region and its test, the seeded plans, and the two
  pointers.
- `docs/backlog.md`: "The map" under "Procedural world deferred" is rewritten as shipped, with
  what was dropped (decision 1) and what waits (a page of regions, a live view, a search box).
- `docs/project-status.md` records the epic, and the handbook's codebase map and glossary name
  the new site.
- One browser run with the `e2e` skill covers every slice: the valley and a city's plan in
  `lynx`, a place followed to its site, the two pointers, and a defaced page restored.
- This file is deleted.
