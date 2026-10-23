# Plan: players start in different towns

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-23. Slice 1 is planned;
its choices and acceptance criteria await the owner's confirmation.
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

## Slices

1. **Players start in different towns.** One slice: the town drawn from the key, the WiFi scan
   drawn from that town, the join checked against it, the wire-checks and the browser runbook
   keyed to a town, and the docs. It does not split usefully: the town function alone changes
   nothing a player sees, and the moment the join check moves, every wire-check that joins a
   Ridgemont network with a random key starts failing about 70% of the time, so the check and
   the scripts land together.

## Slice 1 plan: players start in different towns

**Branch**: `feat/starting-towns` · **Version**: 0.427.0 → 0.428.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration.

**Value.** A new player's `airodump-ng` shows the networks of the town their key draws, any of
the 11, in proportion to the town's size. `nmcli connect` joins a network of that town and is
refused for any other. A network is about equally likely to have company wherever it stands, and
the room players share is 584 networks instead of 178.

**Path.** signup makes a key → `startingTown(publicKeyHex)` (pure, on client and server) →
`generateWifi` draws the base networks and the 5% occupied one from that town's networks →
`airodump-ng` prints them → `aircrack-ng` cracks one → `nmcli connect` → `/api/network`
`registerNetwork` → `handleRegisterNetwork` admits the network only when its town is the one the
verified key draws, otherwise `403 network_not_joinable` with no lease or occupant row written.

### Facts read while planning (2026-10-23)

- **The scan is drawn on the client** from `identity.publicKeyHex` (`ui/state.ts`, two
  `generateWifi` calls), and the server's verified key is the same 64-hex public key
  (`signedRequest/verify.ts` returns the envelope's `publicKey`). One function of that string
  answers both sides.
- **`crackableEssidPool` is exported** and read by `generateWifi` and two test factories
  (`src/test/factories/lanDatabase.ts`, `lanStore.ts`), which search it for a network with a
  database or a store.
- **Tests that pin Ridgemont**: `generateWifi.test.ts` (it draws from Ridgemont's 178, a pinned
  draw for one identity, "offers only networks in the town the player stands in", the occupied
  network "surfaces only from Ridgemont"); `registerNetwork.test.ts` (all 178 Ridgemont keys
  admitted, every other town's refused).
- **38 wire-checks join a network; about 32 join a declared one** with a fresh
  `generateIdentity()` key: Ridgemont landmarks by name (`BEAN-THERE-WIFI`, `ABSTERGO-NET`,
  `CAMPUS-GUEST-OPEN`, `UPSTAIRS-NEIGHBOR`, `APT-3B-WIFI`, …) or a network the world names
  (`crackableEssidPool[0]`, a publisher's key). The other six join undeclared lab networks, which
  `JSHACK_ADMIT_LAB_NETWORKS=1` admits whatever the town. `scripts/testJoinRefusal.ts` already
  checks a Ridgemont join admitted and another town's refused.
- **The browser runbook assumes Ridgemont**: `e2e/references/reaching-a-state.md` names Ridgemont
  WPA2 rows to crack (`SHINRA-5G`, `ACME-CORP`, …), and `two-players.md` puts two fresh players on
  one network. Two fresh browser players draw the same town only about 18% of the time (the sum
  of the squared town shares).
- **Text that says everybody stands in Ridgemont**: `world.ts` (header, `RIDGEMONT`'s comment),
  `generateWifi.ts` (header and pool comment), `registerNetwork.ts` (the join comment),
  `persona.ts` (an undeclared network "stands where everybody who could have joined it stands"),
  `docs/procedural-world-architecture.md` ("Joining"), `docs/discovery-architecture.md` (homes
  "outside Ridgemont" have no WiFi), `docs/backlog.md` ("Travel"), `docs/project-status.md`.

### Choices made while planning (to confirm with the owner)

- **`startingTown(publicKeyHex)` lives in its own module**, `core/generation/startingTown.ts`. It
  walks `TOWNS`, weights each by how many declared networks stand in it, and returns the town with
  the highest weighted rendezvous score (each town's score from `createPrng`, seeded by the key
  and the town's name). It is the only new production function.
- **`generateWifi` asks `startingTown` itself** from the `seedPubkeyHex` it already takes, so no
  caller changes. `crackableEssidPool` becomes `wifiPoolOf(town)`: the town's networks in
  declaration order, which for Ridgemont is exactly today's pool.
- **The join check stays one line**: `network.town === startingTown(publicKey)`. Undeclared
  networks keep their lab flag.
- **Wire-checks get `generateIdentityIn(town)`** in `src/test/` (scripts already import
  `src/test/passwords.ts`): it makes keys until one draws the town, about 3 tries for Ridgemont.
  Every wire-check that joins a declared network swaps `generateIdentity()` for
  `generateIdentityIn(RIDGEMONT)` on each identity that joins; nothing else in them changes.
  `testJoinRefusal.ts` gains the new cases: a key drawn into another town is admitted to a
  network there and refused for a Ridgemont one.
- **The browser runbook** says a fresh player stands in the town its key draws, and how to read
  it: the key from `localStorage`'s `jshack.identity`, then `startingTown` offline. For two players
  on one network, the second is signed up again until the towns match (about 1 try in 5).
- **Docs**: the "Joining" section and header of `procedural-world-architecture.md` take the
  decisions (this file's content moves there at close-out); `discovery-architecture.md`'s homes
  line becomes "outside the town you stand in"; the Travel backlog item notes its first half
  shipped, and the hand-written places for other towns are added (decision 6); the comments listed
  above; `project-status.md`.
- **Existing players are left where their keys draw them.** After the deploy, `kestrel` and
  `jshacker` stay on QUEEN-STREET-HARDWARE through reloads. If the owner wants Claude's player in
  their town again, a new `kestrel` is signed up until its town matches theirs (a close-out step,
  the owner's call).

### Acceptance criteria

1. The same key always draws the same town, on the client and on the server.
2. Over many keys, each town's share of players is within a few points of its share of the 584
   networks, and a network in no town is never a starting place.
3. Appending a town moves only players into that town: every key that does not draw the new town
   keeps the town it had.
4. A player's scan shows only networks of their town, homes included, 2–3 crackable per scan as
   today. For a key that draws Ridgemont, the scan is exactly what it is today.
5. The occupied network a scan may add is only ever one of the player's own town.
6. `nmcli connect` to a network of the player's town is admitted with a lease and an occupant row.
   To a network of any other town, or one in no town, it is refused `403 network_not_joinable` and
   writes nothing. Lab networks are admitted only with the flag, as today.
7. Every wire-check that passed before passes after.
8. A reload keeps the network a player is on, whatever their town.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **`startingTown`**: determinism, the weighted shares, placeless networks never drawn, and an
   appended town moving only its share; criteria 1–3.
2. **The scan from the player's town**: `wifiPoolOf(town)` and `generateWifi` through it, the
   occupied network from the same town, Ridgemont keys unchanged; criteria 4 and 5.
3. **The join check**: `registerNetwork.test.ts` over towns; criterion 6 at the handler.
4. **Wire-checks**: `generateIdentityIn`, the swap in each joining script, and the new
   `testJoinRefusal.ts` cases; criteria 6 and 7 live.
5. **Runbook, docs and version 0.428.0**: the e2e references, the docs and comments listed above,
   `package.json` and `package-lock.json`.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Every joining wire-check run against `vercel dev` + local supabase (the ~32 changed and the new
  `testJoinRefusal.ts` cases).
- Mutation gate at PR readiness over `startingTown.ts`, `generateWifi.ts` and the join check.
- One browser run at close-out: a fresh local player's scan shows their town's networks, they
  join one, `whois` on its address names the town, and a reload keeps them on it (criterion 8).
