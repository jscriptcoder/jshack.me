# Plan: X2 Slice 5 — The Government Category

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 5. The grill record is under "X2 — resolved scope &
decisions" (decisions 91–105, 2026-09-26); decision 104 sets this slice's scope. Slices 1–4's as-built
notes are in the same section. The decisions made at planning on 2026-09-26 (123–129) are listed below.

**Branch:** `feat/the-government-category`
**Status:** Active — decisions and acceptance criteria confirmed by the owner 2026-09-26.

---

## Decided at planning (2026-09-26)

**Owner decisions:**

123. **Three networks, one per institution, and every one publishes.** Police, city hall and the
     courts each get one catalog network that hosts the institution's site, the way corporates and
     cafés do. None is a wifi-only sibling, so every one is findable on findit and exposed through its
     forward (105).

     | ESSID | `place` | domain | `site.name` |
     |---|---|---|---|
     | `RIDGEMONT-PD` | the police station | `ridgemontpd.gov` | Ridgemont Police Department |
     | `CITY-HALL-WIFI` | city hall | `ridgemont.gov` | City of Ridgemont |
     | `COURTHOUSE-GUEST` | the courthouse | `ridgemontcourts.gov` | Ridgemont County Court |

     `CITY-PARK-WIFI` and `METRO-COMMUTER` stay `public`: their content reads as a park and a train
     line, which is what a player standing on them sees. Their `.gov` domains stay as they are.
     Rejected: non-publishing siblings (a precinct back office), which mean more content and a
     dead end findit cannot reach. Also rejected: re-filing parks and metro into `government`.
124. **A government network runs one new database application, `cases`.** It is a case-records
     application all three institutions share. Police incident reports, court dockets and council
     casework all read as cases.
     - Tables: `cases` (reference, kind, status, who opened it, when), `parties` (a case, a person's
       name, their role in it), `notes` (a case, a body, which login wrote it, when), and an optional
       `hearings` (a case, a room, an outcome, when).
     - It brings its own redis `STORE_SPECS` entry and its own six `MAIL_SPECS` threads, the same as
       every network archetype.

     `ARCHETYPES_BY_CATEGORY.government` is `['cases']`. Rejected: reusing `helpdesk` + `bookings`,
     which makes a police database read as an office helpdesk. Also rejected: a second `permits`
     application, which doubles the content and could still be drawn by the police.
125. **A government site always carries a staff directory.** `staff.html`, "Staff directory",
     follows the corporate "Team" and university "People" pattern: the webmaster plus some of the
     network's real inhabitants, each with a government role. The names lead to accounts, so a
     public `.gov` page is reconnaissance. Rejected: no fixed page, as for public places and cafés.

**Derived from existing conventions:**

126. **The content is civic, not per-institution.** One category means one set of pools. Every
     template must read as true at a police station, a city hall and a courthouse alike. The `{site}`
     and `{place}` slots are what make a page the police's rather than the court's. Rejected: pools
     keyed by institution under the category, a second key that none of the other seven categories
     has.
127. **Everything new is appended.** `'government'` goes at the end of `NETWORK_CATEGORIES`, and the
     three networks go at the end of `ESSID_CATALOG`, as the catalog's own comment requires. Two
     consequences are accepted before launch, when no backward-compatibility burden applies:
     - Every player's scan now draws from 53 crackable networks, not 50.
     - A network outside the catalog now draws its category from eight kinds, not seven.

     No existing catalog network's LAN or content changes, because both are keyed by ESSID. The
     existing snapshot tests confirm this.
128. **Volume matches the peers, table by table.** The compiler refuses a partly written category,
     so every `Record<NetworkCategory, …>` gets its entry in the same PR. Each is sized to what the
     other seven carry:

     | Table | File | Government entries |
     |---|---|---|
     | `UNNAMED_PLACES` | `persona.ts` | 5 |
     | `MOTD_TEMPLATES` | `pools/etcFiles.ts` | 4 |
     | `NOTE_TEMPLATES` | `pools/homeNotes.ts` | 12 |
     | `PERSONAL_THREADS` | `pools/mailThreads.ts` | 8 |
     | `PLACE_DOWNLOADS` | `pools/phoneFiles.ts` | 2 |
     | `SHARE_FOLDERS` | `pools/shareFiles.ts` | 5 departments |
     | `FRONT_PAGES` | `pools/webSites.ts` | 4 |
     | `SITE_PAGES` | `pools/webSites.ts` | 5 |
     | `PEOPLE_ROLES` | `pools/webSites.ts` | at least 4 |
     | `API_ENDPOINTS` | `pools/webSites.ts` | 3 |
     | `SITE_DESCRIPTIONS` | `pools/webSites.ts` | 1 |
     | `ARCHETYPES_BY_CATEGORY` | `databaseApp.ts` | `['cases']` (124) |

     `SITE_DESCRIPTIONS` is `Partial`, so the compiler does not demand it. A test does, because every
     government network publishes. The `cases` archetype adds its definition in
     `pools/databaseApps.ts`, a `STORE_SPECS` entry and six `MAIL_SPECS` threads. Every page and
     template obeys `webSites.ts`'s standing rules: no software version, no decimal price, no login
     name, and no date after the world began.
129. **One PR, v0.273.0, with no `api/` change.** The category is atomic under the compiler, and
     `cases` is its database, so a split would ship a police network running someone else's
     application. Nothing in `api/` changes: the catalog `site` field alone gives a network its
     derived address, its guaranteed webserver, its `:80` forward and its place in findit's index
     (slices 1–3). So no new wire-check is owed. The existing `testFindit.ts` and
     `testExploitPublisherSite.ts` are re-run live as alternate evidence that the generic path carries
     the new sites.

---

## Goal

Ridgemont gains a police department, a city hall and a court. Each is a crackable network whose
machines read as a government office, whose database holds case files, and whose public `.gov` site
findit can search and a player can scan and break into from anywhere.

## Acceptance Criteria

- [ ] From any network, `curl ridgemontpd.gov`, `curl ridgemont.gov` and `curl ridgemontcourts.gov`
      each return that institution's homepage: titled with its site name, carrying a government
      `<meta name="description">`, and linking a staff directory that names real people on its
      network, each with a government role. This works before anybody has joined its wifi.
- [ ] `curl "findit.io/?q=police"` ranks Ridgemont Police Department first, and `?q=court` ranks
      Ridgemont County Court first.
- [ ] `nmap ridgemontpd.gov` shows the gateway's `22` and the forwarded `80`, as for every publisher.
- [ ] A player who cracks and joins one of the three networks finds machines that read as a
      government office:
  - [ ] its MOTDs, home notes, personal mail, phone downloads and share folders come from the
        government pools;
  - [ ] its database runs the `cases` application (`cases`, `parties`, `notes`, sometimes
        `hearings`), every party and note pointing at a real case and every note at a real login;
  - [ ] its redis store caches and queues `cases` work;
  - [ ] its mail carries the `cases` threads.
- [ ] No other catalog network's LAN or content changes.

## Slices

### Slice 5: the government category

**Value:** Behavior change. A player finds three new institutions on findit and by scanning. Each is
a whole, playable place: public reconnaissance (a staff directory), a webserver exposed to the
internet, and inside, a case-records database worth breaking in for.

**Path:**
1. `ESSID_CATALOG` gains the three entries with `site`.
2. That one field drives, unchanged: `publisherSite`/`publisherIp`/`siteAddress` (the world DNS and
   the derived `193.x` address), the guaranteed webserver and `:80` forward (`generateHomeLan`,
   `routerFs`), and findit's `webIndex`.
3. `networkPersona` answers `government`. Every category-keyed pool then reads its government entry:
   `etcContent` (MOTD), `npcHome` (notes), `networkMail` (personal threads, plus `MAIL_SPECS.cases`),
   `phoneHome` (downloads), `share` and `device/printer` (folders), and `webSite` (front page, site
   pages, roles, API, description, and the fixed `staff.html`).
4. `networkArchetype` draws `cases`. `buildApplication` builds its tables, and `STORE_SPECS.cases`
   shapes the redis store.
5. `resolveHttpFetch` serves the homepage and staff directory, and findit's search ranks it.

**Class:** Behavior change (content-heavy: one new category, one new archetype, one fixed page).
**Delivery:** Independent PR against trunk (`main`), no stack (129).
**Required implementation skills:**
- Before code: `tdd`, `testing` and `refactoring` (and the `v2-e2e` runbook for the browser run).
- At PR readiness: `mutation-testing`.

**Reduction program:** N/A.
**Transition/terminal evidence:** N/A.

**RED → GREEN increments.** Each test is written first and fails for the stated reason. Every
assertion is on observable output: what a page, a file, a table or a search returns.

1. **The institutions exist and publish** (`publisher.test.ts`). `PUBLISHED_SITES` gains the three
   `.gov` entries. It fails because `publisherSite('RIDGEMONT-PD')` is `undefined`. The existing
   catalog-wide checks then cover the new addresses: distinct derived addresses, and each domain
   resolving to its own.
   - *GREEN:* append `'government'` to `NETWORK_CATEGORIES`, and the three `entries('government', …)`
     rows to `ESSID_CATALOG`.
   - The compiler then refuses every `Record<NetworkCategory, …>`. Fill each with its government
     entry per 128 as the following increments demand it. To keep an increment compiling, a
     placeholder entry may stand only inside the increment that replaces it, never across a commit.
2. **The place is named** (`persona.test.ts`). `networkPersona('RIDGEMONT-PD')` is
   `{ category: 'government', place: 'the police station' }`.
   - *GREEN:* the catalog rows, plus `UNNAMED_PLACES.government`.
3. **The site names itself and its staff** (`webSite.test.ts`).
   - `RIDGEMONT-PD`'s webserver homepage is titled "Ridgemont Police Department" and carries the
     government meta description.
   - Its navigation links `staff.html`. That page lists the webmaster plus names that are all real
     inhabitants of the network, each with a role drawn from `PEOPLE_ROLES.government`.
   - It fails because there is no `staff.html`.
   - *GREEN:* the `government` branch beside `corporate`/`university` in the fixed-page choice, with
     `team('staff.html', 'Staff directory')`, and `SITE_DESCRIPTIONS`, `FRONT_PAGES`, `SITE_PAGES`,
     `PEOPLE_ROLES` and `API_ENDPOINTS` for `government`.
   - *REFACTOR check:* retail will add a fourth case to that nested ternary in slice 6. Decide there,
     not here, whether it becomes a lookup.
4. **Every publisher describes itself** (`webSite.test.ts`). Every catalog entry with a `site` has a
   `SITE_DESCRIPTIONS` entry for its category. This is the test 128 names, since the compiler cannot
   see the gap in a `Partial`.
   - It is RED if written before the government description exists; it is still worth adding so
     retail cannot miss it.
5. **findit finds them** (`search.test.ts` or `webIndex.test.ts`, whichever owns ranking over the
   real index). `?q=police` ranks `ridgemontpd.gov` first, and `?q=court` ranks
   `ridgemontcourts.gov` first.
   - *GREEN:* already green from increments 1 and 3, the index being a view over the pages. If it is
     green on first run, record it as a guard rather than a RED; do not invent a failure.
6. **A government network keeps case files** (`database.test.ts`, beside "keeps a till on a café's
   network").
   - A network database on `RIDGEMONT-PD` is the `cases` application: `cases`, `parties` and `notes`
     are present, `hearings` sometimes, and its name is one the archetype uses.
   - Fails: there is no `cases` archetype.
   - *GREEN:* the `cases` `Archetype` in `pools/databaseApps.ts`, registered in
     `ARCHETYPE_DEFINITIONS`, and `ARCHETYPES_BY_CATEGORY.government = ['cases']`.
   - The existing "every application, sampled once" and "what is true of every row" suites then
     cover `cases` for these properties: table count, row count, referential integrity, typed cells,
     whole euros, and dates before the world stopped.
7. **Its store serves the case work** (`store.test.ts`). A `RIDGEMONT-PD` store's cached keys,
   queues, counters and flags are the `cases` spec's.
   - *GREEN:* `STORE_SPECS.cases`, obeying its own rule that no counter counts a part of another.
8. **Its mail talks about cases** (the `networkMail` test that owns archetype threads). A government
   network's mail carries threads from `MAIL_SPECS.cases`.
   - *GREEN:* six `cases` threads.
9. **Its people's files read as government.**
   - MOTD (`etcContent`), notes (`npcHome`), personal mail, phone downloads (`phoneHome`) and share
     folders (`share.test.ts`'s per-category folder map gains a `government` row).
   - Where an existing test already iterates every category, government is covered by the category
     being in the list. Add a case only where the existing test names categories one by one.
   - *GREEN:* the remaining pool entries per 128.
10. **Nobody else moved.** The existing non-publisher snapshot in `generateHomeLan.test.ts` and the
    per-network content tests stay green unchanged. If one fails, a key other than the ESSID is
    leaking into a draw: treat it as a defect, not a snapshot to update.

**REFACTOR:** assess after green, labelled Critical/High/Nice/Skip. Two candidates are known in
advance:
- The fixed-page nested ternary in `webSite.ts`. Likely Skip now and revisited at retail; see
  increment 3.
- Any repeated civic string between `SITE_PAGES.government` and `public`. Skip: they would drift
  apart, since they are different rules that share wording.

**PRE-PR MUTATION or alternate evidence:**
- **Mutation:** a scoped run (dev server down, `npm run encode` first) over the changed logic lines:
  `webSite.ts`'s fixed-page choice and `databaseApp.ts`'s archetype draw, if touched.
- **Mutation `N/A`** for the pool files and the `cases` definition. They are string and number
  literals, so Stryker's string mutants there test only that a literal exists. Their evidence is the
  property suites in increments 6–9, plus the structural rules those suites already enforce: tables
  and rows in range, integrity, typed cells, and no forbidden content.
- **Alternate evidence:**
  - `testFindit.ts` and `testExploitPublisherSite.ts`, re-run live.
  - The browser run below.
  - The full unit suite, typecheck and lint.

**Browser run** (the `v2-e2e` runbook; one session, `alice`):
1. On any network, `lynx ridgemontpd.gov` shows the police homepage. Follow "Staff directory".
2. `lynx findit.io`, search `police`, and follow the first result back to the police site.
3. `nmap ridgemontpd.gov` shows `22` and `80`.
4. `airodump-ng` until `RIDGEMONT-PD`, `CITY-HALL-WIFI` or `COURTHOUSE-GUEST` appears. Re-scan to
   re-roll, per the runbook §3. Crack it, join, and on one box read the MOTD and a home note.
5. `mysql` into the network's database (credentials per the runbook §6) and
   `SELECT * FROM parties`. Every `case_id` is a real case.

**Also in the PR:**
- The version goes to 0.273.0 (`package.json` + lock).
- `v2/docs/world-content-architecture.md` names `government` among the categories and `cases` among
  the network archetypes, wherever it lists them.
- The `v2-e2e` runbook: one line naming the three government networks and their domains beside the
  existing publisher examples.

**Done when:**
- All acceptance criteria are met.
- Increments 1–10 are green.
- 6346+ unit tests pass, and `npm run typecheck` and `npm run lint` are clean.
- Mutation has run on the changed logic lines, with valuable survivors killed, and the pools are
  recorded `N/A` with the evidence above.
- `testFindit.ts` and `testExploitPublisherSite.ts` are green live.
- The browser run is recorded.

## Pre-PR Quality Gate

1. Implementation complete, refactor assessed.
2. Mutation run on the changed logic lines (the dev server must be DOWN); pools `N/A` against the
   property suites.
3. `npm run typecheck`, `npm run lint` and `npx vitest run` are green.
4. The two existing wire-checks are green live, and the browser run is done.
5. No DDD glossary. Domain words match the epic's: category, catalog, publisher, site, archetype,
   case.

## Risks

- **Content volume is the cost.** 128 is several hundred lines of written content. The risk is
  tone, not logic: every template must pass 126's three-institution test. Review the pools against
  it before the PR, not after.
- **Three networks is a thin sample for the world-content suites.** Those suites
  (`docs/world-content-architecture.md`) require every pool entry to be reachable and each category to
  meet a distinct-body ratio. Government has 3 catalog networks where corporate has 20. If a
  reachability or variety check fails only for government, widen that suite's synthetic networks, as
  it already does for rare roles. Never lower a threshold or trim a pool to fit.
- **Scans re-roll for everybody** (127). Runbooks and wire-checks that assumed a given identity sees
  a given network may need a re-scan. The runbook already says to choose a target after the first
  `airodump-ng`.
- **`findit.io/?q=police` may tie or lose to a page that happens to say "police".** Scoring is title
  3, description 2, body 1, so the site named "Police" in its title should lead. If a body elsewhere
  outscores it, the fix is the government description's wording, not the scorer.
