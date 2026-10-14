# Plan: a web read on the LAN is served

**Status**: Slice 1 MERGED (v0.382.0, #679, 2026-10-14), and slice 2 folded into it. The
close-out browser run is all that is left. Where another doc disagrees with this file, this file
wins until the close-out moves its content into `docs/`.

## Goal

A web read of a generated box from its own network returns the page the box holds now,
the same page the internet gets. `curl`, `lynx` (including a followed link) and `gobuster`
pointed at a box the network generates (a LAN host, a host on a deep layer, or the box the
shell stands on) get the page from its journal. A box whose web server was stopped or that was
bricked answers nothing. The line it leaves in `access.log` records what was actually served.

## Where it starts from (facts, 2026-10-14)

Measured on the live stack with a throwaway probe, or read in the code on this date. Anything
marked "by reading" was not run live.

- **A LAN fetch ignores a generated box's journal entirely.** The probe planted four journal
  changes on Ridgemont University's site server (`CAMPUS-GUEST-OPEN`, `192.168.200.59`) and
  fetched `/` both ways:

  | Journal change     | Across the internet (`resolveHttpFetch`) | From its own LAN (`fetchWebPage`) |
  | ------------------ | ---------------------------------------- | --------------------------------- |
  | none               | 200, 560 bytes                           | 200, 560 bytes                    |
  | page defaced       | 200, the defaced page                    | 200, the generated page           |
  | page deleted       | 404 `not_found`                          | 200, the generated page           |
  | web server stopped | `host_unreachable`                       | 200, the generated page           |
  | box bricked        | `host_unreachable`                       | 200, the generated page           |

- **The LAN trace is just as stale.** `recordLanFetch` worked out status and size from the
  generated tree, and logged `"GET / HTTP/1.1" 200 560` in every row above, the bricked box
  included.
- **The client cannot fix it alone.** `reachWebHost` (`commands/webHost.ts`) builds the box
  with `baseFsForLanHost` / `resolveDeepScanHosts`. Since v0.374.0 `listPatches` refuses the
  journal of any box but the caller's own workstation, so the client has no journal to replay.
- **Same-LAN `nmap` already asks the server** (`resolveSameLanScan`), which replays the
  journal and checks `canBoot`. Today a player can `nmap` a bricked web host, see it down, and
  `curl` it for its page.
- **All three web tools share the stale step.** `curl`, `lynx` and the browser screen's followed
  link go through `fetchWebPage`, and `gobuster` calls `reachWebHost` directly.
- **A deep-layer host is served from its generated tree too, client and trace (by reading).**
  `resolveDeepScanHosts(...).baseFs` on both ends, with no journal.
- **The box the shell stands on is read from the served tree on the client, and from its
  generated tree in the trace (by reading).** In a shell on a generated box `curl localhost`
  reads `env.fs.root()`, the tree the server pruned to the session's tier, and
  `recordLanFetch`'s `standingBoxTarget` records the generated tree's status and size.
- **The server half already exists for a fellow occupant.** `resolveOccupantWebTarget`
  (`network/resolveOccupantFetch.ts`) is the one reach behind both `resolveOccupantFetch` and
  `resolveOccupantSweep`. It places the caller, finds the box, replays its journal, checks it
  boots and checks the port against what the box answers to the network. It answers
  `host_unreachable` when no occupant holds the address.
- **`generatedLanBox` (`network/generatedLanBox.ts`) already serves a generated LAN host with
  its journal replayed and a brick treated as absent.** The internet path uses it.

## Decisions (owner-confirmed 2026-10-14)

1. **The server serves every LAN web read of a box that is not the player's own workstation.**
   This covers a generated LAN host, a host on a deep layer, and the box a shell stands on
   (loopback or its own address). The way `nmap` and a fellow occupant's fetch already work.
   One round trip serves the page from the replayed journal and writes the trace, so the page
   and the line cannot disagree. Rejected: having the client replay a journal, which it no
   longer receives.
2. **Every journal effect counts, not only a changed page.** A deleted page is a 404, a stopped
   web server refuses, a bricked box answers nothing, and a port the box filters refuses, as
   the scan shows it.
3. **`curl`, `lynx` and `gobuster` all move, in one PR.** First planned as two PRs, the fetch then
   the sweep. Folded into one (owner-confirmed 2026-10-14) once slice 1 showed the three tools
   share one client reach (`reachWebHost`) and one server reach (`resolveOccupantWebTarget`):
   moving the fetch alone would have meant a second copy of the reach.
4. **`recordLanFetch` keeps only the player's own workstation.** That is the one box the client
   still serves from its live tree. Its generated-host, deep-layer and standing-box arms go with
   slice 1, and the sweep's own use of it goes with slice 2.

## Slices

### Slice 1: a page on a generated box is served from its journal — MERGED (v0.382.0, #679)

As built: everything below, plus `gobuster` (slice 2) and two things the diff review and the
mutation gate found. A shell on the access point's own gateway is found by
`networkBaseFsForMachineId` over loopback, since no LAN walk holds the gateway. A shell on a deep
box fetching its own address is served past the switch in front, which also closed the backlog
item on that box being served but not traced. Wire-check `scripts/testLanWebServed.ts` 10/10
(2/10 on the old code). Mutation: `resolveOccupantFetch.ts` 175 killed, 4 survived (all
equivalent), 0 timeouts.

- `resolveOccupantWebTarget` falls back, when no occupant holds the address, to the box the
  network generates there: a LAN host through `generatedLanBox`, a host on a deep layer the
  caller reaches (through the switch's live ACL, as `recordLanFetch` reads it now), or, for
  loopback or a shell on a generated box, the box the shell stands on. Each is replayed from
  its journal, `canBoot`-checked, and answers on the port it serves to the caller. Its log is
  filed under the network's key (`apGatewayLogWriterKey`), as today.
- `reachWebHost` resolves locally only the player's own workstation at home (loopback or its
  own leased address). Everything else is `unresolved` and goes to the server, the path a
  fellow occupant's address already takes.
- `recordLanFetch` loses its generated, deep and standing-box arms.
- RED first: a unit test for each journal effect in the probe table, through
  `handleResolveOccupantFetch`, plus a deep host and a standing box. Then client tests showing
  `curl`/`lynx` ask the server for a generated host.
- Wire-check: a new `scripts/testLanWebServed.ts` reproduces the probe's table (it must fail on
  `main` first) plus a deep host. Re-run `testLanFetchLog.ts`, `testOccupantFetch.ts` and
  `testOccupantSweep.ts`, and move any `testLanFetchLog.ts` checks that covered the deleted arms
  into the new script.

### Slice 2: a sweep of a generated box is served from its journal — FOLDED INTO SLICE 1

- `gobuster` takes the same `unresolved` → `sweepOccupant` route for a generated box. The server
  reach is already shared, so this slice is client routing plus its tests, and the sweep's last
  use of `recordLanFetch`'s generated arms.
- Wire-check: extend `testLanWebServed.ts` with a sweep of a defaced and a bricked box.

### Close-out

One browser run on two players covering both slices: deface a generated site server from a root
shell, then `curl`, `lynx` and `gobuster` it from the LAN and from across the internet. Move the
as-built into `cross-player-architecture.md` / `discovery-architecture.md`, close the
`backlog.md` entry, update `project-status.md` and handbook chapter 14 footnote ³, and delete
this file.

## Carried risks

- A generated box answers on the LAN one round trip later than it did. `nmap` already pays it.
- Renaming `resolveOccupantFetch` / `resolveOccupantSweep` once they serve more than occupants
  is a refactor to weigh after green, not part of the RED.
