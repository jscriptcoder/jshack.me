# Plan: a contract whose key box sits behind a front box

**Status:** Grilled and planned 2026-11-09, four slices. Slice 1 is in review on
`refactor/mission-box-records`.

A second contract template. Today every contract's key box is reached straight through the
gateway's forwards. In this one the gateway forwards only to a **front box**; the key box has no
forward and is reached from inside, by a player standing on the front box. It is the backlog's
"more hops" item under "missions — deferred" in `docs/backlog.md`. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

1. **Pivot in (2026-11-09).** The gateway forwards only to a front box, which falls to one of
   today's routes. The key box has no forward: the player stands on the front box, scans its LAN
   and works a second way in from there. Storage (`file`, `gpg`, `database`) applies to the key box
   as it does today. Rejected: the passphrase on a third box behind the key box (it touches only gpg
   contracts, a third of them, so it is a twist for later, not a template); both at once (three boxes
   deep before the first hop is known to be fun). Deep chains (inner gateway → L2, switches) stay a
   later template of their own.

2. **The key box falls to a second route, worked from inside (2026-11-09).** The front box draws a
   route from today's six, and the key box draws its own from the same six on a stream of its own.
   The key box's doors are reached over the LAN instead of through a forward; the routes, their
   files and their proofs are otherwise today's. Every route roots the box it lands on, so the front
   box always ends rooted and `apt install` works there. Rejected for now: a lead on the front box
   (the key box's root word in a deploy script, `.bash_history` or a cron line), which would be a new
   route kind; it can join later as a seventh inside route, as the leak routes joined the six.
   There is no key-based ssh login in the game, so "an ssh key on the front box" was not an option
   without a new login mechanic.

3. **Two-hop is drawn from the number, one contract in three (2026-11-09),** on a stream of its own,
   so a contract's shape stays a function of its number, computable offline, and no single-hop
   contract's route, hashes, key or storage moves. An accepted contract that lands in the share turns
   two-hop (its key box loses its forward, a front box appears), which costs nothing while prod has
   only test players. Rejected: choosing the template at posting and storing it (every door would
   need a table read, and the client's generator could no longer work out the shape); two-hop for
   new numbers only (needs the same stored fact).

4. **The board says so; the briefing says only "inside" (2026-11-09).** A two-hop offer names its own
   kind in the line's kind slot, `retrieve an internal access key`, so the player chooses the harder
   job knowingly and its pay makes sense. The briefing adds one sentence: the key is on a machine
   inside their network, not on the edge. It never says pivot, front box, how many machines, the
   route or the key box's address; working out what "inside" means is the job. Rejected: hiding the
   template (its own pay range would tell anyway, so it would be a tell, not a secret).

5. **A two-hop job pays 2,000–4,000 JSC (2026-11-09),** rounded to 50 and drawn from the number as
   today's is. No overlap with the single-hop 500–2,000, so harder work always pays more. Rejected:
   an overlapping 1,500–3,500; single-hop pay doubled.

6. **The key box blurs an inside scan with decoys (2026-11-09).** From outside, the gateway forwards
   to the front box with today's route-plus-decoys rule, so a two-hop contract's public scan reads
   like a single-hop one. Inside, the key box runs extra daemons from the four non-ssh kinds (web,
   ftp, mysql, snmp), each the real door's generated build with nothing laid in, on safe releases:
   **2 or 3 service doors besides `22`**, the real ones (the route's, `3306` on database storage)
   first and decoys filling the gap. sshd always runs, so ssh is never an inside decoy. Rejected:
   no inside decoys, which would make the second hop a free read after a first that made the player
   work.

7. **Three boxes, no filler (2026-11-09):** the gateway, the front box and the key box, named on the
   target stem as today (`halden-web`, `halden-files`). An inside scan shows one host besides the
   gateway and the front box; finding the key box is not the job, working its route from a hop is.
   Filler boxes (a workstation, a printer) to rule out belong with "believable filler behind the
   doors" in `docs/backlog.md`, where a business's network is dressed as a whole: they are a new
   content generator with their own "nothing climbs" proof, and they test triage, not pivoting.

8. **Any shell on the front box is a foothold (2026-11-09).** The front box's `guest` and NPC user
   keep the world's odds, as today's key box does, so a player can often `hydra` a guest shell
   through `:2222` without working the front route. From it the stock tools (`ifconfig`, `ping`,
   `curl`, `ssh`, `scp`) reach the key box; everything else needs `apt`, so root on the front box in
   practice. One rule, no carve-out: tier decides what a shell can do, as everywhere. Rejected: the
   key box answering only a root on the front box (an access rule that exists nowhere else); shutting
   the front box's guest and user (a carve-out from the world's odds).

## Given, not chosen

What the decisions above force, recorded so the plan does not re-open them:

- **The two route draws are independent**, so a contract can draw the same route twice (web then
  web), and the two boxes' words can coincide. No rule against either.
- **Outside, the front box takes today's key box's place** in the forward and decoy rules. On
  database storage the `3306` door is the key box's and is reached inside, so the gateway's real
  forwards are the front route's alone (1–2), and decoys fill to 3 or 4 as today.
- **Inside, a route's door is the key box's own port**: the hydra route is its `:22`, and a leak
  route's word logs in with `ssh root@<key box>` on `22`, not `-p 2222`.
- **The front box holds no key, no storage and no lead**, and is built by the mission builder with
  every non-route package on a safe release, as the key box is. Nothing but the two routes climbs.
- **Closing a hop is as today**: whoever roots the front box can `passwd` or `apt upgrade` it and
  close the pivot for the next visitor. The guardian never touches a mission box.
- **`hireme.ts show`** prints the template, both boxes' routes and services (decoys tagged), the
  storage and the key, as it does for one box today.

## Where one box is assumed today (found 2026-11-09)

Everything that knows the key box assumes it is the only machine behind the gateway:

- `src/core/missions/missionShape.ts`: the key box is a set of top-level fields (`keyBoxOctet`,
  `route`, `keyBoxRootHash`, `keyBoxDatabase`, `keyBoxCommunityHash`, `keyBoxServices`,
  `keyBoxVersions`, `decoys`), and `forwards` are the gateway's onto it. Streams:
  `mission-shape-<n>` (stem, key-box octet, route), `mission-versions-<n>`, `mission-storage-<n>`,
  `mission-decoys-<n>`.
- `src/core/generation/generateHomeLan.ts` `missionLan`: two hosts, the gateway and
  `<stem>-files`, redrawing the stem and octet off `mission-shape-<n>`.
- `src/core/generation/lanHostIdentity.ts`: `baseFsForLanHost` gives every mission machine
  `buildMissionKeyBoxFs(n)`; `missionKeyBoxNumber` takes the first `machine` host as the key box.
  The server's lay-in (`missionFilesForBox`, `missionLeak.ts`) and the write gate
  (`missionFilePathsOf`, `api/patches.ts`) both go through it.
- `src/core/missions/missionLeak.ts`: every function is keyed by the number alone and reads
  `missionShape(n).route`, `.storage` and `.keyBoxRootHash`: the forgotten file
  (`mission-leak-<n>`), the datadir, `snmpd.conf`, the key files.
- `src/core/generation/routerFs.ts` `missionGatewayFs`: every forward onto `keyBoxOctet`.
- `src/core/missions/hiremeOrders.ts` `showReport`: one route, `-> key box`, one service list.
- `src/core/missions/missionTerms.ts`: `KIND` is a constant; pay 500–2,000 off
  `mission-terms-<n>`. The briefing is `briefingOf` in `src/core/hireme/contracts.ts`.
- **Pinned numbers:** `src/test/factories/{web,database,snmp}RouteContract.ts` search for the
  first number with a route, and six wire-checks (`testMissions`, `testMissionLeak`,
  `testMissionFtp`, `testMissionMysql`, `testMissionSnmp`, `testMissionDecoys`) pin or search
  numbers. About one in three will land in the two-hop share; each search gains "and
  single-hop", and a pinned number that turns two-hop is re-picked.
- **The inside doors are already server-side and lay files** for a LAN target: a web fetch from a
  hop goes through `handleResolveOccupantFetch`, a read through `handleResolveCrossPlayerFs`, and
  the database and SNMP doors take `findMissionFiles`. But no mission box has ever been reached
  from ANOTHER mission box, since the gateway was the only other host. That path is the carried
  risk, and slice 2 measures it first (below).

---

## Slices

Four slices, one PR each, merged in order. The browser run waits for the close-out after slice 4.

### Slice 1 — a contract's boxes become records (pure refactor)

**Value:** slice 2 needs a second box with its own route, hashes, services and lay-in. Reshaping
first keeps slice 2's diff to new behavior, and every existing test and the nine mission
wire-checks prove nothing moved.
**Class:** pure refactor, no version bump. **Branch:** `refactor/mission-box-records`.

- `missionShape` groups the key box's fields into one `MissionBox` record (`octet`, `route`,
  `rootHash`, `database`, `communityHash`, `services`, `versions`, `decoys`) under `keyBox`, and
  the gateway's `forwards` say which box they reach. Same streams, same draw order.
- `missionKeyBoxNumber` becomes `missionBoxAt(essid, machineId)`, answering the number and the
  box's role, found by octet rather than "the first machine".
- `missionLeak.ts`, `missionKeyBoxFs.ts`, `routerFs.ts` and `showReport` read the box record they
  are given, not `missionShape(n)`'s top level.

**Preservation evidence:** the full suite, changed only by field renames in assertions;
`missionShape` over 2,000 numbers deep-equals a fixture captured from `main` before the change
(captured, compared, then deleted in the same PR, so it never pins the shape for good); all nine
mission wire-checks green against `vercel dev`. Mutation gate N/A (no behavior change); the
existing mutation-killing tests cover the moved code.

**As built (2026-11-09), narrower than drafted above.** The shape and the two lookups changed; the
readers did not take a box parameter:

- `MissionShape` holds `keyBox: MissionBox`, and each `MissionForward` carries the `boxOctet` it
  reaches. `missionGatewayFs` points each forward at its own `boxOctet`.
- `missionKeyBoxNumber` kept its name and its number-only answer. It now finds the key box at
  `keyBox.octet` instead of taking the first machine, and so does the database builder in
  `missionKeyBoxFs.ts`. A `missionBoxAt` answering a role would have had one role and no caller
  for it.
- `missionLeak.ts`, `buildMissionKeyBoxFs` and `showReport` still take the number and read
  `missionShape(n).keyBox`. Passing a box into them would have changed about a hundred test call
  sites in a refactor that was meant to change only field names. **Slice 2 adds the box
  parameter** where the front box first needs its own files, under its own failing tests.
- Evidence: 1,977 contract numbers matched a fixture captured from `main`. The fixture covered
  the shape (projected back to its old layout), a hash of each key box's and gateway's tree,
  `missionFilePaths`, and which host each lookup answered. The fixture lived in the scratchpad
  and was never committed. One test changed beyond renames: the sweep in "draws each contract
  its own application" now skips numbers that are not contracts. Before the change it built a
  "key box" for number 255 off an ordinary town host.

### Slice 2 — one contract in three puts its key box behind a front box (v0.450.0)

**Value:** a contractor on a two-hop contract finds the key box unreachable from outside, roots a
front box, and works the key box's route from it to the key and the pay.
**Class:** behavior change. **Branch:** `feat/mission-front-box`.

**Acceptance criteria**

- A number is two-hop about one time in three, drawn on `mission-template-<n>`. For every
  single-hop number the shape is exactly what it was (a sample deep-equals slice 1's).
- On a two-hop number the LAN holds three hosts: the gateway at `.1`, the key box at its octet as
  today (`<stem>-files`), and a front box at an octet of its own (`<stem>-web`), drawn on
  `mission-front-<n>`.
- The key box keeps today's route, root hash, storage, key and key path; it loses its forwards
  and its decoys.
- The front box draws its own route from the six and its own versions and hashes on
  `mission-front-<n>`; holds no key, no storage and no sealing history; runs sshd. Its `guest`
  and NPC user keep the world's odds, as the key box's do.
- The gateway forwards only onto the front box: the front route's forwards, then decoys on
  `mission-decoys-<n>` filling to 3 or 4, as today. No `3306` forward on database storage: that
  door is the key box's, reached inside.
- Nothing but the two routes climbs: the 2,000-number test covers the front box, the key box and
  the gateway on every day.
- The server lays each box's files on that box alone: the front route's leak (if any) on the
  front box, keyed to the front box's root word and a forgotten-file draw of its own; the key
  box's leak and key files on the key box. The write gate lists each box's paths for that box.
- From a root shell on the front box: `apt install` the route's tools, `nmap` of the LAN finds
  the key box and its doors, and the key box's route works over the LAN on its own ports (hydra
  on `:22`; a leak word logs in with `ssh root@<key box>`), for every route.
- `hireme.ts show` prints the template and both boxes (route, services with decoys tagged, and
  each leak route's file and word), the forwards naming the box they reach, the storage and the
  key.
- The client generator and the server agree on all three boxes for every number.

**TDD order (RED first, each at its public surface)**

1. `missionShape`: the template share over a sample; single-hop numbers unchanged.
2. `missionShape`: a two-hop number's front box (route, hashes, services), key box (no forwards,
   no decoys), forwards onto the front box only, decoys counted above the front's.
3. `generateHomeLan` and `baseFsForLanHost`: three hosts, each box built from its own record.
4. `missionBoxAt`: each box's role; the gateway and ordinary boxes null.
5. `missionFiles` per box: the front box gets its leak and no key; the key box its key and leak.
   `missionFilePaths` likewise.
6. The 2,000-number climb test over both boxes.
7. `showReport` for a two-hop number.
8. Factories and pinned wire-check numbers move to single-hop where they landed two-hop.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling for the shape's growth).
- Wire-check `scripts/testMissionTwoHop.ts` (new), staging numbers with `hireme.ts accept
  --number`: the key box absent from a public scan; the front route worked to a root shell; from
  it, `nmap` of the LAN, and the key box's route worked from the hop for every route; the key
  read and paid once; the key box's `auth.log` naming the front box's LAN address. The nine
  existing mission wire-checks re-run green.
- Mutation gate on the changed lines of `missionShape.ts`, `missionLeak.ts`,
  `lanHostIdentity.ts`, `generateHomeLan.ts` and `hiremeOrders.ts`.
- v0.450.0 in `package.json` and `package-lock.json`.

**Carried risk:** an inside door that works for an ordinary LAN host may not pass
`findMissionFiles` for a mission box reached from a hop, or may refuse a mission ESSID on a
LAN-side path. Measure first: before slice 2's RED, stage one two-hop number with a throwaway
script and try each route's door from the front box. A door that refuses is fixed inside this
slice if the fix is small; if it is large, it becomes its own slice ahead of this one, and the
plan changes with the owner's approval.

### Slice 3 — the key box blurs an inside scan (v0.451.0)

**Value:** from the front box, a scan of the key box no longer tells its route.
**Class:** behavior change. **Branch:** `feat/mission-inside-decoys`.

**Acceptance criteria**

- On every two-hop number the key box runs **2 or 3 service doors besides `22`**, about half
  each: the real ones (the route's door on a leak or msfconsole route, `3306` on database
  storage) first, inside decoys from `web`, `ftp`, `mysql` and `snmp` filling the gap, no kind
  twice, never one it already runs. Drawn on `mission-inside-decoys-<n>`, so nothing slice 2 drew
  moves.
- Each inside decoy is the real door's generated build with nothing laid in, on a safe release,
  as an outside decoy's daemon is (mysql's root and snmp's read-write community from
  `SHUT_HASHES`).
- Every route reaches both counts where its real doors allow (a hydra key box always takes 2–3
  decoys; a leak route on database storage 0–1).
- Single-hop contracts and the front box are unchanged.
- `show` tags inside decoys `(decoy)`.

**Gates:** the usual; `testMissionTwoHop.ts` gains a key box whose inside decoys are worked to
their empty ends before its route pays; mutation on the changed lines; v0.451.0.

### Slice 4 — the board names a two-hop job and pays more for it (v0.452.0)

**Value:** a contractor sees which offers are two-hop, is paid 2,000–4,000 JSC for one, and is
told only that the key is inside.
**Class:** behavior change. **Branch:** `feat/mission-two-hop-terms`.

**Acceptance criteria**

- A two-hop offer's line reads `<Client> — retrieve an internal access key — <pay>`; a
  single-hop offer's is unchanged.
- A two-hop job pays 2,000–4,000 JSC rounded to 50, drawn from the number; single-hop pay is
  unchanged for every number.
- The two-hop briefing carries one more sentence: the key is on a machine inside their network,
  not on the edge. It names no box, route, count of machines or address but the contract's. A
  single-hop briefing is unchanged.
- The client's reply mints the two-hop pay, once.
- `/etc/hireme/contracts` and `show` print the two-hop pay.

**Gates:** the usual; `testMissionBoard` and `testMissionPay` gain a two-hop offer and payout;
mutation on the changed lines; v0.452.0.

### Close-out (after slice 4)

One browser run on a fresh player: accept a two-hop offer from the board, scan the address (the
front box's doors only), root the front box, install tools there, scan the LAN, work the key
box's route from the hop past its inside decoys, read the key, mail it and be paid in the two-hop
range once. Then the docs: `missions-architecture.md` gains a "Two hops" section and its "To add
a route" notes the second box; `backlog.md` takes the item out of "missions — deferred", leaving
the passphrase on a third box, a lead on the front box and deep chains there; `project-status.md`
gains the shipped item. The plan is retired.
