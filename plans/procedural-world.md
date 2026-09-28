# Plan: Procedural world

**Status**: Grilled. Decisions confirmed by the owner 2026-09-28; slices not yet planned.
Amends the §9 backlog item "Procedural world expansion — GRILLED & RESOLVED 2026-07-29" in
`docs/conventions-and-gotchas.md`; where the two disagree, this file wins.

## Goal

The world stops feeling empty. Beyond Ridgemont's hand-authored networks lies a declared,
procedurally generated world of regions, towns and networks: universities, shops, hospitals,
libraries, councils, police. Some publish a site findit.io lists, some publish one it does not,
and some publish nothing and wait to be found by following leads from other networks.

## Where it starts from (facts, 2026-09-28)

- The world is a pure function of a network key (today the ESSID). Any key already yields a LAN,
  gateways, a deep chain and persona-coherent content; an uncatalogued ESSID seeds its own
  persona. Only the journal of player changes is stored.
- `ESSID_CATALOG` holds 57 networks; 30 publish a site at a `193.x.y.z` address HASHED from the
  ESSID (distinct only because a catalog-wide test checks). Every player's scan draws 2–3
  crackable networks from that one pool, so every player effectively stands in one place.
- "Ridgemont" is flavour only: 11 catalog entries name it, and `pools/webSites.ts:40,90,526`
  hardcode it for the whole `public` and `retail` categories. Nothing models a town or a
  player's location.
- A joined network's public IP is drawn at random from 12 realistic first octets
  (`publicFirstOctets`) and kept unique by a database `UNIQUE` constraint with redraws. A
  player's public IP is the public IP of the network they are joined to.
- `nmap` scans ranges on the player's own LAN only (CIDR and foreign subnets refused).
  `nmcli connect` accepts only an ESSID in the current scan.
- findit crawls every publisher live on each search (~64 machines in one batched read).
- `discovery-architecture.md` records the internet-only network kind as deliberately not built,
  "open if publishers prove thin".

## Decisions (owner-confirmed 2026-09-28)

### World shape

1. **The 57 catalog networks stay as fixed, hand-authored landmarks.** Procedural networks are
   added alongside them, never replacing them. This amends 2026-07-29's "the current 50 become
   naming TEMPLATES": the procedural grammars borrow the catalog's categories and vocabulary, not
   its entries.
2. **The world is a map of towns.** A town has a name, map coordinates, its own public IP block,
   and a coherent institution set: at most one council, police force and courthouse, 0–1
   hospital or university, a library, N shops, clinics and schools. Ridgemont is town #0.
   Corporations are placeless and may have branches in towns. A town is signalled by its IP
   block, the addresses on its contact pages, and ping latency growing with distance. The
   `{town}` placeholder replaces the hardcoded "Ridgemont" in the category-wide site templates.
3. **Regions → towns → networks.** Every level is an append-only index, and a procedural
   network's key is shaped `r<i>/t<j>/n<k>`. A region has a name, its own map, a character that
   weights its towns' size class and category mix, and a reserved first octet. The whole world
   is one implicit fictional country, with no country level. Ridgemont is a town in region #0,
   the only region at launch. Adding a region or town changes no existing key, address, name or
   journal. The owner requires **no public-IP collisions, by construction** (decision 8).
4. **WiFi shows the town the player is in.** Every network in every town may broadcast an ESSID,
   unique within its town (two towns may each have a `CITY-HALL-WIFI`). A procedural network's
   key is separate from its ESSID; a landmark keeps key = ESSID; findit's key is already not a
   broadcast name. Until travel exists everyone is in Ridgemont, so other towns are reachable
   over the internet only.
5. **Ridgemont = the 57 landmarks + ~150–300 procedural filler** (homes, cafés, shop subtypes,
   clinics, small businesses), generated like any town except that an institution slot a
   landmark already fills is not generated. The scan keeps its size (2–3 crackable, 3–5 noise)
   and draws from one pool, filler appended after the landmarks so no existing position moves.
   Landmarks surface less often on WiFi, which is accepted: the sited ones stay reachable over
   the internet and the hacker-scene easter eggs should be rare. No landmark weighting. The
   occupied-network injector drops to a few percent of scans, one at a time, same town only
   (2026-07-29's call, now town-scoped).
6. **The world is finite and declared**, grown by appending towns to a region or a region to the
   world. The findit index, the reachability test, the map and the IP scheme each need to list
   every network. Launch extent: region #0 only, about 8–12 towns, each drawing a size class
   from its region's character (village ~10–25 networks, town ~30–80, city ~100–300; Ridgemont
   is a city), about 600–1,200 networks in all.
7. **Regions and towns are hand-authored rows; networks are procedural.** A town row gives name,
   map coordinates, size class and a flavour line; a region row gives name and character.
   Authored because `pick` maps one draw onto a pool's current length, so growing a pool renames
   what it drew, and a renamed town would move every domain, address and map label in it.
   Adding a town or region is appending a row, which is how new places arrive "from time to
   time". Everything inside a town (institution set, networks, names, profiles, content,
   relations) draws from streams keyed by the network key. Network name pools may be reshaped
   freely before launch and are frozen after it; post-launch names go into new pools that only
   new towns draw from.

### Addressing

8. **Every network's public IP is derived from its position in the world; the random allocator
   retires.**
   - Region → first octet: the 12 existing `publicFirstOctets` become region octets (region #0
     is `45`, #1 is `51`, …), so at most 12 regions and `isPublicIp` barely changes.
   - Town → second octet, a fixed permutation of the town index (at most 254 per region).
   - Network → the last two octets, a fixed permutation of the network index inside the town's
     `/16`, so addresses look scattered, not sequential. The fourth octet stays 2–254.
   - Placeless networks (findit, corporations) keep `193` as the placeless block, assigned by
     index instead of by hash.
   - Landmarks are re-addressed into Ridgemont's block, or `193` for the corporations. Allowed
     before launch.

   Distinct positions give distinct addresses, and nothing is drawn anywhere, so collisions are
   impossible rather than tested for. The reverse lookup `ip → key` becomes a pure function,
   generalising `publisherAt`. Retiring the allocator, and `network_public_ips` if the
   cross-player lookups allow it, is its own `reduce-system-complexity` slice; its one visible
   change is that existing addresses move once, before launch.

### Variety

9. **New categories arrive one per slice, healthcare first** (hospital, clinic, dentist), then
   education, finance, media, industrial and hospitality. Each fills every
   `Record<NetworkCategory, …>` pool in the same PR, as `government` and `retail` did.
10. **Subtypes are cheap variety inside a category**: a name grammar plus a vocabulary overlay
    for the site text and findit description (retail → bakery, pharmacy, bookshop, electronics,
    hardware, pawn, florist). A subtype adds no content pool.
11. **Three size profiles**, drawn on a new stream and weighted by category: `lone` (gateway and
    one box), `flat` (gateway and 2–5 boxes, no inner gateway, no deep chain) and `deep` (today's
    shape). A pawn shop is usually `lone`, a hospital usually `deep`. Landmarks keep their shape.

### Discovery

12. **The category decides who publishes**, as today: institutions always, businesses mostly,
    homes never. About 15% of publishers are unlisted: they serve `robots.txt` `Disallow: /`,
    so they answer by name or address while findit never lists them.
13. **The first discovery routes** are findit for listed sites; a **town hub**, where each
    town's `.gov` site has a directory page linking every institution in the town, listed or
    not; cross-network references (decisions 14–15); and a **`whois <ip|domain>`** command that
    answers organisation, town and region from the derived address. Later, each with its own
    grill: hidden ESSIDs joined by a name learnt elsewhere (needs `nmcli` to accept a known
    name missing from the scan), and a hacker BBS posting leads. **Rejected**: sweeping public
    ranges with `nmap`, which would make every other route pointless.
14. **World-content rule 3 loosens without being dropped.** A reference may cross networks, but
    only to one of the network's declared relations, and only by public address or domain,
    never another network's LAN addresses. "Every reference is true" still holds.
15. **A relations graph links networks.** Each procedural network has 0–3 directed relations
    on a new stream: supplier, IT contractor (a managed-service provider whose `.ssh/config`
    names its clients), parent or branch, offsite backup. They surface in content that already
    exists: a crontab rsyncing to a backup host, an invoice on a share, a supplier's domain in a
    mail thread. Relations are drawn from the target's side, so every unlisted or unpublished
    network has at least one incoming reference, and a test proves every network reachable from
    findit plus Ridgemont.

### Engineering

16. **findit splits its index.** Publishers with no patches are listed from a pure, memoised
    index derived from generation; only patched publishers (possibly defaced, dark or stopped)
    get the live batched read. A search then costs what players have touched, not the size of
    the world.
17. **World-wide tests sample the world instead of sweeping it**; `scripts/checkBudgets.ts` keeps
    its landmark sweep and adds a sampled procedural one.
18. **No go-live clock.** Adding a town is already a one-row deploy (decision 7); a second
    mechanism for the same need is not built.

### Order

19. **Slice order**:
    1. Walking skeleton: the world declaration (region #0 holding Ridgemont and one new town),
       network keys, derived town-block addresses, and one internet-only town built from the
       existing categories in the `flat` and `deep` profiles, whose `.gov` hub findit lists and
       which links the rest. The `{town}` placeholders land here.
    2. Re-address the landmarks and retire the allocator (`reduce-system-complexity`).
    3. `whois`.
    4. Relations, the rule-3 loosening and unlisted sites.
    5. The `lone` profile and subtypes.
    6. The healthcare category.
    7. The remaining towns, the findit index split and the sampled budgets.
    8. Ridgemont's WiFi filler and the injector turned down.

## Later epics (each needs its own grill)

- **The map**, with fog of war: Ridgemont lit, a town appearing once one of its networks is
  touched. Needs the first per-player exploration record: where it is stored and what counts as
  "found". The world map of regions waits for a second region.
- **Travel** between towns and regions: joining another town's WiFi gives another public IP,
  since the address belongs to the network. Needs a server-authoritative player location.
- Hidden ESSIDs learnt by name; a hacker BBS; the categories after healthcare.
