# Plan: D4 — daemon control

**Branch**: `docs/plan-d4-daemon-control` (this plan) → `refactor/daemon-*` / `feat/systemctl-*` per slice
**Status**: Active — slice 0 ✅ shipped (2026-08-16, no version bump); slice 1 next
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) — Phase 1, door D4
**Grilled**: 2026-08-16 — ten locked decisions + a four-part spine in the epic's
["D4 — resolved scope & decisions"](legacy-parity-epic.md#d4--resolved-scope--decisions-grill-me-2026-08-16)

## Goal

A defender stops a service on a box they hold, the port closes for everyone, and it stays
closed until someone starts it again.

## Why this is mostly a reduction

D4 reads like "add daemon control", but the control half already ships — three times. The
`SERVICE_CATALOG` + pidfile design anticipated this door and left almost nothing to build:

| What already ships | Where | What D4 does with it |
|---|---|---|
| The pidfile format + every reader | `services/pidfile.ts` | Unchanged. `stop` removes the file the readers already consult |
| Three near-identical start commands | `sshd.ts`, `vsftpd.ts`, `webServer.ts` | Collapsed into one (slice 0), then given a second front door |
| Tombstoning a *generated* file | the brick (`/boot/vmlinuz`) | Stopping a daemon on an NPC box, same mechanism |
| Server-side port truth | materialize → `readOpenPorts` | A stop propagates cross-player with no new code |
| `env.patches.remove` | `commands/types.ts:149` | The whole of "stop" |
| `runUser` on every catalog row | `serviceCatalog.ts:63` | `ps`'s USER column, already populated |

What D4 owns alone: the `systemctl` command surface, `ps`, and the two login-gate corrections.

## Grounding that changed the plan before it was written

Five things the code says that the epic row could not have known. All five are recorded in the
grill; the two that reshaped the *slices* are (1) and (4).

1. **The three daemon modules are one module written three times.** 393 lines; a diff of
   `sshd.ts` and `vsftpd.ts` shows they differ *only* in which catalog row they bind and their
   prose. That makes slice 0 a reduction with an unusually strong oracle — 850 lines of existing
   tests that must keep passing **unchanged**.
2. **`ps`, `kill` and `chmod` are already planted binaries that do not run** (`BASE_BINARIES`),
   so `ls /bin` lists them and typing one says `command not found`. `systemctl` is in **no**
   binary list and must be planted.
3. **`env.patches.remove` exists and tombstoning a generated file is proven** — it is how the
   brick works. Stopping a daemon on an NPC box needs no new mechanism.
4. **A live bug**: `authCreateSessionSameLan:221` gates on `open.port === port` — the port, not
   the service — while its comment claims otherwise, and the client does not gate that path at
   all. On a shared ESSID, `ssh <neighbour> -p <their ftp port>` opens an **ssh** session through
   a port serving **ftp**. Ordinary once D4 lets players stop sshd and choose ports.
5. **`readOpenPortsFromPidfiles` has zero callers** — the server materializes and calls
   `readOpenPorts` on the tree instead. Dead since written; it retires with slice 0.

## Decisions carried in (do not re-litigate)

The grill locked ten. The five that constrain the slices below:

- **No PID — the SERVICE is the unit.** `ps` lists services; `kill` and eviction are **D5's**.
- **Runs anywhere you stand**, root-gated. Self-lockout, the contested AP gateway and
  player-vs-player service denial are accepted costs, not bugs to design around.
- **One state, and it persists.** No `enable`/`disable`. A stopped daemon stays stopped across a
  reboot, because the pidfile is a patch row and `reboot.ts` never touches the journal.
- **A stop does not evict.** Live sessions survive; only new logins are refused. An intruder
  outlives the door and can re-open it behind them.
- **No new log.** The `auth.log` line that let the intruder in is the attribution.

## Acceptance Criteria

- [ ] A player stops a service on a box they hold root on, and the port closes — locally, to a
      LAN scan, and to another player across the network
- [ ] A stopped service is still stopped after a reboot
- [ ] Starting it again restores reachability by every path that lost it
- [ ] A non-root caller cannot start or stop anything; any tier can ask what is running
- [ ] `ps` lists what a box is running, including a box the player only rooted
- [ ] Stopping a daemon a player is currently reaching *through* does not end their session —
      and does not let anyone new in
- [ ] A login is refused when the reached port is not serving the door's own service, on **every**
      endpoint — including a crafted client that skips the client-side check
- [x] The three shipped daemon commands behave exactly as they do today, from one implementation

## Reduction Program

Applies to **slice 0 only**. A single-slice program: no transitions, no bridges.

**Ledger/report**: recorded in slice 0 below — the diagnosis is finding (1) above, and the
conservation ledger is the unchanged test suite named in its baseline.
**Conserved contract**: `sshd [port]`, `vsftpd [port]`, `nginx [port]`, `apache2 [port]` — the
same gate order (root → already-running → port validity), the same streamed announce-then-listen
shape, the same `STARTUP_DELAY_MS` beat, byte-identical pidfile content, identical output lines,
identical exit codes, and `webServer`'s two-names-one-port conflict reply naming the **conflict**
rather than the program.
**Superseded mechanism**: three per-daemon command modules each re-implementing port parsing,
the gate ladder, the write-error map and the streaming generator (393 lines), plus the unreachable
`readOpenPortsFromPidfiles`.
**Terminal slice**: slice 0 (it is both the only and the terminal slice).
**Owner and removal condition**: `N/A — no temporary bridge.` The collapse is a single
substitution; no compatibility shim is introduced at any point.
**Behavior gate**: `sshd.test.ts`, `vsftpd.test.ts` and `webServer.test.ts` (850 lines) pass
**unchanged** — not rewritten. Rewriting them would destroy the oracle that makes this a reduction
rather than a rewrite. Full suite green; `tsc -b` and `eslint` clean.

> **As-built amendment (2026-08-16).** "Not re-pointed" was unachievable as written: the three
> suites import the module under test, so deleting the modules forces the import specifier to
> change. The gate was tightened instead of loosened — the permitted diff is **exactly the import
> line and nothing else**, which is mechanically checkable and was checked: six changed lines
> across the three files, all of them `from './sshd'|'./vsftpd'|'./webServer'` → `from './daemon'`.
> Every `describe`, `it`, factory and assertion is byte-identical.

**Mechanism gate**: like-for-like — three command modules become one, the four registrations stay,
`readOpenPortsFromPidfiles` is gone, and no new module, type, flag or indirection is introduced to
absorb the difference. Net line count down; net exported surface not up.

---

## Slices

Four slices. Slice 0 is a **terminal reduction** and follows the verified REFACTOR path — it has
no RED, and no structural mutant may be fabricated for it. Slices 1–3 are behavior changes
following RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR.

---

### Slice 0: The three daemon commands become one

**Value**: Preserved consumer surface — four command names, identical behavior — from one
implementation instead of three, so the next door that adds a daemon adds a catalog row rather
than a fourth copy of the same 130 lines. This is the mechanism D4 then gives a second front door
to; doing it after `systemctl` would mean collapsing four copies instead of three.
**Path**: `sshd|vsftpd|nginx|apache2 [port]` → one catalog-driven module → `env.patches.write` of
the pidfile. Preserved public surface: the four `Command` exports and their registry entries.
**Class**: Terminal reduction.
**Required implementation skills**: `reduce-system-complexity` (governing), `refactoring`,
`testing`, `mutation-testing`. **`tdd` is `N/A`** — no observable behavior changes, so there is no
honest RED; the passing suite is the baseline.
**Reduction program**: the plan-level program above. This slice is its terminal state.
**Transition/terminal evidence**: behavior gate + mechanism gate must both pass (defined above).
No bridge, so no bridge metadata. Net-reduction claim is made **only** here.

**Acceptance criteria** (present and confirm before code):
- `sshd.test.ts`, `vsftpd.test.ts` and `webServer.test.ts` pass **unchanged** — any edit to them
  invalidates the gate and turns this into a rewrite
- One module implements the start path; three per-daemon modules are gone
- `readOpenPortsFromPidfiles` is deleted and nothing imports it
- `webServer`'s conflict reply still names the conflict, not the program — the one behavior in the
  three that is not a pure parameterization, and the most likely thing to lose
- No new type, flag, option object or indirection was added to absorb the difference between the
  three; the parameter is the existing `ServiceSpec`
- ~~Mutation score on the collapsed module is not worse than the three it replaces~~ →
  **no mutant that the baseline killed survives in the collapsed module** (amended; see below)

> **As-built amendment (2026-08-16).** `ServiceSpec` alone cannot be the parameter. It holds
> world-generation facts (pidfile, ports, placement, sweep log) and deliberately carries no command
> presentation — not the command name, the `Starting <banner>...` line, the already-running wording,
> the availability rule, or the manual page. A descriptor is unavoidable, so the criterion is met
> the only way it can be: **no NEW mechanism**. `webServer.ts` already had exactly this shape (a
> `WebServerProgram` descriptor + a `webServerCommand` factory); that descriptor was widened into
> `Daemon` and now serves all four names. Named types stay at one, and module-level functions fall
> from 16 to 6.

> **As-built amendment (2026-08-16) — the mutation criterion was wrong.** "Score not worse" cannot
> survive a de-duplication. Collapsing three copies of a well-tested function removes two copies of
> its *killed* mutants while the un-oracled parts stay put, so the ratio falls even though no test
> got weaker. Measured: baseline 73.76% (194 killed / 69 survived / 263 mutants) → collapsed 64.52%
> (80 / 44 / 124). A metric that rewards copy-pasting a tested function is measuring duplication.
>
> Replaced by the claim that actually matters, which **passes**: all 44 survivors are un-oracled
> presentation text — `WRITE_ERROR`'s two unexercised keys, the shared manual block, and the four
> descriptors' prose. **Zero survive in `parsePort`, `runningPort`, `start` or the gate ladder**, so
> no logic detection was lost; and prose was never killed before either, since no test in v2 asserts
> a manual page. Pre-existing, which this slice's own KILL MUTANTS rule excludes. The `man`/`help`
> oracle gap is real and belongs to its own slice.
>
> Beware the default clock: the same module reads **78.23%** at `timeoutMS` 30s because 17 slow
> static mutants time out and Stryker scores a timeout as a kill. `--timeoutMS 180000` is the honest
> number. Recorded in `docs/conventions-and-gotchas.md`.

**Preservation baseline**: the 850 lines of existing daemon tests, plus a mutation run over the
three modules *before* the change, so the after-run has something to be compared against. Capture
the before-score in the slice's evidence.
**Preservation change**: one module parameterized by `ServiceSpec`; four thin registrations. The
port default, the gate ladder and the streaming shape move as-is.
**MUTATE**: Stryker over the collapsed module; compare to the captured baseline.
**KILL MUTANTS**: only where the baseline killed them and the collapsed version does not — a
survivor that also survived before is pre-existing, not a regression this slice introduced.
**REFACTOR**: `N/A` — this slice *is* the restructuring.
**Done when**: both gates pass, the suite is green unchanged, and the human approves the commit.

---

### Slice 1: A defender shuts a door, and it stays shut

**Value**: The thing nothing in the game can do today. A player stops a service on a box they
hold root on and the port closes — to their own scan, to a neighbour's, and to a stranger across
the network — and stays closed across a reboot.
**Path**: `systemctl <verb> <daemon>` → root gate → pidfile read (`env.fs.stat`) →
`env.patches.remove` / `.write` on the box being stood on → `readOpenPorts` no longer reports it →
server materializes the same journal, so every cross-player reader agrees.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Scope**:
- `systemctl start|stop|status|restart <daemon>`; bare `systemctl` refuses with usage.
- Daemon names (`sshd`/`vsftpd`/`nginx`), with **`apache2` aliased** onto the same `http` unit and
  replies naming the conflict rather than the program.
- `start` routes into slice 0's collapsed module — a second front door, not a second writer.
- `stop` is `env.patches.remove(pidfilePath(spec))`; on a generated NPC box that tombstones a
  generated file, which is exactly how the brick works.
- **Gates**: `start`/`stop`/`restart` root-only at runtime, world-executable on disk (the shipped
  `sshd` pattern); `status` at any tier.
- **`/usr/bin/systemctl` planted on every machine**, generated hosts included, alongside
  `SYSTEM_DAEMON_NAMES`. Not apt-installable.
- `status` answers running/inactive from the pidfile. **Not-installed and unknown-unit collapse**
  into `Unit <name>.service could not be found`, so a guest cannot enumerate a box's packages.
- `restart` = stop-then-start, and must succeed on a service that is not currently running (real
  `systemctl restart` does).

**Acceptance criteria** (present and confirm before code):
- `systemctl stop sshd` on a box the player holds root on removes the pidfile; a subsequent
  `nmap` of that host no longer lists `:22`
- The stopped service is still stopped after `reboot`
- `systemctl start sshd` restores the port, and `ssh` to it succeeds again
- `systemctl stop sshd` as a non-root caller is refused and the pidfile is untouched
- `systemctl status sshd` reports running-with-port vs inactive; `status` works as `guest`
- `systemctl status mysqld` and `systemctl status nonsense` give the **same** reply
- `systemctl stop apache2` stops a running nginx, and the reply names the web server rather than
  claiming apache2 was running
- `systemctl restart vsftpd` works whether or not it was running
- Stopping a service on a box the player is standing on via ssh does **not** end their session

**RED**: A behavior test driving `systemctl stop sshd` through `CommandEnv`, asserting the pidfile
is gone and `readOpenPorts` over the resulting tree no longer reports ssh — failing because the
command does not exist. Plus a root-gate test and a `status`-tier test.
**GREEN**: The `systemctl` module + the binary planting.
**MUTATE**: Stryker over `src/core/commands/systemctl.ts`. Expect survivors around the verb
dispatch and the alias table — `mutator-rules.md` flags string-literal and conditional mutants
there.
**KILL MUTANTS**: verb-by-verb cases, alias vs canonical name, and running vs not-running for
`status` and `restart`.
**REFACTOR**: Assess whether `status` and `ps` (slice 2) want a shared "what is running here"
reader. **Do not build it in slice 1** — one caller is not a pattern, and slice 2 is where a
second one appears.
**Done when**: criteria met, gates green, human approves.

---

### Slice 2: A player sees what a box is running

**Value**: The recon and defence instrument. You cannot manage what you cannot see, and a
defender who suspects an intruder has no way to survey their own box today.
**Path**: `ps` → read `/var/run/*.pid` off `env.fs` → one row per running service, columns from
the catalog (`runUser`, the daemon name, the port).
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Scope**:
- `ps` on the box being stood on — including one the player only rooted, which is free: `env.fs`
  already follows the shell.
- Any tier. Real `ps` needs no root, and a guest seeing what runs is a recon reward that costs the
  defender nothing they control.
- Columns `USER  COMMAND  PORT`, sourced from `runUser` + the pidfile basename + the parsed port.
- The binary is already planted (`BASE_BINARIES`), so there is no availability work — only the
  command behind it.
- An empty `/var/run` prints the **header and no rows**, as real `ps` does. A bare header is the
  answer "nothing is running", and printing nothing at all is indistinguishable from a broken
  command.
- An unrecognised `/var/run` entry is skipped, not rendered — `readOpenPorts` already does this,
  and `ps` must not become a second policy for what counts as a service.

**Acceptance criteria** (present and confirm before code):
- `ps` on a box running sshd and vsftpd lists both, with their real ports (including a non-default
  port from `altPorts`)
- `ps` after `systemctl stop sshd` no longer lists sshd — the slice-1 loop, seen from inside
- `ps` as `guest` works and shows the same rows as root
- `ps` on a box with an empty `/var/run` prints the header only
- `ps` run on a rooted NPC box lists **that** box's services, not the player's own

**RED**: A behavior test asserting `ps` output lists the running services of the machine in
`env.fs`, failing because the command does not exist.
**GREEN**: The `ps` module.
**MUTATE**: Stryker over `src/core/commands/ps.ts`.
**KILL MUTANTS**: the empty case, the unrecognised-entry skip, and the non-default port.
**REFACTOR**: Now that a second reader exists, assess the shared "what is running here" helper
deferred from slice 1. Take the collapsed option only if both callers genuinely want the same
shape — `status` asks about one named service, `ps` asks for all of them, which may be two
questions rather than one.
**Done when**: criteria met, gates green, human approves.

---

### Slice 3: The door a crafted client cannot walk through

**Value**: A defender's stop is worth exactly as much as the weakest endpoint that honours it.
This slice makes every login path agree that a service which is not running cannot be logged into
— including for a client that skips the client-side check, since the wire is the threat surface.
**Path**: `authCreateSession` (own-LAN) and `authCreateSessionSameLan` (shared ESSID) → the
reached port must be serving the door's own service → `service_not_running` 404.
**Class**: Behavior change (server-side only; no client surface).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Scope**:
- **Drop the `payload.kind !== 'ssh'` exemption** at `authCreateSession:229`. Anti-cheat only —
  the client already gates (`ssh.ts:307`), so no honest player sees a change. The blocker §9
  recorded ("what happens to a player mid-session") is answered by the grill: sessions survive.
- **Fix `authCreateSessionSameLan:221`** to check the SERVICE on the reached port, not merely that
  *something* is listening there. Its comment already claims this; the code does not do it.
- Both are the same rule — D2.4's `reachedPort`, which §7 says binds the login gate — applied to
  the two sites that were missed.
- Last deliberately: it has **no player-visible surface**, so leading with it would open the door
  with a PR that proves nothing a player can see.

**Acceptance criteria** (present and confirm before code):
- A login whose kind is `ssh` against a host running no sshd is refused with `service_not_running`,
  where today it succeeds
- A same-LAN `ssh` to a neighbour's **ftp** port is refused, where today it opens an ssh session
- A same-LAN `ssh` to a neighbour's real sshd port still succeeds, on the default port and on an
  `altPorts` one
- No honest-client behavior changes: the existing ssh/ftp/scp suites stay green untouched
- **Wire-check**: a `scripts/testDaemonGates.ts` run against `vercel dev` + local supabase proves
  both endpoints refuse live, and that a service stopped by `systemctl` is what makes them refuse —
  an `api/` change is unproven until it runs against the real stack. `scripts/testSameLanConnect.ts`
  is the closest analogue to adapt
- **E2E**: the full defender loop in a real browser per the `v2-e2e` skill, appended to
  `e2e-shared-network-verification.md`:
  ```
  A: systemctl status sshd      running, port 22
  A: systemctl stop sshd
  B: nmap <A's public IP>       :22 gone
  B: ssh root@<A public IP>     Connection refused
  A: ps                         sshd absent, other services still listed
  A: systemctl start sshd
  B: ssh root@<A public IP>     in again
  ```

**RED**: Handler tests for both endpoints — an `ssh`-kind request against a host with no sshd, and
a same-LAN request against a port serving ftp — both currently passing where they should 404.
**GREEN**: One clause dropped; one predicate widened from port to port-and-service.
**MUTATE**: Stryker over the two changed regions. `N/A` for the wire-check and E2E, whose evidence
is the live run recorded in the doc.
**KILL MUTANTS**: the service-match predicate — an `ftp`-serving port must not open an `ssh` door,
and the right port with the right service must still open.
**REFACTOR**: Assess whether the three endpoints' now-identical reached-port check collapses into
one shared predicate. Four call sites would make it a pattern; check whether the fourth
(`resolveInnerGatewayTarget`, which checks by port for a different reason) belongs or not.
**Done when**: criteria met, wire-check and E2E recorded, gates green, human approves.

---

## Explicitly out of scope (named, deferred)

- **`kill`** and **session eviction** → **D5**, where a planted `nc -l` backdoor is something
  worth killing and is not a `SERVICE_CATALOG` row. "Shut the door" and "remove who is already
  inside" are two defender verbs.
- **`chmod`** — leaves the epic row entirely. Independent capability with real blast radius
  (`availability.ts` reads a binary's own `perms.execute` at run time), so it gets its own
  decision rather than riding in here.
- **`enable`/`disable`** — one state only; the difference is observable solely across a reboot.
- **A service-state log** — the `auth.log` line that admitted the intruder is the attribution, and
  `writer_key` already holds the forensics for a future "who touched my box" surface.
- **`systemctl` listing all units** — duplicates `ps`.

## Pre-PR Quality Gate

Per slice, from `v2/`:
1. Mutation evidence (or reviewed `N/A` + alternate evidence for the wire-check/E2E criteria)
2. Refactoring assessment — and for slice 0, the `reduce-system-complexity` behavior **and**
   mechanism gates
3. `npm run typecheck` (`tsc -b` — a plain `tsc --noEmit` is a NO-OP) and `npm run lint`
4. Version bump in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`) for slices 1–3 → v0.140.0, v0.141.0, v0.142.0.
   **Slice 0 does not bump**: the rule bumps on feature changes, and a behavior-preserving
   reduction is not one.

---
*Delete this file when D4 is complete; fold the as-built into
`v2/docs/conventions-and-gotchas.md` and close out in `plans/legacy-parity-epic.md`.*
