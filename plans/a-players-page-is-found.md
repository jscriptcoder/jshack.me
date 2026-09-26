# Plan: X2 Slice 3 — A Player's Page Is Found

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 3. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26); slices 1 and 2's as-built are in the same section. Four owner
decisions made at planning (2026-09-26, 106–109, all refining 97) and the choices derived from
existing conventions are listed under "Decided at planning" below.

**Status:** planned; not started. Branch `feat/a-players-page-is-found`.

**Delivery:** one independent PR against trunk (decision 109).

| PR | Branch | Version | Owns |
|---|---|---|---|
| 3 | `feat/a-players-page-is-found` | v0.271.0 | player pages in findit's index, shown by public IP; the `robots.txt` opt-out for every page, publishers included |

The PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

When player A publishes nginx behind a public `:80` forward, player B's `curl "findit.io/?q=<a word on
A's page>"` lists A's page by its title and A's bare public IP. Once A writes `User-agent: *` /
`Disallow: /` into their `robots.txt`, the next search no longer lists them.

## Grounding (verified 2026-09-26, v0.270.0)

- **The index is `indexedWeb`** (`core/findit/publisherIndex.ts`). It reads the 32 publishers' gateways
  and site servers through one `findPatchesForMachines` batch, then materializes and checks each in
  memory. A publisher whose gateway serves `:80` from anywhere other than its generated site server
  goes through `resolveElsewhere`: the ordinary `resolveWebTarget` plus a server-side read of `/`.
- **Every page findit holds is an `IndexedPage`** (`search.ts`) with an `address` that the results
  page (`page.ts`) links as `http://<address>/` and prints on its own line. Everything is escaped.
  Given an IP as the address, the page already has decision 98's shape. `readPage(html,
  fallbackTitle)` titles an untitled page with the fallback.
- **Stored public addresses:** `network_public_ips` (`essid` PK, `public_ip` UNIQUE) has one row per
  network anyone has ever joined, permanent. A publisher's joined network stores its derived address
  (slice 1), so publishers appear there too. findit is never joined, so it has no row.
- **The curl resolution** is `resolveWebTarget(deps, {target, port})` in `resolveHttpFetch.ts`:
  1. public IP → ESSID;
  2. the gateway journal → boot gate → `machineServing`;
  3. a forward → the occupant leasing that address, else the generated LAN box (1c);
  4. finally `servesWebOn`.

  Each step can refuse, and every refusal is `host_unreachable`.
- **Nothing in v2 reads a `robots.txt`.** Generated sites write one 80% of the time, with
  `Disallow: /<word>/` lines only, never a bare `/` (the publisher case is pinned by a test).
- **Staging a player publisher** in a wire-check is established: `testSharedApForwards.ts` seeds
  `registerNetwork`'s join state and writes `rules.v4` through service-role patch rows. In play,
  the runbook's §4 (gateway root, password derived from the ESSID) and "Publishing a site to browse"
  (`apt install nginx`, `nginx`, `rm` the default page) cover it.

## Scope boundary

**In:**
- Player pages in the index, found at query time through the curl resolution and shown by bare
  public IP.
- The `robots.txt` opt-out for every page on a public `:80`.

**Not built here, deliberately:**
- Reading findit's log as intel and the restore script (slice 4).
- Player domains (98).
- Pagination (99).
- A crawl beyond `/index.html` (96).
- Any port but `:80`.
- Logging the crawl (107).
- A stored listing (97, 108).

## Decided at planning (2026-09-26)

**Owner decisions (refine 97):**

106. **`robots.txt` is read the way a real crawler reads it.** `Disallow: /` opts a site out only
     inside a group addressed to `User-agent: *` or `User-agent: findit` (names case-insensitive).
     When a `findit` group exists it is the ONLY group findit obeys, as real crawlers pick the most
     specific group. `Disallow: /admin/` hides nothing, and an empty `Disallow:` allows everything. So
     `User-agent: Googlebot` + `Disallow: /` keeps a site listed, as on the real web. It applies to
     every page on a public `:80`, publishers included ("player or NPC", 97). Rejected: any
     `Disallow: /` line anywhere (simpler, but not how crawlers behave) and "any robots.txt opts
     out" (would hide the 80% of generated sites that ship one, breaking 92).
107. **The crawl leaves no trace.** Building the index reads journals and writes nothing, as
     slice 2's publisher index does: no `access.log` line on a crawled box. Rejected: logging the
     crawl on player boxes or everywhere (about 2 writes per listed box per search, and it leaks
     findit's search traffic to every listed player, undercutting 102's "findit's log is the prize").
108. **The player walk is a batched pre-filter.** Per search: ONE read of every stored public
     address (`network_public_ips`, minus publishers and findit), ONE batched read of their
     gateways' journals, and the full `curl` resolution (`resolveWebTarget`: occupants, leases, the
     reached box's journal) only for gateways that actually serve `:80`. The cost grows with the
     players really publishing, not with the networks ever joined. Rejected: a plain `curl` per
     stored address (about 2 reads per network ever joined, per search) and a stored listing table
     (a second authority that goes stale, which 97 rejected).
109. **One PR** (v0.271.0). Listing and the opt-out are one rule in 97: automatic listing is fair
     only because the owner can refuse it, so `main` never carries a crawler nobody can refuse.
     Rejected: 3a listing / 3b opt-out.

**Derived from existing conventions (not re-litigated):**

110. **Who counts as a player page.** Every stored public address whose network is neither a
     publisher (`publisherSite(essid)`) nor findit. A publisher's network stays on slice 2's path
     and is listed once, by its domain, whoever has joined it. "Player page" means "an address with
     no domain": it may be a player's own box, a generated box a player forwarded to, or a gateway
     serving its own page (98: the tell is deliberate).
111. **One batch, not two.** The stored gateways' ids join the publishers' in the SAME
     `findPatchesForMachines` call, so a search costs:
     - one stored-address read;
     - one journal batch;
     - one `resolveWebTarget` per stored gateway that serves `:80`;
     - one per repointed publisher (as today).

     The stored-address read is a new `api/network.ts` dependency at module scope, with no new
     `api/` file.
112. **"Serving" means what a `curl http://<ip>/` gets.** A gateway that the pre-filter finds serving
     `:80` (a forward, or itself) is resolved through `resolveWebTarget` exactly as a fetch is. A
     refusal, or a box with no `/index.html`, means no listing. An occupant who left the wifi drops
     out, unless the forwarded address holds a generated box that serves the web; then THAT box is
     what answers and what is listed (1c's fallback, unchanged).
113. **`robots.txt` is read from the box that serves the homepage**, through `resolveWebPath(
     '/robots.txt')` as the server (root) sees it. That means the site server for a publisher on its
     own forward, and the resolved target for everything else. A missing or unreadable `robots.txt`
     allows.
114. **A failed stored-address read yields NO index**, as a failed journal batch already does. A
     partial web would rank a site first because the sites above it went unread. One player's
     failed resolution (a 500 inside `resolveWebTarget`) drops only that page, as a repointed
     publisher's already does.
115. **A player's result is an ordinary `IndexedPage` whose `address` is the public IP.** It is
     linked `http://<ip>/`, the IP is on its own line, and an untitled page is titled by its IP.
     Ranking, the ten-result cap and the domain/IP tie order are unchanged, so players and
     publishers compete on the same words.

---

## Slice 3: a player's page is found — and can hide

**Value:** a player who publishes a page on their public `:80` is found by anyone searching findit for
its words, shown by title and bare IP. The same player can refuse the crawler with a `robots.txt`, as
on the real web, and so can an institution whose site somebody rewrote.

**Path:**
1. B's `curl`/`lynx` sends `resolveHttpFetch` to findit's address with `/?q=<term>`.
2. `answerSearch` → `indexedWeb`:
   - the stored addresses (new dependency);
   - one journal batch (publishers plus stored gateways);
   - a gateway pre-filter on `:80`;
   - `resolveWebTarget` for the survivors;
   - `/index.html` and `/robots.txt` read as the server.
3. `rankPages` → `searchResultsPage` → B's terminal. findit's own `access.log` records the search.
   Nothing is written on the crawled boxes.

**Class:** behavior change. **Delivery:** independent PR against trunk.

**Required implementation skills:** `tdd`, `testing`, `functional`, `refactoring` (after each
green), `typescript-strict`; `v2-e2e` for the closing browser run; `mutation-testing` at the
PR-readiness gate. **Reduction program:** `N/A`. **Transition/terminal evidence:** `N/A`.

**Acceptance criteria:**

- [ ] **A player's page is listed by its IP.** When a stored network's gateway forwards public `:80`
      to a box serving nginx with an `/index.html`, a search for a word on that page returns it with
      its `<title>`, its public IP on its own line, and a link to `http://<public IP>/`. An untitled
      page is titled by its IP.
- [ ] **It follows the page as it is served now.** A rewritten homepage is found by its new words at
      the next search. The page is absent whenever a `curl` of it would fail:
      - nginx stopped;
      - the box bricked;
      - its occupant left the wifi (with nothing generated answering at that address);
      - the forward deleted;
      - the gateway bricked.
- [ ] **Whatever answers the address is what is listed.** A gateway serving `:80` itself is listed
      by its IP. So is a forward onto a generated LAN box that serves the web.
- [ ] **`robots.txt` opts out as a real crawler reads it (106).**
      - `User-agent: *` + `Disallow: /` → absent; `User-agent: findit` + `Disallow: /` → absent,
        whatever the case of the name.
      - `User-agent: Googlebot` + `Disallow: /` → listed. `User-agent: *` + `Disallow: /admin/`
        → listed. An empty `Disallow:` → listed. No `robots.txt` → listed.
      - A `findit` group that allows, beside a `*` group that disallows → listed (the specific group
        wins). A `findit` group that disallows beside a `*` group that allows → absent.
      - Deleting the `Disallow: /` lists the page again at the next search.
- [ ] **Publishers obey it too.** A publisher whose site server's `robots.txt` is rewritten to
      `User-agent: *` / `Disallow: /` drops out. Every stock publisher is still listed (its generated
      `robots.txt` never disallows `/`).
- [ ] **A network nobody publishes on is never listed**, and a publisher's joined network is listed
      once, by its domain, never a second time by its stored IP.
- [ ] **Hostile titles stay text.** A player title of `<script>alert(1)</script>` appears escaped in
      the results page.
- [ ] **The crawl leaves no trace (107).** A search writes nothing to any crawled box's
      `access.log`, and findit's own log still records the search.
- [ ] **A failed stored-address read is an empty result set**, never a partial one (114).

**RED** (in this order; jsdom is not needed, everything is `core/`):
1. `core/findit/robots.ts`: a pure `crawlerMayIndex(robotsTxt: string | null): boolean` (the name is
   settled at RED). It gets one test per 106 case above, plus comments, blank lines, `\r\n`,
   duplicate groups and stray lines before any `User-agent`.
2. `publisherIndex.test.ts` (fake deps, the existing pattern):
   - a stored player network forwarding `:80` to a serving box is listed by IP;
   - a stored network forwarding nothing is absent;
   - a publisher's stored network is not listed twice;
   - a disallowing `robots.txt` hides a player page and a publisher page;
   - a stored-address read error returns no index.
3. `resolveHttpFetch.test.ts`, "findit.io answers a search":
   - through the handler, a player page ranks by its words and shows its IP;
   - a hostile title is escaped;
   - a crawled box's log is untouched while findit's gains the search line.

**GREEN:**
- the robots reader;
- a `listPublicAddresses` (name settled at RED) dependency on `PublisherIndexDeps` and
  `ResolveHttpFetchDeps`;
- stored gateway ids added to the one batch;
- the `:80` pre-filter on each stored gateway (`materializeApGatewayFs` → `canBoot` →
  `machineServing`);
- `resolveElsewhere` generalized to hand back the served homepage AND its `robots.txt` from the
  resolved target, so publishers and players are read one way;
- the `api/network.ts` adapter reading `network_public_ips` (`essid, public_ip`).

**REFACTOR:** assess whether `publisherIndex.ts` should be renamed now that it indexes more than
publishers (`webIndex.ts`), and whether the repointed-publisher path and the player path collapse
into one "resolve by address" step. Collapse only if both keep their tests unchanged.

**Wire-check:** extend `scripts/testFindit.ts` (live, `vercel dev` + supabase). Stage player A on a
crackable non-publisher ESSID: `registerNetwork` join state, a `forward 80 to <A's LAN IP>:80`
`rules.v4` on the gateway, and A's workstation journal running nginx with a titled `index.html`
carrying a unique word.
1. Searching for that word returns A's title and stored public IP.
2. A title rewrite is found by its new word.
3. The page is absent in turn after each of:
   - `User-agent: *` / `Disallow: /`;
   - after that is replaced by the Googlebot form, the page is listed again;
   - A leaving the wifi;
   - the forward deleted.
4. A publisher's rewritten `robots.txt` drops it out.
5. The crawled box's `access.log` gains no line from a search.
6. Record the batch's row count and the search's wall time against a single fetch, which answers
   the carried "search cost" risk.

`testPublisherWeb.ts`, `testHttpFetch.ts` and `testSharedApForwards.ts` must stay green.

**Browser:** `v2-e2e`, two named sessions:
1. **A** cracks and joins a non-publisher network, `su root`, `apt install nginx`, writes
   `/var/www/html/index.html` with a unique title, starts `nginx`, then `ssh root@<gateway>` (derived
   password, §4) and adds `forward 80 to <A's LAN IP>:80` to `rules.v4`.
2. **B** on another network runs `curl "findit.io/?q=<word>"` and gets A's title and IP, then `lynx
   "findit.io/?q=<word>"` and follows it to A's page.
3. A writes `robots.txt` (`User-agent: *` / `Disallow: /`), and B's next search no longer lists A.

**PRE-PR MUTATION:** Stryker (json reporter, capped concurrency, NO dev server running) on
`robots.ts`, `publisherIndex.ts` and the changed parts of `resolveHttpFetch.ts`. The most valuable
survivors to kill are the group choice (`*` versus `findit`, most-specific wins), the exact `/` match
versus a path prefix, the case fold, the publisher/findit exclusion, and the `:80` pre-filter.

**Done when:** all criteria checked; typecheck, lint and tests green; the wire-check passes live with
the cost numbers recorded; the browser run is recorded; mutation reviewed.

## Pre-PR Quality Gate

1. Implementation complete, refactoring assessed.
2. Mutation testing on the changed core files; valuable survivors killed.
3. `npm run typecheck` and `npm run lint` from `v2/` pass; `npm test` green.
4. Wire-check live (`api/network.ts` changes).
5. Version bumped in `package.json` + `package-lock.json` (v0.271.0).

## Risks

- **Search cost grows with the world.** The stored-address read returns every network ever joined,
  and the batch carries all their gateway journals, logs included. It is fine at pre-launch scale.
  The wire-check records row count and wall time. If it is too slow, the fallback is to narrow the
  gateway read to the paths the pre-filter needs (boot files and `rules.v4`), without changing the
  index's shape.
- **Player HTML reaches the page reader.** `readPage` strips tags with patterns, not a parser. It
  must stay total (never throw) on malformed markup and only ever feed text into escaped output. Add
  a malformed-markup case with a hostile title.
- **A player can outrank an institution** by stuffing words into their title. This is intended
  (96: "SEO as play"), not a defect.
- **The findit key in ESSID-shaped code** (carried): findit has no stored row, so the player walk
  never asks about it, but the exclusion is pinned by a test anyway.
