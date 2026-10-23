# Plan: travel between towns

**Status**: Grilled. Decisions confirmed by the owner 2026-10-23. No slice is planned yet; the
slice plan is next.
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
