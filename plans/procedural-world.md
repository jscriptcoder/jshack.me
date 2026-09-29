# Plan: Procedural world

**Status**: Grilled and gap-reviewed (find-gaps) 2026-09-28. Slice 1 planned 2026-09-28 as
slices 1a–1c (see Slice plans); 1a complete 2026-09-28 (#572, v0.284.0); 1b complete
2026-09-28 (#573, v0.285.0); 1c complete 2026-09-28 (#574, v0.286.0). Slice 1 complete.
Slice 2 grilled and planned 2026-09-28 as slices 2a–2b; 2a complete 2026-09-29 (#575,
v0.287.0); 2b complete 2026-09-29 (#576, table dropped on jshack-dev and jshack-prod).
Slice 2 complete. Slice 3 grilled and planned 2026-09-29, complete 2026-09-29 (#577,
v0.288.0). Slices 4 onward not yet planned.
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
   **Slice 2's shape** (grilled 2026-09-28, owner-confirmed):
   - **Only a declared network has a public address.** No lab network can have one: the
     server could only map an address back to it from something stored. Every wire-check
     that reaches a network by address, about 27 of them, moves onto a landmark. It prefers
     the 18 that publish nothing, clears that landmark's gateway journal before and after,
     and computes the landmark's derived address. Lab networks stay for the checks that only
     use a network's own machines (`MYSQL-LAB-3`, `REDIS-LAB-4`, …), so the 1c flag stays.
     Rejected: keeping `network_public_ips` as a lab-only table the server reads when the
     flag is set, which leaves the table, the fixture and a flag-dependent read at about 8
     places in production code. Also rejected: hashing lab networks into a lab block, which
     needs a new flag-dependent database read to map an address back.
   - Ridgemont is town #0, so its landmarks sit at `87.1.x.y`, each placed by its position
     in the catalog through the same scattering Millbrook uses. Millbrook (`87.98.x.y`) does
     not move. New catalog entries can only be added at the end.
   - findit (#0) and the 20 corporate landmarks (#1–20, in catalog order) take the `193`
     block by position. Slice 7's generated corporations are added after them. The hashed
     `193` addresses go, and so does the test that checked they never collided; one test
     over the whole world checks that every address is different.
   - Only the `87` and `193` blocks count as public; the allocator's 12 first octets stop.
   - A join to a declared network stores no address. The allocation step and its
     `500 allocation_failed` go, and the join's response is unchanged.
   - findit checks every declared network that has no site of its own for a player's page,
     instead of every network anybody has ever joined. The results are the same, because a
     page exists only once an occupant has written a forward on the gateway. A lab network is
     never listed. Slice 8's index split takes over from there.
   - The source address in a trace log is the derived address of the network the player is
     on. A player on a lab network shows `unknown`.
   - The migration drops `network_public_ips`. It is applied only after the merge is live on
     Production, first to jshack-dev and then to jshack-prod, because dropping it earlier
     breaks joins on the code still deployed. The owner runs or approves the cloud pushes,
     and the result is checked read-only afterwards.
   - A wire-check that needs an address where nobody answers uses a `.1` address inside a
     declared block (`87.1.0.1`, `193.0.0.1`). No network ever answers at `.1`, so this holds
     for any world, not just today's.
   - Every landmark keeps its LAN, content and passwords; only its public address moves (AC-7).
     No generated content contains a public address.
   - Two PRs: 2a derives the addresses and moves the wire-checks; 2b deletes the allocator
     and drops the table. 2a bumps the minor version; 2b gets no bump.

8a. **The server refuses a join to an undeclared network, or to a network outside the player's
    town** (Ridgemont until travel exists). Today `registerNetwork` accepts any non-empty
    `essid`, so a modified client can join a made-up network and the allocator gives it an
    address; once the allocator retires, an undeclared network has no address at all. And
    procedural keys (`r0/t3/n07`) are guessable, so town locality cannot stay client-only once
    a second town exists. Lands in slice 1c, before slice 2 retires the allocator. The WiFi
    password itself stays client-checked (see Parked). (Added by find-gaps 2026-09-28.)
    **Wire-checks keep their lab networks** (planning 2026-09-28): 50 of the 85 `scripts/`
    wire-checks join 45 made-up ESSIDs (`LEASE-TEST-NET`, `MYSQL-LAB-3`, …) so every run starts
    on a clean gateway journal. The refusal takes the joinable set as an injected dependency,
    and the `api/` adapter admits an undeclared key only when a local-only env flag is set for
    `vercel dev`, the same local posture as its noop nonce store. The flag is never set on
    Preview or Production. An out-of-town key is refused even with the flag.
    Narrowed by slice 2's grill (2026-09-28): a lab network has no public address once the
    allocator retires, so lab networks serve only the checks that use a network's own
    machines. Checks that reach a network by address use landmarks.

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
    `flat` lands with `lone` in slice 5, not in the walking skeleton (planning 2026-09-28): every
    network today has an inner gateway, a switch and a deep chain, so either profile means
    teaching the generator and every materializer about a network without them.

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
    **Slice 3's shape** (grilled 2026-09-29, owner-confirmed):
    - **One record per declared network.** An address no network holds answers no match,
      even inside a town's block (`87.1.0.1`). Rejected: nested town and region blocks that
      answer any address in them, which only repeat what the first two octets already say.
      `whois` does show whether an address is held, but `nmap` on a public address already
      does, and there are no shell loops to sweep a block with.
    - **`netname`** is the network's ESSID, the bridge from an address to a name a player can
      recognise in a scan. findit broadcasts nothing, so its netname is its key spelt as an
      ESSID, `FINDIT-IO`; findit does not join `DECLARED_NETWORKS`.
    - **`org-name`** is the site's name when the network publishes one. Otherwise it is the
      town's ISP, `<Town> Broadband`, as a real registry shows for a home line. Rejected: the
      `place` capitalised ("The kitchen"), and per-category rules the data cannot back.
    - **Region #0 is Harrow Valley.** The world gains its first region row, a name and the
      first octet `87`; the region's character waits for slice 8, its first reader.
    - A record prints, under a `% Harrow Valley registry` header, `inetnum: <ip> - <ip>`,
      `netname:`, `org-name:`, `domain:` (sited networks only, so an address query also
      answers its domain), `city:` and `region:`. A placeless network (findit, the
      corporations) omits `city:` and `region:`.
    - `whois <domain>` resolves the domain through the world's DNS and prints the same record
      as its address. Domains match case-insensitively, as `nslookup` does.
    - No match is `%ERROR:101: no entries found`, exit 1, for anything no network holds: an
      empty declared address, a private LAN address, an unknown domain, a lab network, or
      junk. No argument prints the usage line.
    - `whois` is an apt package of its own (binary in `/usr/bin`, absent until installed,
      as `dnsutils` is), with `help` and `man` entries. It needs a network connection, as
      `nslookup` does. It is client-only and pure: no server call, nothing logged on the
      target network, no occupancy shown, so no wire-check.
    - The AC-7 snapshot test lands in this slice as its own first commit, pinning every
      landmark's LAN, content and passwords before slices 4 and 5 change the generators.
    - One PR, minor bump (0.288.0). `discovery-architecture.md` and the handbook chapter
      listing the recon commands learn the route.
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
    1. Walking skeleton, as three PRs (planning 2026-09-28): 1a the world declaration (region #0
       holding Ridgemont and the village of Millbrook), network keys, derived addresses and
       Millbrook's publishers in the `deep` profile, with the `{town}` placeholders; 1b the
       town hub; 1c the join refusal (8a).
    2. Re-address the landmarks and retire the allocator (`reduce-system-complexity`).
    3. `whois`.
    4. Relations, seeded forwards, the rule-3 loosening and unlisted sites.
    5. The `lone` and `flat` profiles and subtypes.
    6. The healthcare category.
    7. Procedural corporations (decision 19a).
    8. The remaining towns, the findit index split and the sampled budgets.
    9. Ridgemont's WiFi filler and the injector turned down.

19a. **Procedural corporations get their own slice**, after healthcare and before the remaining
    towns, so those towns are generated with branches in place. 20–40 placeless corporations in
    the `193` block, each with 0–3 town branches linked by parent/branch relations; a landmark
    corporation may gain branches too. (Added by find-gaps 2026-09-28.)

## Slice plans

Each slice is one independent PR against `main`. A slice's branch is cut from `main` only after
the previous slice has merged. Each behaviour-changing slice loads `tdd`, `testing` and
`refactoring` before any code, presents its acceptance criteria for approval first, bumps the
minor version
(`package.json` + `npm install --package-lock-only`), and waits for approval before every
commit.

### Slice 1a: Any player can find Millbrook's council on findit and fetch its site by domain

**Value**: the first network outside the catalog. A player searching findit for Millbrook
finds its council, police, library and a few businesses, fetches each site by its domain, and
reaches each network's gateway at its public address.
**Path**: `curl`/`lynx <domain>` → `resolveName` → `siteAddress` → an `87.x.y.z` address →
`isPublicIp` → `/api/network` web fetch → `findNetworkByPublicIp`, whose fallback becomes the
world's pure `ip → key` lookup (today `publisherAt`, in `api/network.ts:114,302` and
`api/sessions.ts:199`) → `resolvePublicTarget` → the gateway's `:80` forward → the network's
site server → `buildWebSite`, reading the network's declared persona and site. findit's
`PUBLISHERS` (`findit/webIndex.ts`) list from the same declaration.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-skeleton`.
**Status**: complete, merged as #572 (`5f6fe73b`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: N/A.
**Scope**:

- A world declaration: region #0 with first octet `87` and two town rows, Ridgemont (#0,
  holding the 57 landmarks, keys unchanged) and Millbrook (#1, size class village, a flavour
  line). A region row carries only what something reads; its name arrives with `whois`
  (slice 3), its character with the remaining towns (slice 8).
- Millbrook's networks, generated from its row on streams keyed by the network key
  `r0/t1/n<k>`: a council (`.gov`), a police force and a library, plus 3–6 businesses from
  the existing `cafe`, `retail` and `corporate` categories. Each has an ESSID unique within
  Millbrook, a place name and a site domain. All publish, all listed, all `deep`. Homes wait
  for slice 4, since before relations nothing could lead to one.
- Addresses: `87.<town permutation>.<network permutation>`, with the fourth octet 2–254.
  `isPublicIp` learns `87`.
- One `declaredNetwork(key)` lookup replaces the catalog reads in `publisher.ts`,
  `persona.ts` and `webIndex.ts`. It answers ESSID, category, place, site, town and public
  address, landmarks included. `lanZoneName` and the persona domain take the ESSID, never the
  key (decision 4).
- The `{town}` placeholder replaces "Ridgemont" in `pools/webSites.ts:40,90,526`, filled from
  the network's town, so Millbrook's sites name Millbrook and the landmarks still read
  Ridgemont.

**Out of scope**: homes, the town hub (1b), the join refusal (1c), `whois`, landmark
addresses (slice 2), anything on WiFi.
**Acceptance criteria** (to be confirmed before any code):

- [x] **1a-1** Any player who runs `curl http://<Millbrook council domain>/` gets the council's
      front page, and it names Millbrook, never Ridgemont.
- [x] **1a-2** A findit search for `Millbrook` lists the council and every other Millbrook
      publisher, each by its domain.
- [x] **1a-3** Every Millbrook network's public IP is in `87.0.0.0/8` with a fourth octet in
      2–254. A test over the declaration proves those addresses are distinct from each other
      and from every landmark and findit address.
- [x] **1a-4** `nmap <a Millbrook network's address>` reports its gateway up with `22/tcp open`,
      from any player.
- [x] **1a-5** No WiFi scan ever offers a Millbrook network.
- [x] **1a-6** Ridgemont is unchanged. Every landmark's public IP, LAN, content and site text is
      identical, and its public and retail sites still read "Ridgemont".
- [x] **1a-7** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, landmark sweep ≤ 2 ms per box.

**RED**: a behaviour test that Millbrook's council domain resolves to an `87.` address and
that its site server's front page names Millbrook. Then the findit listing (1a-2), the
address properties (1a-3) and the scan (1a-5), one at a time.
**GREEN**: the declaration, the address permutation, `declaredNetwork` and `networkAt`, and
the `{town}` fill, each only as far as the failing test needs.
**REFACTOR**: fold the catalog-only lookups into `declaredNetwork` once they are all
behind it.
**Server evidence**: a new wire-check, `scripts/testMillbrook.ts`, against `vercel dev` and
jshack-dev proves 1a-1, 1a-2 and 1a-4 through `/api/network`. The existing
`testPublisherWeb.ts` and `testFindit.ts` stay green (1a-6).
**PRE-PR MUTATION**: Stryker scoped to the world declaration, the address permutation and the
changed lookups (json reporter).
**PR-ready when**: every 1a criterion holds, typecheck, lint, `vitest run` and the build's
`checkBudgets` pass, the wire-checks pass, and the owner approves the commit.
**Slice complete when**: its PR merges.

### Slice 1b: Millbrook's council site links every institution in the town

**Value**: the town hub (decision 13). A player on the council site follows a Directory link
to a page listing every Millbrook institution by domain. It is the route that later leads to
unlisted sites (slice 4).
**Path**: `lynx http://<council domain>/` → nav link → `/directory.html` on the council's site
server, written by `buildWebSite` from the world declaration.
**Class**: behaviour change.
**Delivery**: independent PR against `main` after 1a merges, branch
`feat/procedural-world-town-hub`.
**Status**: complete, merged as #573 (`f66326a7`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: N/A.
**Scope**: procedural `.gov` councils only. Ridgemont's landmark council gets no hub, because
AC-7 keeps landmark content identical. Its hub, if wanted, is a later decision.
**Acceptance criteria** (to be confirmed before any code):

- [x] **1b-1** Every page on Millbrook's council site links **Town directory**
      (`/directory.html`) in its navigation. The label is not plain "Directory", because the
      council already draws a "Staff directory" page. The sitemap lists the new page.
- [x] **1b-2** The directory links exactly `http://millbrook.gov/`, `http://millbrookpd.gov/`
      and `http://millbrooklibrary.org/`, each under the institution's name, and each opens
      that institution's front page.
- [x] **1b-3** The directory names no network outside Millbrook: no other network's domain,
      site name or wifi name. It leaves out Millbrook's businesses too, because the hub lists
      institutions only.
- [x] **1b-4** No other site gets a directory. Millbrook's police, library and businesses serve
      no `/directory.html`, and neither does Ridgemont's council. All 57 landmark hashes were
      identical before and after.

Adding a fixed page shrinks the room left for the optional pages the council draws, so
Millbrook's council draws a different set of them than before. No other site changes, and no
stream other code reads gains or loses a draw.

**RED**: a `buildWebSite` behaviour test for Millbrook's council, reading its directory's links
against the declaration.
**GREEN**: a fixed page on the council's site. It adds no draw to any existing stream.
**REFACTOR**: assess only.
**Server evidence**: `scripts/testMillbrook.ts` gains the directory fetch and follows one link.
**PRE-PR MUTATION**: Stryker scoped to the directory page's writer.
**PR-ready when**: every 1b criterion holds, the same gates as 1a pass, and the owner approves
the commit.
**Slice complete when**: its PR merges.

### Slice 1c: The server refuses a join to an undeclared or out-of-town network

**Value**: decision 8a. A modified client can no longer join a made-up network or a Millbrook
network. The refused join writes nothing, so slice 2 can retire the allocator knowing every
joined network has a derived address.
**Path**: `nmcli connect` → `env.homeNetwork.join` → `/api/network` `registerNetwork` →
`handleRegisterNetwork`, which checks the key against the joinable set before any
allocation.
**Class**: behaviour change.
**Delivery**: independent PR against `main` after 1b merges, branch
`feat/procedural-world-join-refusal`.
**Status**: complete, merged as #574 (`ce45c01a`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: N/A.
**Scope**: the joinable set is Ridgemont's declared networks, which today means the landmarks.
It is an injected dependency of the handler. The `api/` adapter admits an undeclared key
only when the local-only flag `JSHACK_ADMIT_LAB_NETWORKS=1` is set in
`.env.development.local` (gitignored), which is what keeps the 50 lab-network wire-checks
working (decision 8a). An out-of-town key is refused with or without the flag.
`docs/conventions-and-gotchas.md`'s wire-check section records that a run needs the flag.
**Acceptance criteria** (to be confirmed before any code):

- [x] **1c-1** A signed join to any Millbrook key (`r0/t1/n0`, …) is refused with
      `403 network_not_joinable`, and no public IP, LAN lease or occupancy row is written. The
      signature is checked first, so a badly signed join keeps its `401`.
- [x] **1c-2** Without the flag, a signed join to a key the world does not declare is refused the
      same way. The flag counts as set only when its value is exactly `1`.
- [x] **1c-3** All 57 Ridgemont landmarks join exactly as before (`200` with their `local_ip`).
- [x] **1c-4** With the flag set, a join to an undeclared lab network succeeds, and a Millbrook
      key is still refused.
- [x] **1c-5** The flag is set on neither the Preview nor the Production Vercel environment
      (owner's `vercel env ls`, 2026-09-28).

As built: the handler asks the world itself whether a key is Ridgemont's and takes one boolean,
`admitsUndeclaredNetworks`, instead of an injected joinable set (owner-approved 2026-09-28). The
wire-check ran against local supabase, not jshack-dev.

**RED**: `handleRegisterNetwork` behaviour tests for 1c-1 to 1c-4. The allocation and upsert
fakes record that nothing was written.
**GREEN**: the joinable check ahead of `allocatePublicIp`, plus the adapter's one-line flag
read.
**REFACTOR**: assess only.
**Server evidence**: a new wire-check, `scripts/testJoinRefusal.ts`, run with the flag set,
proves 1c-1 and 1c-4 against jshack-dev by reading the three tables afterwards. The whole
wire-check suite still passes with the flag set (1c-3, and the lab networks). 1c-5 is
operational evidence: Vercel's environment-variable listing for the project.
**PRE-PR MUTATION**: Stryker scoped to `registerNetwork.ts` and the joinable predicate.
**PR-ready when**: every 1c criterion holds, the same gates as 1a pass, and the owner approves
the commit.
**Slice complete when**: its PR merges. That completes slice 1.

### Slice 2: every network's public address is derived from its place in the world

A `reduce-system-complexity` program in two PRs: 2a is its transition, 2b its terminal
reduction.

**Reduction program** (ledger taken 2026-09-28):

- **Conserved contract**:
  - Every network has one public address, shared by all its occupants, and a player's
    public address is the address of the network they are on.
  - Scanning or fetching an address reaches that network's gateway and its forwards.
  - An address stays the same across re-joins, and no two networks share one.
  - A site's domain resolves to its network's address.
  - findit lists every published page whose `robots.txt` allows it.
  - A trace log names the actor's network address as the source, or `unknown` when the actor
    is on no network.
  - Lab networks still join locally while the flag is set.
- **Visible change, accepted before launch**: every landmark's address moves once. A declared
  network nobody has joined now answers at its address; today one with no site has no
  address until somebody joins it.
- **Superseded mechanism**, the allocator and everything that exists to feed or read it:
  - `allocatePublicIp.ts` and its redraw loop.
  - `generatePublicIp` and the 12 `publicFirstOctets`.
  - The hashed `publisher-ip-` `193` addresses.
  - The `network_public_ips` table, with its `essid` primary key, its `UNIQUE (public_ip)` and
    RLS.
  - The adapter's read and claim, including the `23505` redraw branch.
  - The join's `allocation_failed` branch.
  - 12 queries of the table in `api/`: 7 in `network.ts`, 2 in `sessions.ts` and 3 in
    `patches.ts`. They cover the lookup from address to network, the source-address
    lookups and findit's address list, each with a fallback to `publisherAt`.
  - `scripts/networkFixture.ts`, with its 32 callers seeding hard-coded addresses.
  - `scripts/testPublicIpAllocation.ts`.
- **Target**:
  - one pure pair in the world declaration, key → address and address → key, with every
    reader going through it;
  - no table, no draw and no fixture.
- **Terminal slice**: 2b.
- **Temporary bridge**: after 2a, `network_public_ips` holds only lab-network joins.
  - **What stays**: a lab-network join still calls the allocator. The lookups check the
    derivation first and fall back to the table only for a key the world does not declare.
    A stored row for a declared network is ignored.
  - **Why**: 2a proves the moved wire-checks against the derived addresses before anything
    is deleted.
  - **Owner**: slice 2b.
  - **Removal condition**: no wire-check reaches a lab network by address. 2a delivers this.
  - **Latest removal**: 2b, before slice 3 starts.
- **Behavior gate**:
  - `vitest run`, typecheck and lint pass.
  - Before/after fingerprints of all 57 landmarks show the same LAN, content, passwords and
    site text.
  - The wire-check sweep passes with the flag set, apart from failures already in the
    backlog.
- **Mechanism gate** (2b):
  - Nothing in `src/`, `api/` or `scripts/` mentions `network_public_ips`,
    `allocatePublicIp`, `generatePublicIp`, `publicFirstOctets` or `networkFixture`.
    Migrations are the only exception.
  - The 12 table queries are gone, not moved.
  - The cloud databases no longer have the table.

### Slice 2a: every landmark answers at an address derived from its place in the world

**Value**: any player can scan or fetch any declared network at an address the world
works out. Wire-checks reach networks at those addresses instead of rows they wrote.
**Path**:
- **Reaching a network**: `nmap`/`curl <address>` → `isPublicIp` → `/api/network` → the
  lookup from address to network. That lookup is now the world's pure address → key
  function, falling back to the table only for undeclared keys. It then reaches
  `resolvePublicTarget` → the gateway.
- **Resolving a domain**: `resolveName` → the derived address.
- **Joining**: `registerNetwork` stores an address only for an undeclared key.
- **Tracing**: the source address comes from the derivation.
- **findit**: it lists player pages across the declared networks that have no site.
**Class**: reduction transition (program above; terminal slice 2b). It carries one
behaviour change, the moved addresses, so its new address rules are driven by failing tests.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-derived-addresses`.
**Status**: complete, merged as #575 (`d8f2dedf`).
**Required implementation skills**: `reduce-system-complexity`, `tdd`, `testing`,
`refactoring`; `mutation-testing` at PR-readiness.
**Acceptance criteria** (to be confirmed before any code):

- [x] **2a-1** Each landmark has a derived address, taken by its position in the world:
      - a non-corporate landmark: `87.1.x.y`;
      - findit and a corporate landmark: `193.x.y.z`;
      - the fourth octet is always 2–254.
      `nmap` on that address reports the gateway up with `22/tcp open`, from any player,
      whether or not anybody has joined the network.
- [x] **2a-2** A test over the whole declaration proves three things:
      - every address is different;
      - mapping any declared network to its address and back returns the same network;
      - no network answers at a `.1` address.
      Millbrook's addresses are unchanged.
- [x] **2a-3** Every site's domain resolves to its network's derived address. A findit search
      still lists every publisher by its domain.
- [x] **2a-4** A player's own page, served through a forward on a landmark with no site, is
      listed by findit at that landmark's derived address.
- [x] **2a-5** A join to a declared network writes no `network_public_ips` row, and still writes
      its lease and occupant. A join to a lab network, admitted by the flag, still stores an
      address.
- [x] **2a-6** A cross-player scan from a player on a landmark logs that landmark's derived
      address as the source.
- [x] **2a-7** Only the `87` and `193` blocks count as public. An address in one of the 12
      retired first octets does not.
- [x] **2a-8** Every landmark's LAN, content, passwords and site text are unchanged, proven by
      before/after fingerprints of all 57.
- [x] **2a-9** Every wire-check that reaches a network by address uses a declared network and its
      derived address. The only literal public addresses left in `scripts/` are `.1`
      addresses where nobody answers. The sweep passes with the flag set, apart from failures
      already in the backlog.
- [x] **2a-10** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, landmark sweep ≤ 2 ms per
      box.

As built:
- The lookups ask the world only; none falls back to the table. A lab network has no
  public address, so a trace names an actor standing on one as `unknown` (decision 8a).
  The table is now written only by lab-network joins and read only by the allocator.
- `publisherAt` and the hashed `193` numbering are gone, folded into the world's
  `publicAddress`/`networkAt` pair. Scripts take an address from `publicAddressOf`, which
  stops the run on an undeclared key; `networkFixture.ts` and
  `testPublicIpAllocation.ts` are deleted.
- Evidence: fingerprints identical for all 57 landmarks; `checkBudgets` 237,696 B and
  1.684 ms per box. The sweep passed apart from `testCrossPlayerConnectionTrace` and
  `testExploitDeepChain` (both in the backlog) and `testRemoteAptInstall`, which hits
  `timestamp_skew` only under the sweep and passes alone.
- Mutation: 136 mutants, 124 killed by Stryker. Six static survivors were killed by
  applying them by hand, one by a tightened findit test, and five are equivalent.

**RED**: a world test that a non-corporate landmark's address is in `87.1.0.0/16` and maps
back to it. Then the corporate and findit `193` positions, the whole-world distinctness
test, `isPublicIp`, the join that stores nothing, and findit's player listing, one at a time.
**GREEN**:
- landmarks placed through the existing town scattering;
- a placeless `193` numbering;
- `publisherIp`, `publisherAt` and `siteAddress` read from the derivation;
- the derivation-first lookups in `api/`;
- the join skipping allocation for a declared key.
**REFACTOR**: fold `townAddress`, the hashed `193` and `publisherAt` into one pair from key to
address and back.
**Server evidence**: the moved wire-checks, plus `testMillbrook.ts`, `testPublisherWeb.ts`,
`testFindit.ts` and `testJoinRefusal.ts`, against `vercel dev` and local supabase with the
flag set.
**PRE-PR MUTATION**: Stryker scoped to the address derivation, `isPublicIp`,
`registerNetwork.ts` and findit's player listing (json reporter).
**PR-ready when**: every 2a criterion holds, typecheck, lint, `vitest run` and the build's
`checkBudgets` pass, the sweep passes, and the owner approves the commit. Bumps the minor
version.
**Slice complete when**: its PR merges.

### Slice 2b: the public-address allocator and its table are gone

**Value**: nothing about a network's address is stored or drawn any more. Every reader asks
the world.
**Path**: the same paths as 2a, with the table fallbacks and the allocation call removed.
**Class**: terminal reduction (program above). It discharges 2a's bridge.
**Delivery**: independent PR against `main` after 2a merges, branch
`refactor/procedural-world-retire-allocator`.
**Status**: complete, merged as #576 (`d15eae3f`).
**Required implementation skills**: `reduce-system-complexity`, `testing`, `refactoring`;
`mutation-testing` at PR-readiness.
**Acceptance criteria** (to be confirmed before any code):

- [x] **2b-1** The removals in the mechanism gate have happened:
      - these are deleted: `allocatePublicIp.ts` and its test, `generatePublicIp`,
        `publicFirstOctets`, `networkFixture.ts` and `testPublicIpAllocation.ts`;
      - these are removed: the adapter's read and claim, the `allocatePublicIp` dependency
        and the join's `allocation_failed` branch;
      - all 12 table queries are gone.
- [x] **2b-2** A lab-network join admitted by the flag still returns `200` with its `local_ip`.
      `testJoinRefusal.ts` stops counting public-address rows.
- [x] **2b-3** A migration drops `network_public_ips`, and it applies cleanly to local supabase.
- [x] **2b-4** The behaviour gate still holds: `vitest run`, typecheck and lint pass, and the
      sweep matches 2a's result.
- [x] **2b-5** The as-built docs describe addresses as derived. Several mention the table or the
      allocator and are updated:
      - `cross-player-architecture.md`;
      - handbook chapters 1, 3, 6, 7, 9, 10 and 11;
      - `conventions-and-gotchas.md` §6 and §9;
      - `e2e-shared-network-verification.md`;
      - the repo's `e2e` skill.
- [x] **2b-6** After the merge is live on Production, the migration is applied to jshack-dev
      and then to jshack-prod. `migration list --linked` and a read-only check show the table
      gone on both.

As built:
- `networkFixture.ts` and `testPublicIpAllocation.ts` had already gone in 2a. 2b removed
  the last 13 table queries (2 in `api/network.ts`, 11 in scripts), not 12.
- `testLanLeaseAllocation` lost its public-IP check and `testPublisherWeb`'s check 5 now
  asserts only that the join succeeds. The tests that used `publicFirstOctets` keep the 12
  retired octets as a written-out list, and the publisher test that the random draw never
  hit `193` is deleted. `discovery-architecture.md` was updated too; handbook chapters 3 and
  11 were already current from 2a.
- Evidence: `vitest run` 6592/6592; `checkBudgets` 237,696 B and 1.535 ms per box. The
  sweep was 77/80: the two backlog failures from 2a, plus `testMysqlDeep`, which hit
  `timestamp_skew` only under the sweep and passed 13/13 three times alone. Stryker on
  `registerNetwork.ts`: 51 killed, 0 survived.
- 2b-6: the owner applied the migration to jshack-dev, then jshack-prod, on 2026-09-29, once
  #575 was live on Production. `migration list --linked` and a read-only `to_regclass`
  check show `network_public_ips` gone and `network_lan_leases` intact on both.
- AC-7 stays open. Its address half is done: only the public address moved, and 2a's
  before/after fingerprints of all 57 landmarks were identical. But those fingerprints were a
  one-off comparison, no committed snapshot test pins landmark content yet, and later slices
  could still change it.

**Evidence**: a terminal reduction, so no new RED. The behaviour gate starts green from 2a
and stays green.
**PRE-PR MUTATION**: Stryker on `registerNetwork.ts`, which loses a branch. The deletions
are `N/A`; grep proves they are gone and the sweep proves nothing depended on them.
**PR-ready when**: 2b-1 to 2b-5 hold and the owner approves the commit. 2b-6 is the
post-merge operational step.
**Slice complete when**: its PR merges and 2b-6 is done. That completes slice 2. AC-7's
address half holds; its snapshot test moves to slice 3.

### Slice 3: any player can ask `whois` who holds an address or a domain

**Value**: a player holding an address (from a trace log, a findit result or a scan) or a
domain learns which network it is: its WiFi name, the organisation behind it, its town and
its region. An attacker's address becomes a name to look for in a scan, and a bare address
gives up its domain.
**Path**: `whois <ip|domain>` → the binary check (`/usr/bin/whois`, from `apt install whois`)
→ the wlan check → a pure lookup over the world declaration: domain → `siteAddress`,
address → `networkAt` → the network's record → printed lines. Nothing crosses to the
server, so the path ends in the client.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-whois`.
**Status**: complete, merged as #577 (`cfc4dbf3`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (to be confirmed before any code):

- [x] **3-1** With `whois` installed and a network joined, `whois` on the address of a sited
      Ridgemont landmark prints a `% Harrow Valley registry` header and a record, and exits 0:
      - `inetnum:` its address as a one-address range (`87.1.13.14 - 87.1.13.14`);
      - `netname:` its ESSID;
      - `org-name:` its site's name;
      - `domain:` its site's domain;
      - `city: Ridgemont` and `region: Harrow Valley`.
- [x] **3-2** A landmark with no site (`CASA-DE-RAMIREZ`) answers `org-name: Ridgemont
      Broadband` and prints no `domain:` line.
- [x] **3-3** A corporate landmark and findit print no `city:` or `region:` line. findit's
      `netname:` is `FINDIT-IO` and its `domain:` is `findit.io`.
- [x] **3-4** A Millbrook network answers `city: Millbrook` and `region: Harrow Valley`, with
      its ESSID as `netname:` (`TOWN-HALL-WIFI`), never its key.
- [x] **3-5** `whois <domain>` prints the same record as `whois` on that domain's address, in
      any letter case (`RIDGEMONT.GOV`).
- [x] **3-6** Anything no network holds prints `%ERROR:101: no entries found` and exits 1:
      an empty address in a declared block (`87.1.0.1`), a private LAN address
      (`192.168.1.10`), an unknown domain, a lab network's name, and junk. `whois` with no
      argument prints `whois: usage: whois <ip|domain>` and exits 1.
- [x] **3-7** A test over the whole declared world proves every network's address answers a
      record naming that network: its ESSID as `netname:` (`FINDIT-IO` for findit), its town
      as `city:` and `Harrow Valley` as `region:` for every town network.
- [x] **3-8** On a fresh box `whois` is not found and points at `apt install whois`, which
      installs it. `help` lists it and `man whois` describes it.
- [x] **3-9** With no network joined, `whois` prints `whois: network is unreachable — connect
      to a network first` and exits 1.
- [x] **3-10** `whois` reaches no server: it answers the same with every server-facing
      dependency of the command environment failing.
- [x] **3-11** (AC-7) A committed test fingerprints all 57 landmarks: persona, `.lan` zone,
      WiFi password, the gateway's files and every LAN box's files, everything except the
      public address. Its expected values equal fingerprints generated at `63f0b03b`, the
      commit before the epic's first code.
- [x] **3-12** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, landmark sweep ≤ 2 ms per
      box.
- [x] **3-13** `discovery-architecture.md` describes the `whois` route, and handbook chapter 5's
      command table lists `whois`.

As built:
- The record lookup stayed in `whois.ts`, its only consumer, not beside the declaration.
  The world exports `HARROW_VALLEY` beside `RIDGEMONT`; every declared network carries
  its `region`, and `REGION_FIRST_OCTETS` is read from the region rows.
- Whether a network stands in a town is read from its address block, not its category:
  Millbrook has two `corporate` businesses in its `87.98` block, and they name their town.
- findit's `org-name` is `findit.io`, what its pages call it.
- 3-11: the fingerprint leaves out the persona object. Slice 1a added `town: "Ridgemont"`
  to it, but every file it feeds is byte-identical, so all 57 fingerprints equal those
  generated at `63f0b03b`.
- Evidence: `vitest run` 6612/6612; `checkBudgets` 238,381 B and 0.849 ms per box.
  Stryker on `whois.ts` and the changed `world.ts` lines: 107 killed. Of the survivors, 5
  static ones were killed by applying them by hand, 2 are equivalent, and 1 with no
  coverage is on an existing directory line this slice did not touch.

**RED**:
- The AC-7 fingerprint test comes first, as its own commit. It is preservation evidence,
  not new behaviour, so its RED is an empty expected table failing against real digests.
  Its values are then checked against a run of the same fingerprinting at `63f0b03b`.
- Then a command test that `whois` on `ridgemont.gov`'s address prints the 3-1 record,
  followed by the unsited, placeless, Millbrook, domain, no-match, usage, unreachable and
  no-server cases, one at a time. The whole-world test and the availability tests come
  last.
**GREEN**:
- the world gains a region row, `{ name: 'Harrow Valley', firstOctet: 87 }`, from which
  `REGION_FIRST_OCTETS` is read;
- a pure lookup beside the declaration from an address or a domain to a record;
- `whois.ts` printing that record;
- a `whois` apt package, the command in the registry, and its `help` and `man` text.
**REFACTOR**: assess whether the lookup's town and region should come from one `Town` value
the declaration already keeps. Only if it removes a second spelling.
**Server evidence**: `N/A`. Nothing in `api/` changes and the command makes no request,
which 3-10 proves.
**PRE-PR MUTATION**: Stryker on `whois.ts` and the record lookup (json reporter). The
fingerprint test is `N/A`: its mutants would be in the generators it pins, which are
unchanged.
**PR-ready when**: 3-1 to 3-13 hold, typecheck, lint, `vitest run` and the build's
`checkBudgets` pass, and the owner approves the commit. Bumps the minor version to 0.288.0.
**Slice complete when**: its PR merges. That completes AC-3 and AC-7.

## Acceptance Criteria

- [ ] **AC-1** With the launch extent declared, region #0 holds 8–12 towns, and a test over the
      whole declared world proves every network has a distinct public IP.
- [ ] **AC-2** Any player can fetch a procedural town's council site by its domain. Its directory
      page links every institution in that town, listed or not.
- [x] **AC-3** `whois <ip|domain>` on any declared network answers organisation, town and
      region. On an address or domain that no network holds, it answers no match.
- [ ] **AC-4** A test over the whole declared world proves every network can be reached from
      findit plus Ridgemont by following references.
- [x] **AC-5** A join to a network outside Ridgemont, or to a key the world does not declare, is
      refused by the server, and no occupancy row is written.
- [ ] **AC-6** An unlisted publisher answers a fetch by its domain and never appears in any
      findit result.
- [x] **AC-7** Every landmark's LAN, content and passwords are identical to before the epic
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
