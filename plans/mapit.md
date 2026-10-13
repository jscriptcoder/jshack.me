# Plan: mapit.io, a public map of the world

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-13. Slice 1 is merged
(v0.376.0, #673); slice 2 is next.
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
9. **A legend row prints a place's name, kind and domain.** The domain is the link to its site.
   No address, no town's address block and no wifi name is printed anywhere on the map: an
   address is what `nslookup` is for, a town's block says where its hidden places answer, and
   matching a wifi name to a place is left to the player.
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
- **A page is at most 78 columns wide.** A test holds every town's plan and legend inside it, so
  a town that outgrows its canvas fails rather than wraps.
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
- No page prints an address, an address block or a wifi name, and no line of any page is wider
  than 78 columns.
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

### Slice 2: a town's page lists its places

**Value**: a player who follows a town on the map reads every public place in it and can follow
any of them to its site.
**Path**: `core/mapit/`: the rule for a place being on the map, a page per town, and the
region's legend turned into links.
**Branch**: `feat/mapit-town-pages`.
**Acceptance criteria**:

- Each town in the region's legend is a link to `/<town>.html`, and its row gains the number of
  places that page lists.
- A town's page is headed with its name, its size class and its region.
- Its legend has one row for every network that publishes a site, is not unlisted, and stands
  in that town, and no other row: no home, no unlisted site, no branch, no corporation that
  stands in no town.
- A row prints the place's name, its kind and its domain, and the domain is a link to the
  place's site. The row's number is the number `lynx` gives that link.
- A link back to the valley follows the legend.
- No page prints any network's public address, any town's address block, or any wifi name.
- No line of any page, as `lynx` shows it with its link numbers, is wider than 78 columns.
- The eleven pages list 284 places.

**First failing test**: Millbrook's page lists the nine places a search would list there, and
none of its homes.
**Wire-check**: `testMapit.ts` serves every town's page byte for byte.

### Slice 3: a town's page draws its plan

**Value**: a player sees where a town's places stand, each town with a face of its own.
**Path**: `core/mapit/`: a street grid and a plot for every place, drawn on a new stream
`town-plan-<town key>`, above the legend slice 2 built.
**Branch**: `feat/mapit-town-plans`.
**Measure first**: lay out all eleven towns with a throwaway script before settling the three
canvas sizes, and show the owner Ridgemont's plan (102 markers) and a village's. If a hundred
markers do not read on one canvas, that goes back to the owner as a question before any code.
**Acceptance criteria**:

- A town's page shows a plan above its legend: streets, and one numbered marker for every row
  of the legend, numbered as the legend is.
- No two markers share a cell or touch, and no marker stands on a street.
- The canvas is sized by the town's class, and no line of it is wider than 78 columns.
- The same town draws the same plan every time. Two towns of one size draw different streets.
- A town given one more place draws a plan with one more marker, with nothing changed by hand.
- The plan holds no link, so `curl` shows it as `lynx` does.

**First failing test**: a village's plan carries one marker for each place in its legend.
**Wire-check**: `testMapit.ts`, unchanged in shape: the pages it compares now carry the plans.
**Left for the PR**: the new stream's row in the "Seeds and streams" table of
`docs/world-content-architecture.md`.

### Slice 4: hackademy and findit point to the map

**Value**: a player learns the map exists from the two places they already visit.
**Path**: `core/hackademy/pages.ts`, the web chapter's "Finding sites at all";
`core/findit/page.ts`, the front page alone.
**Branch**: `feat/mapit-pointers`.
**Acceptance criteria**:

- Hackademy's web chapter names mapit.io once, in the paragraph that names findit, and no other
  page of the site names it.
- findit's front page carries a link to `http://mapit.io/`.
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
