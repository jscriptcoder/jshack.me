# Plan: a JSC block explorer, at chainit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-16. Slice 1 is planned
below, its planning choices confirmed the same day, and is in progress.
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
    1. **The site and the address page**: the fixed-site row, the static front page and form,
       `/address?a=…` from the existing balance and history reads, the not-an-address page, the
       `man wallet` sentence. No migration. The front page links only to what exists.
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
