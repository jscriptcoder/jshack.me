# Plan: a JSC block explorer, at chainit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-16. No slice is planned
yet; slice 1 is next.
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
