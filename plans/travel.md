# Plan: travel between towns

**Status**: Grilled and planned. Decisions confirmed by the owner 2026-10-23; three slices
planned 2026-10-23 (below the decisions). Next: Slice 1.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

A player stands in the town drawn from their key (`startingTown`, v0.428.0), and the join refuses
every network outside it, so a player never leaves home. Moving is the half of the backlog's
**Travel** item still open (`docs/backlog.md`, "Travel"): a stored location that overrides the
drawn town. It also gives JSC its first use, the open wallet follow-up "anything to spend JSC on",
and puts every town's siteless landmarks within everyone's reach.

## Where it starts from (facts, 2026-10-23)

- **Where a player stands is computed, never stored.** `startingTown(publicKeyHex)`
  (`core/generation/startingTown.ts`) has two consumers: the scan, drawn on the client
  (`generateWifi`, `wifiPoolOf(startingTown(key))`), and the join, checked on the server
  (`handleRegisterNetwork` refuses another town's network with `403 network_not_joinable`).
- **Each `airodump-ng` already makes one signed server call**, `resolveOccupiedEssids`, for the
  5% occupied-network injection. It degrades to an empty list on any failure, so a scan works
  with the server down.
- **A web fetch is signed** (`resolveHttpFetch.ts` verifies the envelope), so a site answered by a
  function knows the caller's key. talkit (`POST /post`, `POST /comment`) and hireme
  (`POST /apply`) already answer lynx form posts that way; hireme's `access.log` records the
  `POST /apply` line and never the form.
- **Eight fixed sites**, all `.io`: findit, hackademy, mapit, emailit, chainit, talkit, hireme,
  valleynews (`core/generation/fixedSites.ts`). A row gives a site a box with `http` and `ssh`,
  an address in `193`, a findit listing, `whois`, an uncrackable root opened only by a CVE, the
  guardian's patrol and the operator restore.
- **The JSC ledger** is keyed by address and names no player; a transfer is signed by the wallet
  key, never the identity, and carries no memo (`docs/wallet-architecture.md`). Amounts are
  whole numbers (`^[1-9][0-9]*$`). An address is `jsc` + 40 hex. Every transfer is public on
  chainit.io. The only source of JSC is the operator mint (`scripts/mintCoins.ts`); mission
  payouts and generated wallets are deferred.
- **Leaving a network** (`nmcli disconnect` → `handleUnregisterOccupant`) deletes the player's
  occupancy row and closes every connection through it: other players' sessions on the box,
  the sessions they opened from it, and the owner's sessions on every other machine. The
  owner's own sessions on their box stay open.
- **No content quotes a real-money price**; nothing yet anchors what a JSC is worth.
- **The valley's roads exist only as mapit's hand-drawn map**; the world holds no town positions
  or road graph.

## Decisions (owner-confirmed 2026-10-23)

1. **A player travels by buying a ticket on a website**, read with `lynx`, not by a new command.
   The world is a terminal and the web; a `travel` verb would have no Linux counterpart.
2. **The fare is paid in JSC to a payment address made for the player and their trip**, derived
   from their key and their trip count. The page quotes the fare and that address; the player
   runs `wallet send <address> <fare>`, returns to the page, picks a town and presses
   `[ Board ]`. The server sees the fare at the address, moves them, and counts the trip, so the
   next trip has a fresh address. Why an address per trip, not one rideit address: the ledger
   says only which address paid which, a wallet is not a player, and a claim "I paid from X"
   could be made by anyone reading chainit; proving it would need the boarding form signed by
   the wallet key plus a table of claimed transfers. The address IS the memo. Underpaying is
   refused, with how much has arrived; overpaying leaves the excess there, lost, as a mistyped
   address loses coins. Anyone who could work out the address could only pay the fare for its
   traveller, and nothing in the game shows a player's full key.
3. **No new source of JSC.** A fare is paid with coins the operator mints, or coins taken from
   another player's wallet. Wallets in the world (generated `wallet.dat` files holding a balance)
   and mission payouts are the natural ways to earn one later; both stay in the backlog.
4. **1 JSC = $1, as a design reference kept in the docs only.** Nothing in the game quotes a
   dollar price; the rate keeps every JSC amount believable, and whole-number amounts price
   anything from $1 up. The operator's usual 500 JSC mint reads as a $500 stake.
5. **One flat fare of 25 JSC to any town, direct**, held in one constant. A real regional coach
   or train across a county is $10–$40; 500 JSC buys twenty trips, enough to explore and too
   dear to hop casually. Fares by the destination's size or by distance along the roads were
   rejected: a second rule, and the roads are not data.
6. **Boarding is leaving.** Using a ticket applies exactly the `nmcli disconnect` rule: the
   occupancy row goes, every connection through it closes, `wlan0` goes down, and the player
   arrives offline. In the new town they scan, crack and join as on day one. A reload restores
   nothing, because the network they were on is in another town.
7. **The journey is instant, with no cooldown.** The next `airodump-ng` scans the new town. A
   timed journey would add a stored in-transit state the scan, the join and a reload must all
   respect, and cost only waiting; the fare already prices hopping.
8. **The site is `rideit.io`, a ninth fixed site**: one coach-and-rail booking service for the
   whole valley, in the `-it.io` family. Not a named operator (it breaks the family naming), and
   not Ridgemont Central Station's landmark site (a landmark's content cannot move, and every
   town needs a way out).
9. **Fares are burned.** A trip address has no key, so its coins never move again, and JSC leaves
   an economy that until now only grew. The payment shows on chainit as an ordinary transfer to
   an address nothing marks as rideit's. Rejected: the server holding the trip addresses' keys
   and sweeping fares into one public rideit address (takings visible on chainit, a target for
   whoever roots rideit), for its server-held key, second transfer per trip and secret to
   manage.
10. **rideit never names the player's town.** The starting-towns rule stands: the game says
    nothing about where a player stands. rideit lists every town, with no "From:", and a ticket
    to the town the player is already in is a valid trip: it costs a fare and the connection,
    and they arrive where they were. No warning; they learn by losing a fare.
11. **The scan's existing server call also answers where the player stands**: their stored town
    once they have travelled, their drawn town until then. No new endpoint and no client cache,
    so the scan and the join read one stored row and cannot disagree, and the town never sits in
    client storage. With the server unreachable the scan falls back to the drawn town; a join
    needs the server anyway, so nothing wrong can follow.
12. **rideit's box logs only the access line**: `POST /board` and the traveller's source address,
    the public address of the WiFi they boarded from, never the destination. A root on rideit
    learns that somebody on that network just left (a lead: `whois` names it), not where they
    went. **Backlog**: a booking log naming destinations, a tracking prize for whoever roots
    rideit.

## What follows without a decision

- **A stored location per player** (their town and their trip count) overrides `startingTown`
  for good, as the starting-towns grill planned; a player with no row stands in the drawn town
  with no trips taken. The join's `403 network_not_joinable` and the 5% injection both read
  where the player stands.
- **The traveller is the verified signer**, wherever their shell stands. Boarding from a shell on
  another machine moves the player, and closes that shell with the rest (decision 6).
- **rideit lists every declared town in every region**, so a town or region added later is a
  destination the moment it is declared. The 28 networks in no town are never a destination.
- **rideit is found on findit**, like every fixed site; nothing else points to it.
- **Until missions or wallets in the world ship, the operator mint is a traveller's only
  funding.**
- **Unchanged**: `startingTown` itself (a player who never travels keeps the drawn town, and a
  town added later still moves only players who never moved); the wallet command and the ledger
  (a fare is an ordinary `wallet send`).

## Slices

Three slices, each one PR against `main`, in order; each starts after the one before has merged.

1. **rideit.io stands in the valley** (v0.430.0): the ninth fixed site, a front page with the fare
   and every town, found on findit. No booking yet.
2. **A player boards a free ride to any town** (v0.431.0): `/ticket` and `POST /board` on
   rideit, a stored location the join and the scan read, and boarding is leaving. The fare is
   not charged yet.
3. **The ride costs 25 JSC** (v0.432.0): `/ticket` quotes the fare and the player's trip address,
   `POST /board` refuses until the fare has arrived there, and each trip takes a fresh address.

Why this split: the site alone is a fixed-site row plus a page, small and risk-free, and keeps
the big slice smaller. Moving and paying are separate behaviours on one path: Slice 2 proves the
stored location, the join, the scan and leaving end to end without the ledger, and Slice 3 adds
one gate in front of it. Between Slices 2 and 3 travel is free on prod for a few days; with two
or three players and no backward-compatibility burden that costs nothing (owner-confirmed 2026-10-23). The
alternative, Slices 2 and 3 as one PR, is one large review holding both the move and the payment.

### Facts read while planning (2026-10-23)

- **A fixed site is a row and an address.** `FIXED_SITES` in `core/generation/fixedSites.ts`
  (`key`, `domain`, hostname, place); `ADDRESS_BY_KEY` in `world.ts` gives each new site the next
  placeless address (after valleynews: `placelessAddress(8 + LANDMARK_CORPORATIONS.length +
  CORPORATIONS.length)`), so nobody else's address moves; `fixedSiteFs.ts` plants its front page.
  The hireme PR (#719) touched, beyond its own code: `api/network.ts`, `scripts/restoreSite.ts`,
  `whois.test.ts`, `webIndex.test.ts`, `fixedSiteFs.test.ts`, `persona.test.ts`,
  `world.test.ts`, and the handbook's codebase map, server doc and glossary.
- **A function-answered path** is matched in `resolveHttpFetch.ts` by the target's network and the
  exact path, before the box's own files (talkit's `/post`, hireme's `/apply`); a POST is logged
  as `POST <path>` and never with its form. The request is signed, so the handler has the
  caller's verified key.
- **The client reads a fetch answer as `{ ok, content, server }`** (`fetchPublicPage`,
  `adapters/networkApi.ts`); nothing in it can change client state today.
- **Leaving a network** has a server half, `deleteOtherOccupancies` + `dropConnectionsThrough`
  (already shared by the join, `registerNetwork.ts`, and `handleUnregisterOccupant`), and a
  client half in `nmcli disconnect`: `env.homeNetwork.leave(essid)` and
  `env.setInterface('wlan0', { …, association: null, ipv4: null })`.
- **The scan**: `generateWifi({ seedPubkeyHex, scanIndex, occupiedEssids })` calls
  `startingTown(seedPubkeyHex)` itself. The client draws it twice (`ui/state.ts`): once at boot
  with no server call, and on every `airodump-ng` after `resolveOccupiedEssids`.
- **The wallet's server read** is `deps.findBalance(address)` (`handleWalletBalance.ts`) over
  `wallet_balances`; an address with no row holds zero.
- **No table is keyed by the player alone**; `home_network_occupants` is `(essid, owner_key)`.

### Choices made while planning (owner-confirmed 2026-10-23)

- **The stored location** is `player_locations(owner_key PK, town, trips)`, RLS on with no
  policies like every table, written only through the Vercel function. `town` is a town name
  (`TOWNS`); `trips` counts trips taken. A player with no row stands in `startingTown(key)` with
  0 trips. One pure function answers where a player stands: `standingTown(row, key)`, the row's
  town or the drawn one. `startingTown` is unchanged.
- **rideit's pages**: `/` is a static, defaceable front page (the fare, every town, a link to
  `/ticket`), planted like talkit's. `/ticket` and `POST /board` are answered by functions on
  rideit's network and those exact paths. `/ticket` holds the booking form: a town (one choice
  per town, in the world's order, no "From:") and `[ Board ]`. Nothing names where the player
  stands.
- **Boarding, on the server, in this order**: refuse an unknown town (a page saying so, nothing
  changed); then leave (delete every occupancy row the player holds and `dropConnectionsThrough`
  each box, the join's own code); then write the location. Leaving first means a write that
  fails leaves a player disconnected where they were, never moved while still on a network in
  another town. The write names the trip count it read and fails if another boarding moved it
  first, so two boardings at once count one trip (Slice 3 relies on it: one fare, one trip).
- **The client learns it left from the `/board` answer**: the fetch answer gains a flag, and the
  client then takes `wlan0` down exactly as `nmcli disconnect` does, clearing the remembered
  connection so a reload restores nothing. Whether `lynx` run from a shell on another box can
  reach the player's own `wlan0` is read at the start of Slice 2; if it cannot, the adapter
  applies the flag, since it belongs to the player's tab whatever box the shell is on.
- **The scan takes the town**: `resolveOccupiedEssids` answers `{ essids, town }` and
  `generateWifi` takes `town` instead of computing it; the boot draw, with no server call, keeps
  `startingTown`. A traveller's boot draw therefore lists their drawn town until their first
  `airodump-ng`; `nmcli connect` to one of those is refused by the server, as any other town's
  network is.
- **The trip address** is `jsc` + the first 40 hex of `sha256("rideit-trip-<key>-<trips>")`. No
  key can be found for it, as none can for any address a key did not make.
- **The design rate** (1 JSC = $1) goes in `wallet-architecture.md`; the fare is one constant,
  `RIDE_FARE = 25`, in `core/rideit/`.

### Slice 1: rideit.io stands in the valley

**Branch**: `feat/rideit-site` · **Version**: 0.429.0 → 0.430.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`; no migration.

**Value.** A player who searches findit for a ride finds rideit.io; `lynx rideit.io` shows a
coach-and-rail service for the whole valley, the 25 JSC fare and every town. Its box is a fixed
site like the others: `whois`, `nmap`, the guardian's patrol, the operator restore, a CVE route
to root.

**Path.** `FIXED_SITES` row → `ADDRESS_BY_KEY` next placeless address → `fixedSiteFs` plants the
front page from `core/rideit/pages.ts` → findit's index lists it → `lynx` / `curl` fetch `/`
through `resolveHttpFetch` like any site.

**Acceptance criteria.**

1. rideit.io answers at the next placeless address, and no other network's address moves.
2. Its front page names the service, the 25 JSC fare to any town and every declared town, in the
   world's order, and never the town the reader stands in.
3. findit lists it; `whois` answers for its address; it has `http` and `ssh` and an uncrackable
   root, as every fixed site.
4. The operator restore script and the guardian's patrol cover it.
5. Every test, wire-check and budget that counts the fixed sites passes with nine.

**Increments.** (1) The row, the address and the front page, through the `fixedSites`, `world`,
`fixedSiteFs`, `webIndex`, `whois` and `persona` tests; criteria 1–3. (2) Restore and the
guardian; criterion 4. (3) Docs (handbook map and glossary, the fixed-site lists in `docs/`,
`project-status.md`) and the version; criterion 5 with the full gates.

**Evidence.** Unit tests, typecheck, lint, the bundle check; `lynx rideit.io` live against
`vercel dev` (or the existing fixed-site wire-check widened to nine). Mutation gate at PR
readiness over `core/rideit/`.

### Slice 2: a player boards a free ride to any town

**Branch**: `feat/travel-board` · **Version**: 0.430.0 → 0.431.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`; one migration (`player_locations`), pushed to jshack-dev
and jshack-prod at merge.

**Value.** A player opens `rideit.io/ticket`, picks a town and boards. Their WiFi drops and every
connection through it closes; their next `airodump-ng` shows the new town's networks, and the
join admits that town's and refuses every other, their drawn town included.

**Path.** `lynx rideit.io/ticket` → form → `POST /board` → `resolveHttpFetch` → `answerBoard`
(`core/rideit/`) → leave (occupancies + `dropConnectionsThrough`) → write `player_locations` →
page + the left flag → the client takes `wlan0` down. Then `airodump-ng` →
`resolveOccupiedEssids` answers `{ essids, town }` → `generateWifi({ town, … })`; and
`nmcli connect` → `registerNetwork` admits only `network.town === standingTown(row, key)`.

**Acceptance criteria.**

1. `/ticket` shows the form with every town and nothing naming where the player stands; `/` is
   unchanged.
2. Boarding to a declared town stores that town and answers a page saying the player has
   arrived. Boarding to anything else is refused with a page and changes nothing.
3. Boarding deletes every occupancy row the player holds and closes every connection through it,
   exactly as `nmcli disconnect` does; the player's own sessions on their own box stay open.
4. The client shows `wlan0` disconnected after boarding, and a reload restores no network.
5. After boarding, `airodump-ng` draws from the new town, the occupied network included, and the
   join admits only the new town's networks (`403 network_not_joinable` for the drawn town's).
6. A player who never boarded scans and joins exactly as today.
7. Boarding to the town the player stands in is a trip like any other: they leave and stay.
8. rideit's `access.log` records `POST /board` from the traveller's source address, never the
   town.
9. Two boardings at once by one player store one move and count one trip.

**Increments.** (1) `standingTown` and the join reading it; criteria 5 (join) and 6.
(2) `resolveOccupiedEssids` answering the town and `generateWifi` taking it; criteria 5 (scan)
and 6. (3) `answerBoard` with its deps: the town check, leaving, the guarded write; criteria 2,
3, 7 and 9. (4) `/ticket`, the routing in `resolveHttpFetch` and the log line; criteria 1 and 8.
(5) The left flag and the client taking `wlan0` down; criterion 4. (6) The migration, the adapter
wiring in `api/network.ts` and a wire-check, `scripts/testTravel.ts`: a player drawn into one
town joins a network there and a second player holds a session through it; the first boards to
another town; their occupancy row and the session are gone, a join in the first town is refused
and one in the second admitted, and the scan's call answers the second town; plus the doubled
boarding. (7) Docs and the version.

**Evidence.** Unit tests, typecheck, lint, the bundle check; `testTravel.ts` and
`testJoinRefusal.ts` against `vercel dev` + local supabase; mutation gate at PR readiness over
`core/rideit/`, the join check, `standingTown` and the scan's town.

### Slice 3: the ride costs 25 JSC

**Branch**: `feat/travel-fare` · **Version**: 0.431.0 → 0.432.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`; no migration (the trip count is Slice 2's column).

**Value.** A ride costs 25 JSC. `/ticket` shows the fare and the player's payment address for
their next trip; they `wallet send` the fare there, then board. Coins sent there never move
again.

**Path.** `/ticket` → `tripAddress(key, trips)` + `findBalance` → a page with the fare, the
address and what has arrived → `wallet send` (unchanged) → `POST /board` → `answerBoard` checks
`findBalance(tripAddress) >= RIDE_FARE` before it leaves anything → the guarded write moves
`trips` on, so the next `/ticket` shows a fresh address.

**Acceptance criteria.**

1. `/ticket` shows 25 JSC and the caller's trip address, the same address on every visit until
   they board, and how much has arrived there.
2. Boarding before the whole fare has arrived is refused with what has arrived ("10 of 25 JSC")
   and changes nothing: no leaving, no move.
3. With the fare arrived, boarding works as in Slice 2, and the next `/ticket` shows a different
   address.
4. One fare buys one trip: a second boarding on the same payment, at once or later, is refused.
5. Overpaying boards; the excess stays at the trip address.
6. Two players' trip addresses never coincide, and no page shows a player's key.
7. `wallet-architecture.md` records 1 JSC = $1 as the design rate, and the fare as the first
   thing JSC buys.

**Increments.** (1) `tripAddress` and `RIDE_FARE`; criterion 6. (2) `/ticket` quoting the address
and what has arrived; criterion 1. (3) The fare gate in `answerBoard`; criteria 2–5.
(4) `testTravel.ts` grows the fare: mint to a wallet; boarding refused unpaid and underpaid; pay;
board; a second boarding refused; the next address differs. (5) Docs, the backlog items
(wallets in the world, a booking log) and the version; criterion 7.

**Evidence.** As Slice 2, plus the fare cases live. Mutation gate over the fare gate and
`tripAddress`.

### Close-out (after Slice 3)

One browser run (`e2e` skill): a fresh player, an operator mint to their wallet,
`lynx rideit.io/ticket`, `wallet send` the fare, board to another town, `wlan0` down, the next
scan shows that town, crack and join one, and `whois` on its address names the new town. Then
this file's decisions move into `procedural-world-architecture.md` ("Where a player stands",
"Joining") and `wallet-architecture.md`, the Travel item in `backlog.md` closes with its
leftovers, and this file is deleted.

**Carried risk.** A tab closed between the `/board` answer and the client taking `wlan0` down
keeps the remembered connection, so a reload restores a network the server no longer counts the
player on. It is the same class as a `nmcli disconnect` whose fire-and-forget leave never landed,
and it clears at the player's next `nmcli disconnect` or `connect`.
