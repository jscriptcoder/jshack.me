# Plan: D3 — ftp (the door)

**Branch**: one `feat/<slice>` branch per slice, off `main` (never stacked — see
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §8).
**Status**: Active
**Parent**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) → "D3 — resolved scope & decisions
(grill-me, 2026-08-14)" — nine locked decisions. **Read that section first**; this file sequences
those decisions, it does not re-open them.

## Goal

A second way into a machine: a player scans a box, cracks its ftp credential, logs in over `ftp`,
takes a file and leaves one — and the box's owner reads exactly which files moved.

## Acceptance Criteria

- [ ] `nmap` reports `21/tcp open ftp` on generated LAN hosts that run the service, and
      `vsftpd` brings the port up on a box the player holds root on
- [ ] `hydra <host> ftp` returns a credential, and the whole sweep lands in the target's
      `/var/log/vsftpd.log` — not `auth.log`
- [ ] `ftp <host>` authenticates against the box's real `/etc/passwd` and leaves the player at an
      `ftp>` prompt; `quit` returns them to the shell they never left
- [ ] Inside the session the player reads the remote tree (`ls`, `cd`, `pwd`) at the tier their
      credential carries, while `lls`/`lcd`/`lpwd` still address the box they are standing on
- [ ] `get` copies a remote file onto the origin machine; `put` copies an origin file onto the
      remote, refused when the session's tier cannot write the destination
- [ ] The target's `vsftpd.log` names every login and every transfer, with byte counts — the
      itemised record `ssh` cannot give
- [ ] All of it works against another player's machine through a NAT forward, with the attacker's
      real vantage address in the defender's log
- [ ] A browser refresh ends the ftp session rather than restoring it as a hop

## Plan change requiring approval

The grill's spine has **four** slices. Two of them are two PRs each, so this plan has **six**.
Nothing is re-decided — the subdivision is:

| Grilled spine | This plan |
|---|---|
| D3.1 the door exists, and sweeping it is recorded | **Slice 1** (unchanged) |
| D3.2 a player logs in and looks around | **Slice 2** (logs in) + **Slice 3** (looks around) |
| D3.3 a player takes a file and leaves one | **Slice 4** (takes) + **Slice 5** (leaves) |
| D3.4 a player reaches a stranger's door | **Slice 6** (unchanged) |

**Why D3.2 splits**: as spined it is a client command, a server-side kind parameterization with its
wire-check, a parallel session signal, a sub-shell dispatch, a prompt change, the login traces, and
the refresh filter. A reviewer cannot hold that as one concept. Logging in and *being somewhere*
is a complete walking skeleton without the filesystem behind it.

**Why D3.3 splits**: `get` and `put` are not symmetric, and grounding is what shows it —
see "What grounding settled" below.

## What grounding settled (verified 2026-08-14, at planning time)

Five checks against the code, each of which changes the plan rather than decorating it:

1. **`kind:'ftp'` needs no migration.** `sessions.kind` is `TEXT NOT NULL` with **no CHECK
   constraint** and no uniqueness on `(player_key, machine_id)`
   (`v2/supabase/migrations/20260607000000_sessions.sql:28`). Decision 2's "schema-legal" is
   confirmed at the DDL, so slice 2 carries no migration.
2. **`hydra <host> ftp` will match on `ftp`, not `vsftpd`.** `openPortFromPidfile`
   (`pidfile.ts`) labels an open port with `spec.service`, while the pidfile *content*'s daemon
   name comes from `daemonOf` (the pidfile basename). So the catalog row's `service: 'ftp'` +
   `pidfile: 'vsftpd.pid'` gives `nmap` an `ftp` label and a `vsftpd:port=21` pidfile
   simultaneously — the acceptance criterion is real and needs no adapter.
3. **The origin binding already exists — only the REMOTE one is new.** Because decision 2 keeps
   the ftp session *parallel* rather than pushing it, `activeSession()` still returns the origin
   session, so `patchClientDeps`, `patches()` and `activeRoot()` keep serving the origin
   untouched. The remote is an **additive second binding**; nothing is rebound. This makes
   `lls`/`lcd`/`lpwd` nearly free (slice 4) and is cheaper than the "second journal + servedRoot"
   the grill costed.
4. **`put`, not `get`, is where decision 3's central claim gets proven.** `get` = remote read
   (L2 at the session's tier) → **origin** write (own workstation, no session needed). `put` =
   origin read → **remote** write, which is the only place an `ftp`-kind row has to satisfy L1
   through the shipped `upsertPatch`. Slice 5 is therefore the load-bearing one, not the small
   rider its size suggests.
5. **The ftp client is already apt-gated and the daemon binary is not planted.**
   `{ name: 'ftp' }` is at `aptPackages.ts:57`; `SYSTEM_DAEMON_NAMES = ['sshd']`
   (`binaries.ts:85`) needs `vsftpd` added — `binaries.ts:90` already names `vsftpd` in a comment
   as belonging in `/usr/sbin`.

**A world-stability claim to verify in slice 1's RED, not assume**: `hostServices` seeds a
*separate* PRNG per service (`svc-${service}-${essid}-${host.ip}`), so adding a row should leave
every existing ssh/http roll and port identical. Generated-FS fixtures will still move (a new
pidfile entry, `/usr/sbin/vsftpd`, `vsftpd.log`) — that is expected. A changed ssh or http roll is
not, and would mean the row was added somewhere that re-rolls.

## Open decisions, each pinned to the slice that must answer it

Carried from the grill, with a recommendation and the evidence found since:

1. **Where `vsftpd.log` is seeded — slice 1.** *Recommendation: follow `access.log` exactly.*
   `remoteHostFs.ts:205` seeds `access.log` only on a host where `serves` is true, and its comment
   is the argument verbatim: an empty file would be "furniture that claims the box once served".
   Gate `vsftpd.log` on the ftp service the same way. `appendMachineLog` creates an absent file
   anyway, so the seed's only job is honesty about which boxes ever ran the daemon.
2. **Anonymous ftp — slice 2.** *Recommendation: OUT.* Every login checks a real `/etc/passwd`
   account, consistent with the catalog row deferring `virtual_users.conf`. Confirm before RED.
3. **`get` onto an existing origin file — slice 4.** *Recommendation: overwrite, and say so.*
   Real ftp overwrites; the origin is the player's own box; and a refusal makes re-fetching a file
   you already took an unexplainable failure. Print the byte count on the transfer line so the
   overwrite is visible.

**Not open** (locked by the grill, restated so nobody re-litigates it mid-slice):
`/var/log/vsftpd.log` is tier-2 like `auth.log`/`kern.log` — **NOT** added to the tier-3
allowlist. You have to get in to read it.

## Slices

Every slice below is a **behavior change**: load `tdd`, `testing`, `mutation-testing` and
`refactoring` before code. There is no reduction program in D3 — the "Reduction Program" section
of the planning template is `N/A` throughout, and no slice may claim net mechanism removal.

Standing obligations per slice: bump the version in `v2/package.json` **and**
`v2/package-lock.json` (`npm install --package-lock-only`); `npm run typecheck` and `npm run lint`
from `v2/`; present the work and **wait for commit approval**.

---

### Slice 1: The ftp door exists on generated hosts, and sweeping it is recorded in the daemon's own log

**Value**: A player scanning their LAN finds boxes with `21/tcp open ftp`, and `hydra <host> ftp`
returns a credential while the target records the sweep in `/var/log/vsftpd.log`. Actor: the
attacker (finds a second kind of door) and the defender (reads a truthful log).
**Path**: `nmap <host>` → `readOpenPorts` over the generated `/var/run` → `21/tcp open ftp`;
`hydra <host> ftp` → `api/` → `handleHydraCrack` → service-routed `appendMachineLog` → the
target's `vsftpd.log`. Plus `vsftpd [port]` on a box the player holds root on.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code):
- On a fixed ESSID, `nmap` reports `21/tcp open ftp` for hosts that rolled the service, and the
  existing ssh/http ports on those same hosts are byte-identical to before the row was added
- `vsftpd` on a box the player holds root on writes `/var/run/vsftpd.pid` as `vsftpd:port=21`,
  refuses a non-root caller, refuses when already running (reporting the running port), and
  validates `[port]` — the same four gates `sshd` has, streamed the same way
- `hydra <host> ftp` returns the host's crackable credentials
- The sweep's ~110 lines land in the target's `/var/log/vsftpd.log` in vsftpd's own format, and
  **nothing is written to `auth.log`**
- `hydra <host> ssh` still writes to `auth.log`, byte-identical to today

**RED**: Three failing behavior tests, in this order — the order is the design:
  1. *Routing first, on the shipped service.* A hydra ssh sweep writes its trace to the path the
     **catalog row** names, still `auth.log` with `formatSshdAuthLine`. This drives the
     `SERVICE_CATALOG` logging column (path + owner + permissions + formatter) with ssh as its
     only consumer, and it is behavior-preserving — it must pass with the existing assertions
     untouched.
  2. *The log's own format.* `formatVsftpdLogLine` renders CONNECT / FAIL LOGIN / OK LOGIN /
     OK DOWNLOAD / OK UPLOAD in the shapes decision 5 fixes verbatim, sharing `MONTHS` with
     `accessLog` and **not** `formatSyslogTimestamp` (different date shape).
  3. *The door.* The catalog row exists → `nmap` shows it, `vsftpd` opens it, and
     `hydra <host> ftp` traces to `vsftpd.log`.

  **Why this order**: it is D2's lesson applied. If the row lands before the routing, a shipped
  version writes sshd-tagged lines to `auth.log` for a door nobody knocked on. Adding the column
  to ssh's row first means the ftp row can never exist in that state.

**GREEN**: A `logging` field on `ServiceSpec`; `SERVICE_CATALOG.ftp` (`service: 'ftp'`,
`pidfile: 'vsftpd.pid'`, `defaultPort: 21`, `runUser: 'root'`, `placement: 0.30`,
`altPorts: [2121]`, `altPortChance: 0.2`); `core/logging/vsftpdLog.ts`; `core/commands/vsftpd.ts`
mirroring `sshd`; `vsftpd` into `SYSTEM_DAEMON_NAMES`; `hydraCrack` reading the log identity off
the matched service instead of the `AUTH_LOG_*` constants; the seeded `vsftpd.log` gated on the
ftp service (open decision 1).
**MUTATE**: Full run on `vsftpdLog.ts`, the catalog row's consumers, and `vsftpd.ts`.
Watch for the trap `conventions-and-gotchas.md` §6 records: a branch that CHOOSES between two
sources needs a fixture with **distinct** values on each arm, so the ssh-vs-ftp log routing test
must use two different paths *and* two different formatters or the branch mutants are unkillable.
**KILL MUTANTS**: Survivors on the port-validation boundaries and the routing branch are
in-scope; ask before writing tests for `placement`-arithmetic survivors (a probability is not a
behavior a player can observe on one seed).
**REFACTOR**: Assess whether `authLog`/`accessLog`/`vsftpdLog` now share enough to justify a
common log-identity type — only if the third instance makes it obvious. Three is the earliest
point the shape is knowable; two would have been a guess.
**Wire-check**: **Required.** `scripts/testFtpSweepTrace.ts` against `vercel dev` + supabase —
`hydra <host> ftp` writes a `vsftpd.log` row and no `auth.log` row; the ssh control still writes
`auth.log`. `tsc` cannot see which row landed.
**Done when**: All criteria met, the wire-check passes live, gates green, commit approved.
**Version**: 0.131.0.

---

### Slice 2: A player logs in over ftp and lands at an `ftp>` prompt they can leave

**Value**: The door opens. A player with a credential runs `ftp <host>`, is let in, stands at an
`ftp>` prompt, and `quit`s back to the shell they never left. The defender's log names the login.
**Path**: `ftp <host> [user] [pw]` → `api/` → `handleAuthCreateSession` with `kind:'ftp'` → a
parallel `sessions` row → the `ftpSession` signal → `executeLine` dispatches to the restricted
map → `quit` → `endSession` → the signal clears.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code — includes **open decision 2**, anonymous
ftp OUT):
- `ftp <host>` prompts for a password, and a correct credential prints `230 Login successful`
  and changes the prompt to `ftp>`
- A wrong credential or unknown user prints `530 Login incorrect` — one message for both, as
  `authCreateSession` already collapses them
- At the `ftp>` prompt, `help` lists the ftp command set and an unknown command is refused
  **without** falling through to the ordinary shell (`ls` at `ftp>` must not run `/bin/ls`)
- `quit` (and `bye`) print `221 Goodbye`, end the session server-side, and return the player to
  the exact shell, cwd and tier they had before — the hop chain is unchanged throughout
- The target's `vsftpd.log` gains a `CONNECT` line and an `OK LOGIN` line on success, a
  `FAIL LOGIN` on refusal
- **A browser refresh ends an active ftp row and does not restore the mode** — `rehydrateSessions`
  filters to stack kinds (`ssh`/`su`), and the abandoned ftp row is ended with a reason

**RED**: Start with the refresh filter, then the session, then the shell:
  1. `rehydrateSessionStack` given an active `kind:'ftp'` row rebuilds a stack **without** it.
     This is first because it is the trap: an unfiltered replay returns the ftp session as a
     *hop*, which is the pushed model decision 2 rejected, and a lingering active row is a silent
     write grant on someone else's box (sessions have no TTL).
  2. `handleAuthCreateSession` persists the kind it was asked for — `'ssh'` when asked for ssh,
     `'ftp'` when asked for ftp. Two arms with distinct values, per the mutation trap above.
  3. `ftp <host>` with a good credential leaves the terminal at `ftp>`; `quit` returns it.

**GREEN**: `kind` parameterized on `AuthSessionRow` and the insert (`authCreateSession.ts:54`,
`:211`) — no migration, per grounding finding 1; `core/commands/ftp.ts`; an `ftpSession` signal
in `ui/state.ts` plus the `executeLine` branch; the restricted command map with `help`/`quit`/`bye`
only; the prompt change; the login traces through slice 1's formatter; the `rehydrateSessions`
kind filter.
`OverlayMode` (`state.ts:224`) and the `mode_change` narrow (`state.ts:1069`) are **untouched** —
decision 1 makes this a sub-shell, not a screen. `ModeChange { kind:'ftp' }` predates the door and
should be reshaped or dropped as part of this slice rather than left as a stale stub.
**MUTATE**: Full run on `ftp.ts`, the command map, and the rehydrate filter. UI tests are jsdom +
`@solidjs/testing-library` — **not** Browser Mode.
**KILL MUTANTS**: The kind-filter predicate and the unknown-command refusal are both
security-load-bearing; read the survivor list rather than the count (§6 records why).
**REFACTOR**: Assess whether the ftp command map and the main registry want a shared lookup
shape. Decision 1 says this sets the pattern for `nc`/`mysql`/`redis` — but **do not build the
generic sub-shell mechanism here**. One instance is not a pattern; the third caller earns it.
**Wire-check**: **Required.** `scripts/testFtpSession.ts` — an `ftp`-kind row inserts, is returned
as active, and `endSession` closes it. The DB accepts an unconstrained `kind`; prove it rather
than trusting the DDL read.
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.132.0.

---

### Slice 3: A player looks around the remote machine at the tier their credential carries

**Value**: The session becomes useful — `ls`, `cd` and `pwd` at `ftp>` address the remote box,
and what they show is decided by the tier the credential bought, not by who the player is at home.
**Path**: `ftp>` command map → the **additive** remote patch binding → the shipped 3-tier read
filter → the remote tree.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code):
- `ls` at `ftp>` lists the **remote** box's cwd; `cd /etc` then `ls` shows `passwd`
- `pwd` reports the remote cwd, which starts at the logged-in account's home
- A path the session's tier cannot traverse is refused exactly as it would be over `ssh` with the
  same credential — the door adds no authorization dimension (epic decision 2)
- The player's own machine state is untouched throughout: after `quit`, `pwd` and `ls` in the
  shell show the same cwd and tree as before `ftp` was run

**RED**: `ls` at `ftp>` returns the remote tree while `activeRoot()` still returns the origin —
one test that fails in both directions if the bindings are confused. Per §6, use fixtures whose
remote and origin trees hold **distinct** entries, or a binding mix-up passes.
**GREEN**: A remote binding signal alongside the existing one (grounding finding 3 — nothing is
rebound); the remote `pwd`/`ls`/`cd` in the ftp map, reusing `createFsView` and the walker.
**MUTATE**: Full run on the remote binding and the three commands.
**KILL MUTANTS**: Tier-gate survivors are in scope.
**REFACTOR**: Assess whether `createFsView` construction is now duplicated between the shell and
the ftp map.
**Wire-check**: **Required.** `scripts/testFtpRemoteRead.ts` — a read of the remote journal
authorized by an `ftp`-kind session returns the box's real state at the session's tier. The read
filter is server-side; `tsc` cannot see it.
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.133.0.

---

### Slice 4: A player takes a file, and the theft is itemised in the owner's log

**Value**: The first real payload. `get` copies a remote file onto the origin machine, where the
player's own tools can work on it — and unlike `ssh`, the owner learns exactly which file left.
**Path**: `get <remote> [local]` → remote read (slice 3's binding) → **origin** write through the
shipped `upsertPatch` (own workstation, no session needed) → `OK DOWNLOAD` on the remote's
`vsftpd.log`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code — includes **open decision 3**, overwrite
vs refuse):
- `get /etc/passwd` writes the file into the origin cwd and reports the transfer with its byte
  count; after `quit`, `cat passwd` shows the remote content and `john passwd` reads it
- `lpwd`, `lcd` and `lls` address the **origin** machine while `pwd`/`ls`/`cd` address the remote,
  and `lcd /tmp` then `get` lands the file in `/tmp`
- A remote file the session's tier cannot read is refused, and **nothing is written locally**
- The remote's `vsftpd.log` gains an `OK DOWNLOAD` line naming the path and byte count
- Per open decision 3: `get` onto an existing origin file overwrites, and the reported byte count
  is what makes that visible

**RED**: `get` on a readable remote file produces an origin file with that content — asserted
through the origin FS, not through the command's own output.
**GREEN**: `get` in the ftp map; `lpwd`/`lcd`/`lls` reading the existing origin state (cheap, per
grounding finding 3); the DOWNLOAD trace.
**MUTATE**: Full run on `get` and the local-navigation trio.
**KILL MUTANTS**: The read-refusal arm must leave no local write — assert the absence, and beware
the vacuous-absence trap §6 records (prove the file *would* have been there on the success path).
**REFACTOR**: Assess a shared transfer core now that one direction exists; **do not** generalize
for `put` before slice 5 exists to name what is common.
**Wire-check**: Not required if the origin write goes through the shipped own-workstation path
unchanged — **verify that at RED**; if `get` touches any `api/` handler, a wire-check becomes
required and this line is wrong.
**Done when**: All criteria met, gates green, commit approved.
**Version**: 0.134.0.

---

### Slice 5: A player leaves a file on someone else's machine, and the tier decides whether it lands

**Value**: The write direction, and the proof of the epic's central claim — an `ftp` session
authorizes a write through the same `upsertPatch` an `ssh` session does, with no protocol check
anywhere beneath. Closes the loop D3b then reuses.
**Path**: `put <local> [remote]` → origin read → **remote** write through the shipped
`upsertPatch` (L1 `authorizeMachineAccess`, L2 walker at the session's tier) → `OK UPLOAD` on the
remote's `vsftpd.log`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code):
- `put notes.txt` writes the origin file onto the remote's cwd, and the box's owner reading that
  path sees the content — through the shared journal, not a copy
- A destination the session's tier cannot write is refused with a `553`-shaped message, and
  **nothing lands on the remote**
- A `put` from a `guest`-tier credential into `/root` is refused; the same `put` from a `root`
  credential succeeds — the tier, not the protocol, is what decides
- The remote's `vsftpd.log` gains an `OK UPLOAD` line naming the path and byte count
- An origin file the player cannot read is refused before anything is sent

**RED**: A `put` authorized by a `kind:'ftp'` session lands a patch on the remote machine —
the first assertion in D3 that an ftp row satisfies L1. Then the tier refusal, with **two
credentials of different tiers against the same destination**, or the gate's branch mutants
survive.
**GREEN**: `put` in the ftp map; the UPLOAD trace. `authorizeMachineAccess` should need **no
change at all** — decision 3 says it is already kind-agnostic. If it does need one, stop: that is
a new authorization dimension and the epic's warning applies ("do not quietly re-open decision 2").
**MUTATE**: Full run on `put` and the tier gate.
**KILL MUTANTS**: Every survivor on the write gate is in scope; this is the security boundary of
the whole door.
**REFACTOR**: Now assess the shared transfer core deferred from slice 4 — two directions is when
the common shape is knowable.
**Wire-check**: **Required.** `scripts/testFtpPut.ts` — a write authorized by an `ftp`-kind row is
accepted by the live patch endpoint, and the same write at an insufficient tier is refused. This
is the slice's whole claim and `tsc` cannot see any of it.
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.135.0.

---

### Slice 6: A player reaches a stranger's ftp door across the network

**Value**: The door works between real players. B sweeps A's forwarded port, logs in, takes a
file — and A reads B's real vantage address out of their own log.
**Path**: `ftp <A's public IP> -p <fwd>` → NAT forward → `machineServing` routes **by port** →
the same handlers slices 2–5 built → A's `vsftpd.log`, with the source IP derived server-side.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code):
- A runs `vsftpd` and forwards `2121 → <workstation>:21`; B `nmap`s A's public IP and sees the
  forwarded port
- B `hydra`s the forwarded port, logs in with what came back, and `get`s a file from A's box
- A reads `/var/log/vsftpd.log` and finds B's login and download, sourced from **B's real
  vantage** — pivot-aware per decision 6, so an attack launched from a box B only holds a session
  on is traced to *that* network, not B's home
- The tier B's credential carries is the tier B gets, exactly as on the LAN

**RED**: A cross-network `ftp` login resolves through the forward and stamps the server-derived
source IP — not any address the client supplied.
**GREEN**: `caller_machine_id` on the ftp path + `resolveVantageSourceIp({ actorKey,
standingEssid })`, joining `hydra` and `gobuster` on the honest side of the §9 split.
`machineServing` should need no change (it routes purely by port).
**MUTATE**: Full run on the cross-player path.
**KILL MUTANTS**: A survivor that lets a client-supplied address reach the log is a defect, not a
nit — D2.4's rule holds: a false address in a defender's log is worse than a refusal.
**REFACTOR**: Assess whether the four pivot-aware tools now share a vantage resolution worth
naming.
**Wire-check**: **Required.** `scripts/testFtpCrossPlayer.ts` — the full journey live, and a
**live close-out run** written up as the next Act of
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md), matching
what D1c, D1b and D1d each did on close-out.
**Done when**: All criteria met, wire-check green, live run written up, gates green, commit
approved.
**Version**: 0.136.0.

---

## Known trap: the log will look empty right after a cross-player write

After any server-side append the client shows that log as **empty** until something else syncs its
journal. This is **decided, not open** (2026-07-31: no Supabase Realtime; the staleness accepted, a
PULL as the approved fix shape if ever taken) and is recorded in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9. D1d re-confirmed it
rather than discovering it. **Read the row from the DB when a log looks empty** — do not open a
bug, and do not fix it inside D3.

## Pre-PR Quality Gate

Before each PR:
1. Mutation testing run and reported (or an explicit `N/A` with proportionate alternate evidence —
   no slice here is expected to need one)
2. Refactoring assessment recorded; `reduce-system-complexity` is `N/A` for every slice
3. `npm run typecheck` and `npm run lint` pass from `v2/`
4. Version bumped in `v2/package.json` **and** `v2/package-lock.json`
5. Wire-check run live against `vercel dev` + supabase where the slice says it is required
6. Language check: `vsftpd`, `ftp session`, `origin` and `remote` are the terms this door
   introduces — use them consistently in code and messages, and do not coin a synonym mid-slice

---
*Delete this file when D3 is complete, and fold the as-built into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1 — as every closed-out
slice in this epic has done.*
