# Plan: players start in different towns

**Status**: Grilled. Decisions confirmed by the owner 2026-10-23. No slice is planned yet; the
slice plan is next.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

Every player stands in Ridgemont today, so all of them share its 178 networks, and the chance of
landing on another player's network grows with the share of those 178 that are occupied. The owner
wants that chance to stay low as the game gets crowded. Spreading new players across every town
the world already draws makes the room roughly 3.3 times larger without generating anything new.
This is the first half of the backlog's **Travel** item (`docs/backlog.md`, "Travel"): a player
location the server can trust. Moving between towns stays deferred.

Players today: the owner (`jshacker`), Claude's test player (`kestrel`) and possibly one friend, so
nothing stored constrains the change.

## Where it starts from (facts, 2026-10-23)

- **Two places assume Ridgemont.** The WiFi scan draws from `crackableEssidPool`, every declared
  network whose `town` is Ridgemont (`core/generation/generateWifi.ts`). The 5% chance of adding
  another player's network draws from the same pool. The join refuses any network outside
  Ridgemont with `403 network_not_joinable`, because procedural keys are guessable and a modified
  client is the threat (`core/network/registerNetwork.ts`, `handleRegisterNetwork`). Everything
  else naming Ridgemont is text or content tied to the place itself.
- **A scan** shows 2–3 networks drawn uniformly from the pool, plus, in 5% of scans
  (`INJECT_CHANCE`), one network another player occupies that the draw did not already show.
  Each `airodump-ng` is a fresh draw seeded by the player's key and a scan index.
- **The towns** (declared world, v0.427.0), as publishers / homes / corporate branches / other:

  | Town | Size | Networks | Publishers | Homes | Branches | Other |
  |---|---|---|---|---|---|---|
  | Ridgemont | city | 178 | 113 | 50 | 3 | 12 |
  | Kingsford | city | 166 | 82 | 80 | 4 | |
  | Stonebury | town | 51 | 27 | 22 | 2 | |
  | Oakhurst | town | 47 | 25 | 20 | 2 | |
  | Wexcombe | town | 38 | 24 | 12 | 2 | |
  | Thornbury | village | 20 | 10 | 8 | 2 | |
  | Millbrook | village | 18 | 11 | 6 | 1 | |
  | Ashby | village | 18 | 10 | 6 | 2 | |
  | Hollowmere | village | 17 | 11 | 4 | 2 | |
  | Ely | village | 16 | 7 | 8 | 1 | |
  | Fenwick | village | 15 | 9 | 5 | 1 | |

  584 networks stand in a town. The other 28 (findit and the corporations' head offices) stand in
  none.
- **Outside Ridgemont, homes have no WiFi a player can scan** (`docs/discovery-architecture.md`,
  "Leads: the only way to a home"). A home publishes nothing; it is found through a lead
  (`core/generation/relations.ts`): an IT contractor's shortcut, a shop's nightly offsite backup.
  Relations are drawn only for towns beyond Ridgemont.
- **A reload keeps the network a player is on** without checking the scan or the join rule
  (`ui/connectionPersistence.ts`, `restoreConnection`). Only a fresh `nmcli connect` asks the
  server.

## Decisions (owner-confirmed 2026-10-23)

1. **Every town is a starting town, weighted by its network count.** A town's share of new players
   is its share of the 584 networks that stand in a town, so a network is equally likely to have
   company wherever it is. No town is left out, villages included: a village player sees all ~16
   of their networks within a few scans, and that small world is part of the flavour. The 28
   networks in no town are never a starting place.
2. **The town a player stands in works exactly as Ridgemont does today: all of it is on their
   WiFi, homes included.** One rule: your own town is on WiFi; every other town is reachable only
   over the internet, and its homes only through leads. Leads keep their value for everyone who
   does not live in that town. A local can scan straight onto a home a lead points at, and that is
   what living there means. Ridgemont stops being a special case.
3. **A player's town is derived from their key**: a pure, weighted function of the public key, so
   the client (which draws the scan offline) and the server (which checks the join against the
   verified key) always agree, with nothing stored and no schema change. Travel, later, is a
   stored override on top of it. The players who already exist get a town from their keys like
   anyone else: each stays on the network they are on through reloads, and a fresh join after a
   disconnect must be in their own town.
4. **The game says nothing new about where a player stands.** The town shows through the world:
   the names in the scan, `whois` on the joined network's public address (`city:` and `region:`,
   or `<Town> Broadband` for a home), findit, and the town's council directory. Working out where
   you are is a small piece of reconnaissance; no banner, status-bar field or command says it.
5. **The town is drawn by weighted rendezvous hashing over every declared town, weighted by its
   network count.** Each town scores the key with its own hash scaled by its weight, and the
   highest score wins. The owner's priority is that the game can grow: new towns, villages and
   whole new regions beyond Harrow Valley. Shifting players is acceptable as the price of that. So
   the function does NOT freeze at launch. A town or region added later joins the draw the moment
   it is declared, and only its share of players moves, all of them into it. The weights are free
   to change (a new area can be weighted heavier to fill faster). When Travel ships, a player's
   stored location overrides the drawn town, so a shift only ever touches players who never
   moved.
6. **Ridgemont's 18 unlisted landmarks stay reachable only over Ridgemont WiFi until Travel.**
   Measured: of Ridgemont's 65 networks with no site, the 47 drawn ones all have a lead; the 18
   hand-written ones have none, because a landmark keeps no lead (`relations.ts`): six homes
   (`APT-3B-WIFI`, `UPSTAIRS-NEIGHBOR`, `FAMILY-WIFI-2G`, `CASA-DE-RAMIREZ`, `SUITE-401`,
   `HOUSE-OF-CARDS`), four university (`UNIV-DORM-7`, `CS-DEPT-LAB`, `GRAD-STUDENT-WIFI`,
   `LIB-2ND-FLOOR`), four IoT (`SMART-FRIDGE-NET`, `EV-CHARGER-LOT-3`, `DOORBELL-CAM-OPEN`,
   `ROBOVAC-AP`) and four hacker spaces (`DEFCON-VILLAGE`, `HACKERSPACE-2600`, `BOFH-KEEPOUT`,
   `NULL-BYTE`). The ~30% of players drawn into Ridgemont reach them; everyone else reaches them
   when Travel ships. One rule stands: an unlisted network is reached over WiFi in your own town or
   through a lead. **Backlog**: hand-written places for the other towns, declared after what each
   town draws (`procedural-world-architecture.md`, "A hand-written network in a drawn town"), so
   every town gets corners of its own; the catalog stays closed at 57, and whether each new place
   keeps leads is decided per place.

## What follows without a decision

- **The 5% chance of adding an occupied network stays inside the player's town.** A join is only
  allowed there, so an occupied network from another town would be one the player could see and
  never join.
- **The join check compares the network's town with the town drawn from the verified key**, and
  refuses with the same `403 network_not_joinable` it answers today.
- **Unchanged**: a fixed site's or an undeclared lab network's persona town (`persona.ts`); the
  help examples naming `ridgemont.edu`, since a published domain answers from every network; the
  guardian's patrol and valleynews, which already cover the whole valley; the tutorials, which
  name no network.
