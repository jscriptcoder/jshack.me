# Plan: Operate from a hop

**Status**: Grilled. Decisions confirmed by the owner 2026-10-04; slices not yet planned.
Resolves two §9 backlog items in `docs/conventions-and-gotchas.md`: "Pivot / operate-from-a-hop —
source-IP masking only; ssh-from-a-pivot" and "Four tools cannot pivot: `ssh`, `nmap`, `curl`,
`lynx`". Where they disagree with this file, this file wins.

## Goal

A shell on a box is a place to stand. Every network command run inside it travels from that box:
it reaches what that box's network reaches and is logged under that box's address. A player can
chain hops (home → A → B → C) and attack D from C, so D's logs name C, not them. A defender can
follow the trail back one hop at a time by breaking into each hop and reading its `auth.log`, and
an attacker who holds root on a hop can cut the trail there by wiping its logs.

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
- **A wipe by a non-owner does not stick (by reading, not yet run).** A clear or `rm` of a log is
  written under the WIPER's key. The next system append (`appendMachineLog`) reads the LOG
  WRITER's own row, which still holds the old lines, appends, and upserts it as the newest row,
  so the wiped lines come back. The same holds for B wiping A's log on A's box. This contradicts
  the locked cross-player decision 7, "root can clear logs".
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
   from client-side resolution to the server.
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

### Covering tracks

12. **Wipes stick.** A root-tier write or `rm` of a log on a box the player does not own becomes the
    base later system appends build on, ending the resurrection. Root on every hop severs the
    trail; a hop held only at guest/user tier keeps its log. This honours cross-player decision 7.
13. **The fix covers every system-appended log on every kind of box** — `auth`, `kern`, `access`,
    `vsftpd`, `mysql`, `redis`, `snmpd`, `named` — on NPC and player boxes alike. Permissions
    already stop anyone below root.
14. **Measure first.** A wire-check reproducing the resurrection precedes any fix plan; the
    resurrection is so far established only by reading.

### The defender

15. **No new defender verbs.** Trace-back is `auth.log` → `whois` → break into the hop → repeat.
    Player commands still leave no `.bash_history` on a hop; a forward trail is not part of this
    feature.
16. **A handbook page, "where your traffic comes from".** The change alters every network command
    inside a shell (`ssh 192.168.1.5` from a foreign box no longer reaches home), so players are
    told rather than left to discover it.

## Slices

Not yet planned.
