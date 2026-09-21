# Plan: World Content Slice 3 — A Box Remembers

**Epic:** `plans/world-content-epic.md` — slice 3. Grill record: the epic's "Locked decisions"
1–25. **Three owner decisions were taken at planning** (2026-09-21), recorded under "Decided at
planning" below and in the epic's status log.

**Status:** Active — planned 2026-09-21. Not started.

**Delivery:** One independent PR against trunk (the convention every world-content and parity
slice used). **v0.250.0**, bumped in both `v2/package.json` and `v2/package-lock.json`
(`npm install --package-lock-only`).

**Branch (proposed):** `feat/a-box-remembers`.

---

## Goal

Every generated NPC box keeps a record of its last day before the world began: `ls /var/log`
shows the rotated `.1` files and a `syslog`, and every line in them is something this box really
did — the cron jobs in its own crontab, the services it really runs, the neighbours that really
reached it — while the live logs stay empty, holding only what players have done since.

## Scope boundary

**In:**
- **A rotated `.1` history** beside the live logs on every NPC host built by `buildRemoteHostFs`
  — every role, every prefix, LAN and deep: `auth.log.1`, `kern.log.1`, `access.log.1`,
  `mysql.log.1`, `redis.log.1`, `named.log.1` (each only where the rules below put it).
- **`syslog`** (live, empty) and **`syslog.1`** on the same boxes.
- **The line shapes the live traces already use** — `logging/*.ts`' formatters are the one source of
  every shape, and new shapes (cron, PAM sessions, systemd, daemon notices) join those modules.

**Not built here, deliberately:**
- **Gateways** (AP, inner router/switch, deep routers/switches — `routerFs.ts`) → slice 10, with
  vendor-shaped firmware logs (decided at planning, below). The AP gateway's serialized tree is
  unchanged.
- **The player's workstation** — decision 6: a fresh install has no history.
- `.2` and later rotations (see "Resolved from Open for planning").
- `dpkg.log.1` — its lines carry versions (decision 10).
- `vsftpd.log.1` — every routine ftp line names an account (see "Only root and the daemons").
- `snmpd.log` — only gateways run an agent.
- Any change to a live log, an appender, or a server writer (decision 10: zero server change).

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Nothing pairs an in-game account with a working secret; no line carries a password. |
| 3 | No new verbs — `.1` files are plain text read with `cat`/`grep`/`tail`; no `.gz`, no `zcat`. |
| 4 | Every host, IP, name, port, path, table and job a line names is true — see "What 'true' means". |
| 5 / 22 | History is frozen and ends at the epoch; every line falls inside the box's life, in order. |
| 6 | NPC boxes only; the player workstation stays a fresh install. |
| 10 | History lives in rotated logs; live logs start empty and no appender changes. |
| 13 | A rotated log copies its live log's permissions exactly (world-readable, root-write). |
| 15 | One new stream, `log-history-<essid>-<ip>`. No existing stream gains a draw. |
| 16 | Pools authored fresh, as static data. |
| 17 | Variety tested within and across networks. |
| 21 | Version-free: no version in any line (slice 1's `softwareVersionsIn` detector). |
| 23 | Pins that move are updated deliberately. |

## Decided at planning (2026-09-21)

1. **Only root and the daemons appear.** Rotated logs are world-readable like the live logs they
   copy, so they keep slice 2's single rule for guest-readable content: **no line names an account
   a door accepts, except `root`.** The box's uid-1000 user, its ftp logins and its database's
   application accounts never appear. Asked because a guest already sees the username through
   `ls /home`, so the rule protects less than it appears to; the owner kept it anyway — one harsh
   rule over a carve-out. **Accepted cost:** the history reads as the admin's, never the user's,
   and `vsftpd.log.1` has no routine line it can hold (below).
2. **NPC hosts only.** Gateway kinds get their history in slice 10, beside their DHCP leases and
   admin pages, in their firmware vendor's shape rather than Debian's.
3. **Neighbours, routine only.** Remote lines come from real machines on the box's own LAN doing
   ordinary things — an admin's ssh login, a page fetch, a cache connection, a name lookup. **No
   brute-force noise and no hostile neighbour**: nothing else in the world says a neighbour is
   compromised, and a line claiming it would be the lie decision 4 forbids. A deep box names no
   neighbour (slice 1's rule), so its history holds only local activity.

## Resolved from "Open for planning"

- **How far rotations go: `.1` only.** Debian's logrotate uses `delaycompress`, so `.1` is the only
  plain-text rotation — `.2` onward is `.gz`, which would need `zcat` (refused, decision 3). A `.2`
  in plain text would be the less true shape.
- **Log permissions:** the `.1` files reuse their live log's constant (`AUTH_LOG_PERMISSIONS` …).
  `syslog` has no live constant yet; it gains `SYSLOG_PERMISSIONS` beside the shared formatters in
  `logging/syslog.ts`, the same world-readable, root-write tier as `auth.log`.

---

## The shape of the history

- **One day.** logrotate ran at `WORLD_EPOCH` (2026-07-12 00:00 UTC). Every `.1` holds
  **2026-07-11** — the Saturday before — and nothing else: first line at or after 00:00:00, last
  line at or before 23:59:59, in non-decreasing time order. One day for every file is one rule; it
  bounds what `cat` prints on a surface with no `LIMIT`, and a daily rotation is a real logrotate
  configuration.
- **A `.1` exists only when it holds a line** (Debian's `notifempty`: logrotate does not rotate an
  empty log). A box whose day left nothing in a log has no `.1` for it — never an empty `.1`.
- **A `.1` exists only beside its live log.** The daemon rules that place today's live logs (a log
  follows its service; `named.log` follows the name-server role) place its `.1` too, and a
  daemon's lines appear only where that daemon RUNS.
- **Every line is dated and names the box** the way its format does: syslog-shaped lines carry the
  box's hostname; `access.log`, `mysql.log`, `redis.log` and `named.log` keep their own stamps.

### What each file holds

| File | Lines (all on 2026-07-11) | Present when |
|---|---|---|
| `syslog.1` | `CRON[pid]: (root) CMD (<job>)` for every `/etc/crontab` job whose schedule fires that day, at the minute it fires; the day's systemd timer lines (apt, tmpfiles cleanup, man-db …); a box that rebooted that day also shows its services starting | always (the daily timers always run) |
| `syslog` | nothing | always |
| `auth.log.1` | `pam_unix(cron:session)` open/close for root around every cron run; on a LAN box running `ssh`, 0–3 admin visits: `Accepted password for root from <LAN machine>` + session opened/closed for root | at least one line |
| `kern.log.1` | a version-free boot sequence when the box rebooted that day (seeded rate), naming `/boot/vmlinuz` and the root UUID `/etc/fstab` mounts | the box rebooted that day |
| `access.log.1` | `GET / HTTP/1.1` 200 from LAN machines, the size being the byte length of the `index.html` the box really serves; deep boxes: from `127.0.0.1` only | the box serves http |
| `mysql.log.1` | `Connect root@127.0.0.1 on <its database>`, then `Query` lines from the shipped SQL surface (`SHOW TABLES`, `DESCRIBE <t>`, `SELECT * FROM <t>`) naming its real tables | `mysqld` runs |
| `redis.log.1` | `Client connected from <LAN machine>`; save notices (`Background saving started`, `DB saved on disk`) | `redis-server` runs |
| `named.log.1` | `zone <zone>/IN: loaded serial <the SOA serial>`; LAN lookups `client <LAN machine> (<name>): query: <name> IN A` for names that resolve | `named` runs on a name server |

Volume is shaped by what the box is: a busy role's own service log carries more lines than a
quiet one's. Numbers are set at implementation against a terminal-readable ceiling, and recorded
in the as-built.

## What "true" means here (decision 4, applied to this slice)

- **The segment a box sees** is slice 1's rule: a LAN NPC's neighbours are
  `generateHomeLan(essid).hosts` machines minus itself; a deep NPC has none, and its tree is
  byte-identical whether or not its layer hangs a child. Gateways never appear as a source.
- **Every IP a line names** is a neighbouring LAN machine or `127.0.0.1`.
- **Every cron line is a real job**: its command is byte-identical to a job in the box's own
  `/etc/crontab`, at a minute and hour that job's schedule fires on a Saturday. The history reads
  the crontab as built — one source, never a second draw.
- **Every daemon line names a daemon the box runs** (`hostServices` + `daemonName`), and an ssh
  admin visit happens only on a box whose `sshd` runs.
- **Every path is one the box has** (`/boot/vmlinuz`, `/`, a served `/`), every served size is the
  real page's byte length, every table is a table in the box's own database, every zone name
  resolves on the network, and every serial is the zone file's own.
- **No account but root** (decided at planning), **no version** (decision 21), **no password**
  (decision 2), and no path a live log does not already imply.

---

## Slice

**Required implementation skills:** `tdd`, `testing`, `functional` throughout; `refactoring` after
green (e.g. whether the crontab should be returned as structured jobs rather than re-read from
text); `mutation-testing` at PR readiness.

### PR3 — A box remembers

**Value**: A player who reads `/var/log` on any NPC box finds its last day: the jobs its root
scheduled running on time, the neighbour its admin logged in from, the pages it served, the
queries its database answered — every one of them something they can check on the box or reach
on the network — and a live log that holds only what players did.
**Path**: `ssh`/`hydra` → `ls /var/log` → `cat /var/log/syslog.1` / `auth.log.1` →
`buildRemoteHostFs` (client `activeRoot`, server session handlers — the same pure builder) → the
new log-history builder → `cat /etc/crontab`, `nmap`/`ssh` the named neighbour → it is all there.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk.
**Decisions**: 2, 3, 4, 5, 6, 10, 13, 15, 16, 17, 21, 22, 23, and the three taken at planning.

**Acceptance criteria**
- [ ] **A box keeps yesterday.** Every NPC box has `/var/log/syslog` (empty) and
      `/var/log/syslog.1`; every rotated file follows the table above, and a `.1` exists only
      beside its live log and only when it holds a line.
- [ ] **Live logs stay empty.** Every live log in a base tree is empty, as today; every existing
      "plants X empty where the daemon runs, and nowhere else" pin stays green without edits.
- [ ] **One day, in order** (property test, all 50 catalog networks + a spread of non-catalog
      ESSIDs, every NPC box on every layer): every line of every `.1` is dated 2026-07-11, and the
      lines of each file are in non-decreasing time order — so every last line is before
      `WORLD_EPOCH`.
- [ ] **Cron runs what the crontab says.** Every `CRON` line in `syslog.1` names a job in the box's
      own `/etc/crontab` at a time its schedule fires on a Saturday, and every such job appears at
      every time it fires; `auth.log.1` opens and closes a root cron session around each run.
- [ ] **The history is true** (property test, same population): every IP named is a neighbouring
      LAN machine or `127.0.0.1`; no gateway appears; every daemon named runs on the box; every
      `access.log.1` size equals the served page's byte length; every `mysql.log.1` table is in the
      box's database; every `named.log.1` name resolves on the network and its serial is the zone
      file's.
- [ ] **Only root and the daemons.** No line names the box's uid-1000 username or any account but
      `root`; no line carries a software version or a password.
- [ ] **A deep box names nothing.** A deep NPC's history names no IP but `127.0.0.1`, and its whole
      tree is byte-identical whether or not its layer hangs a child.
- [ ] **Permissions.** Every `.1` has its live log's permissions and owner exactly; `syslog` and
      `syslog.1` are world-readable, root-write, owned by root.
- [ ] **Variety.** Within one network, no two boxes share a byte-identical `.1` file. Across the
      catalog, ≥ 95% of `syslog.1` and ≥ 90% of `auth.log.1` bodies are distinct (measured at
      implementation; raised if the measurement allows, never lowered without saying so here).
- [ ] **Nothing already pinned moves** except deliberately: every password, username, service,
      role config, page and `/etc` pin stays green without edits. Root's history may name the new
      logs (slice 2 derives its log reads from the box's `/var/log`); that re-draws root histories,
      which no test pins byte for byte.
- [ ] **Budgets hold.** `npm run build` passes both ceilings; record the new bundle bytes and ms/box
      in the as-built.
- [ ] **Played** (`v2-e2e`): crack a catalog network, get onto an NPC box, `ls /var/log` shows
      `auth.log.1` and `syslog.1`; `tail /var/log/syslog.1` ends on 2026-07-11; a `CRON` line's
      command is in `cat /etc/crontab`; an admin visit's source IP answers `nmap`; `cat
      /var/log/auth.log` holds only the player's own login line.

**Tests to watch** (mutation-aware, from the mutator rules): the day boundaries (a line at
00:00:00 and at 23:59:59 are in, the epoch itself is out); the schedule's three shapes (hourly fires
24 times, daily once, weekly only when its weekday is 6); the `notifempty` rule (a box with no line
for a log has no `.1`, not an empty one); the daemon-runs guards (a box whose `named` is stopped
keeps `named.log` but has no `named.log.1`; a box without `sshd` has no admin visit); the LAN-vs-deep
source branch; the root-only account rule (a line naming the uid-1000 user fails it); sort order
(a mutant that drops the sort must break the in-order test).

**Mutation**: scoped Stryker run on the new modules at PR readiness (lazy fixtures — the slice 1
lesson: a module-level fixture that throws under a mutant reports "no tests" and counts Survived).
**Wire-check**: `N/A` — no `api/` change; NPC trees never cross the wire, and the appenders and
server writers are untouched.
**PR-ready when**: criteria met; typecheck, lint, `test:run` and `build` green; mutation gate
recorded; played run recorded; commit approved.

---

## Open at implementation (named, deliberately not decided)

- Module shape: one `generation/logHistory.ts` builder beside a `pools/logLines.ts`, or split per
  file — pick whichever keeps `buildRemoteHostFs` a list of calls. New line formatters join their
  file's `logging/*.ts` module.
- How the history reads the crontab (structured jobs returned by `buildEtcContent`, or parsing the
  rendered file) and the fstab root UUID — prefer the value over re-parsing text.
- The reboot rate, the admin-visit and request counts per role, and the systemd timer pool.
- Whether live `syslog` needs anything in `/root`'s history beyond the log-read lines slice 2
  already derives.
