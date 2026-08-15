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

- [x] `nmap` reports `21/tcp open ftp` on generated LAN hosts that run the service, and
      `vsftpd` brings the port up on a box the player holds root on *(slice 1, v0.131.0)*
- [x] `hydra <host> ftp` returns a credential, and the whole sweep lands in the target's
      `/var/log/vsftpd.log` — not `auth.log` *(slice 1, v0.131.0)*
- [x] `ftp <host>` authenticates against the box's real `/etc/passwd` and leaves the player at an
      `ftp>` prompt; `quit` returns them to the shell they never left *(slice 2, v0.132.0)*
- [x] Inside the session the player reads the remote tree (`ls`, `cd`, `pwd`) at the tier their
      credential carries, while `lls`/`lcd`/`lpwd` still address the box they are standing on
      *(slice 3, v0.133.0)*
- [x] `get` copies a remote file onto the origin machine *(slice 4, v0.134.0)*; `put` copies an
      origin file onto the remote, refused when the session's tier cannot write the destination
      *(slice 5, v0.135.0)*
- [x] The target's `vsftpd.log` names every login and every transfer, with byte counts — the
      itemised record `ssh` cannot give *(slice 5, v0.135.0 — both verbs)*
- [x] All of it works against another player's machine through a NAT forward, with the attacker's
      real vantage address in the defender's log *(slice 6, v0.136.0)*
- [x] A browser refresh ends the ftp session rather than restoring it as a hop *(slice 2, v0.132.0)*

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

**Amendment, approved 2026-08-15**: `lls`/`lcd`/`lpwd` move from slice 4 into **slice 3**. The
epic's third acceptance criterion states the remote trio and the local trio in one breath —
"reads the remote tree … *while* `lls`/`lcd`/`lpwd` still address the box they are standing on" —
so splitting them left that criterion spanning two slices, tickable by neither. It also weakens
the RED: "the two bindings are not confused" is only falsifiable when both trios are present to
disagree. Slice 4 keeps what is genuinely its own — the local cwd deciding where a `get` lands.

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
   `lls`/`lcd`/`lpwd` nearly free (slice 3, per the amendment above) and is cheaper than the
   "second journal + servedRoot" the grill costed.
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

1. ~~**Where `vsftpd.log` is seeded — slice 1.**~~ **RESOLVED in slice 1: gated on the ftp
   service, exactly as `access.log` is gated on http.** *Original recommendation, taken:*
   `remoteHostFs.ts:205` seeds `access.log` only on a host where `serves` is true, and its comment
   is the argument verbatim: an empty file would be "furniture that claims the box once served".
   Gate `vsftpd.log` on the ftp service the same way. `appendMachineLog` creates an absent file
   anyway, so the seed's only job is honesty about which boxes ever ran the daemon.
2. ~~**Anonymous ftp — slice 2.**~~ **RESOLVED 2026-08-15: OUT.** Every login checks a real
   `/etc/passwd` account, consistent with the catalog row deferring `virtual_users.conf`. There is
   no `anonymous` account and no special case for one: `ftp <host>` with a username the box does
   not have is refused by exactly the same `530 Login incorrect` a wrong password gets, because
   `authCreateSession` already collapses the two and telling them apart would leak the account
   list.
3. ~~**`get` onto an existing origin file — slice 4.**~~ **RESOLVED 2026-08-15: OVERWRITE, and say
   so.** *Recommendation, taken:* real ftp overwrites; the origin is the player's own box; and a
   refusal makes re-fetching a file you already took an unexplainable failure. The byte count is
   printed on the transfer line, which is what makes the overwrite visible.

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

**Status: SHIPPED** — v0.131.0, PR #393 (`021f5d2`), merged 2026-08-15. As-built below.

**As-built, where it departs from the plan above** (three departures, all forward-facing):

1. **RED step 1 was a pure refactor, not a failing test.** Adding the logging column to ssh's row
   changes no observable behavior, so there was nothing to fail. It ran the verified REFACTOR path
   instead — the existing hydra tests as the passing preservation baseline, green throughout. The
   plan text above is wrong on this point and is left standing as the record of what was expected.
2. **Only the LOGIN shapes were built.** `formatVsftpdLoginLine` renders `OK LOGIN` / `FAIL LOGIN`
   and nothing else — a sweep is all slice 1 could observe. **`CONNECT` is slice 2's to add**
   (its AC needs one), `OK DOWNLOAD` is slice 4's, `OK UPLOAD` is slice 5's. Each arrives with the
   behavior that writes it, rather than as five shapes with one consumer.
3. **The REFACTOR assessment landed as `SweepLog`**, a type on `ServiceSpec` carrying
   path + owner + permissions + formatter. The third instance did make the shape obvious, as the
   plan hoped — but it is scoped to *credential sweeps*, not a general log identity, because
   `access.log`'s writer is a request rather than an attempt.

**Also found, and backlogged rather than fixed here**: `hydra <host> http` writes **sshd-tagged**
`auth.log` lines. It is a supported sweep with a deliberate shipped test, so it was preserved
byte-for-byte; the routing column now makes fixing it a one-row change. Recorded in
`conventions-and-gotchas.md` §9 — deciding what a *web* door's log should look like is not an ftp
slice's business.

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
**Wire-check**: **Required — deferred at ship, RUN AND GREEN in slice 2.**
`scripts/testFtpSweepTrace.ts`, **8/8 live** against `vercel dev` + supabase on 2026-08-15: the ftp
sweep lands 76 lines in `/var/log/vsftpd.log` with no `sshd[` tag and **no `auth.log` row at all**;
the ssh control on the *same box* still writes `auth.log` and leaves `vsftpd.log` untouched; the
log row is `owner=root`, `write=['root']`. Needed a deliberate ESSID (`VSFTPD-LAB`) — most generate
no host running **both** doors, and without one "ftp wrote elsewhere" could just mean "a different
machine".
**Done when**: All criteria met, gates green, commit approved. *(Shipped on those terms with the
wire-check outstanding; discharged in slice 2.)*
**Version**: 0.131.0. **Shipped evidence**: 2618 tests / 146 files, typecheck + lint clean.
Mutation: `hydraCrack.ts` 100% (116/116), `serviceCatalog.ts` 100% (6/6), `vsftpd.ts` 95.24%,
`vsftpdLog.ts` 92%, `passwordSweep.ts` 94.64% — the 5 survivors are `WRITE_ERROR` strings and a log
file's execute bit, the identical profile shipped `sshd.ts` and `auth.log` already carry.

---

### Slice 2: A player logs in over ftp and lands at an `ftp>` prompt they can leave

**Status: SHIPPED** — v0.132.0, PR #394 (`15fe95e`), merged 2026-08-15. As-built notes:

1. **The refusal is an allowlist, not an ftp exclusion.** `rehydrateSessionStack` rebuilds only
   HOP kinds (`ssh`/`su`) and returns everything else as `abandoned`, which the boot sweep closes.
   Written that way because every later parallel session (`nc`, `mysql`, `redis`) is wrong on the
   stack for the identical reason — an exclusion list would have to be remembered three more times.
2. **"Ended with a reason" became a real column write.** `end_reason` already existed in the DDL
   but was hardcoded `'user_exit'`. It is now a closed enum (`user_exit` | `abandoned`) on the
   `endSession` payload, so a row closed by the boot sweep is distinguishable from one the player
   quit. Closed rather than free text because the client picks the value.
3. **An `ftp` login is gated on the daemon actually listening; `ssh` still is not.** Only ~30% of
   hosts roll ftp, so an ungated ftp login would open a door on a box that has none. `ssh` has
   never checked, and a router generated with `hasSsh: false` accepts an ssh login today — a real
   defect, but in a **shipped** door, so it is backlogged in `conventions-and-gotchas.md` §9 rather
   than smuggled in behind ftp. The exemption is one clause with the reason written above it.
4. **The stale `ModeChange { kind:'ftp' }` was DROPPED, not reshaped.** `mode_change` means "open a
   screen"; decision 1 makes ftp a sub-shell, so the arm was a lie. Entering and leaving go through
   `env.ftp.enter`/`leave` instead — siblings of `pushSession`, scoped under an `FtpApi` alongside
   `authenticate` because one door is one cohesive seam.
5. **`SweepLog` gained `formatArrival`, optional.** vsftpd records reaching the door separately from
   getting through it; sshd's first line *is* the attempt, so an arrival line there would be an
   invention. Both lines land in ONE append — they are one event to the box, and two appends would
   be two read-modify-writes racing over the same file. The type's name is now slightly wrong (it
   carries logins as well as sweeps) — worth renaming when slice 4 adds transfers.

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
**Wire-check**: **DONE — both green live** (`vercel dev` + supabase, 2026-08-15, one stack-up):
- `scripts/testFtpSession.ts` — **14/14**. The DDL really does accept `kind:'ftp'` (it was read off
  the schema before, never proven); `listSessions` returns it active; CONNECT + OK LOGIN land on
  `vsftpd.log` with **nothing on `auth.log`**; a refusal writes CONNECT + FAIL LOGIN and inserts no
  row; `end_reason` stores `abandoned` when asked and `user_exit` by default; a correct credential
  on a box with **no ftp daemon** is still 404 `service_not_running` and leaves no trace.
- `scripts/testFtpSweepTrace.ts` — **8/8**, slice 1's outstanding check, discharged.

**Done when**: All criteria met, **both** wire-checks green, gates green, commit approved.
**Version**: 0.132.0.

---

### Slice 3: A player looks around the remote machine at the tier their credential carries, without losing their own

**Status: SHIPPED** — v0.133.0, PR #395 (`47dd312`), merged 2026-08-15. As-built notes:

1. **The remote listing is the shell's own `ls`, run over a swapped binding.** `ls`/`lls` both
   delegate to the real command with `{ ...env, fs: <binding>.fs }`, which is what makes the
   flags, the sort, the long format AND the permission refusal identical on both machines —
   the fourth AC ("refused exactly as it would be over `ssh`") is not re-implemented, it IS
   that refusal. `cd`/`pwd` do NOT delegate: they answer in vsftpd's numbered responses
   (`250`/`550`/`257`) because those are control-channel commands, while a listing is data the
   far side produced. The `l`-prefixed trio speaks unnumbered — nothing it does touches the
   control channel.
2. **A second journal, with an arrival check.** `ftpPatches` is fetched for the target on
   `enter` and dropped on `leave`, held beside the shell's `patches()`. The fire-and-forget
   fetch compares the session id when it resolves: quitting one box and opening another before
   the first answer lands would otherwise render one stranger's files under another's name.
   Recorded as an invariant in `conventions-and-gotchas.md` §7, since `nc`/`mysql`/`redis`
   each inherit it.
3. **`homeDirectory` was extracted, and it had FIVE copies.** `cd`, `ssh`, `su`,
   `sessionRehydrate` and the new ftp landing each carried "root → `/root`, else
   `/home/<user>`". Folded onto one module as the REFACTOR step, behaviorally green
   throughout; 100% mutation, and the arms are now covered by four existing suites rather
   than by the one caller that would have added a sixth copy.
4. **Mutation found a wiring gap the core tests could not see.** `onFtpCwdChange` was never
   proven end-to-end: `env.ts`'s `??` mutated to `&&` left `cd` silently unable to move the
   remote cwd, and every core test passed because they inject their own setter. Killed by
   asserting `pwd` AFTER `cd` through the real UI state.
5. **Bare `cd`/`lcd` ask rather than guess.** No arg prints usage — real ftp prompts for the
   directory, and reusing the shell `cd`'s bare-arg jump would have sent the player to the
   ORIGIN user's home on the remote box, which is a directory that need not exist there.

**Value**: The session becomes useful — `ls`, `cd` and `pwd` at `ftp>` address the remote box,
and what they show is decided by the tier the credential bought, not by who the player is at home.
`lls`/`lcd`/`lpwd` address the origin in the same breath, so the player can always tell which of
the two machines they are looking at.
**Path**: `ftp>` command map → the **additive** remote patch binding → the shipped 3-tier read
filter → the remote tree; the `l`-prefixed trio → the untouched origin binding.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria** (present and confirm before code):
- `ls` at `ftp>` lists the **remote** box's cwd; `cd /etc` then `ls` shows `passwd`
- `pwd` reports the remote cwd, which starts at the logged-in account's home
- `lls`, `lcd` and `lpwd` address the **origin** machine from the same prompt, and `lcd` moves the
  origin cwd without moving the remote one — the two cwds are independent
- A path the session's tier cannot traverse is refused exactly as it would be over `ssh` with the
  same credential — the door adds no authorization dimension (epic decision 2)
- The player's own machine state is untouched throughout: after `quit`, `pwd` and `ls` in the
  shell show the same cwd and tree as before `ftp` was run

**RED**: `ls` at `ftp>` returns the remote tree while `lls` at the same prompt returns the origin —
one test that fails in both directions if the bindings are confused. Per §6, use fixtures whose
remote and origin trees hold **distinct** entries, or a binding mix-up passes; the same applies to
the two cwds, which must start at different paths or `cd`/`lcd` cannot be told apart.
**GREEN**: A remote binding signal alongside the existing one (grounding finding 3 — nothing is
rebound); the remote `pwd`/`ls`/`cd` in the ftp map, reusing `createFsView` and the walker; the
`l`-prefixed trio reading the origin state that already exists.
**MUTATE**: Full run on the remote binding and both trios.
**KILL MUTANTS**: Tier-gate survivors are in scope, and so is any survivor that lets one trio
answer from the other machine's binding.
**REFACTOR**: Assess whether `createFsView` construction is now duplicated between the shell and
the ftp map. **Do not** unify the six commands behind one parameterized pair — the remote arm is
tier-gated and the origin arm is not, and collapsing them would put the gate behind a flag.
**Wire-check**: **DONE — 7/7 live** (`vercel dev` + supabase, 2026-08-15).
`scripts/testFtpRemoteRead.ts`: a box the player holds nothing on refuses its journal (403
`no_session`); an `ftp` row alone authorizes the read, because the L1 gate never asks which
kind; what comes back is the box as it stands, including the `vsftpd.log` line the SERVER wrote
on arrival — a client cannot compute that, so the listing was genuinely read off the target; the
grant is per-BOX (a second machine still refuses); and it dies with the session (403 again after
`endSession`). `testFtpSession.ts` re-run as a regression: still 14/14.
**Correction to the plan text above**: the read filter is NOT server-side. `listPatches` is
L1-only and machine-scoped, so the tier decides what a session SEES on the client, through
`createFsView` + the shared walker — exactly as it does for an `ssh` hop today. That is why the
wire-check proves authorization and provenance rather than filtering. Recorded in §7.
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.133.0.

---

### Slice 4: A player takes a file, and the theft is itemised in the owner's log

**Status: SHIPPED** — v0.134.0, PR #396 (`882ba2a`), merged 2026-08-15. As-built notes:

1. **The wire-check line below was WRONG, and RED is where it was caught.** It said no
   wire-check is needed if the origin write goes through the shipped own-workstation path.
   The origin write does — but the DOWNLOAD line does not: it lands on ANOTHER box's log,
   which no shipped endpoint could do. `get` therefore added a `recordFtpDownload` action
   to `api/patches.ts`, and by that line's own terms a wire-check became required.
   `scripts/testFtpDownloadTrace.ts` is it, **9/9 live**.
2. **The account in the log is read off the session row, not the payload.** A client that
   names its own account can file a theft under anyone's name, so `ActiveSession` gained
   `username` (the row already carried it in `credentials`) and the handler refuses when
   there is no row at all — including the own-workstation L1 BYPASS, which hands back no
   session and so cannot name anybody. The wire-check proves it against a live row by
   claiming `impostor` and reading back the real account.
3. **Widening the L1 projection was paid for by NARROWING the write gate.** Adding a
   required field to `ActiveSession` broke ~35 call sites, 20 of them in
   `remoteWritePermission` — a module that reads only the tier and the ESSID. It now takes
   `Pick<ActiveSession, 'userType' | 'essid'>`, which drops those 20 and says what a
   permission question actually needs: a tier, never a name.
4. **Only a COMPLETED transfer is recorded.** A refused remote read and a refused local
   write both stay silent. A download line for a file the player does not hold is a false
   entry in someone else's evidence, and nothing is lost by the silence — `get` never
   prints the content, so failing the local write is no way to read a file unseen.
5. **`SweepLog` was NOT renamed.** The rename this plan scheduled here assumed the download
   line would travel through the same catalog column the logins do. It does not: a transfer
   is not a credential attempt, so it has its own formatter and its own endpoint, and
   `SweepLog` still carries exactly what it carried before. Renaming it would have been
   churn justified by a coupling that never happened. **Re-assess at slice 5** — `put` is
   the last chance for a third shape to make the name wrong.
6. **`get` is the shell's own write, exactly as `ls` was the shell's own read.** The origin
   half routes through `env.patches.write` with the `isNew` rule the editor and the `>`
   redirect already follow: an absent target is a file this write invents (so `rm` deletes
   the row), an existing one omits the flag (so `rm` leaves a tombstone and the base file
   does not come back).

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
- The origin cwd — the one slice 3's `lcd` moves — is what decides where the file lands:
  `lcd /tmp` then `get` writes into `/tmp`, not into the cwd the shell held when `ftp` was run
- A remote file the session's tier cannot read is refused, and **nothing is written locally**
- The remote's `vsftpd.log` gains an `OK DOWNLOAD` line naming the path and byte count
- Per open decision 3: `get` onto an existing origin file overwrites, and the reported byte count
  is what makes that visible

**RED**: `get` on a readable remote file produces an origin file with that content — asserted
through the origin FS, not through the command's own output. *(As run: the test's `patches.write`
lands a real `Patch` in a journal and every line is answered by an env rebuilt over
`applyPatches(ORIGIN_TREE, journal)`, which is what the UI does per command — so the file is found
by looking for it rather than by watching the call that claimed to send it.)*
**GREEN**: `get` in the ftp map, landing at the origin cwd slice 3 introduced; the DOWNLOAD trace.
**MUTATE**: Full run on `get` and the destination resolution.
**KILL MUTANTS**: The read-refusal arm must leave no local write — assert the absence, and beware
the vacuous-absence trap §6 records (prove the file *would* have been there on the success path).
**REFACTOR**: Assess a shared transfer core now that one direction exists; **do not** generalize
for `put` before slice 5 exists to name what is common. ~~**Also due here: rename `SweepLog`**~~ —
*not due after all, see as-built note 5: the download line never touched that type.* What the
assessment DID find: three copies of "read wlan0 as a wireless interface" in `state.ts` (the ESSID
the player is on, the address they reach from, whether a fetch was their own), folded onto one
`wireless()` reader; and the L1-projection widening paid for by narrowing the write gate (note 3).
**Wire-check**: ~~Not required if the origin write goes through the shipped own-workstation path
unchanged — **verify that at RED**; if `get` touches any `api/` handler, a wire-check becomes
required and this line is wrong.~~ **It was wrong, and RED said so — see as-built note 1.**
**DONE — 9/9 live** (`vercel dev` + supabase, 2026-08-15). `scripts/testFtpDownloadTrace.ts`:
a player holding nothing on the box cannot write to its log (403, and no row is left behind);
an `ftp` row authorizes the record; the line the box itself holds names the file, the byte
count and the client; the account is the SESSION's even when the payload claims `impostor`;
the login lines are still under it, so the record accumulates; and after `endSession` it is
403 again. Regressions re-run green on the same stack: `testFtpRemoteRead` 7/7,
`testFtpSession` 14/14, `testCrossPlayerWrite` 12/12 (the widened L1 projection feeding the
remote-write L2), `testHydraOwnLan` 23/23 and `testLanFetchLog` 11/11 (the log appenders the
new shared `readMachineLog` sits beside).
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.134.0.

---

### Slice 5: A player leaves a file on someone else's machine, and the tier decides whether it lands

**Status: SHIPPED** — v0.135.0, PR #397 (`edc94f2`), merged 2026-08-15. As-built notes:

1. **`authorizeMachineAccess` needed no change at all — and now that is EVIDENCE, not a
   claim.** The plan said to stop if it did. It did not: `put` reaches the shipped
   `upsertPatch` through `createPatchApi` pointed at the ftp session's machine, and
   `scripts/testFtpPut.ts` shows the live endpoint accepting a `kind:'ftp'` row it was
   never taught about. Nothing beneath the door learned a second protocol exists.
2. **The tier claim belongs to the wire-check, and the unit tests say so.** With no client
   pre-check (decision B), a vitest `put` refusal is the *stub* refusing — proving what the
   command does with an answer, never which answer the gate gives. The tier is contrasted
   where it is real: one path, two credentials, live — `/root/dropped.sh` refused to a
   cracked `guest` and accepted from a cracked `root`, both over ftp. The unit test is
   named for what it proves ("reports a remote refusal as 553"), not for the tier.
3. **The transfer record collapsed to one action, `recordFtpTransfer`.** Slice 4's
   `recordFtpDownload` was renamed rather than copied: same L1 gate, same session-row
   account, same `appendMachineLog`, one closed-set `direction` deciding the verb. A
   direction outside that set is refused (400) rather than rendered, or a caller writes
   their own verb into a stranger's evidence. The formatter collapsed with it
   (`formatVsftpdTransferLine`).
4. **A refused write is one answer, deliberately.** The client cannot distinguish "no
   session" from "tier cannot write there" — `toPatchResult` maps every 403 to
   `no_session` — so `553 Could not create file: <path>: Permission denied` is worded to
   be true of both. Naming them apart would be a guess dressed as a diagnosis.
5. **`SweepLog` keeps its name — final verdict.** Slice 4 deferred this to here on the
   grounds that `put` was the last chance for a third shape to make the name wrong. It did
   not: `OK UPLOAD` travels through the transfer formatter and the transfer endpoint, and
   `SweepLog` still carries only what a credential *sweep* is filed under, routed by
   service. The name was right; the rename is closed, not deferred again.
6. **The REFACTOR the plan deferred to here found ONE thing worth sharing, not a transfer
   core.** The two directions differ in exactly what the door is about — whose machine
   refused you — so a parameterized core would hide the distinction behind six arguments.
   What is genuinely one piece of knowledge is the `isNew` rule, which was duplicated
   verbatim in both halves *with its comment repeated*: it became `land()`, and the WHY is
   stated once. Mutation held at 100% across the change.
7. **The target's journal is re-pulled after a landed `put`, not the shell's.** Two
   machines, two journals; without it the player is told the bytes went and shown a box
   that never received them. Proved by an `ls` at the prompt after the upload — the
   harness's mock server now keeps writes aimed at a target, the way the real one does,
   which is what made the claim provable at all.

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
**DONE — 12/12 live** (`vercel dev` + supabase, 2026-08-15). `scripts/testFtpPut.ts`: a player
holding nothing on the box cannot write to it (403, nothing lands); an `ftp` row authorizes a
write through the SAME endpoint an ssh row uses, and the box itself holds the file afterwards;
the same session cannot reach `/root`, and that refusal leaves nothing behind; the SAME
destination accepts a cracked root credential over the same door; and after `endSession` it is
403 again. `scripts/testFtpTransferTrace.ts` (renamed from `testFtpDownloadTrace.ts`) **13/13** —
now covering `OK UPLOAD` beside `OK DOWNLOAD` in one file, in the order they happened, and a
bogus direction refused 400 with the log unchanged. Regressions re-run green on the same stack:
`testFtpRemoteRead` 7/7, `testFtpSession` 14/14, `testCrossPlayerWrite` 12/12,
`testHydraOwnLan` 23/23, `testLanFetchLog` 11/11.
**Done when**: All criteria met, wire-check green, gates green, commit approved.
**Version**: 0.135.0.

---

### Slice 6: A player reaches a stranger's ftp door across the network

**Status: COMPLETE, awaiting commit approval** — v0.136.0. As-built notes:

1. **The door became a `kind` on the shipped public gate, not a second endpoint.**
   `authCreateSessionPublic` gained `kind` (defaulting to `'ssh'`, exactly as slice 2 did
   to the LAN handler) and routes its trace through `SERVICE_CATALOG[kind].sweepLog`. One
   passwd, one tier, one resolution; all the door changes is which file the visit is
   written in.
2. **`PublicTarget.reachedPort` had a caller after all, and the public gate was not it.**
   `hydraCrackPublic` already checked the service on the reached port; the login handler
   never had. So a forward to :22 WAS an ftp door and a forward to :21 an ssh one, until
   this slice. Both directions are now refused (`service_not_running`), and the LAN
   handler's deliberate ssh exemption is untouched — different code path, own §9 entry.
3. **The vantage swap cost `ssh` nothing.** `resolveVantageSourceIp` with a null standing
   ESSID is *identical* to the `resolveCrossPlayerSourceIp` the handler called before, and
   `ssh` names no caller machine — so the shipped door's behaviour is unchanged while
   `ftp` is pivot-aware. Proved live: the pivot login records the network stood on.
4. **The finding that changed the criteria: two writer keys, one log path.**
   `recordFtpTransfer` wrote under the CALLER's key. On another player's box the login
   line is written under the TARGET's, so the two would land in different rows and the
   last-write-wins replay would hand the defender half a visit — and a second visitor
   would erase the first. One lookup (`findOccupantWorkstationByMachineId`, already wired
   for `removePatch`) now decides both halves of the provenance: a hit means the owner's
   row and a server-derived address, `null` means a generated host and today's behaviour
   verbatim. An unreadable answer writes nothing (500) rather than guessing a row.
5. **The REFACTOR the plan asked for found ONE rule, not a shared resolver.** "A named
   vantage must be held, and its ESSID is the standing network" was about to be stated a
   third and fourth time, so it became `standingVantage` beside the L1 gate it wraps. The
   two older callers (`hydraCrackPublic`, `resolveHttpSweep`) require the caller machine
   and were left alone — collapsing them too would have reshaped two shipped handlers on
   the epic's last slice for no behaviour. Mutation held: 100% on both patch modules after.
6. **`ftp` grew `-p` and a public branch; `ssh`'s was not shared.** The two commands differ
   in exactly what they are — a parallel session versus a hop — so the branch is a sibling,
   not a copy with a flag. The port default is the DOOR's (21), which is what keeps a bare
   `ftp <public ip>` from knocking on the gateway's sshd.
7. **The live run is what proved the client, and it caught nothing — which is the point.**
   Both adapters send fields no unit test can see; Act 11 is the only evidence they are the
   fields the server reads.

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
**DONE — 16/16 live** (`vercel dev` + supabase, 2026-08-15). `scripts/testFtpCrossPlayer.ts`: an
ftp login through a forward lands on the box behind it as a `kind:'ftp'` row; the visit is written
in that box's own `vsftpd.log` and nothing reaches `auth.log`; the address is the visitor's
server-derived one and never the one they sent; the row belongs to the box's owner; a forward that
reaches sshd refuses an ftp login and the ftp forward refuses an ssh one; a take and a drop are
itemised into the SAME row as the login, in order; the drop is refused one tier up; a visitor
naming a box they hold no session on is refused; and a login launched from a third network is
recorded as THAT network. Regressions re-run green on the same stack: `testFtpTransferTrace` 13/13,
`testFtpPut` 12/12, `testFtpSession` 14/14, `testFtpRemoteRead` 7/7, `testHydraCrossPlayer` 16/16,
`testCrossPlayerConnectionTrace` 7/7, `testCrossPlayerWrite` 12/12, `testCrossPlayerRead` 7/7,
`testSharedApForwards` 8/8, `testDisconnectedUnreachable` 6/6.
**Live close-out run: DONE** — Act 11 of `e2e-shared-network-verification.md`, two players on two
networks, executed 2026-08-15 against v0.136.0.
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
