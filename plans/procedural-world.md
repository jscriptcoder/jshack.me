# Plan: Procedural world

**Status**: Grilled and gap-reviewed (find-gaps) 2026-09-28. Slice 1 planned 2026-09-28 as
slices 1a–1c (see Slice plans); 1a complete 2026-09-28 (#572, v0.284.0); 1b complete
2026-09-28 (#573, v0.285.0); 1c complete 2026-09-28 (#574, v0.286.0). Slice 1 complete.
Slice 2 grilled and planned 2026-09-28 as slices 2a–2b; 2a complete 2026-09-29 (#575,
v0.287.0); 2b complete 2026-09-29 (#576, table dropped on jshack-dev and jshack-prod).
Slice 2 complete. Slice 3 grilled and planned 2026-09-29, complete 2026-09-29 (#577,
v0.288.0). Slice 4 grilled and planned 2026-09-29 as slices 4a–4c; 4a complete 2026-09-29
(#578, v0.289.0); 4b complete 2026-09-30 (#579, v0.290.0); 4c complete 2026-09-30
(#581, v0.291.0). Slice 4 complete. Slice 5 grilled 2026-09-30 as slices 5a–5b; 5a complete
2026-09-30 (#582, v0.292.0); 5b complete 2026-09-30 (#583, v0.293.0). Slice 5 complete. Slice 6 grilled 2026-09-30 as slices 6a–6b;
Slice 5c (the whole town in the content sweep) complete 2026-09-30 (#584, v0.294.0); 6a
complete 2026-10-01 (#585, v0.295.0); 6b planned 2026-10-01. Slices 7 onward not yet
planned.
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
   **Slice 6's shape** (grilled 2026-09-30, owner-confirmed):
   - **Millbrook gains a hand-written cottage hospital, appended after its homes as
     `r0/t1/n15`.** No existing key, address, LAN or password moves; it is an institution, so
     the council's directory links it (AC-2). Accepted cost: with more publishers, 15% rounds
     to a second unlisted site and the unlisted pick is redrawn, and the hospital joins the
     keepers, so some of slice 4's leads are redrawn and re-pinned. Rejected: a hospital among
     the institutions at `n3` (renames every business and home key), a second town declared
     now (pulls slice 8's size classes forward), a Ridgemont hospital (slice 9's filler).
   - **Clinics and dentists are a town's practices: a count of their own, beside its shops.**
     A village draws 1–2 on a new stream `town-practices-<town key>`, each a clinic or a
     dentist, no kind twice while the other is left, named from grammars of their own under
     the same world-unique name check as businesses, appended after the hospital (`n16`, …).
     Decision 2 already lists a town's "N shops, clinics and schools" apart; slice 8 sizes the
     count by size class. Measured: adding `healthcare` to the business-kinds draw at any
     weight up to 50 redraws four of Millbrook's six businesses and still gives it no
     practice. Rejected: healthcare as a fourth business category, and the hospital alone
     with the practices waiting for slice 8.
   - **`healthcare` is appended to `NETWORK_CATEGORIES`**, so an uncatalogued network draws
     it like any category. In play every joinable network is declared (the scan offers only
     the catalog, and 1c refuses an undeclared key), so only test fixtures move.
     **Corrected by 6a's planning** (measured 2026-09-30): the whole-world property tests
     read the catalog and only four uncatalogued fixtures, none of which draws `healthcare`
     (they draw cafe, corporate, retail and iot); only the synthetic `HOME-NET-<n>` sets do
     (10 of the devices' 120, 158 of the phones' 1,500). Coverage comes from 6a instead
     (Millbrook joins the whole-world sweep, and AC-8's proof is split). Rejected: freezing the uncatalogued pick at today's nine, which protects nothing a player
     reaches and would be repeated for every later category.
   - **6's remaining calls** (taken in bulk):
     - **Two PRs: 6a the category, 6b the practices.** 6a: `healthcare` in every category
       pool, a new database archetype, and the hospital at `n15`. 6b: the practices (clinic
       and dentist names, site words, `n16` onward). Rejected: one PR, fifteen pools of new
       content and a new draw at once.
     - The hospital: ESSID `COTTAGE-HOSPITAL`, place "the cottage hospital", site
       `millbrookhospital.org` named "Millbrook Cottage Hospital", subtype `hospital`. Like
       every institution it always publishes and may be drawn unlisted, found then through
       the directory.
     - Healthcare's subtypes are `hospital`, `clinic` and `dentist`; the subtype type widens
       from a business's kind to a declared network's. An uncatalogued healthcare network has
       none and fills its slots from `CATEGORY_WORDS.healthcare`, neutral words.
     - A practice is a business in every rule but its count: it always publishes, joins the
       unlisted draw, is a relation's target and keeper as a business is (an unlisted practice
       gets a supplier), and is spelt as a business is (`.com`).
     - `PROFILE_WEIGHTS.healthcare` is 0/50/50: never `lone`, since even a surgery keeps a
       reception and a consulting room. Measured: `n15` draws `deep`, `n16` `flat`, `n17`
       `deep`. One row per category, so decision 11's "a hospital usually `deep`" is not
       enforced per subtype, as 5b dropped its pawn-shop example.
     - Every category pool gains a `healthcare` entry the size and style of its neighbours:
       front pages, site pages, the findit description (a `{care}` slot each subtype fills),
       people roles (consultant, practice manager, receptionist, dental nurse), API endpoints,
       MOTDs, work history, notes, personal mail, phone downloads, share departments
       (admissions, radiology, pharmacy, estates, rotas), unnamed places.
     - A new database archetype `appointments` (named `appointments`, `patient_admin` or
       `pas`): patients, clinicians and appointments tables, with a `STORE_SPECS` entry;
       `ARCHETYPES_BY_CATEGORY.healthcare` is `['appointments']`.
     - Patient data is mundane and fictional: names, dates of birth, a patient number and an
       appointment type (check-up, blood test, filling). No diagnosis and no clinical note.
     - A healthcare site's fixed team page is `clinicians.html`, "Our clinicians", as an
       office, a university and a council each have theirs.
     - `FORWARD_CHANCES.healthcare` is `[1]`: every healthcare network forwards one thing,
       its booking portal or remote access.
     - A healthcare network keeps leads as any non-office publisher does, on its file servers
       only, with no desk rule. Slice 4's and 5b's guarantees rerun over the grown Millbrook
       in RED; a failure comes back to the owner with one rule to fix it, as in 5a.
     - AC-8's proof: a test builds every box of Millbrook's hospital and finds healthcare
       content from each pool; the whole-world properties cover uncatalogued healthcare
       networks.
     - No server change, so no new wire-check: `testMillbrook` and `testFindit` run live
       against the grown town, and `checkBudgets` passes. A byte-diff shows every landmark
       unchanged, and before `n15` only Millbrook's unlisted draw and redrawn leads move.
     - `world-content-architecture.md` describes the category, the practices and their
       streams; `discovery-architecture.md` follows the re-pins. 6a bumps the minor version to
       0.294.0, 6b to 0.295.0.
10. **Subtypes are cheap variety inside a category**: a name grammar plus a vocabulary overlay
    for the site text and findit description (retail → bakery, pharmacy, bookshop, electronics,
    hardware, pawn, florist). A subtype adds no content pool.
11. **Three size profiles**, drawn on a new stream and weighted by category: `lone` (gateway and
    one box), `flat` (gateway and 2–5 boxes, no inner gateway, no deep chain) and `deep` (today's
    shape). A pawn shop is usually `lone`, a hospital usually `deep`. Landmarks keep their shape.
    `flat` lands with `lone` in slice 5, not in the walking skeleton (planning 2026-09-28): every
    network today has an inner gateway, a switch and a deep chain, so either profile means
    teaching the generator and every materializer about a network without them.
    **Slice 5's shape** (grilled 2026-09-30, owner-confirmed):
    - **Every procedural network draws a profile, Millbrook's 15 included.** Keys,
      addresses and domains stay; what stands on a LAN may change, and slice 4's leads
      are redrawn against the new shapes (pre-launch, no compatibility owed). Rejected:
      keeping Millbrook `deep` and profiling only later towns, which leaves `lone` and
      `flat` untestable until slice 8 and makes Millbrook a second exception.
    - **Two PRs: 5a profiles, then 5b subtypes.** They touch different code (the LAN and
      every reader of its shape, against names and wording). Profiles go first: they
      weigh by category, which exists, and they are the riskier change. Rejected:
      subtypes first (only needed if a subtype weighs the profile) and one PR.
    - **One weighted draw per network on `network-profile-<key>`**, weighed by category:
      government 0/30/70 (lone/flat/deep), public 10/60/30, corporate 0/40/60, retail
      40/50/10, cafe 60/40/0, residential 40/60/0. A home is never `deep`; a council or an
      office never `lone`. Categories no town draws yet get no row. Millbrook draws 3 deep
      (Town Hall, Police, Pinnacle), 7 flat and 5 lone. Rejected: a per-town quota of each
      profile; no test needs every town to hold every profile.
    - **`lone` is the `.1` gateway and one machine; `flat` the gateway and 2–5.** A
      publisher's lowest machine serves its site when none drew the role, as today. Neither
      has an inner gateway, a switch or a deep chain. `deep` is today's generator, byte for
      byte. Rejected: a `flat` switch that fronts nothing (a switch is an inner gateway here).
    - **One role table for every network.** A one-box home may be a name server, as some
      landmark homes are. Rejected: category role tables, a new rule that would move `deep`
      names or need a carve-out for `lone` and `flat`.
    - **Slice 4's guarantees stay binding** (AC-4, every home 1–3 leads, every home that
      forwards ssh a backup, every unlisted business a supplier). The relations code draws
      fewer leads when a source is gone, so RED draws the profiles first and runs those
      tests over the reshaped Millbrook; a failure comes back to the owner with one rule to
      fix it (such as a `corporate` network always keeping a desk). Rejected: deciding that
      rule before measuring, and loosening the guarantees.
    - **5a's remaining calls** (taken in bulk):
      - The profile is a `DeclaredNetwork` field; a landmark has none, meaning `deep`.
        `whois` does not show it: a network's shape is learnt by getting in.
      - Every reader of the shape (scans, ssh reach, inner-gateway lookups, the DNS zone,
        snmp, the gateway admin page, router content) asks the LAN, never the profile, so
        a network without an inner gateway has none anywhere and a hop to one is refused
        like one to any absent host.
      - 4a's forwards are unchanged; on `lone` and `flat` the whole LAN is the gateway's.
        This amends 15a's "weighted by category and profile": a `lone` network's one box
        already forwards less, and a second weighting would be a second rule.
      - `testMillbrook.ts` proves live that the server agrees with the client on a `lone`
        and a `flat` network: nothing behind the gateway, an inner-gateway hop refused
        (planning may narrow this to the one server path a Millbrook LAN takes).
      - AC-7 untouched; Millbrook's `deep` networks keep their LANs byte for byte, only
        content made from redrawn leads moves. `checkBudgets` passes, measured in RED.
      - `world-content-architecture.md` describes the profiles and lists
        `network-profile-`. 5a bumps the minor version to 0.292.0.
    - **5b: a subtype is a name grammar, and `TOWN_BUSINESSES` retires.** Millbrook's
      businesses are renamed once, before launch: keys and addresses stay; names, domains
      and ESSIDs move, and the slice 4 and 5a pins are re-pinned. The old names' words may
      survive as grammar fillers. Rejected: tagging the hand-written list (does not reach
      slice 8's 600–1,200 networks) and grammars for new towns only (two naming
      mechanisms, Millbrook an exception again).
    - **5b: the subtypes.** `retail`: grocer, bakery, pharmacy, bookshop, electronics,
      hardware, pawn, florist. `cafe`: café, tea room, coffee bar. `corporate`: consulting,
      logistics, insurance, IT services, accounting. Institutions, homes and categories no
      town draws yet have none. Each business draws its category (cafe 30, retail 40,
      corporate 30), then a subtype, without repeats in its town while any are left, on a
      new stream, so the business count and every key stay put. Rejected: subtypes for
      government and public, which a town declares by hand.
    - **5b's remaining calls** (taken in bulk):
      - The overlay is slots, not pages: a category's front pages and findit description
        gain slots (`{goods}`, `{service}`) each subtype fills; a landmark fills them with
        today's words, byte for byte (AC-7). Grocer-only sentences become slots or neutral
        with care, since landmarks must not move. No subtype writes its own pages.
      - The profile stays weighed by category alone; decision 11's pawn-shop example is
        dropped, the retail row already making most shops `lone` or `flat`.
      - A name is built from a surname list, a street or place list and filler words (the
        old names' among them), is unique in its town, and spells its domain and ESSID as
        today. The lists freeze at launch (decision 7).
      - `whois`, the unlisted pick and the relations follow the names with no change;
        `testMillbrook.ts` already derives every name from the declaration.
      - Slice 4's and 5a's pins (names, graph, invoice, unlisted site) are re-pinned once,
        deliberately; a byte-diff against `main` shows nothing outside Millbrook moved.
      - No server change, so no new wire-check: `testMillbrook` runs live against the
        renamed town, and `checkBudgets` passes.
      - `world-content-architecture.md` describes subtypes and lists their streams. 5b
        bumps the minor version to 0.293.0.

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
    **Slice 4's shape** (grilled 2026-09-29, owner-confirmed):
    - **Three PRs, in order:** 4a seeded forwards; 4b Millbrook's homes, the relations
      graph, the rule-3 loosening and the reachability test (AC-4); 4c unlisted publishers
      and the supplier relation (AC-6). Forwards come first because references point at
      them; homes ride with relations because before relations nothing leads to a home;
      unlisted comes last so the reachability test already covers it. Rejected: splitting
      homes from relations (the first relations would lead nowhere new) and one PR.
    - **4a, what a forward points at.** Each procedural network draws forwards on
      `gw-forwards-<key>`: 1–2 for `corporate` and `government`, 0–1 for `retail`,
      `public` and `residential`, 0–1 leaning 0 for `cafe`. Landmarks draw none (AC-7).
      A forward is drawn only from (edge-LAN box, port it really serves) pairs, never the
      site box's already-forwarded `:80`. The public port is the service's own where free;
      ssh (`22` is the gateway's own `sshd`) draws from `2222`, `2022`, `8022`, `22222`, and
      an http port clashing with the site's `:80` from `8080`, `8000`, `8888`, `8081`; a
      further clash takes the pool's next free entry. The lines join the gateway's
      `rules.v4` after the site's `:80`, in the existing `forward <port> to <ip>:<port>`
      form. No server change: a forward with no occupant already reaches the box the key
      generated there. Rejected: keeping the internal port and dropping a clash (no ssh
      forward could exist), and curating by hostname prefix (most networks would draw none).
    - **4b, homes.** Millbrook draws 4–8 `residential` homes on `town-homes-r0/t1`, appended
      after its businesses (`r0/t1/n9…`), so no existing key or address moves. ESSID and
      place come from a new `pools/townHomes.ts` in the catalog's home style (a family, a
      flat, a joke name), drawn without replacement and never equal to another Millbrook
      ESSID. Homes never publish; `whois` names them `Millbrook Broadband`. Rejected: ISP
      default ESSIDs (every home alike) and a fixed count.
    - **4b, two relation kinds, both naming the target by public address and port.**
      - IT contractor: one desk on a `corporate` publisher's edge LAN gets a
        `Host <client ESSID, lowercased>` block in `~/.ssh/config` and its `[ip]:port` line
        in `known_hosts`, one derivation. The port is the client's ssh forward, or `22` (the
        client's gateway) when it has none. `User` is the target box's NPC user, or `root`
        for a gateway. No secret (rule 1). A corporate publisher with no edge-LAN desk
        cannot be a contractor, so in Millbrook only Keystone Logistics is one (accepted
        knowing Pinnacle IT Solutions' edge LAN has no desk).
      - Offsite backup: an edge-LAN box that keeps `/srv` gains an `/etc/crontab` job
        `rsync -az /srv/ <user>@<ip>:backups/<source ESSID, lowercased>/ -e 'ssh -p <port>'`.
        Its target must have an ssh forward, and the box behind it keeps
        `~/backups/<source>/` holding a copy of the source's `/srv` files, built by the
        same share builder (rule 15). Its cost is measured against the 2 ms/box budget in
        RED; only a breach drops the copy to an empty directory.
      - Supplier waits for 4c, with the network that needs it; parent/branch for slice 7.
    - **4b, the graph.** Each network draws its INCOMING relations on `relations-<key>`:
      1–3 for a home, 0–2 for a publisher. Every source is a listed publisher in the same
      town; homes are never sources. So every home is one hop from findit by construction,
      and the whole-world test only confirms it. Rejected: homes as sources (needs a path
      search and a rule against closed clusters) and cross-town sources (no second
      procedural town until slice 8).
    - **4b, rule 3** reads in `world-content-architecture.md`: a reference may cross to one
      of its network's declared relations, by public address or domain and a port that
      answers there, never by a LAN address. A property test proves every public address in
      a procedural box's content belongs to one of its network's relations at an open port.
      The streams table gains `gw-forwards-`, `town-homes-` and `relations-`.
    - **4b, reachability (AC-4):** every declared network is findit-listed, a Ridgemont
      landmark, an institution on its town's directory, or the target of a relation whose
      source is one of those; checked over the whole declaration. No new wire-check: the
      server rebuilds boxes from the key, and 4a proves the forward path.
    - **4c, unlisted.** Each town unlists `max(1, round(15%))` of its publishers, picked on
      `town-unlisted-<town key>`, so Millbrook (9 publishers) unlists exactly one; a
      per-site 15% roll could draw none and leave AC-6 untestable. An unlisted site's
      `robots.txt` is `User-agent: *` / `Disallow: /`, replacing any drawn one; findit is
      unchanged. An unlisted institution stays on the directory; an unlisted business is a
      supplier target.
    - **4c, supplier:** an invoice document on a listed publisher's `/srv` share names the
      supplier by domain and site name; its source must keep `/srv`.
    - **Evidence:** 4a extends `testMillbrook.ts` with an `nmap` of an address with a seeded
      forward and a connection through it; 4c asserts live that findit never lists the
      unlisted site and its domain still answers. The AC-7 fingerprint test stays green in
      all three. Each PR bumps the minor version; `discovery-architecture.md` learns
      relations (4b) and unlisted sites (4c).

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
    5. The `lone` and `flat` profiles and subtypes. 5c, found while implementing 6a: every
       Millbrook network in the whole-world content sweep.
    6. The healthcare category, as two PRs (grill 2026-09-30): 6a the category and
       Millbrook's cottage hospital, 6b the practices.
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

### Slice 4: networks lead to one another

Three independent PRs against `main`, each cut only after the previous one merges: 4a seeded
forwards, 4b homes and relations, 4c unlisted publishers. Their shape is decision 15a's
grill record. Only procedural networks change: every landmark's gateway and boxes stay as
the AC-7 fingerprint test pins them, and no landmark is a relation's source or target.

### Slice 4a: every Millbrook network shows the internet more than its gateway

**Value**: from outside, a Millbrook network is no longer just its gateway's `sshd:22`. A
player who scans a Millbrook address sees the services its gateway forwards (ssh on a high
port to a desk, ftp to a file server, a web app on `:8080`) and can connect through each to
the box behind it.
**Path**: `buildApGatewayBaseFs(key)` → `apGatewayRules` → the site's `:80` forward, then
the seeded forwards drawn on `gw-forwards-<key>` from the edge LAN's `hostServices` → the
gateway's `rules.v4`. From any player: `nmap <address>` or a connection to
`<address>:<port>` → `/api` → `resolvePublicTarget` → `machineServing` reads the forward →
`generatedLanBox` → the box's service. Only the generator changes; the server path is the
one a publisher's `:80` already takes.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-forwards`.
**Status**: complete, merged as #578 (`44714640`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (to be confirmed before any code):

- [x] **4a-1** Every Millbrook gateway's `rules.v4` keeps its site's `:80` line (publishers)
      and then its seeded forwards, in the existing `forward <port> to <ip>:<port>` form. The
      count is 1–2 for a `corporate` or `government` network and 0–1 for a `retail`,
      `public` or `cafe` one, a café drawing one less often than a shop (and a home, from 4b,
      0–1). A network with fewer candidates than it draws takes all it has.
- [x] **4a-2** Every seeded forward names a machine on the network's edge LAN (never its
      gateway, inner gateway or switch) and a port that machine serves. The site server's
      forwarded http port is never forwarded twice; its other services may be.
- [x] **4a-3** Public ports:
      - an ssh forward takes the first free port of `2222`, `2022`, `8022`, `22222`, in that
        order, and never `22`;
      - an http forward takes its own port unless it is `80` on a publisher, then the first
        free of `8080`, `8000`, `8888`, `8081`;
      - any other service takes its own port, and a pair whose port is already taken is not
        drawn;
      - no two forwards on one gateway share a public port.
- [x] **4a-4** From any player, `nmap <a Millbrook address>` lists `22/tcp open` and every
      seeded forward's public port open, and a publisher's `80/tcp` as before.
- [x] **4a-5** Connecting through a seeded forward reaches the box behind it: an ssh forward
      offers that box's login, not the gateway's, and an http forward serves that box's
      page.
- [x] **4a-6** Every landmark's `rules.v4` is unchanged: the AC-7 fingerprint test passes
      untouched. Millbrook's keys, ESSIDs, addresses and sites are unchanged.
- [x] **4a-7** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, landmark sweep ≤ 2 ms per
      box.
- [x] **4a-8** `world-content-architecture.md`'s streams table lists `gw-forwards-`.

As built:
- `seededForwards(key)` in `generation/seededForwards.ts`, folded into `apGatewayRules`
  after the site forward. A category's count is one chance per forward
  (`corporate`/`government` `[1, 0.5]`, shops, library, homes `[0.5]`, café `[0.3]`).
- 4a-3 tightened in build: public `:80` is never a seeded forward's on ANY network, not
  only on a publisher, because findit lists whatever a non-publisher serves there and
  4b's homes would land on findit. The gateway's own `161` (snmp) is reserved beside
  `22`, so snmp is never forwarded.
- Millbrook as drawn: the council `2222`→a phone's ssh; the police `21` and `2121`; the
  library and Greenleaf Grocers `21`; Keystone Logistics and Pinnacle IT Solutions
  `2222`, Pinnacle also `21`; the café and two grocers none. No seeded http forward yet.
- Evidence: `vitest run` 6618/6618; `checkBudgets` 238,793 B and 1.43 ms per box under
  load (`main` 1.535 ms under the same load); `testMillbrook` 8/8 live, including
  `ssh -p 2222` logging its failure in `printer-57`'s own `auth.log`; `testPublisherWeb`
  6/6, `testFindit` 18/18. Stryker: 60 killed, 12 survived, 1 no coverage. One survivor
  is equivalent (`<` → `<=` on a float draw). The other 11 and the uncovered one are
  unreachable in today's world: the http port rule, the web and gateway port lists,
  categories Millbrook lacks, and the site-pair filter. **Carried to 4b**: its homes
  exercise the site-less path and the residential chance, and its golden table must
  pin them.

**RED**: a `routerFs` behaviour test over Millbrook's gateways for 4a-1, then the target
rule (4a-2) and the port rules (4a-3), one at a time, each over every Millbrook network so
the drawn values cannot pass by luck. Then a public-scan test through the command layer for
4a-4, and one resolution through `resolvePublicTarget` for 4a-5.
**GREEN**: a pure `seededForwards(key)` on its own stream beside `siteForward`, folded into
`apGatewayRules` with `withForward`, only for declared procedural networks.
**REFACTOR**: assess whether `siteForward` and the seeded forwards read better as one list
of the gateway's forwards. Only if it removes a second walk of the LAN.
**Server evidence**: `scripts/testMillbrook.ts` gains an `nmap` of a Millbrook address with
a seeded ssh forward and a connection through that forward, against `vercel dev` and
jshack-dev. `testPublisherWeb.ts` stays green.
**PRE-PR MUTATION**: Stryker on the forward draw and `apGatewayRules` (json reporter).
**PR-ready when**: 4a-1 to 4a-8 hold, typecheck, lint, `vitest run`, the build's
`checkBudgets` and the wire-checks pass, and the owner approves the commit. Bumps the minor
version to 0.289.0.
**Slice complete when**: its PR merges.

### Slice 4b: a player who breaks into a Millbrook business finds the way to a home

**Value**: Millbrook gains homes, which publish nothing and never appear on findit or
WiFi. The only way to one is a lead on a business's boxes: the IT contractor's
`.ssh/config` naming a client's address and port, or a crontab copying a share offsite to a
home's box, where the copy waits.
**Path**: the world declaration → Millbrook's homes on `town-homes-r0/t1` → the relations
graph on `relations-<key>` → the source's content (`sshContent` for a contractor desk,
`etcContent`'s crontab for a backup source) and the target's content (a backup copy under
the forwarded box's home). A player reads them through the existing `cat`, and follows them
with `nmap`, `ssh -p` or `whois` to the home's address.
**Class**: behaviour change.
**Delivery**: independent PR against `main` after 4a merges, branch
`feat/procedural-world-relations`.
**Status**: complete, merged as #579 (`efccb72e`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (re-confirmed 2026-09-29 after 4a merged, with 4b-3, 4b-6 and 4b-8
revised in build by the owner):

- [x] **4b-1** Millbrook declares 4–8 `residential` homes after its businesses, keyed
      `r0/t1/n9…`, each with an ESSID and place from `pools/townHomes.ts`, unique among
      the world's ESSIDs. The 9 existing keys and addresses do not move.
- [x] **4b-2** A home publishes nothing: no domain resolves to it, no findit search lists it,
      no directory names it, no WiFi scan offers it. `whois` on its address answers its
      ESSID, `org-name: Millbrook Broadband` and `city: Millbrook`.
- [x] **4b-3** Every home is the target of 1–3 relations and every Millbrook publisher of 0–2.
      Every source is a listed Millbrook publisher other than the target. A contractor
      source is a `corporate` publisher with a desk (in Millbrook, Keystone alone). **A backup
      goes only to a home that forwards ssh, and every such home receives one** (owner,
      2026-09-30: the free draw left Millbrook with no backup at all, and the two it drew to
      businesses landed on a phone and a database box).
- [x] **4b-4** A contractor relation puts, on one desk of the source's LAN, a
      `Host <target ESSID, lowercased>` block in `~/.ssh/config` naming the target's address,
      its ssh forward's port (or none, meaning `22`, for its gateway) and the NPC user of the
      box behind it (`root` for a gateway), with the matching `known_hosts` line. No secret
      appears.
- [x] **4b-5** A backup relation puts, on a source file server, an `/etc/crontab` job
      `rsync -az /srv/ <user>@<address>:backups/<source ESSID, lowercased>/ -e 'ssh -p
      <port>'`, and the box behind the target's ssh forward keeps `~/backups/<source>/` with
      the same files as the source's `/srv`. `syslog.1` and `auth.log.1` record the run;
      root's cron mail stays silent, as `rsync -az` prints nothing.
- [x] **4b-6** Rule 3, loosened: a property test over every Millbrook box (LAN, deep and
      gateways) proves every public address it names is its network's own or a relation's,
      and **every private address is on the network whose facts the file states**, a backup
      copy being read as its source's. (Two networks can share a /24, so "no other network's
      LAN address" could not be tested.)
- [x] **4b-7** (AC-4) A test over the whole declaration proves every network is listed on
      findit, a Ridgemont landmark, an institution on its town's directory, or the target of
      a relation whose source is one of those.
- [x] **4b-8** Every landmark's fingerprint moved **once, deliberately** (owner, 2026-09-30:
      fix, do not exempt). Two workstation `ssh_config` templates named `10.0.0.10` and
      `192.168.1.20`, and the `rules.v4` example named `10.0.0.10`, none of which any network
      holds. A byte-diff of every landmark file against `main` moved only 57 `rules.v4` and
      40 `ssh_config`, and the 57 fingerprints were re-pinned.
- [x] **4b-9** `checkBudgets` passes. The backup copy costs next to nothing and stays full.
- [x] **4b-10** `world-content-architecture.md` states rule 3 as loosened and lists
      `town-homes-`, `relations-` and the relation surfaces' streams;
      `discovery-architecture.md` describes following a relation.

As built:
- Millbrook drew six homes: Kowalski Wifi, The Hargreaves, Garden Flat, Rose Cottage, Pear
  Tree House, Okonkwo Family. Pear Tree House forwards `8080 → .49:80` and Okonkwo Family
  `2222 → .92:22` (a NAS); the other four forward nothing.
- The graph: Keystone's `laptop-33` keeps shortcuts to five businesses and five homes;
  Corner Pantry's `vault-61` backs up nightly (`33 5 * * *`) to `vsftpd@nas-92` at the
  Okonkwo home. Harvest Market and Pinnacle keep file servers but drew no lead.
- `relationsTo(key)` draws a target's leads; `relationsFrom(key)` reads a source's by drawing
  its town, reading each publisher's desks and file servers once per call. No module cache:
  a cache filled before Stryker switches a mutant on hides it.
- The new job's time is on `relation-cron-`, its log lines on `relation-cron-log-`, the
  clients' host keys on `relation-host-key-`: no box's existing draws moved, and
  `vault-61`'s `syslog.1`/`auth.log.1` keep every line they had.
- The ssh_config fix: a shortcut template names a neighbour that answers ssh, on its port;
  a box with none redraws from the templates that name nobody. `roleConfigFile` takes the
  neighbours from `sshNeighboursOf`. The `rules.v4` example reads `<internal_ip>`.
- Evidence: `vitest run` 6663/6663; `checkBudgets` 240,547 B and 0.886 ms per landmark box.
  Millbrook boxes average 3.5 ms (2.0 on `main`): the relations lookup costs about 7 ms on
  the dozen boxes that keep a lead. Wire-checks live: `testMillbrook` 8/8, `testSnmpSet`
  16/16, `testFindit` 18/18, `testPublisherWeb` 6/6.
- Stryker: battery A 298 killed / 61 survived / 3 no coverage, battery B 169 / 23, no
  timeouts. Valuable survivors killed and re-run (crontab shape, stray `backups/`, pinned
  schedule, syslog line and host key, undeclared networks, the homes pool at 100%). Left:
  equivalent guards and optional chains; unreachable in a one-town world (a home forwarding
  ssh in a town with no file server, a second lead after the guaranteed backup, a network
  with two backing-up file servers, forward chances for categories Millbrook lacks).
  `world.ts`'s import-time survivors were hand-verified killed. The 4a carry-over is
  closed: Pear Tree House draws the http forward and the homes pin the residential chance.

**RED**: the declaration test for 4b-1 and 4b-2 first, then the graph's properties (4b-3)
over the declaration, then each surface (4b-4, 4b-5) through the built box, then the rule-3
and reachability tests.
**GREEN**: the homes pool and their draw; a pure `relationsOf(key)` over the declaration;
the contractor lines on the desk's `.ssh/`; the crontab job and the target's copy, each on
its own stream, derived from one relation value on both sides.
**REFACTOR**: assess only.
**Server evidence**: `N/A`, no new wire-check. The server rebuilds every generated box from
its key, so new base content reaches it unchanged, and 4a's wire-check proves the forward
path a lead is followed along.
**PRE-PR MUTATION**: Stryker on the homes draw, the relations graph and both surfaces (json
reporter).
**PR-ready when**: 4b-1 to 4b-10 hold, the same gates as 4a pass, and the owner approves
the commit. Bumps the minor version to 0.290.0.
**Slice complete when**: its PR merges. That completes AC-4.

### Slice 4c: a Millbrook site answers by its name but never appears on findit

**Value**: a site a search cannot find. One Millbrook publisher asks crawlers to stay away;
a player finds it on the council's directory if it is an institution, or on a supplier's
invoice in a business's share if it is a business, and fetches it by its domain.
**Path**: the declaration's unlisted pick on `town-unlisted-<town key>` → `buildWebSite`
writes `robots.txt` as `User-agent: *` / `Disallow: /` → findit's live crawl, which already
honours it, skips the site. A supplier relation → an invoice on a listed publisher's
`/srv` naming the domain.
**Class**: behaviour change.
**Delivery**: independent PR against `main` after 4b merges, branch
`feat/procedural-world-unlisted`.
**Status**: complete, merged as #581 (`1a9aee8b`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (re-confirmed 2026-09-30 after 4b merged, unchanged):

- [x] **4c-1** Each town unlists `max(1, round(15%))` of its publishers; Millbrook unlists
      exactly one. Its `robots.txt` reads `User-agent: *` then `Disallow: /`, and nothing
      else.
- [x] **4c-2** (AC-6) No findit search lists the unlisted site, by its name, its domain or its
      town, while `curl http://<its domain>/` still answers its front page.
- [x] **4c-3** An unlisted institution stays on its town's directory. An unlisted business is
      the target of at least one supplier relation: an invoice document on a listed
      publisher's `/srv` share names it by domain and site name. A supplier source keeps
      `/srv`.
- [x] **4c-4** The rule-3 and reachability tests from 4b pass with the supplier relation
      among the kinds.
- [x] **4c-5** The AC-7 fingerprint test passes untouched.
- [x] **4c-6** `discovery-architecture.md` describes unlisted sites and the supplier lead.

As built:
- Millbrook unlists **Harvest Market**. The pick never takes the council that keeps the
  directory, so an unlisted institution would still be linked from it; Millbrook drew a
  business. The shut-out `robots.txt` replaces the drawn one, and every draw is kept.
- The supplier lead is drawn on `relation-supplier-<key>`, only for an unlisted business no
  directory names, and appended after the logins, so 4b's graph did not move. Its source is
  a listed publisher's working file server, never a backup box: Keystone Logistics'
  `share-102` files `invoices/harvest-market-<number>.txt` naming the site and
  `harvestmarket.com`, and one line in its `vsftpd.log.1` records the upload. Both are on
  `relation-invoice-<key>-<ip>`.
- `buildServerShare` builds `/srv` for the box and for its offsite copy, so a backup stays
  file for file. `Relation` is `Login` (contractor, backup) | `Supply`; the ssh and backup
  surfaces narrow to `Login`.
- A byte-diff of every Millbrook LAN box against `main` moved exactly three files: Harvest
  Market's `robots.txt`, the invoice, and the appended transfer-log line. No landmark moved.
- The live check matches findit's result links: findit echoes the query, so a plain text
  match reports a leak that is not there.
- Evidence: `vitest run` 6674/6674; `checkBudgets` 241,453 B and 0.864 ms per landmark box.
  Wire-checks live: `testMillbrook` 10/10 (two new checks), `testFindit` 18/18,
  `testPublisherWeb` 6/6, `testSnmpSet` 16/16.
- Stryker (json reporter): 227 killed / 54 survived / 6 no coverage, 0 timeouts. The invoice's
  arrival-time survivor was killed with a pinned log line; the `webSite`/`world` survivors
  were hand-verified killed (a cached box hides them). Left: equivalent guards, and code a
  one-town world cannot reach (an unlisted institution, a second unlisted site, a customer
  whose share already keeps an `invoices` folder).

**RED**: the unlisted pick over the declaration, then the site's `robots.txt`, then the
findit listing through `webIndex`, then the supplier invoice through the built share.
**GREEN**: the pick, the `robots.txt` override in `buildWebSite`, and the supplier kind in
the relations graph with its invoice on its own stream.
**REFACTOR**: assess only.
**Server evidence**: `scripts/testMillbrook.ts` asserts live that findit never lists the
unlisted site and that its domain answers.
**PRE-PR MUTATION**: Stryker on the pick, the `robots.txt` override and the supplier surface
(json reporter).
**PR-ready when**: 4c-1 to 4c-6 hold, the same gates as 4a pass, and the owner approves
the commit. Bumps the minor version to 0.291.0.
**Slice complete when**: its PR merges. That completes AC-6.

### Slice 5: networks come in three sizes, and businesses in kinds

Grilled 2026-09-30 (decision 11, "Slice 5's shape"). Two PRs, in order: 5a profiles, 5b
subtypes. 5b is planned once 5a has merged.

### Slice 5a: a Millbrook network is as big as what it is

**Value**: a player who gets into a Millbrook shop or home finds a gateway and one or a few
machines, not the same inner router, switch and hidden chain as a council. What is worth
walking down is now worth something: only a `deep` network hides a chain.
**Path**: the declaration's profile, drawn on `network-profile-<key>` → `generateHomeLan`
builds the LAN the profile allows → every reader of the shape (scans, ssh reach, the
inner-gateway lookups, the DNS zone, snmp, the gateway's own files) reads that LAN → the
relations graph and the seeded forwards draw from the reshaped boxes. A player sees it
through `nmap` from a box inside, the gateway's files, and the forwards seen from outside.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-profiles`.
**Status**: complete, merged as #582 (`9dfe7796`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (owner-confirmed 2026-09-30):

- [x] **5a-1** Every procedural network declares a profile, drawn once on
      `network-profile-<key>` with its category's weights (government 0/30/70
      lone/flat/deep, public 10/60/30, corporate 0/40/60, retail 40/50/10, cafe 60/40/0,
      residential 40/60/0). Millbrook draws `deep` for Town Hall, the police and Pinnacle;
      `lone` for Harvest Market, Greenleaf, Garden Flat, Rose Cottage and Okonkwo; `flat`
      for the other seven. A landmark declares none.
- [x] **5a-2** A `lone` network's LAN is its `.1` gateway and exactly one machine; a
      `flat` network's is its `.1` gateway and 2–5 machines. Neither holds any other router
      or a switch, so nothing hangs a deep layer. A publisher's LAN holds the web server its
      site answers from, whatever its profile.
- [x] **5a-3** A `deep` network's LAN is today's, byte for byte: Millbrook's three `deep`
      networks keep their hosts, and the AC-7 fingerprint test passes untouched.
- [x] **5a-4** Nothing on a `lone` or `flat` network names an inner gateway, a switch or a
      deep layer: the 4b rule-3 property test passes over the reshaped Millbrook, and an
      inner-gateway hop or scan aimed at one of its addresses is refused like one at any
      absent host.
- [x] **5a-5** Slice 4's guarantees hold over the reshaped Millbrook: every home has 1–3
      leads and every publisher 0–2, every home that forwards ssh keeps a backup, the
      unlisted business has a supplier, every forward reaches a box on the reshaped LAN that
      serves its port, and the AC-4 reachability test passes. If one fails, work stops and
      the owner gets the failure with one rule that fixes it. **It failed once** (owner,
      2026-09-30): no home forwarded ssh any more, so Millbrook kept no backup at all. Fixed
      by one rule: a home that forwards anything forwards ssh first when a machine there
      runs it.
- [x] **5a-6** `scripts/testMillbrook.ts` passes live, and its forward checks land on a
      network that is not `deep`, so the server's box behind the forward is the reshaped
      LAN's.
- [x] **5a-7** `checkBudgets` passes, and Millbrook's per-box time is measured against
      `main`'s.
- [x] **5a-8** `world-content-architecture.md` describes the three profiles, and its
      streams table lists `network-profile-`.

As built:
- Millbrook draws `deep` for Town Hall, the police and Pinnacle; `lone` for Harvest Market,
  Greenleaf, Garden Flat, Rose Cottage and Okonkwo; `flat` for the other seven. Its boxes
  fall from 129 to 65.
- `generateHomeLan` reads the profile from the declaration; `lone` and `flat` draw their
  machines on `home-lan-<key>` like `deep`, through one `machinesAt` that names them and
  keeps a publisher's web server. `deep` is unchanged byte for byte.
- The reshape moved every lead: Keystone's desk is now `workstation-33`; Pinnacle's
  `share-16` is the town's one file server, backing up nightly (`11 1 * * *`) to Pear
  Tree's `laptop-13` through `2222 → :8022`, and holding Harvest Market's invoice
  (`harvest-market-7123.txt`). Every pin was re-pinned once.
- A findit test pinned "groceries" to Ridgemont's shops; Corner Pantry now ranks first, and
  the test takes any declared retail site.
- `testMillbrook`'s forward checks moved from Pinnacle (`deep`) to the first `lone`/`flat`
  publisher forwarding ssh, Keystone, and derive the expected ports from its forwards.
- A walk of every file on every `lone`/`flat` box found no private address that is not a
  host on its LAN, only DHCP ranges, the subnet and a package version.
- Evidence: `vitest run` 6683/6683; `checkBudgets` 241,664 B and 0.900 ms per landmark box;
  Millbrook 1.36 ms per box (2.01 on `main`). Wire-checks live: `testMillbrook` 10/10,
  `testFindit` 18/18, `testPublisherWeb` 6/6, `testSnmpSet` 16/16.
- Stryker (json reporter): 101 killed / 14 survived / 1 no coverage, 0 timeouts. `world.ts`'s
  import-time survivors hand-verified killed; the missing-weights guard equivalent for every
  drawn category; the ssh-first fallback for a home running no ssh unreachable in Millbrook;
  `isOnHomeLan` unchanged, out of scope.

**RED**: the profile over the declaration (5a-1), then each profile's LAN through
`generateHomeLan` (5a-2, 5a-3), then slice 4's guarantee tests over the reshaped town
(5a-5), then the rule-3 test and an inner-gateway lookup on a `flat` address (5a-4).
**GREEN**: the weights and the draw in `world.ts`; `generateHomeLan` building `lone` and
`flat` from the profile, with `deep` untouched; whatever reader still assumes an inner
gateway learns there may be none.
**REFACTOR**: assess only.
**Server evidence**: `testMillbrook.ts` live (5a-6). The server rebuilds every box from its
key, so a reshaped LAN reaches it unchanged; the forward check proves the path.
**PRE-PR MUTATION**: Stryker on the profile draw, the `lone`/`flat` LAN and any reader
changed (json reporter).
**PR-ready when**: 5a-1 to 5a-8 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit. Bumps the minor version to 0.292.0.
**Slice complete when**: its PR merges.

### Slice 5b: a Millbrook business is a kind of shop, café or office, and says so

**Value**: a player reading findit or walking Millbrook's high street meets a bakery, a
pawn shop and an insurance broker, not a sixth grocer drawn from a list of sixteen names.
Each business's name, findit line and front page say what it is, and the same grammars
will name slice 8's hundreds of businesses without a hand-written list.
**Path**: the town's business count on `town-businesses-<town key>` (unchanged) → each
business's category and subtype on `town-business-kinds-<town key>` → its name from its
subtype's grammar on `town-business-names-<town key>` → the ESSID, domain and site name
spelt from it as today → `networkPersona` carries the subtype → `buildWebSite` fills the
description's and front page's slots with the subtype's words → findit indexes them. A
player sees it in findit's results, the front page, `whois`, and the wifi a scan inside
Millbrook shows.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-subtypes`.
**Status**: complete, merged as #583 (`1c25537c`).
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.
**Acceptance criteria** (owner-confirmed 2026-09-30):

- [x] **5b-1** Every business a town draws declares a category and a subtype. The category
      is drawn with weights cafe 30, retail 40, corporate 30; the subtype comes from its
      category's list (`retail`: grocer, bakery, pharmacy, bookshop, electronics, hardware,
      pawn, florist; `cafe`: café, tea room, coffee bar; `corporate`: consulting,
      logistics, insurance, IT services, accounting), and no subtype repeats in a town
      while its category has one left. Both are drawn on `town-business-kinds-<town key>`.
      The count stays on `town-businesses-<town key>`, so Millbrook keeps six businesses
      and all fifteen keys and addresses. Institutions, homes and landmarks declare no
      subtype.
- [x] **5b-2** A business's name comes from its subtype's grammar: a few templates built
      from a surname list, a street-or-place list and filler words, the old names' words
      among them (`{surname}'s Bakery`, `{street} Hardware`, `Harvest Market`), drawn on
      `town-business-names-<town key>`. No network in the world shares its name, ESSID or
      domain; a draw that would is redrawn. (Planning widened the grill's "unique in its
      town": two towns drawing one name would share a domain.) Its ESSID and domain are spelt from it as today,
      an accent folded (`Café` → `CAFE`, `cafe`), and the ESSID is at most 32 characters.
      `TOWN_BUSINESSES` and its pool file are gone. The lists and grammars freeze at launch
      (decision 7); a comment says so, as `townBusinesses.ts` did.
- [x] **5b-3** A business's findit description and front page say what its subtype sells or
      does. Every `retail`, `cafe` and `corporate` description and front page reads through
      slots (`{goods}`, `{service}`) its subtype fills, and no sentence left outside a slot
      names what only one subtype sells. For every subtype, its built front page and
      description carry its own words and none of another subtype's in the same category
      (a pawn shop never says groceries or fresh bread), and findit lists a listed
      Millbrook business for its subtype's words.
- [x] **5b-4** A landmark fills the slots with today's words: the AC-7 fingerprint test
      passes untouched, and findit still lists every Ridgemont shop for "groceries".
- [x] **5b-5** Nothing outside Millbrook moved: a byte-diff of every landmark box, findit's
      own and every Ridgemont site against `main` is empty. Millbrook's pins are re-pinned
      once, deliberately: the declaration (names, ESSIDs, domains), the profiles, the deep
      LANs, the forwards, the relations graph, the invoice and the unlisted pick.
- [x] **5b-6** Slice 4's and 5a's guarantees hold over the renamed Millbrook, as 5a-5 lists
      them. If one fails, work stops and the owner gets the failure with one rule that fixes
      it. **It failed once** (owner, 2026-09-30): the renamed Millbrook drew no office and no
      file server, so it kept no lead at all and seven networks nothing reached. Fixed by
      one rule: every town keeps an office, with a desk and a working share.
- [x] **5b-7** `testMillbrook.ts` and `testFindit.ts` pass live against the renamed town, and
      `checkBudgets` passes.
- [x] **5b-8** `world-content-architecture.md` describes subtypes, their grammars and slots,
      and its streams table lists `town-business-kinds-` and `town-business-names-`.

Out of scope, by the grill's "no subtype writes its own pages" and "a subtype adds no content
pool": a business's other pages (a shop's offers, returns and loyalty card, a café's menu, an
office's services), its API, database, shares, mail and notes stay its category's. A pawn
shop's offers page may still list a loaf of bread; a later content slice owns that.

As built:
- Millbrook's businesses are Whitlock's Café, FreshWay Coffee (unlisted), Abernethy and Sons
  Hardware, Abernethy's Books, Varley's Bakery and Westbrook Haulage. No draw held an office,
  so the last business, `r0/t1/n8`, became one: it keeps Pinnacle's key, and so Pinnacle's
  `deep` LAN.
- The office rule: when a town's kind draw holds no office, its last business is one (its
  category is still drawn, so nothing after it moves). A town's office names every
  workstation from the desk prefixes and every file server from the working-share ones
  (`OFFICE_HOSTNAME_PREFIXES`), and when it drew neither, its lowest free machines, never the
  site server, take the roles (`staffed` in `generateHomeLan`). Westbrook keeps `laptop-56`,
  which holds every contractor lead, and `files-16`, which backs up to Pear Tree and keeps
  FreshWay Coffee's invoice.
- The slots are `{goods}` and `{service}` in the descriptions, a shop's `{daily}` and
  `{range}` and an office's `{work}` on the front pages. A grocer's words are the ones every
  shop had, so Ridgemont's shops fill the slots with the grocer's words (`CATEGORY_WORDS`).
- `testMillbrook`'s forward check picks any non-`deep` network forwarding ssh: no non-`deep`
  business does any more, so it lands on Pear Tree House (`2222 → laptop-13:8022`).
- `discovery-architecture.md` still named Keystone's boxes from before 5a; it now names
  Millbrook's current leads.
- Evidence: `vitest run` 6697/6697; `checkBudgets` 243,675 B and 0.882 ms per box. Every
  Ridgemont and findit box byte-identical to `main` (30,632 files on 58 networks).
  Wire-checks live: `testMillbrook` 10/10, `testFindit` 18/18, `testPublisherWeb` 6/6,
  `testSnmpSet` 16/16.
- Stryker (json reporter): 127 killed / 71 survived / 3 no coverage. Every survivor in the
  slice's code re-run by hand: 28 killed (import-time throws), one killed by a new spelling
  example (`Hearth & Grain`), one removed by a refactor. The rest a one-town world cannot
  reach, and each is equivalent for Millbrook: `staffed`'s override steps, the office rule
  when a town drew an office, a category running out, a name clash redrawn.
- **Carried to slice 8:** the approved rule includes a `flat` office holding at least three
  machines (a site server, a share and a desk); no declared office is `flat`, so it was not
  built. Slice 8's sampled towns reach it, and the survivors above.

**RED**: the kinds over the declaration (5b-1), then the names and their spelling (5b-2), then
a built front page and description per subtype and a landmark's unchanged (5b-3, 5b-4), then
slice 4's and 5a's guarantee tests over the renamed town (5b-6).
**GREEN**: the kinds and name draws in `world.ts` and a grammar pool file replacing
`townBusinesses.ts`; the subtype on `DeclaredNetwork` and `NetworkPersona`; slots in
`SITE_DESCRIPTIONS` and `FRONT_PAGES` for the three categories, filled by `buildWebSite`.
**REFACTOR**: assess only.
**Server evidence**: no server change. `testMillbrook.ts` derives every name from the
declaration and runs live against the renamed town; `testFindit.ts` proves the index.
**PRE-PR MUTATION**: Stryker on the kind and name draws, the grammars and the slot filling
(json reporter).
**PR-ready when**: 5b-1 to 5b-8 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit. Bumps the minor version to 0.293.0.
**Slice complete when**: its PR merges. That completes slice 5.

### Slice 5c: every Millbrook network in the whole-world content sweep

Found 2026-09-30 while implementing 6a-6. The owner chose a separate PR for it, landing before
6a. **Status**: fixes A–E taken by the owner 2026-09-30 ("tackle those failing tests") and
implemented the same day; full suite 6,698 green, typecheck and lint clean, the invoice
line's one mutant killed (narrowed battery). **Complete** 2026-09-30 (#584, v0.294.0).
**Delivery**: independent PR against `main`, branch `fix/procedural-world-town-sweep` (cut from
`main` at `50a71460`). Its RED is stashed there as "town-sweep RED: TOWN_KEYS in ALL_ESSIDS":
`src/test/worldContent.ts` gains `TOWN_KEYS` (every declared network outside Ridgemont, by
key) appended to `ALL_ESSIDS`. Bumps the minor version to 0.294.0; 6a then rebases onto it and
moves to 0.295.0, 6b to 0.296.0.

**Value**: every content property the world's tests hold (no dead reference, no version, no
unfilled slot, every mailbox readable) is proven over the towns too, not only over the catalog.
Slice 8 multiplies the towns, so the sweep must cover them first.

**Facts measured** (2026-09-30):

- On `main`, with every Millbrook key in `ALL_ESSIDS`, 23 tests fail in six files (boxMemory
  2, boxSurface 2, mailbox 12, npcHome 2, share 2, webSite 3). On 6a's branch the same set
  plus one: a `wip` path (below). None of them is about healthcare, and 6a's hospital alone
  passes every property.
- Every `lone` network writes no mail (`networkMail` has 0 threads): FRESHWAY-COFFEE,
  ABERNETHY-AND-SONS-HARDWARE, VARLEYS-BAKERY, GARDEN-FLAT, ROSE-COTTAGE, OKONKWO-FAMILY.
  OKONKWO-FAMILY's one box is a desk, `desktop-142`, with no `/var/mail/mrodriguez`.
- The leads of slices 4 and 5 name other networks: WESTBROOK-HAULAGE `laptop-56` keeps
  `[87.98.0.2]:2222` in its known hosts; a backup job `rsync -az /srv/ mrodriguez@87.98.244.51`
  (PEAR-TREE-HOUSE); access and redis logs record a client at `87.98.244.51`; a home's notes
  name `87.98.0.2`; the council's `directory.html` links `millbrook.gov`, `millbrookpd.gov`,
  `millbrooklibrary.org`; the office share keeps an `invoices` folder the corporate
  departments do not list.
- PEAR-TREE-HOUSE `laptop-13` keeps a backup copy of the office share under
  `~/backups/westbrook-haulage/share/`; its PDFs start `%PDF-1.7`, which the home test reads
  as a version. The share tests already exempt the PDF header.
- The unlisted site's `robots.txt` (`Disallow: /`) fails "asks crawlers to stay out of paths
  it really serves and never links" (`/ is linked`) and "holds what its name promises".
- The supplier invoice reads `Goods supplied, as ordered    2217.00` and `TOTAL DUE  2217.00`:
  the only content defect, against the rule that no decimal is written (it reads as a version).

**Fixes** (taken 2026-09-30):

- **A. Leads that cross networks** (7 tests: boxMemory 2, boxSurface 2, npcHome addresses,
  webSite directory links, share `invoices` folder). A box may name another network's address
  or domain only where one of its leads (the relation graph, `relations.ts`) or the town
  directory points there. The tests consult the relation graph and the directory instead of
  refusing every outside address. Tests only.
- **B. The backup copy's PDF header** (npcHome version, 1 test). Exempt `%PDF-` in homes as the
  share tests do: it states a file format, not a software version. Tests only.
- **C. Unlisted sites' `robots.txt`** (webSite, 2 tests). An unlisted site's shut-out covers
  the whole site, so the robots-path tests skip it; the unlisted-site tests already prove
  what it says. Tests only.
- **D. `lone` networks' mail** (mailbox, 12 tests). One person has nobody to write to: a
  one-person network keeps no correspondence and its desk no spool. The mail tests read the
  networks that have a correspondence, and one new test pins the lone rule. Tests only.
- **E. The invoice** (share, 1 test). Whole euros, `2217 €`, as the menus and shares write
  money. Content; re-pins `relations.test.ts`'s invoice and its upload log's byte count.

**As built**: `src/test/worldContent.ts` gains `leadsKeptOn(box)`, the contractor and backup
logins kept on a box, which `falsehoodIn`, the known-hosts and ssh-config checks, the cron
check, the home-address check and the log-address check all read. One of boxMemory's two
failures was D's, not A's: a box alone on its network logs loopback as its only client, which
the test's title ("a neighbour wherever the box has one") already allowed. `webSite.test.ts`'s
`deadLink` accepts a link to another network's site only from `/directory.html` and only to a
site its town lists, and a new assertion proves it refuses one from anywhere else. The stale
comment in `networkMail.ts` ("No network this small exists") now states the lone rule.

**Left to 6a after it rebases**: with the hospital, the police site becomes unlisted, and its
robots-only directory `wip` is then named nowhere (its `robots.txt` is the shut-out), so no
player can find it. Proposed rule, to confirm then: an unlisted site keeps no robots-only
directory.

### Slice 6: the healthcare category

Grilled 2026-09-30 (decision 9, "Slice 6's shape"). Two PRs, in order: 6a the category and
Millbrook's cottage hospital, 6b the practices. 6b planned 2026-10-01, after 6a merged.

### Slice 6a: Millbrook has a cottage hospital, and a hospital's boxes read like one

**Value**: a player who finds Millbrook's hospital on the council's directory or on findit,
and breaks in, meets a hospital all the way down: a site about wards, visiting hours and
clinics, an appointments database of patients and clinicians, and boxes whose MOTDs, notes,
histories and phone downloads belong to people who work there. Every later healthcare
network, the practices of 6b and slice 8's towns, draws on the same pools.
**Path**: `NETWORK_CATEGORIES` gains `healthcare` → every category pool holds a healthcare
entry → Millbrook declares the hospital at `r0/t1/n15` (after its homes, so no key moves),
its profile drawn on `network-profile-r0/t1/n15`, its site on the council's directory → the
box builders read the pools through the network's persona, as for any category → findit
indexes its site, `whois` names it. A player sees it on the directory page, in findit, in
`whois`, and in every file on its boxes.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-healthcare`.
**Status**: **complete** 2026-10-01 (#585, v0.295.0), rebased onto 5c (#584); 6a-1 to 6a-10
hold. 6b is planned next.

**Progress** (2026-09-30):

- 6a-1 to 6a-5 hold; full suite 6,709 green, typecheck and lint clean. Pool files keep their
  neighbours' dense style, which Prettier already rejects on `main`.
- 6a-2's re-pins, as planned: the hospital answers at `87.98.183.78`; its LAN is `core-rtr`,
  `api-17` (site server), `iphone-32`, `sensor-83`, `mikrotik01`, `opnsense`; its forwards
  `80 → .17:8080`, `2121 → .83:2121`. Unlisted: MILLBROOK-PD and ABERNETHY-AND-SONS-HARDWARE
  (FreshWay Coffee listed again); the supplier lead and its invoice follow the hardware shop;
  the office gains a contractor lead to the hospital. Two findit tests that assumed the police
  is listed were rewritten.
- 6a-4's `appointments` archetype: patients (`PT-` numbers, a text date of birth, since the
  schema has no DATE type and a row's first DATETIME dates it), clinicians, appointments,
  optional rooms and waiting list. The per-archetype samplers in `database.test.ts` and
  `store.test.ts`, and "draws every archetype", now read `ALL_ESSIDS` rather than the catalog.
- 6a-5 measured: the hospital's boxes reach its site, API, database, phone downloads, MOTDs
  and forwards, **not** home notes and history (it has no desk). Those are proven on a
  healthcare desk outside the catalog (`npcHome.test.ts`); the AC-5 list needs that change,
  pending the owner. Three healthcare fixtures outside the catalog (`HealthCentre-WiFi`,
  `Practice-Staff`, `Patient-Staff`) carry mail, shares and unnamed places.
- 6a-6: after the rebase onto 5c every Millbrook network is in the sweep; one failure, the
  `wip` path below.
- **Owner decision, `wip`** (2026-09-30): an unlisted site keeps no directory only its
  `robots.txt` would have named (`webSite.ts`); the draws are still made. It was the hardware
  shop's `api-253 /wip/`, not the police's as first written.
- **Owner decision, AC-5** (2026-09-30): the hospital keeps no desk, so 6a-5 proves notes and
  history on a healthcare desk outside the catalog; 6a-5 is reworded below.
- **6a-7 failed once, owner decision** (2026-09-30): findit's own box moved. findit is no
  declared network, so it draws its persona as an uncatalogued network does, and appending
  `healthcare` turned it from a hacker workshop into a government records office (the grill's
  "only test fixtures move" missed it). Fixed by one rule: findit's persona is fixed
  (`FINDIT_PLACE` in `finditNetwork.ts`, hacker, "the workshop"). After it the per-network
  byte-diff of every landmark and findit against `main` is empty; inside Millbrook only the
  council's `directory.html`, the `robots.txt` of the three sites whose listing changed (and
  the dropped `wip`), the invoice's name on the office share and on PEAR-TREE-HOUSE's backup
  copy, the share's `vsftpd.log.1`, and the contractor desk's ssh config and known hosts moved,
  plus the new `n15`.
- 6a-8: slice 4's and 5's guarantee tests all hold over the grown town (full suite green);
  the contractor desk now reaches eight publishers and five homes.
- 6a-9: `testMillbrook.ts` 10/10 live after its search and directory checks were derived from
  the declaration (they had hard-coded the police as listed and three directory links);
  `testFindit.ts` 18/18; `checkBudgets` 248,565 B gzipped, 1.023 ms per box.
- 6a-10: both as-built docs updated (a "What a place of care is" section, 18 archetypes, the
  sweep's reach, the re-pinned leads and unlisted pick, the fixed findit persona).
- Mutation gate (narrowed battery, json reporter): 44 killed, 6 survived, 1 no coverage.
  Four survivors throw at module load and fail the suite by hand (killed); three are
  equivalent in the declared world (`site ?? []` with every institution publishing, the
  business-name neighbour list with no collision drawn, `?.unlisted` behind a published site).
- Full suite 6,712 green, typecheck and lint clean.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (2026-09-30, against `main` at `79e74162`):

- The hospital's key yields a `deep` LAN under a 0/50/50 row: a site server (the lowest
  machine, `.17`, which drew a database and is overridden as every publisher's is), a phone
  (`iphone-32`), a sensor, and deep boxes `nvr-139`, `api-230`, `db-110` and `cam-210`. It
  has no desk, mail server or file server: it reaches no personal mail and no share, and
  keeps no lead.
- Millbrook's publishers go from 9 to 10, so its unlisted share rounds to 2. Today's pick
  is FreshWay Coffee; with the hospital it becomes Abernethy and Sons Hardware and the
  Millbrook police. A `lone` unlisted shop then needs a supplier lead (slice 4's guarantee).
- The whole-world content tests read the catalog and four uncatalogued fixtures; none of the
  four draws `healthcare` once it is appended, and their categories move
  (`Linksys-Kitchen` corporate → cafe, `xfinitywifi` public → iot). No Millbrook box has been
  through them.
- Every category pool's sizes: front pages 4, site pages 5, people roles 3–6, API endpoints
  2–3, MOTDs 4, work history 14–15, notes 12, personal threads 8, phone downloads 2–3, share
  departments 4–7. `ARCHETYPES_BY_CATEGORY` gives each category its own archetypes, and
  `STORE_SPECS` is keyed by archetype.

**Acceptance criteria** (owner-confirmed 2026-09-30):

- [x] **6a-1** `healthcare` is the last entry of `NETWORK_CATEGORIES`, and every category
      pool holds a healthcare entry the size and style of its neighbours: front pages, site
      pages, the findit description, people roles (consultant, ward sister, practice manager,
      receptionist, dental nurse), API endpoints, MOTDs, work history, notes, personal mail
      threads, phone downloads, share departments (admissions, radiology, pharmacy, estates,
      rotas), unnamed places, forward chances (`[1]`) and profile weights (0/50/50). An
      uncatalogued network draws `healthcare` as it draws any category.
- [x] **6a-2** Millbrook declares `r0/t1/n15`: ESSID `COTTAGE-HOSPITAL`, category
      `healthcare`, subtype `hospital`, place "the cottage hospital", site
      `millbrookhospital.org` named "Millbrook Cottage Hospital". It draws `deep`, answers at
      its derived address, and `whois` names it. The council's directory links it, as every
      institution. Every earlier key, address, LAN and password is unchanged.
- [x] **6a-3** A healthcare site says what it is. Its findit description and front pages
      read through a `{care}` slot: the hospital fills it with a hospital's words (wards,
      visiting hours, outpatient clinics), and a healthcare network with no subtype with
      neutral words (`CATEGORY_WORDS.healthcare`). Its fixed team page is `clinicians.html`,
      "Our clinicians", its rows drawn from healthcare's people roles. findit lists the
      hospital, when listed, for its own words.
- [x] **6a-4** A healthcare network's database is the new `appointments` archetype (named
      `appointments`, `patient_admin` or `pas`): patients, clinicians and appointments,
      referentially sound, dated inside the application's life, with a store spec for its
      working set. Patient data is mundane and fictional: a name, a date of birth, a patient
      number and an appointment type (check-up, blood test, filling). No table holds a
      diagnosis or a clinical note.
- [x] **6a-5** AC-8: the hospital's boxes carry healthcare content from every category pool
      they reach (the list is measured in RED and named in the test: its site, API, database,
      phone downloads, MOTDs and forwards), and synthetic healthcare networks prove the rest
      (home notes and history on a healthcare desk, personal mail, share departments, unnamed
      places). (Reworded 2026-09-30, owner-confirmed: the hospital keeps no desk.)
- [x] **6a-6** Every declared town network joins the whole-world content sweep beside the
      catalog and the uncatalogued fixtures, and every standing property holds over it (no
      dead reference, no version, no unfilled slot, no forbidden account, no future date, no
      password-pool word). A failure unrelated to healthcare stops the work and goes to the
      owner.
- [x] **6a-7** Nothing outside Millbrook moved: a byte-diff of every landmark and findit box
      against `main` is empty, and the AC-7 fingerprint test passes untouched. Inside
      Millbrook only the council's directory page, the unlisted pick and the leads drawn from
      it move, and their pins are re-pinned once, deliberately.
- [x] **6a-8** Slice 4's, 5a's and 5b's guarantees hold over the grown Millbrook: AC-4, every
      home 1–3 leads, every home that forwards ssh a backup, every unlisted business a
      supplier, the town's office with its desk and working share. If one fails, work stops
      and the owner gets the failure with one rule that fixes it.
- [x] **6a-9** `testMillbrook.ts` and `testFindit.ts` pass live against the grown town, and
      `checkBudgets` passes.
- [x] **6a-10** `world-content-architecture.md` describes the healthcare category, the
      hospital and the `appointments` archetype; `discovery-architecture.md` follows the
      re-pins.

Out of scope: the practices, their grammars and the clinic and dentist words (6b); a rule
that staffs a hospital with a desk or a share (rejected in planning: it costs the phone, and
no declared hospital reaches `UNNAMED_PLACES` either way).

**RED**: the category and its pools (6a-1), then the hospital's declaration (6a-2), then its
site (6a-3) and database (6a-4), then AC-8 over its boxes and the synthetic networks (6a-5),
then the sweep widened to Millbrook (6a-6), then slice 4's and 5's guarantee tests over the
grown town (6a-8).
**GREEN**: `healthcare` and its pool entries; the `hospital` subtype and a `NetworkSubtype`
type that `DeclaredNetwork` and `SITE_WORDS` take; the hospital appended to Millbrook's
networks after its homes and passed into the directory; the `{care}` slot; the
`clinicians.html` team page; the `appointments` archetype and its store spec.
**REFACTOR**: assess only.
**Server evidence**: no server change. `testMillbrook.ts` derives Millbrook from the
declaration and runs live against the grown town; `testFindit.ts` proves the index.
**PRE-PR MUTATION**: Stryker on the declaration, the slot and team-page filling, and the
archetype (json reporter). The pools are authored data: their evidence is 6a-1's and 6a-5's
reachability tests, not mutants.
**PR-ready when**: 6a-1 to 6a-10 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit. Bumps the minor version to 0.294.0.
**Slice complete when**: its PR merges.

### Slice 6b: a town keeps a clinic or a dentist, and each reads as what it is

**Value**: a player walking Millbrook finds a dentist beside its shops: a site findit lists
for check-ups and fillings (or one only the leads reach, when it is drawn unlisted), an
appointments database, and boxes whose files belong to a practice. Every later town draws its
practices the same way, and slice 8 only sizes their count.
**Path**: a town draws its practices on streams of its own → each is a `healthcare` network
with subtype `clinic` or `dentist`, named from its subtype's grammar under the world-unique
name check, appended after the institutions declared later (`n16`, …) → its profile on
`network-profile-<key>`, its place in the unlisted draw, the relations it keeps and receives
as a business → its site's `{care}` slot filled from `SITE_WORDS[subtype]` → findit indexes
it, `whois` names it. A player sees it in findit, in `whois`, on the contractor desk's leads,
and in every file on its boxes.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-practices`.
**Status**: planned 2026-10-01.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (2026-10-01, against `main` at `38dd1c8a`, by a throwaway
prototype of the draw, reverted):

- Millbrook draws **one** practice, a dentist, at `r0/t1/n16`: `flat`, answering at
  `87.98.24.218`, its LAN a site server (`www-34`, the lowest machine), a smart lock, a
  database (`db-177`, so an `appointments` database) and a phone. It keeps no desk and no
  file server, so it keeps no lead. The grill's "`n16` flat, `n17` deep" assumed two; the
  count is drawn and came out 1, so no clinic is declared and `n17` is not.
- Publishers go from 10 to 11; 15% still rounds to 2 unlisted, but the pick is redrawn:
  **Millbrook police is listed again, Abernethy's Books becomes unlisted** (and gains a
  supplier lead and invoice on Westbrook Haulage's `files-16`), Abernethy and Sons Hardware
  stays unlisted with its invoice. `files-16` then keeps two invoices.
- The contractor desk `laptop-56` gains a lead to the dentist: nine publishers and five
  homes. Every other lead keeps its draw (the prototype's relation graph is otherwise
  identical).
- Profile, address, LAN and leads depend on the key, not the name, so the grammar's exact
  templates move only the dentist's name, ESSID and domain.
- Nothing before `n16` changes its key, address, LAN or password. The council's directory
  lists institutions only, so the practice joins it no more than a shop does.
- `SITE_WORDS` is keyed by `NetworkSubtype`; 5b proved every subtype's words by filling the
  templates with them directly (`world.test.ts`), with no need for a declared network of
  each kind. The clinic's words and grammar are proven the same way.

**Decisions taken in planning** (the grill's, made exact; to confirm with the criteria):

- **Two streams, as businesses keep theirs apart**: `town-practices-<town key>` draws the
  count (1–2 in a village) and each practice's kind; `town-practice-names-<town key>` draws
  their names. The grill named one stream; the names get their own so the name draw is the
  businesses' own, reused, and a redrawn clash moves no kind.
- **A practice's name avoids every name drawn before it**: the catalog, findit, the
  institutions, the businesses, the homes and the hospital. Businesses are drawn first and
  are not asked to avoid the practices, so no business moves.
- **Grammars**: `clinic` `['{street} Medical Centre', '{filler} Health Centre', '{surname}
  Family Practice', '{street} Surgery']`; `dentist` `['{street} Dental Practice', '{surname}
  Dental Care', '{filler} Dental', '{street} Dental Surgery']`, from the same `NAME_WORDS`
  and frozen at launch like the businesses'. `PRACTICE_SUBTYPES` sits beside
  `BUSINESS_SUBTYPES`; `NetworkSubtype` widens to take it.
- **Words**: `SITE_WORDS.clinic` `{ care: 'GP appointments, vaccinations and repeat
  prescriptions' }`, `SITE_WORDS.dentist` `{ care: 'check-ups, fillings and the hygienist' }`.
- **Unreachable in a one-town world, carried to slice 8**: the second practice and the "no
  kind twice while the other is left" rule (Millbrook draws one), and a declared clinic. Their
  mutants are equivalent for Millbrook, as 5b's were; slice 8's sampled towns reach them.

**Acceptance criteria** (to confirm with the owner before any code):

- [ ] **6b-1** A town draws 1–2 practices on `town-practices-<town key>`, each a `healthcare`
      network with subtype `clinic` or `dentist`, no kind twice while the other is left,
      appended after the institutions declared later. Millbrook's is a dentist at
      `r0/t1/n16`; every key, address, LAN and password before it is unchanged, and no
      landmark declares a practice.
- [ ] **6b-2** A practice's name comes from its subtype's grammar on
      `town-practice-names-<town key>`, spelt into its ESSID and `.com` domain as a business's
      is (ESSID at most 32 characters). No network in the world shares its name, ESSID or
      domain; a draw that would is redrawn. Every template of both grammars fills to a name
      that spells cleanly.
- [ ] **6b-3** A practice is a business in every rule but its count: it always publishes, it
      is in its town's unlisted draw, it is a lead's target as a business is (an unlisted
      practice gets a supplier), the council's directory lists it no more than a shop, its
      profile is drawn from healthcare's row (never `lone`), and it forwards one thing.
- [ ] **6b-4** A practice's site says what it is: its findit description and front pages fill
      `{care}` with its subtype's words, a clinic's and a dentist's each carry their own words
      and none of the other's or the hospital's (no dentist mentions wards), and findit lists
      Millbrook's dentist, when listed, for its own words. Its team page is `clinicians.html`
      and its database `appointments`, as every healthcare network's.
- [ ] **6b-5** Nothing outside Millbrook moved: a byte-diff of every landmark and findit box
      against `main` is empty, and the AC-7 fingerprint test passes untouched. Inside
      Millbrook only the unlisted pick (police listed, Abernethy's Books unlisted), the
      `robots.txt` and robots-only directories that follow it, the new supplier invoice and
      its backup copy, the share's upload log, and the contractor desk's ssh config and known
      hosts move, plus the new `n16`; their pins are re-pinned once, deliberately.
- [ ] **6b-6** Slice 4's and 5's guarantees hold over the grown Millbrook (AC-4, every home
      1–3 leads, every home that forwards ssh a backup, every unlisted business or practice a
      supplier, the town's office with its desk and working share), and every whole-world
      content property holds over `n16` through the town sweep. If one fails, work stops and
      the owner gets the failure with one rule that fixes it.
- [ ] **6b-7** `testMillbrook.ts` and `testFindit.ts` pass live against the grown town, and
      `checkBudgets` passes.
- [ ] **6b-8** `world-content-architecture.md` describes the practices, their grammars and
      words, and its streams table lists `town-practices-` and `town-practice-names-`;
      `discovery-architecture.md` follows the re-pins (unlisted pick, invoices, the
      contractor desk's reach).

Out of scope: the practices' other pages (a clinic's services page may still list blood
tests, a dentist's too), which stay their category's as 5b left a shop's; staffing a practice
with a desk or a share; sizing the count by size class (slice 8).

**RED**: the draw over the declaration (6b-1), then the names and their spelling (6b-2), then
the business rules over the practice (6b-3), then the built site per subtype and findit
(6b-4), then slice 4's and 5's guarantee tests and the town sweep over the grown town (6b-6).
**GREEN**: `PRACTICE_SUBTYPES` and their grammars beside the businesses'; a practice draw in
`world.ts` reusing the business name draw on its own stream, appended in `networksOf`;
`SITE_WORDS.clinic` and `SITE_WORDS.dentist`.
**REFACTOR**: assess only; the name draw is shared, not copied.
**Server evidence**: no server change. `testMillbrook.ts` derives Millbrook from the
declaration and runs live against the grown town; `testFindit.ts` proves the index.
**PRE-PR MUTATION**: Stryker on the practice draw, the shared name draw and the slot filling
(narrowed battery, json reporter). The grammars and words are authored data: their evidence
is 6b-2's and 6b-4's tests.
**PR-ready when**: 6b-1 to 6b-8 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit. Bumps the minor version to 0.296.0.
**Slice complete when**: its PR merges. That completes slice 6.

## Acceptance Criteria

- [ ] **AC-1** With the launch extent declared, region #0 holds 8–12 towns, and a test over the
      whole declared world proves every network has a distinct public IP.
- [ ] **AC-2** Any player can fetch a procedural town's council site by its domain. Its directory
      page links every institution in that town, listed or not.
- [x] **AC-3** `whois <ip|domain>` on any declared network answers organisation, town and
      region. On an address or domain that no network holds, it answers no match.
- [x] **AC-4** A test over the whole declared world proves every network can be reached from
      findit plus Ridgemont by following references.
- [x] **AC-5** A join to a network outside Ridgemont, or to a key the world does not declare, is
      refused by the server, and no occupancy row is written.
- [x] **AC-6** An unlisted publisher answers a fetch by its domain and never appears in any
      findit result.
- [x] **AC-7** Every landmark's LAN, content and passwords are identical to before the epic
      (snapshot tests). Only its public IP changes.
- [x] **AC-8** At least one town holds a hospital network whose boxes carry healthcare content
      from every category pool they reach, and every other healthcare pool is proven on
      synthetic healthcare networks. (Reworded by 6a's planning, owner-confirmed 2026-09-30: a
      declared network never draws `UNNAMED_PLACES`, and Millbrook's hospital keeps no desk,
      mail server or file server, so no declared hospital reaches every pool.)
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
