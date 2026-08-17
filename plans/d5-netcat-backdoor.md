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
- [ ] `nc -l <port>` as root writes `/var/run/nc-<port>.pid`; `ps` lists it with a PID, an owner
      and a port; `nmap` shows the port `open` with SERVICE `unknown`
- [ ] `kill <pid>` removes a listener and its port closes for everyone; `kill` on a service refuses
      and points at `systemctl`; both require root
- [ ] Connecting to a listener opens a session at the tier its pidfile records, with no credential
      asked for and nothing written to any log
- [ ] `su` and `nano` refuse inside an nc session in their real words; everything else runs, so a
      root-planted listener can brick and a user-tier one cannot
- [ ] Killing a listener drops whoever is inside it on their next command
- [ ] ~10% of generated NPC hosts run a listener at user tier, measured across a population
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

### Slice 2: A player plants a listener, and can see it

**Branch**: `feat/nc-listen-plant`

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

### Slice 3: A defender takes a listener away

**Branch**: `feat/kill-listener`

**Value**: The defender's answer to a backdoor — and D4's first deferred verb, arriving where it
has something worth killing.
**Path**: `kill <pid>` → root gate → resolve the pid through `readRunningServices` →
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
- A pid belonging to a service → refused, naming `systemctl stop <unit>`
- Non-root → refused, and the listener survives
- A listener SURVIVES a reboot and is still killable afterwards

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

### Slice 4: Connecting to a backdoor drops you in a shell

**Branch**: `feat/nc-backdoor-session`

**Value**: The door itself — a login with no credential, at the tier its pidfile records. First
time the game lets you back into a box without knowing anything about it.
**Path**: `nc <host> <port>` finds a listener rather than a service → the login gate's credential
step reads the pidfile instead of `/etc/passwd` → session row at that tier → `env.pushSession({kind:'nc'})`
→ the ordinary shell answers, minus what needs a TTY.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**All four gates in this slice, not some of them.** `SERVICE_BY_DOOR` gains `nc: 'unknown'`, so the
shipped reached-port check works untouched, and the credential STEP becomes pluggable across
`authCreateSession`, `authCreateSessionSameLan`, `authCreateSessionPublic` and
`authCreateSessionInnerGateway` at once. Applying it to some gates now and the rest later would
recreate exactly the asymmetry D4 slice 3 existed to remove. `SessionKind` already carries `'nc'`
(`types.ts:39`) — no schema change.

**The no-TTY gate — one design call to settle at RED.** Two candidate seams: a central check in
`runLine.ts` beside the existing command-not-found path, driven by a new `requiresTty` field on
`Command`; or the check inside `su.ts` and `nano.ts` themselves. **Recommend central**, so a third
TTY-dependent command cannot forget — but only if `runLine` genuinely reads the field, because §9
already records `AvailabilityRule` as a declared-and-unenforced field ("enforce it or delete it")
and a second inert declaration would be the same mistake twice.

**Demoable single-player, no generation needed**: root an NPC host (NPC root 12%, or the gateway at
40%), `apt install netcat` there, plant, exit, `nc` back in.

**Acceptance criteria**
- `nc <host> <port>` where a listener answers opens a session and prompts — no password asked
- The session's user and tier come from the PIDFILE, read server-side; a client claim is ignored
- Nothing is written to `auth.log` or any other log, on connect or on plant
- `su` refuses with `su: must be run from a terminal`; `nano` with `Error opening terminal: unknown`
- Everything else runs: a root-planted listener can `rm /boot/vmlinuz`; a user-tier one is refused
  by the ordinary walker
- A port serving a SERVICE still gets slice 1's banner, not a session

**RED**: Connect to a planted listener and assert a session exists at the pidfile's tier — fails
today. Second RED: `su` inside that session refuses.
**GREEN**: The pluggable credential step, the `nc` session kind wiring, the TTY gate.
**MUTATE**: Meaningful — the service-vs-listener branch, the tier derivation, the TTY predicate.
**KILL MUTANTS**: Assert the tier comes from the pidfile and NOT from the caller — a mutant that
trusts a client-supplied tier must fail. This is the slice's security-relevant survivor.
**REFACTOR**: Assess whether the four gates' credential steps now share enough to hoist.
**Wire-check**: **Required** — `api/` changes, and `tsc` cannot see DB columns or constraints.
Prove the pidfile-derived tier lands correctly on a real session row.
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

### Slice 5: Killing a listener drops whoever is inside it

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

---

### Slice 6: The world already has backdoors

**Branch**: `feat/generated-backdoors`

**Value**: A player scanning a LAN they have never touched finds a port they cannot account for,
connects, and is in — the discovery loop that justifies connect-mode existing.
**Path**: `remoteHostFs.ts` seeded generation → a listener pidfile at 0.10 → `readRunningServices`
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
   (`npm install --package-lock-only`). Current: **0.144.0**
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
