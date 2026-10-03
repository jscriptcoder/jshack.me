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
complete 2026-10-01 (#585, v0.295.0); 6b complete 2026-10-01 (#586, v0.296.0). Slice 6
complete. Slice 7 grilled 2026-10-01 as slices 7a–7b; 7a complete 2026-10-01 (#587,
v0.297.0); 7b complete 2026-10-01 (#588, v0.298.0). Slice 7 complete. Slice 8 grilled
2026-10-01 as slices 8a–8d (decision 19b); 8a complete 2026-10-02 (#589, v0.299.0); 8b split
2026-10-02 into the names (8b) and the town (8c), the city and the rows moving to 8d and 8e
(decision 19c); 8b complete 2026-10-02 (#590, v0.300.0); 8c complete 2026-10-02 (#591,
v0.301.0); 8d complete 2026-10-02 (#592, v0.302.0); 8e split 2026-10-02 into the rows (8e)
and findit (8f) (decision 19f); 8e complete 2026-10-02 (#593, v0.303.0); 8f complete
2026-10-02 (#594, v0.304.0). Slice 8 complete. Slice 9 grilled 2026-10-02 as slices 9a–9b
(decision 19g); 9a planned 2026-10-02, complete 2026-10-03 (#595, v0.305.0); 9b planned 2026-10-03.
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
   network's key is shaped `r<i>/t<j>/n<k>`. A region has a name, its own map and a reserved
   first octet. (Its character, weighting its towns' size class and category mix, was dropped
   by slice 8's grill: with one region nothing could read it; a town row authors its size
   class instead, 19b.) The whole world
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
   (Sized by slice 9's grill, 19g: Ridgemont is a `city` row, and its own streams draw 121
   filler networks, 178 with the landmarks. The "~150–300" above predates the size classes.)
6. **The world is finite and declared**, grown by appending towns to a region or a region to the
   world. The findit index, the reachability test, the map and the IP scheme each need to list
   every network. Launch extent: region #0 only, about 8–12 towns, each of a size class its
   row authors (village ~10–25 networks, town ~30–80, city ~100–300; Ridgemont is a city),
   about 600–1,200 networks in all, plus 20–40 placeless corporations (19a). Slice 8 declares
   eleven towns, about 490 networks before Ridgemont's filler (19b).
7. **Regions and towns are hand-authored rows; networks are procedural.** A town row gives name
   and size class (map coordinates join it with the map epic); a region row gives name and
   first octet. (Slice 8's grill dropped the town's flavour line and the region's character:
   nothing reads either before the map epic or a second region.)
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
    Measured while grilling slice 8 (2026-10-01): a full build, nothing patched, takes about
    160 ms over today's 76 pages and about 800 ms over the launch extent's 252, on every search,
    since nothing is memoised. The split lands in 8d (19b).
17. **World-wide tests sample the world instead of sweeping it**; `scripts/checkBudgets.ts` keeps
    its landmark sweep and adds a sampled procedural one. The sample's shape was settled by
    slice 8's grill (19b) and lands in 8c.
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
    7. Procedural corporations (decision 19a), as two PRs (grill 2026-10-01): 7a the
       corporations, 7b the branches.
    8. The remaining towns, the findit index split and the sampled budgets, as six PRs (grill
       2026-10-01, 19b; split 2026-10-02, 19c and 19f): 8a a second village, 8b the names, 8c
       the town size class, 8d the city, 8e the remaining rows, 8f findit's memoised index.
    9. Ridgemont's WiFi filler and the injector turned down, as two PRs (grill 2026-10-02,
       19g): 9a the filler, declared and on the WiFi; 9b the injector.

19a. **Procedural corporations get their own slice**, after healthcare and before the remaining
    towns, so those towns are generated with branches in place. 20–40 placeless corporations in
    the `193` block, each with 0–3 town branches linked by parent/branch relations; a landmark
    corporation may gain branches too. (Added by find-gaps 2026-09-28.)
    **Slice 7's shape** (grilled 2026-10-01, owner-confirmed):
    - **A town draws its branches.** Each town draws a count and each branch's parent on
      `town-branches-<town key>`; a branch is a new `corporate` network appended after the
      town's practices (Millbrook's first is `r0/t1/n17`), so no earlier key or address moves
      and a later town brings its own. "0–3 per corporation" is what the world adds up to,
      not a rule. Rejected: a corporation drawing its towns (a town's keys would depend on
      every corporation, or branches would need a key and address range of their own) and
      recasting a town's drawn offices as branches (Westbrook Haulage is named for its town,
      and every lead it keeps would be redrawn).
    - **A corporation is one headquarters network that stands in no town.** Its key has a
      shape of its own (`c0`, `c1`, …), and it answers in the `193` block after findit and
      the 20 landmark corporations. It has an ESSID, for its LAN names and its `whois`
      netname, but nobody can join it: it stands in no town, and 1c refuses a join outside
      the player's. A `corporate` network, it always publishes, so findit is its first way
      in. Rejected: a corporation as only a name its branches share (drops the placeless
      networks, and the relation would link nothing).
    - **The corporations are drawn, not written.** A count of 20–40 is drawn once on
      `corporations`; each corporation draws a subtype from the corporate five (consulting,
      logistics, insurance, IT services, accounting) and a name from a grammar of its own
      that sounds bigger than a village office (`{surname} Group`, `{filler} Holdings`,
      `{surname} & {surname}`, `{filler} International`), under the world-unique name check
      against every declared name, landmarks included. A later corporation is appended; the
      word lists freeze at launch (decision 7). Rejected: 20–40 hand-written rows, a second
      authored list and the one network kind decision 7 does not cover.
    - **A branch publishes nothing, and only its headquarters leads to it.** The parent's
      site is its public face. The headquarters' gateway, which every network has, keeps the
      lead: its `root` holds an ssh shortcut to each branch (a `~/.ssh/config` host block
      and a `known_hosts` line, as the contractor's), to the branch's ssh forward or else its
      gateway's `:22`. The route crosses towns: findit, then the headquarters, then a village
      office no search reaches. A branch keeps no town leads and receives none, its IT being
      the headquarters', so its town's graph does not move. Rejected: a branch site findit
      lists (then the headquarters route adds nothing) and leads both ways (the branch's
      lead to a listed headquarters adds nothing).
    - **7's remaining calls** (taken in bulk):
      - **Two PRs: 7a the corporations, 7b the branches.** 7a: the headquarters networks,
        their names, addresses, sites, findit and `whois`. 7b: Millbrook's branch and the lead
        that reaches it.
      - 20–40 corporations, drawn once. findit's index grows from 50 publishers to 70–90;
        7a measures `checkBudgets` and `testFindit` in RED, and the index split stays in
        slice 8 unless a budget breaks. Rejected: fewer now and the rest in slice 8.
      - A corporation is keyed `c<n>` and answers at the `193` block's position 21 + n.
      - Its ESSID and `.com` domain are spelt from its name as a business's are, its place
        is its name, its subtype is drawn without repeats while any are left, its profile
        comes from the corporate row, and it draws 1–2 seeded forwards as any office does.
        `whois` prints no `city:` or `region:` for it, as for the landmark corporations.
      - A corporation is always listed: the 15% unlisted draw is a town's, and nothing but
        findit leads to a corporation.
      - A headquarters keeps no town leads and receives none (relations are drawn within a
        town); its only leads are its branches'.
      - A village draws 1–2 branches, at least one so Millbrook has one to test; each picks
        its parent from the corporations, no corporation twice in a town. A branch is
        `corporate` with its parent's subtype, its ESSID `<PARENT-ESSID>-<TOWN>`, its place
        "the <Town> office"; it publishes nothing and draws the corporate profile and
        forwards. Slice 8 sizes the count by size class.
      - A branch's `whois` `org-name` is its parent's site name, with its town's `city:` and
        `region:`, as a real registry names the company holding the line. Accepted: `whois`
        on a branch's address names its parent; addresses are never swept. Rejected:
        `<Town> Broadband`, as for a home.
      - The lead is a new relation kind, `branch`: a `Host <branch ESSID, lowercased>` block
        in the headquarters gateway's `/root/.ssh/config` and its `[ip]:port` line in
        `/root/.ssh/known_hosts`, one derivation. It logs in at the branch's ssh forward as
        that box's user, or at its gateway's `:22` as `root`. Rule 3's property test extends
        to the headquarters' boxes.
      - **Landmark corporations gain no branches**, dropping 19a's "may": AC-7 forbids their
        content changing, and a branch whose parent keeps no lead would be unreachable.
      - AC-4 holds with no new rule: every headquarters is findit-listed, and every branch
        is the target of its parent's lead.
      - A join to a headquarters (no town) or a branch (outside Ridgemont) is refused, as 1c
        refuses today; 7a asserts the placeless refusal in the join wire-check.
      - Evidence: `testFindit` lists a corporation live, `testMillbrook` covers the branch,
        `checkBudgets` passes, and a byte-diff shows no landmark and nothing before the new
        keys moved. `world-content-architecture.md` lists the streams (`corporations`,
        `corporation-names`, `town-branches-`); `discovery-architecture.md` describes the
        headquarters-to-branch route. 7a bumps the minor version to 0.297.0, 7b to 0.298.0.

19b. **The remaining towns** (slice 8), grilled 2026-10-01, owner-confirmed.
    **Facts measured while grilling** (against `main` at `acf941fa`, by a throwaway prototype
    declaring nine more towns, five villages, three towns and a city, then reverted; diff and
    scripts kept outside the repo):

    | | `main` | prototype |
    |---|---|---|
    | Declared networks | 103 | 492 (Kingsford, the city, 166) |
    | findit pages | 76 | 252 |
    | findit index build, every search | ~160 ms | ~800 ms |
    | Machine ids in findit's one read | 181 (2.9 KB of URL) | 778 (12.3 KB) |
    | ms per box outside Ridgemont | 0.8–1.1 | 1.4–1.8 village, 2.8–3.7 town, 6.1 city |
    | Full suite | 1m44s, 6,816 tests | 3m15s, 7,594 tests |

    - **Box time grows with the town** because every box walks its town's whole relations
      graph. Memoising `relationsFrom` and `relationsTo` per key brings every town to
      0.75–0.98 ms per box; the first, cold lookup costs 35 ms in the city, 12 ms in a town
      and 7 ms in a village.
    - **findit stops reaching sites.** 75 of the 213 listed sites outside Ridgemont never make
      the top ten for "<town> <kind>", Millbrook's own café for "Millbrook café" among them:
      no business or practice page names its town (only institutions and the hospital do).
      A page naming its town brings the misses to 46; ranking a page that matches every word
      above one matching fewer brings them to 32. The rest are crude query words (a
      "Bakehouse" never says "bakery") and a city's ten-plus coffee bars, which no top ten
      can hold.
    - **25 assertions fail over the prototype**, about half of them content properties only
      the scale reaches: a phone holding 43 files; a `lone` network keeping a mail spool; a
      `flat` office with no desk and share (carried since 5b); gateway content repeating
      across gateways (937 distinct of 948); duplicate files on one network's web servers;
      an `rsync@` account in a crontab; a database password in an `.env`; reply threading;
      home and desk notes that miss their place. The rest are test-side: Millbrook-only
      goldens, ESSIDs checked unique across the world rather than per town, one directory,
      one branch.
    - **Names run short.** The 14 hand-written homes cannot fill a town's 12–24 or a city's
      40–80. Coffee bars draw 23 of their 52 possible names and logistics 20 of 56, under a
      world-unique domain check whose redraw never ends once a name space is spent. One
      branch ESSID is 33 characters, `SILVERBIRCH-HOLDINGS-CASTLEBRIDGE`.
    - The 26 test files that sweep every network outside Ridgemont (`TOWN_KEYS`) double the
      suite; the heaviest three go from about 75 s to about 185 s each.

    **Slice 8's shape**:
    - **The launch region: nine authored rows after Millbrook, one city.** Five villages
      (Ashby, Fenwick, Thornbury, Hollowmere, Ely), three towns (Oakhurst, Wexcombe, and one
      more whose name keeps every branch ESSID in 32 characters, Castlebridge did not) and
      a city (Kingsford): eleven towns in Harrow Valley with Ridgemont and Millbrook, about
      490 networks before Ridgemont's filler (slice 9). A row is a name and a size class;
      the region's character and the town's flavour line are dropped. The city lands now so
      every per-town cost is met here rather than in slice 9. Rejected: villages and towns
      only (about 330 networks; the city class unbuilt and slice 9 meeting its costs first),
      and a size class drawn from the region's character (a weighting nobody can observe
      with one region).
    - **Four PRs, by size class, each cost landing with the PR that measures it:**
      - 8a: a second village, Ashby (`r0/t2`), generated from its row; the test
        assumptions that there is one town, and the paths only a second town reaches;
        findit's town-named pages and all-words ranking.
      - 8b: the town size class, Oakhurst (`t3`): its counts, a courthouse and the hospital
        draw, the home grammar and the grown word lists, the relations cache.
      - 8c: the city, Kingsford (`t4`): the sampled sweeps, and `checkBudgets`' sampled
        procedural sweep.
      - 8d: the remaining rows (`t5`–`t10`, AC-1), findit's index split and the cold
        index-build limit (AC-9).

      Rejected: two PRs with the engineering first (no breach to prove it against today's
      103 networks, and every content failure at scale in one review), and one PR.
    - **findit names a business's town and ranks pages matching every word first.** Every
      procedural business and practice page names its town, through a `{town}` slot the
      landmarks fill so their bytes do not move (AC-7); a page matching every word of a query
      ranks above one matching fewer; ten results stay. The promise: a site is found by its
      name, and a village's or a town's by town and kind; a city's many cafés need a sharper
      query. `MAX_RESULTS`' "about thirty places" is corrected. Lands in 8a, the first PR
      with two towns competing for Millbrook's results (the grill offered 8c; moved in the
      bulk calls). Rejected: paging (a new surface; a second page of near-identical cafés
      adds little) and the town-named pages alone (75 to 46 misses, against 32).
    - **Names grow once, for every town.** Homes draw from a grammar (a family, a house
      name, a flat, an ISP default), its words seeded by the 14 current names; the surname,
      street and filler lists grow to two or three times their size. Millbrook's homes and
      businesses and the 28 corporations are renamed once, before launch, as 5b renamed
      Millbrook's businesses: keys and addresses stay, goldens are re-pinned, a byte-diff
      shows nothing else moved. A test pins every kind's name space well above what the
      world draws. Lands in 8b. Rejected: new lists for new towns only (two naming
      mechanisms, Millbrook an exception again) and keeping the lists with a cap (names
      repeat across a city; slice 9's filler may reach the cap).
    - **The sweeps take a fixed covering sample.** The whole-world content tests keep the
      landmarks and the uncatalogued keys whole, and from the towns take all of Millbrook,
      the corporations, and in every other town one network of each (category, subtype,
      profile) it holds. The sample is fixed, so a red run reproduces. The same tests sweep
      every declared network when an environment flag is set, and each slice's PR gate runs
      that full sweep once and records it. `checkBudgets` times the sample. Lands in 8c.
      Rejected: a rotating sample (a failure may not reproduce; a PR goes red for what it
      did not cause) and sweeping everything (3m15s now, more after slice 9).
    - **8's remaining calls** (taken in bulk):
      - Rows are appended in landing order: Ashby `t2` (8a), Oakhurst `t3` (8b), Kingsford
        `t4` (8c), then the four villages and two towns `t5`–`t10` (8d).
      - Institutions are named by rule from the town's name. Every size keeps a council
        (`{Town} Town Council`, `{town}.gov`, `TOWN-HALL-WIFI`), a police force
        (`{Town} Police Department`, `{town}pd.gov`, `{TOWN}-PD`) and a library
        (`{Town} Public Library`, `{town}library.org`, `LIBRARY-PUBLIC`). Millbrook's three
        spell exactly that, so its row moves onto the rule unchanged; its cottage hospital
        stays hand-declared. A town or a city also keeps a courthouse (`{Town} County
        Court`, `{town}courts.gov`, `COURTHOUSE-WIFI`). A city always keeps a hospital
        (`{Town} General Hospital`), a town draws 0–1 on `town-hospital-<town key>`, a
        village none. No university and no schools: education is a later category.
      - Counts by size class (the prototype's; decision 6's ranges hold):

        | | businesses | homes | practices | branches | networks |
        |---|---|---|---|---|---|
        | village | 3–6 | 4–8 | 1–2 | 1–2 | ~15–20 |
        | town | 12–24 | 12–24 | 2–4 | 2–3 | ~38–55 |
        | city | 40–80 | 40–80 | 5–8 | 3–5 | ~166 |

        A new town orders its networks institutions, businesses, homes, practices, branches.
      - **The weakest call, confirmed:** a branch's ESSID stays `<PARENT>-<TOWN>`, and a test
        pins every declared ESSID at 32 characters at most; the town names and the grown
        word lists are chosen to pass it. A later row or word can fail it and force a rename
        at authoring time, never in play. Rejected: shortening the parent's part when it
        overflows (a carve-out).
      - Leads stay within a town, but for slice 7's branch leads; the headquarters and the
        corporations are unchanged.
      - The relations cache memoises `relationsFrom` and `relationsTo` per key, the measured
        remedy for a slow box (6.1 ms to 0.78 ms in the city, 35 ms cold). Lands in 8b,
        whose town first breaks the 2 ms budget (2.8–3.7 ms measured).
      - findit's index split (decision 16) lands in 8d: a publisher with no journal rows is
        listed from a memoised index built from generation, only machines with rows are
        rebuilt, and a player network's gateway with no rows is skipped (it serves no
        `:80`). 8d's RED first proves live against local Supabase whether one read naming
        778 machines (a 12.3 KB URL) holds, and splits the read only if it fails.
        `checkBudgets` gains the cold index-build limit set from 8d's measurement (AC-9).
      - Content failures at scale are fixed as each PR meets them, one owner-confirmed rule
        each, as slice 5 did; none is decided now. Each PR's RED runs the full sweep over
        its new town; the prototype's list above is where each starts.
      - 8a reshapes the tests that assume one town: ESSIDs unique within a town, a
        directory kept by every council, findit's institution-ranking tests, the branch
        tests that assume one branch, gateway counts. Test-side only.
      - A new live wire-check, `testTowns.ts`, covers every declared town: its council
        fetched by domain (AC-2), `whois` on it, one of its sites found on findit by "<town>
        <kind>", a join to it refused. It grows with each PR; `testMillbrook`, `testFindit`
        and `testJoinRefusal` keep running.
      - AC-2 closes in 8a and AC-1 in 8d. AC-9 is split: the sampled sweep's timing in 8c,
        the cold index limit in 8d. `world-content-architecture.md` and
        `discovery-architecture.md` follow each PR.
      - 8a bumps the minor version to 0.299.0, 8b to 0.300.0, 8c to 0.301.0, 8d to 0.302.0.
        Ridgemont is untouched (slice 9).

19c. **8b splits: the names first, then the town** (grilled 2026-10-02, owner-confirmed). Where
    19b's four PRs name 8b the town size class, 8c the city and 8d the remaining rows, read
    8c, 8d and 8e. The rows keep their keys: Oakhurst `t3` lands in 8c, Kingsford `t4` in 8d,
    `t5`–`t10` in 8e.
    **Facts measured while grilling** (against `main` at `d4af4364`, by a throwaway prototype
    declaring Oakhurst as a town after Ashby, with placeholder home names, then reverted; the
    diff kept outside the repo):
    - Oakhurst (`r0/t3`, `87.38.x.y`) draws **47** networks: council, police, library,
      courthouse and a hospital (the 0–1 draw gave one); 18 businesses, 20 homes, 2 practices;
      2 branches (of `c23` and `c18`). Unlisted: police, library, grocer, pharmacy. All 168
      declared addresses distinct; the longest ESSID 27 characters. Still no corporation keeps
      branches in two towns, so the join between two `Host` blocks on one gateway stays
      unreached.
    - **2.56 ms a box** in Oakhurst (Millbrook 1.21, Ashby 1.84); the relations memo brings it
      to **0.85** (every town under 1 ms), the first lookup 1.7 ms. `checkBudgets` times
      Ridgemont's boxes alone today.
    - **Names do not run short yet**: every kind can form 52 or more names and the world draws
      at most 3 of any. But one town repeats its words: Willow, Summit, Compass, Bluebell,
      Carver and Ellison each name two of Oakhurst's places, and Willow a third, a home.
    - **14 assertions fail, three real**: three offices back up nightly to one phone (Willow
      View's `iphone-148`, reached by its forward on `:2222`), which then holds 127 files and
      a fourth folder; a courthouse desk's mailbox holds three replies and no opener; a
      supplier's invoice is filed into an invoices department already holding ten, making
      eleven. **Eleven test-side**: the directory test knows only the earlier councils;
      "court" now finds `oakhurstcourts.gov` first; a router count assuming few networks; two
      relation goldens; the backup copies' test compares an unsorted list; a café share's own
      invoices department read as a supplier's; a desk whose `.ssh` holds only contractor
      leads; a branch keeping no web server, which no rule asks of it; and the `.env` test's
      `/PASS/i` matching "Com**pass** Holdings", likely 19b's "database password" too.
    - **Names reach content**: renaming moves the text of every Millbrook, Ashby and
      corporation box, and the `.env` failure is a name tripping a content check. A town's
      content is only measured honestly on the names that ship.

    **The split**: 8b renames, with no new town, so its byte-diff shows names and the text
    quoting them and nothing else; 8c then declares Oakhurst on the names that ship.
    Rejected: one PR (one byte-diff mixing renamed text with a whole new town) and the town
    first (Oakhurst on throwaway home names, its content checked on names about to move).

    **The home grammar** (owner-confirmed): four forms, each with its own place.

    | Form | Weight | ESSID | Place |
    |---|---|---|---|
    | family | 35 | `THE-{SURNAME}S`, `{SURNAME}-FAMILY`, `{SURNAME}-WIFI` | "the {Surname}s' house", "the {Surname} family home" |
    | house name | 30 | `{HOUSE}` | the name ("Rose Cottage", "The Old Rectory") |
    | flat | 15 | `FLAT-{1–9}{A–D}`, `{GARDEN/TOP/BASEMENT}-FLAT` | "flat 2A", "the garden flat" |
    | ISP default | 20 | `{NETGEAR/LINKSYS/TP-LINK/BT-HUB}-{4 hex}` | a drawn description ("the house on the corner") |

    Homes keep **surnames of their own**, seeded by Hargreaves, Okonkwo, Kowalski and Nguyen and
    grown to 30 or more, so no home reads as the family behind a shop of its town. A house name
    is `{plant} {building}` (Rose, Bramble, Pear Tree, Willow… by Cottage, House, View, Lodge)
    or one that stands alone (The Old Rectory, The Barn Conversion, The Granary). A surname
    ending in "s" takes none more (`THE-HARGREAVES`, "the Hargreaves' house"). Rejected: the
    businesses' surnames (one list fewer, but a home would read as a shopkeeper's) and a
    hand-written list grown to about 100 (no grammar, but a city repeats homes across towns).

    **8b's remaining calls** (owner-confirmed in bulk):
    - The 14 hand-written homes give way to the grammar, drawn on `town-homes-<key>`; the
      count is drawn first, as today, so no town's home count moves. Every form's place reads
      after "at" ("bills at Rose Cottage").
    - A house name's plant words stay out of the businesses' filler list, so Willow View never
      stands beside Willow Insurance.
    - The businesses' lists triple: surnames 24 to 72, streets 12 to 36, fillers 20 to 60.
      Every name drawn from them moves, as 19b accepted.
    - A test pins every business, practice, corporation and home kind at **150 or more names**
      it can form; at triple size the least is the coffee bar's 156, where the prototype world
      drew 23.
    - **Every name a template can form fits its ESSID**, not only the names drawn: a branch's
      ESSID with the longest town name stays in 32 characters, and the words are chosen so
      Hollowmere (ten letters, 8e) fits too. It hardens 19b's weakest call, so a later row can
      never force a rename. Merriweather leaves the surnames (`MERRIWEATHER-ABERNETHY-HOLLOWMERE`
      is 33).
    - **No word names two places in one town** (the weakest call, flagged): among the
      businesses, practices and homes a town draws, a name sharing a word with one already
      drawn is drawn again, by the redraw that already refuses a held ESSID or domain. A
      branch carries its parent's name and is not drawn, so it is outside the rule. Rejected:
      "while another is left" (a carve-out). 8d's city prototype measures whether the tripled
      lists hold it at 80 and more names.
    - Renamed: Millbrook's and Ashby's businesses, practices and homes, and the 28
      corporations, their branches' ESSIDs following. Keys, addresses, kinds, profiles, the
      unlisted and relation draws, the institutions and Millbrook's hospital do not move.
    - Evidence: a byte-diff against `main`, names normalised, shows nothing else moved, and
      anything structural that does is read in RED; goldens are re-pinned; 8a-5 holds again
      over the new names ("Millbrook café" lists the new café). `testMillbrook`, `testTowns`
      and `testFindit` rerun live, updated where they spell a name. Stryker on the grammar,
      the word rule, the name-space and the fit tests.
    - `world-content-architecture.md` describes the grammar, the lists and the word rule;
      `discovery-architecture.md` re-pins its examples (Whitlock's Café, Westbrook Haulage).
    - Versions: 8b 0.300.0, 8c 0.301.0, 8d 0.302.0, 8e 0.303.0.
    - Carried to 8c: Oakhurst's measurements, the three real failures and the eleven
      test-side ones above. 8c's own rules (each content rule, the courthouse, the hospital,
      the memo) are settled when 8c is planned, 19b's calls standing.

19d. **8c: Oakhurst, the town size class** (grilled 2026-10-02, owner-confirmed in bulk).
    **Facts measured while grilling** (against `main` at `ec25c6fd`, the names 8b shipped, by a
    throwaway prototype declaring Oakhurst as a town after Ashby, then reverted; the diff kept
    outside the repo):
    - Oakhurst (`r0/t3`, `87.38.x.y`) draws **47** networks again: council, police, library,
      courthouse and a hospital (the 0–1 draw gave one); 18 businesses, 20 homes, a clinic and
      a dentist; branches of `c23` and `c18`. Unlisted: police, library, Millstone Market,
      Varley Chemists. All 168 declared addresses distinct; the longest ESSID 26 characters; no
      word names two of its places. Still no corporation keeps branches in two towns.
    - **2.51 ms a box** in Oakhurst (Millbrook 1.19, Ashby 1.80, the corporations 0.93); the
      relations memo brings it to **0.82** and every town under 1 ms. `checkBudgets` times
      Ridgemont's boxes alone, so no gate sees the breach.
    - The suite's file times sum to 744 s against 658 s (+13%); the heaviest file 92 s against
      81 s.
    - **13 assertions fail.** The phone, the courthouse inbox and the eleventh invoice of 19c
      are back on other networks; the `.env` test's "Com**pass**" and the backup copies'
      unsorted list no longer fail, their names gone with 8b.
      - **Two phones keep backups.** A home's outside ssh forward can land on an iPhone,
        which rolls sshd like any box; a home whose forward runs ssh takes a business's
        nightly copy there. Primrose Cottage's `iphone-148` takes three offices' shares (127
        files, a fourth folder) and The Old Forge's `iphone-136` one. No village forwards to a
        phone. Three Oakhurst homes keep two or three firms' copies each, none on a phone.
      - **An eleventh file in a department.** Acorn Roasters' share keeps an invoices
        department of its own, drawn full at ten, and is sent Millstone Market's invoice. It
        is the only share in the world whose supplier invoice lands in a department of its
        own; the others file into a folder made for it.
      - **A courthouse desk's inbox is all replies** (`laptop-226`: three "Re:"). It is not
        new: 26 people on 25 networks, Ridgemont's landmarks among them, are sent nothing but
        replies, being the ones who start their threads. The desk test is the one that looks.
      - **Test-side**: the "court" ranking (`oakhurstcourts.gov` now ties
        `ridgemontcourts.gov`), the directory and word-rule tests naming the earlier towns, a
        router count, two relation goldens, the supplier test reading a café's own invoices
        department as a supplier's, a desk whose `.ssh` holds only contractor leads, and a
        branch held to keeping a web server, which publishes nothing.
    - **8b's survivors**: Oakhurst draws no numbered flat and no router suffix under `1000`,
      so 8 of the 11 stay unreached; the other three are read at the gate.
    - The courthouse runs the `cases` application a `government` network draws, and the
      hospital the `appointments` one, as Millbrook's cottage hospital does.

    **8c's calls** (owner-confirmed in bulk):
    - **Size classes are one table** of the four count ranges, village (businesses 3–6,
      homes 4–8, practices 1–2, branches 1–2) and town (12–24, 12–24, 2–4, 2–3). A town row
      is a name and a class; Millbrook and Ashby are village rows and draw what they draw
      today.
    - **Oakhurst** is `r0/t3`, a town, declared after Ashby, its names avoiding every network
      before it, its networks ordered institutions, businesses, homes, practices, branches.
    - **A town's institutions** are the council, police and library, a courthouse (`{Town}
      County Court`, `{town}courts.gov`, `COURTHOUSE-WIFI`, "the courthouse") and a hospital
      drawn 0–1 on `town-hospital-<key>` (`{Town} General Hospital`, `{town}hospital.org`,
      `GENERAL-HOSPITAL`, "the hospital", subtype `hospital`). The council's directory links
      both.
    - **A business's offsite copy lands on a computer, never a phone**: a home whose ssh
      forward reaches a phone takes no backup and keeps its contractor leads. It moves two
      Oakhurst homes' leads and nothing in a village. One home may keep several firms'
      copies. Rejected: no home forwarding ssh to a phone (moves `seededForwards` everywhere,
      and contractor leads to a phone break nothing), and one backup a home (a phone keeping
      one still breaks the phone's rules).
    - **No share department holds more than ten files, a supplier's invoice included**: a
      share that is sent invoices draws its invoices department with room for them. It moves
      Acorn Roasters' share alone.
    - **The all-replies inbox is test-side** (the weakest call, flagged): 19c counted it real,
      but a mailbox of replies is what a person who starts every thread keeps, 25 networks
      already hold one, and a rule would move Ridgemont's mail. The test's claim is that an
      opener carries no `In-Reply-To`, so it checks the world's openers, not one per desk.
    - **The test-side failures are reshaped**, never loosened past what each claims: "court"
      finds a county court first and "ridgemont court" Ridgemont's; the directory and
      word-rule tests read every declared town; the router count reads the world; the
      relation goldens pin per town; the supplier test finds the supplier's invoice by name;
      a desk's `.ssh` may hold contractor leads alone; a branch, publishing nothing, is held
      to no web server.
    - **The relations memo lands**: `relationsFrom` and `relationsTo` are memoised per key
      (the world they read is fixed at load). **`checkBudgets` times every procedural box**,
      the towns' and the corporations', beside Ridgemont's under the same 2 ms, so the
      breach it fixes is gated; 8d moves it to the sample.
    - **The suite keeps sweeping every network**; the fixed sample still lands with the city
      (8d).
    - Evidence: declaring Oakhurst is the RED; each rule's test names a world-wide property
      (no phone keeps `backups`, no department holds more than ten files); a dump against
      `main` shows Ridgemont, Millbrook, Ashby and the corporations unmoved but for the
      corporations gaining Oakhurst branches. The memo is a pure refactor, shown by the dump and
      the timing.
    - **8b's 11 survivors are re-run at 8c's gate**; whatever stays unreached is recorded with
      its reason and carried to 8d, whose 40–80 homes reach it.
    - `testTowns` adds Oakhurst: its council and its courthouse fetched by domain, a site found
      by "Oakhurst <kind>", a join refused. `testMillbrook`, `testFindit` and
      `testJoinRefusal` rerun live.
    - `world-content-architecture.md` describes the size classes, the courthouse, the hospital
      and both rules; `discovery-architecture.md` the court example; `conventions-and-gotchas.md`
      §3 the memo as the measured cache. The minor version is bumped to 0.301.0.

19e. **8d: Kingsford, the city** (grilled 2026-10-02, owner-confirmed in bulk).
    **Facts measured while grilling** (against `main` at `241eb297`, by a throwaway prototype
    declaring Kingsford as a city after Oakhurst, then reverted; the diff kept outside the
    repo):
    - Kingsford (`r0/t4`, `87.135.x.y`) draws **166** networks, the 19b prototype's figure:
      council, police, library, courthouse and hospital; 71 businesses, 80 homes, 6 practices;
      branches of `c21`, `c11`, `c7` and `c1`. 12 unlisted. All 334 declared addresses
      distinct; the longest ESSID 28 characters. Still no corporation keeps branches in two
      towns.
    - **The word rule holds at a city**: Kingsford's businesses are redrawn 24 times and its
      practices 3, with no sign of running short.
    - **Build time**: Kingsford 1.4–1.5 ms a box, as cheap as any set. The machine is slower
      than at 8c: on `main` the sets read 1.3–1.9 ms, and Ashby's 121 boxes 1.62–2.16 ms with
      nothing in Ashby changed, failing the 2 ms ceiling twice.
    - **findit**: every search builds its index from 175 pages in about **700 ms**, against
      `main`'s 350 ms over 105 (idle machine).
    - **The suite**: file times sum to 1175 s against 607 s; the 26 files that sweep the
      world take 879 s of it.
    - **8b's carried survivors**: Kingsford draws nine numbered flats (`FLAT-1A`–`FLAT-9C`),
      so the floor and door (7) are reached; no router suffix under `1000`; a city does not
      read the hospital draw.
    - **The sample's size**: one network of each (category, subtype, profile) a town holds
      is Ashby 12, Oakhurst 26, Kingsford 38; with branch and unlisted in the key 14, 27 and
      52. With Millbrook and the corporations whole, 137 of 277 procedural networks. It would
      have caught none of the failures below: each is one network, or a coincidence.
    - **7 assertions fail.**
      - **A lone home keeps an empty spool.** `TP-LINK-5C3A` has one person, and its mail
        server `imap-3` keeps `/var/mail/listadm`, empty, where the test holds that a network
        one person has to themselves keeps no correspondence, not even as a spool.
      - **Four pairs of access points show one front page**: each pair shares a vendor, a
        hostname and a LAN `/24` (`r0/t4/n65` and `n139` at `192.168.66.1`, `n97` and `n120`,
        `r0/t1/n16` and `r0/t4/n49`, `r0/t3/n14` and `r0/t4/n59`). The page holds those three
        and nothing else.
      - **Two shares whose ftp daemon is stopped hold a supplier's invoice and no transfer
        log** (Southgate Tax and Accounts' `share-189`, Nesbitt Insurance Brokers'
        `share-121`); neither logs any file's arrival.
      - **Test-side**: "police" finds `kingsfordpd.gov` first; "wards" finds
        `kingsfordhospital.org` first; the branch golden; the backup test sorts the folders a
        box keeps and not the list it expects (19c's "unsorted list").
    - **"cafe" finds no café**: an unaccented query matches no "Café", in `main` too ("Millbrook
      cafe" finds the institutions, "Millbrook café" the cafés).

    **8d's calls** (owner-confirmed in bulk):
    - **findit's index split stays in 8e.** 700 ms a search is under the 800 ms decision 16
      accepted before the split, and the game is not launched. Rejected: the split first, as a
      PR of its own (no breach at 105 pages to prove it against, 19b's reason).
    - **The city joins the size table** (businesses 40–80, homes 40–80, practices 5–8,
      branches 3–5). **Kingsford** is `r0/t4`, a city, declared after Oakhurst, its names
      avoiding every network before it, its networks ordered institutions, businesses, homes,
      practices, branches.
    - **A city always keeps a hospital** and reads no `town-hospital-` draw; it keeps the
      courthouse. The council's directory links both.
    - **The sweeps take the fixed sample**: it replaces `TOWN_KEYS` in `ALL_ESSIDS`, so it
      reaches the content sweeps alone. It keeps the landmarks, the uncatalogued keys, all of
      Millbrook and the corporations, and in every other town the first network in key order
      of each shape it holds, a shape being category, subtype, profile, whether a branch and
      whether unlisted. `relations`, `webIndex` and `world` keep reading the whole world: they
      are its cross-network rules. `WORLD_SWEEP=full` sweeps every declared network; each PR's
      gate runs it once and records it. Rejected: 19b's three-part key (a branch and an
      unlisted business swept only where one comes first).
    - **`checkBudgets` keeps timing every box**, a set at a time, and reads the **best of
      three** timed passes. It reverses 19d's "8d moves it to the sample": the whole check takes
      about 13 s, a smaller set times noisier, and noise only ever adds time.
    - **A network one person has to themselves keeps no mail, not even an empty spool on its
      mail server.** It moves `TP-LINK-5C3A` alone.
    - **Identical access-point front pages are test-side** (the weakest call, flagged): two
      routers of one make, one hostname and one subnet show one status page, as real ones do.
      The test claims the front page differs wherever the vendor, the hostname or the LAN
      address does, which a page drawn from one template still fails. Rejected: a row naming
      the network (an SSID or a WAN address) on every access point's page (moves Ridgemont,
      and a WAN address is a carve-out for networks with none).
    - **A share whose ftp daemon is stopped is test-side**: it logs no file's arrival, so the
      test claims an invoice's arrival is logged exactly when the share logs the files beside
      it.
    - **The test-side failures are reshaped**, never loosened past what each claims: "police"
      finds a police department first and "<town> police" its own; "wards" finds a hospital
      first; the branch golden adds Kingsford's branches; the backup test sorts what it
      expects.
    - Evidence: declaring Kingsford is the RED; each real rule's test names a world-wide
      property; a dump against `main` shows Ridgemont, Millbrook, Ashby, Oakhurst and the
      corporations unmoved but for `c1`, `c7`, `c11` and `c21` gaining Kingsford branches.
    - **The 13 carried survivors are re-run at 8d's gate**; the router suffix's leading zeros
      and the hospital draw's three are expected to stay unreached and carry to 8e's towns.
    - `testTowns` adds Kingsford: its council and hospital fetched by domain, a site found by
      "Kingsford <kind>", a join refused. `testMillbrook`, `testFindit` and `testJoinRefusal`
      rerun live.
    - `world-content-architecture.md` describes the city, the hospital rule and the mail rule;
      `conventions-and-gotchas.md` the sample, `WORLD_SWEEP=full`, the gate's full sweep and
      the best-of-three timing; `discovery-architecture.md` the police example. The minor
      version is bumped to 0.302.0.
    - **Carried to 8e**: "cafe" finding no café is fixed with 8e's findit work, not here.
    **Amended while building 8d** (owner, 2026-10-02):
    - **A city draws its hospital as a town does.** Kingsford's `town-hospital-r0/t4` draw
      keeps one, so "always, reading no draw" could not be told apart from the town's rule and
      no test could demand it. A later city whose draw keeps none shows in its own golden.
    - **findit's journal read is split in 8d, not 8e.** With Kingsford the one read named 529
      machines in a 12.6 KB URL, and local Supabase refused it ("URI too long"), so every
      search came back empty in the wire-checks. 19b's own fallback ("splits the read only if
      it fails") was taken one PR early; the memoised index and the cold-build limit stay in
      8e.

19f. **8e: the remaining rows; 8f: findit's memoised index** (grilled 2026-10-02,
    owner-confirmed in bulk).
    **Facts measured while grilling** (against `main` at `9446a858`, by a throwaway prototype
    declaring the six rows after Kingsford, the sixth town named Stonebury, then reverted; the
    diff kept outside the repo):
    - The rows draw **157** networks: Fenwick (`t5`, `87.232`) 15, Thornbury (`t6`, `87.75`)
      20, Hollowmere (`t7`, `87.172`) 17 and Ely (`t8`, `87.15`) 16, villages; Wexcombe (`t9`,
      `87.112`) 38 and Stonebury (`t10`, `87.209`) 51, towns. **491** declared networks, all
      at distinct addresses; the longest ESSID 29 characters; 283 sited.
    - **Wexcombe's hospital draw keeps none**, and Stonebury's keeps one. Ely draws
      `BT-HUB-0A0C` and `NETGEAR-0E06`, router suffixes under `1000`. Four corporations keep
      branches in two towns: `c1` (Kingsford, Fenwick), `c3` (Hollowmere, Stonebury), `c17`
      (Ashby, Thornbury) and `c23` (Oakhurst, Hollowmere).
    - **Build time**: every set 0.72–1.02 ms a box (idle machine).
    - **The full sweep**: 7634 tests in 1085 s of file time, against 857 s at 8d. **3 fail.**
      - **Two desks keep one note.** Two people at Hollowmere's School Lane Haulage
        (`r0/t7/n8`) keep the same `contacts.txt`. Its only slot a person fills is
        `{colleague}`, one of 20, so two people drawing the template share it one time in 20;
        ten of the 120 note templates vary by one slot or none beside `{place}`.
      - **"Compass" again**: the `.env` test's `/PASS/i` matches The Compass Teapot's
        `APP_URL=http://web-14.the-compass-teapot.lan:8000/` (`r0/t7/n6`). Test-side.
      - **The branch golden** lacks the rows' branches. Test-side.
    - **findit, nothing patched**: 249 pages from 566 publisher machines; every search builds
      them in **520–570 ms**, warm and idle, the first also paying about 1 s of module load.
      Vercel ran boxes 3.6 times slower than a developer machine (3.1 ms against 0.85), so a
      search there costs about 2 s, every time. No unpatched non-publisher's gateway serves
      `:80`, so the ordinary fetch is never called.
    - **"cafe" finds nothing**; "Fenwick café" lists the cafés of other towns.

    **The calls** (owner-confirmed in bulk):
    - **Two PRs.** 8e the six rows (AC-1, 0.303.0); 8f findit's memoised index, the cold
      index-build limit and accent folding (AC-9, 0.304.0). The breach decision 16 waited for
      is measured, about 2 s a search on Vercel, and one PR would mix a byte-diff of 157
      networks with a change to how every search is served. Rejected: one PR, and findit
      first (its cold limit is set at the launch extent, which only the rows declare).
    - **The sixth row is Stonebury**, a town: nine letters, every branch ESSID in 32
      characters, and the word rule held in the prototype. Rejected: Greyhaven and Redmarsh,
      unmeasured.
    - **Row order is 19b's listing**: Fenwick `t5`, Thornbury `t6`, Hollowmere `t7`, Ely `t8`
      (villages), Wexcombe `t9`, Stonebury `t10` (towns). Eleven towns in Harrow Valley with
      Ridgemont, Millbrook, Ashby, Oakhurst and Kingsford; AC-1 closes.
    - **The towns are declared by one fold from Ashby on**, each town's names avoiding every
      network declared before it; Millbrook, the corporations and Millbrook's branches stay
      hand-placed before it. It lands first, as a pure refactor shown by an unchanged dump.
      Rejected: ten hand-chained `before` lists.
    - **No two people on one network keep the same note** (the weakest call, flagged): a
      desk drops a note a desk at a lower address on its network already keeps. Dropping
      draws nothing, so only School Lane Haulage's desk moves; no landmark keeps a duplicate,
      so AC-7 holds. A desk's notes are the first draw on its own `home-content-` stream, so
      its neighbours' are read without building their boxes. Accepted: every desk now reads
      its neighbours' notes, and a desk may keep fewer than two. Rejected: wider templates
      (move landmark notes, breaking AC-7), and calling it test-side (two identical notes read
      as generated, unlike two routers of one make).
    - **The `.env` test is reshaped**: it reads each line's key, not its value, for `PASS` and
      `DB_`. **The branch golden** adds the rows' branches; the join between two `Host`
      blocks on one gateway is reached at last.
    - **Goldens pin each new town**; Wexcombe's keeping no hospital and Ely's router suffixes
      reach the carried survivors, re-run at 8e's gate.
    - **8e's evidence**: declaring the rows is the RED; a dump against `main` shows only the
      rows and the relations and gateways of the corporations gaining their branches moved;
      one green `WORLD_SWEEP=full` recorded; `checkBudgets` under 2 ms a box in every set.
      `testTowns` adds the six towns (council by domain, courthouse and hospital where kept, a
      site by town and kind, a join refused); `testMillbrook`, `testFindit` and
      `testJoinRefusal` rerun live. `world-content-architecture.md` describes the rows and
      the note rule.
    - **8f, the memoised index**, as 19b laid out: built lazily from generation on a function
      instance's first search; the journal reads stay as they are, 200 machines a read,
      since they are what say which machines are patched; only machines with rows are
      rebuilt, and a player network's gateway with no rows is skipped. A warm search then
      costs its reads and what players touched.
    - **8f, the cold limit**: `checkBudgets` times building that index from nothing at the
      launch extent, one warm-up pass then the best of three as the box sets are timed,
      against a **1,000 ms** ceiling (520–570 ms measured idle; about 800 ms on 8d's slower
      machine). It runs on developer machines only, as the box timing does. Accepted: an
      instance's first search on Vercel takes about 2 s.
    - **8f, "cafe" finds cafés**: the search folds accents on the query and the page alike, so
      "cafe" finds "Café" and "café" a "cafe".
    - **8f's evidence**: a test proves a patched publisher is still rebuilt (defaced, dark or
      stopped) while an unpatched one is served from the memo; `testFindit` runs live;
      `discovery-architecture.md` describes the memo and the folding,
      `conventions-and-gotchas.md` §3 the cold limit.

19g. **9a: Ridgemont's filler, declared and on the WiFi; 9b: the injector turned down**
    (grilled 2026-10-02; decision 1 confirmed singly, the rest owner-confirmed in bulk).
    **Facts found while grilling** (against `main` at `9f209aae`):
    - Ridgemont has no row: its 57 networks are the catalog, keyed by their ESSIDs, and
      nothing in it is generated. Its landmarks fill four institution slots: the council
      (`CITY-HALL-WIFI`), the police (`RIDGEMONT-PD`), the courthouse (`COURTHOUSE-GUEST`)
      and the library (`LIBRARY-PATRON`); it also keeps a university.
    - Drawn as a city on its own streams (`r0/t0`), Ridgemont keeps a hospital (the coin
      flip lands 1), 65 businesses, 44 homes, 8 practices and 3 branches: **121** filler
      networks, **178** with the landmarks.
    - The scan draws 2–3 crackable networks from `crackableEssidPool` (the 57 landmarks) and
      3–5 noise, then injects 0 to `min(n, 3)` occupied networks into every scan. The join
      sends the scan's `essid` as the network key, which has held only because a landmark's
      key is its ESSID: a filler network is the first joinable one whose key (`r0/t0/n57`)
      differs from the name it broadcasts.
    - Seven places check `town === RIDGEMONT` where they mean "a hand-authored landmark":
      the leads (`relations.ts:255`), the seeded forwards (`seededForwards.ts:68`), a site's
      locality (`webSite.ts:518`), the procedural sweep (`src/test/worldContent.ts`), the
      budget sets (`checkBudgets.ts`) and two wire-checks (`testJoinRefusal`, `testTowns`).
      The join refusal (`registerNetwork.ts:102`) means the town.
    - The reachability property counts every Ridgemont network as found ("by standing in
      Ridgemont"), which holds for the filler only once the scan offers it.
    - The home templates cannot spell a landmark's or a noise network's ESSID (`FLAT-3B`
      against `APT-3B-WIFI`, `LINKSYS-0A0C` against `linksys`).
    - The server's occupied-network read is name-only and lists every occupied network;
      only `testSameLanOccupiedEssids` drives it, and nothing reads which scan injected what.

    **The calls**:
    - **Ridgemont is a `city` row** (confirmed singly). Its filler is drawn from the city's
      ranges unchanged: 121 networks. Rejected: a class of its own, or counts of its own, to
      reach the old "~150–300", which would make it denser than Kingsford for nothing a
      player could see.
    - **Only the institutions no landmark fills are generated.** The council, police,
      courthouse and library are the landmarks'; the hospital draw keeps
      `GENERAL-HOSPITAL` (`ridgemonthospital.org`). The university does not stand in for a
      hospital: the code draws only a hospital, so no exception is needed.
    - **The filler is keyed `r0/t0/n57` on**, in a town's order (the hospital, the
      businesses, the homes, the practices, the branches last), and each answers in
      Ridgemont's block at its own position, after the landmarks' 57. It is declared after
      Stonebury, so its names avoid every earlier network and move none of them. **The
      catalog closes at 57**: a hand-written Ridgemont network declared later goes after the
      filler, as Millbrook's hospital did.
    - **The filler is an ordinary town; the landmarks are the exception.** Each check above
      that means "landmark" says so, so the filler gains the leads among its own networks,
      the seeded forwards and ", Ridgemont" on its sites, while no landmark gains a lead, a
      forward or a word (AC-7). The join refusal keeps its town check, so every filler
      network is joinable.
    - **15% of the filler's publishers are unlisted**, as in every town. Ridgemont's council
      is a landmark and keeps no directory (AC-7), so an unlisted filler site is found by
      standing in Ridgemont, as the reachability property already says.
    - **No naming rule is added**: a test proves Ridgemont's 178 ESSIDs are distinct and none
      is a noise network's.
    - **The scan draws from all 178**, landmarks first in catalog order, then the filler in
      key order; still 2–3 crackable and 3–5 noise. Accepted: every player's scans roll
      differently (`pickN` maps onto the pool's length; nothing stored reads a past scan),
      and landmarks are about a third of what a scan offers, as decision 5 accepted.
    - **A filler network is shown and typed by its broadcast name and joined by its key.**
      `airodump-ng`, `nmcli` and the HUD show the ESSID and `nmcli connect` takes it; the
      join, the BSSID, the password and everything stored take the key (decision 4). A
      landmark, whose key is its ESSID, is unchanged. The wiring is planning's.
    - **The injector fires on about 5% of scans** (flagged weak: the number is a guess, "a
      few percent" made concrete). It adds exactly one network, drawn from the occupied
      networks in the scan's own pool that the scan does not already show, so it is
      same-town by construction and an occupied lab network is never injected. A scan with
      nothing to inject takes no draw. The server's read is unchanged. Accepted: staging the
      two-player shared-LAN journey takes about 16 rescans rather than a coin flip;
      `e2e-shared-network-verification.md` says so.
    - **Every sweep and budget takes the filler** (flagged weak: the cost is unmeasured).
      The 26 test files sweeping every generated network (`TOWN_KEYS`) grow by about a
      quarter, measured at planning; `checkBudgets` keeps the landmarks as Ridgemont's set
      and samples the filler with the procedural sets (2 ms a box); findit's cold build
      gains about 70 publishers against the 1,000 ms limit (424 ms at 8f).
    - **Two PRs** (flagged weak: 9a is large). **9a** the filler, declared and on the WiFi
      (AC-10); **9b** the injector (AC-11); each bumps the minor version. 9a cannot split
      further: without the scan the unlisted filler is unreachable, and the key-and-name
      wiring alone has no behaviour a test can see.
    - **Two ACs are added**: AC-10 and AC-11 below.
    - **9b is the plan's last PR.** Its close-out moves the as-built into
      `world-content-architecture.md`, `discovery-architecture.md`, handbook chapter 6,
      `e2e-shared-network-verification.md` and the §9 backlog in
      `conventions-and-gotchas.md`, and retires this plan, as **Done** says.

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
**Complete** 2026-10-01: 6a (#585, v0.295.0), 6b (#586, v0.296.0).

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
**Status**: **complete** 2026-10-01 (#586, `662633d8`, v0.296.0); 6b-1 to 6b-8 hold.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**As built** (2026-10-01):

- Millbrook's practice is **Oakwood Dental** (`OAKWOOD-DENTAL`, `oakwooddental.com`,
  `r0/t1/n16`, `flat`, `87.98.24.218`), as the prototype measured but for its name. Its
  gateway forwards its site (`80 → .34:80`) and ssh to its phone (`2222 → .235:22`), and the
  contractor desk's lead logs in there (`lschmidt@iphone-235:2222`).
- The business name draw is generalised (`namedOf` in `world.ts`, taking a stream) and
  reused for the practices; `NamedSubtype` (business or practice) keys `NAME_TEMPLATES`, and
  `NetworkSubtype` adds `'hospital'` to it.
- `SITE_WORDS.clinic` became "GP appointments, vaccinations and blood tests": planning's
  "repeat prescriptions" is the pharmacy's own word.
- Re-pinned once, deliberately: the declaration, the profiles, the unlisted pick, the
  relations graph, the invoices on `files-16` and the gateway forwards. The findit "police"
  test is back to its pre-6a form (both police sites listed). Byte-diff against `main`:
  every landmark and findit box identical; inside Millbrook only the files 6b-5 names moved
  (Abernethy's Books also dropped its robots-only `preview/`, by 6a's rule).
- Evidence: `vitest run` 6,724 green, typecheck and lint clean. `testMillbrook` 10/10 and
  `testFindit` 18/18 live; `checkBudgets` 248,740 B gzipped and 1.697 ms per box (a loaded
  run failed on `main` too, 2.754 ms, while Docker unpacked new Supabase images).
- Stryker (narrowed battery, json reporter): 23 killed, 32 survived, 1 no coverage. By hand,
  15 survivors throw at module load and fail every file (killed); 18 are equivalent in a
  one-town world: 7 in the "no kind twice" rule (one practice drawn), 10 in the name-clash
  checks (no clash drawn), and `site ?? []` (every institution publishes).
- **Carried to slice 8**: a second practice, the "no kind twice" rule and a declared clinic
  are unreachable while Millbrook is the only town; slice 8's towns reach them.

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

**Decisions taken in planning** (the grill's, made exact; owner-confirmed 2026-10-01):

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
- **Words**: `SITE_WORDS.clinic` `{ care: 'GP appointments, vaccinations and blood
  tests' }` (planning wrote "repeat prescriptions", the pharmacy's word; changed in
  implementation), `SITE_WORDS.dentist` `{ care: 'check-ups, fillings and the hygienist' }`.
- **Unreachable in a one-town world, carried to slice 8**: the second practice and the "no
  kind twice while the other is left" rule (Millbrook draws one), and a declared clinic. Their
  mutants are equivalent for Millbrook, as 5b's were; slice 8's sampled towns reach them.

**Acceptance criteria** (owner-confirmed 2026-10-01):

- [x] **6b-1** A town draws 1–2 practices on `town-practices-<town key>`, each a `healthcare`
      network with subtype `clinic` or `dentist`, no kind twice while the other is left,
      appended after the institutions declared later. Millbrook's is a dentist at
      `r0/t1/n16`; every key, address, LAN and password before it is unchanged, and no
      landmark declares a practice.
- [x] **6b-2** A practice's name comes from its subtype's grammar on
      `town-practice-names-<town key>`, spelt into its ESSID and `.com` domain as a business's
      is (ESSID at most 32 characters). No network in the world shares its name, ESSID or
      domain; a draw that would is redrawn. Every template of both grammars fills to a name
      that spells cleanly.
- [x] **6b-3** A practice is a business in every rule but its count: it always publishes, it
      is in its town's unlisted draw, it is a lead's target as a business is (an unlisted
      practice gets a supplier), the council's directory lists it no more than a shop, its
      profile is drawn from healthcare's row (never `lone`), and it forwards its site and
      one thing more, as every healthcare network does. (Planning wrote "forwards one
      thing"; corrected 2026-10-01: the site's forward stands beside the one drawn.)
- [x] **6b-4** A practice's site says what it is: its findit description and front pages fill
      `{care}` with its subtype's words, a clinic's and a dentist's each carry their own words
      and none of the other's or the hospital's (no dentist mentions wards), and findit lists
      Millbrook's dentist, when listed, for its own words. Its team page is `clinicians.html`
      and its database `appointments`, as every healthcare network's.
- [x] **6b-5** Nothing outside Millbrook moved: a byte-diff of every landmark and findit box
      against `main` is empty, and the AC-7 fingerprint test passes untouched. Inside
      Millbrook only the unlisted pick (police listed, Abernethy's Books unlisted), the
      `robots.txt` and robots-only directories that follow it, the new supplier invoice and
      its backup copy, the share's upload log, and the contractor desk's ssh config and known
      hosts move, plus the new `n16`; their pins are re-pinned once, deliberately.
- [x] **6b-6** Slice 4's and 5's guarantees hold over the grown Millbrook (AC-4, every home
      1–3 leads, every home that forwards ssh a backup, every unlisted business or practice a
      supplier, the town's office with its desk and working share), and every whole-world
      content property holds over `n16` through the town sweep. If one fails, work stops and
      the owner gets the failure with one rule that fixes it.
- [x] **6b-7** `testMillbrook.ts` and `testFindit.ts` pass live against the grown town, and
      `checkBudgets` passes.
- [x] **6b-8** `world-content-architecture.md` describes the practices, their grammars and
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

### Slice 7: procedural corporations

Grilled 2026-10-01 (decision 19a, "Slice 7's shape"). Two PRs, in order: 7a the
corporations, 7b the branches. 7a planned 2026-10-01; 7b is planned after 7a merges.
**7a complete** 2026-10-01 (#587, v0.297.0). **7b complete** 2026-10-01 (#588, v0.298.0).
**Slice 7 complete.**

### Slice 7a: the world holds 20–40 corporations that stand in no town

**Value**: a player searching findit meets companies beyond Acme and Initech: 20–40
corporations with sites of their own, answering in the `193` block, which `whois` names
without a town. Breaking in, each reads as an office of its kind all the way down. Slice 7b
hangs the branches off them, and slice 8's towns draw their branches from them.
**Path**: the world draws the corporations on `corporations` (count and kinds) and
`corporation-names` (names) → each is a `corporate` network keyed `c<n>`, declared after
Millbrook's networks, with no town → its address is the placeless block's position 21 + n →
its profile on `network-profile-c<n>`, its forwards on `gw-forwards-c<n>` → findit indexes
its site, `whois` names it, the server refuses a join to it. A player sees it in findit, in
`whois`, and in every file on its boxes.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-corporations`.
**Status**: **complete** 2026-10-01 (#587, `8c763868`, v0.297.0); 7a-1 to 7a-9 hold, 7a-4 as
amended below.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**As built** (2026-10-01):

- The world holds **28** corporations, `c0`–`c27`: 13 `flat`, 15 `deep`, from `c0` Keystone
  Holdings (insurance, `193.71.60.53`) to `c27` Varley & Ellison (logistics, `193.234.27.227`).
  A golden test pins each key, kind, profile, name and address.
- The name draw (`filledName` in `world.ts`) fills every slot of a template with no word
  twice, for every template; a business's one slot draws as before, so Millbrook's names did
  not move. "Thackeray & Thackeray" is gone; `namedOf` takes the templates as a parameter.
  `distinctKinds` holds "no kind twice while another is left" for the practices and the
  corporations alike.
- `DeclaredNetwork.town` and `region` are optional: `whois`, the persona and the site slots
  handle a network in no town at compile time. Relations ask `leadingTown`, which has none
  for Ridgemont or for a network in no town. A `flat` office draws 3–5 machines
  (`FLAT_OFFICE_COUNT_MIN`, by `isOffice`).
- **7a-4 amended**: findit shows at most ten results (`MAX_RESULTS`), so a kind's word cannot
  list every corporation of the kind: `freight` already fills its page with the nine
  logistics corporations and Westbrook Haulage. The test holds instead that every
  corporation is indexed, described in its kind's words, and first for its own name.
- Evidence: `vitest run` 6,797 green, typecheck and lint clean. Byte-diff against `main`:
  1,144 fingerprints (every landmark, findit and Millbrook box, address, persona, forward,
  relation and findit page) identical. `testJoinRefusal` 5/5, `testFindit` 19/19 and
  `testMillbrook` 10/10 live; `checkBudgets` 249,062 B gzipped and 0.920 ms per box.
- Stryker (narrowed battery, json reporter): 129 killed, 54 survived. By hand, 33 survivors
  throw at module load (killed); a new test, that every lead is read back from the network
  it starts on, kills 2 (it found nothing held `relationsFrom` to its own leads). 19 are
  equivalent: compiler-only no-town checks in `whois`, the persona and `relationsTo`;
  `relationsFrom`'s filter while Westbrook Haulage keeps every Millbrook lead; and the
  name-clash redraw with no clash drawn.
- **Carried to slice 8**: findit's ten-result page, which a kind's search now fills; the
  name-clash redraw and `relationsFrom`'s filter, which a second town or a second keeper
  reaches.

**Facts measured while planning** (2026-10-01, against `main` at `53fac56d`, by a throwaway
prototype of the draw, reverted):

- The count draws **28**. Names come out as `Keystone Holdings`, `Bluebell International`,
  `Quayle & Carver`, `Garrow Group`, … ; their ESSIDs and domains spell cleanly. Two
  near-pairs read close (`Compass International` and `Compass Holdings`, `Bluebell
  International` and `Bluebell Holdings`), and one draw was **`Thackeray & Thackeray`**: the
  business draw fills only a template's first slot, and nothing stops two slots taking the
  same surname.
- Profiles: 15 `deep`, 13 `flat`. Addresses spread over `193.2`–`193.241`, every one
  distinct from the rest of the world. Each draws 1–2 forwards beside its site's `:80`.
- findit's index grows from 48 to 76 pages; a full index build (nothing patched, no cache)
  goes from about 180 ms to about 265 ms. The split stays in slice 8.
- The suite goes from 6,724 tests in 89 s to 6,780 in 97 s: the whole-world sweep takes
  every network outside Ridgemont (`TOWN_KEYS`), so it covers the corporations unasked.
- Every reader of a network's town, and what a placeless one does there: `whois` already
  drops `city:` and `region:` for the `193` block and names a publisher by its site;
  `registerNetwork` admits only Ridgemont, so a join to a corporation is refused unchanged;
  `seededForwards` draws for any network outside Ridgemont; `relationsTo` and
  `relationsFrom` would treat the corporations as one town of their own (each other's
  keepers) and must return nothing; the persona carries the town into `{town}`, which no
  corporate template reads (only public, government, healthcare and one retail page do).
- **Four tests fail over the prototype**, three of them whole-world content properties the
  corporations reach first:
  - an office keeps a desk and a working share beside its site server: `c19` is `flat`
    with two machines, which cannot hold three roles. Slice 6 carried this to slice 8 ("a
    `flat` office with at least 3 machines"); the corporations reach it now;
  - no two boxes of a network hold a byte-identical free-text file: `c26`'s two file
    servers both drew the legal department's `README.md` with the same person;
  - the same for web servers: `c27`'s two web servers drew the same `robots.txt`
    (`Disallow: /.env`, `Disallow: /legacy/`);
  - Millbrook's "no kind for a council, library, home or Ridgemont network" test assumes
    every kinded network is in a town (test-only).

**Decisions taken in planning** (owner-confirmed 2026-10-01):

- A corporation declares no `town` and no `region`; the declaration's type says so, so
  every reader of a town meets the case at compile time.
- The grammar lives beside the businesses' in `pools/businessKinds.ts`:
  `{surname} Group`, `{filler} Holdings`, `{surname} & {surname}`,
  `{filler} International`. Every slot is filled, and the two surnames of one name differ.
- The count and each corporation's kind are drawn on `corporations`, kinds without repeat
  while any of the five is left; names on `corporation-names`, after every declared name,
  so the world-unique check covers landmarks and Millbrook and no name before them moves.
- The corporations are declared after Millbrook's networks, so `DECLARED_NETWORKS` keeps
  every earlier position.
- **The three content failures are fixed by rules** (5a's and 6b's practice: a failure
  comes back to the owner with one rule):
  - **a `flat` office keeps 3–5 machines** (2–5 today), so it can hold a site server, a
    share and a desk. No `flat` office exists yet, so nothing declared moves;
  - **the duplicate files** (owner-confirmed 2026-10-01): the "no byte-identical free-text
    file on two boxes of a network" rule's exemption widens from a file stating one network
    fact (`resolv.conf`) to one stating one organisation-wide policy: a department's
    `README.md` and a site's `robots.txt`, which a real organisation copies to each box.
    Rejected: a redraw when a box's file equals a sibling's, which keeps the rule whole but
    builds every sibling share or site to compare, against the 2 ms/box budget.

**Acceptance criteria** (owner-confirmed 2026-10-01):

- [x] **7a-1** The world declares 20–40 corporations, keyed `c0`, `c1`, …, after Millbrook's
      networks: each `corporate`, its subtype one of consulting, logistics, insurance, IT
      services and accounting, no subtype twice while another is left. Each answers in the
      `193` block at position 21 + n, after findit and the 20 landmark corporations; every
      declared address stays distinct.
- [x] **7a-2** A corporation's name comes from its grammar on `corporation-names`, every slot
      filled and no surname twice in one name, spelt into its ESSID and `.com` domain as a
      business's is (ESSID at most 32 characters). No network in the world shares its name,
      ESSID or domain; a draw that would is redrawn. Every template fills to a name that
      spells cleanly.
- [x] **7a-3** A corporation stands in no town: it declares no town or region, `whois` on its
      address or domain prints its site's name and no `city:` or `region:`, no file on its
      boxes names a town, and a join to it is refused with `403 network_not_joinable`
      (`testJoinRefusal.ts`, live).
- [x] **7a-4** A corporation always publishes and is always listed: findit lists every one,
      first for its own name and described in its kind's own words (amended 2026-10-01:
      a search shows ten results, so a kind's word cannot list them all). Its profile is
      drawn from the corporate row
      (never `lone`), and it forwards its site and 1–2 things more, as every office does.
- [x] **7a-5** A corporation keeps no lead and is the target of none: Millbrook's relations
      graph is unchanged, and AC-4's whole-world reachability holds with the corporations in
      the declaration.
- [x] **7a-6** Every whole-world content property holds over every corporation, through the
      town sweep, with the rules confirmed above: a `flat` office keeps 3–5 machines, and
      two boxes of one network may share a department's `README.md` or a site's
      `robots.txt`, and no other free-text file.
- [x] **7a-7** Nothing else moved: a byte-diff of every landmark, findit and Millbrook box
      against `main` is empty, and the AC-7 fingerprint test passes untouched.
- [x] **7a-8** `testFindit.ts` lists a corporation live, `testJoinRefusal.ts` refuses one,
      `testMillbrook.ts` passes, and `checkBudgets` passes.
- [x] **7a-9** `world-content-architecture.md` describes the corporations, their grammar,
      the `flat` office rule and the widened variety exemption, and its streams table lists
      `corporations` and
      `corporation-names`; `discovery-architecture.md` lists them among findit's sites and
      `whois`'s placeless records.

Out of scope: branches and the headquarters' leads (7b); a corporation's own kinds beyond the
corporate five; sizing the count; the findit index split (slice 8).

**RED**: the declaration of the corporations (7a-1), then the names (7a-2), then placelessness
over `whois`, the content and the persona (7a-3), then findit, profile and forwards (7a-4),
then the relations (7a-5), then the whole-world properties over the grown world (7a-6, where
the three measured failures reappear and their rules land).
**GREEN**: the grammar and its draw in `world.ts`, sharing the slot filling with the business
draw; the corporations appended to `DECLARED_NETWORKS` and to the address table; the
relations guard for a network with no town; the `flat` office count; the widened
exemption in the two variety tests.
**REFACTOR**: assess only; one name draw, not two.
**Server evidence**: no server code change. `testJoinRefusal.ts` gains a placeless case;
`testFindit.ts` asserts a corporation listed; `testMillbrook.ts` reruns unchanged.
**PRE-PR MUTATION**: Stryker on the corporation draw, the slot filling, the address
placement, the relations guard and the `flat` office count (narrowed battery, json
reporter). The grammar is authored data: its evidence is 7a-2's tests.
**PR-ready when**: 7a-1 to 7a-9 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit. Bumps the minor version to 0.297.0.
**Slice complete when**: its PR merges; 7b is planned next.

### Slice 7b: a corporation's head office leads to its branch in Millbrook

**Value**: a player who breaks into a corporation's head office, found on findit, finds the
way to its office in a village that no search reaches: an ssh shortcut on the head office's
gateway. Millbrook gains its first branch, and slice 8's towns draw theirs the same way.
**Path**: Millbrook draws its branches on `town-branches-r0/t1` (count and parents) → each
is a `corporate` network keyed after the town's practices, with its parent's kind, its
profile on `network-profile-<key>` and its forwards on `gw-forwards-<key>` → its address is
Millbrook's next → the relation `branch` leads to it from its parent → the parent's gateway
keeps the lead in `/root/.ssh/` → `whois` names the parent. A player sees it in a file on the
head office's gateway, in `whois`, and at the door the lead opens.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-branches`.
**Status**: **complete** 2026-10-01 (#588, `8560c344`, v0.298.0); 7b-1 to 7b-9 hold.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**As built** (2026-10-01):

- Millbrook keeps **one** branch, as measured: `r0/t1/n17` `LORIMER-GROUP-MILLBROOK`,
  logistics, `deep`, at `87.98.122.105`, an office of `c6` Lorimer Group. `DeclaredNetwork`
  gains `parent`; `branchesOf` in `world.ts` draws the branches, declared last in
  `DECLARED_NETWORKS` and addressed as Millbrook's next. A golden pins the draw.
- The relation `branch` (`relations.ts`): `relationsTo` of a branch is its parent's one lead;
  `branchLeadsFrom` reads a network's branch leads without walking any town, and is what the
  gateway asks; `relationsFrom` is the branch leads then the town's, and the town's draw
  skips every branch.
- The head office's access point keeps root's `.ssh/` (`buildBranchSshDirectory` in
  `sshContent.ts`, from the contractor's shortcut and `known_hosts` derivation):
  `Host lorimer-group-millbrook`, `HostName 87.98.122.105`, `User root`, and its
  `known_hosts` line. `whois` names a branch's line after its parent's site.
- **Decided while building** (owner-confirmed 2026-10-01): the head office's access point
  held 12 files of its own against the 5–10 rule from #549, so **an access point holds 5–12**:
  one rule, one number, which no head office can pass, because more branches add lines to
  the same two files rather than files. Rejected: leaving `.ssh/` out of the count (a
  carve-out) and a head office keeping less of its own content (a new rule that moves `c6`).
- Evidence: `vitest run` 6,816 green, typecheck and lint clean. Byte-diff against `main` over
  all 104 networks and every findit page: only `c6`'s leads and access-point gateway moved,
  plus the new branch. `testMillbrook` 12/12 live (two new: `c6`'s gateway and the branch
  answer ssh where the lead points), `testFindit` 19/19, `testJoinRefusal` 5/5;
  `checkBudgets` 249,443 B gzipped and 0.913 ms per box.
- Stryker (narrowed battery, json reporter): 88 killed / 21 survived. 84 by Stryker, 3 load
  throws by hand, 1 by a strengthened test (a gateway with no branch keeps no `.ssh` at all;
  a null entry passed before). Equivalent: `branchLead`'s unreachable guard (6, 2 with no
  coverage), the town-lead guard and filter moved from `relationsFrom` (9, carried since
  7a), the `± index` offsets and the `join` between `Host` blocks (3), three always-defined
  checks (3).
- **Carried to slice 8**: a branch ESSID overflowing 32 characters in a town whose name has
  more than nine letters; sizing the branch count by size class; and what only a second
  branch reaches: the key and address offsets, and the `join` between `Host` blocks once a
  corporation keeps branches in two towns.

**Facts measured while planning** (2026-10-01, against `main` at `1b61488b`, by a throwaway
prototype of the draw and the relation, reverted):

- Millbrook draws **one** branch: `r0/t1/n17` `LORIMER-GROUP-MILLBROOK`, logistics, `deep`,
  at `87.98.122.105`, whose parent is `c6` Lorimer Group (`flat`). The branch forwards only
  `:8080` to a web server and no ssh, so the lead logs in at its gateway's `:22` as `root`,
  as a home with no ssh forward is reached.
- The longest branch ESSID Millbrook can draw is **32** characters, the limit exactly
  (`BLUEBELL-INTERNATIONAL-MILLBROOK`): a town name longer than nine letters could overflow.
- **25 tests fail over the prototype, every one test-side**: helpers and goldens that read a
  `corporate` network of Millbrook as a business, or the corporations as everything after
  Millbrook's last network, and the goldens that grow by the branch's row. No whole-world
  content property fails, and AC-4's reach test passes with no new rule: `c6` is listed.
- `whois` on the branch prints `Millbrook Broadband`, a home's answer, until it is taught a
  branch.
- 7a's "no file on a corporation's boxes names a town" test matches a capitalised
  `Millbrook` only, so the `Host lorimer-group-millbrook` block would pass it unseen.
- A gateway that asked `relationsFrom` for every lead would walk the whole town's LANs on
  every Millbrook gateway build; a gateway asks for its branch leads alone.

**Decisions taken in planning** (owner-confirmed 2026-10-01):

- **Branches are declared after the corporations**, last in `DECLARED_NETWORKS`: a branch's
  ESSID needs its parent's, and the corporations' names are drawn after Millbrook's, so a
  branch cannot stand in the town's own list. Its key and address still continue the
  town's (`r0/t1/n17`, Millbrook's next address). Millbrook's networks are no longer one run
  of the declaration, so the test helper that takes the corporations as everything after
  Millbrook's last changes.
- **A branch** declares `parent` (its corporation's key); it is `corporate` with its
  parent's subtype, place "the Millbrook office", no site, a corporate-row profile (never
  `lone`) and 1–2 seeded forwards. The count (1–2) and the parents (no corporation twice)
  are drawn on `town-branches-r0/t1`.
- **The relation `branch`**: its source is the parent, kept on the parent's gateway, and
  rendered as a `Host` block in `/root/.ssh/config` and a line in `/root/.ssh/known_hosts`,
  the host key on the contractor's `relation-host-key-` stream. A branch takes no part in
  its town's relation draw, either way. The gateway's `.bash_history` is untouched.
- **`whois`** on a branch names its parent's site, with `city: Millbrook` and
  `region: Harrow Valley`, and no `domain:` line: the branch publishes nothing.
- **7a's no-town rule narrows** (the weakest call, confirmed): a corporation's files name
  no town but in the lead to its branch, and the check matches case-insensitively, so the
  exemption is a rule rather than a capital letter. Rejected: a `Host` named for the parent
  alone, which keeps 7a's rule whole but leaves the shortcut not saying where the office is.
- **A branch's own content names no parent**: its people write "the Millbrook office"; only
  its ESSID, LAN names and `whois` carry the company. Speaking for the company is later
  work.
- **Wire evidence**: `testMillbrook` scans the branch's address and finds its gateway with
  `22/ssh`, the door the lead names. The join refusal is the existing out-of-town test's,
  which takes the branch unasked.

**Acceptance criteria** (owner-confirmed 2026-10-01):

- [x] **7b-1** Millbrook declares 1–2 branches, keyed after its practices (`r0/t1/n17`
      first), each with a different parent among the drawn corporations: `corporate`, its
      parent's subtype, ESSID `<PARENT-ESSID>-MILLBROOK` (at most 32 characters), place "the
      Millbrook office", no site, a corporate-row profile and 1–2 forwards. Each answers at
      Millbrook's next address; every declared address stays distinct.
- [x] **7b-2** The parent's gateway keeps the lead: `/root/.ssh/config` holds a
      `Host <branch ESSID, lowercased>` block naming the branch's address, the port and the
      account the lead logs in as, and `/root/.ssh/known_hosts` its line. The door is real:
      the branch's ssh forward and that box's user, or else its gateway's `:22` as `root`.
- [x] **7b-3** Nothing else leads to a branch: it keeps no Millbrook lead and receives none,
      Millbrook's relations (their goldens) do not move, and AC-4's reach test holds with
      the branch reached from its parent.
- [x] **7b-4** `whois` on a branch's address names its parent's site, with `city: Millbrook`
      and `region: Harrow Valley`.
- [x] **7b-5** Every whole-world content property holds over the branch. Rule 3's property
      ("names no address of the world but its own and its relations'") extends to the
      parent's boxes, and a corporation's files name no town but in its branch's lead
      (matched case-insensitively).
- [x] **7b-6** Nothing else moved: a byte-diff against `main` differs only on the parent's
      gateway, by its two `.ssh` files, and the new branch.
- [x] **7b-7** `testMillbrook.ts` reaches the branch's gateway live (`22/ssh` on its
      address); `testFindit.ts` and `testJoinRefusal.ts` pass; `checkBudgets` passes.
- [x] **7b-8** `world-content-architecture.md` describes the branch and lists
      `town-branches-` in its streams table; `discovery-architecture.md` describes the route
      from findit to the head office to the branch.
- [x] **7b-9** The minor version is bumped to 0.298.0.

Out of scope: the branch's content speaking for its company; branches of the landmark
corporations (decision 19a: none); sizing the count by size class and a branch ESSID over 32
characters in a longer-named town (slice 8).

**RED**: the declaration of the branch (7b-1), then the relation from its parent and the
town's graph left alone (7b-3), then the lead on the parent's gateway (7b-2), then `whois`
(7b-4), then the whole-world properties with the narrowed no-town rule (7b-5).
**GREEN**: the branch draw and its addresses in `world.ts`; the `branch` relation in
`relations.ts`, read by the gateway for its branches alone; the `.ssh` files in the gateway's
`/root`; the branch case in `whois`.
**REFACTOR**: assess only; the shortcut block and `known_hosts` line are one derivation
shared with the contractor's.
**Server evidence**: no server code change. `testMillbrook.ts` gains the branch's scan.
**PRE-PR MUTATION**: Stryker on the branch draw, the `branch` relation and its exclusion from
the town's draw, the gateway's `.ssh` files and `whois`'s branch case (narrowed battery, json
reporter).
**PR-ready when**: 7b-1 to 7b-9 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit.
**Slice complete when**: its PR merges; slice 7 is complete and slice 8 is planned next.
(Done 2026-10-01: #588 merged; slice 8 is next.)

### Slice 8: the remaining towns

Grilled 2026-10-01 (decision 19b), 8b split 2026-10-02 (decision 19c), 8e split 2026-10-02
(decision 19f). Six PRs, in order, each cut from `main` after the one before it merges: 8a a
second village, 8b the names, 8c the town size class, 8d the city, 8e the remaining rows, 8f
findit's memoised index. 8a complete
2026-10-02 (#589), 8b complete 2026-10-02 (#590), 8c complete 2026-10-02 (#591), 8d complete
2026-10-02 (#592), 8e complete 2026-10-02 (#593), 8f complete 2026-10-02 (#594); each later PR
was planned after the one before it merged, from what that one measured. Slice 8 is complete.

### Slice 8a: a second village, Ashby, and findit finds a town's places by its name

**Value**: any player can fetch Ashby's council by its domain and walk its directory, and a
search for a town and a kind of place finds that town's place: "Millbrook café" finds
Whitlock's Café again once a second town competes for the answer. The world's town rows
stop being Millbrook alone, and every path only a second town reaches is reached.
**Path**: a town row (`r0/t2`, Ashby) → its institutions named by rule from its name → its
businesses, homes, practices and branches drawn on the streams Millbrook draws on, keyed by
`r0/t2` → its addresses in `87.195.x.y` → its relations drawn within the town → its sites in
findit's index, each description naming its town → a search ranking pages that match every
word first → `whois`, a fetch by domain, and a refused join.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-second-village`.
**Status**: **complete** 2026-10-02 (#589, `c9379bc1`, v0.299.0); 8a-1 to 8a-10 hold, 8a-9 as
amended below.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (2026-10-01, against `main` at `43392288`, by a throwaway
prototype declaring Ashby alone after the corporations, reverted):

- Ashby draws **18** networks: council `ashby.gov`, police `ashbypd.gov` (`ASHBY-PD`),
  library `ashbylibrary.org`; four businesses (Greenleaf Bakehouse, Greenleaf Pharmacy,
  Lantern Tools, Brightline Consulting) and Bridge Street Café; six homes; a clinic (Garrow
  Family Practice) and a dentist (Lorimer Dental Care); and **two** branches,
  `OAKWOOD-HOLDINGS-ASHBY` of `c17` and `RADLEY-OAKLEY-ASHBY` of `c22`. Profiles: 3 `deep`
  institutions, the rest `lone`, `flat` and one `deep` branch. Addresses `87.195.x.y`, every
  one in the world distinct; the longest ESSID 27 characters.
- The paths 5b, 6b and 7b carried here are reached: a second practice of the other kind, a
  second branch in one town, Millbrook's names avoided by a second town's draw. One is not:
  no corporation keeps branches in two towns, so the `join` between two `Host` blocks on one
  gateway stays unreached (8b's town draws 2–3 more).
- **Ashby reuses four of Millbrook's home names** (`ROSE-COTTAGE`, `OKONKWO-FAMILY`,
  `GARDEN-FLAT`, `WILLOW-VIEW`): both towns draw from the same 14. ESSIDs are unique within a
  town (decision 4), so nothing breaks; 8b's home grammar renames every home.
- The suite goes from 1m44s to 1m50s (6,852 tests). **Nine assertions fail**:
  - six test-side, each assuming one town: findit's "the police for police" ranking
    (`ashbypd.gov` now ties `millbrookpd.gov`), the branch tests reading `c17` as a
    corporation with none, "the directory is kept by the council alone" (Millbrook's only),
    and two counts of distinct ESSIDs across the world (116 of 121: `TOWN-HALL-WIFI`,
    `LIBRARY-PUBLIC` and four homes repeat across the two towns);
  - **three real**, below.
- **Ashby's homes are unreachable** ("leaves no network that nothing leads to": 5 homes).
  Ashby's one office, Brightline Consulting, was drawn unlisted, and it keeps every
  contractor lead to the homes, so the leads start where nothing leads. Slice 4b's rule says
  "every source is a listed publisher", but the code lets an unlisted publisher keep leads;
  Millbrook never drew an unlisted office, so nothing showed it. Excluding offices from the
  unlisted draw moves Millbrook's pick (its police would go unlisted, its bookshop listed);
  keeping a town's last listed office moves nothing in Millbrook.
- **Three API servers serve the same pages** ("serves no file on one web server that another
  on its network serves byte for byte"): Ashby's council (`deep`) keeps `api-38`, `api-131`
  and `api-188`, whose `/api/v1/status`, `hours`, `forms` and `notices` documents match: an
  endpoint's document is the category's, not the box's. 16 landmarks keep one API server
  each, none two; Millbrook's hospital keeps two and passes, for a reason not yet read.
- **A crontab gives away its box's account** ("never gives away the account a player has to
  earn"): Brightline's file server `files-6`, whose account is `rsync`, backs up to The Old
  Rectory's box, whose account is also `rsync`, so its job reads `rsync@87.195.109.250`.
- No business or practice page names its town (measured over Millbrook: only the council,
  the police, the library and the hospital do). `SITE_DESCRIPTIONS` is the line findit
  indexes as a page's description, and its `retail`, `cafe`, `corporate` and `healthcare`
  templates name no town.

**Planning calls** (owner-confirmed 2026-10-01, with the criteria):

- **A town keeps its last listed office.** The unlisted draw is redrawn when it would leave
  a town no listed office, and a lead's source is a listed publisher, as 4b states. Nothing
  in Millbrook moves. Rejected: an office is never unlisted (one harsher rule, but it moves
  Millbrook's unlisted pick and re-pins 4c and 6a).
- **The API servers' rule is found in RED, and moves no landmark.** RED first reads why
  Millbrook's hospital's two API servers pass where Ashby's three do not, then brings back
  one rule. Ruled out now: an API document naming its host on every network, which rewrites
  the 16 landmarks' API servers (AC-7).
  **Found in RED**: no network but Ashby's council kept two API servers. Millbrook's
  hospital keeps one; the "two" counted the box it publishes from. So the rule is **a
  network runs one API**, on the first `api-` box a player reaches there (its LAN, then down
  its chain); another box named for one keeps a site as any web server does. It moves no
  landmark.
- **A box keeps no backup job to an account of its own name.** The backup draw skips a
  source box whose account is the target's. Rejected: exempting a relation's far account in
  the test (the job still tells a player the local account).
- **Homes keep repeating across villages until 8b**, whose grammar renames every home.

**Acceptance criteria** (owner-confirmed 2026-10-01):

- [x] **8a-1** The world declares Ashby, its second generated town: `r0/t2`, Harrow Valley,
      a village. Its council, police and library are named by rule from the town's name
      (`{Town} Town Council`, `{town}.gov`, `TOWN-HALL-WIFI`; `{Town} Police Department`,
      `{town}pd.gov`, `{TOWN}-PD`; `{Town} Public Library`, `{town}library.org`,
      `LIBRARY-PUBLIC`), and Millbrook's three come from the same rule with nothing moved.
      Ashby draws its businesses, homes, practices and branches as Millbrook does, keyed
      after its institutions in that order, and answers in `87.195.x.y`; every declared
      address stays distinct.
- [x] **8a-2** A name another network holds is drawn again: no domain repeats in the world,
      and no ESSID repeats within a town. Every declared ESSID is at most 32 characters.
- [x] **8a-3** Any player can fetch `ashby.gov` by its domain, and its directory page links
      every Ashby institution, listed or not, and nothing of Millbrook's (AC-2). Millbrook's
      directory links nothing of Ashby's.
- [x] **8a-4** Every Ashby network is reached (AC-4's test over the whole declaration): a
      town keeps at least one listed office, and every lead starts on a listed publisher.
      Ashby's branches are led to from their parents alone.
- [x] **8a-5** Every procedural publisher standing in a town beyond Ridgemont names its town
      in the description findit indexes; no landmark's page moves (AC-7) and no
      corporation's does. findit ranks a page matching every word of a query above one
      matching fewer, and ties as before. For every listed site in Millbrook and Ashby, a
      search for its town and a word its description uses for its kind lists it in the top
      ten; "Millbrook café" lists Whitlock's Café.
- [x] **8a-6** Every whole-world content property holds over Ashby: no two API servers on a
      network serve the same document, and no box's crontab names an account of its own
      name.
- [x] **8a-7** `whois` on an Ashby address names its organisation with `city: Ashby` (a
      branch's, its parent's), and a join to an Ashby network is refused, as 1c refuses any
      town beyond Ridgemont.
- [x] **8a-8** Nothing else moved: a byte-diff against `main` differs only by Ashby's
      networks, the descriptions of Millbrook's businesses and practices and their indexed
      pages, and the gateways of the corporations that gain an Ashby branch.
- [x] **8a-9** A new live wire-check, `scripts/testTowns.ts`, fetches each generated town's
      council by its domain, asks `whois` about it, finds one of its sites on findit by town
      and kind, and has a join to it refused; `testMillbrook`, `testFindit` and
      `testJoinRefusal` pass; `checkBudgets` passes.
- [x] **8a-10** `world-content-architecture.md` describes the town rows, the institutions'
      rule and the listed-office rule; `discovery-architecture.md` describes findit's town
      words and its ranking. The minor version is bumped to 0.299.0.

Out of scope: the size classes and their counts, the courthouse and the hospital draw, the
home grammar and the grown word lists, the relations cache (8b); the city and the sampled
sweeps (8c); the remaining rows and findit's index split (8d).

**RED**: the declaration of Ashby with Millbrook's institutions from the rule (8a-1, 8a-2),
then its directory (8a-3), then reachability with the listed-office rule (8a-4), then
findit's town words and ranking (8a-5), then the whole-world properties over Ashby (8a-6),
then `whois` (8a-7). The six one-town test assumptions are reshaped where each is met, never
loosened past what decision 4 allows.
**GREEN**: the town rows and the institutions' rule in `world.ts`, Ashby's draw after the
corporations; the listed-office redraw and the listed-source filter; a `{town}` reading in
`SITE_DESCRIPTIONS` that a landmark and a corporation fill with nothing; the all-words
order in `rankPages`; the API servers' rule; the backup draw's own-account skip.
**REFACTOR**: assess; `networksOf` and `branchesOf` take a town row rather than Millbrook's
constants.
**Server evidence**: no server code change. `testTowns.ts` is new and runs live against
`vercel dev`; `testMillbrook`, `testFindit` and `testJoinRefusal` rerun.
**PRE-PR MUTATION**: Stryker on the town rows and the institutions' rule, the unlisted
redraw and the source filter, the description's town, `rankPages`, the API servers' rule
and the backup skip (narrowed battery, json reporter).
**PR-ready when**: 8a-1 to 8a-10 hold, `vitest run`, typecheck, lint and format pass, the
full sweep is recorded, and the owner approves the commit.
**Slice complete when**: its PR merges; 8b is planned next.
(Done 2026-10-02: #589 merged; 8b is next.)

**As built** (2026-10-02):

- **8a-9 amended**: `testTowns.ts` does not ask `whois`. It answers from the world's
  declaration and asks nobody on the network, so there is no wire to check; `whois.test.ts`
  holds Ashby's town hall and branch. The script fetches each council, finds a place by town
  and kind, and has a join refused (6/6 live).
- **Ashby's unlisted draw** first unlisted its one office, Brightline Consulting; the
  listed-office redraw unlists its police and Garrow Family Practice instead. The source
  filter had no RED until the own-account backup skip moved The Old Rectory's backup onto
  the unlisted police; then it did.
- **Relation tests** now cover every generated town, not Millbrook alone.
- **Mutation**: the search, relation and site changes 88 killed and 7 survived (the two
  `{locality}` survivors die in `landmarks.test.ts`; five equivalent). `world.ts` 45 killed
  and 20 survived, most of them module-load throws that turn the suites red by hand. Four
  are equivalent in this world and become observable in 8b's larger towns: the redraw's
  `every` against `some` (each town keeps one office), and emptying the names a draw
  avoids (no draw has clashed yet).
- **Sweep**: 77 of 81 pass. `testCrossPlayerConnectionTrace` and `testExploitDeepChain` fail
  identically on `main` (both in the backlog), `testExploitOwnLan` finds no usable target on
  game day 81, and `testSameLanOccupancy` failed 6/7 in the sweep and passes 7/7 alone.
- **Budgets**: 1.723 ms a box (ceiling 2 ms), the bundle 249,825 B (ceiling 284,975 B).

### Slice 8b: every procedural place is named from grammars that a town or a city cannot exhaust

**Value**: the names stop being the bottleneck before the town and the city arrive. A home is
named the way people name their own (after the family, the house, the flat or nothing at
all), every kind of place can form far more names than the launch world draws, no name ever
outgrows its wifi, and no town reads as written from one short list. Millbrook, Ashby and the
corporations take their final names while nothing else about them moves.
**Path**: a town's home count (`town-homes-<key>`, drawn first as today) → each home's form
and words from the home grammar → its ESSID and its place → the businesses', practices' and
corporations' names from the tripled lists through `namedOf`, whose redraw now also refuses a
word the town already holds → every box, page, mail, note and `whois` answer that quotes a
name.
**Class**: behaviour change (names only: every structure is preserved, 8b-5).
**Delivery**: independent PR against `main`, branch `feat/procedural-world-names`.
**Status**: **complete** 2026-10-02 (#590, `ebea9513`, v0.300.0); 8b-1 to 8b-8 hold.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (2026-10-02, against `main` at `27862cc5`, by a throwaway
prototype tripling the business lists with filler words and naming homes by a stand-in
grammar, then reverted):

- **The rename moves nothing but names.** A dump of all 64 procedural networks with every
  spelling of each network's name masked (its ESSID lower-cased, unhyphenated and
  underscored, and its place) is identical to `main`: every box's paths, modes and owners,
  its hostname, account and services, every relation and forward, every kind, profile,
  unlisted pick, key and address. Boxes are keyed by network key, not by name.
- **18 assertions fail, every one a pin on a name**: the Millbrook, Ashby, corporations,
  branches, kinds, sizes and unlisted goldens in `world.test.ts`; four relation goldens (the
  town's, the branch's, the head office's shortcut, the supplier's invoice); the AP
  gateways' forwards golden in `routerFs.test.ts`; `whois`'s two branch org names; findit's
  "Millbrook café" lists `whitlockscafe.com`; `resolvePublicTarget` and `resolvePublicScan`
  look up "Westbrook Haulage" by name; and the home-LAN golden finds its network by ESSID,
  so a renamed ESSID reads the LAN of key `''`. The wire-checks spell no name: they read the
  world.
- **The fit rule meets `{filler} International`.** A branch's ESSID is its parent's and
  `-HOLLOWMERE` at most, so a corporation's ESSID has 21 characters; "International" leaves a
  filler 7. Eight of today's twenty fillers are longer (Greenleaf, FreshWay, Keystone,
  Pinnacle, Brightline, Silverbirch, Bluebell, Evergreen). Without that template,
  `{filler} Holdings` binds a filler at 12 letters and `{surname} & {surname}` a surname at
  10; every current word fits but Merriweather (12).
- **Today's name spaces**: every business and practice kind forms 52 to 84 names, the
  corporations 616; the 14 hand-written homes are one list for every town. At triple size
  the least is the coffee bar's 156 (filler, street, filler).

**Planning calls** (owner-confirmed 2026-10-02, with the criteria):

- **`{filler} International` is dropped** from the corporations' templates, so a filler may
  run to 12 letters and a surname to 10; Merriweather leaves. The corporations keep three
  templates and many hundreds of names. Rejected: keeping it and holding every filler to 7
  letters (eight good words lost, every new one squeezed).
- **A word is what fills a slot**: a surname, a street, a filler, a house's plant, a home's
  surname, an ISP default's description. A template's own text (Café, Holdings, Cottage,
  Lodge) is not, so a house name's building is template text: one town may hold Rose
  Cottage and Ivy Cottage, never Ivy Cottage and Ivy Lodge. The descriptions are words, so
  they grow to about 24 for the city.
- **The home words and the business words share none**, pinned by a test.
- **The fit test reads every declared town**, and the words are chosen so Hollowmere (ten
  letters, 8e) fits too; the code names no row the world has not declared.

**Acceptance criteria** (owner-confirmed 2026-10-02):

- [x] **8b-1** A town names its homes by the grammar: family (35), house name (30), flat (15)
      and ISP default (20), drawn on `town-homes-<key>` after the count, which does not move.
      A family's ESSID is `THE-{SURNAME}S`, `{SURNAME}-FAMILY` or `{SURNAME}-WIFI` (a surname
      ending in "s" takes no more), a house's its name, a flat's `FLAT-{1–9}{A–D}` or
      `{GARDEN|TOP|BASEMENT}-FLAT`, an ISP default's `{NETGEAR|LINKSYS|TP-LINK|BT-HUB}-{four
      hex digits}`. Every place reads after "at" ("bills at the Hargreaves' house", "at
      flat 2A", "at the house on the corner"). No ESSID repeats within a town.
- [x] **8b-2** The businesses' surnames, streets and fillers triple (72, 36, 60); homes keep
      surnames of their own (30 or more, seeded by Hargreaves, Okonkwo, Kowalski, Nguyen),
      plants and descriptions (about 24). No word is in both the homes' and the businesses'
      lists.
- [x] **8b-3** Every kind of business and practice, the corporations and the homes can each
      form 150 names or more. Every name any template can form spells an ESSID of 32
      characters at most, and a corporation's with `-{TOWN}` after it for every declared town.
- [x] **8b-4** No word names two places a town draws (its businesses, practices and homes):
      a name sharing a word with one already drawn is drawn again, as a held ESSID or domain
      is. A branch carries its parent's name and is outside the rule.
- [x] **8b-5** Millbrook's and Ashby's businesses, practices and homes and the corporations
      are renamed, their branches' ESSIDs following; the institutions and Millbrook's
      hospital are not. With names masked, a dump against `main` shows every key, address,
      kind, profile, unlisted pick, relation, forward, host, account, service and path
      unchanged. The goldens are re-pinned to the new names.
- [x] **8b-6** 8a-5 holds over the new names: for every listed site in Millbrook and Ashby, a
      search for its town and a word its description uses for its kind lists it in the top
      ten, and "Millbrook café" lists Millbrook's café. Every whole-world content property
      holds.
- [x] **8b-7** `testMillbrook`, `testTowns`, `testFindit` and `testJoinRefusal` pass live;
      `checkBudgets` passes.
- [x] **8b-8** `world-content-architecture.md` describes the home grammar, the lists, the fit
      rule and the town's word rule; `discovery-architecture.md` re-pins its examples
      (Whitlock's Café, Westbrook Haulage). The minor version is bumped to 0.300.0.

Out of scope: Oakhurst, the size classes and their counts, the courthouse and the hospital
draw, the relations cache and the three content rules 19c carried (8c); the city and the
sampled sweeps (8d); the remaining rows and findit's index split (8e).

**RED**: the home grammar (8b-1, the hand-written list's test giving way to the grammar's),
then the lists and their disjointness (8b-2), then the name spaces and the fit over every
formable name (8b-3, which fails on `{filler} International` and Merriweather first), then
the town's word rule (8b-4, which fails on today's Ashby: Greenleaf Bakehouse beside
Greenleaf Pharmacy). The 18 name pins are re-pinned where each is met, each failing only on
a name; a lookup by name (`resolvePublicTarget`, `resolvePublicScan`, the home-LAN golden)
finds its network by key instead.
**GREEN**: the home grammar and its words in a pool replacing `townHomes.ts`; the tripled
lists, Merriweather and `{filler} International` out; the word check in `namedOf`'s redraw,
the homes' draw sharing it.
**REFACTOR**: assess; `namedOf` and the homes' draw share one held-names set per town.
**Server evidence**: no server code change. `testMillbrook`, `testTowns`, `testFindit` and
`testJoinRefusal` rerun live against `vercel dev`.
**PRE-PR MUTATION**: Stryker on the home grammar, the word rule and the redraw, and the
lists the name-space and fit tests read (narrowed battery, json reporter).
**PR-ready when**: 8b-1 to 8b-8 hold, the masked dump matches `main`, `vitest run`,
typecheck, lint and format pass, the full sweep is recorded, and the owner approves the
commit.
**Slice complete when**: its PR merges; 8c is planned next.
(Done 2026-10-02: #590 merged; 8c is next.)

**As built** (2026-10-02):

- **The home grammar** is `pools/homeNames.ts`: the four forms by weight, 3 family, 10 house,
  4 flat and 4 router templates, and 32 surnames, 24 plants and 24 descriptions of the homes'
  own. A home's wifi is spelt from its first template as a business's is, so
  `TP-LINK {hex}` reads `TP-LINK-7C21`. `townHomes.ts` is gone.
- **The word rule reaches the corporations too**, as one rule rather than a carve-out: drawn
  as one list, no two share a word, and a test pins it. A town holds **one set of words**
  across its homes, businesses and practices (the homes' words handed to the businesses',
  both to the practices'), so the rule holds by construction, not only because the home and
  business lists share none.
- **8b-4's RED moved**: the tripled lists happened to redraw Ashby's Greenleafs away, and
  the rule failed instead on Ashby's homes (`KOWALSKI-FAMILY` beside `THE-KOWALSKIS`) and on
  six corporation words (Jarrow, Fairbanks twice, …).
- **Refactor**: one `byWeight` replaces the three weighted pools (business categories,
  profiles, home forms); the masked dump stayed identical.
- **Re-pinning**: a name map from `main` to the branch re-pinned the goldens, except where
  `main`'s one short home list had given both villages the same home names (Garden Flat, Rose
  Cottage, the Okonkwo family home), which were re-pinned by town. The supplier invoice's
  `vsftpd.log.1` line counts characters, so its size moved from 228 to 229 with the names.
- **Mutation**: 441 mutants on the changed lines of `world.ts`, `homeNames.ts` and
  `businessKinds.ts` against `world.test.ts`. Every one Stryker scored survived was applied by
  hand: 69 turn the suite red (the world fails to load), leaving 28. **7 equivalent**
  (fallbacks for a slot a template lacks, `toLowerCase` under an upper-casing spelling, an
  unreachable `?? []`, the corporations' empty held words, the homes' words handed to
  disjoint lists). **10 in the held wifi/domain redraw**, older than 8b, which no draw
  reaches. **11 in new behaviour no declared town reaches**: a numbered flat's floor and
  door (7), a router suffix's leading zeros, the redraw of two homes under one wifi, and a
  practice avoiding its town's business words (2). **Carried to 8c** (owner, 2026-10-02):
  Oakhurst's 20 homes should reach them, and its gate re-runs them.
- **Wire-checks**: `testMillbrook` 12/12, `testTowns` 6/6, `testFindit` 19/19,
  `testJoinRefusal` 5/5 live. The full sweep was not run: 8b changes no server code and no
  script spells a name.
- **Budgets**: 1.001 ms a box (ceiling 2 ms), the bundle 251,303 B (ceiling 284,975 B).

### Slice 8c: Oakhurst, the world's first town, stands beside the villages

**Value**: the world holds its first place bigger than a village. Any player can fetch
Oakhurst's council and its courthouse by their domains, find its shops by town and kind, and
break from its offices into twenty homes, every box reading as what it is at a town's scale.
**Path**: a town row (`r0/t3`, Oakhurst, class `town`) → the size-class table's ranges → its
institutions with the courthouse and the drawn hospital → its businesses, homes, practices and
branches drawn on the streams every town draws on → its addresses in `87.38.x.y` → its
relations drawn within the town (a backup kept off phones), read once per key → its shares
(a department holding ten at most) → its sites in findit's index → `whois`, a fetch by domain,
and a refused join.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-town`.
**Status**: **complete** 2026-10-02 (#591, `ab207a3e`, v0.301.0); 8c-1 to 8c-10 hold.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning**: those of decision 19d (against `main` at `ec25c6fd`).

**Acceptance criteria** (owner-confirmed 2026-10-02, decision 19d):

- [x] **8c-1** A town row is a name and a size class, and the class sets the four count
      ranges: a village keeps 3–6 businesses, 4–8 homes, 1–2 practices and 1–2 branches, a
      town 12–24, 12–24, 2–4 and 2–3. Millbrook and Ashby are village rows and draw exactly
      what they draw today.
- [x] **8c-2** The world declares Oakhurst, `r0/t3`, Harrow Valley, a town, after Ashby: its
      networks ordered institutions, businesses, homes, practices, branches, answering in
      `87.38.x.y`, its names avoiding every network declared before it. Every declared address
      stays distinct, no ESSID repeats within a town, every ESSID is at most 32 characters,
      and no word names two of its places.
- [x] **8c-3** A town keeps a courthouse (`{Town} County Court`, `{town}courts.gov`,
      `COURTHOUSE-WIFI`, "the courthouse") after its library, and draws 0–1 hospital on
      `town-hospital-<key>` (`{Town} General Hospital`, `{town}hospital.org`,
      `GENERAL-HOSPITAL`, "the hospital", subtype `hospital`); a village keeps neither. Its
      council's directory links both. Oakhurst keeps one hospital.
- [x] **8c-4** No business's offsite copy is kept on a phone: a home whose ssh forward
      reaches a phone takes no backup, and keeps its contractor leads. No phone in the world
      keeps a `backups` folder, and every phone holds what a phone holds.
- [x] **8c-5** No department of a share holds more than ten files, a supplier's invoice
      included: a share that is sent invoices draws its invoices department with room for
      them.
- [x] **8c-6** Every whole-world content property holds over Oakhurst, the test-side
      failures reshaped to what each claims: findit's "court" lists a county court first and
      "ridgemont court" Ridgemont's; every opener in the world carries no `In-Reply-To`; the
      directory, word-rule, router-count and relation tests read every declared town; the
      supplier test finds the supplier's invoice by name; a desk's `.ssh` may hold contractor
      leads alone; a branch is held to no web server. Every Oakhurst network is reached, and
      for every listed Oakhurst site a search for its town and a word its description uses for
      its kind lists it in the top ten.
- [x] **8c-7** `relationsFrom` and `relationsTo` answer each key from a memo; `checkBudgets`
      times every procedural box beside Ridgemont's, each set at 2 ms a box at most, and
      passes.
- [x] **8c-8** Nothing else moved: a dump against `main` differs only by Oakhurst's networks
      and the gateways of the corporations that gain an Oakhurst branch.
- [x] **8c-9** `testTowns` fetches Oakhurst's council and courthouse by their domains, finds
      an Oakhurst site by town and kind, and has a join refused; `testMillbrook`, `testFindit`
      and `testJoinRefusal` pass live.
- [x] **8c-10** `world-content-architecture.md` describes the size classes, the courthouse,
      the hospital and both rules; `discovery-architecture.md` the court example;
      `conventions-and-gotchas.md` §3 the relations memo as the measured cache. The minor
      version is bumped to 0.301.0.

Out of scope: the city and the sampled sweeps, `checkBudgets`' sample (8d); the remaining rows
and findit's index split (8e); a rule for an inbox of replies (decision 19d).

**RED**: the size-class table under Millbrook and Ashby (8c-1, a refactor where it moves
nothing: the world's dump is unchanged), then Oakhurst's declaration (8c-2) and its institutions
(8c-3), which turn the 13 assertions of 19d red. The two real failures each get a world-wide
test first (8c-4: a phone keeping `backups`; 8c-5: a department of eleven); the test-side
ones are reshaped where each is met (8c-6).
**GREEN**: the size-class table and a town row's class in `world.ts`; Oakhurst's row; the
courthouse and the hospital draw in a town's institutions; the phone skip in the backup draw
(`relations.ts`); the invoices department's room in the share's draw (`share.ts` and
`supplierInvoices.ts`).
**REFACTOR**: assess; the relations memo (a pure refactor, its evidence the unchanged dump and
the timing), and `checkBudgets` timing the procedural boxes.
**Server evidence**: no server code change. `testTowns.ts` grows Oakhurst and runs live against
`vercel dev`; `testMillbrook`, `testFindit` and `testJoinRefusal` rerun.
**PRE-PR MUTATION**: Stryker on the size classes, the courthouse and the hospital draw, the
phone skip, the department's room and the memo (narrowed battery, json reporter), every
survivor applied by hand; 8b's 11 survivors re-run, whatever stays unreached recorded with
its reason and carried to 8d.
**PR-ready when**: 8c-1 to 8c-10 hold, the dump differs only as 8c-8 allows, `vitest run`,
typecheck, lint and format pass, and the owner approves the commit.
**Slice complete when**: its PR merges; 8d is planned next.
(Done 2026-10-02: #591 merged; 8d is next.)

**As built** (2026-10-02):

- **Size classes** are `SIZE_CLASSES` in `world.ts`, read through one `countOf(town, kind,
  prng)`; a drawn town is `DrawnTown` (a `Town` with a `size`), so Ridgemont's row carries
  none. Oakhurst drew exactly the prototype's 47 networks.
- **The courthouse and the hospital** are built in `institutionsOf` for any town not a
  village; the hospital's 0–1 draw is `town-hospital-<key>`.
- **The phone rule covers tablets too**: a home takes no backup when its forward lands on a
  box `deviceModel` names (a phone or a tablet). No tablet in the world was moved by it.
- **The department's room** is `SentLater` (`{ folder, files }`), handed by
  `buildServerShare` to `buildShare`; the drawn count is capped at ten less the room, so
  only a share whose draw would overflow moves.
- **`checkBudgets` times sets, not the world**: averaged over every procedural box the
  breach read about 1.7 ms and passed, so Ridgemont, each town and the corporations are each
  held to 2 ms. Before the memo Oakhurst failed at 2.532; after, every set 0.78–1.27.
- **Reshapes beyond 19d's list**: the router count compares deep routers with the networks
  that keep a chain (169 against 101), not with every network; findit's town-and-kind test
  reads every town and the top ten, the courthouse searched as "court".
- **Dump against `main`**: outside Oakhurst, only `c18`'s and `c23`'s relations and gateways
  moved; the phone rule moved Oakhurst's two phones and the four offices backing up to them,
  the room Acorn Roasters' share and the Okonkwos' copy of it; the memo left it identical.
- **Mutation**: `world.ts` whole (412 mutants, battery `world.test.ts`): 38 true survivors
  after hand-applying all 187 reported. 10 equivalent, 2 an unreachable throw guard, 12 the
  held-name redraw no draw reaches, 14 unreached behaviour. Relations, share and invoices'
  changed lines (104 mutants): 8 true survivors, all equivalent short-cuts but one invoice
  check no customer with two working shares reaches. **The memo hides mutants under
  Stryker**: seven reported survivors, the phone rule's among them, were the memo answering
  from an earlier mutant (recorded in `conventions-and-gotchas.md`).
- **Carried to 8d** (owner, 2026-10-02): of 8b's 11, Oakhurst killed one (two homes under one
  wifi); the numbered flat's floor and door (7), the router suffix's leading zeros and a
  practice avoiding its town's business words (2) stay unreached. With them, the hospital
  draw's three (never, always, the stream's name), which need a second town that draws one
  or none.
- **Wire-checks**: `testTowns` 10/10 (Oakhurst's council and courthouse fetched by domain),
  `testMillbrook` 12/12, `testFindit` 19/19, `testJoinRefusal` 5/5 live.
- **Budgets**: the bundle 251,657 B (ceiling 284,975 B); 6976 tests, summed file time 607 s
  against `main`'s 658 s.

### Slice 8d: Kingsford, the world's first city, and the sweeps take a sample

**Value**: the world holds its first city. Any player can fetch Kingsford's council and its
hospital by their domains, find its places by town and kind among 166 networks, and break
from its offices into eighty homes, every box reading as what it is at a city's scale. The
suite stops paying for every network it adds: the content sweeps read a fixed sample that
covers every shape of network a town holds, and the whole world once at each PR's gate.
**Path**: a town row (`r0/t4`, Kingsford, class `city`) → the size-class table's city ranges
→ its institutions with the courthouse and the hospital a city always keeps → its businesses,
homes, practices and branches drawn on the streams every town draws on → its addresses in
`87.135.x.y` → its relations drawn within the town → its mail (none on a network one person
has to themselves) → its sites in findit's index → `whois`, a fetch by domain, and a refused
join. Beside it, `ALL_ESSIDS` reading the sample unless `WORLD_SWEEP=full`, and
`checkBudgets` reading the best of three timed passes.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-city`.
**Status**: **complete** 2026-10-02 (#592, `e1fe2322`, v0.302.0); 8d-1 to 8d-10 hold, 8d-3 as
amended below.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning**: those of decision 19e (against `main` at `241eb297`; the
code is unchanged at `a8ca0cff`).

**Acceptance criteria** (owner-confirmed 2026-10-02, decision 19e):

- [x] **8d-1** The size-class table gains the city: 40–80 businesses, 40–80 homes, 5–8
      practices and 3–5 branches. Every village and town row draws exactly what it draws
      today.
- [x] **8d-2** The world declares Kingsford, `r0/t4`, Harrow Valley, a city, after Oakhurst:
      its networks ordered institutions, businesses, homes, practices, branches, answering in
      `87.135.x.y`, its names avoiding every network declared before it. Every declared
      address stays distinct, no ESSID repeats within a town, every ESSID is at most 32
      characters, and no word names two of its places.
- [x] **8d-3** A city keeps the courthouse and draws its hospital (`{Town} General Hospital`,
      `{town}hospital.org`, `GENERAL-HOSPITAL`) on `town-hospital-<key>` as a town does;
      Kingsford keeps one; a village keeps neither. Its council's directory links both.
      (Amended 2026-10-02, owner: "always, reading no draw" was unobservable, decision 19e.)
- [x] **8d-4** A network one person has to themselves keeps no mail: no box on it, its mail
      server included, keeps a spool for anyone, an empty one included.
- [x] **8d-5** Every whole-world content property holds over every declared network under
      `WORLD_SWEEP=full`, the test-side failures reshaped to what each claims: an access
      point's front page differs from another's wherever the vendor, the hostname or the LAN
      address does; a supplier's invoice is logged exactly when the share logs the files
      beside it; "police" lists a police department first and "<town> police" that town's;
      "wards" lists a hospital first; the branch golden pins Kingsford's branches; the backup
      test compares sorted lists. Every Kingsford network is reached, and every listed
      Kingsford site is in the top ten for its town and a word its description uses for its
      kind.
- [x] **8d-6** By default the content sweeps read the fixed sample: the landmarks, the
      uncatalogued keys, all of Millbrook and the corporations, and in every other town the
      first network in key order of each shape it holds (category, subtype, profile, whether
      a branch, whether unlisted). A test pins that every shape of every town is in it and
      that it holds no network twice. `WORLD_SWEEP=full` sweeps every declared network;
      `relations`, `webIndex` and `world` read the whole world either way. The PR records one
      green full sweep.
- [x] **8d-7** `checkBudgets` times every box, a set at a time, Kingsford's set among them,
      each set's figure the best of three timed passes, and passes at 2 ms a box.
- [x] **8d-8** Nothing else moved: a dump against `main` differs only by Kingsford's
      networks and the relations and gateways of `c1`, `c7`, `c11` and `c21`, which gain its
      branches.
- [x] **8d-9** `testTowns` fetches Kingsford's council and hospital by their domains, finds
      a Kingsford site by town and kind, and has a join refused; `testMillbrook`,
      `testFindit` and `testJoinRefusal` pass live.
- [x] **8d-10** `world-content-architecture.md` describes the city, the hospital rule and the
      mail rule; `conventions-and-gotchas.md` the sample, `WORLD_SWEEP=full`, the gate's full
      sweep and the best-of-three timing; `discovery-architecture.md` the police example. The
      minor version is bumped to 0.302.0.

Out of scope: findit's index split, the cold index limit and the remaining rows `t5`–`t10`
(8e); "cafe" finding no café (8e's findit work); a row naming the network on an access
point's front page (rejected, decision 19e).

**RED**: the city row (8d-1, moving nothing: the world's dump is unchanged), then Kingsford's
declaration (8d-2) and its institutions (8d-3), which turn the 7 assertions of 19e red under
the whole-world sweep. The real failure gets its world-wide property first (8d-4: a lone
network's mail server keeping a spool); the test-side ones are reshaped where each is met
(8d-5). The sample's test (8d-6) is written red before the sample exists.
**GREEN**: the city row and Kingsford's row in `world.ts`; a city's hospital kept without the
draw; the lone network's spool in `mailbox.ts`; the sample and `WORLD_SWEEP` in
`src/test/worldContent.ts`.
**REFACTOR**: assess; `checkBudgets` reading the best of three timed passes (operational,
its evidence the check's output on `main` and on the branch).
**Server evidence**: no server code change. `testTowns.ts` grows Kingsford and runs live
against `vercel dev`; `testMillbrook`, `testFindit` and `testJoinRefusal` rerun.
**PRE-PR MUTATION**: Stryker on the city row, the hospital rule and the mail rule (narrowed
battery, json reporter, the relations memo's hidden mutants applied by hand); the 13 carried
survivors re-run, whatever stays unreached recorded with its reason and carried to 8e. The
sample is test code: its evidence is its own test and the full sweep. One full sweep under
`WORLD_SWEEP=full`, recorded.
**PR-ready when**: 8d-1 to 8d-10 hold, the dump differs only as 8d-8 allows, `vitest run`
(sampled) and the full sweep, typecheck, lint and format pass, and the owner approves the
commit.
**Slice complete when**: its PR merges; 8e is planned next.
(Done 2026-10-02: #592 merged; 8e is next.)

**As built** (2026-10-02):

- **Kingsford** is a `city` row in `SIZE_CLASSES` and drew exactly the prototype's 166
  networks; a golden pins every one. It reads the hospital draw as a town does (amended).
- **The mail rule** is one early return in `mailEntries`: a mail server on the LAN whose
  network keeps no correspondence keeps what a box nobody reads mail on keeps (`cronOnly`),
  so no mailbox, no `/etc/aliases` and no `mail.log.1`; the empty `mail.log` stays with the
  role. Dropping the aliases went past 19e: kept, they would point at mailboxes the box no
  longer keeps. The tests share one `carriesMail` (`src/test/worldContent.ts`); deep mail
  servers are unchanged.
- **findit reads its journals 200 machines at a time** (`MACHINES_PER_READ` in
  `webIndex.ts`), every read concurrent, any failed read still no index (amended).
- **The sample** is `townKeysSwept` in `src/test/worldContent.ts`, read through
  `import.meta.env.WORLD_SWEEP` (Vitest hands the run's environment there), so the module
  no longer loads outside Vitest; no script imports it. `WORLD_ESSIDS` is the whole world
  for a test one rare network can break: the lone-network mail test reads it, because the
  sample holds none of the 82 lone networks with a mail server.
- **Dump against `main`**: outside Kingsford only `c1`, `c7`, `c11` and `c21`'s relations
  and gateways moved; `main`'s 105 findit pages unchanged.
- **Mutation**: `world.ts` whole (424 mutants, battery `world.test.ts`): 25 true survivors
  after hand-applying all 185 reported, every one carried from 8c and none on 8d's lines.
  Kingsford killed 13 of 8c's 38: the numbered flat's floor and door (7), the practice
  avoiding its town's business words (2), and four of the redraws. The mail rule's lines
  (39): one real survivor, the whole rule removed, which the sample could not see; the
  lone-network test now reads the whole world and kills it. Six equivalent or on a line
  older than 8d. The read split (17): one equivalent survivor (`data ?? []` filled with a
  row naming no machine).
- **Carried to 8e**: the hospital draw's three (never, always, the stream's name), which
  need a town whose draw keeps none, and the router suffix's leading zeros (2), with 8c's
  classified rest (equivalent, the unreachable throw guard, the held-name redraw).
- **Wire-checks**: `testFindit` 19/19, `testTowns` 16/16 (each town's council, courthouse
  and hospital fetched by domain), `testMillbrook` 12/12, `testJoinRefusal` 5/5 live, after
  the read split; before it every findit search failed.
- **Budgets**: the bundle 251,768 B; Kingsford 1.27 ms a box, Ashby the closest at 1.97 on
  the best of three. The suite: sampled 7320 tests in 743 s of file time, `WORLD_SWEEP=full`
  857 s, against `main`'s 785 s measured the same day.

### Slice 8e: the region's last six towns, and no two people on one network keep one note

**Value**: Harrow Valley is whole. Any player can fetch the council of Fenwick, Thornbury,
Hollowmere, Ely, Wexcombe or Stonebury by its domain, walk its directory, find its places by
town and kind, and follow a corporation's lead from its head office into a branch in one of
them; eleven towns, 491 networks, every box reading as what it is. Two people on one network
never keep the same note.
**Path**: six town rows (`r0/t5`–`r0/t10`, four villages and two towns), declared by one fold
over the rows after Millbrook → each town's institutions (a courthouse and the hospital draw
for a town) → its businesses, homes, practices and branches drawn on the streams every town
draws on, its names avoiding every network before it → its addresses in its own block → its
relations drawn within the town, its branches' leads from their head offices → each desk's
notes (none a desk below it on the network keeps) → its sites in findit's index → `whois`, a
fetch by domain, and a refused join.
**Class**: behaviour change, after a pure-refactor first commit (the fold).
**Delivery**: independent PR against `main`, branch `feat/procedural-world-rows`.
**Status**: **complete** 2026-10-02 (#593, `1bc621d0`, v0.303.0); 8e-1 to 8e-10 hold.
**Required implementation skills**: `refactoring` and `testing` for the fold; `tdd`,
`testing`, `refactoring` for the rows and the note rule; `mutation-testing` at PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning**: those of decision 19f (against `main` at `9446a858`; the
code is unchanged at `f49cc7b2`). From the prototype's dump: Fenwick branches `c1`, Thornbury
`c17` and `c9`, Hollowmere `c23` and `c3`, Ely `c5`, Wexcombe `c8` and `c15`, Stonebury `c3`
and `c20`; the one shared note is inside Hollowmere, so the note rule moves nothing declared
today. `testTowns` reads its towns from the declaration, so it grows with the rows unedited.

**Acceptance criteria** (owner-confirmed 2026-10-02, decision 19f):

- [x] **8e-1** The towns from Ashby on are declared by one fold over their rows, each town's
      names avoiding every network declared before it (Millbrook, the corporations,
      Millbrook's branches and every earlier town's networks and branches). It moves nothing:
      the world's dump is byte-identical to `main`'s, Ashby's names included, though Ashby
      now also avoids Millbrook's branches.
- [x] **8e-2** The world declares Fenwick `r0/t5`, Thornbury `r0/t6`, Hollowmere `r0/t7` and
      Ely `r0/t8`, villages, and Wexcombe `r0/t9` and Stonebury `r0/t10`, towns, in Harrow
      Valley after Kingsford: each town's networks ordered institutions, businesses, homes,
      practices, branches, answering in its own block. Region #0 holds eleven towns (AC-1);
      every declared address stays distinct, no ESSID repeats within a town, every ESSID is
      at most 32 characters, and no word names two places of one town.
- [x] **8e-3** Wexcombe keeps a courthouse and no hospital, Stonebury a courthouse and a
      hospital, each village neither; every council's directory links its town's
      institutions, listed or not.
- [x] **8e-4** No two people on one network keep the same note: a desk keeps no note a desk
      at a lower address on its network keeps, and draws nothing in its place. The test reads
      the whole world, since one rare network breaks it and the sample may hold none.
- [x] **8e-5** Every whole-world content property holds over every declared network under
      `WORLD_SWEEP=full`, the test-side failures reshaped to what each claims: an `.env`
      holds no line whose key names a password or a database; the branch golden pins the
      rows' branches. Every network of the six towns is reached, and every listed site of
      theirs is in the top ten for its town and a word its description uses for its kind.
- [x] **8e-6** A golden pins each new town's networks (key, ESSID, category, subtype,
      profile, unlisted, address), as Kingsford's does: Wexcombe's hospital draw keeping none
      and Ely's `BT-HUB-0A0C` and `NETGEAR-0E06` among them.
- [x] **8e-7** `checkBudgets` passes: every set, the six new towns among them, at most 2 ms
      a box on the best of three, and the bundle under its ceiling.
- [x] **8e-8** Nothing else moved: a dump against `main` differs only by the six towns'
      networks and the relations and gateways of `c1`, `c3`, `c5`, `c8`, `c9`, `c15`, `c17`,
      `c20` and `c23`, which gain their branches.
- [x] **8e-9** `testTowns` fetches each new town's council by its domain, and its courthouse
      and hospital where it keeps them, finds one of its sites by town and kind, and has a
      join refused; `testMillbrook`, `testFindit` and `testJoinRefusal` pass live.
- [x] **8e-10** `world-content-architecture.md` describes the eleven towns and the note
      rule. The minor version is bumped to 0.303.0.

Out of scope: findit's memoised index, the cold index-build limit and accent folding (8f);
wider note templates (rejected, decision 19f).

**PURE REFACTOR FIRST**: the fold (8e-1). Baseline: `vitest run` green and the world dumped on
`main`; after the fold the dump is byte-identical and the suite green. Its own commit.
**RED**: the six rows (8e-2) and their institutions (8e-3), which turn the three assertions of
19f red under the whole-world sweep. The real failure gets its property first (8e-4: the note
test reading the whole world); the test-side ones are reshaped where each is met (8e-5); the
town goldens (8e-6) are written from the prototype's figures before the rows exist.
**GREEN**: the six rows in `world.ts`; the note rule in `npcHome.ts`, a desk reading the notes
of the desks below it from their first draw on their own `home-content-` streams.
**REFACTOR**: assess.
**Server evidence**: no server code change. `testTowns.ts` runs live against `vercel dev`
with the six towns; `testMillbrook`, `testFindit` and `testJoinRefusal` rerun.
**PRE-PR MUTATION**: Stryker on the fold and the note rule (narrowed battery, json reporter);
the carried survivors re-run: the hospital draw's three and the router suffix's leading zeros
(2), now reached, with 8c's classified rest. One full sweep under `WORLD_SWEEP=full`,
recorded.
**PR-ready when**: 8e-1 to 8e-10 hold, the dump differs only as 8e-8 allows, `vitest run`
(sampled) and the full sweep, typecheck, lint and format pass, and the owner approves the
commit.
**Slice complete when**: its PR merges; 8f is planned next.
(Done 2026-10-02: #593 merged; 8f is next.)

**As built** (2026-10-02):

- **The fold** is `TOWN_ROWS` and `DRAWN_TOWNS` in `world.ts`, its own commit (`f582cdf9`):
  the world's dump byte-identical to `main`'s, Ashby now also avoiding Millbrook's branches.
  Adding a town is one row.
- **The six rows** drew exactly the prototype's 157 networks; a table-driven describe pins
  each town (institutions by rule, counts by size, order and keys, a 157-line golden, the
  directory, the block) and the region's eleven towns (AC-1).
- **The note rule** is `notesKeptBelow` in `npcHome.ts`: a desk drops a note any desk at a
  lower address on its LAN draws, read from each desk's first draw on its `home-content-`
  stream; a box below the LAN keeps everything it draws. It moves only School Lane Haulage's
  `r0/t7/n8` desk. Interleaved `checkBudgets` runs show no measurable cost.
- **Dump against `main`**: outside the six towns only the relations and gateways of `c1`,
  `c3`, `c5`, `c8`, `c9`, `c15`, `c17`, `c20` and `c23` moved; none of `main`'s findit pages.
- **Mutation**: the note rule 32 mutants, 28 killed by `npcHome.test.ts`, 2 more by the
  landmark snapshot (each moves a `WAYSTAR-WIFI` desk's notes), 2 equivalent over the declared
  world (the deep-desk guard and the machine check; neither changes any of 2226 boxes).
  `world.ts` whole (442 mutants, battery `world.test.ts`): 19 true survivors after
  hand-applying all 194 reported, against 8d's 25, none on 8e's lines. The carried hospital
  draw's three are killed (Wexcombe keeps none), and the router suffix's fill (Ely's
  `BT-HUB-0A0C`); its `toUpperCase` survivor is equivalent, `businessSpelling` upper-casing
  the ESSID after it. The 18 left are 8c's classified rest.
- **Wire-checks**: `testFindit` 19/19, `testTowns` 37/37, `testMillbrook` 12/12,
  `testJoinRefusal` 5/5 live.
- **Budgets**: the bundle 251,882 B; every set 0.83–1.69 ms a box across loaded and idle
  runs, Ashby the highest. The suite: `WORLD_SWEEP=full` 7672 tests in 1147 s of file time,
  sampled 911 s (743 s at 8d, the machine's load not separated).

### Slice 8f: findit answers from what it has already built, and "cafe" finds cafés

**Value**: A player searching findit is answered without the server rebuilding every site it
built for the last search. On a warm function instance a search costs its journal reads and the
machines players touched, where every search on Vercel cost about 2 s. A page somebody
rewrote, a site gone dark and a gateway repointed are still listed as they are served at the
next search. A player who types "cafe" finds the cafés, as one who types "café" does.
**Path**: a search at findit's address (`answerSearch` in `network/resolveHttpFetch.ts`) →
`indexedWeb` (`findit/webIndex.ts`): the journal reads as today, 200 machines a read → each
publisher with no row on its gateway or its site server listed from the generated web, built
from generation on the instance's first search and kept; each publisher with a row rebuilt as
today; each player network whose gateway has no row skipped, one with rows resolved as today →
`rankPages` (`findit/search.ts`), accents folded on the query and the page alike → the results
page.
**Class**: pure refactor first (the memo, a cost change that answers alike), then behaviour
change (accent folding).
**Delivery**: independent PR against `main`, branch `feat/procedural-world-findit-memo`.
**Status**: **complete** 2026-10-02 (#594, `97d39a80`, v0.304.0); 8f-1 to 8f-8 hold, 8f-7
in part (below).
**Required implementation skills**: `refactoring` and `testing` for the memo; `tdd`, `testing`,
`refactoring` for the folding; `mutation-testing` at PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (against `main` at `418d9ad4`; the findit code is unchanged
since 19f's prototype):
- `indexedWeb` is called once a search by `answerSearch`, and by `webIndex.test.ts` and
  `world.test.ts`; `testFindit` reads `publisherMachineIds`. No client code imports it, so the
  memo lives only in a server function's instance.
- With nothing patched no search calls `siteAt` (19f's prototype): an untouched publisher's
  listing is built from generation alone, synchronously. Two first searches on one instance
  can at worst both build it, alike.
- The ranking lower-cases the query and each page and folds nothing else. The generated pages
  spell the word both "cafe" and "café", capitalised or not.
- `checkBudgets` times its box sets on developer machines only (`VERCEL=1` skips them), after a
  warm-up pass, the best of three; the cold limit joins them on the same terms. Its warm-up
  also warms the relations memo, as the box sets' does.

**Acceptance criteria** (owner-confirmed 2026-10-02, decision 19f):

- [x] **8f-1** A search of a world nobody has touched answers exactly as before the memo:
      every listed publisher under its domain, read as generated, and every query the suite
      asks ranked as before; a second search on the same instance answers the same.
- [x] **8f-2** A publisher touched after an earlier search is listed at the next one as a
      visitor would be served it: its homepage rewritten (a row on its site server alone) as
      it now reads; its site server bricked or its web server stopped, absent; its gateway
      bricked (a row on its gateway alone), absent; its gateway repointed, whatever now
      answers, fetched the ordinary way. Each test searches the untouched world first.
- [x] **8f-3** A publisher whose rows are gone, its box restored, is listed as generated again
      at the next search: what is kept holds only what generation builds, never a page a
      player wrote.
- [x] **8f-4** The journal reads are unchanged: 200 machines a read, each publisher's gateway
      and site server and every other declared network's gateway named once; a read failing
      yields no index. A player network whose gateway has no row is never fetched; one whose
      gateway has rows is resolved as today.
- [x] **8f-5** "cafe" finds a page that says "Café", and "café" a page that says "cafe": accents
      are folded on the query and the page alike, both in whether a page answers a word and
      in what the word scores where it appears. A result is shown as its page writes it. For
      every town, "<town> cafe" answers the same pages in the same order as "<town> café".
- [x] **8f-6** `checkBudgets` times building the generated web from nothing at the launch
      extent (every publisher, no journal) against a **1,000 ms** ceiling, one warm-up pass
      then the best of three, on developer machines only as the box sets are (AC-9). Every
      box set stays under 2 ms a box and the bundle under its ceiling.
- [x] **8f-7** `testFindit` and `testTowns` pass live; a warm search's time is recorded
      against the first.
- [x] **8f-8** `discovery-architecture.md` describes the memo (the generated web kept, what
      players touched read live) and the folding; `conventions-and-gotchas.md` §3 the cold
      limit; `webIndex.ts` and `answerSearch` no longer say nothing is kept. The minor version
      is bumped to 0.304.0.

Out of scope: a limit on a warm search (19f set only the cold one); folding beyond combining
marks (`ß`, ligatures); a stored index shared across instances.

**PURE REFACTOR FIRST**: the memo (8f-1 to 8f-4). Baseline: `vitest run` green on `main`.
8f-2's and 8f-3's tests are written first, searching the untouched world before touching it;
they pass on `main`, which keeps nothing, and fail against a memo that served a touched
publisher or kept a page it rebuilt. Then the memo: `indexedWeb` lists each untouched
publisher from the generated web, built once an instance; the generated web's builder is
exported for `checkBudgets` to time from nothing. Suite green, and a search of the untouched
world timed before and after. Its own commit.
**RED**: 8f-5 in `search.test.ts` ("cafe" against a page titled "Café", "café" against
"cafe", and a ranking where only a folded word makes a page answer every word); then the
town-wide property in `webIndex.test.ts`.
**GREEN**: fold the query's terms and each page's places once, in `search.ts`.
**REFACTOR**: assess.
**Budget**: 8f-6 in `scripts/checkBudgets.ts`; its evidence is the gate's printed line on a
developer machine (no RED: it is a script, kept out of vitest so mutation runs are not timed).
**Server evidence**: `answerSearch` itself does not change. `testFindit` and `testTowns` run
live against `vercel dev`.
**PRE-PR MUTATION**: Stryker on `webIndex.ts` and `search.ts` (battery `webIndex.test.ts` and
`search.test.ts`, json reporter). The memo's own guard (built once, against every search) is
equivalent by design, a kept answer and a fresh one being alike; its value is the timing. The
touched check (a row on the gateway or the server) is killed by 8f-2's one-sided touches; the
fold on each side by 8f-5's two directions.
**PR-ready when**: 8f-1 to 8f-8 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit.
**Slice complete when**: its PR merges; AC-9 closes, and slice 9 is grilled next.
(Done 2026-10-02: #594 merged; AC-9 closes, and slice 8 is complete. Slice 9 is next.)

**As built** (2026-10-02):

- **The memo** is its own commit (`d69bbd66`): `buildGeneratedWeb` in `webIndex.ts` lists
  every publisher from generation alone, synchronously; `indexedWeb` keeps the first one an
  instance builds and lists a publisher from it while neither its gateway nor its site server
  has a row, rebuilding it as before when either does. A player network whose gateway has no
  row is skipped before it is materialised. Seven tests search the untouched world first, then
  touch one publisher (server alone, gateway alone) or restore it; they passed on `main` and
  pass after. In process, with no rows: the first search 514 ms, every later one about 1 ms
  (518–554 ms each before), 249 pages either way.
- **The folding** is `folded` in `search.ts` (lower-case, `NFD`, combining marks removed),
  applied to the query's terms and once per page to its title, description and text
  (`placesOf`), which the answered count and the score both read. RED: four `search.test.ts`
  tests and the whole-world property ("<town> cafe" answers as "<town> café" for every town),
  which failed on Ridgemont without the fold.
- **The cold limit**: `checkGeneratedWeb` in `checkBudgets`, 424 ms for 283 publishers against
  1,000 ms. The box sets read 0.75–0.98 ms a box; the bundle 251,882 B, unchanged (the index
  is server-only).
- **Mutation** (`webIndex.ts` and `search.ts`, battery `webIndex.test.ts` and
  `search.test.ts`): 190 mutants, 162 killed, 1 timed out, 26 survived, 1 uncovered. Every
  survivor on 8f's lines is equivalent: the memo emptied or bypassed (`buildGeneratedWeb`'s
  five and its uncovered branch, the touched check forced true), the skip of untouched player
  gateways dropped, the `ELSEWHERE` sentinel's string, and `toUpperCase` for the fold (both
  sides fold alike). The touched check's one-sided mutants are killed by the server-only and
  gateway-only touches. The other 13 are on findit lines 8f did not change, equivalent over
  the declared world (`data ?? []` after the error check, the `'/'` path, the address guards,
  the empty-query guard, `\s+` against `\s`).
- **Wire-checks**: `testFindit` 19/19, `testTowns` 37/37 live. **8f-7 holds in part**: `vercel
  dev` appears to load the function for every request (every search 2.4 s, the first no
  slower, a plain fetch 1.9 s), so each search there pays the cold build and the kept web is
  never warm locally. The warm saving stands on the in-process timing; measuring it on Vercel
  needs a player joined to a preview deployment, a cloud write left to the owner.
- **The suite**: `vitest run` 7684 tests in 275 files.
- **AC-2** is ticked at this close-out: 8a-3 proved it for Ashby, and `testTowns` fetches every
  declared town's council by its domain (37/37 above); it had been left unticked when 8a
  closed.



### Slice 9: Ridgemont's filler and the injector

Grilled 2026-10-02 (decision 19g). Two PRs, in order, each cut from `main` after the one before
it merges: 9a Ridgemont's filler, declared and on the WiFi; 9b the injector turned down. 9b is
planned after 9a merges, and is the plan's last PR.

### Slice 9a: Ridgemont fills with the shops, homes and practices of a city, and a player can join them

**Value**: A player standing in Ridgemont scans a city, not a catalog: 178 networks, the 57
landmarks among 121 shops, cafés, offices, homes, practices, a hospital and three corporate
branches. A filler network shows the name it broadcasts in every scan, crack and connect, and
joins by that name. Its listed sites are on findit, `whois` answers Ridgemont for each, and
its homes are found the way every town's are, by a lead on an office's desk.
**Path**: Ridgemont's `city` row (`r0/t0`) → the networks a city draws on Ridgemont's own
streams, but for the institutions a landmark holds (council, police, courthouse, library),
keyed after the catalog (`r0/t0/n57` on) and declared after Stonebury → their addresses in
Ridgemont's block after the landmarks' → their relations, forwards and site text, as every
town's (the landmarks excepted) → findit's index, `whois` and a fetch by domain → the scan's
pool, Ridgemont's 178 keys → `airodump-ng`, `aircrack-ng`, `nmcli` and the HUD showing each
key's broadcast name → `nmcli connect <ESSID>` joining by the key → `registerNetwork`, which
admits any Ridgemont key.
**Class**: pure refactor first (the landmark checks), then behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-ridgemont-filler`.
**Status**: **complete** 2026-10-03 (#595, `af8608d5`, v0.305.0); 9a-1 to 9a-9 hold. The
`WORLD_SWEEP=full` run took 1,604 s of file time (8e: 1,147 s); the sampled run is unchanged.
**Required implementation skills**: `refactoring` and `testing` for the landmark checks; `tdd`,
`testing`, `refactoring` for the filler and the scan; `mutation-testing` at PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (against `main` at `a11c3360`, by a throwaway prototype
declaring the filler, switching the seven landmark checks and widening the scan's pool, then
reverted; the diff kept outside the repo):
- **The filler**: 121 networks, `r0/t0/n57`–`n177`, 612 declared in all, every address
  distinct. `GENERAL-HOSPITAL` (`n57`, `ridgemonthospital.org`, deep); 65 businesses (7
  insurers, 7 IT firms, 4 accountants, 3 consultancies, 3 hauliers; 31 shops of eight kinds;
  10 cafés, tea rooms and coffee bars); 44 homes; 8 practices (5 dentists, 3 clinics); the
  branches `CROWTHER-GOODWIN-RIDGEMONT` (`n175`, `c7`), `PRESCOTT-NORCROSS-RIDGEMONT` (`n176`,
  `c24`) and `OAKLEY-BARROW-RIDGEMONT` (`n177`, `c26`). Profiles: 35 lone, 64 flat, 22 deep.
  74 publish a site, 11 unlisted. The longest ESSID is 29 characters
  (`UNION-STREET-TAX-AND-ACCOUNTS`).
- **Names**: Ridgemont's 178 ESSIDs are distinct, and none is a noise network's. Twenty filler
  ESSIDs are also another town's (`GENERAL-HOSPITAL` and 19 homes such as `OKONKWO-WIFI` or
  `GARDEN-FLAT`), which decision 4 allows: a scan shows one town.
- **What moves** (a dump of every declared network's address, persona, forwards, relations,
  gateways, LAN and deep boxes, and findit's pages): the filler, and `c7`, `c24` and `c26`,
  whose gateways gain the lead to their new branch. No landmark, no other town and no other
  corporation moves. findit's pages grow from 249 to 312.
- **The suite**: 13 failures, the same sampled and full. Sampled 904 s of file time (911 s at
  8e); full (`WORLD_SWEEP=full`) 1209 s (1147 s at 8e's green). The sample adds only the
  filler's shapes, since `worldContent` sweeps the landmarks from the catalog.
  - Twelve are test-side: tests whose set or pin was "the scan's pool" or "Ridgemont" and meant
    the landmarks (the till test counting four shops, the landmark snapshot, "no landmark at
    all" and "no kind for a Ridgemont network", the placeless-block corporations, "leads
    nowhere from or to Ridgemont", the empty homes of non-desks, which offsite copies fill in
    every town); the scan's pinned rolls; the joinable set (57 to 178); and the branch golden
    and the "no branch" gateway, which `c7`, `c24` and `c26` leave.
  - **One is a draw**: a place of care's desk must show a line of work only a place of care
    keeps. `LANDMARK-DENTAL`'s (`n170`) `desktop-144` draws its 3–7 lines from the healthcare
    pool and none of the six it keeps alone (`lp clinic-list.txt`, `cp rota.csv …`), which a
    draw does about one time in five; no desk on `main` happens to.
- **Budgets**: the landmarks 0.92 ms a box, the filler 0.80 ms over 615 boxes, every town under
  1 ms; findit's generated web 535 ms from nothing over 357 publishers (1,000 ms); the bundle
  251,882 B, unchanged.
- **The scan path**: `nmcli connect` finds the typed name among the scan's `essid`s and joins
  `network.essid`, which becomes `association.essid`; about 25 commands, the persisted
  connection and `bssidFromEssid` read that as the network's key, as every generator does
  (`essidSlug` already looks a key's broadcast name up in the world). A name is shown only by
  `airodump-ng`'s rows, `aircrack-ng`'s lines, `nmcli`'s messages and the HUD.
- `crackableEssidPool` is read by 20 test files, two factories and 16 wire-checks to find a
  network; with the landmarks first in the pool, each `.find` lands where it did.

**Calls taken while planning** (decision 19g left the wiring to planning):
- **A network is known by its key everywhere; only what a player reads is its broadcast name.**
  The scan's entries, the association, the join, the BSSID, the password and the persisted
  connection hold the key, as today (a landmark's key being its ESSID); `world.ts` gains the
  lookup `essidOf(key)` (`essidSlug` reads it too), and the four places a name is shown read
  it. `nmcli connect` matches the typed name against each entry's `essidOf`. Rejected: a
  `key` field beside `essid` on the scan and the association, which renames 25 readers for a
  difference only the filler has.
- **`world.ts` exports `isLandmark(key)`** and the seven checks that meant a landmark say so;
  the join refusal keeps its town check. Tests whose claim is the catalog read the catalog.
- **The place-of-care desk test is reshaped** (flagged): a desk's history draws its work from
  its place's pool, which the test now proves for every line it can, and the lines only a
  place of care keeps are shown across the healthcare desks together, which proves the pool is
  read. Accepted: one desk in five reads its place's work in lines an office also types; its
  notes are a place of care's either way. Rejected: forcing an own line into every history,
  which moves every healthcare desk in the world.

**Acceptance criteria** (proposed 2026-10-02, decision 19g):

- [x] **9a-1** Ridgemont is a `city` row and declares 121 networks after its 57 landmarks,
      keyed `r0/t0/n57`–`r0/t0/n177`: the hospital `GENERAL-HOSPITAL`
      (`ridgemonthospital.org`), 65 businesses, 44 homes, 8 practices and the branches of
      `c7`, `c24` and `c26`, in that order. No council, police, courthouse or library is
      generated. They are declared after Stonebury, and their names avoid every network
      declared before them.
- [x] **9a-2** Each filler network answers in Ridgemont's block at its own position after the
      landmarks', and every one of the world's 612 addresses is distinct. Ridgemont's 178
      ESSIDs are distinct, and none is a noise network's.
- [x] **9a-3** The filler is generated as any town's networks: its offices and file servers keep
      the leads to its homes and its unlisted businesses, its gateways forward services beyond
      their site, and its sites name Ridgemont. No landmark keeps or receives a lead, forwards
      more than its site, or reads differently (AC-7): a dump against `main` shows only the
      filler and the gateways and relations of `c7`, `c24` and `c26` moved.
- [x] **9a-4** findit lists the filler's 63 listed sites and never its 11 unlisted ones (AC-6),
      `whois` answers each filler address and domain with `city: Ridgemont` and `region: Harrow
      Valley`, and a fetch by domain answers. Every declared network is still reached (AC-4).
- [x] **9a-5** A scan draws its 2–3 crackable networks from Ridgemont's 178, the landmarks first
      in catalog order and the filler in key order, and its 3–5 noise as before; the injector is
      unchanged (9b).
- [x] **9a-6** A filler network reads as its broadcast name everywhere a player reads one: its
      `airodump-ng` row, `aircrack-ng`'s lines, `nmcli`'s connect, status and disconnect
      messages and the HUD. No output names its key. `nmcli connect <ESSID> <password>`
      joins it, cracking to the password its key derives, under the BSSID its key derives; a
      reload restores the connection. A landmark reads and joins exactly as before.
- [x] **9a-7** The server admits a join to a filler network (`200` with its `local_ip`, the
      occupancy row under its key) and still refuses another town's network or an undeclared
      key (AC-5), shown live by `testJoinRefusal`.
- [x] **9a-8** The content sweeps read the landmarks whole and the filler by the sample, as every
      town's; `checkBudgets` times the landmarks and the filler as two sets, each under 2 ms a
      box, and findit's cold build under 1,000 ms; the bundle stays under its ceiling.
- [x] **9a-9** `testTowns` adds Ridgemont's filler (the hospital by domain, a site by town and
      kind, `whois`); `testFindit`, `testMillbrook` and `testJoinRefusal` pass live.
      `world-content-architecture.md` and `discovery-architecture.md` describe Ridgemont's
      filler and the landmarks as the exception. The minor version is bumped to 0.305.0.

Out of scope: the injector (9b); a directory on Ridgemont's council (a landmark, AC-7); any town
but Ridgemont in the scan; naming a hidden network.

**PURE REFACTOR FIRST**: `isLandmark` and the seven checks. On `main` every Ridgemont network is
a landmark, so it is behaviour-preserving, shown by a dump identical to `main`'s and the suite
green. Its own commit.
**RED**: a `world.test.ts` test of 9a-1 and 9a-2 (Ridgemont's count, kinds, keys, branches,
addresses and names), failing on `main`; then 9a-3's leads, forwards and locality on the
filler and 9a-4's findit, `whois` and reach, all falling out of the declaration (each shown
failing by reverting it); then 9a-5 in `generateWifi.test.ts`; then 9a-6 in the command tests
(`airodumpNg`, `aircrackNg`, `nmcli`) and the HUD's, against a scan holding a filler network.
**GREEN**: the declaration in `world.ts`; the pool in `generateWifi.ts`; `essidOf` read where a
name is shown and matched.
**REFACTOR**: assess.
**Test-side** (in the RED commits they belong to): the twelve above, each to its stated set,
and the place-of-care desk test as called.
**Budget**: `checkBudgets` names the two Ridgemont sets; its printed lines are 9a-8's evidence.
**Server evidence**: `registerNetwork` does not change; `testJoinRefusal` joins a filler
network live, and `testTowns`, `testFindit` and `testMillbrook` run against `vercel dev`.
**PRE-PR MUTATION**: Stryker on `world.ts`, `relations.ts`, `seededForwards.ts`, `webSite.ts`,
`generateWifi.ts`, `nmcli.ts`, `airodumpNg.ts` and `aircrackNg.ts`, each against its own test
files (json reporter). `isLandmark` in each check is killed by the filler's leads, forwards
and locality; the name lookup by 9a-6's no-key assertions.
**PR-ready when**: 9a-1 to 9a-9 hold, `vitest run` and one `WORLD_SWEEP=full` run, typecheck,
lint and format pass, and the owner approves the commit.
**Slice complete when**: its PR merges; AC-10 closes, and 9b is planned next.

### Slice 9b: another player's network surfaces in about one scan in twenty, one at a time, and only from Ridgemont

**Value**: Landing on another player's network becomes rare, as the world's size promised. Today
three scans in four show somebody's occupied network, about one and a half a scan; after 9b a
player who scans Ridgemont meets one in about one scan in twenty, never two at once, and never
a network outside the town they stand in. Two players who mean to meet still can: the second
finds the first's network in about 16 rescans.
**Path**: `airodump-ng` → `env.scan.resolveOccupiedEssids()` (the server's name-only read,
unchanged) → `rescanWifi` → `generateWifi`: the base draw as today, then the occupied keys in
the scan's own pool that the draw does not show; with none, no draw; with some, one roll
against 5%, and on a hit one of them → the roll stored, shown by its broadcast name and
cracked and joined as any network.
**Class**: behaviour change.
**Delivery**: independent PR against `main`, branch `feat/procedural-world-injector`.
**Status**: planned 2026-10-03.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at
PR-readiness.
**Reduction program**: `N/A`.

**Facts measured while planning** (against `main` at `6ce869fa`, 20,000 scans over 50 players
with three Ridgemont keys occupied):
- **Today's injector** adds an occupied network to **74.8%** of scans, **1.49** a scan on
  average (up to `INJECT_MAX = 3`), and accepts any name the server lists: a key from another
  town, or a lab network a dev stack admits (`admitsUndeclaredNetworks`), surfaces as readily.
- **The base draw** offers any one Ridgemont key in **1.36%** of scans (2–3 of 178). With the
  injector at 5%, a network one other player occupies shows in about 6.3% of scans: about 16
  rescans on average, and nothing in 50 rescans about one time in 26.
- The injector draws only when it has something to inject, so a scan with no occupants is the
  base roll; every pinned scan in `generateWifi.test.ts` (the offers, the shuffle, the golden)
  passes no occupants and does not move.
- Nothing reads which scan injected what: `airodump-ng` passes the server's list straight to
  `rescanWifi`, and `airodumpNg.test.ts` mocks the roll. The server's read and
  `testSameLanOccupiedEssids` are untouched.
- The occupied names arrive in the order the database returns its rows, de-duplicated.

**Calls taken while planning** (decision 19g fixed the behaviour):
- **The candidates are the pool's keys that are occupied and not already shown, in the pool's
  order.** Filtering the pool rather than the server's list keeps a scan independent of the
  order rows come back in, and keeps every name the pool lacks out by construction.
- **One roll, `prng.next() < INJECT_CHANCE` (0.05)**, taken after the base draw and only when a
  candidate exists, then one `pick`. `INJECT_MAX` goes. Accepted: a scan with candidates moves
  its channels, powers and noise against today's, as today's injector already does.
- **The rate is proven over 2,000 scans with candidates: between 3% and 7% inject**, and none
  injects two. The generator is seeded, so the count is fixed; the band says what the number
  means rather than pinning it.
- **The four injection tests are rewritten to the new rule**: the name outside the pool
  inverts (it never surfaces), the bounded sample becomes "at most one", the never-doubled and
  never-a-ghost tests stand. Added: the rate, order-independence, a scan with nothing to inject
  equal to one with no occupants, and an injected filler network read by its broadcast name
  with its key's BSSID and password.
- **The plan's close-out is its own step after 9b merges**, not part of the PR: the as-built
  moves into `world-content-architecture.md`, `discovery-architecture.md`, handbook chapter 6
  and the §9 backlog of `conventions-and-gotchas.md` (which this plan amends and which still
  describes the 50-network world), and this file is deleted, as a `docs(v2):` PR as the
  legacy-parity epic's retirement was (#566).

**Acceptance criteria** (proposed 2026-10-03):

- [ ] **9b-1** Over 2,000 scans that each have an occupied Ridgemont network to inject, between
      3% and 7% show one, and no scan shows more than one injected network.
- [ ] **9b-2** Only a network in the scan's own pool is injected: an occupied name that is not
      one of Ridgemont's 178 keys (another town's network, a lab network, a name nobody
      declares) never surfaces, and a network the base draw already shows is never doubled.
- [ ] **9b-3** A scan with nothing to inject (no occupants, or none in the pool that the draw
      does not show) is identical to the same scan with no occupants, and the order the occupied
      names arrive in never changes a scan.
- [ ] **9b-4** An injected network is an ordinary crackable entry: WPA2, a strong signal, the
      BSSID and password its key derives. An injected filler network shows its broadcast name in
      `airodump-ng`, never its key.
- [ ] **9b-5** `e2e-shared-network-verification.md` describes the injector as it is (about 5% of
      scans, one network, Ridgemont's only; about 16 rescans to meet a network; 50 empty rescans
      before suspecting it), and `generateWifi.ts` says the same. The minor version is bumped to
      0.306.0.

Out of scope: the server's read (unchanged); deliberate rendezvous (a later epic); the plan's
close-out (above).

**RED**: in `generateWifi.test.ts`, 9b-1's rate and 9b-2's pool rule, both failing on `main`
(about 75% inject, and a name outside the pool surfaces); then 9b-3 and 9b-4 (9b-3's
order-independence fails on `main`, which injects from the server's order).
**GREEN**: the candidates and the roll in `generateWifi.ts`.
**REFACTOR**: assess.
**Server evidence**: `N/A`: no server or `api/` file changes, and the read the injector consumes
is unchanged; `testSameLanOccupiedEssids` still describes it.
**Browser evidence**: `N/A`: a two-player run meets the injector in about 16 rescans by chance,
which proves nothing a seeded test does not; the shared-LAN doc carries the operational
change.
**PRE-PR MUTATION**: Stryker on `generateWifi.ts` against `generateWifi.test.ts` (json
reporter). The chance's comparison is killed by the rate band; the pool filter by 9b-2; the
emptiness guard by 9b-3.
**PR-ready when**: 9b-1 to 9b-5 hold, `vitest run`, typecheck, lint and format pass, and the
owner approves the commit.
**Slice complete when**: its PR merges; AC-11 closes, and the plan's close-out follows.

## Acceptance Criteria

- [x] **AC-1** With the launch extent declared, region #0 holds 8–12 towns, and a test over the
      whole declared world proves every network has a distinct public IP.
- [x] **AC-2** Any player can fetch a procedural town's council site by its domain. Its directory
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
- [x] **AC-9** `checkBudgets` passes: gzipped main chunk ≤ 284,975 B, and both the landmark sweep
      and the sampled procedural sweep average ≤ 2 ms per box, and the cold findit index build at
      the launch extent stays within the limit slice 8 measures and sets.
- [x] **AC-10** A Ridgemont scan draws from all 178 of its networks, and a filler network cracks
      and joins by the name it broadcasts while the server records it under its key.
- [ ] **AC-11** An occupied network surfaces in about 5% of scans, one at a time, and only from
      the player's own town.

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
