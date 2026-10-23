# Plan: landmarks in every town

**Status**: Grilled 2026-10-23 (decisions below, owner-confirmed). Next: the slice plan, with the
43 drafted landmarks for the owner to approve before any code.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

Ridgemont has 57 hand-written landmarks, most of them pop-culture parodies (`ACME-CORP`,
`KWIK-E-MART`, `NULL-BYTE`); every other town is drawn entirely from templates. Since v0.428.0 a
player can start in any of the eleven towns, so seven in ten never stand in Ridgemont and never
scan a landmark. Give every other town named corners of its own. This is the backlog item
"Hand-written places for the other towns" (`docs/backlog.md`).

## Where it starts from (facts, 2026-10-23)

- **A landmark** is a catalog row (`pools/essidCatalog.ts`): an ESSID, a category, the place as
  its people name it, and for an institution a site (domain and name). Everything behind it, its
  LAN, machines and passwords, is generated from its key. `isLandmark(key)` (`world.ts`) marks one,
  and every rule that leaves the landmarks out asks it: a landmark declares no drawn profile or
  kind, keeps and receives no lead, forwards nothing beyond its site, and its site reads as
  written.
- **Ridgemont's 57 are keyed by their ESSID** and answer in Ridgemont's block by catalog position;
  its 20 corporate landmarks are head offices answering in the placeless `193` block. 39 of the 57
  publish a site; the other 18 (six homes, four university, four IoT, four hacker spaces) are
  reached only over Ridgemont WiFi.
- **The catalog is closed at 57.** A hand-written network added to a town is declared after what
  the town already draws, as Millbrook's cottage hospital is (`MILLBROOK_LATER_INSTITUTIONS`), so
  no earlier key, name or address moves (`procedural-world-architecture.md`, "Adding to the
  world").
- **A drawn town already holds its institutions**: town hall, police, library, school and the rest
  by size class (`world-content-architecture.md`, "The towns").
- **A town's share of starting players is its share of networks** (`startingTown`), so networks
  added to a town move a few keys into it.

## Decisions (owner-confirmed 2026-10-23)

1. **A new landmark is like Ridgemont's**: a hand-written ESSID, place, category and, where it has
   one, a site; its LAN and machines generated from its key; and every landmark rule applies (no
   drawn profile, its site reads as written).
2. **How many, by size class**: a city 10, a town 5, a village 3. Kingsford 10; Stonebury, Oakhurst
   and Wexcombe 5 each; Millbrook, Ashby, Fenwick, Thornbury, Hollowmere and Ely 3 each: **43**.
   Ridgemont keeps its 57 and gets none.
3. **Flavour: pop-culture, scaled to the place.** Fictional places from film, TV and games, and
   hacker-scene easter eggs, as Ridgemont's are; Kingsford gets parody firms and venues, a village
   a fictional pub, shop or farm. Real brands stay in the noise pool.
4. **Reach: Ridgemont's rule.** No leads in or out. A place that would have a website publishes
   one, so every player reaches it over the internet (findit, mapit, `whois`); a home, a gadget or
   a hacker den publishes none and is reached only by the town's own players, until Travel.
5. **Authoring: Claude drafts all 43 into the slice plan, town by town, checked against the name
   rules** (ESSID at most 32 characters, no ESSID repeated within its town, no domain repeated
   anywhere, no real brand). The owner strikes or renames any before a line of code is written.
6. **The mix: about two-thirds with a site, and no institutions.** A village 2 sited + 1
   locals-only, a town 3 + 2, Kingsford 7 + 3. Sited landmarks are corporate, café or pub, or
   retail; locals-only ones are a home, a gadget (IoT) or a hacker den. No government, public or
   healthcare landmark, since every town already draws those.
7. **Delivery: one slice, one PR**, all ten places at once: one approved list, one declaration
   change, one shift of the town weights.

## What follows without a decision

- **Each town's landmarks are declared after everything it already draws**, its branches
  included, and keyed and addressed as its next networks (`r0/t<town>/n<k>`), so no existing key,
  name or address moves. The ESSID is not the key: two towns may both broadcast a name.
- **`isLandmark` covers them**, so every landmark rule applies with no new branch.
- **A sited landmark appears on findit and on its town's mapit page** with nothing written by
  hand; Millbrook's page is pinned line for line in `renderPage.test.ts` and is updated there.
- **The town weights shift**: a town's share of starting players grows with its networks, so a few
  keys draw a different town. Players already on a network stay on it through reloads; the
  accepted price of a world that grows (`procedural-world-architecture.md`, "Where a player
  stands").
- **Unchanged**: Ridgemont's catalog and its 57; every drawn network; the guardian's patrol, which
  walks government and public sites, so it gains none.
