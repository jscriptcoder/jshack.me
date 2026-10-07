# Plan: Operate from a hop

**Status**: Grilled and gap-reviewed. Decisions confirmed by the owner 2026-10-04 (grill, then a
`find-gaps` pass that added 4a, 4b, 7a, 11a, "Out of scope" and "Done when"); nine slices
planned and approved the same day. Slices 1–5, 6a–6c, 7, 8a, 8b and 8c done (#598 v0.307.0,
#599 v0.308.0, #600 v0.309.0, #601 v0.310.0, #602 v0.311.0, #603 v0.312.0, #604 v0.313.0,
#605 v0.314.0, #606 v0.315.0, #607 v0.316.0, #608 v0.317.0, #610 v0.318.0, #611 v0.319.0,
#612 v0.320.0, #613 v0.321.0, #614 v0.322.0). Slice 9 split in three (2026-10-06), then 9a split
again into ftp+scp (#612) and `nc` (#613). Next: slice 9c (apt from a hop, and the done-when
enumeration test).
Resolves two §9 backlog items in `docs/conventions-and-gotchas.md`: "Pivot / operate-from-a-hop —
source-IP masking only; ssh-from-a-pivot" and "Four tools cannot pivot: `ssh`, `nmap`, `curl`,
`lynx`". Where they disagree with this file, this file wins.

## Goal

A shell on a box is a place to stand. Every network command run inside it travels from that box:
it reaches what that box's network reaches and is logged under that box's address. A player can
chain hops (home → A → B → C) and attack D from C, so D's logs name C, not them. A defender can
follow the trail back one hop at a time by breaking into each hop and reading its `auth.log`, and
an attacker who holds root on a hop can cut the trail there by wiping its logs.

## Out of scope

- **Jump verbs** (`ssh -J`, a proxychains config) — nested `ssh` only (11).
- **Player command history on hops** (`.bash_history`) — no forward trail (15).
- **WiFi from a hop** — radio stays with the player's own card (2); travel is the world's
  separate deferred item.
- **Defender verbs** (`who`, `w`, `last`, a connection table) — trace-back uses `auth.log` and
  `whois` only (15).
- **Log integrity** — no tamper detection, signing or remote log shipping; a stuck wipe leaves
  no trace of itself (cross-player decision 7, 12).
- **Per-leg latency** — a chain adds no delay of its own; `ping` simply runs from the hop (2).
- **`scp` remote-to-remote** — stays in §9 as it is.
- **Missions** — the missions epic consumes this feature; no mission content here.

## Where it starts from (facts, 2026-10-04)

- **Only the filesystem follows the session.** `ls`/`cat` act on the session's machine, but every
  network command reads reachability and source address from the player's own `wlan0`
  (`ssh.ts:257-267`, `networkView` in `ui/env.ts` reads home connectivity). From a shell on a
  Ridgemont office box, `ssh 192.168.1.5` lands on a host on the player's HOME LAN.
- **`hydra` and `gobuster` half-pivot.** They send `callerMachineId`, and the server traces them
  to the session's network (`resolveVantageSourceIp`, `standingEssid` from the session row), but
  their reachability is still decided from home. Their log line names an origin the traffic never
  used. `ftp`, `nc` and `scp` also send `callerMachineId`; `ssh`, `nmap`, `curl` and `lynx` send
  none and trace to the actor's home.
- **The client-side pivot-aware resolver is ported but unwired** (`core/logging/sourceIp.ts`,
  `resolveLogSourceIP`). The server side is shaped for the change
  (`core/logging/crossPlayerSourceIp.ts`).
- **One narrow vantage already exists:** `nmap` from a shell on a gateway that fronts a deep layer
  of the home network scans that layer (`pivotVantageForMachineId`, `nmapScanDeep`).
- **The chain already persists.** Each `ssh` pushes a session row with `parent_session_id`; the
  stack is rebuilt from the server on reload (`rehydrateSessionStack`).
- **Tools belong to the box.** A command runs only if its binary exists on the current machine
  (`commands/availability.ts`); `apt install` needs root on that box.
- **Logs of ownerless boxes accrete under the network's key** (`ap:<essid>`,
  `apGatewayLogWriter.ts`), so every visitor reads the same `auth.log` — trace-back works by
  construction.
- **A wipe by a non-owner does not stick (measured 2026-10-04, `scripts/testLogWipeSticks.ts`,
  9/11).** A clear or `rm` of a log is written under the WIPER's key. The next system append
  (`appendMachineLog`) reads the LOG WRITER's own row, which still holds the old lines, appends,
  and upserts it as the newest row, so the wiped lines come back. Live, on `TYRELL-CORP`'s
  ownerless gateway: B's root truncate and B's root `rm` each read back as empty/absent at once —
  the player is shown a wipe that worked — and the next failed login from C brought back B's
  `Accepted … from <B's address>` line both times. The same mechanism holds for B wiping A's log
  on A's box (not run). This contradicts the locked cross-player decision 7, "root can clear
  logs".
- **The world already invites hopping.** Relations (a contractor's ssh shortcut, an offsite backup
  job, a head office's shortcut to its branch) put another network's public address on a box;
  `whois` turns any address in a log into network, organisation and town.

## Decisions (owner-confirmed 2026-10-04)

### The vantage

1. **Full vantage switch, lateral movement included.** In a shell on box X on network N, network
   commands run from X: reachability is N's (N's private LAN, its gateway chain, the public
   internet), and the source address is X's. Trace-only masking (reachability left at home) was
   rejected: it writes a false origin into the defender's only evidence. Accepted consequence: a
   shell on one office box opens that office's whole LAN to `nmap`/`ssh`, which today is reachable
   only through its gateway's forwards.
2. **Radio stays with the body; IP follows the shell.** `airmon-ng`, `airodump-ng`,
   `aircrack-ng` and `nmcli` always act on the player's own WiFi card. Every IP tool runs from the
   current box: `ssh`, `scp`, `ftp`, `nc`, `nmap`, `ping`, `curl`, `lynx`, `gobuster`, `hydra`,
   `mysql`, `redis-cli`, `snmpwalk`, `snmpset`, `msfconsole`, `apt`, `dig`, `nslookup`. `whois`
   stays vantage-free: a registry lookup reveals nothing location-dependent.
3. **One rule for every IP tool, no permanent carve-outs.** Delivery may be sliced, but the feature
   is not complete while any IP tool runs from home inside a remote shell.
4. **Any box a player holds a shell on is a hop**: own-LAN NPC hosts, inner and deep gateways and
   the hosts behind them, foreign NPC boxes, another player's workstation or router, a same-WiFi
   occupant. The only limit is what is installed on the hop.

   4a. **Hopping through another player's box frames them, by design.** A trace left from a
   player's box names that player's address, and `whois` names their network. The framed player
   holds the evidence that clears them — the intruder's login line in their own `auth.log` —
   unless the intruder held root there and wiped it, the same trade-off as on any hop (12); and
   the remedy of a reboot (11a). Player boxes get no carve-out from decision 4.

   4b. **The vantage is the machine of the session on top of the terminal's stack.** An `ftp`
   prompt or a one-shot `scp` runs no commands and is never a vantage; `su` changes the user,
   not the box, so it does not move the vantage. Each `xterm` boots on the player's own
   workstation with its own stack (`commands/xterm.ts`), so each terminal has its own vantage.
5. **Home is just another network once the player leaves it.** From a foreign hop the home LAN's
   private addresses are unreachable; home is reached by its public address like anyone else's.
6. **The vantage is derived on the server from the session row, never from a client claim.** Each
   IP tool sends the box it runs on (`callerMachineId`); the server reads that session's network
   and machine and decides reachability and source address. With no session (at home), behaviour
   is unchanged — so `curl` still needs no session from home and gains a caller only when the
   player stands somewhere. This closes the backlog's open `curl` contract question.
7. **One source-address rule, always server-derived:** a target inside the hop's network → the
   hop's LAN address; a target outside it → the network's public address; each NAT boundary
   crossed → the gateway's address on the far side, as deep layers already do. This retires the
   own-LAN path that trusts the client's `sourceIp`: home-LAN NPC boxes are ESSID-shared, so their
   logs are other players' evidence too. Most expensive decision — own-LAN logins and scans move
   from client-side resolution to the server. A hop on an undeclared (lab) network traces as
   `unknown`; only local wire-checks can stand on one.

   7a. **One log row per box.** Every system-appended log on a box no player owns accretes
   under its network's key (`ap:<essid>`), whichever way the box was reached — from outside
   through a forward, or from inside its LAN (the home LAN's NPC hosts included, which today
   write under the caller's own key, `authCreateSession.ts`). A player-owned box keeps its
   owner's key. Two writer keys on one log path fold to the last writer and erase the other's
   lines, which would break both trace-back and decision 12.
8. **DNS follows the vantage.** `.lan` names resolve against the network the player stands on, in
   `dig`/`nslookup` and in every tool's name-to-address step.
9. **`ifconfig` on a hop shows the hop's interface and LAN address** — the player's readout of
   where they stand.
10. **The deep-layer `nmap` pivot becomes an instance of the general vantage.**
    `pivotVantageForMachineId` and the `nmapScanDeep` special path fold into it rather than
    running beside it.

### Building a chain

11. **Nested `ssh` only.** A chain is built by hand, one login per leg, typing each hop's password;
    the session stack is the saved chain, survives reload, and `exit` steps back one hop to the
    previous vantage. No jump verb (`ssh -J`, proxychains) — it would need a store of hop
    passwords and adds no capability. Revisit only if rebuilding chains proves tedious in play.

    11a. **A chain breaks where a hop goes down, and nowhere else.** When a session ends for a
    reason the player did not choose (`rebooted`, or the box going dark), every session stacked
    above it through that hop ends too, server-side, with a new `end_reason` `upstream_lost`
    that no client may name. The terminal returns the player to the deepest surviving hop,
    printing `Connection to <host> closed by remote host.` per closed leg; rehydration applies
    the same rule, so a session whose parent has ended is ended. An established leg is never
    re-validated: a password change, a closed forward or a new ACL rule affects only new
    logins, as with a real sshd. A defender evicts an intruder by rebooting.

### Covering tracks

12. **Wipes stick.** A root-tier write or `rm` of a log on a box the player does not own becomes the
    base later system appends build on, ending the resurrection. Root on every hop severs the
    trail; a hop held only at guest/user tier keeps its log. This honours cross-player decision 7.
    A wipe racing an in-flight append can lose to it once (a one-request window, the same
    accepted race as the mysql datadir); the next wipe settles it.
13. **The fix covers every system-appended log on every kind of box** — `auth`, `kern`, `access`,
    `vsftpd`, `mysql`, `redis`, `snmpd`, `named` — on NPC and player boxes alike. Permissions
    already stop anyone below root.
14. **Measure first.** A wire-check reproducing the resurrection precedes any fix plan. Done:
    `scripts/testLogWipeSticks.ts` is red on its two "sticks" checks and becomes the wipe slice's
    acceptance check.

### The defender

15. **No new defender verbs.** Trace-back is `auth.log` → `whois` → break into the hop → repeat.
    Player commands still leave no `.bash_history` on a hop; a forward trail is not part of this
    feature.
16. **Players are told in `man ssh`; developers in the handbook.** The change alters every network
    command inside a shell (`ssh 192.168.1.5` from a foreign box no longer reaches home), so
    `man ssh` gains a paragraph: a command run inside a remote shell travels from that box. The
    developer handbook (`docs/handbook/`, which players never see) records the vantage as built
    in `07-network-filesystem-scanning.md` at close-out. (Amended at slicing: the grill said "a
    handbook page", but the only player-facing text is `man`.)

## Done when

1. **The chain wire-check passes.** B, at home, hops to a box on network P, then by public
   address to a box on network Q, and from there logs in to a third network's gateway. That
   gateway's `auth.log` names **Q's** public address; Q's box names **P's**; P's box names
   **B's home**. Following `auth.log` → `whois` from the target walks back to B, hop by hop.
2. **Lateral movement traces truthfully.** From the box on P, a login to another host on P's
   LAN is logged on that host, under `ap:<P>`, from the hop's LAN address (7, 7a).
3. **A stuck wipe cuts the trail.** `scripts/testLogWipeSticks.ts` is green, and in the chain
   check, a root wipe on Q's box leaves the target's trail ending at Q.
4. **No IP tool is left at home.** One test enumerates every IP tool in decision 2 and proves
   each one, run in a remote shell, carries that shell's box (`callerMachineId`) — so a tool
   added later without it fails the test.
5. **A chain break cascades.** Rebooting P's box ends the sessions on Q and beyond with
   `upstream_lost` (11a).
6. **The real client shows it**, single-player (two-player runs are unstageable against a
   fresh box): a browser run builds a two-hop chain, `ifconfig` shows the hop, `nmap` sweeps
   the hop's LAN, `exit` steps back one vantage.
7. **The docs say it.** `man ssh` carries the vantage paragraph (16); handbook chapter 7 records
   the vantage as built; `cross-player-architecture.md` §8 no longer says v2 has no
   command-vantage switch; both §9 backlog items this plan resolves are removed.

## Slices

Owner-approved 2026-10-04. Every slice is a **behavior change**, one independent PR against
`main`, cut only after its predecessor lands (`/continue`). Slices 1 and 2 stand alone; 4–9 need
3. Each loads `tdd`, `testing` and `refactoring` before code, confirms its acceptance criteria
with the owner before RED, bumps the version, and runs the mutation gate once at PR readiness
(json reporter, one file scope at a time — `conventions-and-gotchas.md` §4). Every slice that
touches `api/` deps adds or updates a `scripts/test*.ts` wire-check and runs it live.

The close-out (as-built docs, §9 cleanup — including the "OPEN DESIGN QUESTION: an established
session is never re-validated against its route" item, which 11a answers — retiring this file) is
a `docs(v2):` commit on `main` after slice 9, not a slice.

### Slice 1: A root wipe of a log on a box you don't own sticks

✅ Done in #598.

**Value**: an attacker with root on a hop can cut the trail there; the wipe a player sees is the
wipe a defender sees.
**Path**: a system append (`appendMachineLog`, every caller) → reads the log a READER
materializes (every writer's row for the path, `orderPatchesForReplay`, last wins; a tombstone
reads as empty) → appends → upserts under the log's own key.
**Decisions**: 12, 13, 14. **Done-when**: 3 (the wire-check half).
**RED**: `appendMachineLog` given a newer empty/tombstone row from another writer appends to
empty, not to its own older row. Live: `scripts/testLogWipeSticks.ts` (committed in this PR) goes
11/11.
**Watch for**: every appender's `readLog` dep currently reads ONE `(machine_id, path,
writer_key)` row — the dep changes shape for all of them; `appendAuthLog` (own-box su) keeps
working since its writer and reader are the owner.

### Slice 2: Two players on one home network share one log per NPC box

✅ Done in #599. As built: the hydra/ftp/mysql/redis/snmp/nmap own-LAN writers named in **Path**
were already network-keyed; the ones that moved were the login, `curl`/`gobuster`
(`recordLanFetch`), `dig axfr` (`recordZoneTransfer`), and the ftp-transfer and `apt` traces
(`traceProvenance`, now keyed by the session's network, which also covers boxes reached through a
forward).

**Value**: a co-occupant's line on a shared NPC box is no longer erased by the other's next
login; trace-back and wipes have one record to act on.
**Path**: own-LAN door handlers (`authCreateSession`, the own-LAN hydra/ftp/mysql/redis/snmp/nmap
trace writers) → write under `apGatewayLogWriterKey(essid)` instead of the caller's key; player
boxes keep the owner's key.
**Decisions**: 7a.
**RED**: a wire-check where two occupants of one lab ESSID each log in to the same generated
host; the host's `auth.log` holds both lines.
**Watch for**: §6's shared-machine rule — clean the host at setup, assert on the delta.

### Slice 3: `ssh` from a hop walks sideways across the hop's LAN — the walking skeleton

✅ Done in #600. As built: the vantage is one resolver on each side: `vantageOf` on the client
and `resolveCallerVantage` on the server. A hop's address comes from `lanAddressForMachineId`,
which only knows boxes generated on a network's top LAN (its hosts, router and inner gateways). A
hop on a player's workstation or on a deeper layer stays on its network, but its log line reads
`unknown` and its `eth0` has no address. A caller who names no box and occupies no network gets
403 `caller_not_on_network`, so wire-checks must seat their callers (`scripts/standVantage.ts`).
From a foreign hop, other players' boxes on the hop's LAN are still unreachable, because the
occupant lookup and the same-WiFi login both need the caller's own WiFi. Both gaps move to slice
4 (player boxes) and slice 6 (deeper layers).

**Value**: a player with a shell on a box reaches that box's network, and is logged there under
the box's address.
**Path**: the client `Session` gains its network (`essid`, carried through `listSessions` and
rehydration) → `ssh`'s own-LAN path takes essid and target resolution (`addressForTarget`) from
the top session, home `wlan0` only when there is none → sends `caller_machine_id` →
`authCreateSession` derives the vantage server-side (the session row's essid and machine, or the
caller's home occupancy), **refuses a named network that is not the vantage's** (closes the
crafted-essid gap: today any essid is trusted), and stamps the source address itself (decision
7) instead of the client `source_ip` → `ifconfig` shows the hop's interface and LAN address →
`man ssh` gains the vantage paragraph.
**Decisions**: 1, 4, 4b, 5, 6, 7 (ssh), 8 (ssh names), 9, 16 (man). **Done-when**: 2.
**RED**: from a session on a box on network N, `ssh` to an N-private address lands on N's host,
whose `auth.log` names the hop's LAN address; from a foreign hop, a home-private address is
`No route to host`; `ifconfig` on the hop prints the hop's address; a crafted request naming a
network the caller is not standing on is refused. Wire-check for the server half.
**Watch for**: the shared vantage resolver this slice builds is what 4–9 reuse — keep it one
function on each side, not a per-tool copy.

### Slice 4: `ssh` out of a network traces to the hop's network

✅ Done in #601. As built: the public door already took a caller box (`ftp`, `scp`); `ssh` now
sends one too, and `PublicAuthParams` absorbed `PublicDoorAuthParams`. The inner-gateway door
places the caller with `resolveCallerVantage` and refuses a network they are not on (403
`wrong_network`), `nc` knocks included; its deep line still names the gateway's `.1`. The public
door keeps its own resolver (`standingVantage`), which logs a caller on no network as `unknown`
instead of refusing them. The planned "router writes no line" worry was wrong: the gateway's line
lands under `ap:<essid>`, and `testCrossPlayerConnectionTrace.ts` was reading the owner's key (now
7/7). Chain check: `scripts/testHopChain.ts` 12/12. The player-box half of the planned path moved
to slice 4b.

**Value**: the chain the feature exists for — a target's log names the last hop's network, and
each hop's log names the one before.
**Path**: `ssh`'s public and inner-gateway-forward paths send `caller_machine_id` from a hop →
`authCreateSessionPublic` / `authCreateSessionInnerGateway` trace via `resolveVantageSourceIp`,
standing on the network `resolveCallerVantage` places the hop on.
**Decisions**: 1, 4a, 7. **Done-when**: 1, 3.
**RED**: the chain wire-check (`home → P → Q → third gateway`, trace walk-back, then a root wipe
on Q ends the trail at Q).

### Slice 4b: From a hop, other players' boxes on its LAN are reachable

✅ Done in #602. As built: `resolveCallerVantage` reads a player-box hop's address through a new
`findWorkstationLease` dep (`unknown` when its owner has left the network, 500 when the read
fails). The same-LAN login and the occupant list refuse with `wrong_network`,
`caller_not_on_network` and `no_session` instead of `not_an_occupant`. A caller on the network
with no lease is now logged as `unknown` instead of refused, as own-LAN logins are since slice 3.
`api/network.ts` carries its own copies of the home and lease reads. Only `ssh` sends its box;
the other tools get theirs in slices 6–9. Four doors now repeat "place the caller, refuse another
network"; fold them into `resolveCallerVantage` when a fifth arrives. Wire-check:
`scripts/testHopPlayerBoxes.ts` 8/8.

**Value**: a player standing on a box on network N reaches the players' workstations on N, as an
occupant of N would; a hop on a player's workstation is logged under that player's own LAN
address (4a).
**Path**: `resolveOccupants` and `authCreateSessionSameLan` take `caller_machine_id` and place
the caller with `resolveCallerVantage` instead of requiring their own occupancy of the named
ESSID, refusing a network they are not standing on → the same-LAN trace's source is the
vantage's address, not the caller's lease → `resolveCallerVantage` gives a hop on a player's
workstation that player's lease on its network instead of `null` → `ssh` sends its box on the
same-LAN path.
**Decisions**: 1, 4, 4a, 7. **Done-when**: 2 (player boxes).
**RED**: from a hop on N, `ssh` to an occupant's LAN address on N lands on their workstation,
whose `auth.log` names the hop's LAN address; a sideways login from a hop on a player's
workstation names that player's lease. Wire-check for the server half.
**Watch for**: `resolveOccupants` also feeds `nmap`'s occupant merge; slice 6 picks up the caller
box there. The client knows no lease for a player-box hop, so its `ifconfig` stays
address-less; this slice changes only what the server logs.

### Slice 5: A chain breaks where a hop goes down

✅ Done in #603. As built: `rebootMachine` ends the chains above the box after writing the
boot-id marker (`endChainsAbove` in `upstreamLost.ts`). It stays inside each player's own chain,
because every first hop names `seed-session` and session ids are chosen by the client. A failed
cascade returns 500, after the marker. `listSessions` ends any open session whose parent has
ended, so a reload never rebuilds onto a lost hop and a failed cascade is repaired on the next
listing. The terminal asks the server before each line only at two or more hops deep, costing one
extra request per line there; one hop deep keeps the boot-id check. A `su` leg drops without a
line. Only a reboot triggers the cascade: bricking acts through the reboot that follows it, and
`nmcli disconnect` ends nothing, because decision 11a says a leg is never re-checked.
Wire-check: `scripts/testChainBreaks.ts` 9/9.

**Value**: a reboot evicts an intruder from everything they reached through that box.
**Path**: `rebootMachine` (and the dark/brick path) end the sessions on the box → every session
whose `parent_session_id` chain runs through them ends with `upstream_lost` (server-only reason)
→ the terminal drops to the deepest surviving hop printing `Connection to <host> closed by
remote host.` per leg → rehydration ends an orphaned child the same way.
**Decisions**: 11a. **Done-when**: 5.

### Slice 6a: `nmap` from a hop sweeps the hop's LAN and traces to the hop

✅ Done in #604. As built: `nmap` takes its network from `vantageOf`. On a hop it sweeps that
box's network, whatever the player's own WiFi is doing. The home subnet is out of range there, and
the player's own box is not listed, matching `ssh`. Every scan request names the box it runs from
(`caller_machine_id`). The client no longer sends a `source_ip`: the server places the caller from
the session row.

One rule, `resolveCallerVantageOn` in `callerVantage.ts`, gates the scan log, the occupant,
same-LAN and inner-gateway lookups, and the occupant list:
- a network the caller does not stand on gets 403 `wrong_network`, which retires
  `not_an_occupant`;
- a box they hold no shell on gets 403 `no_session`.

A sweep from a hop is logged on that network's boxes, players' included, under the hop's LAN
address. A public scan from a hop is logged under the hop network's public address. `ssh`, `ftp`,
`nc` and `scp` also name their box on public probes, so a forward login from a hop passes the new
gate. The out-of-range message and `man nmap` say "the network you are on".

Done-when 6 landed here, as a browser run: home → BREW-AND-CODE gateway → NAKATOMI-PLAZA gateway,
then `ifconfig`, `nmap` of the hop's LAN, and `exit`. Wire-check: `scripts/testHopNmap.ts` 10/10.

### Slice 6b: A hop on a deeper layer scans and traces from that layer

✅ Done in #605. As built: one rule, `segmentsReachedFrom` in `lanTopology.ts`, lists every
network a box reaches, and both `vantageOf` (as `reaches`) and `resolveCallerVantage` read it:
- a deep host stands on its layer at its own address;
- a chain gateway stands on the network above it, and on the layer it fronts at that layer's `.1`;
- every network above is reached out through each gateway on the way up, and the box is seen
  there as that gateway — so a deep box's LAN scans and logins trace to the inner gateway, not
  `unknown`.

`nmap` scans whichever reached layer the target is on. A deep gateway now also reaches the layer
it sits on. Every scan is recorded by the one `nmapScan` action; the server works out the layer and
the address from the scanning box's live session. No shell is 403 `no_session`; a target on no
network the box reaches is 403 `wrong_network` (a foreign LAN target included, which used to be
200 with nothing logged). `nmapScanDeep`, `recordDeep` and `pivotVantageForMachineId` are gone. A
deep box's `ifconfig` shows its layer address. A layer sweep does not list the fronting gateway's
`.1`, from any box on the layer. Wire-check: `scripts/testDeepScanTrace.ts`, rewritten, 10/10.

### Slice 6c: From a box on a deep layer, its neighbours there are reachable by address

✅ Done in #606. As built:
- `ssh` reaches the hosts on any layer in the shell's `vantageOf(...).reaches`. The ports it trusts
  come from the same lookup `nmap` uses to render a layer (`resolveDeepScanHosts`), so a port is a
  door exactly when `nmap` from that shell lists it as ssh.
- The server half is the own-LAN `authCreateSession`, widened rather than given a new action. A
  target off the LAN is looked up among the deep layers the caller's box reaches
  (`segmentsReachedFrom`), and the login is logged and stored under the address the box holds
  there.
- A switch fronting the layer applies its live ACL through `reachDoor`; a router's journal is never
  read.
- A layer's `.1` is no host, matching the sweep. Each gateway is still reachable at its address on
  the layer above.
- Not reachable: walking a deep gateway's own forwards from inside the chain, and `.lan` names for
  deep boxes.
- `ftp`, `scp` and `nc` share the handler, so slices 8–9 only need the client half.

Wire-check: `scripts/testDeepLayerSsh.ts` 10/10.

Added at 6b's acceptance (scope call A). **Value**: decision 1 holds on a deep layer too. A shell
on a deep box reaches its layer-mates the way a LAN hop reaches its LAN, not only through a
forward. **Path**: `ssh` routes a target on a layer the shell reaches (`vantageOf(...).reaches`)
to that layer's host; the server's reach gate accepts a login from a box that reaches the layer,
and logs it under the caller's address there (`segmentsReachedFrom`). Slices 7–9 apply the same
routing to their tools. **Decisions**: 1, 7. **Watch for**: this makes a forward optional once a
player roots a chain gateway — decision 1's accepted consequence, now on deep layers; and whether
`ssh` to a layer's `.1` lands on the gateway fronting it.

### Slice 7: The web tools run from a hop

✅ Done in #607. As built:
- `curl`, `lynx` and `gobuster` reach hosts from `vantageOf(...)`: the hop's LAN, every deep layer
  it reaches (ports after the fronting switch's live ACL, via `resolveDeepScanHosts`), and the box
  itself over `localhost` or its own address. A home-LAN address from a foreign hop is `Could not
  resolve host`; a denied or non-http layer port is `Connection refused`; a layer's `.1` is no host.
  Names resolve on the network the shell stands on.
- The own-LAN access log (`recordLanFetch`) is placed server-side from the caller's box, like
  `nmapScan`: 403 `wrong_network` off the caller's networks, 403 `no_session` without a shell
  there. The client `source_ip` is gone. A deep-layer fetch logs on the deep box under
  `ap:<essid>` from the layer address; a fetch the ACL denies logs nothing. `localhost` goes over
  as `127.0.0.1` and logs as such on the caller's own box.
- A public `curl`/`lynx` from a hop sends the caller's box; `resolveHttpFetch` refuses
  `no_session` without a shell there and traces to that network's public IP. With no box it is
  unchanged, so `curl` from home still needs no session.
- The radio stays with the body: the tools work from a hop with the home card off.

Wire-check: `scripts/testHopWebTools.ts` 8/8.

`curl`, `lynx`, `gobuster` — reachability and trace from the vantage; `curl` still needs no
session from home (decision 6). **Decisions**: 2, 6.

### Slice 8: The credential and service tools run from a hop

Split in two at acceptance (the plan's own "if it runs big" call): the four tools that share one
server reach go first, the two with their own handlers follow. **Decisions**: 2.

#### Slice 8a: The database and SNMP tools run from a hop

`mysql`, `redis-cli`, `snmpwalk`, `snmpset` — all four reach the server through one lookup
(`reachBox`/`reachServiceHost` in `serviceHost.ts`), so one server change moves all four onto the
shell's box. Agreed acceptance (owner, 2026-10-06):

1. **The tools travel from the shell's box** (`vantageOf(...)`, not `wlan0`): they work from a hop
   with the home card off, and from a foreign hop a home-LAN address is unreachable in each tool's
   own "no route" wording.
2. **A hop reaches** the generated hosts on its LAN; other players' boxes on that LAN (as 4b does
   for `ssh`); every deep layer the box reaches (ports after the fronting switch's live ACL, a
   denied port refused like an unserved one, a layer's `.1` no host); and public addresses.
3. **`localhost` and the hop's own address reach the hop's own daemon, server-side.** The client
   sends `127.0.0.1`; the server resolves it to the caller's box and logs under that box's usual
   key (`ap:<essid>`, or the owner's key on a player box) from `127.0.0.1`. At home the existing
   client-side own-box path is unchanged. Running the hop's daemon client-side would write the
   hop's log under the player's own key, breaking 7a.
4. **The server places the caller** (`resolveCallerVantage`): login, every `mysql`/`redis`
   statement, and each walk/set send `caller_machine_id`; a network the caller isn't on is 403
   `wrong_network`, a box they hold no shell on is 403 `no_session`, and `source_ip` is neither
   sent nor read.
5. **The source address is server-derived** (decision 7): the hop's LAN address, the box's layer
   address, or the hop network's public IP; from home nothing changes.
6. **One log row per box** (7a): generated and deep boxes under `ap:<essid>`, a player's box under
   its owner's key.
7. **An open `mysql`/`redis` prompt keeps the box it was opened from**, re-checked per statement;
   once that shell is gone the next statement is refused `no_session` and the prompt drops.
8. **The man pages say "the network you are on".**
9. Wire-check: `scripts/testHopDataDoors.ts` — a LAN hop; a deep layer incl. a switch-denied
   port; `wrong_network` and `no_session`; loopback on a hop; a public target from the hop vs from
   home; a statement after the hop's shell has ended.

✅ Done in #608 (v0.317.0). As built: the four doors send the shell's box as
`caller_machine_id`, resolved server-side by `resolveCallerVantageOn` in
`callerVantage.ts` (403 `wrong_network` / `no_session` / `caller_not_on_network`);
`serviceHost.ts` keeps the single shared reach, its public arm now deriving the
source through `resolveVantageSourceIp(standingEssid)` so a hop public reach is
seen at the hop network's address, and `reachDeepLayerBox` applying a fronting
switch's live ACL to a deep-by-address target. `localhost`/own-box reaches resolve
server-side and log over loopback. Wire-check `scripts/testHopDataDoors.ts` (8/8)
plus the 20 existing data-door checks, all live-green; the existing checks were
reseated onto the caller-placement contract. Mutation on `serviceHost.ts`: 90.43%,
0 timeouts, survivors triaged (equivalent/defensive, pre-existing same-LAN arm, or
the new switch-ACL branch proven by the deep wire-checks).

#### Slice 8b: The cracking tool runs from a hop

`hydra` on all three paths (own-LAN, inner-gateway, public), folded onto the shared
`reachBox`/`reachServiceHost` in `serviceHost.ts` so a crack reaches exactly what the data doors
do — its three server endpoints collapsing to one, and the client's three-way split with them.
Agreed acceptance (owner, 2026-10-06):

1. **`hydra` travels from the shell's box**: it works from a hop with the home card off, and from a
   foreign hop a home-network address is unreachable (`no route to host`).
2. **A hop reaches** the generated hosts on its network; other players' boxes there (as 4b does for
   `ssh`); every deep layer it reaches (behind the fronting switch's live ACL, a denied port refused
   like an unserved one); public addresses; and `localhost` → the hop's own daemon.
3. **The server places the caller** (`resolveCallerVantageOn`): every crack sends
   `caller_machine_id`; a network the caller isn't on is 403 `wrong_network`, a box they hold no
   shell on is 403 `no_session`; `source_ip` is neither sent nor read, and `caller_not_on_lan` is
   gone.
4. **The source address is server-derived** (decision 7): the hop's LAN address, its deep-layer
   address, or the hop network's public IP; from home nothing changes.
5. **One log row per box** (7a): generated and deep boxes under `ap:<essid>`, a player's box under
   its owner's key — closing the inner-gateway writer-key defect the handler's header flags.
6. **Port-first, like the data doors** (owner, 2026-10-06): with no `-p` the named service's
   default port is used (ssh:22, ftp:21, snmp:161) through the shared `reachServiceHost`, one rule
   for every network tool. `hydra <ip> ftp` against ftp on a non-default port now needs `-p` — a
   change from today's own-LAN "find the service on any port", accepted to avoid a hydra-only
   carve-out now that snmp/mysql/redis all went port-first in 8a.
7. **The man page says "the network you are on".**
8. Wire-check `scripts/testHopHydra.ts` — a LAN hop; a deep layer incl. a switch-denied port;
   `wrong_network` and `no_session`; loopback on a hop; a public target from the hop vs from home.
   Existing hydra wire-checks reseated onto the caller-placement contract.

✅ Done in #610 (v0.318.0). As built: `hydra`'s three server endpoints collapsed into one
`hydraCrack` routing every target through the shared `reachServiceHost` in `serviceHost.ts` (the
reach `ssh` and the data doors use), with the client's three-way split removed; the caller is
placed by `resolveCallerVantageOn` (403 `wrong_network` / `no_session` / `caller_not_on_network`),
`source_ip` no longer sent or read, and the trace address server-derived. The two sibling handlers
(`hydraCrackPublic`, `hydraCrackInnerGateway`) and their tests were deleted; the writer-key is the
reach's, which closed the inner-gateway writer-key defect the old handler flagged. Went port-first
(decision 6): no `-p` uses the named service's default port, so a non-default `ftp` needs `-p` —
the man page says so. Wire-check `scripts/testHopHydra.ts` (7/7) plus the existing hydra checks
reseated onto the caller-placement contract (`testHydraOwnLan` 23/23, `testHydraCrossPlayer` 16/16,
the sweep-trace/same-LAN/deep/cross-player checks), all live-green. Mutation on `hydraCrack.ts`:
100% (80/80 killed, 0 survivors, 0 timeouts); `serviceHost.ts`/`callerVantage.ts` unchanged this
slice (gated in 8a).

#### Slice 8c: The exploit tool runs from a hop

`msfconsole`'s network fire (`--local` already runs on the box the shell stands on), its own
`reachTarget` retired onto the shared `reachBox` so it reaches what every other tool does, and the
shell it mints stacked on the hop (11a). **Decisions**: 2.

✅ Done in #611 (v0.319.0). As built: `exploitCreateSession`'s own `reachTarget` retired onto the
shared `reachBox` (the reach `ssh`, the data doors and `hydra` use), and the caller is placed
server-side by `resolveCallerVantageOn` — so the fire reaches, and is traced to, the hop exactly as
every other tool does: its own LAN address, a fronting switch's `.1` down a chain, the hop network's
public address across the world, or `127.0.0.1` over loopback. A denied port bounces with the uniform
`not_vulnerable`; a network the hop is not on, or a box it holds no shell on, is refused before
anything is reached. `--local` is unchanged. The minted shell stacking on the hop is slice 11a.

### Slice 9: The remaining IP tools run from a hop

`ftp`, `scp`, `nc`, `ping`, `dig`/`nslookup` (names resolve against the vantage), `apt` (a hop's
network is online). Adds the test that enumerates every IP tool in decision 2 and proves each
carries the shell's box. **Decisions**: 2, 3, 8. **Done-when**: 4.

Split in three before acceptance (owner, 2026-10-06), on how each tool reaches the network, read
from the code: three tools log in through `ssh`'s own gates, three answer without a login, and
`apt` only asks whether it is online. Each is one PR against `main`, cut after its predecessor
lands; each still confirms its acceptance criteria with the owner before RED.

#### Slice 9a: The port tools run from a hop

`ftp`, `scp`, `nc` — all three log in through the same server gates `ssh` does (`ftp`/`scp` call
`authCreateSession`/`authCreateSessionPublic` for an `ftp`/`scp`-kind row; `nc`'s four `connect*`
take `ssh`'s four auth params minus the credential), and those gates already place the caller
server-side since slices 3–6c. What is left is the client: each still reads its network from home
`wlan0` (`ftp.ts`/`scp.ts` `essid` + `isOnline`, `nc.ts` `connectedWlan0`), resolves names
against it, and derives a home-LAN target with `generateHomeLan`. `ftp` and `scp` have only an
own-LAN and a public arm, so a fellow occupant's box and a deep-layer box are unreachable to them
even at home; `ftp`/`scp` still send a client `sourceIp`.
**Path**: route each the way `ssh` does — `vantageOf(...)`, names through `addressForTarget` on the
vantage's network, and `ssh`'s arms (own LAN, same-LAN occupant, inner gateway / deep layer,
public), every one sending `caller_machine_id`; the client `sourceIp` goes. The `ftp>` prompt and
a one-shot `scp` are never a vantage (4b); the session they open names the box it was opened from.
The ftp-transfer trace (`recordTransfer`, `traceProvenance`) is already keyed by the session's
network (slice 2).
**Watch for**: `nc localhost` refuses as the player's own box today (`OWN_BOX`); on a hop it is the
hop's own daemon, as `localhost` became for the data doors (8a). Wire-check
`scripts/testHopPortTools.ts`.

Agreed acceptance (owner, 2026-10-06):

1. **The tools travel from the shell's box** (`vantageOf(...)`, not `wlan0`): they work from a hop
   with the home card off, and from a foreign hop a home-LAN address is unreachable in each tool's
   own "no route" wording.
2. **A hop reaches what `ssh` reaches from it**: the generated hosts on its LAN; other players'
   boxes there; every deep layer it reaches (behind the fronting switch's live ACL, a denied port
   refused like an unserved one); public addresses. `ftp` and `scp` gain the occupant and
   deep-layer arms they lack, so they match `ssh` from home too.
3. **`localhost` and the hop's own address reach the hop's own daemon, server-side**, logged from
   `127.0.0.1` under the box's usual key — as the data doors do (8a). This retires `nc`'s
   own-box refusal on a hop.
4. **Names resolve on the network the shell stands on** (decision 8).
5. **The server places the caller** (`resolveCallerVantageOn`): every login sends
   `caller_machine_id`; a network the caller isn't on is 403 `wrong_network`, a box they hold no
   shell on is 403 `no_session`; the client `sourceIp` is neither sent nor read.
6. **The source address is server-derived** (decision 7): the hop's LAN address, its deep-layer
   address, or the hop network's public IP; from home nothing changes.
7. **One log row per box** (7a): generated and deep boxes under `ap:<essid>`, a player's box under
   its owner's key; an `ftp`/`scp` login is recorded as its own kind of session on every arm, never
   as `ssh`.
8. **The `ftp>` prompt and a one-shot `scp` are never a vantage** (4b); the session either opens
   names the hop it was opened from.
9. **The man pages say "the network you are on".**
10. Wire-check `scripts/testHopPortTools.ts` — a LAN hop; a deep layer incl. a switch-denied port;
    `wrong_network` and `no_session`; loopback on a hop; a public target from the hop vs from home.
    Existing ftp/scp/nc wire-checks reseated onto the caller-placement contract.

✅ **ftp and scp done in #612 (v0.320.0). `nc` splits out to 9a-ii.** Owner split 9a again at build
(2026-10-06): ftp+scp (identical arm set, shared server change) shipped together; `nc` follows as a
separate PR. As built:
- `ftp` and `scp` route through `vantageOf(...)` on every arm — own-LAN, public, direct deep-layer
  (`resolveDeepScanHosts`, a denied/unserved port refused like a shut one), and fellow occupant —
  each sending `caller_machine_id`; the client `sourceIp` is gone, and `scp`'s own-LAN login (which
  sent no caller box at all, tracing home) is fixed. New client seams `authenticateSameLan` on both
  doors; `authCreateSessionSameLan`'s password branch, which hardcoded `kind:'ssh'`, now records the
  door's own kind (criterion 7). Man pages carry the vantage line.
- **No inner-gateway NAT-forward arm** (criterion 2, narrowed): the world forwards only ssh into
  deep layers (`relations`, `forwardsIntoDeepLayer`), so there is no top-LAN→deep ftp/scp path —
  they reach deep layers by standing on a deep box. The speculative `authenticateInnerGateway`
  plumbing was removed rather than shipped unreachable.
- **`localhost`→own-daemon deferred to 9a-ii** (criterion 3, narrowed): it lives in the data-doors'
  endpoint, not the ssh-login endpoint ftp/scp use, and `ssh` does not special-case it — it is
  `nc`'s motivating case, so it ships with `nc`.
- Wire-check `scripts/testHopPortTools.ts` 8/8 live (ftp→vsftpd log, scp→auth.log, both named the
  hop's address; `wrong_network`/`no_session` refused). The occupant and public arms reuse the
  endpoints ssh's own wire-checks cover, and an occupant login is unstageable against a fresh box
  that runs no ftp, so neither is re-proven there. Mutation: ftp.ts/scp.ts changed regions and the
  same-LAN kind fix all killed; one equivalent survivor (scp deep-arm `service===ssh` — no deep host
  serves a matched port with a non-ssh service).

#### Slice 9a-ii: `nc` runs from a hop

`nc`'s four backdoor arms already exist, but it routes from the home card (`connectedWlan0`); the
switch to `vantageOf(...)`, the one direct-deep arm it lacks, and `localhost`→the hop's own listener
(the data-doors' server-side loopback, retiring `nc`'s own-box refusal on a hop) carried over from
9a. **Decisions**: 2. Wire-check extends `scripts/testHopPortTools.ts` with the `nc` and loopback
rows.

✅ **Done in #613 (v0.321.0).** As built:
- `nc` routes through `vantageOf(...)` on every arm — own-LAN, public, direct deep-layer
  (`resolveDeepScanHosts`, banner-or-knock), and fellow occupant — each sending `callerMachineId`,
  so a connect from a hop is placed on the hop's network. The same-LAN and inner-gateway nc
  adapters now forward `caller_machine_id`, which they had been dropping.
- **`localhost`→the hop's own listener**: the client sends loopback on a hop, and
  `handleAuthCreateSession` resolves a loopback `target_ip` to the caller's own box via its vantage
  (`vantage.sourceIp`), mirroring the data doors' `reachBox`. At home the own-box refusal still
  stands — planting is local, connecting is not.
- Wire-check `scripts/testHopPortTools.ts` 12/12 live (`nc` lands `kind:nc` on the LAN box's own id;
  `nc localhost` lands on the hop itself). Mutation: nc.ts changed regions killed bar documented
  equivalents; the loopback null-guard is an equivalent type-narrow (fall-through yields the same 404).

#### Slice 9b: Ping and name lookups run from a hop

`ping`, `dig`, `nslookup` — no login; each answers client-side from home `wlan0`
(`connectedWlan0`): `ping` reaches only the home LAN plus the player's own address, and
`dig`/`nslookup` ask `${home subnet}.1`. **Path**: `vantageOf(...)` for all three — `ping` replies
from what the vantage reaches (its segments, the box itself), `dig`/`nslookup` ask the vantage
network's resolver and resolve `.lan` names there (decision 8). `dig axfr`'s zone-transfer trace is
the one server change: `handleRecordZoneTransfer` names the caller's HOME public address
(`resolveCrossPlayerSourceIp`) even for an own-LAN transfer, so it moves onto
`resolveCallerVantageOn` + `caller_machine_id` with a server-derived source (decision 7), the way
`recordLanFetch` did in slice 7. Wire-check for the axfr trace.
**Watch for**: `ping` to a public address is not answered today (its header defers it to a
cross-player slice) — keep that out of scope unless the owner adds it at acceptance.

Agreed acceptance (owner, 2026-10-07):

1. **All three travel from the shell's box** (`vantageOf(...)`, not `wlan0`): they work from a hop
   with the home card off; from a foreign hop a home-LAN address does not answer, as for `ssh`
   (decision 5); off any network the existing "network is unreachable" refusal stands.
2. **`ping` answers for what the vantage reaches**: the box itself, the generated hosts on every
   segment it reaches, the deep layer it stands on, and fellow occupants on its LAN — the reach
   `ssh`/`nmap` already have, so `ping` gains the occupant and deep-layer reach from home too.
3. **`ping` takes a name**, through `addressForTarget` on the vantage's network (decision 8).
4. **`ping` to a public address stays unanswered** — out of scope, as above.
5. **`dig`/`nslookup` resolve on the network the shell stands on** (decision 8): its `.lan` names,
   its occupants, the world's published domains. The `Server:`/`SERVER:` line names the `.1` of
   the segment the box stands on, so a deep-layer box names that layer's gateway.
6. **`dig @<server> axfr` reaches only a name server the vantage reaches.** Today any name server
   on the network answers, deep layers included even from the top LAN; one the vantage cannot
   reach is refused like no name server at all.
7. **The axfr trace is server-derived**: `recordZoneTransfer` takes `caller_machine_id` and places
   the caller with `resolveCallerVantageOn`. The source is the vantage's address on the network it
   stands on (the home LAN lease, the hop's LAN address, or its deep-layer address) — no longer
   the home public address. A network the caller isn't on is 403 `wrong_network`, a box they hold
   no shell on 403 `no_session`; a client `source_ip` is never read. The line keeps `ap:<essid>`
   (7a).
8. **The man pages say "the network you are on".**
9. **Wire-check**: `scripts/testNamedXfrTrace.ts` reseated onto the caller-placement contract,
   plus an own-LAN transfer naming the LAN address (not the public one), a transfer from a hop
   naming the hop's address, and `wrong_network`/`no_session`. `ping`, `nslookup` and an ordinary
   `dig` make no server call, so they are proven in unit tests.

✅ **Done in #614 (v0.322.0).** As built:
- `ping`, `dig` and `nslookup` route through `vantageOf(...)` on every path. `ping` answers for
  what the vantage reaches — the box itself, its LAN's generated hosts, each deep layer it reaches,
  and fellow occupants on its LAN — and takes a name via `addressForTarget`; a public address stays
  unanswered. `dig`/`nslookup` resolve on the standing network and name the `.1` of the segment the
  box stands on, a deep layer's own gateway included, through the new `resolverFor(vantage)` helper
  on `vantage.ts`.
- `dig @<server> axfr` reaches only a name server the vantage reaches (a deep one needs standing on
  a box on its layer); one it cannot reach is refused as a non-name-server is. The stale "both open
  name servers are deep" fixture note in `dig.test.ts` is corrected — 36 of the world's open name
  servers sit on top LANs.
- The axfr trace moved onto caller placement like `recordLanFetch` (slice 7): `recordZoneTransfer`
  carries `caller_machine_id`, `handleRecordZoneTransfer` places the caller with
  `resolveCallerVantageOn` and sources the `named.log` line from the box's address on the name
  server's own segment (home LAN lease, hop LAN address, or deep-layer address), retiring the
  home-public-IP source; `wrong_network`/`no_session` refuse, and a client `source_ip` is never
  read. The line keeps `ap:<essid>` (7a).
- Wire-check `scripts/testNamedXfrTrace.ts` reseated onto the caller-placement contract, 6/6 live
  (own-LAN LAN-vs-public source; a hop's deep source; `wrong_network`/`no_session`).
  `ping`/`nslookup`/ordinary `dig` make no server call, so they are proven in unit tests. Mutation:
  changed regions killed bar documented equivalents (`vantage.ts` optional chaining on an
  always-non-empty `reaches`; the `reachedSegmentsFor` undefined-caller guard that falls to the same
  path; the denied-outcome object, since only the `transferred` verdict is read).

#### Slice 9c: `apt` runs from a hop, and no IP tool is left at home

`apt list`/`install`/`upgrade` gate on `env.network.isOnline()` — the home card — so on a hop with
the home card off they refuse offline. **Path**: online is "the vantage is on a network"
(`vantageOf(...) !== null`); the install/downgrade traces already key by the session's network.
Then the Done-when 4 test: one test enumerates every IP tool in decision 2 and proves each, run in a
remote shell with the home card off, travels from that shell's box — so a tool added later without
it fails. **To confirm at acceptance**: `ping`, `dig`/`nslookup` (non-axfr) and `apt` make no
server call, so for them "carries the shell's box" can only mean "answers from the hop's network",
not "sends `callerMachineId`".

**Measured at acceptance (2026-10-07)**: "the traces already key by the session's network" is only
half true. The row key is right, but on a box nobody owns `traceProvenance` names the address the
client reports, and both callers still send the home card's lease (`sourceIp: localAddress()` in
`ui/state.ts`, for the dpkg rollback and the ftp transfer). From a hop with the card off the line
says `unknown`; from a foreign hop with it on, it names the home LAN lease, a false origin; and
the ftp transfer line disagrees with the ftp login line 9a made server-derived. Decision 7 is not
true until both are placed by the server, so 9c fixes both.

Agreed acceptance (owner, 2026-10-07):

1. **`apt` is online when the shell's box is on a network** (`vantageOf(...) !== null`), not when
   the home card is up: on a hop with the home card off, `list`, `list -u`, `install` and
   `upgrade` all work. At home with the card off the existing offline refusal stands. Root is
   still checked before the network.
2. **`apt` acts on the hop's box**: `install`/`upgrade` write the hop's `/usr/bin` and
   `dpkg/status`, and `list -u` reads the hop's manifest (already so; a test proves it).
3. **The rollback line is placed by the server.** `dpkg.log` on box X names the address X sees
   the shell beneath at: the hop's LAN address when it stands on X's segment; its address on X's
   deeper segment when it reaches that segment through a gateway (`segmentsReachedFrom`, as the
   doors use); the public address of the hop's network when X is off that network. `source_ip` is
   neither sent nor read; a caller box with no session behind it is 403 `no_session`. From the
   base shell on your own workstation nothing changes.
4. **The ftp transfer line uses the same rule.** The caller is the shell's box (the `ftp>` prompt
   is never a vantage, 4b), so the transfer line names the same address as the ftp login line on
   that box.
5. **The rule is the same whoever owns X; ownership decides only the row.** A player-owned box
   today always gets the public address of the caller's network, even from a fellow occupant on
   its LAN, so its `dpkg.log` would disagree with its `auth.log` login line. It moves onto the
   same placement.
6. **The Done-when 4 test enumerates every `network`-category command.** Each is either in the
   hop table — the 18 IP tools in decision 2, each run in a remote shell with the home card off:
   a tool that calls the server sends the shell's box as `callerMachineId`; one that makes no
   server call (`ping`, non-axfr `dig`/`nslookup`, `apt`) gives a result only the hop's network
   can — or in a named "not an IP tool" list with its reason: `daemon`, `kill`, `ps`, `systemctl`
   act on the box itself; `ifconfig` is the readout (decision 9); `whois` is vantage-free
   (decision 2). A command added later that is in neither list fails. The radio tools are the
   `wifi` category and stay out by design.
7. **`man apt` says "the network you are on"**, not "a network connection".
8. **Wire-checks**: `scripts/testAptDowngradeTrace.ts` and `scripts/testFtpTransferTrace.ts`
   move to server placement — a LAN hop, a deep segment, a foreign hop naming the public address,
   `no_session`, and a client `source_ip` shown to be ignored. `scripts/testRemoteAptInstall.ts`
   is rerun unchanged.
9. **Out of scope**: the close-out (handbook ch. 7, `cross-player-architecture.md` §8, the two §9
   backlog items, retiring this file) — a `docs(v2):` commit after this PR, as planned above.
