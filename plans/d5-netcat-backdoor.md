# Plan: D5 — `nc` connect + `nc -l` backdoor

**Branch**: one per slice off `main` (named per slice below)
**Status**: Active
**Grill**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) → "D5 — resolved scope & decisions"
(15 locked decisions). **Read that first** — this plan sequences those decisions and does not
re-open them.
**Foundations**: [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md) §3
(reachability/login), §4 (authorization), §5 (read filter);
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1, §7, §9.

## Goal

A player can probe an unknown port and learn what answers, leave a listener behind on a box they
have rooted, find one the world left behind, and take one away — with the defender able to see and
kill it.

## Deviation from the locked spine (needs approval)

The grill locked **six** slices. This plan has **eight**, from two splits:

1. **Eviction leaves slice 4 and becomes slice 5.** "Connecting to a backdoor drops you in a
   shell" and "killing a listener drops whoever is inside it" are two concepts with two
   observables, and bundling them gives slice 4 three "and"s — the skill's named signal for a
   slice that is too big. Eviction cannot move *earlier* than the connect, because there is
   nothing to evict until you can get in.
2. **The credential step lands in ALL FOUR gates at once, in slice 4** — rather than own-LAN in
   slice 4 and the rest in the cross-player slice. This is D4 slice 3's lesson applied in advance:
   a rule applied to some gates and not others is exactly the drift that slice existed to remove.
   The final slice is then reach + live proof, not a second helping of the same rule.

Net: slices 0–3 and 6–7 are the locked spine unchanged; slice 4 is narrowed and slice 5 is its
other half.

## Acceptance Criteria

- [x] `nc <host> <port>` against a running service prints that service's banner and closes; a
      closed port, an unknown host and localhost each refuse in netcat's own words
- [x] `nc -l <port>` as root writes `/var/run/nc-<port>.pid`; `ps` lists it with a PID, an owner
      and a port; `nmap` shows the port `open` with SERVICE `unknown`
- [x] `kill <pid>` removes a listener and its port closes for everyone; `kill` on a service NAME
      refuses and points at `systemctl` (a service has no pid to aim at); the kill requires root
- [x] Connecting to a listener opens a session at the tier its pidfile records, with no credential
      asked for and nothing written to any log
- [x] Everything needing a terminal refuses inside an nc session — `su`, `nano`, `ssh`, `scp`,
      `ftp`, `lynx` — while everything else runs, so a root-planted listener can brick and a
      user-tier one cannot
- [x] Killing a listener drops whoever is inside it on their next command
- [x] ~10% of generated NPC hosts run a listener at user tier, measured across a population
- [ ] A listener behind a NAT forward is reachable, scannable and enterable from off-LAN, proven by
      a wire-check and a two-player browser run
- [x] `ps` on a box you have ENTERED lists what it is running (§9 defect closed)

## Reduction Program

`N/A` — no mechanism is being retired. Slice 0 hoists a duplicated constant while changing
behavior, so it is classified as a behavior change, not a reduction.

## Slices

Every slice below is a **behavior change** unless stated: RED-GREEN, mutation testing, conditional
mutant handling, refactor assessment. Load `tdd`, `testing`, `mutation-testing` and `refactoring`
before code in each one. **Present each slice's acceptance criteria and wait for approval before
writing any code.**

---

### Slice 0: A visitor can see what the box they entered is running — DONE (v0.143.0)

**Branch**: `fix/pidfile-visible-to-visitors`

**As-built.** Shipped as planned; the diagnosis held. `PIDFILE_PERMISSIONS` now lives in
`services/pidfile.ts` and all four producers resolve it. Mutation: `pidfile.ts` 100% (71 killed,
0 survived) and `bringUp` 100% (10 killed, 0 survived) — `daemon.ts`'s whole-file 64.80% is the
`manual`/`description` prose class §4 already documents, all outside the changed region.
Wire-check `scripts/testPidfileVisibility.ts` 4/4; its third check seeds a pidfile in the
PRE-FIX shape and asserts it is still pruned, so the first two cannot pass for a reason other
than permissions. §9 rewritten as CLOSED, including that its own first diagnosis was wrong.

Two things worth carrying into later slices:

- **Four daemon test files asserted the write's exact options object**, so changing the write's
  shape touched `sshd`, `vsftpd` and both web-server suites. Slice 2 adds the nc pidfile write —
  expect the same fan-out, and reach for the shared `PIDFILE_WRITE` constant `sshd.test.ts` now
  declares rather than adding a fifth literal.
- **A Stryker run that dies leaves `.stryker-tmp/` behind and `npm run lint` then reports
  hundreds of phantom errors inside it** (eslint ignores only `dist`/`coverage`). Recorded in §4.
  If a lint run explodes, check the paths before believing it.

**Value**: An intruder standing on another player's box runs `ps` and gets rows instead of a bare
header. Closes the §9 defect, and it is what makes every later slice's `ps` observable across a hop.
**Path**: `daemon.ts` `bringUp` → `env.patches.write(..., { permissions })` → the patch row carries
permissions → server materializes and `filterTreeForRead` at the session's tier keeps the entry →
`ps` prints it.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**The defect is a producer disagreement, not a read-filter problem.** §9 proposes projecting
`/var/run` to a foreign session regardless of tier; that is the wrong fix. The generator stamps
world-readable pidfiles while `daemon.ts:149` passes no permissions and gets
`defaultFilePermissions('root')` → `read: ['root']`, so the filter is correctly pruning a file the
box really does call root-only. **Update §9 in `conventions-and-gotchas.md` as part of this slice.**

**Scope note — one constant, three private copies.** `PIDFILE_PERMISSIONS` is declared privately in
`routerFs.ts:107` and `generateDeepLayer.ts:131`, and again as `PIDFILE_PERMS` in
`remoteHostFs.ts:72`. Hoist ONE exported constant into `services/pidfile.ts`, beside
`formatPidfileContent` and `pidfilePath` — the module §7 already names as owning the pidfile's
shape — and have all four producers use it. Without this, the fix is a fourth copy.

**Acceptance criteria**
- A guest- or user-tier session on a box whose owner started `sshd` sees the service in `ps`
- The same box's `/var/run/sshd.pid` remains root-WRITABLE — only the read tier widens
- All four producers (three generators + `daemon.ts`) resolve one exported constant

**RED**: Apply the patch `sshd` produces through `applyPatches`, prune the resulting tree with
`filterTreeForRead(tree, 'guest')`, and assert `ps` over it lists the service. Fails today because
the patch carries no permissions. This crosses the projection locally, which is precisely what §9
says a tree-built-by-hand unit test cannot do.
**GREEN**: Export `PIDFILE_PERMISSIONS` from `services/pidfile.ts`; pass it on the `bringUp` write;
repoint the three generator copies.
**MUTATE**: Meaningful — the permission arrays are prime mutation targets (dropping `'guest'` from
`read`, widening `write`). Expect and kill both.
**KILL MUTANTS**: Assert the write tier is unchanged, not only that the read tier widened.
**REFACTOR**: The hoist IS the refactor; assess nothing further.
**Wire-check**: **Required.** §9 was found by a live run and the fix must be proven by one — a unit
test cannot see the server's materialize-then-prune. Extend an existing `scripts/test*.ts` or add
`scripts/testPidfileVisibility.ts`.
**Done when**: All criteria met, §9 rewritten, wire-check green, human approves the commit.

---

### Slice 1: A player grabs a banner off a stranger's port — DONE (v0.144.0)

**Branch**: `feat/nc-connect-banner`

**As-built.** Shipped as planned, plus **one acceptance criterion added mid-slice**: `nc` never
answers for a REAL OCCUPANT of the player's ESSID. Without it `nc` would have been the only
network command missing that rule — `nmap` refuses to invent an occupant's ports and `ssh` routes
them before the generated path — and on an octet collision `nc` would have greeted as whichever
NPC that address would have rolled, on a box whose services only its owner's journal knows. An
occupant address now answers `Connection refused`: they are up, what they run is theirs.

Mutation: the behavioral region 97.78% (88 killed, 2 survived, both equivalent — `[]` →
`["Stryker was here"]` has no `.port` to match so it refuses identically, and
`host === undefined → false` is unreachable because `bindFlags` pushes positional args and so
leaves no holes). Whole-file 75.68% is the `manual`/`description` prose class §4 documents.
`serviceCatalog.ts` 100% (6/6). The occupant guard's own predicate mutant (`localIp === host` →
`true`) SURVIVED the first pass and was killed by a test proving one neighbour on the LAN does not
silence every NPC box — worth noting, as the two obvious occupant tests both left it alive.

Three things worth carrying forward:

- **Stryker generates no mutants inside `as const satisfies` object literals**, so the three
  banner VALUES cannot be mutation-tested. Mutation is `N/A` for catalog content; the golden test
  pinning all three exact strings is the evidence. Expect the same for every future catalog column.
- **`ssh.ts`'s private `sshPortOf` is a second reader of `/var/run`**, re-implementing what
  `pidfile.ts` owns. A reduction candidate once slice 2's union lands, not before.
- **The banner column is version-free by construction**: `SSH-2.0-OpenSSH` keeps the protocol
  identifier and drops the build. `SSH-2.0` and `HTTP/1.1` are protocol tokens and narrow a box
  to nothing, which is the distinction locked decision 12 actually turns on.

**Value**: A player points `nc` at any open port and learns what is answering — the walking
skeleton, and the recon verb that makes an unaccounted-for port answerable at all.
**Path**: registry → `nc.ts` → target resolution (own-LAN sync; cross-LAN via the async resolver,
mirroring `ssh.ts`) → `readOpenPorts` on the resolved tree → match the port → streamed
`Connecting…` / `Connected…` / banner / `Connection closed.`
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Free from what is already shipped**: `nc` is already an `APT_PACKAGES` row
(`{name:'netcat', binaries:['nc']}`), so availability gating needs nothing. Locked decision 12 puts
`banner` on `SERVICE_CATALOG` as a column this slice consumes — **version-free**, because
`readFilter.ts:57` already names `/var/lib/dpkg/status` as where `nmap -sV` versions come from and
the epic reserves the version column for V1.

**Acceptance criteria**
- `nc <ip> 22` against a host running sshd prints the ssh banner, then closes
- A port nothing is serving → `nc: connect to <ip> port <n>: Connection refused`
- An unresolvable host → `Connection timed out`; `localhost`/own IP → `Connection refused`
- Cancellable mid-connect (Ctrl-C unwinds, per the `env.sleep` convention)
- The three catalog banners carry no version string
- ADDED MID-SLICE: an address held by a fellow occupant refuses rather than answering from the
  generated world, and a neighbour elsewhere on the LAN leaves every NPC box answering

**RED**: `nc <ip> 22` emits the ssh banner where today the command does not exist.
**GREEN**: The `banner` column plus a connect-only `nc` command; no listener concept yet.
**MUTATE**: Meaningful — port comparison, the open/closed predicate, boundary ports (0, 1, 65535,
65536).
**KILL MUTANTS**: Cover both port boundaries; assert the refusal TEXT, since a swapped refusal
message is a survivor a shape-only assertion misses.
**REFACTOR**: Assess sharing target resolution with `ssh.ts` rather than copying it.
**Wire-check**: `N/A` — no `api/` change. Cross-LAN resolution rides the shipped resolver.
**Done when**: All criteria met, human approves the commit.

---

### Slice 2: A player plants a listener, and can see it — DONE (v0.145.0)

**Branch**: `feat/nc-listen-plant`

**As-built.** Shipped as planned, with **one shape change and four criteria added** at approval:

- **The PID is derived where it is consumed, not stored.** `readRunningProcesses(root)` keeps its
  one-argument signature and returns the union WITHOUT a `pid`; `ps` derives it from the machine id
  it already holds, via `listenerPid(machineId, port)`. Storing it would have let a planter's client
  author its own PID, and would have fanned the machine id through `readOpenPorts`, which has no use
  for one. **Slice 3's `kill` must therefore resolve a pid by matching `listenerPid` over
  `readRunningProcesses`, not by reading a field.**
- `readRunningServices` → **`readRunningProcesses`**, `RunningService` → `RunningProcess`. The old
  name would have been actively wrong the moment it returned listeners. Two call sites, no fan-out.
- Added: the pidfile carries `PIDFILE_PERMISSIONS` (the fifth producer, and slice 0's exact defect);
  listening needs NO network, because `env.network` follows the player's own box rather than the one
  the shell stands on; malformed listener content is SKIPPED rather than defaulted, since unlike a
  service there is nothing to fall back to; and connecting to a listener still refuses, pinning the
  intermediate state slice 4 replaces.

Mutation, behavioral regions: `pidfile.ts` **100%** (123 killed, 0 survived), `ps.ts` **100%**
(15/15), `nc.ts` L1–218 **98.59%** (140 killed, 2 survived — both slice 1's recorded equivalents,
unchanged). Whole-file `nc.ts` 79.01% / `ps.ts` 62.16% is the `manual`/`description` prose class §4
documents; every one of those 52 survivors is at or below the `Command` literal.

Four things worth carrying forward:

- **`noUncheckedIndexedAccess` is OFF** (`tsconfig.app.json` sets only `strict`), so a regex
  capture is typed `string`, not `string | undefined`. A defensive `capture === undefined` guard is
  therefore DEAD CODE, and Stryker correctly reports it as a survivor. The first pass had one; the
  fix was deleting the guard, not writing a test for it.
- **Slice 0's predicted daemon-suite fan-out did not happen.** `nc -l` is a NEW call site, not a
  change to the shared write's shape, so the four suites asserting the options object were untouched.
  The `PIDFILE_WRITE` constant is still worth reaching for, but the warning was about the wrong risk.
- **`WRITE_ERROR` now has two byte-identical copies** (`daemon.ts`, `nc.ts`). Deliberate, and
  approved: slice 3's REFACTOR already targets that map, and a third copy is cheaper to hoist once
  than to hoist twice. Slice 3 should now expect THREE sites, not two.
- **The usage line names both modes** — `nc: usage: nc <host> <port> | nc -l <port>`. Connect mode's
  existing assertion changed with it; one command, one usage line.

**Value**: A player with root leaves something behind on a box, and both `ps` and `nmap` show it —
the defender's alarm and the attacker's lure in one step.
**Path**: `nc -l <port>` → root gate → `env.patches.write('/var/run/nc-<port>.pid', …)` →
`readRunningServices` returns it as a `listener` → `ps` prints a row, `readOpenPorts` projects it →
`nmap` shows `unknown`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**The union is the whole design decision** (locked decision 3): `readRunningServices` keeps its
single pass and returns `{kind:'service'; spec; port} | {kind:'listener'; port; user; userType; pid}`.
`nmap.ts` needs **no change at all** — it renders `entry.service` from `readOpenPorts`, so
projecting a listener as `{port, service:'unknown'}` is the entire nmap story. `ps` gains a PID
column, filled for listeners and `-` for services. The PID comes from
`createPrng('<machineId>:nc:<port>')` so it is stable across rereads and reboots — legacy's
renumbered on every read (`kill.ts:46`).

**Forced, do not re-litigate**: only root can plant, because `/var/run` is `write: ['root']`. Do
NOT port legacy's below-1024 gate (`nc.ts:47`) — it is unreachable behind the root gate, the same
branch D4 rejected for daemons.

**Acceptance criteria**
- `nc -l 4444` as root reports listening and creates `/var/run/nc-4444.pid`
- As non-root → refused; the pidfile is not created
- A second `nc -l 4444` → already-listening refusal; `nc -l 22` with sshd up → port-in-use refusal
- `ps` shows `PID USER COMMAND PORT` with the planter's name and `nc`; services show `-` for PID
- `nmap` against that host shows the port `open` / SERVICE `unknown`
- An unparseable or unknown `/var/run` entry is still skipped, and a DIRECTORY named
  `nc-4444.pid` is still not a listener

**RED**: `nc -l 4444` then `ps` lists a row naming the planter — fails today on both halves.
**GREEN**: The union in `pidfile.ts`, the pidfile format, the `-l` branch, the `ps` column.
**MUTATE**: Meaningful and high-value — the union's discriminator, the port parser, the
already-running and port-in-use predicates, the PID derivation's stability.
**KILL MUTANTS**: Assert the PID is the SAME across two reads and across a reboot; a single read
cannot distinguish a stable PID from a random one.
**REFACTOR**: Assess whether `ps`'s row formatting wants one function per kind or one with a hole.
**Wire-check**: `N/A` — client + shared core only.
**Done when**: All criteria met, human approves the commit.

---

### Slice 3: A defender takes a listener away — DONE (v0.146.0)

**Branch**: `feat/kill-listener`

**As-built.** Shipped as planned, with **one acceptance criterion replaced** at approval and three
added after mutation:

- **The service-refusal criterion was unreachable and was re-aimed at the NAME.** The plan said a
  pid belonging to a service refuses and names `systemctl` — but after slice 2 a service has no
  pid at all (`ps` prints `-`), so no number a player can type resolves to one. It was the same
  shape as the below-1024 gate this plan already refuses to port. Replaced with `kill sshd` →
  `kill: sshd: use "systemctl stop sshd"`, which is reachable, and is what a player would really
  type given the survey hands them no number. It echoes the name AS TYPED — `systemctl stop
  apache2` really works, so translating it to the shared unit name would hand them a program they
  never mentioned. Argument shape is checked before privilege, so a guest gets the pointer rather
  than a root refusal that would be advice that does not work.
- `systemctl.ts` grew one export, `isUnitName`. **Name-only, deliberately**: `unitFor` gates on
  `binaryExists` so a guest cannot enumerate a box's packages, but whether the program is installed
  HERE is `systemctl`'s question — `kill` answering it would answer it in the wrong voice. It uses
  `Object.hasOwn`, because both `in` and a bare lookup walk the prototype chain and would make
  `kill toString` a service.
- `-9` is **not** declared, per "follow legacy": legacy read it as the pid and refused it. v2's
  flag binder intercepts dash tokens before a command sees them, so the refusal arrives as
  `unrecognized option: -9` (exit 2) — same outcome, different words, and the words are not kill's
  to choose. Non-root says `kill: must be run as root` (the house voice, not legacy's
  `Operation not permitted`), and success is SILENT, as the real thing and legacy both are.

Mutation, behavioral regions: `kill.ts` L1–88 **100%** (52 killed, 0 survived), the hoisted
`PATCH_ERROR_REASON` **100%** (5/5), `systemctl.ts`'s `isUnitName` **100%** (1/1). Whole-file
`kill.ts` 69.51% is the `manual`/`description` prose class §4 documents — all 22 of those survivors
sit at or below the `Command` literal.

Three survivors from the first pass were REAL, and each became a test:

- **`running.kind === 'listener'` → `true` survived.** This is the plan's predicted mutant, arriving
  in a different shape than predicted: with no service-pid branch to test, the discriminator is
  guarded instead by a box running sshd where the player types `listenerPid(box, 22)` — a real
  number the derivation defines for any port. Unguarded, `kill` reports success and removes a
  `/var/run/nc-22.pid` that never existed, telling a defender they shut a door that is still open.
- **`pid >= 1` → `pid > 1` survived.** `kill 1` is the boundary between "that is not a PID" and "no
  process here has it" — two different next moves for a player, and legacy handed 1 to init.
- **`lines: []` → `["Stryker was here"]` survived a `text` assertion**, because
  `[undefined].join('\n')` is `''`. A command that emits a content-free line READS as silent. The
  test now asserts the lines array, not the joined string — worth remembering for every future
  silent-success command.

**REFACTOR done, and it grew.** The plan's target was three copies of the `PatchResult` → reason
map; slice 2's as-built corrected that to three, and `kill` made **four** (`daemon.ts`, `nc.ts`,
`systemctl.ts`, `kill.ts` — byte-identical). Hoisted to `PATCH_ERROR_REASON` in `commands/types.ts`,
beside the `PatchResult` type it maps from (`types.ts` already carries a runtime export,
`COMMAND_CATEGORIES`). Commands still prefix their own name: which door refused is the caller's to
say. Slices 4–5 should USE it rather than adding a fifth literal.

**Value**: The defender's answer to a backdoor — and D4's first deferred verb, arriving where it
has something worth killing.
**Path**: `kill <pid>` → root gate → resolve the pid by matching `listenerPid` over
`readRunningProcesses` →
`env.patches.remove(pidfilePath)` → the port closes for the owner's scan, a neighbour's and a
stranger's, through the same journal path `systemctl stop` already uses.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Services are units, listeners are processes** (locked decision 5). `kill` targets listeners
only; a pid that resolves to a service refuses and names `systemctl`. `kill` is root-only — forced,
since removing the pidfile goes through the L2 walker and `/var/run` is `write: ['root']`. Legacy's
non-root kill-your-own branch (`kill.ts:177`) is unreachable here; do not port it.

**Acceptance criteria**
- `kill <listener pid>` removes the pidfile; `ps` no longer lists it and `nmap` no longer shows the
  port
- A pid that matches nothing → `kill: (<pid>): No such process`
- A SERVICE NAME → refused, naming `systemctl stop <name as typed>` (REPLACES the plan's
  service-pid criterion, which slice 2's derived-pid design made unreachable)
- Non-root → refused, and the listener survives
- A listener SURVIVES a reboot and is still killable afterwards
- ADDED AFTER MUTATION: a number that lands on a service's port takes nothing away; `kill 1` is
  "No such process" while `kill 0` is not a process ID; success emits NO LINES rather than lines
  that merely read as empty

**RED**: Plant, `kill`, then assert `ps` is empty and the port is gone — fails today.
**GREEN**: `kill` with the pid lookup and the two refusals.
**MUTATE**: Meaningful — the pid match, the kind discriminator on the refusal branch, the root gate.
**KILL MUTANTS**: The service-refusal branch needs its own test, or a mutant that kills services
too will survive.
**REFACTOR**: Assess sharing the `PatchResult` → reason map with `systemctl.ts` (both already map
the same four errors; `daemon.ts` has a third copy).
**Wire-check**: `N/A` — `patches.remove` is shipped and proven by `systemctl stop`.
**Done when**: All criteria met, human approves the commit.

---

### Slice 4: Connecting to a backdoor drops you in a shell — DONE (v0.147.0)

**Branch**: `feat/nc-backdoor-session`

**As-built.** Shipped as designed, with **one design change forced by a discovery** and three
findings worth carrying:

- **`nc` now ASKS THE BOX rather than consulting its own map** (approved mid-slice). The client's
  own-LAN resolution reads `resolveLanHostIdentity(host, essid).baseFs` — the GENERATED tree, with
  no journal replay — and `nmap`'s reads `buildRemoteHostFs`. The four gates DO replay it. So a
  listener planted on a rooted NPC host is visible from ON the box (`ps` works) and invisible from
  outside it, which would have made this slice's own demo impossible. The client now uses its local
  view only to answer "does the catalog name this port?" (banner, no round trip); anything else goes
  to the gate. **This changed slice 1's shipped behavior**: an own-LAN refusal now costs a round
  trip, so `nc.test.ts` gained a default `noDoors()` seam.
- **The replay gap is wider than `nc` and is NOT fixed here.** `systemctl stop sshd` on a rooted NPC
  host is invisible to the player's own scan for the same reason, and `resolveInnerGatewayTarget`
  builds a DEEP host's tree with `buildDeepHostFs` and never replays its journal at all — so a
  listener planted on a deep NPC cannot be reached through that gate. The inner-gateway arm is wired
  and tested against the GATEWAY itself, whose journal is replayed. Backlog candidate, and it bears
  on slice 6.
- **`SERVICE_BY_DOOR` was narrowed by TYPE, not retyped to labels** (improving on settled call 5).
  `Record<Exclude<DoorKind,'nc'>, keyof typeof SERVICE_CATALOG>`: a backdoor knocks on no daemon, so
  it has no service row and no `sweepLog`, and the type now says so. Adding `'nc'` to `DOOR_KINDS`
  then broke `authCreateSessionPublic.ts`'s compile — the compiler enforcing "four gates, one path".
- **A FIFTH copy of the `PatchResult`→reason map** was found in `runLine.ts` (`REDIRECT_WRITE_MESSAGE`).
  Slice 3 swept `commands/`; this one lives in `shell/`. Folded into `PATCH_ERROR_REASON`, which also
  killed its surviving `modified_since_open` mutant.

Mutation, behavioral regions: `authCreateSession.ts` **95.12%** (156 killed, 8 survived — the
`payload.username === undefined` guard cluster is EQUIVALENT, since `accountIn` returns null for a
missing user and produces the same 401 either way; `{kind:'passwd'}` → `{kind:""}` is equivalent for
the same reason, only `'listener'` is ever compared). `runLine.ts`'s TTY gate **100%**; `su.ts` and
`nano.ts` 1/1. `nc.ts` L90–324: the knock's payload objects all survived the first pass — the tests
asserted WHICH door was knocked on but not WHAT was sent, so a mutant emptying the payload knocked
at the right endpoint with no address, port or session id. Four payload assertions killed them. Two
dead branches (`target.kind === 'lan' &&`, `machineId === null`) were REMOVED rather than tested,
via `Exclude<Target,{kind:'nowhere'}>` and folding the machine id into the success arm.

**Known gaps, recorded rather than hidden:**
- the inner-gateway arm's REFUSAL branch (`nc.ts:190`) has no coverage — the other three arms'
  refusals are covered by the default seam
- one full-suite run showed a single failure that two subsequent runs did not reproduce; unidentified

**Wire-check `scripts/testNcBackdoorSession.ts` 6/6.** Its second and third checks are the slice's
whole security claim and only provable live: a payload naming `username: 'root'` against a
`userType=user` listener lands a **user** row, while a root-PLANTED listener really does land root —
the pair together, because either alone cannot tell a tier that is read from one pinned to the safe
answer. The fifth asserts zero `auth.log` rows on the target: a handler that returns without logging
could still be logged by a shared helper further down, which only the real journal can rule out.

**Value**: The door itself — a login with no credential, at the tier its pidfile records. First
time the game lets you back into a box without knowing anything about it.
**Path**: `nc <host> <port>` finds a listener rather than a service → the login gate's credential
step reads the pidfile instead of `/etc/passwd` → session row at that tier → `env.pushSession({kind:'nc'})`
→ the ordinary shell answers, minus what needs a TTY.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**All four gates in this slice, not some of them.** The credential STEP becomes pluggable across
`authCreateSession`, `authCreateSessionSameLan`, `authCreateSessionPublic` and
`authCreateSessionInnerGateway` at once. Applying it to some gates now and the rest later would
recreate exactly the asymmetry D4 slice 3 existed to remove. `SessionKind` already carries `'nc'`
(`types.ts:39`) — no schema change.

**Demoable single-player, no generation needed**: root an NPC host (NPC root 12%, or the gateway at
40%), `apt install netcat` there, plant, exit, `nc` back in.

### Settled at approval (2026-08-17) — six calls, recorded so they are not re-opened

1. **The no-TTY rule is WIDER than the two commands the epic named, and this changes locked
   decision 7.** A bind shell has no pty, and that blocks everything which has to reach a human
   through the terminal — not just `su` and `nano` but `ssh`, `scp` and `ftp` (all four prompt for a
   password through `env.prompt`) and `lynx` (a full-screen browser). The epic named the two famous
   ones; the property is the same for all six. **This is what makes the three doors differ**: `ftp`
   moves files, `nc` looks and breaks, `ssh` is the only one you can pivot ONWARD from — so a
   cracked password stays worth having. It is also the more realistic reading, not a concession
   against realism: a pty-less `ssh` really does fail at password auth. Still no allowlist — each
   command answers for itself.
2. **`apt` is NOT blocked.** It is the one named tool that genuinely works over a pty-less shell,
   which is why `apt install netcat` is the real reflex. The outcome is already delivered by TIER:
   `apt` needs root, a generated listener is user tier (locked decision 10), and a root-planted one
   is your own door on a box where you already had root. Blocking it would be the first entry in
   something list-shaped, for one case: re-entering your own backdoor.
3. **One field carrying its own message: `withoutTty?: string` on `Command`**, read in
   `runLine.ts`'s `prepareStage` beside the command-not-found path (exit 1). A boolean would need a
   second field for the wording; this way declaring the rule and enforcing it are the SAME act, so
   it cannot rot into §9's `AvailabilityRule` ("enforce it or delete it" — inert, and a mutation
   survivor on every command added since). `prepareStage` validates every stage up front, so
   `su | grep x` refuses too, for free. `su` and `nano` keep their canonical real strings; the other
   four use su's wording generalized — `<command>: must be run from a terminal` — so nothing is
   invented per command. `identity` and `reset` stay exempt: game commands, outside the fiction.
4. **Do NOT reach for `AvailabilityRule` as the mechanism.** It already declares `localhost-only` on
   `ssh`/`scp`/`ftp`/`apt`/`su`, which looks like exactly this rule — but it is not merely inert, it
   is WRONG on two: `su` works on another player's workstation today (the shipped
   `elevateCrossPlayer` path) and `apt` must work on a remote box (`scripts/testRemoteAptInstall.ts`,
   5/5, which this slice's demo depends on). Enforcing it would break both. §9's decision stays its
   own slice.
5. **`SERVICE_BY_DOOR` cannot gain `nc: 'unknown'` as the epic wrote it.** Its values are
   `keyof typeof SERVICE_CATALOG`, and there is no `unknown` row — adding one means inventing a
   `sweepLog` that locked decision 3 calls a lie, plus a banner and placement for a service that does
   not exist. Map a door to the service LABEL instead (`UNKNOWN_SERVICE` for nc), which is what the
   reached-port check already compares (`open.service === …`), leaving the catalog lookup only where
   a spec is genuinely needed. **The nc door varies in TWO steps, not one**: the credential (pidfile,
   not `/etc/passwd`) AND the log (nothing, ever — locked decision 6), so model a door as a small
   record per kind rather than an `if (kind === 'nc')` in four handlers.
6. **All four CLIENT arms ship with the four gates.** Four gates no client can reach would be the
   same declared-and-unenforced mistake as the field above — and `nc` reaches only one of them
   today, because `resolveOpenPorts` deliberately returns `[]` for a fellow occupant. Route as `ssh`
   does: an occupant address goes to the same-LAN gate and **the server answers from the real
   journal**. That PRESERVES slice 1's rule rather than bending it — nothing is invented client-side
   from the generated world, and an occupant's sshd port still fails the reached-port check and
   refuses in netcat's own words.

**Also delete in this slice**: the `mode_change` variant `{kind:'nc', target:{ip,port}}`
(`types.ts:93`). Nothing produces it, `state.ts:232` narrows `OverlayMode` to `'nano' | 'lynx'` so
the UI could not render it, and this slice's shape — a hop via `pushSession`, not an overlay — means
nothing ever will. Leaving it invites a future reader to build the screen the design just rejected.
(`mysql`/`redis` are the same class but belong to unshipped commands; out of scope.)

**Acceptance criteria**

*The door*
- `nc <host> <port>` where a LISTENER answers opens a session on that box — no password asked — and
  the prompt becomes that host's; `exit` pops back
- The session's user and tier come from the PIDFILE, read server-side: a client claiming `root`
  against a `userType=user` listener lands as **user**
- A port serving a SERVICE still gets slice 1's banner and closes — a session is what a listener
  gives you, and nothing else
- Nothing is written to `auth.log` or any other log, on connect or on plant, on success or refusal
- A port with neither listener nor service still refuses in netcat's own words; a bricked or
  unreachable host still times out
- All four arms land a session: own LAN, a fellow occupant, a public IP, an inner gateway

*The shell you land in*
- `su` → `su: must be run from a terminal`; `nano` → `Error opening terminal: unknown`
- `ssh`, `scp`, `ftp`, `lynx` → `<command>: must be run from a terminal`
- Everything else runs, gated only by TIER: a root-planted listener can `rm /boot/vmlinuz`; a
  user-tier one is refused by the ordinary walker. No command allowlist anywhere
- The refusal fires before execution and PER STAGE (`su | grep x` refuses) and ONLY inside an nc
  session — `su` on your own box is untouched
- You land in the recorded user's HOME directory, as every other hop already does
- A pidfile whose `userType` is unparseable is not a door: `readRunningProcesses` skips it, so it
  refuses rather than defaulting to a tier nobody granted

**RED**: Connect to a planted listener and assert a session exists at the pidfile's tier — fails
today. Second RED: `su` inside that session refuses.
**GREEN**: The pluggable credential step, the `nc` session kind wiring, the TTY gate.
**MUTATE**: Meaningful — the service-vs-listener branch, the tier derivation, the TTY predicate.
**KILL MUTANTS**: Assert the tier comes from the pidfile and NOT from the caller — a mutant that
trusts a client-supplied tier must fail. This is the slice's security-relevant survivor. Assert the
TTY refusal fires only for `kind:'nc'`, or a mutant that refuses everywhere survives.
**REFACTOR**: Assess whether the four gates' credential steps now share enough to hoist.
**Wire-check**: **Required** — `api/` changes, and `tsc` cannot see DB columns or constraints.
Prove the pidfile-derived tier lands correctly on a real session row, that a client-claimed tier is
ignored, and that NO auth.log row is written.
**Open question — RESOLVED 2026-08-17, ahead of the slice.** *Does `apt install` work against a
remote rooted box?* **Yes.** Settled live by `scripts/testRemoteAptInstall.ts`, 5/5:

| case | result |
|---|---|
| root session on an ordinary NPC LAN host (`kind: 'machine'`) → `/usr/bin/nc` | **200**, row lands |
| **guest** session on the same host → `/usr/bin/nc` | **403 `permission_denied`** |
| root session on another player's workstation | **200**, row lands |
| no session on the target | **403 `no_session`** |
| root session on an inner gateway | **200**, row lands |

Locked decision 14 stands as written, and the demo path is safe to build on. Three things the
check pinned down that the plan had only assumed:

- **Installing netcat is exactly ONE write.** `nc` has no entry in `libraryDeps`, so the library
  loop writes nothing and there are no extra files — `/usr/bin/nc` with `is_new: true` and
  world-executable perms is the whole install.
- **The server refuses a guest, which matters more than the happy path.** `apt`'s root gate is
  CLIENT-side (`handleInstall` reads `env.session.userType`), and §7 records that a client with a
  valid keypair can mint its own session — so L2 is the only real gate, and it holds. Without
  this, `apt install` would be privilege escalation on any box you can open a guest shell on.
- **A rooted inner gateway is plantable too**, on a different tree (router FS, not
  `buildRemoteHostFs`). Consistent with the grill's "possible by construction" note; asserted so a
  future divergence between the two resolver arms is caught rather than discovered.

---

### Slice 5: Killing a listener drops whoever is inside it — DONE (v0.148.0)

**Branch**: `feat/nc-eviction`

**Value**: The defender's counter-play reaches someone already in the room — D4's second deferred
verb, and the point where `kill` and `systemctl stop` visibly differ.
**Path**: intruder's next command → the nc binding re-reads the target's `/var/run` → pidfile gone
→ close the session in netcat's words → pop back to the caller's own shell.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**A pull, not a push** (locked decision 9). This is how a real terminal behaves — you learn the
socket died by writing to it — and it costs nothing: no push channel, and no widening of
`endSession`, which is deliberately scoped so a caller can only end their OWN rows. The difference
from `systemctl stop` is real, not arbitrary: sshd forks a child per session so a stop leaves them
running, while netcat is the one process that both listens and serves.

**Acceptance criteria**
- With a session held on a listener, `kill` from the defender then any command from the intruder →
  `nc: connection closed by foreign host`, and the intruder is back on their own box
- The intruder's own client ends its own session row (a call it is already permitted to make)
- A `systemctl stop` does NOT evict — D4's rule is unchanged and still tested
- The intruder sees nothing until they act; no polling is introduced

**RED**: Hold an nc session, remove the pidfile, run any command, assert the session is gone —
fails today (the session survives).
**GREEN**: The pidfile re-check in the nc binding plus the close path.
**MUTATE**: Meaningful — the presence predicate and the close branch.
**KILL MUTANTS**: Assert the `systemctl stop` non-eviction case in the same suite, or a mutant that
evicts on any missing pidfile survives.
**REFACTOR**: Assess only if the re-check duplicates slice 4's resolution.
**Wire-check**: `N/A` if the session end is the shipped `endSession`; **required** if any server
change proves necessary.
**Done when**: All criteria met, human approves the commit.

**As built** (v0.148.0)

- **The gate sits beside the no-TTY gate, and runs before the line is parsed.** Same shape of rule
  (this session cannot do that), same seam, and it covers pipelines uniformly — `ls | grep x` can
  no more slip past a dead socket than `su | grep x` could past a missing pty. Running it before
  the parse is what makes a typo answer `nc: connection closed by foreign host` rather than
  `command not found`: nothing the player typed reached the box, so the box was never there to
  have looked.
- **`Session` gained `port`, and only a backdoor sets it.** Every other kind spends its port
  reaching the box and never needs it again; a backdoor is the one door that has to keep asking
  whether it is still there. **No refresh gap exists to close**: `nc` is not in
  `sessionRehydrate.ts`'s `HOP_KINDS`, so a reload abandons the session and closes the row rather
  than restoring a shell that could never be evicted. Persisting the port server-side would have
  bought nothing — which is why this slice needed no migration and no wire-check.
- **THE FINDING: the unit gate was green and the game was unaffected.** `patches()` is refetched
  after this client's own successful write (`wrapWithRefetch`) and on a machine change — never
  before a read. The defender's `kill` lands on the target's journal from a different browser, so
  the intruder's materialized `/var/run` kept showing a pidfile that was gone. Fixed with one
  `refetchPatches()` before running a line **when the active session is `nc`** — a round-trip paid
  only while standing in a backdoor. That is the locked "pull, not a push" in full: nothing is
  polled, and an intruder who types nothing learns nothing.
- **Caught by an integration test, not by review.** `state.test.ts` boots already associated
  (`CONNECTED_ESSID_KEY` + a remembered lease), seeds `/usr/bin/nc` into the own box's journal the
  way `apt install` stamps it, walks in through the real gate, then drops the pidfile from the
  target's journal. It was RED (`mallory@laptop-25:/root# ls` ran happily) while all seven unit
  tests were green — the gap this slice existed to close, visible only at the layer that has a
  client and a server.
- **`listenerOn` moved from `authCreateSession.ts` to `pidfile.ts`.** The gate asking "may I come
  in" and the shell asking "am I still in" are the same question a moment apart, and a box that
  admitted a visitor must not be able to disagree with the box that still holds them. The move
  also keeps zod and the signed-request verifier out of the client bundle, which importing the
  server handler would have dragged in. Slice 4's orphaned `reachDoor` doc comment was reunited
  with `reachDoor` on the way past.
- **Mutation**: `runLine.ts` 96.91% — zero survivors in the new gate; the remaining five plus one
  no-coverage are slice 4's pre-existing set. One real survivor was killed on the way: dropping
  `session.kind !== 'nc'` survived, because nothing else records a port today. Pinned with a login
  session that DOES carry a port and still is not evicted — which is the rule stated properly
  rather than an accident of what happens to set the field.
- **`systemctl stop` still does not evict**, asserted in the same suite: the listener's pidfile is
  what is asked after, so removing `sshd.pid` leaves the intruder exactly where they were. The
  difference is real — sshd forks a child per session, netcat is the one process that both listens
  and serves.

---

### Slice 6: The world already has backdoors — DONE (v0.149.0)

**Branch**: `feat/generated-backdoors`

**As-built.** Shipped as planned; the rate, the pool and the tier are all as locked. Six
observations worth carrying:

- **Two of the four exclusions had no predicate to write.** `baseFsForLanHost` already sends
  routers and switches to their own generators and the player's box comes from
  `buildWorkstationBaseFs`, so nothing in `buildRemoteHostFs` could have planted on them. The
  plan expected a mutant per exclusion; there was no branch to mutate. They are covered instead
  by a REGRESSION guard in `lanHostIdentity.test.ts` that sweeps six networks — paired with a
  second test asserting the NPC machines of those same networks DO carry listeners, without
  which the first would pass just as well with the roll switched off. The workstation half needed
  nothing: `workstationFs.test.ts` already asserts `/var/run` is EMPTY at boot, which is
  strictly stronger; only its comment was extended to say why that now matters.
- **The one link nothing else covered was generator → login gate.** Every backdoor test from
  slice 4 hands the listener to `reachDoor` through the JOURNAL. A door the world planted lives
  in the base tree instead, so `authCreateSession.test.ts` gained a test that knocks on a box
  exactly as the generator made it, with an empty journal. It passed first try — the gate reads
  `resolveLanHostIdentity(...).baseFs` — but it was the only thing standing between "we generate
  a pidfile" and "a player can walk through it", and it was untested.
- **A home LAN often has NO backdoor at all, and that is the rate working.** `BEAN-THERE-WIFI`
  carries zero across its eight machines; `NAKATOMI-PLAZA` carries two. The gate test therefore
  samples several networks for a carrier rather than trusting one ESSID, and the population
  suite measures over 8 ESSIDs x 253 octets (194 of 2024 = 9.6%).
- **The roll seeds its OWN stream** (`backdoor-<essid>-<ip>`), mirroring `hostServices`. Drawing
  from the host-filesystem prng would have shifted every draw after it and silently re-rolled
  every NPC username and password on every network. A preservation test pins two hosts' accounts
  to values captured BEFORE the roll existed, so that mistake cannot be made later either.
- **Mutation: `remoteHostFs.ts` 95.24% (20 killed, 1 survived), `pidfile.ts` 100% (4 killed).**
  The single survivor is `>=` -> `>` on the placement comparison, and it is provably EQUIVALENT
  rather than a gap: `prng.next()` returns `k / 2**32`, and `0.1 * 2**32 = 429496729.6` is not an
  integer, so the boundary the mutant moves can never be hit. Recorded rather than chased.
- **`listenerPidfileName` was hoisted into `pidfile.ts`.** A generator stamps a `/var/run` entry
  NAME while `nc -l` writes an absolute path; both now compose one function, because a
  world-planted door that is named differently from a player-planted one is a door a defender
  can tell apart at a glance.

**Value**: A player scanning a LAN they have never touched finds a port they cannot account for,
connects, and is in — the discovery loop that justifies connect-mode existing.
**Path**: `remoteHostFs.ts` seeded generation → a listener pidfile at 0.10 → `readRunningProcesses`
reads it exactly as a planted one → `nmap` shows `unknown` → `nc` lands a user-tier session.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Placement 0.10, NPC hosts only** (locked decision 10). **Never the AP gateway** — locked decision
1 makes it the contested pre-CVE root target. **Never another player's workstation** — nobody opts
into being backdoored by the generator. The listener claims a real account from that host's
`/etc/passwd` at **user tier**; the port is drawn from legacy's list
(`attackChain.test.ts:122` — `[4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]`).

**Measured across a population, not asserted** — the same standard D2.2's crackable knobs were held
to, because a generation-time probability is a property of the world, not of one box.

**Acceptance criteria**
- Across a large generated population, ~10% of NPC hosts carry a listener (within tolerance)
- The same seed always produces the same listener, port and account — determinism holds
- The account named exists in that host's `/etc/passwd`, and the tier is `user`
- No AP gateway and no player workstation ever carries a generated listener
- Connecting to one lands a user-tier session that CANNOT `su` and CANNOT touch `/boot`

**RED**: A population test asserting the rate — fails today at 0%.
**GREEN**: The placement roll and the pidfile plant in `remoteHostFs.ts`.
**MUTATE**: Meaningful — the probability comparison, the tier constant, the exclusion predicates.
**KILL MUTANTS**: The gateway/workstation exclusions each need a test, or a mutant that drops them
survives — and that mutant is a locked-decision-1 regression.
**REFACTOR**: Assess whether the listener plant shares the service plant's shape.
**Wire-check**: `N/A` — pure generation, client-side and deterministic.
**Done when**: All criteria met, human approves the commit.

---

### Slice 7: A stranger's backdoor, across the network

**Branch**: `feat/nc-cross-player-reach`

**Value**: The persistence loop closes — plant on a box, forward the port, and reach it from
anywhere. Mostly PROOF rather than new mechanism, and deliberately last for the same reason D4's
gate slice was: it has little a player can see, so leading with it would prove nothing.
**Path**: `nmap <public IP>` → `scanResult` shows the forward because its target is serving →
`nc <public IP> <port>` → `machineServing` routes to `internalIp:internalPort` → slice 4's gate
lands the session on the occupant's machine id.
**Class**: Behavior change (verification-led).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**The grill expects this to be nearly free** — `machineServing` already routes a public port and
`scanResult` already shows a forward iff its target is serving that internal port, which a listener
now does. **Treat "nearly free" as a hypothesis to falsify, not a plan.** If reach needs real work,
that is the finding, and it belongs here rather than in a slice that claimed to be done.

**Acceptance criteria**
- A listener behind a NAT forward appears in an outsider's `nmap` of the public IP
- `nc <public IP> <forwarded port>` from off-LAN lands a session on the occupant's box
- A forward whose target is not serving, or whose holder has disconnected, reaches nothing
- The full loop works: crack the gateway → root a neighbour → `apt install netcat` → plant →
  forward → reach from off-LAN

**RED**: An off-LAN connect to a forwarded listener — assert the session lands on the occupant.
**GREEN**: Whatever the hypothesis turns out to require; ideally nothing.
**MUTATE**: Meaningful on any new routing predicate; `N/A` with recorded rationale if no production
code changes and the slice is purely proof.
**KILL MUTANTS**: Per the above.
**REFACTOR**: Assess `N/A` if no production change.
**Wire-check**: **Required — this slice carries D5's headline wire-check.** The off-LAN path is
provable only live.
**E2E**: Append **Act 14** to
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md) — a
two-player browser run of the full loop.
**Done when**: All criteria met, wire-check and Act 14 green, human approves the commit.

---

## Pre-PR Quality Gate

Per slice, from `v2/`:

1. **Mutation or alternate evidence** — run `mutation-testing`; record explicit `N/A` plus
   proportionate evidence where it is not meaningful
2. **Refactoring assessment** — `refactoring`; record `N/A` when nothing is worth changing
3. **Typecheck** — `npm run typecheck` (`tsc -b`; a plain `tsc --noEmit` is a NO-OP here)
4. **Lint/format** — `npm run lint` (v2 has no Prettier)
5. **Version bump** on every feature slice — `v2/package.json` AND `v2/package-lock.json`
   (`npm install --package-lock-only`). Current: **0.149.0**
6. **Wire-check** where the slice says required — `scripts/test*.ts` against `vercel dev` +
   supabase. `tsc` cannot see DB columns or constraints, so an `api/` regression ships green
   without one

## Close-out

When all slices merge: fold the as-built into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the listener union, the
units-vs-processes split, the no-TTY rule) and §9 (rewrite the `ps` entry as CLOSED), update the
D5 section of [`legacy-parity-epic.md`](./legacy-parity-epic.md) with the as-built and the next
door, and **delete this file**.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
