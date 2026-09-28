# Plan: Procedural world

**Status**: Grilled and gap-reviewed (find-gaps) 2026-09-28; slices not yet planned.
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

**The world-content rules bind every procedural network.** All 16 standing rules in
`world-content-architecture.md` apply unchanged, except rule 3 as loosened by decision 14. Two
readings made explicit: rule 8's persona comes from the network's declared category and subtype,
never from the uncatalogued-ESSID seed; and rule 2 ("no new player verbs") binds *content*, so
`whois` is this epic's one deliberate new command, a discovery tool rather than content. Rule
11's "every concern draws on its own new stream" covers every new draw here: profiles, names,
relations, forwards, institution sets. (Added by find-gaps 2026-09-28.)

### World shape

1. **The 57 catalog networks stay as fixed, hand-authored landmarks.** Procedural networks are
   added alongside them, never replacing them. This amends 2026-07-29's "the current 50 become
   naming TEMPLATES": the procedural grammars borrow the catalog's categories and vocabulary, not
   its entries.
2. **The world is a map of towns.** A town has a name, map coordinates, its own public IP block,
   and a coherent institution set: at most one council, police force and courthouse, 0–1
   hospital or university, a library, N shops, clinics and schools. Ridgemont is town #0.
   Corporations are placeless and may have branches in towns. In this epic a town is signalled
   by its IP block (read through `whois`) and the addresses on its contact pages. The `{town}`
   placeholder replaces the hardcoded "Ridgemont" in the category-wide site templates. Ping
   latency by distance and the coordinates it needs are deferred to the map epic (find-gaps
   2026-09-28): `ping` is LAN-only today, and coordinates nothing reads are untestable.
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
   **Which takes which** (added by find-gaps 2026-09-28): every seed (`wifi-pw-`,
   `bssidFromEssid`, `home-lan-`, `network-persona-`, …) and every stored column (the `essid`
   of occupants, leases, sessions) takes the network KEY, so two towns' `CITY-HALL-WIFI` get
   different passwords, BSSIDs and LANs. Only what the player reads as the WiFi's name takes
   the ESSID: the scan, `nmcli`, the HUD and the `.lan` zone (`lanZoneName`, so
   `city-hall-wifi.lan`, never `r0-t3-n07.lan`). A zone resolves only inside its own network, so
   one name in two towns never clashes. Landmarks are unaffected, their key being their ESSID.
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
   is a city), about 600–1,200 networks in all, plus 20–40 placeless corporations (19a).
7. **Regions and towns are hand-authored rows; networks are procedural.** A town row gives name,
   size class and a flavour line (map coordinates join it with the map epic); a region row
   gives name and character.
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
   - Region → first octet, a **newly reserved** realistic octet per region, outside the 12
     `publicFirstOctets` the allocator draws from and outside `193`, the way `193` is reserved
     today. `isPublicIp` learns the region octets. (Amended by find-gaps 2026-09-28: reusing the
     12 would let a derived address equal one the still-live allocator draws, or one already
     stored on dev or prod, between slices 1 and 2. With new octets the two slices stay
     independent; once the allocator retires the 12 simply fall unused.)
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
   **Its data step** (added by find-gaps 2026-09-28): the slice ships a Supabase migration that
   empties `network_public_ips`, or drops it if the reduction removes every reader, applied to
   jshack-dev and then jshack-prod. Every literal address in a wire-check is replaced by one
   derived from the scheme: `scripts/testPublisherWeb.ts:86`'s `193.0.0.1` ("no publisher
   holds this") could otherwise become findit's or a corporation's address and silently test
   the wrong thing.

8a. **The server refuses a join to an undeclared network, or to a network outside the player's
    town** (Ridgemont until travel exists). Today `registerNetwork` accepts any non-empty
    `essid`, so a modified client can join a made-up network and the allocator gives it an
    address; once the allocator retires, an undeclared network has no address at all. And
    procedural keys (`r0/t3/n07`) are guessable, so town locality cannot stay client-only once
    a second town exists. Lands in slice 1. The WiFi password itself stays client-checked (see
    Parked). (Added by find-gaps 2026-09-28.)

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
    name missing from the scan), and a hacker BBS posting leads.
    `whois` answers from the declaration alone, so it names the organisation behind ANY
    declared address, including the network a player is standing on: `whois` on a player's
    public IP leads to their network, the rendezvous-by-intel shape 2026-07-29 anticipated. It
    reveals no occupancy, answering the same whether anyone is there. (Confirmed by find-gaps
    2026-09-28.) **Rejected**: sweeping public
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
15a. **Each procedural network draws 0–2 seeded port forwards** on a new stream, weighted by
    category and profile: ssh on a high port to a desk, ftp to the file server, http to a camera
    or recorder, alongside a publisher's `:80`. Without them an unpublished internet-only network
    shows nothing but its gateway's `sshd:22`, every one looks alike from outside, and a
    relation has nothing to point at. Relations reference them by public address and port (a
    contractor's `.ssh/config` names `-p 2222` on a client's public IP). Lands with relations in
    slice 4. (Added by find-gaps 2026-09-28.)

### Engineering

16. **findit splits its index.** Publishers with no patches are listed from a pure, memoised
    index derived from generation; only patched publishers (possibly defaced, dark or stopped)
    get the live batched read. A search then costs what players have touched, not the size of
    the world.
    **Cold cost** (added by find-gaps 2026-09-28): findit searches run server-side, and the
    memoised index is built lazily on a function instance's first search. At the launch extent
    that means generating 300-plus site servers' homepages, estimated from the 2 ms-per-box
    budget at a second or more, not measured. Slice 8 measures it and `checkBudgets` gains a
    cold index-build limit set from that measurement. Only a breach justifies deriving homepages
    without building whole boxes, or precomputing the index at build time.
17. **World-wide tests sample the world instead of sweeping it**; `scripts/checkBudgets.ts` keeps
    its landmark sweep and adds a sampled procedural one.
18. **No go-live clock.** Adding a town is already a one-row deploy (decision 7); a second
    mechanism for the same need is not built.

### Order

19. **Slice order**:
    1. Walking skeleton: the world declaration (region #0 holding Ridgemont and one new town),
       network keys, derived town-block addresses, and one internet-only town built from the
       existing categories in the `flat` and `deep` profiles, whose `.gov` hub findit lists and
       which links the rest. The `{town}` placeholders and the join refusal (8a) land here.
    2. Re-address the landmarks and retire the allocator (`reduce-system-complexity`).
    3. `whois`.
    4. Relations, seeded forwards, the rule-3 loosening and unlisted sites.
    5. The `lone` profile and subtypes.
    6. The healthcare category.
    7. Procedural corporations (decision 19a).
    8. The remaining towns, the findit index split and the sampled budgets.
    9. Ridgemont's WiFi filler and the injector turned down.

19a. **Procedural corporations get their own slice**, after healthcare and before the remaining
    towns, so those towns are generated with branches in place. 20–40 placeless corporations in
    the `193` block, each with 0–3 town branches linked by parent/branch relations; a landmark
    corporation may gain branches too. (Added by find-gaps 2026-09-28.)

## Acceptance Criteria

- [ ] **AC-1** With the launch extent declared, region #0 holds 8–12 towns, and a test over the
      whole declared world proves every network has a distinct public IP.
- [ ] **AC-2** Any player can fetch a procedural town's council site by its domain. Its directory
      page links every institution in that town, listed or not.
- [ ] **AC-3** `whois <ip|domain>` on any declared network answers organisation, town and
      region. On an address or domain that no network holds, it answers no match.
- [ ] **AC-4** A test over the whole declared world proves every network can be reached from
      findit plus Ridgemont by following references.
- [ ] **AC-5** A join to a network outside Ridgemont, or to a key the world does not declare, is
      refused by the server, and no occupancy row is written.
- [ ] **AC-6** An unlisted publisher answers a fetch by its domain and never appears in any
      findit result.
- [ ] **AC-7** Every landmark's LAN, content and passwords are identical to before the epic
      (snapshot tests). Only its public IP changes.
- [ ] **AC-8** At least one town holds a hospital network whose boxes carry healthcare content in
      every category pool.
- [ ] **AC-9** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, and both the landmark sweep
      and the sampled procedural sweep average ≤ 2 ms per box, and the cold findit index build at
      the launch extent stays within the limit slice 8 measures and sets.

**Done** means every slice is merged, every AC holds, the as-built docs
(`world-content-architecture.md`, `discovery-architecture.md`, handbook chapter 6) describe the
new world, and this plan is retired.

## Later epics (each needs its own grill)

- **The map**, with fog of war: Ridgemont lit, a town appearing once one of its networks is
  touched. Needs the first per-player exploration record: where it is stored and what counts as
  "found". The world map of regions waits for a second region. Brings the town rows' map
  coordinates and `ping` across networks, with latency growing with distance.
- **Travel** between towns and regions: joining another town's WiFi gives another public IP,
  since the address belongs to the network. Needs a server-authoritative player location.
- Hidden ESSIDs learnt by name; a hacker BBS; the categories after healthcare.

## Parked

- **The WiFi password is checked by the client only.** The server never verifies the cracked
  password, so a modified client can join without `aircrack-ng`. It predates this epic and is
  derivable server-side from the encoded pool. Owner: the project owner, as its own item.
