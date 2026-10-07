# Plan: A workstation worth attacking

**Status**: Grilled and planned. Decisions confirmed by the owner 2026-10-07; two slices planned
and approved the same day (decision 10 refined while planning: a box is born on its first boot).
Next: slice 1.
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
- **Hydra already sweeps a player's running database and store.** `hydraCrack` reaches a fellow
  occupant's workstation through the shared `reachServiceHost` (`sessions/serviceHost.ts`), which
  rebuilds the box and reads its real running services and accounts; `testMysqlCrossPlayer`,
  `testMysqlSameLan`, `testRedisCrossPlayer` and `testRedisSameLan` drive it live against a
  player-installed `mysql`/`redis`. The §9 note "extending cross-player hydra is ~10 LOC" is stale.
- **The server rebuilds a workstation from the owner's identity alone**
  (`materializeWorkstationFs`), plus the box's journal. There is **no per-box creation
  timestamp**: the only `created_at` is on `home_network_occupants`, keyed `(essid, owner_key)`,
  which is per network joined rather than per box.
- **A player's own box writes straight to the server's journal.** `apt install`
  (`commands/apt.ts` `installPackage`) and a daemon start (`commands/daemon.ts` `bringUp`) both
  persist through `env.patches.write`; the boot screen reads the journal on every entry
  (`ui/state.ts` `resolveBootCheck`). `sshd` and `vsftpd` are base-image packages
  (`BASE_IMAGE_PACKAGES`), so `apt install` on them upgrades them to the newest release.

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
10. **A box is born on its first boot, and existing workstations gain services on their next
    boot** (no backward-compat burden until launch), born that day. *Refined while planning:*
    the grill assumed a server registration timestamp, and none exists per box. Instead the
    starting install is written into the box's journal at first boot (see "How a box is born"),
    so no creation day is ever stored or derived.
11. **Proof:** a wire-check that the server's rebuild of A's box carries the same services at the
    same versions as A's client; a two-player browser run in which B, on A's LAN, sees A's
    services and gets in through `guest` over `sshd`. That run is stageable for the first time,
    because a fresh box is no longer bare.
12. **The reason to keep a service running is deferred to its own epic**, possibly a special
    service with something to offer. Recorded in §9 when this epic closes.

## How a box is born (owner-approved while planning, 2026-10-07)

- **First boot provisions; the base tree stays a pure function of the identity.** On the boot
  screen's entry, after the journal is read, a box with no provisioning marker draws its services
  (decision 5) and, for each, runs the same install core `apt install` runs (binaries, libraries,
  extra files such as `ownDatabase`/`ownStore`, the manifest row at the day's newest release) and
  the same pidfile write a start makes, all through the ordinary journal writes. The marker is
  written LAST: a failed write (server down) leaves it absent, the boot carries on with whatever
  landed, and the next boot tries again.
- **The marker** is a root-owned file in the shape of cloud-init's
  `/var/lib/cloud/instance/boot-finished` (the real-world "first boot already ran" file). Exact
  path settled in slice 1.
- **No trust is lost by letting the client do it.** A tampered client that skips or alters
  provisioning gets nothing an honest owner cannot get with `systemctl stop` or `apt install`,
  and versions on the owner's own manifest are already theirs to write
  (`vulnerability-architecture.md`: lying is pointless rather than punished).
- **The server needs no change.** It sees the services the way it sees any install: by replaying
  the journal over the base tree.
- **Accepted risks.** Two tabs booting a brand-new box at the same instant may both provision;
  the draw and the day are the same, so they write the same content, and that is accepted rather
  than locked. A root intruder who deletes the marker makes the owner's next boot provision again,
  laying fresh services at that day's release; harmless, so accepted.

## Done when

1. **A new player's box runs its services from the first prompt.** `ps`, `systemctl status`,
   `nmap localhost` and `nmap -sV` agree on 1–3 services from the pool, and `apt list -u` shows
   none of them exposed on the day the box was born.
2. **Another player sees and sweeps them.** A wire-check: B, an occupant of A's ESSID, scans A's
   box and finds exactly the ports A's first boot provisioned, at the versions it wrote; when
   `sshd` is among them, `hydra` finds `guest`.
3. **Provisioning runs once.** A second boot of the same box changes nothing, and a service the
   owner stopped stays stopped.
4. **The boot screen tells the truth.** One `[  OK  ] Started …` line per running service, and
   no OpenSSH line on a box without `sshd`.
5. **The real client shows it.** A single-player browser run of a fresh `new-game` (slice 1), the
   boot screen (slice 2), and at close-out a two-player run: B on A's LAN gets a `guest` shell on
   A's box over `sshd`.
6. **The docs say it.** `vulnerability-architecture.md` says how a workstation is born; §9 gains
   the "reason to keep a service running" epic (decision 12) and loses the stale "~10 LOC" note;
   the "fresh box has no attack surface" claims are corrected.

## Slices

Owner-approved 2026-10-07. Both slices are a **behavior change**, one independent PR against
`main`; slice 2 is cut after slice 1 lands (`/continue`). Each loads `tdd`, `testing` and
`refactoring` before code, confirms its acceptance criteria with the owner before RED, bumps the
version, and runs the mutation gate once at PR readiness (json reporter, one file scope at a time,
`conventions-and-gotchas.md` §4).

The close-out (the two-player browser run, the docs in done-when 6, the memory correction,
retiring this file) is a `docs(v2):` commit on `main` after slice 2, not a slice.

### Slice 1: A workstation's first boot leaves it running 1–3 services, born clean

**Value**: every player has something to defend from their first prompt, and every other player
on their network has something to find.
**Path**: boot screen entry → `resolveBootCheck` reads the own journal → no marker → the seeded
draw (`core/`, from the owner key) → per package, the install core and the start write through
`patches.write` → marker → journal. Server side unchanged: scans and sweeps replay the journal.
**Decisions**: 1–7, 9, 10. **Done-when**: 1, 2, 3, and the slice-1 half of 5.
**First, a pure refactor**: lift the install core out of `apt`'s `installPackage` generator (which
interleaves terminal lines and sleeps) and the pidfile write out of `bringUp`, so the `apt`
command, the daemon commands and provisioning share one path. Preserved by the existing `apt`,
daemon and `systemctl` tests staying green, no behavior change. Its own commit; split into its own
PR only if the diff makes review hard.
**RED**: the draw: 1–3 distinct services from the pool, a web draw being `nginx` or `apache2`,
the same identity always drawing the same set. Provisioning: an unprovisioned box comes out with
each drawn service's pidfile, binaries and a manifest row at `newestReleaseOn(day)`, the database
or store for `mysql`/`redis` locked with the box's root password, and the marker; a provisioned
box is left untouched; a stopped service stays stopped. Live: a new
`scripts/testWorkstationBirth.ts` (done-when 2), seeding A's journal through the real provisioning
writes. It touches no `api/` code; its job is to prove the server reads what the client wrote.
**Watch for**: the boot runs before the terminal mounts, so provisioning needs a `patches.write`
seam outside a `CommandEnv`; the `apt` path's `reachesRepo` (WiFi) gate must not apply, since a
fresh box has joined no network; `installPackageLibraries` restores missing `.so` files, which must
not move any library's VERSION (decision 7); `new-game` mints a new identity and so a new machine
id, which must reprovision.

### Slice 2: The boot screen prints a line for each service that started

**Value**: the owner sees at a glance what their box runs, as a real boot shows it.
**Path**: `BootScreen.tsx`'s hardcoded `[  OK  ] Started OpenSSH server.` → lines derived from
the running services on the box the boot check already materialized (after slice 1's
provisioning). Copy per service in the systemd style (`Started OpenSSH server.`, `Started MySQL
Community Server.`, …), settled with the owner at the acceptance-criteria step.
**Decisions**: 8. **Done-when**: 4, the slice-2 half of 5.
**RED**: a jsdom test (`@solidjs/testing-library`): a box running `mysqld` and `nginx` prints both
lines, and a box without `sshd` prints no OpenSSH line. No wire-check (no `api/` change);
browser proof via the `e2e` skill.
**Watch for**: the line list is static timing data today; the services arrive asynchronously
with the boot check, so the lines must wait for it without stalling the animation.
