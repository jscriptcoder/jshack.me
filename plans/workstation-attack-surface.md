# Plan: A workstation worth attacking

**Status**: Grilled. Decisions confirmed by the owner 2026-10-07; slices not yet planned.
Resolves item 4 of the sandbox-hardening order in `docs/conventions-and-gotchas.md` §1 ("give a
player's own box an attack surface") and the §9 idea "Workstation daemon expansion". Where they
disagree with this file, this file wins.

## Goal

Every player's workstation is born running a few services, so another player has something to go
after from the first day. The services are born clean; the world clock that already publishes
CVEs against every package then opens holes in them over the following days, and the owner has to
notice and patch (`apt upgrade`) or shut them down (`systemctl stop`). Nothing tells them to.
Giving a player a reason to keep a service running despite the risk is a later epic.

## Where it starts from (facts, 2026-10-07)

- **A fresh workstation runs nothing.** `workstationFs.ts` ships `sshd` and `vsftpd` binaries in
  `/sbin` with no pidfile, so `nmap -sV` on a fresh box shows no open port and `hydra` answers "no
  such service". Its weak `guest` account (`workstationGuestPassword`, drawn from the crackable
  pool) is reachable by nobody until something listens.
- **The CVE half is built** (`docs/vulnerability-architecture.md`). Every service and library has a
  timeline on one shared world clock: a hole every 3–14 game days, a fix 1–2 days later.
  `nmap -sV`, `apt list -u`, `apt upgrade`, `msfconsole <host> <port>` and
  `msfconsole --local` all exist, as do traces and reboot eviction.
- **A player's libraries are born at the start tuple** and so already carry permanent live holes
  (the world is at about day 87). `apt install` gives the newest safe release through the same
  resolver as an upgrade.
- **A player's own `mysql` and `redis` already have a fresh-install shape.** `mysql/ownDatabase.ts`:
  a login table with one row, drawn accounts on the usual crack ladder, root mirroring the box's
  chosen root password. `redis/ownStore.ts`: empty, locked with the box's root password.
- **Reboot leaves pidfiles alone** and nothing models "enabled at boot" (by grep, not yet run): a
  service runs until someone stops it.
- **The boot screen lies today.** `ui/screens/BootScreen.tsx` prints a hardcoded
  `[  OK  ] Started OpenSSH server.` on every boot although no `sshd` runs.
- **Who can reach a workstation:** a fellow occupant of the same ESSID directly; anyone else
  through the shared AP gateway (its admin password is drawn on `CRACK_CHANCE.gateway`) and then
  from that hop onto the LAN. The AP forwards nothing by default.
- **Hydra probably already sweeps a player's running database.** `hydraCrack` reaches a fellow
  occupant's workstation through the shared `reachServiceHost` (`sessions/serviceHost.ts`), which
  rebuilds the box and reads its real running services and accounts. So the §9 note "extending
  cross-player hydra is ~10 LOC" is probably stale. Confirm while planning; not yet run.
- **The server rebuilds a workstation from the owner's identity alone**
  (`materializeWorkstationFs`). There is **no per-box creation timestamp**: the only
  `created_at` is on `home_network_occupants`, keyed `(essid, owner_key)`, which is per network
  joined rather than per box. Decision 1 needs a creation day the server can rebuild from, so its
  source is the first open question for slice planning.

## Decisions (owner-confirmed 2026-10-07)

1. **Starting services are born clean:** at the newest release on the day the box is created. The
   clock does the rest. A box created inside a patch-delay window starts exposed, like everyone
   else on that release.
2. **LAN only.** The AP forwards nothing by default. Reaching a box means getting onto its network
   first (same WiFi, or the AP's admin and a hop), then onto the box. A player can still publish a
   service by adding a forward. A UPnP-style auto-forward was rejected: the AP and its public
   address are shared per ESSID, so two occupants' services would contend for one public port.
3. **Every workstation starts with 1–3 services, never zero.** A box born with nothing would sit
   outside the loop the playtest exists to test.
4. **The pool:** `sshd`, `vsftpd`, a web server (`nginx` or `apache2`, 50/50), `mysqld`,
   `redis-server`. Not `snmpd` or `named`: network infrastructure, not desktop services.
5. **The draw:** 1, 2 or 3 services with equal odds, distinct, seeded from the owner's identity
   like everything else on the box. `new-game` makes a new identity, so it re-draws.
6. **A starting service is exactly what `apt install` plus a start would leave:** the manifest
   entry at the creation day's newest safe release, the binaries, the config, the fresh-install
   database or store from `ownDatabase` / `ownStore` (root mirroring the player's chosen
   password), and a pidfile. One path, no second generator.
7. **Libraries stay as they are: born at the start tuple, with no warning.** This is realistic: the
   base system comes from an old install image while what was installed on day one came fresh
   from the mirror. It means a first-day chain exists against a player who never patches:
   `hydra` `guest` over `sshd` → carry `msfconsole` in → `msfconsole --local` → root. An
   Ubuntu-style "N updates can be applied" login notice was proposed and **rejected**: players
   find out the hard way.
8. **The boot sequence shows the services that started:** one `[  OK  ] Started …` line per
   running service, driven by the box rather than hardcoded. This replaces today's unconditional
   OpenSSH line. It is realistic output, not a hint.
9. **Password guessing stays as built.** A sweep reaches `guest` (ssh, ftp) and a database's
   lower accounts. A player's database root and redis lock mirror the root password they chose
   at `new-game`, so they are out of a wordlist's reach; the CVE route or the box's own root is
   the way to the top. Weakly set up starting services (a crackable or absent lock) were
   rejected: a player's own box carrying random passwords for its own services is less
   realistic than one carrying theirs.
10. **Existing workstations gain services on their next rebuild** (no backward-compat burden
    until launch). Their creation day comes from whatever the server can derive; see the last
    fact above.
11. **Proof:** a wire-check that the server's rebuild of A's box carries the same services at the
    same versions as A's client; a two-player browser run in which B, on A's LAN, sees A's
    services and gets in through `guest` over `sshd`. That run is stageable for the first time,
    because a fresh box is no longer bare.
12. **The reason to keep a service running is deferred to its own epic**, possibly a special
    service with something to offer. Recorded in §9 when this epic closes.

## Open questions for slice planning

- Where the creation day lives so the server can rebuild the same box: a stored per-player
  timestamp, the earliest occupancy row, or writing the starting install into the journal at
  first boot instead of the base tree.
- Whether hydra needs any change at all for a workstation's `mysqld` / `redis-server` (fact
  above).
- The memory and doc claims that a fresh player box has no attack surface go stale when this
  ships; update them at close-out.
