# Plan: Operate from a hop

**Status**: Grilled and gap-reviewed. Decisions confirmed by the owner 2026-10-04 (grill, then a
`find-gaps` pass that added 4a, 4b, 7a, 11a, "Out of scope" and "Done when"); nine slices
planned and approved the same day. Slices 1–2 done (#598 v0.307.0, #599 v0.308.0). Next: slice 3.
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

The close-out (as-built docs, §9 cleanup, retiring this file) is a `docs(v2):` commit on `main`
after slice 9, not a slice.

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

**Value**: the chain the feature exists for — a target's log names the last hop's network, and
each hop's log names the one before.
**Path**: `ssh`'s public and inner-gateway-forward paths send `caller_machine_id` from a hop →
`authCreateSessionPublic` / `authCreateSessionInnerGateway` trace via `resolveVantageSourceIp`.
**Decisions**: 1, 4a, 7. **Done-when**: 1, 3.
**RED**: the chain wire-check (`home → P → Q → third gateway`, trace walk-back, then a root wipe
on Q ends the trail at Q).

### Slice 5: A chain breaks where a hop goes down

**Value**: a reboot evicts an intruder from everything they reached through that box.
**Path**: `rebootMachine` (and the dark/brick path) end the sessions on the box → every session
whose `parent_session_id` chain runs through them ends with `upstream_lost` (server-only reason)
→ the terminal drops to the deepest surviving hop printing `Connection to <host> closed by
remote host.` per leg → rehydration ends an orphaned child the same way.
**Decisions**: 11a. **Done-when**: 5.

### Slice 6: `nmap` from a hop sweeps the hop's LAN and traces to the hop

**Value**: reconnaissance from where the player stands.
**Path**: `nmap` takes its vantage from the top session for both own-LAN and public scans →
`resolvePublicScan` gains a caller machine and traces via `resolveVantageSourceIp` →
`pivotVantageForMachineId` / the `nmapScanDeep` special path fold into the general vantage.
**Decisions**: 2, 10. **Done-when**: 6 (the single-player browser run lands here: two-hop chain,
`ifconfig`, `nmap` of the hop's LAN, `exit`).

### Slice 7: The web tools run from a hop

`curl`, `lynx`, `gobuster` — reachability and trace from the vantage; `curl` still needs no
session from home (decision 6). **Decisions**: 2, 6.

### Slice 8: The credential and service tools run from a hop

`hydra`, `mysql`, `redis-cli`, `snmpwalk`, `snmpset`, `msfconsole`. ⚠ The largest tool slice;
if it runs big, split `hydra`/`msfconsole` from the database and SNMP clients. **Decisions**: 2.

### Slice 9: The remaining IP tools run from a hop

`ftp`, `scp`, `nc`, `ping`, `dig`/`nslookup` (names resolve against the vantage), `apt` (a hop's
network is online). Adds the test that enumerates every IP tool in decision 2 and proves each
carries the shell's box. **Decisions**: 2, 3, 8. **Done-when**: 4.
