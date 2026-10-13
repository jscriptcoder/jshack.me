# Plan: mapit.io, a public map of the world

**Status**: Grilled. Decisions confirmed by the owner 2026-10-13. Not yet sliced: the outline at
the end is the order agreed in the grill, and each slice still needs its acceptance criteria.
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

## Slices (outline, not yet planned)

1. **mapit.io exists.** The hand-drawn valley, its legend with each town's size and count, and
   each town's page as its legend alone. findit lists the site.
2. **The town plans are drawn** above those legends.
3. **The pointers.** Hackademy's sentence and the link on findit's front page.
4. **Close-out.** The as-built docs, the backlog entry, and one browser run across the slices.
