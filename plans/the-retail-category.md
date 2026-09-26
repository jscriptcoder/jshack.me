# Plan: X2 Slice 6 — The Retail Category

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 6, the last of X2's spine. The grill record is under
"X2 — resolved scope & decisions" (decisions 91–105, 2026-09-26); decision 104 sets this slice's scope,
and slice 5's as-built (decisions 123–129) is the precedent it follows. The decisions made at planning
on 2026-09-26 (130–137) are listed below.

**Branch:** `feat/the-retail-category`
**Status:** Active — decisions and acceptance criteria confirmed by the owner 2026-09-26.

---

## Decided at planning (2026-09-26)

**Owner decisions:**

130. **Four general-goods shops, one per network, and every one publishes.**

     | ESSID | `place` | domain | `site.name` |
     |---|---|---|---|
     | `KWIK-E-MART` | the Kwik-E-Mart | `kwikemart.com` | Kwik-E-Mart |
     | `MONSTROMART` | Monstromart | `monstromart.com` | Monstromart |
     | `BUY-N-LARGE` | Buy n Large | `buynlarge.com` | Buy n Large |
     | `MEGA-LO-MART` | Mega Lo Mart | `megalomart.com` | Mega Lo Mart |

     A convenience store, a supermarket, a department store and a big-box store. All four sell
     overlapping everyday goods, so one product pool and one set of page templates read as true in each
     (133). They are parody names, as the catalog's convention requires. None is a wifi-only sibling,
     so every one is findable and exposed through its forward (105). Rejected: specialist shops (a
     bookshop, an electronics store, a toy store and a hardware store). Their shared product pool would
     put a USB cable in a bookshop's till unless pools were keyed per shop, which 126 rejected. Also
     rejected: three shops to match government's size, a thinner sample for the variety suites.
131. **A retail network runs one new database application, `shop`.** It is a point of sale with a
     loyalty scheme:
     - `products`: SKU, name, aisle, whole-euro price.
     - `sales`: who rang it up, the total, how it was paid, when.
     - `sale_lines`: a sale, a product, a quantity.
     - `loyalty_members`: a customer's name, a card number, their points, when they joined.
     - an optional `returns` table: a sale, a reason, when.

     The customer list is the prize. It brings its own redis `STORE_SPECS` entry and its own six
     `MAIL_SPECS` threads, like every network archetype. `ARCHETYPES_BY_CATEGORY.retail` is `['shop']`.
     Rejected: `['shop', 'stock']`, which leaves half the shops with no till and no customer list. Also
     rejected: reusing `stock` + `till`, which makes a supermarket read as a café (barista shifts, table
     numbers), the same failure 124 rejected for the police.
132. **A retail site has no fixed page**, like the cafés and the public places. A shop's site draws its
     pages from the retail pool (hours, offers, delivery, careers). Its staff are still listed with
     retail roles on the Team page of any intranet a `portal-` box keeps inside the network. Rejected: an "Our team" page. The shops are the one
     institution a player does not need to case through its site, and it would add a fourth branch to
     the fixed-page chain. Also rejected: an always-present "Offers" page, which is identity with
     nothing to use.

**Derived from existing conventions:**

133. **The content is general retail, not per-shop.** This is 126's rule applied to shops: one set of
     pools, and every template must read as true at a corner shop and a department store alike. The
     `{site}` and `{place}` slots make a page one shop's rather than another's. The `shop` product pool
     is everyday goods (groceries, household, toiletries, stationery, small electrics), never a
     specialist line.
134. **A loyalty member carries a card number, not an email.** 131 as offered named an email, but no
     column kind in `pools/databaseApps.ts` stores one (`person` is a name). A new kind would be new
     generator logic for one column. `code('card_no', 'LOY-', …)` identifies the customer as a real
     scheme does, with what already exists. Owner-confirmed 2026-09-26.
135. **Everything new is appended.** `'retail'` goes at the end of `NETWORK_CATEGORIES`, and the four
     networks go at the end of `ESSID_CATALOG`. Two consequences are accepted before launch, as in
     127:
     - Every scan now draws from 57 crackable networks, not 53.
     - A network outside the catalog now draws from nine kinds, not eight.

     No existing network's LAN or content changes, because both are keyed by ESSID.
136. **Volume matches the peers, table by table**, as 128 did. `WORK_HISTORY` is in the list from the
     start this time: it was the table slice 5 found at the last moment, and it is category-keyed now.

     | Table | File | Retail entries |
     |---|---|---|
     | `UNNAMED_PLACES` | `persona.ts` | 5 |
     | `MOTD_TEMPLATES` | `pools/etcFiles.ts` | 4 |
     | `WORK_HISTORY` | `pools/homeHistory.ts` | 15 |
     | `NOTE_TEMPLATES` | `pools/homeNotes.ts` | 12 |
     | `PERSONAL_THREADS` | `pools/mailThreads.ts` | 8 |
     | `PLACE_DOWNLOADS` | `pools/phoneFiles.ts` | 2 |
     | `SHARE_FOLDERS` | `pools/shareFiles.ts` | 5 departments, ten files each |
     | `FRONT_PAGES` | `pools/webSites.ts` | 4 |
     | `SITE_PAGES` | `pools/webSites.ts` | 5 |
     | `PEOPLE_ROLES` | `pools/webSites.ts` | at least 4 |
     | `API_ENDPOINTS` | `pools/webSites.ts` | 3 |
     | `SITE_DESCRIPTIONS` | `pools/webSites.ts` | 1 |
     | `ARCHETYPES_BY_CATEGORY` | `databaseApp.ts` | `['shop']` (131) |

     `PEOPLE_ROLES` is still owed with no fixed page (132): the compiler demands it, and a `portal-`
     box's intranet on a retail network lists the staff with it on its Team page. The `shop` archetype adds its definition, a `STORE_SPECS`
     entry and six `MAIL_SPECS` threads. Every page obeys `webSites.ts`'s standing rules: no software
     version, no decimal price (an offer is `€3`, never `€2.99`), no login name, and no date after the
     world began.
137. **One PR, v0.276.0, with no `api/` change.** This is 129's reasoning unchanged. The category is
     atomic under the compiler, and the catalog `site` field alone carries the address, the forward
     and the index. The three existing wire-checks are re-run live as alternate evidence.

---

## Goal

Ridgemont gains four shops. Each is a crackable network whose machines read as a store's back office,
whose database holds its sales and its loyalty customers, and whose public site findit can search and
a player can scan and break into from anywhere. This closes X2.

## Acceptance Criteria

- [ ] From any network, `curl kwikemart.com`, `monstromart.com`, `buynlarge.com` and `megalomart.com`
      each return that shop's homepage, titled with its site name and carrying a retail
      `<meta name="description">`. This works before anybody has joined its wifi.
- [ ] `curl "findit.io/?q=monstromart"` ranks Monstromart first, and a search for a word only the
      retail description uses ranks a shop first.
- [ ] `nmap monstromart.com` shows the gateway's `22` and the forwarded `80`, as for every publisher.
- [ ] A player who cracks and joins one of the four networks finds machines that read as a shop:
  - [ ] its MOTDs, shell histories, home notes, personal mail, phone downloads and share folders come
        from the retail pools;
  - [ ] its database runs the `shop` application (`products`, `sales`, `sale_lines`,
        `loyalty_members`, sometimes `returns`), with every line pointing at a real sale and a real
        product, and every sale at a real login;
  - [ ] its redis store caches and queues `shop` work;
  - [ ] its mail carries the `shop` threads.
- [ ] No other catalog network's LAN or content changes.

## Slices

### Slice 6: the retail category

**Value:** Behavior change. A player finds four new shops on findit and by scanning. Each is a whole,
playable place: a webserver exposed to the internet, and inside, a till and a customer list worth
breaking in for.

**Path:**
1. `ESSID_CATALOG` gains the four entries with `site`.
2. That one field drives, unchanged: the world DNS and the derived `193.x` address, the guaranteed
   webserver and `:80` forward, and findit's index.
3. `networkPersona` answers `retail`, and every category-keyed pool reads its retail entry:
   - `etcContent` (MOTD)
   - `homeHistory` (shell history)
   - `npcHome` (notes)
   - `networkMail` (personal threads, plus `MAIL_SPECS.shop`)
   - `phoneHome` (downloads)
   - `share` and `device/printer` (folders)
   - `webSite` (front page, site pages, roles, API, description; no fixed page, per 132)
4. `networkArchetype` draws `shop`. `buildApplication` builds its tables, and `STORE_SPECS.shop`
   shapes the redis store.
5. `resolveHttpFetch` serves the homepage, and findit's search ranks it.

**Class:** Behavior change (content-heavy: one new category and one new archetype).
**Delivery:** Independent PR against trunk (`main`), no stack (137).
**Required implementation skills:**
- Before code: `tdd`, `testing` and `refactoring`, plus the `v2-e2e` runbook for the browser run.
- At PR readiness: `mutation-testing`.

**Reduction program:** N/A.
**Transition/terminal evidence:** N/A.

**RED → GREEN increments.** Each test is written first and fails for the stated reason. Every
assertion is on observable output: what a page, a file, a table or a search returns.

1. **The shops exist and publish** (`publisher.test.ts`). `PUBLISHED_SITES` gains the four `.com`
   entries. It fails because `publisherSite('MONSTROMART')` is `undefined`. The catalog-wide checks
   then cover the new addresses: they are distinct, and each domain resolves to its own.
   - *GREEN:* append `'retail'` to `NETWORK_CATEGORIES` and the four `entries('retail', …)` rows to
     `ESSID_CATALOG`.
   - The compiler then refuses every `Record<NetworkCategory, …>`. Fill each per 136 as the following
     increments demand it. A placeholder entry may stand only inside the increment that replaces it,
     never across a commit.
2. **The place is named** (`persona.test.ts`). `networkPersona('MONSTROMART')` is
   `{ category: 'retail', place: 'Monstromart' }`.
   - *GREEN:* the catalog rows and `UNNAMED_PLACES.retail`.
3. **The site names itself and says what it sells** (`webSite.test.ts`). The existing "describes
   every publisher by more than its bare name" test goes RED for the four shops, because there is no
   retail description yet. That is this increment's failing test; do not write a duplicate.
   - *GREEN:* `SITE_DESCRIPTIONS.retail`, `FRONT_PAGES`, `SITE_PAGES`, `PEOPLE_ROLES` and
     `API_ENDPOINTS`.
   - The existing fixed-page test's category list gains nothing: retail keeps no fixed page, so the
     guard that a site carries a team page only where its category lists its people already covers
     132.
4. **findit finds them** (`webIndex.test.ts`, beside "puts the institution a search names first").
   `rankPages(web, 'monstromart')[0]` is `monstromart.com`, and a word only the retail description
   carries ranks a shop first.
   - Already green from increments 1 and 3 if written after them. If so, record it as a guard, not a
     RED; do not invent a failure.
5. **A shop keeps its till and its customers** (`database.test.ts`, beside "keeps case files on a
   government office's network").
   - A network database on a retail network is the `shop` application. `products`, `sales`,
     `sale_lines` and `loyalty_members` are present, `returns` sometimes, and its name is one the
     archetype uses.
   - It fails because there is no `shop` archetype.
   - *GREEN:* the `shop` `Archetype` in `pools/databaseApps.ts`, registered in
     `ARCHETYPE_DEFINITIONS`, and `ARCHETYPES_BY_CATEGORY.retail = ['shop']`.
   - The "every application, sampled once" and "what is true of every row" suites then cover `shop`
     for table count, row count, referential integrity, typed cells, whole euros and dates.
6. **Its store serves the shop's work** (`store.test.ts`). A retail store's cached keys, queues,
   counters and flags are the `shop` spec's.
   - *GREEN:* `STORE_SPECS.shop`, obeying its own rule that no counter counts a part of another.
7. **Its mail talks about the shop** (the `networkMail` test that owns archetype threads). A retail
   network's mail carries threads from `MAIL_SPECS.shop`.
   - *GREEN:* six `shop` threads.
8. **Its people's files read as retail.** This covers MOTD, shell history, notes, personal mail, phone
   downloads, and share folders (`share.test.ts`'s per-category folder map gains a `retail` row).
   - Where an existing test iterates every category, retail is covered by being in the list. Add a
     case only where a test names categories one by one.
   - *GREEN:* the remaining pool entries per 136.
9. **Nobody else moved.** The non-publisher snapshot in `generateHomeLan.test.ts` and the
   per-network content tests stay green unchanged. The two `generateWifi.test.ts` scan snapshots
   will move, as they did at 127 (135). Check that the property they pin still holds before
   updating them: crackables are interleaved with noise, not grouped. Any other failure means a key
   other than the ESSID is leaking into a draw. Treat that as a defect, not a snapshot to update.

**REFACTOR:** assess after green, labelled Critical/High/Nice/Skip. Two candidates are known in
advance:
- The fixed-page chain in `webSite.ts` is **Skip**. 132 adds no fourth case, so the deferred lookup is
  not earned. Record that the question slice 5 left for this slice is answered.
- Wording shared between `SITE_PAGES.retail` and `cafe` (hours, offers) is **Skip**. They are
  different rules that share wording, and they would drift apart.

**PRE-PR MUTATION or alternate evidence:**
- **Mutation:** a scoped run (dev server down, `npm run encode` first) over any logic line this slice
  changes. The expected set is none: 131 and 132 add data, not branches. If no logic line changes,
  record mutation `N/A` and say why.
- **Mutation `N/A`** for the pools and the `shop` definition. They are literals, so Stryker's string
  mutants test only that a literal exists. Their evidence is the property suites in increments 5–8
  and the structural rules those suites enforce.
- **Alternate evidence:**
  - `testFindit.ts`, `testExploitPublisherSite.ts` and `testPublisherWeb.ts`, re-run live.
  - The browser run below.
  - The full unit suite, typecheck and lint.

**Browser run** (the `v2-e2e` runbook; one session, `alice`):
1. On any network, `lynx monstromart.com` shows the shop's homepage.
2. `lynx findit.io`, search `monstromart`, and follow the first result back.
3. `nmap monstromart.com` shows `22` and `80`.
4. Run `airodump-ng` until a shop appears, re-scanning to re-roll (runbook §3). Crack it, join, and on
   one box read the MOTD and a home note.
5. Reach the `shop` application, whichever door the dice opened:
   - `mysql` into the database (credentials per runbook §6), then `SELECT * FROM loyalty_members`;
   - or read its redis store on a real machine.

   Slice 5 showed a network's tables are readable only where a `mysql` landed on a machine. Choose the
   network offline first.

**Also in the PR:**
- The version goes to 0.276.0 (`package.json` + lock).
- `v2/docs/world-content-architecture.md` names `retail` among the categories and `shop` among the
  network archetypes, wherever it lists them.
- The `v2-e2e` runbook: one line naming the four shops and their domains beside the government ones.

**Done when:**
- All acceptance criteria are met.
- Increments 1–9 are green.
- The full unit suite, `npm run typecheck` and `npm run lint` are clean.
- Mutation has run on any changed logic line, or is recorded `N/A` with why, and the pools are
  recorded `N/A` against the property suites.
- The three existing wire-checks are green live.
- The browser run is recorded.

## Pre-PR Quality Gate

1. Implementation complete, refactor assessed.
2. Mutation or `N/A` as above (the dev server must be DOWN for any run).
3. `npm run typecheck`, `npm run lint` and `npx vitest run` are green.
4. The three existing wire-checks are green live, and the browser run is done.
5. No DDD glossary. Domain words match the epic's: category, catalog, publisher, site, archetype,
   shop, loyalty member.

## Risks

- **Content volume is the cost.** 136 is several hundred lines of written content. The risk is tone,
  not logic: every template must pass 133's corner-shop-and-department-store test. Review the pools
  against it before the PR.
- **A `Record<string, …>` hiding a category.** Slice 5's crash came from a pool the compiler could
  not see. Checked at planning: every table with a `cafe` key is typed `Record<NetworkCategory, …>`,
  and the remaining `Record<string, …>` pools are keyed by role mailbox, phone kind, weekday or
  command, not by category. Re-check if a new pool lands before this slice does.
- **Four networks is still a thin sample** for the variety suites. If a check fails for retail alone,
  widen that suite's synthetic networks. Never lower a threshold or trim a pool.
- **Scans re-roll for everybody** (135). A runbook step or wire-check that assumed a given identity
  sees a given network may need a re-scan.
- **Name tokens.** `Kwik-E-Mart` and `Buy n Large` split into short tokens (`e`, `n`), so the findit
  acceptance uses `monstromart`. If a single-letter token scores oddly, that is the tokenizer's
  existing behavior, not this slice's to change.
