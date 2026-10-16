# Plan: a JSC block explorer, at chainit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-16. Slice 1 shipped at
v0.393.0 (#690, 2026-10-16); slice 2 is planned below and awaits the owner's go.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

The public JSC ledger as a web page anyone can browse with `curl` or `lynx`: an address's balance
and history, the latest transfers across the whole chain, and the richest addresses. It builds on
the shipped wallet (`docs/wallet-architecture.md`) and is the first site to show what other
players have done.

## Where it starts from (facts, 2026-10-16)

Read in the code on this date.

- **A fixed site is a row.** Adding one to `FIXED_SITES` (`generation/fixedSites.ts`) gives it a
  box with `http` and `ssh`, a public address, a findit listing and operator restore. Its static
  pages are files planted by `WEB_ROOTS` in `generation/fixedSiteFs.ts`.
- **Two paths answer from a function, not a file**: findit's `/?q=` search and emailit's
  `POST /signup` (`network/resolveHttpFetch.ts`). Rooting either box defaces its files but cannot
  fake a search result or break sign-up; a dark or bricked box takes both down with it.
- **Every web fetch logs a line** in the serving box's `access.log`, a 404 included.
- **The ledger already answers two public reads** (`api/wallet.ts`): an address's balance, and its
  latest 20 transfers newest first. There is no read for transfers across the whole chain, nor
  for the largest balances. The history indexes are `(from_address, id DESC)` and
  `(to_address, id DESC)`.
- **There are no blocks.** A transfer is a row ordered by `id`; a mint is a row with a NULL
  sender, shown as `coinbase` by the `wallet` command.

## Decisions (owner-confirmed 2026-10-16)

1. **chainit.io is a fifth fixed site whose ledger views answer from a function.** Its own box,
   `http` and `ssh`, attackable like every machine. A root can deface its files but cannot forge
   what the ledger says, so the site and `wallet balance` never disagree. Rejected: laying the
   views under the box's journal as emailit's spool is, which would make the public ledger only
   as honest as the last person to root the explorer.
2. **Three views: an address page, recent transfers, and the rich list.** The address page shows
   the balance and history in `wallet history`'s wording, every address a link to its own page.
   Recent transfers is the latest movements across the chain, mints included. The rich list is
   the largest balances, largest first. No per-transfer page: a transfer holds nothing its line
   does not already show.
3. **The front page is a static `index.html` on chainit's disk**, as findit's is: the address
   lookup form and links to `/recent` and `/rich`. A root can deface it (or repoint its form and
   links); only the view paths carry ledger numbers. Rejected: `/` as the live recent view, which
   would make chainit the one site whose front door a root cannot change.
4. **The views live at `/address?a=<jsc…>`, `/recent` and `/rich`.** A lynx GET form can only
   submit `action?name=value`, so the form (`action="/address" method="GET"`, input `name="a"`)
   and every address link share the one query shape. These three paths always answer from the
   function, even when a root plants a file of the same name; every other path is a file.
   Rejected: a path-shaped `/address/jsc…` beside the query one — two URLs for one page.
5. **The address page shows the latest 20 transfers, no paging** — the same read and limit as
   `wallet history` (`handleWalletHistory`), so the site and the command show the same lines.
   Rejected: an "older" link (`&before=<id>`), a new query shape and a site that shows more than
   the command.
6. **`/recent` shows the latest 20 transfers across the chain, newest first, both ends on each
   line**: `2026-10-16 09:12  500 JSC  coinbase -> jsc…`. Addresses in full (a player copies
   them into `wallet send`), each a link to its address page; `coinbase` is not a link. Times in
   UTC, as the command prints them. One new query, ordered by `id`, which the primary key covers.
7. **`/rich` shows the 20 largest non-zero balances, largest first, ties ordered by address**,
   one line each: rank, address (a link), balance. An emptied address drops off. Nothing else on
   the page. Rejected: share of supply or transfer counts, a second query per view for no play.
8. **Bad input on `/address`.** A well-formed address the ledger has never seen answers
   `0 JSC` and "No transfers." and writes nothing. A missing `a`, or text that is not
   `^jsc[0-9a-f]{40}$` after trimming, answers "Not a JSC address: `<escaped input>`" with the
   lookup form under it; uppercase is refused, not lowercased, as `wallet send` refuses it. Both
   are 200, as findit's "No matches" is.
9. **Views are logged like any fetch, query included.** `access.log` keeps `/address?a=jsc…`
   beside the visitor's source IP, so a root on chainit can tie addresses to the IPs that keep
   checking them. Nothing warns the player. Rejected: dropping the address from logged paths,
   which removes the one thing worth rooting chainit for.
10. **The chain-wide views live only on chainit.io; `wallet` keeps its four subcommands.**
    Watching the whole chain therefore leaves a line in chainit's log, and avoiding that means a
    hop or a root. Rejected: `wallet recent` / `wallet rich`, which would bypass the trace.
11. **A root on chainit finds the defaceable front page and the access log, nothing more.** No
    ledger files (the views are a function over the database) and no planted wallet: a funded
    key on a fixed site would reopen "generated boxes hold no loot", parked as its own story in
    `backlog.md` ("generated wallets as loot").
12. **Names.** Title `chainit.io - the JSC block explorer`; findit description "Look up any JSC
    address: its balance and its transfers. The latest transfers on the chain, and the richest
    addresses."; fixed-site row `chainit.io` / hostname `chainit` / place
    `{ category: 'hacker', place: 'the counting house' }`. Pages say JSC, never coins or tokens.
13. **Discovery: findit lists it, and `man wallet` ends with one sentence**: "The same ledger can
    be read on the web at chainit.io: any address, the latest transfers, and the richest
    addresses." No hackademy page. The manual says nothing about the log.
14. **Two slices, one browser run at the close-out.**
    1. ✅ **The site and the address page** (v0.393.0, #690): the fixed-site row, the static front
       page and form, `/address?a=…` from the existing balance and history reads, the not-an-address
       page, the `man wallet` sentence. No migration. The front page links only to what exists.
    2. **The chain-wide views**: `/recent` and `/rich`, their two new ledger reads (and a balance
       index if planning finds it worth having, through `jshack-dev` then `jshack-prod`), the
       front page's links to them, and the wire-check that proves them.

## Follows from the decisions

- **A dark or bricked chainit takes all three views down**, as a bricked findit takes search
  down; `wallet balance` and `wallet history` keep working, since they ask `api/wallet.ts`
  directly. The remedy is the operator's `scripts/restoreSite.ts chainit.io`.
- **A fixed site's root is uncrackable**; the way in is a root-tier CVE, as for the other four.

## Slice 1 plan: chainit.io and the address page

**Branch**: `feat/chainit-address-page` · **Version**: 0.392.0 → 0.393.0 · **Class**: behaviour
change · **Delivery**: one PR against `main`, no migration.

**As built (2026-10-16, #690, merged as `a9edc50e`).** Shipped as planned, with these changes:

- **A failed read is decided by the parse alone.** `answerAddress` dropped its `status !== 200`
  checks: a handler's error body parses as neither a balance nor a history, so the checks were
  redundant (Stryker showed no test could tell them apart).
- **The query is read through `URL`** (`new URL(path, 'http://chainit.io').searchParams`), not by
  slicing at `?`; the slicing's branch was equivalent under every input.
- **The front page has one line under the form** saying what the site is ("The public ledger of
  JSC. …"), and every page closes its form with a `Look up` button and an `<hr>`.
- **chainit's address is `193.41.222.56`**, pinned in `world.test.ts` beside the other fixed
  sites; adding the domain moved no drawn name and no address.
- **`scripts/testChainit.ts` (15 checks) bricks chainit and runs the real
  `scripts/restoreSite.ts chainit.io`**, rather than wiping the journal by hand. A tombstone row is
  `content: null` with `node_type: 'file'`, as `removePatch` writes it; the table refuses a null
  `node_type`.
- No migration. Mutation 110 killed, 1 timeout, 24 survived of 135 at first; after three tests
  and the two simplifications `answerAddress.ts` is 21/21 and every changed line outside
  `pages.ts` is killed. `pages.ts` keeps 8 markup survivors no reader can tell apart; its
  module-load front-page mutant was checked by hand.

**Value.** A player can open `chainit.io` in lynx or curl, type any JSC address into its form, and
read what that address holds and its latest 20 transfers, with each address at the other end a
link to follow. Coins taken off a box can be traced hop by hop in the browser, and every lookup
leaves a line in chainit's access log.

**Path.** `lynx`/`curl` → the signed `resolveHttpFetch` → `handleResolveHttpFetch` resolves
`chainit.io`'s address to its one box, as for every fixed site → a GET to `/address` on chainit's
network asks the ledger (balance and history, read in parallel) and answers with a page; every
other path is a file under `/var/www/html` → the hit is logged in chainit's `access.log` either
way.

### Facts read while planning (2026-10-16)

- **A fixed site's address is its place in a list** (`ADDRESS_BY_KEY`, `generation/world.ts`):
  each new site takes the next placeless address after the last, "so nobody moves". emailit holds
  `placelessAddress(3 + …)`; chainit takes `4 + …`.
- **Fixed-site domains are held back from drawn business names** (`namedOf`, `world.ts`), so a new
  domain changes a draw only if that draw would have spelled `chainit.io`.
- **These follow from the row, unchanged:** the findit listing (`FIXED_LISTINGS`,
  `findit/webIndex.ts`), `whois` (`commands/whois.ts`), the persona (`generation/persona.ts`), the
  gateway's hostname (`resolvePublicTarget.ts`), the router's fs (`routerFs.ts`) and
  `scripts/restoreSite.ts`.
- **The ledger's reads are already in core.** `handleWalletBalance` and `handleWalletHistory`
  (`core/wallet/`) hold the row schemas and the rule that one bad row spoils a list; their deps
  are `findBalance(address)` and `findTransfers(address, limit)`, which `api/wallet.ts` builds as
  two small selects.
- **Every `api/*.ts` file is an endpoint** (conventions §4), so `api/network.ts` cannot import
  `api/wallet.ts`'s queries; it builds its own at module scope.
- **`wallet history`'s line is a private `historyLine`** in `commands/wallet.ts`:
  `2026-10-11 22:07  +500 JSC  from <address>` / `…  -N JSC  to <address>`; `balance` prints
  `<address>  <n> JSC`.
- **lynx renders links inside `<pre>`** (`renderPreformatted`, `ui/renderPage.ts`) and keeps the
  spacing; curl shows the markup as it is.
- **A failed sign-up is a 500 with no log line** (`signup_failed`); the client reads any 500 as
  `network_error`.

### Choices made while planning (owner to confirm with the plan)

- **One line, two readers.** `historyLine` moves to `core/wallet/historyLine.ts` and takes an
  optional way to write the address at the other end. The command passes nothing; the page wraps
  the address in `<a href="/address?a=…">`. The site and `wallet history` cannot word a transfer
  differently. (Addresses and times are fixed-shape text, so nothing in a line needs escaping.)
- **The page reuses the handlers.** `core/chainit/answerAddress.ts` calls `handleWalletBalance`
  and `handleWalletHistory` with the fetch's own `findBalance` and `findTransfers` deps, so the row
  parsing and the 20 are the wallet's, not a copy.
- **The ledger part of the page is one `<pre>`**, as the command prints it: the balance line
  (`<address>  <n> JSC`), a blank line, then the history lines, or `No transfers.` for an address
  with none.
- **Every chainit page opens like findit's**: `<h1>chainit.io</h1>` and the lookup form, re-filled
  with what was asked, then an `<hr>`. Titles: front page `chainit.io - the JSC block explorer`
  (with the meta description, decision 12), address page `<address> - chainit.io`, refusal
  `Not a JSC address - chainit.io`. Slice 1's front page has the form and nothing to link to yet.
- **Only `GET /address` exactly is the ledger's.** `/address/` and `/address.html` are files like
  any other path; a POST to `/address` gets the 405 every server gives.
- **A failed ledger read is `500 ledger_lookup_failed` with no log line**, as a failed sign-up
  is. A page claiming `0 JSC` for an address the ledger could not read would be a lie a player
  acts on.
- **The two reads are duplicated in `api/network.ts`** at module scope, word for word as
  `api/wallet.ts` has them. A shared module outside `api/` waits for a third reader.

### Acceptance criteria

1. `curl http://chainit.io/` prints the front page: its title and meta description, the `<h1>`,
   and a form `action="/address" method="GET"` with a text input `name="a"`. In `lynx chainit.io`,
   submitting the form opens the address page.
2. A findit search for `jsc`, `explorer` or `balance` lists `chainit.io` with its description;
   `whois chainit.io` answers; chainit's address is in the 193 block and no other network's
   address changed.
3. `/address?a=<address>` for an address minted 500 that then sent 40 shows `<address>  460 JSC`,
   then `-40 JSC  to <dest>` above `+500 JSC  from coinbase`, each line exactly as
   `wallet history` prints it; `<dest>` is a link to `/address?a=<dest>` and `coinbase` is not a
   link. An address with more than 20 transfers shows the latest 20.
4. A well-formed address the ledger has never seen shows `<address>  0 JSC` and `No transfers.`,
   and no row is written to `wallet_balances`.
5. A missing `a`, a blank one, `hello`, a 39-hex address and an uppercase one each answer 200 with
   `Not a JSC address: "<input, escaped>"` and the form re-filled with it; `<script>` comes back
   as `&lt;script&gt;`. Spaces around a good address are trimmed and it is looked up.
6. Every `/address` hit is a line in chainit's `access.log` with the full query and the visitor's
   source IP (home, or the hop it came from), as for any fetch.
7. A root on chainit who writes `/var/www/html/address` does not change `/address?a=…`; a rewritten
   `index.html` is served at `/`.
8. **The operator can restore chainit like any fixed site.** `scripts/restoreSite.ts chainit.io`
   (and `testRestoreSite.ts chainit.io`) accept the domain; after a defacement, a planted file, a
   stopped web server or a brick, the restore closes every open session, empties the journal
   (the `/boot` tombstone and the logs with it) and writes a fresh boot marker, and chainit
   serves its generated front page and the ledger's `/address` again. The ledger is never
   touched. The script's usage comment names chainit.io with the others.
9. A chainit whose web server is stopped, or whose box is bricked, answers no `/address` at all,
   and `wallet balance` still answers.
10. When the ledger cannot be read, `/address` is a 500 and nothing is logged.
11. `man wallet` ends with: "The same ledger can be read on the web at chainit.io: any address,
    the latest transfers, and the richest addresses."
12. Every other fixed site, and every other path, is served exactly as before.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **`historyLine` moves to `core/wallet/`** with its optional address writer: a refactor under
   the command's green tests, plus a test for the writer.
2. **chainit's pages in core.** `core/chainit/pages.ts`: the front page, the address page from a
   balance and transfers, and the refusal page; pure, with escaping. Criteria 1 and 3–5 at the
   page.
3. **chainit.io is a fixed site.** The `CHAINIT` row last in `FIXED_SITES`, its address after
   emailit's, `index.html` in `WEB_ROOTS`. Criteria 2 and 12 in the `fixedSiteFs`, `webIndex`,
   `world` and `whois` tests.
4. **The fetch answers `/address` from the ledger.** `findBalance` and `findTransfers` in
   `ResolveHttpFetchDeps`, `core/chainit/answerAddress.ts`, the branch beside findit's search.
   Criteria 3–7 and 9–10 at the handler with fake deps.
5. **The adapter and the wire-check.** The two selects in `api/network.ts`; a new
   `scripts/testChainit.ts`; `testRestoreSite.ts chainit.io`. Criteria 1–10 live.
6. **`man wallet`, docs, version 0.393.0.** Criterion 11; `restoreSite.ts`'s usage comment;
   the handbook's codebase map (`chainit/`, `restoreSite.ts`'s list) and glossary;
   `docs/project-status.md`.

### Evidence

- Unit: `historyLine` both ways; the pages (the front page form, address-page lines and links, an
  empty history, each refused input, escaping); the fixed-site row (the box has `http` and `ssh`,
  `index.html` is the front page, address placement, findit listing, `whois`); the handler with
  fake deps (a GET `/address` reads the ledger and logs the full path, a planted file does not
  shadow it, a dark box answers nothing, a failed read is a 500 with no log line, a POST is a 405,
  another site's `/address` is a file).
- Wire-check: a new `scripts/testChainit.ts` against `vercel dev` + supabase. It mints to a fresh
  address with `wallet_mint` and moves some on with `wallet_transfer` (service role); fetches the
  front page, the funded address, an unseen one and each refused input through `/api/network`;
  checks the lines against `/api/wallet`'s history, that the unseen address left no row, and the
  access-log lines; plants `/var/www/html/address` as a root patch and finds the ledger page
  unchanged. `testRestoreSite.ts chainit.io` runs the real restore on a rooted, defaced chainit and
  finds the front page back, the journal down to one fresh boot marker and every session closed;
  a brick and a stopped web server live in that same journal, so emptying it undoes them too
  (the unit tests on `canBoot` and the service gate already prove a box with an empty journal
  boots and serves). `testChainit.ts` checks `/address` answers again after the wipe.
  `testFindit.ts`, `testHttpFetch.ts` and `testWallet.ts` re-run.
- Pre-PR: Stryker on the changed lines of `core/chainit/`, `core/wallet/historyLine.ts`,
  `fixedSites.ts`, `world.ts` and `resolveHttpFetch.ts`; typecheck; lint; the full test run.
- No browser run here; the close-out run after slice 2 roots chainit and reads who looked up whose
  address.

## Slice 2 plan: the latest transfers and the richest addresses

**Branch**: `feat/chainit-chain-views` · **Version**: 0.393.0 → 0.394.0 · **Class**: behaviour
change · **Delivery**: one PR against `main`, no migration.

**Value.** A player on chainit.io follows the front page's two links and reads the 20 latest
transfers across the whole chain and the 20 richest addresses, every address a link to its page.
Fresh mints, big movers and the fattest wallets are visible from one box, and every look at
them leaves a line in chainit's access log.

**Path.** `lynx`/`curl` → the signed `resolveHttpFetch` → `handleResolveHttpFetch` resolves
chainit's box → a GET to `/recent` or `/rich` on chainit's network asks the ledger and answers
with a page (as `/address` does); every other path is a file → the hit is logged in chainit's
`access.log`.

### Facts read while planning (2026-10-16)

- **`/recent` needs no index.** `wallet_transfers.id` is the primary key, so the latest 20 by
  `id DESC` is a walk down that index.
- **`wallet_balances` has no index but its primary key `address`**, and one row per address ever
  paid (a mint or a transfer in). Emptying an address leaves its row at `balance = 0`.
- **The transfer row's schema and its row → record mapping are private** to
  `handleWalletHistory.ts` (`transferRowSchema`, the `map` in the handler), and a history line's
  time (`2026-10-11 22:07`) is cut inline in `historyLine.ts`.
- **slice 1's routing is one `if`** in `handleResolveHttpFetch`: chainit's network and
  `pathOf(path) === '/address'` → `answerAddress(path, deps)`; null → `500 ledger_lookup_failed`
  and no log line; else a 200 logged like any fetch.
- **`testChainit.ts` funds the ledger through the service role** (`wallet_mint`,
  `wallet_transfer` with an explicit sequence) and deletes its own addresses' rows before and
  after.

### Choices made while planning (owner to confirm with the plan)

- **No balance index, so no migration.** The rich list reads
  `wallet_balances WHERE balance > 0 ORDER BY balance DESC, address LIMIT 20`. Without an index
  Postgres scans the table once and keeps the top 20 in memory; the table holds a few rows per
  player, so that scan is far below the cost of the fetch around it. A partial index
  `(balance DESC, address) WHERE balance > 0` is one migration that changes no behaviour, kept
  for the day a query plan asks for it. Nothing goes through `jshack-dev` or `jshack-prod`.
- **Two new reads beside the two from slice 1**: `findLatestTransfers(limit)` and
  `findLargestBalances(limit)`, deps of the fetch with `data: unknown` as `findTransfers` has.
  `api/network.ts` builds them as two selects, ordered by `id` desc, and by `balance` desc then
  `address` asc with `balance > 0`.
- **One transfer parse for both lists.** `handleWalletHistory.ts` exports the parse it already
  does (rows → records, `null` when any row is not a transfer); history and `/recent` both call it,
  so a mint is a null sender and a time is UTC the same way on both. `historyLine.ts` exports the
  `2026-10-11 22:07` cut for `/recent`'s lines.
- **`core/chainit/chainViews.ts` answers both views**: `answerRecent(ledger)` and
  `answerRich(ledger)`, each the page or `null` when the ledger could not be read or a row does not
  parse (one bad row spoils the list, as for a history). The 20 is a constant there.
- **The three view paths are one table.** The `if` becomes a lookup of `pathOf(path)` in a `Map`
  of chainit's three views; a hit answers from the ledger, a miss falls through to files. Failure
  and logging stay as slice 1 built them: `500 ledger_lookup_failed` with no log line, or a 200
  logged with the full path. Only `GET /recent` and `GET /rich` exactly: `/recent/`, `/rich.html`
  are files, a query string is ignored by the view and kept in the log, a POST is the 405.
- **The pages**, each opening with the empty lookup form and `<hr>` as every chainit page does,
  then one `<p>` saying what the list is and one `<pre>`:
  - `/recent`, title `Latest transfers - chainit.io`, caption `The latest 20 transfers on the
    chain, newest first.`; lines
    `2026-10-16 09:12  500 JSC  coinbase -> <a href="/address?a=…">jsc…</a>` (`<from> -> <to>`,
    both links, `coinbase` plain); an empty chain says `No transfers.`
  - `/rich`, title `Richest addresses - chainit.io`, caption `The 20 richest addresses, largest
    first.`; lines ` 1  <a href="/address?a=…">jsc…</a>  12000 JSC`, the rank padded to two so the
    addresses line up; an empty ledger says `Nobody holds any JSC.`
- **The front page gains one line of links** under its sentence:
  `<p><a href="/recent">Latest transfers</a> | <a href="/rich">Richest addresses</a></p>`. The
  view pages do not repeat it (decision 3 puts the links on the front page). The front page is
  generated, so every undefaced chainit serves the new one at once; a defaced one gets it back
  from `restoreSite.ts`.

### Acceptance criteria

1. `curl http://chainit.io/` shows links to `/recent` and `/rich`; in `lynx chainit.io` following
   each opens its view. findit's listing of chainit is unchanged.
2. `/recent` lists the latest 20 transfers across the chain, newest first by `id`, one line each
   as `2026-10-16 09:12  500 JSC  <from> -> <to>`, time in UTC; both addresses link to their
   address pages; a mint reads `coinbase`, not a link. Fewer than 20 shows them all; none shows
   `No transfers.`
3. `/rich` lists the 20 largest non-zero balances, largest first, equal balances by address; each
   line is the rank, the address as a link, and `<n> JSC`. An address emptied by a transfer is not
   listed. An empty ledger shows `Nobody holds any JSC.`
4. Every `/recent` and `/rich` hit is a line in chainit's `access.log` with the path as asked and
   the visitor's source IP, as for any fetch.
5. A root on chainit who writes `/var/www/html/recent` or `/var/www/html/rich` changes neither
   view; `/recent/` and `/rich.html` are files; a POST to either is the 405.
6. When the ledger cannot be read, or a row it hands back does not parse, the view is a 500 and
   nothing is logged.
7. A chainit whose web server is stopped, or whose box is bricked, answers neither view;
   after `scripts/restoreSite.ts chainit.io` both answer again.
8. Every other site serves `/recent` and `/rich` from its files (a 404 where there is none), and
   `/address`, `wallet history` and `wallet balance` answer as before.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **Share the transfer parse and the line's time.** A refactor under the history handler's and
   `historyLine`'s green tests: the exported parse in `handleWalletHistory.ts`, the exported time
   cut in `historyLine.ts`.
2. **The two pages and the front page's links.** `recentPage` and `richPage` in
   `core/chainit/pages.ts`, pure. Criteria 1–3 at the page (lines, links, `coinbase`, ranks,
   both empty states).
3. **The fetch answers `/recent` and `/rich`.** `findLatestTransfers` and `findLargestBalances` in
   the fetch's deps, `core/chainit/chainViews.ts`, the three-view table in
   `handleResolveHttpFetch`. Criteria 2–8 at the handler with fake deps.
4. **The adapter and the wire-check.** The two selects in `api/network.ts`; `testChainit.ts`
   extended. Criteria 1–7 live.
5. **Docs and version 0.394.0.** The handbook's server-and-database row for `resolveHttpFetch`,
   the codebase map's `chainit/` row, `docs/project-status.md`.

### Evidence

- Unit: the shared parse and time under the existing history tests; the pages (each line shape,
  links and `coinbase`, rank padding, both empty states, the front page's links); the views with
  fake reads (the limit asked for, order kept as read, a failed read and a bad row → null); the
  handler (each view read and logged with its full path, a planted file does not shadow it,
  `/recent/` is a file, a POST is a 405, a dark box answers nothing, a failed read is a 500 with no
  log line, another site's `/recent` is a file).
- Wire-check: `testChainit.ts` gains checks against `vercel dev` + supabase. It reads the largest
  balance on the ledger, then mints that plus 1000 to two fresh addresses (a tie) and that plus
  500 to a third, which then sends it all on; `/rich` lists the tie first and second in address
  order and not the emptied one. Its latest mints and the transfer are the top lines of `/recent`,
  `coinbase -> ` included, in `id` order, matching `/api/wallet`'s history of each. Both hits are in
  the access log; planted `recent` and `rich` files change neither; after the restore both answer.
  The new addresses join its cleanup. `testRestoreSite.ts chainit.io`, `testFindit.ts`,
  `testHttpFetch.ts` and `testWallet.ts` re-run.
- Pre-PR: Stryker on the changed lines of `core/chainit/`, the shared parse and time in
  `core/wallet/`, and `resolveHttpFetch.ts`; typecheck; lint; the full test run.
- No browser run in the slice. The epic's close-out, after this merges, is one browser run (root
  chainit, read in its log who looked up whose address and who watched the rich list) and moving
  this plan's lasting content into `docs/`.
