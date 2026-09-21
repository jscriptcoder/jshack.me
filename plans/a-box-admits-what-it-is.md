# Plan: World Content Slice 2 — A Box Admits What It Is

**Epic:** `plans/world-content-epic.md` — slice 2. Grill record: the epic's "Locked decisions"
1–25. **One owner decision was taken at planning** (2026-09-21), recorded under "Decided at
planning" below and in the epic: the player's own workstation gains an empty `/home/guest`.

**Status:** Active — planned 2026-09-21. Not started.

**Delivery:** One independent PR against trunk (the convention every world-content and parity
slice used). **v0.249.0**, bumped in both `v2/package.json` and `v2/package-lock.json`
(`npm install --package-lock-only`).

**Branch (proposed):** `feat/a-box-admits-what-it-is`.

---

## Goal

Whatever tier a player reaches on a generated machine, the box tells them more about itself:
a guest lands in a real home, anyone can read an `/etc` that names the box and its true
neighbours, and root finds the history of the person who ran the machine — the services it
really runs, the files it really has, the neighbours that really answer.

## Scope boundary

**In:**
- **`/etc` breadth** on every NPC host built by `buildRemoteHostFs` — every role, every prefix,
  LAN and deep: `hostname`, `hosts`, `resolv.conf`, `motd`, `fstab`, `crontab`. Existing `/etc`
  files (`passwd`, the role config, `bind/`, `redis/`) are untouched.
- **`/root` content** on the same boxes: `.bashrc`, `.profile`, `.bash_history`, and 0–2 notes.
- **`.ssh/`** — assigned here by slice 1's plan. `known_hosts` in `/root/.ssh/` on every LAN NPC,
  and `known_hosts` + `config` in `~/.ssh/` on LAN `desktop|laptop|workstation` homes (the homes
  slice 1 furnished). Deep boxes get no `.ssh/` — they have no neighbours to have met.
- **`/home/guest`** on the same boxes, holding the Debian skeleton (`.bashrc`, `.profile`,
  `.bash_logout`) and nothing else.
- **An empty `/home/guest` on the player's workstation** (decided at planning, see below).

**Not built here, deliberately** (each has its own slice in the epic):
- Rotated logs and `syslog` → slice 3. Web → 4. DB/Redis → 5/6. Mail (`/var/mail`) → 7.
- IoT overlays → 9. **Gateways** (AP, inner router/switch, deep routers/switches — `routerFs.ts`)
  → slice 10, which owns everything a gateway holds, `/etc` included.
- Phone/tablet overlay → 11. Phones get this slice's `/etc`, `/root` and `/home/guest` like every
  other NPC box; slice 11 may reshape a phone's tree as a whole.
- `/etc/os-release`, `/etc/issue`, `/etc/debian_version` — they carry versions (decision 21).
- `/etc/group`, `/etc/shadow` — account-bearing (see "Guest-readable files name no account").
- `/etc/timezone` — one fact per network would need a new network-level stream for one line.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Nothing pairs an in-game account with a working secret. Root's history may name a neighbour's USERNAME (`ssh tnguyen@…`), never a password. |
| 3 | No new verbs. A history may show commands the game has no binary for (`vim`, `apt`, `journalctl`). |
| 4 | Every host, IP, `.lan` name, port and path named is true — see "What 'true' means" below. |
| 5 / 22 | Dates inside content (root notes) fall inside the box's life, ending at `WORLD_EPOCH`. |
| 6 | NPC boxes get content. The player workstation gains only the empty `/home/guest` (planning decision). |
| 13 | `/etc` files world-readable; `/root` root-only; `/home/guest` guest-tier. |
| 14 | `/etc/passwd` stays three rows. |
| 15 | New concerns draw from NEW streams: `etc-content-<essid>-<ip>`, `root-content-<essid>-<ip>` and `ssh-content-<essid>-<ip>` (so slice 1's `home-content-` homes stay byte-identical). `/home/guest` draws nothing. `host-fs-`, `etc-config-` and slice 1's streams gain no draw. |
| 16 | Pools authored fresh, static data. |
| 17 | Variety tested within and across networks. |
| 21 | Version-free: no version in any file, history line, motd or note. |
| 23 | Pins that move (exact `/etc` listings, the player workstation's exact tree) are updated deliberately. |

## Decided at planning (2026-09-21)

**The player's workstation gains an empty `/home/guest`** — guest-tier, owned by `guest`, no
dotfiles. Asked because it touches decision 6's "player workstations stay a fresh install".
**Why:** every box's `/etc/passwd` names `/home/guest`, and `ssh`/`su` land a guest session there
(`homeDirectory`), so today a guest — including a cross-player attacker who cracked a player's
guest password — lands in a directory that does not exist. A fresh Debian install with a guest
account HAS that directory, so this is plumbing, not content (decision 3's own example), and it
does not lie about whose box it is. **Accepted cost:** the player workstation's exact-tree pin and
its serialized cross-player tree both change.

---

## What "true" means here (decision 4, applied to this slice)

- **The segment a box sees** is slice 1's rule, unchanged: a LAN NPC's neighbours are
  `generateHomeLan(essid).hosts` minus itself (membership decided by ip AND hostname); a deep NPC
  has **no neighbours**, and its tree stays byte-identical whether or not its layer hangs a child.
- **`/etc/hosts`** — `127.0.0.1 localhost`, `127.0.1.1 <hostname>.<zone> <hostname>` (deep boxes:
  `127.0.1.1 <hostname>`, since a deep box has no `.lan` zone to claim), the standard IPv6
  localhost lines, and on a LAN box **0–3 static entries for neighbouring MACHINES**, each
  `<ip> <hostname>.<zone> <hostname>` — exactly what `resolveLanName` answers. Gateways are never
  listed (two routers can share a hostname — conventions §1, X1).
- **`/etc/resolv.conf`** — `nameserver <subnet>.1` and, on a LAN box, `search <zone>`. On the LAN
  the `.1` is the AP gateway, which IS the resolver (`resolveName.ts`); on a deep layer `.1` is the
  fronting gateway's downstream interface, an address that exists on that layer.
- **`/etc/fstab`** — mounts only paths the box has (`/`, `/boot`, swap), UUIDs seeded.
- **`/etc/crontab`** — Debian's header plus root-column jobs whose every path exists on the box.
  No `run-parts /etc/cron.*` lines (those directories do not exist).
- **`/root/.bash_history`** — the same rules as slice 1's history (paths the box has, network lines
  only from `machineCommandOptions` against real LAN neighbours, gateways by IP only, nothing on a
  deep box), plus **lines generated from the box itself**: `systemctl status|restart <daemon>` only
  for services it runs (`hostServices` + `daemonName`), `cat|vim` of its real `/etc` files (the
  role config, `bind/named.conf`, `redis/redis.conf` where present), `tail` of its real logs.
- **`known_hosts`** — one line per neighbouring MACHINE that runs `ssh`: `<hostname>,<ip>` on port
  22, `[<ip>]:<port>` otherwise, then a seeded `ssh-ed25519` key blob (fiction — nothing in the game
  checks host keys). 1–4 entries; a box with no `ssh`-running neighbour has no `.ssh/` at all
  rather than an empty file. **`~/.ssh/config`** — 1–2 `Host` blocks for some of those same
  neighbours: `HostName` (ip or `.lan` name), `User` = that neighbour's real uid-1000 account
  (`npcUsername`), `Port` only when not 22. Both live under root- or user-tier directories, so
  naming accounts there is fine.
- Things outside the game (an `apt` mirror, `github.com`) are fiction and exempt.

## Guest-readable files name no account

`configFiles.ts` already holds this rule for `/etc`: `/etc/passwd` is guest-unreadable because the
account names and hashes are what the cracking curve makes a player earn, so **no world-readable
file names the box's uid-1000 account**. It extends to every new `/etc` file: `crontab` jobs run as
`root` only, `motd` addresses nobody by username. `/root` is root-only, so root's history may name
accounts (its own box's and neighbours'). `/home/guest` holds only the skeleton.

## Permissions (resolves an "Open for planning" item)

| Content | Tier | Constant |
|---|---|---|
| New `/etc` files | read all, write root | reuse `SERVICE_CONFIG_FILE`; widen its doc comment from "a role's config" to "an `/etc` file" |
| `/root/*`, `/root/.ssh/*` | root only, never executable | new `ROOT_FILE` in `baseFs.ts` (Debian `/root` files are 0600/0644 inside a 0700 dir; root-only matches what a player can reach) |
| `~/.ssh/` and its files in a desk home | user tier | reuse `HOME_DIR` / `HOME_FILE` (Debian's 0700/0600 is at least this tight; guest already cannot reach the home) |
| `/home/guest` | read/traverse all, write root + guest | new `GUEST_HOME_DIR` in `baseFs.ts` (Debian's 0755 home) |
| `/home/guest/*` | read all, write root + guest | new `GUEST_HOME_FILE` in `baseFs.ts` |

---

## Slice

**Required implementation skills:** `tdd`, `testing`, `functional` throughout; `refactoring` after
green (e.g. whether slice 1's history-truth helpers want sharing with root's history);
`mutation-testing` at PR readiness.

### PR2 — A box admits what it is

**Value**: A guest landing on any NPC box gets a working home; anyone who reads `/etc` learns the
box's name, its resolver and a few true neighbours; a user finds the neighbours their `.ssh/` has
met; a player who escalates to root finds a history that describes this exact machine and names
neighbours that answer.
**Path**: `ssh guest@<host>` / `hydra` → `ls -a ~` → `cat /etc/hosts` → `su` → `cat
/root/.bash_history` → `buildRemoteHostFs` (client `activeRoot`, server session handlers — the same
pure builder) → new `/etc`, `/root`, `/home/guest` builders → replay a named neighbour → it answers.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk.
**Decisions**: 2, 3, 4, 5, 6 (as decided at planning), 13, 15, 16, 17, 21, 22, 23.

**Acceptance criteria**
- [ ] **A guest has a home.** On every NPC box, `/home/guest` exists, owned by `guest`, guest-tier
      readable and writable, holding `.bashrc`, `.profile` and `.bash_logout` (the Debian skeleton,
      byte-identical to slice 1's). On the player workstation, `/home/guest` exists and is empty.
      A guest session's `ls` in its home succeeds on both.
- [ ] **`/etc` breadth.** Every NPC box has `/etc/hostname` (its hostname), `hosts`, `resolv.conf`,
      `motd`, `fstab` and `crontab`, world-readable, root-writable, owned by root. Existing `/etc`
      files are byte-identical to today's.
- [ ] **`/etc` is true** (property test, all 50 catalog networks + a spread of non-catalog ESSIDs,
      every NPC box on every layer): every IP and name in `hosts` resolves to that IP on the
      network; `hosts` lists no gateway; `resolv.conf`'s nameserver is the box's `<subnet>.1` and
      its `search` is `lanZoneName(essid)` on LAN boxes only; every path in `fstab` and `crontab`
      exists on the box.
- [ ] **Guest-readable files name no account.** No new world-readable file contains the box's
      uid-1000 username; every `crontab` job runs as `root`.
- [ ] **The place shows in `motd`.** A box's `motd` carries its network persona's place and its own
      hostname (e.g. a Waystar Royco banner on `WAYSTAR-WIFI`, a café's on `BEAN-THERE-WIFI`).
- [ ] **Root keeps a history.** Every NPC box has `/root/.bashrc` and `/root/.profile` (Debian's
      root versions) and `/root/.bash_history`, root-only; 0–2 root notes. Guest and user tiers
      cannot list `/root`, as today.
- [ ] **Root's history describes this box** (property test, same population): every `systemctl`
      line names a daemon the box runs; every `/etc`, `/var/log` or other path named exists on the
      box; every network line passes slice 1's truth oracle (`falsehoodIn`); gateways by IP only.
      A box running at least one service has at least one line naming one of them.
- [ ] **A box remembers who it met.** Every LAN NPC with at least one `ssh`-running neighbour
      has `/root/.ssh/known_hosts`; every such LAN `desktop|laptop|workstation` home has
      `~/.ssh/known_hosts` and `~/.ssh/config`, user-tier. With no such neighbour, no `.ssh/`.
      Every `known_hosts` entry is a neighbouring machine running `ssh` on the port the entry
      states; every `config` block's `User` is that neighbour's real account and its `Port`
      (absent means 22) is where its `sshd` listens. `ssh <Host-alias's HostName>` as that user
      reaches a login prompt. No gateway appears.
- [ ] **A deep box names nothing.** A deep NPC's `hosts` lists only localhost and itself, it has no
      `.ssh/`, its root history carries no network line, and its whole tree is byte-identical whether or not its
      layer hangs a child.
- [ ] **Dates and versions.** Every date in a root note falls within 730 days before
      `WORLD_EPOCH` and strictly before it; no new file carries a software version (slice 1's
      version detector) or a password.
- [ ] **Variety.** Within one network, no two boxes share a byte-identical `motd`, root
      `.bash_history`, root note or `.ssh/config`. Across the catalog, ≥ 95% of root histories and ≥ 90% of root
      notes are distinct (measured at implementation; raised if the measurement allows, never
      lowered without saying so here). The skeleton dotfiles, `resolv.conf` and the IPv6 lines of
      `hosts` are shared by design (decision 17's facts exemption).
- [ ] **Nothing already pinned moves** except deliberately: every password, username, service,
      role config and page pin stays green without edits; the exact-`/etc`-listing pins and the
      player workstation's exact-tree pin are updated in the same commit as the change that moves
      them.
- [ ] **Budgets hold.** `npm run build` passes both ceilings; record the new bundle bytes and ms/box
      in the as-built.
- [ ] **Played** (`v2-e2e`): crack a catalog network, `ssh guest@<npc>` → `ls -a` shows the
      skeleton; `cat /etc/hosts` → `ping`/`nslookup` a listed neighbour answers; escalate to root
      (`su` with the box's root password, derived offline) → `cat /root/.bash_history` → replay one
      network line and one `systemctl status` line, both true.

**Tests to watch** (mutation-aware, from the mutator rules): the 0–3 hosts-entry bound (0 and 3
both reachable); the 0–2 root-note bound; the LAN-vs-deep branch for `search` and hosts entries
(deep has neither); "gateway never in hosts" (a `kind` filter one deletion from gone); the
service-derived history lines (a box with no service has no `systemctl` line; one with two may name
both); the non-22 port spellings in `known_hosts` (`[ip]:port`) and `config` (`Port` line
present iff ≠ 22); the username-exclusion rule (a crontab user column other than `root` fails it).

**Mutation**: scoped Stryker run on the new modules at PR readiness (lazy fixtures — the slice 1
lesson: a module-level fixture that throws under a mutant reports "no tests" and counts Survived).
**Wire-check**: `N/A` — no `api/` change; NPC trees never cross the wire. The player workstation's
serialized tree changes by one empty directory; `resolveCrossPlayerFs`'s existing tests cover the
codec round-trip.
**PR-ready when**: criteria met; typecheck, lint, `test:run` and `build` green; mutation gate
recorded; played run recorded; commit approved.

---

## Open at implementation (named, deliberately not decided)

- Module shape: `generation/etcContent.ts`, `generation/rootHome.ts`, and where `.ssh/` lives
  (its own module, or beside the root builder) — or fewer — pick whichever keeps `buildRemoteHostFs` a list of calls.
- Whether root's history and slice 1's history share a "truth" helper (paths the box has,
  network lines) — a refactoring decision after green, not a design one.
- How many root-history lines each role's pool needs to meet the 95% bar.
