# Plan: D8 — `snmpwalk` / `snmpset`

**Branch**: `feat/d8-snmp-install` (slice 8 — intra-slice stack of two boundaries; boundary 1 not started)
**Status**: Active — slice 1 MERGED (#465, v0.185.0); slice 2 MERGED (#466, v0.186.0,
2026-08-27); slice 3 MERGED (#467, v0.187.0, 2026-08-28); slice 4 MERGED (#468, v0.188.0,
2026-08-28 — AC-1…AC-14 met, wire-check RUN 16/16 and falsified twice, mutation gate closed
at 88.65%); slice 5 MERGED (#469, v0.189.0, 2026-08-28 — AC-1…AC-13 met, wire-check RUN
12/12 and falsified twice, mutation gate closed at 85.32%); slice 6 MERGED (#470, v0.190.0,
2026-08-29 — AC-1…AC-15 met, wire-check RUN 13/13 and falsified twice, mutation gate closed at
97.43%); slice 7 MERGED (#471, v0.191.0, 2026-08-30 — AC-1…AC-13 met, cross-player
wire-check RUN 15/15 and falsified, AC-12's three neighbours re-run 16/16 + 12/12 + 13/13, mutation
gate closed at 97.99%); slice 8 **PLANNED, CONFIRMED, READY FOR RED** — AC-1…AC-15 agreed, the
two-boundary stack confirmed 2026-08-31, `ownAgentCommunity` settled through the language protocol,
no code written
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D8 — resolved scope & decisions
(grill-me, 2026-08-27)", eleven locked decisions, gap-checked the same day.

## Goal

A player reconfigures a network device without ever holding a shell on it: `snmpwalk` reads a
device's identity and — with a cracked read-write community — its port table, and `snmpset` rewrites
that table, all of it a VIEW over the `rules.v4` / `acl.conf` files v2 already parses.

## Read before starting

- Epic §"D8 — resolved scope & decisions" — the eleven decisions and the five
  forced-rather-than-chosen entries. **Do not re-litigate them here.**
- [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the daemon descriptor,
  the reach parameterized by daemon, the occupant-beats-sibling rule) and §9.
- [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md) §3–§5, §8 — needed from
  slice 3 onward, not for slice 1.

## Slice spine

| # | Slice | Observable | Status |
|---|-------|-----------|--------|
| 1 | a device answers SNMP | `nmap` shows `161/udp snmp` on a router/switch | **merged** #465 |
| 2 | a player walks it with `public` | identity OIDs return; the walk lands in `snmpd.log` | **merged** #466 |
| 3 | a player cracks the RW community | `hydra <host> snmp` → the port table renders | **merged** #467 |
| 4 | a player opens a port, no shell | `snmpset` adds a forward; `nmap` shows it | **merged** #468 |
| 5 | a device on a deep layer answers | the inner-gateway vantage | **merged** #469 |
| 6 | a player runs their own agent | owner filters a port; `127.0.0.1` still works | **merged** #470 |
| 7 | a player reconfigures another's | B opens a forward into A's LAN | **merged** #471 |
| 8 | a player's own agent answers somebody | B re-opens a port A filtered | **planned** |

Only slice 1 is planned in full. Plan each later slice when its predecessor lands — D7 proved that
slices 5 and 7 cost far less than their plans assumed, because `reachServiceHost` already
generalizes, and planning them early would bank effort against work that does not exist.

---

## Slice 1: a generated router or switch runs an SNMP agent, and a scan can see it

**Value**: A player scanning their own LAN sees `161/udp snmp` on the gateway and on the switch —
the first evidence in the game that infrastructure runs something a host does not, and the discovery
step every later D8 slice depends on. It also gives the `switch` role its first service: today
`rolePlacement.switch` is `{}`, so a switch is a device you can scan and never touch.

**Path**: `nmap <subnet>` → per-host port resolution off the generated filesystem's
`/var/run/*.pid` → `SERVICE_CATALOG` lookup for the SERVICE and now the PROTOCOL column → the
PORT/STATE/SERVICE table.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack — nothing later starts before this lands, and
the epic's conventions warn against stacking on a branch that will be squash-merged with
`--delete-branch`.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### Acceptance criteria — CONFIRMED 2026-08-27, before any code

- [x] **AC-1** With a generated LAN whose gateway rolled an SNMP agent, `nmap <subnet>` lists that
      gateway with a `161/udp   open   snmp` row.
- [x] **AC-2** Every existing service still renders `/tcp` — `22/tcp`, `80/tcp`, `3306/tcp`,
      `6379/tcp` are unchanged in the same table.
- [x] **AC-3** A generated switch rolls an SNMP agent at a materially higher rate than a router:
      over a fixed seed sweep, `switch` lands ≈0.9 and `router` ≈0.6, and **no `machine`-role host
      ever rolls one** (flat `placement: 0`, no role cell).
- [x] **AC-4** The player's own AP gateway ALWAYS runs the agent, for every ESSID — pinned, not
      rolled.
- [x] **AC-5** A gateway that rolled an agent carries `/var/run/snmpd.pid` owned by its `runUser`,
      and one that did not carries no such file.
- [x] **AC-6** `systemctl start snmpd` and `systemctl stop snmpd` both resolve on a device that has
      the agent — the daemon is in `DAEMONS` and `UNITS`, so `systemctl.test.ts`'s three guards stay
      green.
- [x] **AC-7** Generation stays byte-stable for an unchanged seed: adding the agent moves no octet
      the lease allocator excludes, and no existing generated host changes.

### RED

Behavior tests, in this order — each fails for the right reason before any production change:

1. **`nmap` renders a service's protocol, not a hardcoded `tcp`.** The sharpest RED available: a
   test asserting a `161/udp` row against a fixture host running the agent fails on the literal
   `/tcp` in `nmap.ts:79` before the column exists.
2. **Placement obeys the role.** A seeded sweep asserting switch ≈0.9 / router ≈0.6 / machine = 0
   fails while no `snmp` row exists.
3. **The AP gateway is pinned.** Asserting the agent present across many ESSIDs fails while nothing
   plants it.
4. **The pidfile is planted, and only when the agent rolled.** Both directions, because the absent
   case is where a mistake hides.

**Mutants to design against** (from `mutation-testing`'s mutator rules, used for test design only —
the harness runs once at PR readiness):

- The protocol column defaulting to `'udp'` instead of `'tcp'` must break AC-2, so the test must
  assert an existing service's `/tcp`, not merely that snmp reads `/udp`.
- Swapping the router and switch rates must fail AC-3 — so assert the two rates SEPARATELY and by
  name, never as "switch ≥ router". #463's guards earned this: compare names, not counts, so a
  failure says which device is wrong.
- Inverting the pidfile condition must fail AC-5, which is why the absent case is its own assertion.

### GREEN — the minimum, in dependency order

1. **`ServiceSpec` gains `protocol`**, defaulting to `'tcp'`; `nmap` renders `${port}/${protocol}`.
   Blast radius is genuinely small — `/tcp` appears in only three files (`nmap.ts`, `nmap.test.ts`,
   `mysqld.test.ts`).
2. **`SERVICE_CATALOG.snmp`**: `service: 'snmp'`, `pidfile: 'snmpd.pid'`, `defaultPort: 161`,
   `protocol: 'udp'`, `runUser: 'root'`, a version-free `banner`, `placement: 0`, `altPorts: []`,
   `altPortChance: 0`, `accountsOn: () => []`.
3. **`sweepLog` is a REQUIRED column**, so `src/core/logging/snmpdLog.ts` arrives here even though
   nothing sweeps until slice 3. Ship `formatAttempt` only; `formatArrival` and the SET line belong
   to the slices that write them.
4. **`rolePlacement`**: `router: { ssh: 1, snmp: 0.6 }`, `switch: { snmp: 0.9 }`.
5. **`DAEMONS` + `UNITS` gain `snmpd`** — forced, not chosen: `systemctl.test.ts:707` goes red the
   moment the catalog row exists.
6. **`buildGatewayBaseFs` takes `hasSnmp` beside `hasSsh`**, planting `/var/run/snmpd.pid` and an
   empty `/var/log/snmpd.log` when true. One change, inherited by all six builders.
7. **Seeded per box, each in its OWN namespace** — the pattern `seedApGatewayHasSsh` already uses,
   so no existing draw sequence moves: `inner-gw-snmp-`, `deep-gw-snmp-`, and the switch variants.
   **The AP gateway takes no draw at all** — decision 1 pins it.

### Two things GREEN must get right

**The AP gateway cannot be pinned through the placement table.** `ssh` is pinned by
`router: { ssh: 1 }`, so `seedApGatewayHasSsh`'s roll always succeeds and nothing is special-cased.
That trick is unavailable here: generated routers must roll at 0.6 while the AP gateway is always
on, and one cell cannot say both. The pin is therefore explicit in the AP gateway's own builder,
with a comment saying why it does not read the table — otherwise the next reader "fixes" it into
`placementOf` and silently takes the door away from 40% of players.

**`snmpd.log` is conditional, unlike its neighbours.** `access.log`, `auth.log` and `kern.log` are
seeded on every gateway unconditionally. `snmpd.log` is planted only where the agent is, so an empty
log never implies a daemon that was never there — the same reason a pidfile's absence is meaningful.

### REFACTOR

Assess only if it earns its place. The likely candidate: `runEntries` becomes a two-condition
build. If a third daemon flag ever follows, that is the moment to generalize — not now, and the
owner has pruned speculative abstraction before.

### PRE-PR MUTATION — run, survivors addressed

Ran focused on the changed production files. Whole-file first, then scoped to the changed line
ranges to separate this slice's survivors from what the two large files already carried.

| File | Whole file | Changed lines |
|------|-----------|---------------|
| `serviceCatalog.ts` | **100%** (6/6) | — |
| `rolePlacement.ts` | **100%** (15/15) | — |
| `nmap.ts` | 83.3% | **100%** (9/9) |
| `routerFs.ts` | 80.0% | 95.3% → **100%** after one kill |
| `snmpdLog.ts` | **0%** → **100%** (19/19) | — |

Two survivors, of two different kinds:

- **`snmpdLog.ts` scored 0%** — the module the required `sweepLog` column forced into this slice.
  Its existence was compelled by the type system, so the catalog row's test proved it COMPILED
  while nothing asserted a character of its output. It was the only module in `src/core/logging/`
  with no test file, which is the louder signal. `snmpdLog.test.ts` now pins both outcomes, the
  absent account, and the storage identity. **Any future slice that adds a `sweepLog` formatter
  inherits this trap: a required column gets you the module, never its content.**
- **`buildDeepSwitchBaseFs` had NO tests at all** — its `acl.conf` could be emptied unnoticed.
  Pre-existing rather than introduced here (the function only gained `hasSnmp`), and worth closing
  now because `acl.conf` is default-ALLOW: a deep switch that lost its seeded deny opens the port
  it was meant to filter rather than failing visibly. Slice 4's `snmpset` writes to this exact file.

One mutant is left alive deliberately: `<` → `<=` in `seedHasSnmp`. `next()` returns a float in
[0, 1), so killing it needs a seed landing on exactly 0.6 or 0.9. `seedApGatewayHasSsh` beside it
carries the identical comparison and the same unkillable mutant.

**No wire-check.** Nothing in `api/` changed — confirmed rather than assumed: `OpenPort` stayed
`{ port, service }`, so the cross-player scan payload is byte-identical. Slices 3, 4 and 7 own that
bill.

### PR-ready when

AC-1…AC-7 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch test
gate is green, the mutation gate has run with survivors addressed, and the version is bumped to
**v0.185.0** in both `v2/package.json` and `v2/package-lock.json`
(`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

---

### What building it settled that planning had not

- **`OpenPort` is the cross-player scan's WIRE payload** — `resolveOccupantScan` puts
  `readOpenPorts(occupantFs)` straight into an HTTP response body. So `protocol` is read off
  the catalog at render time instead of carried on the row: the wire stays byte-identical,
  and every scan path renders correctly through one formatter. This is why the slice owed no
  wire-check, and it binds slices 3, 4 and 7 — none of them should add a field there either.
- **"No machine-role host runs one" is STRUCTURAL, not a rate.** `roleOfHostname` returns a
  drawn role and `machineRole` never draws `router` or `switch`, so a laptop cannot reach
  those placement cells however it is named. Only the gateway builders can.
- **A device carrying the agent needs the BINARY too.** `SYSTEM_DAEMON_NAMES` is `sshd` and
  `vsftpd`, so `systemctl` could not have acted on an agent it could see running. Planting it
  universally would open the door on every workstation before slice 6 ships the package, so
  it goes in per device beside the pidfile.
- **Typecheck caught what 2388 passing tests did not.** `activeRoot.test.ts` hand-assembled
  the router identity, where a missing flag is merely falsy at runtime. Any later widening of
  that identity should expect the same class of miss.
- **Observed placement**: AP 2000/2000 pinned, inner router 1199 (60.0%), deep router 1207
  (60.4%), inner switch 1820 (91.0%), deep switch 1815 (90.8%).
- **The exposure is now live and pinned in `resolvePublicScan.test.ts`**: every player's
  public IP shows `161/udp` beside `22/tcp`, with no credential spent. Slice 3 sets the crack
  rate on top of that, and it is the first number to retune if the door proves too cheap.

---

## Slice 2: a player walks a device with `public` and learns what it is

**Value**: The first D8 slice that puts a command in the player's hands. Today a router or switch
shows `161/udp snmp` and there is nothing whatever to do with it — slice 1 shipped a door with no
handle. After this, `snmpwalk 10.0.0.1` says what the device IS, and leaves two lines on a log its
owner can read. Both halves matter: the walk is the reconnaissance every later slice is aimed
through, and the log is the first instalment of the only tell this door ever gives, because an
`snmpset` will arrive with no shell and no session to notice.

**Path**: `apt install snmp` → `snmpwalk <host> [community]` → client preflight against the
regenerated LAN → `env.snmp.walk` → `api/sessions` `snmpWalk` → `reachServiceHost(…, service:
'snmp')` → parse the reached box's `/etc/snmp/snmpd.conf` → render the identity OIDs → append
arrival + attempt to `/var/log/snmpd.log` → the table back to the terminal.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack — slice 3 does not start before this lands.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### This slice OWES a wire-check — the epic's tentative `N/A` does not survive contact

The epic left it open: *"slices 1, 2 and 6 may be able to record `N/A` … but only after re-examining
rather than by assumption."* Re-examined, and the answer is no. A walk against a LAN device is
**server-executed**, for the same two reasons `redis-cli` is:

- The address may belong to a **fellow occupant** rather than to the seeded box, and only the server
  can tell which — pre-flighting a neighbour against the generated world would answer for a real
  player out of the box their lease displaced.
- The two log lines are **patch rows on somebody else's machine id**. A client that could write
  those could write anything on any box.

So slice 2 builds a `snmpWalk` action, and `scripts/testSnmpWalk.ts` proves it against `vercel dev`
plus supabase. Slice 1's `N/A` was real and checked; this one is not available.

### Acceptance criteria — CONFIRMED 2026-08-27, before any code

- [x] **AC-1** With `snmp` installed and a LAN gateway running the agent, `snmpwalk <gateway>`
      returns the identity block — `sysDescr`, `sysName`, `sysContact`, `ifDescr`, `ifAddr` —
      column-aligned in locked decision 5's form, with the `[READ-ONLY]` acceptance line and the
      trailer naming the OID count and pointing at a read-write community.
- [x] **AC-2** The community defaults to `public` when omitted, and `snmpwalk <host> public` returns
      a byte-identical block.
- [x] **AC-3** A community that is not the device's read-only string returns **`Timeout: No Response
      from <host>`** and no identity — real net-snmp's own answer, because an agent drops a bad
      community silently. Deliberately the SAME words a device with no agent gives, so a walk can
      never be used to enumerate which boxes hold a community worth cracking.
- [x] **AC-4** A router reads `Linux <hostname>` with `eth0`; a switch reads
      `Cisco IOS L3 Switch <hostname>` with `GigabitEthernet0/1`. The kind is derived from the
      port-authority file the device already carries — `rules.v4` is a router, `acl.conf` is a
      switch — and is never a second copy of that fact.
- [x] **AC-5** The player's own AP gateway renders TWO interfaces, its LAN `.1` and the network's
      public address; an inner gateway and a switch render ONE. A device shows the addresses it
      actually holds.
- [x] **AC-6** Every walk that reaches the agent lands two lines on the target's
      `/var/log/snmpd.log` — an arrival naming the source address, then an attempt recording whether
      the community was accepted — in that order, appended to what was already there.
- [x] **AC-7** A device whose agent is stopped (`systemctl stop snmpd`) receives NEITHER line and
      answers as unreachable, inheriting D7 slice 5b's split rather than inventing a third answer.
- [x] **AC-8** `snmpwalk` is gated on the `snmp` package: a box without it answers
      `snmpwalk: command not found`, and `apt install snmp` is what fixes that.
- [x] **AC-9** `scripts/testSnmpWalk.ts` proves the round trip live against `vercel dev` + supabase:
      an accepted walk, a rejected community, and both log lines read back off the target.

### RED

Behavior tests, in this order — each fails for the right reason before any production change:

1. **The renderer emits decision 5's block.** Pure and framework-free, so it is the sharpest RED
   available and needs no server: feed it a router identity, assert the aligned lines.
2. **A router and a switch render differently, by name.** Both kinds asserted separately, never as
   "the switch differs" — #463 earned that rule and slice 1 re-earned it.
3. **The handler appends both lines, in order.** Against a fake log-read/upsert pair, the shape
   `redisConnect`'s tests already use.
4. **A wrong community yields the timeout and still logs the attempt.** Two separate assertions,
   because the interesting failure is a refusal that forgets to leave evidence.

**Mutants to design against** (mutator rules used for test design only — the harness runs once at PR
readiness):

- The default community mutated off `public` must break AC-2, so assert that the omitted-argument
  and explicit-`public` calls produce the SAME block, not merely that both succeed.
- Inverting the router/switch discriminator must break AC-4 — hence two named assertions.
- Dropping the attempt line while keeping the arrival must break AC-6, so assert BOTH lines and
  their ORDER, never the count.
- Inverting the two-interface condition must break AC-5, so the inner gateway's single interface is
  its own test rather than a corollary of the gateway's two.

### GREEN — the minimum, in dependency order

1. **`SweepLog.formatArrival` widens to carry `hostname`.** Forced, not chosen: it is currently
   `Pick<CredentialAttempt, 'fromIp' | 'time' | 'pid'>`, and snmpd's arrival line is syslog-shaped
   like its attempt line, so it needs the host's name. vsftpd's and redis's formatters ignore the
   new field; the three call sites (`authCreateSession`, `authCreateSessionPublic`, `redisConnect`)
   all already hold `reach.reached.hostname`.
2. **`formatSnmpdArrivalLine`** in `snmpdLog.ts` — `Connection from UDP: [<ip>]` — and its tests
   land in the same increment. Slice 1's 0% survivor is why that is stated rather than assumed.
3. **`/etc/snmp/snmpd.conf`**, planted in `routerFs.ts` beside the pidfile and conditional on
   `hasSnmp` exactly as `snmpd.log` is. World-readable — the RO string being public is the actual
   joke of real SNMP. It carries `rocommunity public` and `syscontact netops@corp.local`, and
   nothing else.
4. **`parseSnmpdConf`** — lenient, in the shape the `rules.v4` parser already uses, returning
   `{ roCommunity, sysContact }`. Slice 3 extends it for the root-only file.
5. **The renderer**, `src/core/snmp/walk.ts` — pure, taking a resolved identity and returning the
   lines, so the alignment and the trailer are tested where they cost nothing.
6. **`handleSnmpWalk`** in `src/core/sessions/` — signed-request schema carrying no credential
   beyond the community, `reachServiceHost`, conf parse, render, best-effort log append.
7. **`api/sessions.ts` wiring.** `findPublicIpByEssid` is already built and wired for the trace
   path, so AC-5 costs a dependency that exists rather than a new query.
8. **The `snmpwalk` command** — preflight mirroring `redis-cli`'s (own LAN settled here; public and
   occupant addresses left to the server), `availability: { kind: 'installed-package', packageName:
   'snmp' }`, registry entry, man page.
9. **`scripts/testSnmpWalk.ts`.**

### Three things GREEN must get right

**The config file must not restate a fact the world already holds.** `sysName` is the hostname, and
`sysDescr` and `ifDescr` follow from the device's kind, so none of them go in the file — the walk
derives them. Written in, they become a second authority that `nano` can desync from the box's real
name, which is exactly what locked decision 2 refuses for the port table. What the file carries is
what nothing else knows: the community and the contact.

**The kind comes from the port-authority file, not from the hostname.** Slice 1 found that
`roleOfHostname` never returns `router` or `switch` — those roles are not drawn, they are built. The
discriminator that IS on `hostFs` is the file the device owns: `/etc/iptables/rules.v4` makes it a
router, `/etc/switch/acl.conf` makes it a switch. That is also the file slices 3 and 4 render and
write, so the kind and the port table can never disagree.

**A rejected community and a dead agent must be indistinguishable to the client.** Both are
`Timeout: No Response from <host>`. The server knows which is which — it has to, or slice 3's
`hydra` could not score a sweep — but the client is told the same thing either way. Any answer that
separated them would hand a scanner a free map of which devices are worth a wordlist.

### Progress — BUILT so far, on `feat/d8-snmp-walk` (2026-08-27)

Four implementation commits on top of the plan, each RED→GREEN with the gates clean.
Full suite **3788 passing / 178 files** (baseline at slice 1 close was 3764 / 174);
`npm run typecheck` and `npm run lint` clean from `v2/`.

| Commit | What landed |
|--------|-------------|
| `ad7808d0` | `src/core/snmp/walk.ts` (the OID block, `PLATFORM` table) + `formatSnmpdArrivalLine` |
| `53162859` | `src/core/snmp/conf.ts` (`SNMPD_CONF_SEED`, `readSnmpdConf`, `parseSnmpdConf`) + generation plants `/etc/snmp/snmpd.conf` |
| `da3b7462` | `src/core/sessions/snmpWalk.ts` + `SweepLog.formatArrival` widened + catalog row wired |
| `9c2d04ec` | `src/core/commands/snmpwalk.ts`, `SnmpApi` seam, `walkDevice` adapter, `api/sessions` dispatch, registry |
| `5a36eff5` | `scripts/testSnmpWalk.ts` — the wire-check, 11/11, falsified twice |
| `b7510493` | the mutation gate: three test gaps closed, two pieces of dead code removed, v0.186.0 |

**AC-1…AC-8 are met and covered.** AC-8 needed no new test: `availability.test.ts`'s
`APT_HINT_PAIRS` has mapped `snmpwalk` → `snmp` since before anything consumed it, and the
command now declares that gate.

#### The mutation gate — run, survivors addressed

Scoped battery per `conventions-and-gotchas.md` §6 (throwaway vitest config narrowing the dry run
to the 8 covering test files; throwaway stryker config mutating the four net-new modules whole plus
the changed line ranges elsewhere). **268 mutants / 195 killed / 66 survived / 7 no-coverage** at the
start; **251 / 207 / 43 / 1** at the end. Both throwaway files deleted.

What it found, and what was done about it:

| Survivor | Action |
|----------|--------|
| `readSnmpdConf` had NO test at all — only the parser beside it did | three tests: the file read, a box with no `/etc`, an `/etc/snmp` holding no file |
| `SNMPD_CONF_PATH` and `SNMPD_CONF_OWNER` exported and used **nowhere** | deleted; slice 3 can reintroduce a path constant when something writes the file |
| No envelope tests at this door, where 13 sibling doors have them | unsigned, wrong-shape, and self-stamped `player_key` all refused — and the refusal names its reason |
| A blanked conf, and a gateway whose ESSID has no public-IP row | one unit test each (the second was live-only evidence until now) |
| The comment/blank `.filter()` was **dead** — both directives are `^`-anchored, so a comment can never match one | filter removed; a commented-out-directive test now pins the promise the anchor keeps alone |
| `conf.roCommunity !== null &&` could not change the answer — the community on the wire is a non-empty string | collapsed to the equality alone |
| A source-restricted `rocommunity public 10.0.0.0/8` was silently unspecified | **decided**: refused whole, so the device falls silent and its owner has something visible to fix. Pinned by a test, with the WHY next to the regex |

**The 43 survivors that remain are classified, not ignored:**

- **32 are `snmpwalk.ts`'s manual block** — `description`, `manual`, `arguments`, `examples`. Its
  executable half has ZERO survivors. This is §"a command's mutation score is mostly its manual",
  and the split is exactly where that entry says to look for it.
- **3 are seed prose** in `SNMPD_CONF_SEED` (two `#` header lines and the trailing blank). Same class
  — content a player reads, not behaviour a test can own without pinning prose.
- **2 are `padRight`'s boundary** in `walk.ts`. `>=` → `>` is *provably* equivalent: at equality both
  arms return the same string. `? :` → `false` diverges only for a value longer than its column, and
  the OIDs are generated by the same module and top out at 24 against a 26-wide column.
- **4 in `snmpWalk.ts` are equivalent at this door**: `user: ''` (neither snmpd formatter reads the
  field — the code comment says so), and the `formatArrival?.` + `.filter(undefined)` family, which
  is unkillable because the snmp catalog row always sets that optional column. The optionality
  belongs to the shared `SweepLog` type, not to this door.
- **`fromIp: … ?? 'unknown'`** is a defensive default no reachable caller triggers.
- **1 is a REAL gap, deliberately deferred**: `writerKey ?? publicKey` needs a target that already has
  an owner, which means an occupant fixture. That is slice 7's natural world, and the invariant it
  guards (every visitor's lines accreting onto ONE row rather than a row each) is what slice 7 exists
  to exercise. Do not close this slice's gate on it; do not let slice 7 close without it.

#### The version

**v0.186.0** in `v2/package.json` and `v2/package-lock.json`.

#### What building it has settled that planning had not

- **The `formatArrival` widening was load-bearing, exactly where predicted.**
  `SERVICE_CATALOG` ends `as const satisfies Record<string, ServiceSpec>`, so wiring
  `formatArrival: formatSnmpdArrivalLine` failed that check until the column could name a
  host. Without the `satisfies` it would have compiled and the forcing would have been
  invisible.
- **No client pre-flight — a deliberate deviation from GREEN step 8.** `redis-cli`
  pre-flights to save a round trip on a refusal it can settle from the world it
  regenerates. Here every refusal is one sentence, so a pre-flight would duplicate the
  generated world on the client to reach the message the server was going to send anyway.
  The command's header comment carries the reason so it is not "restored" later.
- **The collapsed refusal is enforced by the TYPE, not by discipline.** `SnmpWalkResult`'s
  failure arm carries no reason at all, so the adapter has no error branch to get wrong.
  Slices 3, 4 and 7 must not add one — a reason is a free map of which devices are worth a
  wordlist.
- **A device's kind is `readAclConf(hostFs) === '' ? 'router' : 'switch'`.** A switch is
  the special case; everything else answers as the Linux box it is, which is already the
  right answer for slice 6's workstation agent.
- **`FileEntry`'s permissions field is `perms`, not `permissions`.** The `*_PERMISSIONS`
  constants are `FilePermissions` values; the node field they land in is `perms`.
- **Typecheck caught what 3788 passing tests did not — for the second slice running.**
  Here it was `result.exitCode` on an un-narrowed `CommandResult`; in slice 1 it was a
  hand-assembled identity missing a flag. Both are the same class: a test that runs green
  under esbuild's type-stripping while `tsc -b` rejects it. Run `npm run typecheck` before
  presenting any increment, not only at the PR gate.
- **A survivor that makes no sense is worth hand-checking — mine was a test I had
  deleted.** `sysContact ?? ''` survived while a test asserting exactly that sat in the
  file. It survived because the test was NOT in the file: a scripted splice had used that
  `it(` block as its anchor and replaced it. The report was right and the file was wrong.
  When a survivor contradicts a test you can see, run the mutant by hand before theorising
  about coverage attribution.
- **`git checkout -- <file>` to undo a hand-mutation also undoes your uncommitted work.**
  Restoring `conf.ts` that way silently reverted a deletion made minutes earlier, and the
  next run reported against a file that had quietly grown its dead exports back. Copy the
  file aside and restore from the copy; `git status` after a hand-mutation is the check.
- **Removing dead defence can make a live one testable.** The comment/blank filter and the
  `^` anchors defended the same thing, and each made the other's mutants unkillable —
  ten survivors between them, none of which named a missing test. Deleting the filter
  turned two of the anchor mutants into ordinary killable ones, and the test that kills
  them states the promise directly: a commented-out directive is not a live one.
- **The transport adapter gets no unit test, by house precedent.** `connectStore` has none
  either — `sessionsApi.test.ts` covers sessions and the database door only. The wire-check
  is that layer's evidence, which is the same division `conventions-and-gotchas.md` §
  states for `api/`.
- **The wire-check went 11/11 on its FIRST run, so it was falsified twice before it was
  believed.** A green a script has never been seen to lose is not evidence. Two deliberate
  breaks in `api/sessions.ts`, each reverted: stubbing `findPublicIpByEssid` to `null` took
  exactly the live-table-read check red and left its no-row twin green, and no-opping
  `upsertPatch` took all three trace checks red. Both bit precisely where aimed, which is
  what makes the 11/11 mean something.
- **The public-IP read is checked in BOTH directions, and that pairing is the point.**
  Seeded row → `[localIp, publicIp]`; row cleared → `[localIp]`. One direction alone passes
  against a hardcoded second address or against a handler that never reads the table at all.
- **One check is knowingly one-sided: `NOTHING went to auth.log`.** It stays green when the
  handler writes nowhere, as the second falsification showed. It is guarded by the positive
  snmpd.log check beside it, not on its own — worth remembering before it is copied into a
  slice where nothing plays that guard role.

### PR-ready when

AC-1…AC-9 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch test
gate is green, the wire-check has RUN against a live stack rather than been reasoned about, the
mutation gate has run with survivors addressed, and the version is bumped to **v0.186.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 3: a player cracks a device's read-write community and sees its port table

**Actor**: a player on their own LAN, holding nothing but a scan result and the free `public` walk
slice 2 shipped.
**Trigger**: `hydra 192.168.1.1 snmp`, then `snmpwalk 192.168.1.1 <the string it found>`.
**Observable outcome**: hydra reports a cracked community with no login named anywhere, the device's
`snmpd.log` fills with the guesses, and the second walk returns everything the first did PLUS the
device's forward table — the ports it publishes and where they land.
**Path**: `hydra` → `hydraCrack` (unchanged, already generic over `secretOn`) → the device's
root-only `/var/lib/snmp/snmpd.conf`; then `snmpwalk` → `handleSnmpWalk` → the same file → the
`rules.v4` / `acl.conf` the device already carries, rendered as OIDs.
**Smallest deployable value**: the crack and the payoff are one slice because neither half is worth
shipping alone — a cracked string with nothing to spend it on is a scoreboard, and a port table
nobody can reach is dead code. The spine has always stated them as one observable.

**Class**: Behavior change.
**Delivery**: Independent PR against trunk. No stack — slice 4 does not start before this lands.
**Required implementation skills**: `tdd`, `testing`, `refactoring` if it earns itself;
`mutation-testing` once at the PR gate.

### This slice OWES a wire-check

The epic names slices 3, 4 and 7 as the ones that touch `api/`, and this one changes what
`handleSnmpWalk` returns. Slice 2's wire-check proved the walk against a live stack and was twice
broken on purpose to show it could go red; the read-write tier is a new branch through the same
door and inherits that obligation rather than that evidence. `scripts/testSnmpWalk.ts` is EXTENDED,
not replaced — the accepted/refused/traced checks it already makes must keep passing beside the new
ones, because the read-only tier is what the read-write tier must not quietly break.

### Acceptance criteria — FOR CONFIRMATION, before any code

- [x] **AC-1** A device that runs the agent carries `/var/lib/snmp/snmpd.conf` holding an md5 of its
      read-write community. A device with no agent carries no such file, and no such directory.
- [x] **AC-2** That file is readable and writable by `root` alone. A `guest` or a `user` who reads it
      is refused, the way `/etc/shadow` refuses them.
- [x] **AC-3** The community is drawn from the two EXISTING password pools at a new
      `CRACK_CHANCE.community` of `0.6`, in its own seed namespace — so a device's community and its
      admin password are independent, and cracking one says nothing about the other.
- [x] **AC-4** `/var/lib/snmp/snmpd.conf` is absent from `EXTERNALLY_OBSERVABLE_ALLOWLIST`, so a
      cross-player read of the device cannot see it. The world-readable `/etc/snmp/snmpd.conf` stays
      visible and stays free of the read-write string.
- [x] **AC-5** `hydra <device> snmp` sweeps the community and reports the string when the wordlist
      holds it. It names no login and enumerates no accounts, because the row has `secretOn`.
- [x] **AC-6** A sweep leaves one attempt line per guessed word in the device's own
      `/var/log/snmpd.log`, under the device's own writer key, with nothing in `auth.log`.
- [x] **AC-7** `snmpwalk <device> <read-write community>` returns the identity block AND the port
      table. `snmpwalk <device> public` still returns identity alone.
- [x] **AC-8** A router renders each `rules.v4` forward as
      `NAT-MIB::natForward.<public port> = STRING: <ip>:<port>`; a switch renders each `acl.conf`
      deny as `ACL-MIB::aclPort.<port> = STRING: deny`. Both read the file the device already
      carries — no second copy is stored anywhere.
- [x] **AC-9** A router with the shipped default-deny `rules.v4` renders an EMPTY port table and
      still prints the `Writable:` trailer. This is the ordinary case for a fresh router, not an edge
      one, and it is what points a player at slice 4.
- [x] **AC-10** A read-write walk mints no session row, and is traced on the device exactly as a
      read-only one is.
- [x] **AC-11** The wire-check RUNS against `vercel dev` + supabase, covering the read-write walk,
      the unchanged read-only walk, and the sweep's trace — and is falsified at least once.

### RED — the failing tests, in the order they get written

1. **Generation plants the file** — a generated gateway that `hasSnmp` carries
   `/var/lib/snmp/snmpd.conf`; one that does not carries no `/var/lib/snmp` at all. (AC-1)
2. **Root alone can read it** — through the filesystem's own permission check, not by asserting the
   constant back at itself. (AC-2)
3. **The community is independent of the admin password** — a device agrees with itself across
   regenerations and differs from its own admin hash. (AC-3)
4. **The allowlist does not leak it** — prune a device's tree the way a cross-player read does, and
   assert `/var/lib/snmp` is gone while `/etc/snmp/snmpd.conf` survives. (AC-4)
5. **The sweep finds it** — `hydraCrack` against a device whose community is in the wordlist reports
   it; against one whose community is not, reports nothing found, and both leave the right wall in
   `snmpd.log`. (AC-5, AC-6)
6. **The walk splits by tier** — the read-write string returns a port table, `public` does not.
   (AC-7, AC-10)
7. **Each file renders as its own OIDs** — a router with two forwards, a switch with two denies, and
   a router with the shipped seed rendering nothing but the trailer. (AC-8, AC-9)

### GREEN — the minimum, in dependency order

1. `CRACK_CHANCE.community = 0.6` in `passwordPools.ts`.
2. A module beside `conf.ts` owning the read-write community's path, permissions, seed format and
   reader — `conf.ts` owns the world-readable half and keeps owning only that. It stores a hash and
   never a plaintext string.
3. `routerFs.ts` plants it under `hasSnmp`, from a seed namespace of its own, next to where it
   already plants `/etc/snmp/snmpd.conf`.
4. `SERVICE_CATALOG.snmp` gains `secretOn` reading that file. **The whole hydra half is done at this
   point** — the sweep, the missing-login message and the log wall are existing generic paths.
5. The port table as OIDs in `snmp/walk.ts`, rendered from `parseForwardRules` / `parseAclDenies`.
6. `handleSnmpWalk` compares `md5(community)` against the stored hash and, on a match, returns the
   table beside the identity.
7. The `snmpwalk` command renders whichever block came back.

### Four things GREEN must get right

- **The read-write tier is not a second `roCommunity` check.** The two strings are separate facts in
  separate files at separate permissions. A device answers the read-only string at the read-only
  tier and the read-write string at the read-write tier; a walk that accepted either at either tier
  would make the root-only file decorative.
- **`md5` never appears on the client.** The typed string travels and the SERVER hashes it, as every
  other door already does — `authCreateSession.ts:320`, `mysqlConnect.ts:148`. A client that hashed
  it would be a client that could be told what to compare.
- **An empty table is a render, not an absence.** A default-deny router returns an empty table and
  the trailer, NOT the read-only block. Returning the read-only block would tell a player their
  cracked string had failed.
- **The port table renders from the file on every walk.** No cache, and nothing copied into the
  response beyond what one render needs — decision 2's whole point is one fact behind two
  interfaces.

### Progress — BUILT, on `feat/d8-snmp-crack` (2026-08-28)

Four commits on top of the plan, each RED→GREEN with the gates clean. Full suite
**3831 passing / 179 files** (baseline at slice 2's close was 3799 / 178); `npm run
typecheck` and `npm run lint` clean from `v2/`; wire-check **15/15** against a live stack,
falsified twice; version **v0.187.0**.

| Commit | What landed |
|--------|-------------|
| `46f9db9c` | `src/core/snmp/rwCommunity.ts`, `CRACK_CHANCE.community`, generation plants `/var/lib/snmp/snmpd.conf`, the allowlist pin |
| `41b1c0d4` | `secretOn` on the `snmp` catalog row — the whole hydra half |
| `866dcffa` | the port table render, the door's tier, the command and the adapter union |
| `9bbc0688` | `scripts/testSnmpWalk.ts` extended to 15 checks, v0.187.0 |
| `6dc804e8` | the mutation gate: `rwCommunity.test.ts`, one dead guard removed |

**AC-1…AC-11 are met.** AC-4 was GREEN ON ARRIVAL — `/var/lib/snmp/snmpd.conf` was never
in `EXTERNALLY_OBSERVABLE_ALLOWLIST` — so it is a pin rather than a discovery, and it was
falsified by listing the path and removing it again. No production change is claimed for
it.

#### What building it settled that planning had not

- **The seed namespace was a live bug, not bookkeeping.** `seedHasSnmp` opens with
  `createPrng(namespace).next() < placement` and `drawPassword` opens with
  `prng.next() < crackChance`. Sharing a namespace makes those THE SAME DRAW — and with
  the router's placement at 0.6 against a community chance of 0.6, every device running an
  agent would have held a crackable community and every device without one an uncrackable
  one. The test that pins the community against the admin password is what catches it.
  **Any later slice that adds a per-device seeded fact must give it its own namespace**,
  and prove it against the neighbouring draws rather than against itself.
- **The crack half cost one field.** `hydraCrack` has read `secretOn` since redis forced
  it, and `hydra` has suppressed the login field for any row carrying one since the same
  slice. AC-5 and AC-6 needed `secretOn: readRwCommunityHash` and nothing else. Planning
  guessed this; it is worth recording that the guess held, because slices 4 and 7 are
  budgeted on the same reasoning.
- **The tier had to be explicit at FOUR layers, and for one reason.** Default-deny means a
  fresh router forwards nothing, so an empty port table is the ORDINARY read-write answer.
  Anywhere the tier were inferred from the table's emptiness, most players would be told
  their cracked community had been refused. Hence: a separate render entry point, a stated
  `tier` in the handler's body, a discriminated union in the adapter's schema, and a
  tier-keyed branch in the command. `slice 4` must not collapse any of them.
- **Typecheck caught what 3820 passing tests did not — for the third slice running.** Here
  it was `routerFs.test.ts`'s own helper, whose `Partial<{...}>` predated the new identity
  field. Same class as slice 1's and slice 2's: green under esbuild's type-stripping,
  rejected by `tsc -b`. Run `npm run typecheck` before presenting any increment.
- **`vercel dev` must be started as `npm run vercel:dev`.** Started directly it never reads
  `.env.development.local`, every handler answers `not_configured`, and the wire-check
  reports a plausible-looking partial failure rather than an obvious one.
- **Three of the wire-check's checks are one-sided, and now demonstrably so.** In that
  misconfigured run — where the server did nothing at all — `NOTHING went to auth.log` and
  BOTH no-session checks passed. Slice 2 recorded the weakness for the auth.log check;
  this is the demonstration, and it applies to the two session checks this slice added.
  Each is guarded by a positive check beside it, never on its own.

#### The mutation gate — run, survivors addressed

Scoped to this slice's changed production code (throwaway `vite.mutation.config.ts` +
`stryker.snmp.json`, both deleted after — the whole suite's dry run is unrunnable at this
size). **298 mutants / 57 survived → 294 / 43**, killed 236 → 250.

| Survivor | Action |
|---|---|
| 16 in `rwCommunity.ts` — the regex's `^`, `$` and `\s+`, all four tree-walk guards, `line.trim()` | **Real gap: the module had no test file at all.** `rwCommunity.test.ts`, 11 tests — the same envelope slice 2's gate had to build for `conf.ts` |
| 1 in `snmpWalk.ts` — `rwCommunityHash !== undefined &&` | **Dead code, removed.** `md5` returns a string for every input, so comparing one against `undefined` is already false. A defence with nothing to defend, and every mutant of it unkillable |

The 43 that remain, all classified:

- **33 in `snmpwalk.ts` (L83-111)** — the command descriptor and its manual prose. The
  executable half of that file has ZERO survivors. Slice 2 classified the same block
  identically; the two runs agree, which is the point of recording it.
- **3 in `rwCommunity.ts` (L49-51)** — the seed's three header comment lines. Its
  directive line and its trailing newline are both pinned.
- **5 in `snmpWalk.ts`** — L139/145/146 are the log-line assembly, unchanged and
  classified at slice 2. **L220 is `writerKey ?? publicKey`, and it is the survivor slice
  2 deferred to slice 7**: killing it needs a target that ALREADY HAS AN OWNER, which
  this slice never produces. It is not closed by this gate either. **Slice 7 must not
  close without it.**
- **2 in `walk.ts` (L69)** — `padRight`'s boundary, unchanged since slice 2.

### PR-ready when

AC-1…AC-11 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch test
gate is green, the wire-check has RUN against a live stack rather than been reasoned about, the
mutation gate has run with survivors addressed, and the version is bumped to **v0.187.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 4: a player opens a port on a device they never logged into

**Actor**: a player on their own LAN, holding a community string slice 3 let them crack and no
account on the device at all.
**Trigger**: `snmpset 192.168.188.1 corpnet natForward.2222=192.168.188.10:22`.
**Observable outcome**: the device echoes the OID and its new value; a walk with the same community
now lists that forward in the port table; a scan of the network's public address shows `2222` open
and reaching the workstation behind it; and the device's own `snmpd.log` carries a SET line naming
the OID, `old → new`, and where the request came from. No session, no shell, nothing to `exit`.
**Path**: `snmpset` → `env.snmp.set` → the signed `snmpSet` action → `handleSnmpSet` → the SAME
`reachServiceHost(snmp)` the walk uses → the community re-read and re-validated against
`/var/lib/snmp/snmpd.conf` → the device's own `rules.v4` / `acl.conf` edited AS TEXT → `upsertPatch`
under the device's own writer key → the SET line appended to `/var/log/snmpd.log`.
**Smallest deployable value**: the write half of the door, on the caller's own LAN only. The
inner-gateway vantage is slice 5 and a stranger's device is slice 7 — both are REACH, and this slice
is the verb. It is also what makes slice 3's `Writable:` trailer true rather than a promise.

**Class**: Behavior change.
**Delivery**: Independent PR against trunk. No stack — slice 5 does not start before this lands.
**Required implementation skills**: `tdd`, `testing`, `refactoring` if it earns itself;
`mutation-testing` once at the PR gate.

### This slice OWES a wire-check

The epic names slices 3, 4 and 7 outright, and this is the first door in the game that WRITES a file
the rest of the world routes by. `parseForwardRules` feeds the scan path and `machineServing`, so a
write that lands at the wrong path, under the wrong writer key, or in a shape the parser rejects
would pass every unit test in the suite and still produce a forward nothing honours. Only a live
stack shows that. `scripts/testSnmpSet.ts` is NEW rather than an extension of `testSnmpWalk.ts`: the
walk's script proves a READ door and its checks stay meaningful on their own, while this one has to
write, re-materialize, and read back through a different path.

### Two decisions this slice needed that the epic's eleven did not cover

Both confirmed 2026-08-28, before any code.

1. **Removal is STATE-VALUED, never imperative.** `natForward.<port>=none` clears a forward and
   `aclPort.<port>=permit` clears a deny. Every OID's value names the state the port should be in,
   so `=deny` and `=permit` are the same kind of thing — where `=delete` would be an instruction
   sitting where a value goes. The switch half is also legacy's own flip (`deny` → `permit`) rather
   than an invention. An EMPTY right-hand side was rejected: it is invisible in scrollback and one
   keystroke away from a typo that reads as success.
2. **An accepted community with a bad value refuses LOUDLY, in net-snmp's own frame.** `Error in
   packet.` / `Reason: <reason> (<what was wrong>)` / `Failed object: <oid>` — the real tool's
   three-line shape, with the reason naming the constraint that was broken. The player has already
   proved the community; a silent refusal on the one door whose whole point is the WRITE would leave
   them unable to tell a bad value from a working one without walking again. Silence stays the
   answer for a refused COMMUNITY, which is a different question and keeps the walk's rule exactly.

### Acceptance criteria — CONFIRMED 2026-08-28, before any code

- [x] **AC-1** `snmpset <host> <community> natForward.<public port>=<ip>:<port>` on a router adds
      that forward to `/etc/iptables/rules.v4` and echoes
      `NAT-MIB::natForward.<port> = STRING: <ip>:<port>`.
- [x] **AC-2** `snmpset <host> <community> aclPort.<port>=deny` on a switch adds that deny to
      `/etc/switch/acl.conf` and echoes `ACL-MIB::aclPort.<port> = STRING: deny`.
- [x] **AC-3** `natForward.<port>=none` removes that forward and `aclPort.<port>=permit` removes that
      deny. A set naming a port the file does not carry is ACCEPTED and changes nothing — the port
      ends in the state the value named, which is what a state-valued grammar means.
- [x] **AC-4** A set naming a port that already carries a forward OVERWRITES it. No refusal and no
      second round-trip: a forward table is keyed by public port, so one port holding two
      destinations is not a state the file can represent.
- [x] **AC-5** The edit PRESERVES every line the set does not own — the seeded header, the commented
      example, and any comment the owner added by hand. A device's `rules.v4` after a set is the file
      it was, plus, minus or through one line.
- [x] **AC-6** Every line this door writes PARSES back through `parseForwardRules` /
      `parseAclDenies`. The file's own parser is the single validity gate, so nothing can be written
      that the scan and routing paths cannot read.
- [x] **AC-7** A forward must land on the device's own segment. `natForward.2222=10.9.9.9:22` against
      a `192.168.188.x` device is refused at `wrongValue`, and the file is unchanged.
- [x] **AC-8** An OID the device does not implement is refused at `noSuchName` — `natForward`
      against a switch, `aclPort` against a router — and the file is unchanged.
- [x] **AC-9** A REFUSED community is silence, exactly as a walk's is: `Timeout: No Response from
      <host>`. A device that is not there and one whose agent was stopped read identically.
- [x] **AC-10** An accepted set appends ONE SET line to the device's `/var/log/snmpd.log`, naming the
      OID, `old → new`, and the source IP the SERVER derived — including when the set changed
      nothing, because somebody holding the community touched the device either way. A refused
      community leaves the arrival + failure pair and no SET line.
- [x] **AC-11** The set mints NO row in `sessions`, and the community is re-read and re-validated on
      every call.
- [x] **AC-12** Every row this door writes lands under the DEVICE's writer key, so a device keeps ONE
      `rules.v4` and ONE `snmpd.log` however many callers set on it.
- [x] **AC-13** A forward written by `snmpset` is the same fact the rest of the world reads: after
      the set, a scan of the network's public address shows the new port and it reaches the internal
      host the line names. One authority, two interfaces.
- [x] **AC-14** The wire-check RUNS against `vercel dev` + supabase — the set, the file read back off
      the real journal, the SET line, the absent session row, and a refusal — and is falsified at
      least once.

### RED — the failing tests, in the order they get written

1. **The writer, as a text edit** — add, overwrite, remove, and remove-what-is-not-there, with the
   seeded header and a hand-written comment surviving all four. (AC-1…AC-5)
2. **The writer's output re-parses** — feed each result straight back through the file's own parser
   and assert the table it yields. (AC-6)
3. **The OID grammar** — `natForward.2222=192.168.188.10:22`, `natForward.2222=none`,
   `aclPort.8080=deny` and `aclPort.8080=permit` parse; a malformed value, a port out of range and
   an unknown OID prefix do not. (AC-1…AC-3, AC-8)
4. **The segment bound** — an address off the device's own `/24` is refused and the file is
   untouched. (AC-7)
5. **The handler** — an accepted community writes the patch at the right path under the device's own
   key; a refused one writes nothing and answers the walk's own silence; neither mints a session.
   (AC-9, AC-11, AC-12)
6. **The SET line** — its shape, both values, and the no-op case that still logs. (AC-10)
7. **The command** — the echo, the three-line error frame, and the usage line. (AC-1…AC-3, AC-7,
   AC-8)
8. **Scan agreement** — a `rules.v4` the writer produced, read by the EXISTING forward path, yields
   the forward the set asked for. (AC-13)

### GREEN — the minimum, in dependency order

1. **A writer beside each parser**, in the file that already owns that grammar: `iptablesRules.ts`
   gains `withForward(content, publicPort, target | null)` and `switchAcl.ts` gains
   `withDeny(content, port, denied)`. One state-valued function per file, mirroring the grammar the
   player types — and beside the parser, so a second grammar can never come to exist.
2. **`snmp/set.ts`** — the OID request grammar: `natForward.<port>=<value>` and
   `aclPort.<port>=<value>` into a typed request, plus the refusal reasons the frame names.
3. **The error frame renderer** — beside the walk's renders, or its own module if that keeps
   `walk.ts` about walking.
4. **`sessions/snmpSet.ts`** — reach, re-validate the community, dispatch on device kind, bound the
   segment, write, log. It reuses `deviceKind` and the community comparison `handleSnmpWalk` already
   owns; both move somewhere both doors can see them rather than being copied.
5. **`formatSnmpdSetLine` in `logging/snmpdLog.ts`.** No new catalog column: a SET is not a sweep,
   and `SERVICE_CATALOG.snmp.sweepLog` already carries the path, owner and permissions this append
   needs.
6. **The adapter** — the `snmpSet` action and a zod result the client cannot mis-read, refusal
   reasons included.
7. **`env.snmp.set`, the `snmpset` command, and its registry entry.** The binary is already listed in
   `aptPackages.ts` and already mapped to the `snmp` package in `availability.test.ts`.
8. **`api/sessions.ts` dispatch**, with the same dep set the walk's block builds.

### Five things GREEN must get right

- **The file is edited as TEXT, never re-rendered from the parsed table.** Round-tripping through
  `parseForwardRules` would silently eat the seeded header, the commented example, and any comment
  the owner wrote — they would open `nano` afterwards and find a machine had rewritten their file.
  One line changes; everything else stays byte-identical.
- **`ACL_CONF_SEED` ends WITHOUT a trailing newline and `RULES_V4_SEED` ends with one.** An append
  that assumes either shape produces `deny 8080deny 22` on one of the two files. The writer
  normalizes what it is handed rather than trusting the seed it happens to meet, because the owner's
  own `nano` edit can leave the file either way.
- **The parser is the gate, and it runs on the OUTPUT.** Validity is not re-derived here: the line
  the writer produced is fed back through the file's own parser, and a line that does not survive
  that round trip is never written. That is locked decision 9's "single validity gate" made literal,
  and it is what stops this door becoming a second authority on what a rule is.
- **The segment bound is resolved SERVER-side from the essid**, off `generateHomeLan`'s own subnet,
  never from anything the client said about where it is standing. A client-supplied bound is a
  client-chosen one.
- **A refused community is silence; a bad value is not.** Both live in the same handler and they are
  one `if` away from collapsing into each other. The community decides whether the caller is talking
  to the agent at all; everything after that is a conversation they have earned.

### Progress — BUILT, on `feat/d8-snmp-set` (2026-08-28)

Eight commits, each RED→GREEN with the gates clean. Full suite **3904 passing / 182 files**
(baseline at slice 3's close was 3831 / 179); `npm run typecheck` and `npm run lint` clean from
`v2/`; wire-check **16/16** against a live stack, falsified twice; version **v0.188.0**.

| Commit | What landed |
|--------|-------------|
| `b6e2cab3` | the plan — slice 3 marked merged, slice 4 planned in full |
| `35a59a6c` | the writers — `withForward`, `withDeny`, each beside its parser |
| `fefd24ac` | the grammar — `snmp/set.ts`, gated by the file's own parser |
| `24304e91` | `snmpAgent.ts` — what both doors share; the two files' storage identities |
| `7e912c5a` | the SET line and `handleSnmpSet` |
| `f89622e5` | the command, the adapter, `env`/`state`, the `api/` dispatch |
| `b6e82138` | `scripts/testSnmpSet.ts` — 16 checks, falsified twice; v0.188.0 |
| `3039037f` | the mutation gate: nine gap-closing tests, `switchAcl` to 100% |

**AC-1…AC-14 are met.**

#### What building it settled that planning had not

- **The writers had to be found by PARSING, not by matching the port in the text.** A
  commented-out rule on the same port is the obvious way an owner parks one, and a text
  matcher rewrites the note while leaving the live rule standing — backwards, and invisible
  until the forward fails to route. Both writers now search through the file's own parser,
  which is the same function that decides validity on the way out.
- **The two seeds disagree about trailing newlines, and it is load-bearing.** `ACL_CONF_SEED`
  ends without one and `RULES_V4_SEED` ends with one, so a writer trusting whichever it met
  first produces `deny 8080deny 22` on a live switch. Both writers normalize what they are
  handed rather than the shape they expect.
- **The parser as the single gate closed a value-injection route for free.** A destination is
  accepted only if `forward <port> to <value>` reads back as exactly ONE rule, so a newline in
  the value yields two and is refused — and only the PARSED destination ever reaches the file,
  never the player's text.
- **Typecheck caught what 16 passing tests did not, for the FOURTH slice running.** `'notWritable'`
  was missing from the refusal union and the test's `makeDeps` carried a dep the door does not
  take. Same class as slices 1–3: green under esbuild's type-stripping, rejected by `tsc -b`.
- **Two of my own test EXPECTATIONS were wrong, not the code.** A generated device has no owner,
  so a row lands under the caller's key (the owner's takes over cross-player, slice 7); and a
  stopped agent answers `service_not_running` where a wrong community answers `host_unreachable`
  — distinct at the wire, one silence to the player. The walk's own test pins only the status
  for exactly this reason.
- **Backslash escapes do not survive a heredoc'd Python splice in this environment.** `'\n'`
  inside the written string arrives as a real newline and breaks the parse. Third occurrence of
  scripted-splice damage across this epic. Use the Edit tool for any content carrying escapes.

#### The mutation gate — run, survivors addressed

Scoped to this slice's changed production code (throwaway `vite.mutation.config.ts` +
`stryker.snmp.json`, both deleted after). Three runs: **80.88% → 86.71% → 88.65%**, survivors
**106 → 79 → 69**, killed 499 → 547, no-coverage 12 → 1.

| Survivor group | Action |
|---|---|
| `readRulesV4` had NO direct tests, while its switch twin `readAclConf` had five | **Real gap.** Five tree-walk tests added, mirroring the twin's |
| `SET_OID_RE`'s `^` and `$` anchors | **Real gap.** Junk before and after the OID now refused at `noSuchName` |
| `inPortRange` boundaries in the grammar | **Real gap.** 1 and 65535 accepted, 65536 refused |
| the multi-rule guard in `forwardTarget` | **Real gap.** The newline-injection case the module's own comment claimed but no test proved |
| `currentState`'s port match and its kind branch | **Real gap.** A device with TWO forwards, and the switch's own `deny -> permit` line |
| `segmentOf` applied to whole octets | **Real gap.** The neighbouring `/24` — same leading characters, different network |
| `?? 'unknown'`, the `player_key` refine, the failed-write branch | **Real gaps.** All three now asserted |
| the two files' `PATH`/`OWNER`/`PERMISSIONS` | **Real gap.** Asserted against literals, not against themselves — the shape `snmpdLog.test.ts` already used |
| both writers' `line.trim()` | **Real gap.** An indented rule the writer must still find |

The 69 that remain, all classified:

- **48 in `snmpset.ts` (L41, L69-113)** — the command descriptor and its manual prose, plus the
  positional-argument guard: if `target` is missing then so is everything after it, so only the
  last of the three conditions is independently reachable and the other mutants are equivalent.
  The executable half has ZERO survivors otherwise. Slices 2 and 3 classified `snmpwalk.ts`
  identically.
- **6 in `iptablesRules.ts` (L71/74)** — `parseForwardRules`'s comment/blank filter, which the
  anchored regex already makes dead. Slice 3 found the identical pattern in `conf.ts` and removed
  it there. **Deliberately NOT removed here**: it is pre-existing scan-path code, and changing it
  would invalidate a wire-check already run against a stack now torn down, for no behavioural
  gain. **Slice 6 reworks this grammar** (the `deny <port>` rule kind) and should take it then.
- **6 in `snmpSet.ts`** — the `sourceIp ??` half needs a vantage where the ROUTE resolves an
  address, which this slice never produces (slice 5/7 owns it); `segmentOf`'s `join('')` and
  `currentState`'s `kind: 'acl'` tag are equivalent, each applied to both sides of the comparison
  they feed; `.looseObject` is required by the envelope.
- **4 in `snmpAgent.ts`** — `user: ''` is meaningless at this door by design, and the
  `formatArrival?.` guards defend a catalog row that omits an arrival formatter. The snmp row has
  one, so they are killable only from `sshd`'s door, whose row does not.
- **5 + 1 no-cov in `set.ts`** — `separator === -1` mutants. Equivalent: an assignment with no
  `=` refuses identically whether the value reads as `''` or as the whole string.

**One unidentified full-suite failure** was observed in a single run mid-slice (1 of 3885) and did
not reproduce in five subsequent full runs. Its name was never captured. Recorded rather than
called fixed — watch for it.

### PR-ready when

AC-1…AC-14 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch test
gate is green, the wire-check has RUN against a live stack rather than been reasoned about, the
mutation gate has run with survivors addressed, and the version is bumped to **v0.188.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 5: a player walks and rewrites a device on the hidden layer behind an inner gateway

**Value**: The deep layer stops being somewhere you can only get a SHELL. A player who has rooted an
inner gateway can now read and reconfigure the devices behind it without logging into any of them —
and, for the first time, `snmpset` on the inner gateway itself does something useful, because the
forward it writes is the one that makes the deep device addressable at all.

**Path**: `snmpwalk <inner gw>:<port>` → the command splits the transport address → `snmpWalk`/
`snmpSet` pass that port to `reachServiceHost` instead of a hard-coded 161 →
`forwardsIntoDeepLayer` → `resolveInnerGatewayTarget` walks the forward chain → the deep box's own
filesystem, its own address, and the fronting gateway's `.1` as the source → the OID block, or the
port-table write and its `snmpd.log` line on the DEEP box.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### What exploration settled before planning

Four facts, each verified in the source rather than assumed. They shrink the plumbing and grow the
correction:

1. **The inner-gateway walk ALREADY WORKS.** `resolveTargetAt` returns the gateway itself whenever
   `machineServing` says it holds the port (`resolveInnerGatewayTarget.ts:121`), and a gateway that
   rolled an agent listens on 161. Its comment says "landing on this gateway's own `:22`" only
   because `ssh` was the sole caller. **RED for this half comes from mutating production**, exactly
   as the outline predicted.
2. **The deep layer already carries devices worth walking.** `generateDeepLayer` hangs child
   gateways of kind `router | switch` — the two roles that roll SNMP agents (0.6 / 0.9).
3. **Neither command can NAME a deep device.** Both hard-code `port: SERVICE_CATALOG.snmp
   .defaultPort` (`snmpWalk.ts:119`, `snmpSet.ts:153`), and through a forward the port is the whole
   of how a hidden box is named.
4. **Two places treat the typed address AS the device, and both are now wrong.**
   `addressesOf` passes `localIp: payload.target_ip`, so a deep device would report the GATEWAY's
   address as its own; and the segment bound compares against `payload.target_ip`, so on an inner
   gateway it measures the LAN rather than the layer the device fronts.

### The defect slice 4 shipped, invisible until this vantage existed

An inner gateway's forwards resolve against its DEEP layer. A forward pointing at a LAN address
matches neither `deep.host.ip` nor `deep.childGateway.ip`, so it lands on
`resolveInnerGatewayTarget`'s "stray internal IP, a dark DNAT target" and is `UNREACHABLE`. But the
bound refuses every deep destination before it can be written. **So `snmpset` against an inner
gateway can today write only forwards that are guaranteed dark: every legal write is useless and
every useful write is illegal.**

Slice 4 could not see it — no deep device was addressable, so there was no destination worth
bounding differently. The correction is not a special case: the edge AP gateway fronts the LAN and
its forwards point into the LAN, which is exactly what slice 4's AC-7 pinned and what still holds.
One sentence covers both — **a forward must land on the segment the device FRONTS** — and switches
are untouched, having no forwards at all.

### Two decisions this slice needed

Both confirmed 2026-08-28, before any code.

1. **A deep device is addressed `<host>:<port>`, net-snmp's own transport syntax.** Real net-snmp
   accepts `host:port` as the agent address, so this is the authentic spelling and costs no new
   flag; `snmpset` keeps its three positional arguments. It is also the spelling the door already
   WRITES as a value — `natForward.2222=192.168.42.10:22` — so one form means "an address and a
   port" throughout. Rejected: `-p <fwd> <host>`, which four doors already teach
   (`redisCli.ts:112` states the convention outright) but which real net-snmp does not have, on a
   door that has chosen fidelity twice already. Also rejected: accepting BOTH, which is two parse
   paths for one fact.
2. **The segment bound asks the DEVICE what it fronts**, resolved server-side from `(essid,
   machineId, kind)`. `generateDeepLayer` seeds its subnet from `deep-layer-<essid>-<machineId>`
   alone, so this needs no new plumbing and no client input. Rejected: leaving the bound and
   deferring the defect, which would ship a device the player can walk but cannot usefully
   reconfigure; and dropping the bound entirely, which discards a rule slice 4 confirmed and
   mutation-tested.

### Acceptance criteria — CONFIRMED 2026-08-28, before any code

- [x] **AC-1** `snmpwalk <inner gateway>` with no port walks THE GATEWAY, when it rolled an agent:
      the identity OIDs return and `IF-MIB::ifAddr.1` is its own LAN address. Expected GREEN ON
      ARRIVAL — the test is falsified by mutating production, not by watching it fail.
- [x] **AC-2** `snmpwalk <inner gateway>:<port>`, where the gateway forwards that port to a deep
      device's 161, walks THE DEEP DEVICE: `SNMPv2-MIB::sysName.0` is the deep box's hostname, not
      the gateway's.
- [x] **AC-3** That deep device reports ITS OWN address — `IF-MIB::ifAddr.1` is its address on the
      deep subnet, never the address the player typed.
- [x] **AC-4** A forwarded port whose far side is not 161 is silence: `Timeout: No Response from
      <host>`. A forward to sshd is not a door to the agent.
- [x] **AC-5** A port the gateway neither listens on nor forwards is the same silence, and a
      bricked gateway takes the whole deep entrance dark the same way.
- [x] **AC-6** `snmpset <inner gateway>:<port> <community> aclPort.8080=deny` against a deep SWITCH
      writes its `/etc/switch/acl.conf` and echoes `ACL-MIB::aclPort.8080 = STRING: deny`.
- [x] **AC-7** The lines a deep device logs record the FRONTING GATEWAY's `.1` as the source
      address, not the player's own LAN address — the route decides it and the client's claim is
      ignored. (This kills the `sourceIp ??` survivors slice 4 classified as unreachable.)
- [x] **AC-8** On an inner gateway the bound follows the deep layer:
      `natForward.2222=<deep subnet>.9:22` is accepted and written, while
      `natForward.2222=<a LAN address>:22` is refused at `wrongValue` and the file is unchanged.
- [x] **AC-9** On the edge AP gateway the bound is UNCHANGED — slice 4's AC-7 still holds, a
      `10.9.9.9` destination on a `192.168.x` edge gateway refused at `wrongValue`.
- [x] **AC-10** THE LOOP, end to end and shell-free: `snmpset <inner gw> <community>
      natForward.<port>=<deep device>:161` opens the forward, and `snmpwalk <inner gw>:<port>
      <community>` then walks the device behind it. Two commands, no session, nothing to `exit`.
- [x] **AC-11** A bare `<host>` with no colon behaves EXACTLY as it did in slices 2–4 — every walk
      and set test written before this slice still passes untouched.
- [x] **AC-12** A suffix that is not a port is not one: `<host>:abc`, `<host>:`, `<host>:0` and
      `<host>:99999` are sent as the whole typed string, find no such host, and answer with the
      door's single silence. The split happens only on a `1`–`65535` suffix, so there is one code
      path and no second failure sentence to keep in step with the first.
- [x] **AC-13** Proven live: the wire-check runs the loop against `vercel dev` + supabase and is
      falsified at least once by breaking production.
      *Built as a SIBLING script (`scripts/testSnmpDepth.ts`) rather than as checks bolted onto
      the two existing ones: the fixture needs its own ESSID with a two-deep chain and agents on
      BOTH gateways, and threading a second topology through a script that sets one up carefully
      would have made both harder to read. It searches 200 seeded candidates and exits 2 when
      none qualifies.*

### RED — the failing tests, in the order they get written

1. `frontedSegment` — the `/24` a device's forwards may point into, from `(essid, machineId,
   kind)`. Pure and seeded, so it is tested first and alone: the edge gateway yields the LAN, an
   inner gateway yields its deep subnet, and a switch is never asked.
2. `handleSnmpWalk` against a deep device — hostname, own address, the fronting `.1` in the log.
   AC-2, AC-3, AC-7.
3. `handleSnmpWalk` against the inner gateway itself, bare. AC-1 — written expecting GREEN, and
   falsified by mutation.
4. `handleSnmpSet` against a deep switch, then the bound on an inner gateway and on the edge.
   AC-6, AC-8, AC-9.
5. The two commands' transport-address split, including everything that is not a port. AC-12.
6. The regression sweep: every slice 2–4 test unchanged. AC-11.

### GREEN — the minimum, in dependency order

1. `frontedSegment` in `src/core/network/` — beside the topology it reads, not inside the SNMP
   door, because it is a fact about the world rather than about this protocol.
2. The reach carries the box's OWN address. `InnerGatewayTarget` knows it at every hop;
   `ReachedServiceHost` gains it additively, and the three other vantages already hold it.
3. Both handlers take the port from the payload, defaulting to 161, and pass it to the reach.
4. `addressesOf` reads the reached address instead of `payload.target_ip`.
5. The bound calls `frontedSegment` instead of `segmentOf(payload.target_ip)`.
6. The commands split `<host>:<port>`; the adapters carry the port; `env`/`state` follow.
7. `scripts/testSnmpSet.ts` and `scripts/testSnmpWalk.ts` gain the deep checks.

### Five things GREEN must get right

- **The port travels, but the DISPLAY is what the player typed.** `Querying 192.168.188.7:2222 with
  community "..."` and `Timeout: No Response from 192.168.188.7:2222` — a tool echoes its own
  argument, and a header that silently dropped the port would describe a different request than the
  one made.
- **A bare host still sends 161, and must still resolve to the gateway itself.** That path is the
  one thing here that already works; the whole slice is worthless if threading a port breaks it.
- **The client splits the string and decides nothing else.** Reachability stays the server's, as the
  SET grammar did in slice 4. Splitting an argument is not parsing a rule.
- **A deep box is owned by nobody**, so its rows land under the caller's key (`writerKey: null` →
  the caller's), exactly as slice 4's generated devices do. The owner's key takes over in slice 7.
- **The bound is not consulted for a switch at all.** A switch has no forwards, so reaching for a
  fronted segment there would be asking a device a question its file cannot answer.

### Considered and rejected: splitting this into read and write

The epic's grain is read-then-write (slice 2 walked, slice 4 set), which suggests a 5a/5b split. It
was rejected: the SAME threading serves both doors, so 5b would inherit nearly finished work and be
almost entirely tests, and 5a alone would ship a walk that reports a deep device's identity
correctly while `snmpset` on the gateway above it still refuses every useful write. Half the
correction is worse than either whole.

### Progress — BUILT, on `feat/d8-snmp-inner` (2026-08-28)

Seven commits, each RED→GREEN with the gates clean. Full suite **3928 passing / 186 files**
(baseline at slice 4's close was 3904 / 182); `npm run typecheck` and `npm run lint` clean from
`v2/`; wire-check **12/12** against a live stack, falsified twice; version **v0.189.0**.

| Commit | What landed |
|--------|-------------|
| `9cb4e559` | the plan — slice 4 marked merged, slice 5 planned in full |
| `ccabfaea` | `frontedSegment` — the `/24` a device's forwards may point into |
| `f577ff8c` | the reach carries the box's own address; the walk answers as the device |
| `b8c142e1` | the set door takes the port, and the bound asks the device what it fronts |
| `6fbaebed` | `parseAgentAddress`, both commands, the params and the transport |
| `8ce3a74e` | `scripts/testSnmpDepth.ts` — 12 checks, falsified twice; v0.189.0 |
| `1c138b5c` | the mutation gate: the typo that would have reached the wrong box |

**AC-1…AC-13 are met.**

#### What building it settled that planning had not

- **The reach needed ONE field, and the rule that fills it was not obvious.** `localIp` is the
  address a box answers to FROM WHERE THE CALLER STANDS — the typed address on the caller's own
  LAN and across the world, the box's own deep address through a forward. Every vantage knows it,
  so there is no `null` meaning "ask the caller" as `sourceIp` has. The public vantage keeps the
  PUBLIC address rather than the internal one it resolved: handing that back would tell a
  stranger the shape of a LAN they have not reached.
- **The bound needed no new plumbing at all.** `generateDeepLayer` seeds its subnet from
  `deep-layer-<essid>-<machineId>` alone, and the handler already held `machineId` and computed
  `deviceKind`. Planning budgeted for wiring that turned out to be a two-line call.
- **`frontedSegment` calls `generateDeepLayer` rather than re-deriving the seed.** Extracting the
  subnet into a shared helper looked cleaner and was rejected: `generateDeepLayer` draws the
  subnet and the host octets from ONE prng stream, so any extraction that did not consume the
  same two draws would move every deep layer in the world. The `kind` parameter changes nothing
  today — it decides only whether a child hangs, which this caller discards — but inventing one
  here would be the function holding an opinion about a device it was told about.
- **Typecheck caught what 920 passing tests did not, for the FIFTH slice running.** An unused
  import and a dep the set door does not take (`findPublicIpByEssid` belongs to the walk, for the
  AP gateway's outside address). Same class as slices 1–4.
- **The scripted-splice escape trap bit a FOURTH time.** `'\n'` written through a heredoc'd Python
  splice arrives as a real newline and breaks the parse. Use the Edit tool for any content
  carrying escapes — this is now four for four across D8.

#### The mutation gate — run, survivors addressed

Scoped to this slice's changed production code (throwaway `vite.mutation.config.ts` +
`stryker.slice5.json`, both deleted after). Three runs: **84.50% → 84.99% → 85.32%**, survivors
**94 → 92 → 90**, killed 518 → 523, no-coverage 1 → 0. `frontedSegment.ts` and `agentAddress.ts`
both finished at **100%**.

| Survivor group | Action |
|---|---|
| `agentAddress`'s `separator === -1` early return | **Real gap, and a real bug.** Without it the whole string reads as the suffix, so the all-digit typo `12345` parses as host `1234` on port 12345 — a box the player never named. Now pinned |
| `'unknown'` → `""` on both doors' log lines | **Real gap.** A client that states no address left a line reading `[]`, which looks like a line the device failed to finish writing. Both doors now assert `[unknown]` |
| the failed-write log asserted only as "no SET line" | **Real gap.** Any OTHER junk line passed. Now asserted as EXACTLY the arrival and the verdict |

The 90 that remain, all classified:

- **81 in the two commands (`snmpset.ts` L42, L70-114; `snmpwalk.ts` L87-95)** — the command
  descriptor and its manual prose, plus the positional-argument guard. Slices 2, 3 and 4
  classified these identically, and the line numbers confirm none of them is in the new
  address-splitting path: its executable half has ZERO survivors.
- **3 in `resolveInnerGatewayTarget.ts` (L144)** — the `served.kind === 'none'` early return.
  Equivalent: falling through reaches the same `UNREACHABLE` at the bottom, because a `none` has
  no `internalIp` to match either branch. The mutant is not expressible in typed source at all —
  TypeScript narrows `served` on exactly that check.
- **2 in `serviceHost.ts` (L196, L203)** — the same-LAN `?? []` fallbacks, mutated to a junk
  array. Equivalent: a junk row matches no `owner_key` and no lease, which is what an empty array
  already does.
- **3 in `snmpSet.ts`** — `.looseObject` is required by the envelope; `currentState`'s `kind:
  'acl'` tag is applied to both sides of the comparison it feeds; the failed-write ternary's `[]`
  is now killed. All inherited classifications from slice 4, re-checked rather than assumed.
- **1 in `snmpWalk.ts` (L141)** — `writerKey ?? publicKey`. Still slice 7's: a generated device
  has no owner, so only a cross-player write can tell the two apart.

**Slice 4's deferred survivor is DISCHARGED.** Its report parked the `sourceIp ??` half as needing
"a vantage where the ROUTE resolves an address, which this slice never produces (slice 5/7 owns
it)". The deep vantage produces exactly that, and those mutants no longer survive.

### PR-ready when

AC-1…AC-13 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch
test gate is green, the wire-check has RUN against a live stack and been falsified, the mutation
gate has run with survivors addressed, and the version is bumped to **v0.189.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 6: a player runs their own agent and closes a port to the network, not to themselves

**Value**: The first defensive verb in the game that is not `systemctl stop`. Today a player who
does not want the world touching their store has exactly one move — kill the daemon, and lose it
themselves too. A filter keeps the service running FOR THEM while closing it to everyone else. The
attacker's prize is symmetric and is what makes the defence worth attacking: crack the community,
re-open a port the owner filtered, without ever holding a shell on the box.

**Path**: `apt install snmp` → `/usr/sbin/snmpd` plus a seeded `/etc/iptables/rules.v4` →
`systemctl start snmpd` → the box answers walks → `snmpset <host> <rw> inputPort.6379=deny` (or the
owner's own `nano`) → the deny lands in `rules.v4` → a neighbour's `nmap` no longer lists 6379,
their `redis-cli` is refused, and the owner's `redis-cli 127.0.0.1` still connects.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk, on `feat/d8-snmp-own`. No stack.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### What exploration settled before planning

- **`snmpd` is already in `DAEMONS` and `UNITS`** (`systemctl.ts`), landed by slice 1 under the
  guard #463 left behind. Nothing to add there, and the epic's "forced rather than chosen" bullet on
  this point is already discharged.
- **The `snmp` package ships only the two client binaries.** Adding `snmpd` to `binaries` and
  `daemons` also hands every GENERATED device already running the agent its daemon binary, because
  `binariesForService` matches on the package NAME. `extraFiles` are deliberately absent from that
  path, so no generated router's seeded NAT table is overwritten by the install's own file.
- **The own-box path never reaches the server.** `ownBoxSource` maps `localhost`, `127.0.0.1` and
  the box's own leased address to a client-side answer, and the server's same-LAN vantage excludes
  the caller by construction. "Never localhost" is therefore not something this slice builds — it is
  something this slice must not break, which makes it a regression criterion rather than a feature.
- **`openServiceOn` is the single gate every remote vantage passes** — own-LAN, same-LAN occupant,
  public and deep. One filter check there covers mysql, redis and snmp across all four. `ssh` and
  `hydra` resolve ports on their own paths and each needs its own.
- **Only gateways carry a port-authority file today.** A generated workstation has neither
  `rules.v4` nor `acl.conf`, so the filter is a fact about PLAYER boxes exclusively and no generated
  box's behaviour changes.
- **The open question the outline carried is answered: an installed agent IS scannable from
  off-box.** `readOpenPorts` reads pidfiles and nothing else; `rolePlacement` only decides which
  GENERATED devices roll an agent. A player who starts `snmpd` is advertising it — and the filter is
  exactly what makes that a choice rather than a leak.

### The residual this slice accepts rather than guards

A NAT write aimed at a workstation is already refused by slice 5's segment bound, but not for a
reason the code states: `frontedSegment` computes a DEEP subnet for a machine id that fronts no
layer, and every destination an attacker can name falls outside that phantom `/24`. The refusal is
correct; the mechanism is an accident.

Guarding it properly means moving segment-fronting out of the set door and into the reach, which is
the only layer that knows which vantage resolved the box. **That belongs to slice 7**, which needs
the cross-player gateway vantage anyway. Until then the residual is: an attacker who guesses a
random `/24` out of the generator's space writes one dead rule into a file. Recorded here so the
next reader knows it was seen and priced, not missed.

### Four decisions this slice needed, none of them covered by the epic's eleven

1. **Both tables, no discriminant.** A workstation and a router both carry `/etc/iptables/rules.v4`
   and neither carries `acl.conf`, so no device-kind test can tell them apart. The walk therefore
   renders what the FILE says: the forwards it finds and the denies it finds. A workstation has no
   forwards and shows only denies; a router has no denies and shows only forwards; a box carrying
   both shows both. Nothing has to decide what kind of machine it is, which is the only version of
   this that cannot go wrong later — a real `rules.v4` holds both chains too.
2. **A filtered port disappears from a neighbour's scan, and the walk still names it.** A DROP is
   invisible: the scan lists one fewer port. The attacker learns the filter exists by WALKING the
   agent, which prints the deny table. That turns scan → walk → set into one chain rather than three
   unrelated verbs, and it is what a real DROP does — a port that stayed listed and then refused
   would be an open port that lies.
3. **This slice owes a wire-check.** The epic's tentative `N/A` does not survive contact, the same
   way slices 2 and 3 found. The gate lands in `openServiceOn` and in the occupant-scan resolver,
   both server-executed, and the observable itself is a two-player same-LAN fact.
   `testMysqlSameLan.ts` and `seedCrossPlayerTarget.ts` already carry the harness shape.
4. **The deny grammar is COPIED into `iptablesRules.ts`, not extracted.** `switchAcl.ts` keeps its
   `parseAclDenies` and `withDeny`; `iptablesRules.ts` grows `parseInputDenies` and `withInputDeny`
   beside `withForward`, which is how decision 10 words it. They are named for the INPUT chain
   rather than mirroring the switch's spelling because `snmpSet.ts` imports BOTH writers, and two
   exported `withDeny`s would collide at the one call site that needs each. Two copies of a three-line regex, on the bet that a switch's access
   list and a host's INPUT chain will want to diverge — `deny <port> from <ip>` is a natural next
   move for one of them and not the other. A shared module would make every future change to either
   ask permission from the other.

### Acceptance criteria — FOR CONFIRMATION, before any code

- [x] **AC-1** `apt install snmp` on a workstation lays down `/usr/bin/snmpwalk`,
      `/usr/bin/snmpset` and `/usr/sbin/snmpd`, and plants `/etc/iptables/rules.v4` owned by `root`,
      root-read and root-write, never executable.
- [x] **AC-2** The planted file denies nothing: a walk of the freshly installed box reports an empty
      table, and every port the box serves is still reachable from a neighbour.
- [x] **AC-3** `systemctl start snmpd` brings the agent up on that box and `systemctl stop snmpd`
      takes it down. A stopped agent reads as `host_unreachable`, never as a refusal — the answer
      D7 slice 5b fixed for every depth.
- [x] **AC-4** A generated device that rolled an agent now also carries `/usr/sbin/snmpd`, and its
      seeded `rules.v4` or `acl.conf` is byte-for-byte what it was before this slice.
- [x] **AC-5** `parseInputDenies` reads `deny <port>` from `rules.v4` content, skipping blanks,
      comments and malformed lines and rejecting ports outside 1–65535. `parseForwardRules` over the
      SAME content still returns the forwards and only the forwards.
- [x] **AC-6** `withInputDeny` on `rules.v4` adds or removes exactly one line. The header, the commented
      example, every forward, and anything the owner typed in `nano` survive byte-for-byte, and a
      deny the owner commented out stays a comment.
- [x] **AC-7** A walk of a workstation agent renders `Linux <hostname>` and `eth0` identity, plus
      one `INPUT-MIB::inputPort.<port> = STRING: deny` row per deny. Named for the CHAIN, not the
      filter: `INPUT-MIB::inputPort.65535` is exactly as wide as the OID column, and `FILTER-MIB`
      would run one character over and shunt the `=` on every five-digit port.
- [x] **AC-8** A walk of a device whose `rules.v4` carries BOTH kinds renders both — NAT rows and
      filter rows, from the one file. A device whose `rules.v4` holds neither says so in ONE
      sentence and offers BOTH write syntaxes.
- [x] **AC-9** A switch is untouched: `acl.conf` still renders as `ACL-MIB::aclPort.<port>`, and a
      switch's walk mentions no filter table.
- [x] **AC-10** `snmpset <host> <rw> inputPort.<port>=deny` writes the deny into `rules.v4` and
      echoes `old -> new`; `=permit` removes it; a read-only community gets `notWritable`; a port
      outside 1–65535 gets `noSuchName`; any other value gets `wrongValue`.
- [x] **AC-11** A neighbour's `nmap` of a box carrying `deny 6379` lists every other port and not
      that one. The OWNER's own scan of their own address still lists it.
- [x] **AC-12** A neighbour's `redis-cli` against a filtered port is refused with the word-for-word
      sentence an unserved port already gives — a DROP, not a distinguishable refusal. `mysql` and
      `snmpwalk` behave identically, because all three pass `openServiceOn`.
- [x] **AC-13** `ssh` and `hydra` honour the filter on their own paths: a filtered `22` refuses the
      login and yields no crack.
- [x] **AC-14** The owner's `redis-cli 127.0.0.1`, `redis-cli localhost` and
      `redis-cli <own leased address>` all still connect to a filtered port. The regression that
      matters most in this slice.
- [x] **AC-15** The filter covers the agent itself: `deny 161` stops the device answering walks from
      the network, while the owner's `nano` on the box still edits the file. Locking yourself out of
      your own agent is allowed, exactly as decision 11 already allows severing your own route.

### RED — the failing tests, in the order they get written

1. `iptablesRules.test.ts` — `parseInputDenies` over a file holding forwards, denies, comments and
   junk; `withDeny` add and remove preserving every other byte. (AC-5, AC-6)
2. `walk.test.ts` — the workstation block, the both-kinds block, the empty-file sentence, and the
   switch left alone. (AC-7, AC-8, AC-9)
3. `set.test.ts` — the `inputPort` OID and its four answers. (AC-10)
4. `snmpSet` door tests — the deny reaching `rules.v4`, with `old -> new` in `snmpd.log`. (AC-10)
5. The gate: a filtered port refused through `openServiceOn` for all three data doors, absent from
   the occupant scan, refused by `ssh` and `hydra`, and STILL open to the owner's own box.
   (AC-11…AC-14)
6. `aptPackages.test.ts` — the three binaries, the planted file's permissions, and a generated
   device's seeded file untouched. (AC-1, AC-2, AC-4)
7. `systemctl` against an installed agent. (AC-3, AC-15)

### GREEN — the minimum, in dependency order

1. `iptablesRules.ts` — `parseInputDenies`, `withInputDeny`, and the seed the install plants.
2. `walk.ts` — `SnmpPortTable` becomes a LIST of tables rather than one member of a tagged union;
   `inputPortOid`; the `FILTER-MIB` vocabulary and the combined emptiness sentence.
3. `set.ts` — `inputPort` in `SET_OID_RE`, and its `deny`/`permit` values beside `aclPort`'s.
4. `snmpWalk.ts` and `snmpSet.ts` — `portTablesOf` reading every table the box's files support, and
   `storedFile` writing the filter back into `rules.v4`.
5. **One function, `portsOpenToNetwork(hostFs)`** — `readOpenPorts` minus the box's own denies.
   Every REMOTE site calls it; every own-box and client-side site keeps `readOpenPorts`.
6. Thread it through the FIVE remote sites: `openServiceOn` (all three data doors, all four
   vantages), `resolveOccupantScan` (the neighbour's scan answer), `reachDoor` (ssh AND a planted
   `nc` listener, all three ssh vantages), `hydraCrack` and `hydraCrackPublic`.

   Deliberately NOT threaded, each for a stated reason: `nmapScan`'s two trace sites write the
   DEFENDER's own `kern.log`, and a box's own log is not the place to hide that box's own filter —
   nothing there reaches the attacker, and the probe really did arrive. The deep and
   inner-gateway readers resolve GENERATED boxes, which carry no filter file at all. `nmap.ts`,
   `scanResult.ts` and `runLine.ts` are the owner's own view of their own box.
7. `aptPackages.ts` — `snmpd` in `binaries` and `daemons`, and the `rules.v4` extra file.

### Five things GREEN must get right

1. **`readOpenPorts` stays the truth.** The filter is a VIEW for remote callers, not a rewrite of
   what is listening. `ps`, the owner's own scan, and the pidfiles themselves are unchanged — a
   filtered daemon is running, which is the whole point of preferring a filter to `systemctl stop`.
2. **The two deny lists never merge.** A switch's `acl.conf` denies render as `aclPort`; a host's
   `rules.v4` denies render as `inputPort`. They cannot co-occur on one box today, but they are
   different facts in different files and one list would make them one.
3. **The refusal is the EXISTING one.** A filtered port must be indistinguishable from a port
   nothing serves. A new refusal sentence would be a scanner's oracle for which ports are worth
   attacking.
4. **`binariesForService` must not gain `extraFiles`.** Its own comment already says why: the
   package's file is drawn from the installing PLAYER, and laying it over a generated box would
   overwrite that box's own table.
5. **Every new remote call site is a place the filter could be forgotten.** Five sites is the count
   TODAY; the mutation gate is what proves each one load-bearing rather than decoration. The
   `nc`-listener branch of `reachDoor` is the one that would have been missed by reading the port
   readers alone — it finds its door through `listenerOn`, not through `readOpenPorts`.

### Considered and rejected: splitting the gate out as its own slice

The install, the grammar, the walk and the set could ship without the gate, leaving a file that
parses and renders and blocks nothing. That is a slice whose observable is "a player writes a rule
with no effect" — the exact shape decision 9 refused for `snmpset` on a fresh router, for the same
reason. A filter that does not filter is worse than no filter: it tells the owner they are defended.

### Progress — MERGED #470, on `feat/d8-snmp-own` (2026-08-29)

Nine commits, each RED→GREEN with the gates clean. Full suite **3994 passing / 187 files**
(baseline at slice 5's close was 3928 / 186); `npm run typecheck` and `npm run lint` clean from
`v2/`; wire-check **13/13** against a live stack, falsified twice; mutation gate closed at
**97.43%**; version **v0.190.0**.

| Commit | What landed |
|--------|-------------|
| `3d8bbc96` | the plan — slice 5 marked merged, the epic's five stale D8 rows, slice 6 planned in full |
| `fcc97156` | `rules.v4` grows an INPUT chain beside its NAT table |
| `e97f4b1d` | a device answers with every table its files hold |
| `8a34da1b` | a port closes on the box that answers |
| `0924ba24` | what a box answers to the network is not what runs on it |
| `74a14846` | a filtered port is not a door, at every way in |
| `543ca8c6` | the package that lets a player run their own agent |
| `b5b6e720` | `scripts/testSnmpFilter.ts` — 13 checks, falsified twice; v0.190.0 |
| `09412de2` | the mutation gate: eight gap-closing tests, the thrice-deferred dead filter removed |

**AC-1…AC-15 are met.** Names deviated from the plan in two places and the plan was reconciled at
the time: `parseInputDenies`/`withInputDeny` rather than `parseDenyRules`/`withDeny` (`snmpSet`
imports BOTH writers, and two exported `withDeny`s collide), and `INPUT-MIB` rather than
`FILTER-MIB` (`INPUT-MIB::inputPort.65535` is exactly the OID column's width; `FILTER-MIB` runs one
over and shunts the `=` on five-digit ports).

### What building it found that planning had not

- **`snmpd` has been UNSTARTABLE since slice 1.** `systemctl` gates `start` on the binary existing,
  and no package shipped `/usr/sbin/snmpd` — so the unit sat in `DAEMONS` and `UNITS` for five
  slices with nothing on any shelf to buy it with. #463's guard checks a unit EXISTS, not that a
  player can OBTAIN it. A sibling guard now closes the class, exempting `sshd`/`vsftpd` through the
  existing `SYSTEM_DAEMON_NAMES`.
- **`hydraCrackPublic` was green on arrival and nothing caught it.** The whole 602-test session
  suite passed with the world-facing sweep ignoring filters. A published port is the one address a
  stranger can always reach, and it would have been the single place a filter did not apply.
- **The `nc` branch of `reachDoor` needed it too.** It finds its door through `listenerOn`, not
  `readOpenPorts`, so reading the port readers alone would have missed it. A defender can now close
  a backdoor they never found.
- **Five sites, not six.** `reachDoor` is one gate for ssh at all three vantages, and `openServiceOn`
  already covered the three data doors. `nmapScan`'s two trace sites are deliberately excluded —
  they write the DEFENDER's own `kern.log`, and a box's own log is not the place to hide that box's
  own filter.
- **One test claimed more than the design promises** and was narrowed rather than made to pass: a
  filtered port is indistinguishable from a STOPPED daemon (`service_not_running`), not from an
  ABSENT address (`host_unreachable`). Those are two answers the client renders identically.
- **Four of the wire-check's checks failed on their first live run, all harness bugs** — a same-LAN
  ssh needs a `session_id`, the walk answers with tables rather than rendered lines, an `snmpset`
  refusal is HTTP 200 with an error PDU, and "every port filtered" had denied two of three.

### The residual, now evidenced live

Wire-check 13 pins it: a forward aimed at a workstation is refused with `192.168.115.23 is not on
this device's segment` — the right answer arriving through the phantom deep segment
`frontedSegment` computes for a box that fronts nothing. Correct outcome, accidental mechanism.
**Slice 7 owns the fix**, and now has a live check that will change its wording when it lands.

#### The mutation gate — run, survivors addressed

Scoped to this slice's changed production code (throwaway `vite.mutation.config.ts` +
`stryker.slice6.json`, both deleted after). Two runs: **94.89% → 97.43%**, survivors **63 → 37**,
killed 1375 → 1401, no-coverage **11 → 0**, zero timeouts in both. `portsOpenToNetwork.ts`,
`hydraCrackPublic.ts` and `snmpwalk.ts` finished at **100%**.

Two files were left out of the mutate scope on purpose: `adapters/sessionsApi.ts` sits outside the
repo's `src/core/**` scope and its change is a transport-schema mirror the wire-check owns, and
`commands/snmpset.ts` changed only in manual prose — the long-classified `Command`-metadata class.
`commands/snmpwalk.ts` was mutated at its executable half (`46-84`) and scored 100%.

| Survivor group | Action |
|---|---|
| `authCreateSession`'s `nc` port gate | **Real gap, and the slice's own claim was unproven.** `74a14846` says "a defender can now close a backdoor they never found"; the code does gate it and nothing pinned it. Now: two listeners, one port denied — the denied knock 404s, the one beside it still opens. One listener would let the mutant read as "is anything open on this box?" |
| `apt`'s planted seed | **Real gap.** `parseInputDenies('')` is `[]`, so "plants a file that denies nothing" was true of an EMPTY file. The planted bytes are now asserted to be the seed |
| `binariesForService`'s `\|\|` union | **Real gap.** `snmp` matches BOTH arms, so nothing discriminated them. ftp now matches by NAME (nothing here ships `vsftpd`) and http by DAEMON (the package is `nginx`) — the two rules the module's own header claims |
| five catalogue entries mutating to `{}` unnoticed | **Real gap**, the "entry no test ever draws" class. One population assertion: every package names itself, every binary resolves back to the package that ships it |
| the seed's commented example | **Real gap.** The file says "uncomment & edit" and nothing checked that what it shows is valid grammar. A test uncomments it and reads back `6379` |
| `parseSnmpSet`'s no-separator branch | **Real gap.** An assignment with no `=` is echoed back WHOLE; the mutant returns it one character short, which reads as a typo the device invented |
| an unknown service name at the public sweep | **Real gap.** The payload takes any non-empty string, and the 404 that keeps the door from being a catalogue of what exists had no test. Also cleared 4 of the 11 no-coverage |
| `parseForwardRules`'s dead comment filter | **REMOVED** (see below) |

**Seven mutants hand-falsified**: each new test was run against its own mutant and seen red before
the mutant was reverted. A test that only passes is not evidence that it kills anything.

**The thrice-deferred debt is DISCHARGED.** `parseForwardRules`'s
`.filter(line => line.length > 0 && !line.startsWith('#'))` is gone. `FORWARD_RULE_RE` is anchored
`^forward…$`, so a blank or a `#` line can never match it — the filter could not change an answer,
which is why six of its mutants survived three gates running. The full suite (3994 / 187) stays
green across the deletion, and the two parsers now have the shape the module's own rewritten header
claims: "each kind has its own parser and neither sees the other's lines."

**The 37 that remain are classified, not ignored:**

- **6 in `LOCAL_FILTER_SEED`'s header prose** — the five comment lines and the trailing blank.
  Documentation, and the same accepted class as a `Command`'s manual. The two load-bearing
  properties are both pinned now: it denies nothing, and its example is real grammar.
- **3 in `aptPackages` L229 are FALSE SURVIVORS.** `pkg.binaries && [pkg.name]` crashes the module
  at import, vitest reports "2 failed, no tests", and Stryker scores zero failing tests as a
  survivor. Hand-checked, and now recorded in `conventions-and-gotchas.md` §mutation.
- **8 in `authCreateSession` L228, L323, L339, L343** — pre-existing lines this slice never touched:
  a `'passwd'` tag no consumer compares (every caller branches on `kind === 'listener'` and treats
  the rest as the else), the missing-credential guard, the `'failure'` outcome string, and
  `account === null ||`, which is subsumed by `!passwordOk` at runtime but REQUIRED for TypeScript
  to narrow `account` before `account.userType` below it.
- **11 `?? []` fallbacks mutated to a junk array** (`hydraCrack` ×2, `serviceHost` ×2,
  `resolveOccupantScan` ×2, `snmpSet`, `aptPackages`) — a junk row matches no `owner_key`, no lease
  and no daemon, which is what an empty array already does. Inherited from slice 5 and re-checked.
- **2 kind tags in `snmpSet`'s `currentState`** (`'acl'`, `'filter'`) — its ONE caller takes
  `describeSet(...).value`, computed from `denied`, and throws the `oid` the kind decides away.
  Slice 5 classified the `'acl'` half by inheritance; this is the actual reason.
- **3 in `parseSnmpSet` L115/L119** — the no-separator VALUE (an `=`-less assignment is refused on
  its name before the value is read either way) and `named === null`, which TypeScript needs to
  narrow before `named[1]`.
- **2 in `padRight`** — `>=` → `>` differs only at exactly-equal length, where `' '.repeat(0)` is
  the same string. `INPUT-MIB::inputPort.65535` is exactly the column width and nothing in the game
  is wider, so the else branch is unreachable rather than merely untested.
- **1 in `snmpWalk` L151** — `writerKey ?? publicKey`. **Still slice 7's**: a generated device has
  no owner, so only a cross-player write can tell the two apart.
- **1 in `aptPackages` L108** — `['msfconsole']` → `[]` leaves the package findable by its own name
  through the default. Unobservable through the module's public accessors.

### WHERE IT LANDED

Merged as `0f40e9e8` (#470, squashed) on 2026-08-29 — 37 files, +2469 / −166. The live stack came
down first: supabase stopped with its docker volume kept, nothing left listening on 3100.

No production behaviour changed at the gate — the only source edit was deleting dead code — so the
wire-checks stand as run: `testSnmpFilter` 13/13, `testRedisSameLan` 16/16, `testSnmpDepth` 12/12,
`testDaemonGates` 6/6, `testHydraOwnLan` 23/23.

Debts this slice did NOT discharge, both slice 7's: `writerKey ?? publicKey`, unkillable until a
cross-player write exists, and the `frontedSegment` residual above. Wire-check 13 pins the CURRENT
wording of the refusal that residual produces — when slice 7 moves segment fronting into the reach,
that check's expected message moves with it.

### This slice OWES a wire-check

`scripts/testSnmpFilter.ts`, modelled on `testMysqlSameLan.ts` plus `seedCrossPlayerTarget.ts`. Two
players on one ESSID: the owner installs, starts the agent and denies a port; the neighbour scans
and is refused; the owner's own box still answers. It must be RUN against `vercel dev` and supabase
and FALSIFIED — a check never seen red is not evidence.

### PR-ready when

AC-1…AC-15 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full non-watch
test gate is green, the wire-check has RUN against a live stack and been falsified, the mutation
gate has run with survivors addressed, and the version is bumped to **v0.190.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 7: a player opens a port into another player's LAN, from the other side of the world

**Value**: The last D8 door, and the one the whole arc was built toward. B has never held a shell on
A's network and never will: they scan A's public address, walk the access point that bears it, crack
the community that governs it, and rewrite the NAT table the world routes A's LAN by. What B opens
is a door into somebody else's home — and A's only evidence is a log the attacker's own visit wrote.

**Path**: `nmap <A's public IP>` → `snmpwalk <A's public IP>` (identity, `public`) →
`hydra <A's public IP> snmp` (the read-write community) → `snmpwalk <A's public IP> <rw>` (A's
forward table) → `snmpset <A's public IP> <rw> natForward.2222=<an address on A's LAN>:22` → the
forward lands in A's gateway's own `rules.v4` → `ssh <A's public IP>:2222` now reaches the occupant
who leases that address, and A's `/var/log/snmpd.log` carries B's public address on every line.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk, on `feat/d8-snmp-cross`. No stack.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### What exploration settled before planning

- **The whole chain to A's gateway already resolves.** `resolvePublicTarget` materializes the
  gateway first, boot-gates it, then routes by destination port through `machineServing`: a port the
  gateway SERVES answers as the gateway itself. Every player's AP gateway is pinned to run the agent
  (`buildApGatewayBaseFs`, deliberately not routed through `placementOf`), so 161 is such a port on
  every network in the game. B's walk and B's crack need no new resolution.
- **The target's ESSID is already resolved server-side and already discarded.** `PublicTarget`
  carries `essid` — read from `findNetworkByPublicIp`, never from the client — and
  `ReachedServiceHost` does not surface it. That missing field is the whole of why the set door has
  to guess.
- **`logWriterKey` is already the AP's stable key on the public vantage**
  (`apGatewayLogWriterKey(leases)`, the lowest octet ever leased), so the cross-player half of the
  one-row guarantee arrives for free. The own-LAN half does not — see the third decision.
- **The reach serves three doors, not every door**: `mysqlConnect`, `mysqlStatement`,
  `redisConnect`, `redisStatement`, `snmpWalk`, `snmpSet`. `ssh` and `hydra` resolve on their own
  paths. Anything changed in `ReachedServiceHost` therefore cannot reach `auth.log`, and a gateway
  serves neither database — so a change to the gateway's own reach is a change to the SNMP doors
  alone.
- **`parseAgentAddress` already takes a public address.** A bare address is the device at it; the
  client decides WHICH BOX and never whether it may be talked to. Nothing is owed at the command
  layer.
- **An `apt install snmp` agent answers NOBODY, and that is not this slice's business.** The package
  plants `rules.v4` and nothing else — no `/etc/snmp/snmpd.conf`, no community state — and
  `communityTier` is explicit that a device whose config names no community answers nobody. Slice
  6's wire-check seeds `/var/lib/snmp/snmpd.conf` into the journal to get around it, which is honest
  for a harness and invisible from inside the game. Recorded as **slice 8**; this slice reaches a
  GATEWAY, whose community is seeded from the ESSID and has always been crackable.

### The defect this slice must fix BEFORE its own observable can work

Slice 6 recorded segment fronting as a residual — a refusal that was right for the wrong reason. At
this vantage it stops being cosmetic and becomes the thing standing in the slice's way.

`snmpSet` computes the bound from `payload.essid`, which is the CALLER's:

```ts
frontedSegment({ essid: payload.essid, machineId, kind })
```

Cross-player that reads `generateDeepLayer(B's essid, { machineId: A's gateway })` — a subnet drawn
for a device on a network it does not belong to. Every address B could name inside A's LAN falls
outside it, so **the slice's headline write is refused one hundred percent of the time today**, with
a sentence that names A's LAN and sounds correct. The fix the plan predicted at slice 6 is now a
prerequisite rather than a cleanup.

### Three decisions this slice needed

1. **The reach states the fronted segment; the set door stops deriving one.**
   `ReachedServiceHost` gains `frontedSegment: string | null`, and each vantage answers for the box
   it just resolved — public-and-gateway from the TARGET's essid, deep and own-LAN from the caller's
   own (which at those vantages genuinely IS the box's network), and `null` for a box that fronts
   nothing at all. The alternative — handing the door the target's essid and letting it keep
   computing — fixes the cross-player case and leaves the residual intact in a better disguise: an
   occupant's workstation would draw a phantom deep subnet from the RIGHT essid instead of the wrong
   one. Moving the derivation is what lets `null` exist, and `null` is what lets a refusal say *this
   device fronts no segment* rather than fail a comparison against a network nobody is on.

2. **`null` refuses; it never skips.** A box that fronts nothing cannot hold a NAT forward, so the
   absence of a segment is a REASON and not missing information. A check that treated `null` as
   "unknown, allow" would turn the one field this slice adds into the widest hole in the door.

3. **One gateway, one log row, both vantages.** A's own walk of their own gateway resolves on the
   own-LAN vantage, which returns `writerKey: null` — so the line lands under A's own key, while
   B's public walk of the same box lands under the AP's stable key. On a shared AP where A does not
   hold the lowest octet those are two rows for one path, and `patches` replay gives the newest row
   outright: A's later walk of their own gateway silently erases B's lines. That is the epic's own
   observable failing — *A's `snmpd.log` names B* is worth nothing if A's next command deletes it.
   The own-LAN vantage therefore returns `apGatewayLogWriterKey` when the box it reached is the AP
   gateway. `listLeasesByEssid` is already on the reach's deps, the branch costs one read on the
   gateway path only, and the blast radius is the SNMP doors alone.

### Acceptance criteria — FOR CONFIRMATION, before any code

- [x] **AC-1** B `snmpwalk <A's public IP>` with `public` renders A's gateway's identity: its
      ESSID-seeded hostname, `Linux <hostname>`, and the PUBLIC address as the only address it
      reports. A's internal LAN address appears nowhere in the answer.
- [x] **AC-2** `hydra <A's public IP> snmp` cracks the gateway's read-write community from B's own
      wordlist, exactly as it does against a device on the caller's own LAN.
- [x] **AC-3** B `snmpwalk <A's public IP> <rw>` renders the NAT forward table read from A's
      gateway's own `rules.v4` — the same file A edits with `nano`, not a second copy.
- [x] **AC-4** B `snmpset <A's public IP> <rw> natForward.2222=<address on A's LAN>:22` writes the
      forward into that file and echoes `old -> new`. **The observable this slice exists for.**
- [x] **AC-5** The forward B wrote is LIVE: `resolvePublicTarget` routes `<A's public IP>:2222` to
      the occupant leasing that address, so `ssh` and every other public door reach the box B
      exposed. One table, written by an attacker, read by the same resolver as always.
- [x] **AC-6** A destination outside the `/24` A's gateway fronts is refused `wrongValue` with
      `<ip> is not on this device's segment`, judged against the segment resolved from A's ESSID
      server-side — never from the ESSID B's client sent.
- [x] **AC-7** A NAT write aimed at a box that fronts NOTHING — an occupant's workstation reached
      through a forward, or a neighbour's box on a shared LAN — is refused for fronting no segment,
      stating that reason rather than failing a comparison against a phantom subnet. The residual
      slice 6 recorded is discharged here.
- [x] **AC-8** Every walk and every set B makes appends to A's gateway's `/var/log/snmpd.log`,
      carrying B's own public address. TWO different attackers accrete into ONE row: the second
      visit never erases the first's lines.
- [x] **AC-9** A's own walk of their own gateway from their own LAN lands in the SAME row as B's
      public walk, under the AP's stable log-writer key on both vantages — so a defender reading
      their own gateway's log sees the attacker's lines beside their own, whoever holds the lowest
      lease.
- [x] **AC-10** A community B has not cracked is SILENCE: `host_unreachable`, word-for-word what an
      address bearing no network answers, so a stranger cannot tell a refused community from a box
      that is not there. The visit is still logged.
- [x] **AC-11** A gateway whose `rules.v4` carries `deny 161` does not answer B at all, and B cannot
      tell it from a device that was never there. Slice 6's filter, proven at the vantage it was
      never exercised from. A SERVER-LEVEL guarantee, deliberately: the gateway's file is root-only
      and an owner reaches it with `nano` only where `seedApGatewayHasSsh` rolled true for their
      ESSID, so what this pins is the door honouring a filter wherever one exists — not a defence
      every player can raise. Whether an owner can always filter their own gateway is a later
      slice's question, and this criterion does not answer it.
- [x] **AC-12** Slices 4 and 5 are unmoved. The own-LAN set on the player's own AP gateway and the
      inner-gateway set on a deep layer accept and refuse exactly the destinations they did before,
      now judged by the reach rather than by the door. `testSnmpSet` 16/16 and `testSnmpDepth` 12/12
      pass unchanged.
- [x] **AC-13** A device reports each address it holds ONCE. From the world the gateway's public
      address is the face the caller already reached it by, so a walk shows that alone; from inside
      its own LAN the same gateway still shows its LAN address and its public one, in that order.
      **Added mid-slice**, on the evidence below: walking your own public address listed it twice.

#### AC-13 — added during RED step 4, and why

`addressesOf` decided whether a box was an access point's gateway by comparing its machine id
against `computeApGatewayId(<the ESSID on the request>)` — the caller's own network, deciding a
server answer, in the slice whose whole purpose is removing that. A stranger got the right answer
only because their ESSID differs from the defender's; the OWNER walking their own public address
matched, looked the public IP up, and appended the address they had just typed:
`addresses: ['203.0.113.9', '203.0.113.9']`.

The fix is the vantage, not the field. `localIp` is already the address the box answers to FROM
WHERE THE CALLER STANDS, so the second face is shown only when it is not the one already in hand.
The ESSID comparison then stands as it was, and is safe alone among this door's uses of it: a
machine id matches `computeApGatewayId` only for the network that generated it, so the lookup
either runs against the reached box's own ESSID or does not run at all.

#### AC-11 needed a production change, and slice 6's record needs reading with it

Slice 6 narrowed a test rather than make it pass, recording that a filtered port is
indistinguishable from a STOPPED daemon and not from an ABSENT address. That holds on the own-LAN
vantage, which is the only one it could exercise. From the WORLD it was true of neither: routing
runs on `machineServing`, which reads the raw pidfiles, so a stopped agent failed to route and
answered `host_unreachable` while a filtered one routed fine and was refused a layer later as
`service_not_running`. Filtered was the ONE state a stranger could pick out of the four — the exact
oracle the design argues against, inverted.

The gateway's own INPUT chain now drops a packet addressed to it before anything is routed, in
`resolvePublicTarget`. From the world an address bearing no network, a bricked gateway, a stopped
daemon, a filtered port and a refused community are one answer. A FORWARD is untouched: an INPUT
rule governs traffic the box terminates, never traffic it passes through — and that exemption is
pinned by 49 tests, which is what dropping the `served.kind === 'router'` guard costs.

### RED — the failing tests, in the order they get written

1. `serviceHost` tests — `frontedSegment` per vantage, and the AP gateway's writer key on the
   own-LAN vantage. The foundation both doors then read. (AC-6, AC-7, AC-9)
2. `snmpSet` tests — the door consuming the reach's segment, and the `null` refusal. (AC-6, AC-7)
3. The cross-player set: B's write landing in A's gateway's file, the echo, the log line, and two
   attackers accreting into one row. (AC-4, AC-8)
4. The cross-player walk: identity without the internal address, the table, silence on a wrong
   community, and the filtered agent. (AC-1, AC-3, AC-10, AC-11)
5. `hydraCrackPublic` against `snmp`. (AC-2)
6. The forward B wrote resolving through `resolvePublicTarget`. (AC-5)

### GREEN — the minimum, in dependency order

1. `serviceHost.ts` — `ReachedServiceHost.frontedSegment: string | null`, stated by each of the
   four vantages; the AP-gateway branch of the own-LAN vantage's writer key.
2. `snmpSet.ts` — read the segment off the reach, refuse on `null`, and drop the `frontedSegment`
   import along with the door's opinion about generation.
3. Whatever the commands and adapters owe for a public address — expected to be nothing, and the
   plan says so out loud so that finding it is nothing is a confirmation rather than a surprise.
4. `scripts/testSnmpCrossPlayer.ts` — the wire-check.

### Four things GREEN must get right

1. **The claimed ESSID is never the fronting authority again.** It is the one field a client fully
   controls, and the bound it was deciding is the difference between a rule inside somebody's LAN
   and a rule anywhere.
2. **`null` refuses.** See decision 2. The test for it is written before the field exists.
3. **The public vantage keeps handing back the PUBLIC address.** `localIp` is already deliberate —
   returning A's internal address would tell a stranger the shape of a LAN they have not reached,
   and `addressesOf` would then print it in the identity block.
4. **Silence stays silence.** Three states — no such network, agent stopped, community refused —
   answer identically. The write half may explain itself once the community is proved; the reach
   never may.

### This slice OWES a wire-check

`scripts/testSnmpCrossPlayer.ts`, modelled on `testHydraCrossPlayer.ts` plus
`seedCrossPlayerTarget.ts`. Two players, two networks: A holds a public IP, B stands anywhere. B
walks with `public`, cracks, walks with the community, writes a forward into A's LAN, and reaches
the box behind it; A reads their own gateway's log and finds B's address. It must be RUN against
`vercel dev` and supabase and FALSIFIED — a check never seen red is not evidence.

### The three debts this slice must discharge

Recorded across slices 2, 3 and 6, all of them waiting for exactly this world:

- **`writerKey ?? publicKey`** (`snmpWalk.ts`) — killable now, because the public vantage returns a
  non-null key. Slice 2 deferred it, slice 3 confirmed it, both said do not let slice 7 close
  without it.
- **The accretion invariant** — every visitor's lines onto ONE row. AC-8 is its test.
- **The `frontedSegment` residual** — AC-7, and no longer optional.

**Wire-check 13 of `testSnmpFilter` needs no edit after all.** Planning recorded it as pinning the
CURRENT wording of the refusal that residual produces, and warned the right change would turn a
green check red. Reading the script settles it: the check asserts `refusal.reason === 'wrongValue'`
and nothing more, and the detail appears only in the diagnostic string it prints on failure. The
reason is unchanged, so the check stays green as written and the wording moves under it.

### Considered and rejected: giving an installed agent a community in this slice

It is the symmetric prize slice 6 advertised and it is genuinely missing, but it is a different
slice: it needs a decision on what community a fresh install gets, whether it is seeded or rolled,
and how an owner changes one — none of which this slice's gateway path touches, because a gateway's
community has been seeded from the ESSID since slice 1. Folding it in would put two observables and
two decision sets in one PR. It is **slice 8**.

#### The mutation gate — run, survivors addressed

Diff-scoped to the five production files this branch changed, on a clean tree.

| run | score | killed | survived | no cov |
| --- | --- | --- | --- | --- |
| first | 97.48% | 581 | 11 | 4 |
| after two kills | 97.82% | 583 | 9 | 4 |
| final | **97.99%** | 584 | 8 | 4 |

**Three real gaps, all killed**, each proved by re-applying the exact mutant:

- **`snmpSet` line 290** — the failed-write path asserted only that no `SET ` line appeared, so any
  other line passed. A trace is the defender's only evidence; it now pins exactly the arrival and
  the verdict, matching the rigour its sibling test already had.
- **`snmpSet` line 75** — the whole request schema could be replaced with `.looseObject({})` and
  nothing noticed. The write door had NO shape-refusal test, while the read door has three. A
  signed request carrying no assignment is now `payload_invalid`, writes nothing, and logs nothing:
  the agent never heard a request this door could not read.
- **`serviceHost` line 297** — the AP-gateway guard, pinned through the mysql own-LAN door where
  the leases can change the answer. The SNMP doors cannot reach that branch at all (see below).

**Twelve survivors are equivalent mutants**, each checked against the code rather than assumed:
three `kind` strings swapped into fields that are either computed from the machine id
(`frontedSegment` never reads `kind` on the AP-gateway branch) or discarded (`describeSet(...).value`
is the same for `acl` and `filter`); five `?? []` fallbacks where a junk row has no `owner_key` or
`octet`, so every consumer lands on the empty-array answer; and the `served.kind === 'none'` guard,
whose removal falls through two failed address comparisons to the same `UNREACHABLE`.

#### A test that was not testing what it said

Chasing the `serviceHost` survivor turned up worse than the mutant. The test named *"writes a walk
of any other box on that LAN under the caller's own key"* never reached `apGatewayWriterKey` —
proved by making the guard `throw`, which the test survived. Every agent-running device that is not
the edge `.1` is an inner gateway, so that walk resolves down the forward chain and its `null`
writer key comes from the DEEP vantage. The test is real and worth keeping; its name and comment
now say which vantage it proves. Trusting the name would have shipped the guard behind coverage
that was not coverage.

### The live run

All four SNMP wire-checks were run against `vercel dev` on 3100 with supabase up (this project
binds the API on **54421** and the database on **54422**, not the CLI defaults — a probe of 54321
finds nothing and means nothing).

| script | result |
|---|---|
| `testSnmpCrossPlayer` | **15/15**, first execution |
| `testSnmpSet` | **16/16** — after the repair below |
| `testSnmpDepth` | **12/12** unchanged |
| `testSnmpFilter` | **13/13** unchanged |

**The cross-player check was falsified before it was believed.** Deleting the filter-before-routing
guard from `resolvePublicTarget` drops it to 13/15, and the diagnostic prints the exact leak the
criterion exists to close: a filtered gateway answering `service_not_running` where an empty
address answers `host_unreachable` — the one state a stranger could pick a defended box out of the
world by. Removing the own-address dedup from `addressesOf`, by contrast, does **not** move this
script, and should not: the dedup governs a player walking their OWN public address, a vantage no
cross-player run visits. That mutant dies in `snmpWalkCrossPlayer.test.ts` instead, which is the
honest layer for it — the wire-check's job is that the doors dispatch for a public address at all.

### `testSnmpSet` was stale on trunk, and had been since slice 6

The first run scored 13/16. The three failures all read `table null`, which looks like a walk that
stopped rendering port tables. It is not. Checking out `main` and running the same script scores
**13/16 there too**, so the branch is not the cause; widening the diagnostic to print the whole
response shows the walk working perfectly, forward and all:

```
"portTables":[{"kind":"nat","forwards":[{"publicPort":2222,…}]},{"kind":"filter","denies":[]}]
```

The script reads `portTable`. Slice 6 gave a device more than one table to render — a router now
answers with its NAT forwards AND its INPUT filter — and renamed the field to the plural without
updating slice 4's wire-check. Three checks had been silently asserting against a field that no
longer exists, and `?? null` turned every one of them into a plausible-looking failure rather than
a crash.

The repair is in the harness, not the product: `portTableIn` now names the kind it wants and finds
that table in the array, so an assertion about forwards cannot read whichever table happens to sit
first. All three expectations were already exactly right for the table they meant. Falsified by
making the walk render `forwards: []` unconditionally — check 1 goes red, and check 2, which
expects an empty table, correctly stays green.

**What this cost and what it buys.** Slice 6 merged with a wire-check it had quietly broken, and
nothing caught it for two slices, because the only thing that reads these scripts is a human
running them. `portTable` → `portTables` is exactly the rename that a `?? null` fallback absorbs
into a soft failure. The lesson is narrow and worth keeping: a wire-check that pulls a field off a
response by name has no compiler behind it, so a field rename is invisible until someone runs it —
and AC-12-style "re-run the neighbours unchanged" is what turns that from a discovery into a
routine.


### PR-ready when

AC-1…AC-11 and AC-13 pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full
non-watch test gate is green, the wire-check has RUN against a live stack and been falsified,
AC-12's two wire-checks are re-run unchanged, the mutation gate has run with survivors addressed
(above) and the three debts discharged, and the version is bumped to **v0.191.0** in both
`v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** its PR lands on `main`.

## Slice 8: a player's own agent answers somebody, and the filter stops lying to the world

**Value**: The arc closes on the player's own box. Every SNMP door so far has been pointed at a
device the world generated; this one makes a player's own machine answerable, which is what turns
slice 6's filter from a private convenience into something worth defending. `apt install snmp`
already plants `rules.v4` and nothing else, so an agent a player installs today answers nobody at
all — the attacker prize slice 6 named has never had a path to it. Here it gets one: B cracks the
community on A's own box and re-opens a port A closed.

And the same slice stops the filter advertising what it closes. `nmap <A's public IP>` still lists a
port A denied, because `scanResult` reads raw pidfiles at both vantages. A defence whose own scan
announces itself is worse than none: it tells an attacker exactly which port is worth a community.

**Path**: `apt install snmp` on A's box → the install names A's read-write community once → A
`nano`s `/etc/snmp/snmpd.conf` and `systemctl restart snmpd` to change it → A denies `6379` in
`rules.v4`, and their redis goes dark to the network → B `nmap <A's public IP>` no longer sees 6379
at all → B `hydra <A's box> snmp` cracks the community from their own wordlist → B
`snmpset <A's box> <rw> INPUT-MIB::inputPort.6379=permit` → A's redis answers the world again, and
A's `/var/log/snmpd.log` is the only trace.

**Class**: Behavior change.

**Delivery**: **RECOMMENDED — an intra-slice stack of two PR boundaries** on
`feat/d8-snmp-install`, rather than one PR. The two halves share a theme but not a mechanism: one
plants and rotates a config, the other changes what four scan paths read. Reviewing them together
means holding both in one head, and the second is a change to shared machinery that deserves its
own diff. Boundary 1 is the agent a player installs (AC-1…AC-9); boundary 2 is the scan honouring
the filter (AC-10…AC-13). The slice completes when boundary 2 lands. **CONFIRMED 2026-08-31** —
the stack is the agreed shape, and boundary 1 opens the moment its first commit lands.

### The three decisions this slice rests on

**The read-write community is SEEDED per box, and crackable.** Derived server-side from the
OWNER'S PUBKEY ALONE — not from a machine id, which nothing at install time carries: a package
file's `content` is handed `identity.publicKeyHex`, `hostname` and `fs.root()` and nothing else.
The pubkey is also the only key that WORKS here, and the own-box family already says so in three
places: `workstationGuestPassword`, `ownDatabase` and `ownStore` are each keyed that way expressly
so the server can reconstruct the secret for a cross-player crack without reading the owner's
filesystem. AC-3 and AC-8 need exactly that. Hashed into the root-only
`/var/lib/snmp/snmpd.conf`, and named once in the install's own output so the owner knows what they
are holding. It lands in the standard wordlist, which is the entire point: an agent
nobody can crack gives B no path, and slice 6's prize stays a promise. A player's own box now sits
in the same economy as every generated device — a second, independent way in that costs a wordlist
rather than a shell.

**Rotation is an administrative act on the box, never a move over the wire.** The owner writes
`rwcommunity <string>` into the world-readable `/etc/snmp/snmpd.conf`; `systemctl restart snmpd`
consumes that line, hashes it into the root-only file, and blanks the plaintext. Deliberately NOT
an OID: `snmpset` rotation would let anyone who cracked the community lock the real owner out of
their own box, which is precisely what `rwCommunity.ts` says the community must never become — "a
slower name for owning it already". A remote attacker gets port control and nothing else.

The window between the edit and the restart is a REAL leak and stays one. A visitor holding any
shell on the box can read the plaintext before the daemon consumes it, because that file is
world-readable by design. That is a mechanic, not a bug: it teaches that a secret typed into a
readable file is a secret until the moment you look, and it gives a player with a foothold
something to watch for.

**The scan fix rides here rather than in a slice of its own.** Both halves are about a defence a
player can actually raise, and shipping the agent without the scan fix would hand players a filter
whose own `nmap` still points at what it hides.

### The tension this slice creates, on purpose

To defend redis with the filter, A must leave the agent that can undo the filter answering. Close
`161` too and the box is dark to everyone — including the attacker — but A has also given up
remote administration of their own filter. There is no configuration that is both closed and
convenient, and the game should not offer one. Worth watching in play: if every player simply
denies `161`, the door is decoration and slice 9 needs to know that.

### Acceptance criteria — FOR CONFIRMATION, before any code

**Boundary 1 — the agent a player installs**

- [ ] **AC-1** `apt install snmp` plants BOTH configs beside the filter it already writes: the
      world-readable `/etc/snmp/snmpd.conf` at `SNMPD_CONF_SEED`, and the root-only
      `/var/lib/snmp/snmpd.conf` holding the hash of this box's own read-write community. Immediately
      after install, a walk with `public` renders the box's identity — an installed agent answers.
- [ ] **AC-2** The install NAMES the read-write community once in its own output, in the clear. It
      is never readable again from the box: the file holds only the hash.
- [ ] **AC-3** The community is seeded from the owner's pubkey, not rolled, and `hydra <A's box>
      snmp` recovers it from the standard wordlist exactly as it does against a generated device.
      The server reconstructs it for B's crack WITHOUT reading A's filesystem — the property the
      pubkey key exists for.
- [ ] **AC-4** A `nano`s `rwcommunity <new>` into `/etc/snmp/snmpd.conf` and runs
      `systemctl restart snmpd`. The OLD community is refused afterwards and the new one is accepted
      at the read-write tier.
- [ ] **AC-5** That restart CONSUMES the line: the plaintext is gone from the world-readable file
      afterwards, and the hash in the root-only file is the new community's.
- [ ] **AC-6** Before the restart, the plaintext IS readable by a non-root visitor on the box — the
      leak window is real and is pinned as behavior, so a later change cannot quietly close it
      without someone deciding to.
- [ ] **AC-7** A `rwcommunity` line that is blank, malformed, or duplicated degrades the way
      `rules.v4` and the read-only parser already do: the device answers LESS rather than erroring.
      A restart that consumed nothing leaves the previous community standing.
- [ ] **AC-8** **The observable this slice exists for.** A denies `6379` on their own box; B cracks
      A's community and `snmpset <A's box> <rw> INPUT-MIB::inputPort.6379=permit` re-opens it, and
      A's redis answers a neighbour again with nothing restarted.
- [ ] **AC-9** Every walk and set B makes appends to A's own `/var/log/snmpd.log` under the writer
      key that box's vantage dictates, carrying B's address — A's only evidence, as everywhere else
      in this arc.

**Boundary 2 — the scan stops lying**

- [ ] **AC-10** `nmap <A's public IP>` omits a port A denied in `rules.v4`. The box stays UP with
      its other ports listed; a filtered port is absent, never shown as closed.
- [ ] **AC-11** The same-LAN scan of a router's `.1` honours it identically. `scanResult` reads
      `portsOpenToNetwork` at BOTH vantages — both are somebody else's box seen from the network,
      which is the rule `portsOpenToNetwork`'s own doc already states.
- [ ] **AC-12** A forward whose TARGET has denied the internal port does not appear in the public
      scan, AND the reach refuses a connection to it — scan and door agree. Distinct from slice 7's
      exemption and not in conflict with it: slice 7 exempted the GATEWAY's filter over traffic it
      merely passes through, while the target is the box that TERMINATES the forwarded traffic, so
      its own INPUT filter governs it. A scan that hid a port the door still opened would be the
      exact inconsistency slice 7 closed, running the other way.
- [ ] **AC-13** The owner's own view is unmoved. `ps`, the owner's local scan, and `127.0.0.1`
      still reach a filtered service — the whole reason a filter beats `systemctl stop`.

**Both boundaries**

- [ ] **AC-14** A wire-check, `testSnmpInstall`, drives the real endpoints for the install, the
      rotation, the crack and the re-open. RUN against a live stack and FALSIFIED, per the standing
      rule that a check never seen red is not evidence.
- [ ] **AC-15** Slices 1–7 are unmoved: `testSnmpCrossPlayer` 15/15, `testSnmpSet` 16/16,
      `testSnmpDepth` 12/12 and `testSnmpFilter` 13/13 all re-run unchanged. The scan change touches
      shared machinery four paths read, so this is the criterion carrying the most risk in the slice.

### Naming — SETTLED 2026-08-31, before code

**`ownAgentCommunity(ownerKeyHex)`**, drawing through the existing `seedSnmpCommunity` primitive in
a namespace of its own: `own-agent-community-${ownerKeyHex}`. It is the read-write community of the
agent a player installed, derived from the owner's pubkey alone.

Two families could have claimed it, and they disagree. `seedApGatewayCommunity` is the nearest by
SUBJECT — also an SNMP community, also drawn from a namespace — but it belongs to the generated
world, keyed by ESSID or machine id. `workstationGuestPassword`, `ownDatabase` and `ownStore` are
the nearest by ROLE: a crackable credential on a PLAYER'S OWN box, keyed by the owner's pubkey so
the server can recover it cross-player. Role won. That family also deliberately drops the `seed`
prefix, so the name does too — `workstationGuestPassword`, not `seedWorkstationPassword`.

The namespace still goes through `seedSnmpCommunity`, which is what keeps the string drawn from the
community pool at `CRACK_CHANCE.community`. That is not cosmetic: it is the whole of AC-3, since a
community drawn from any other pool would not be in the shipped `passwords.txt` and B's `hydra`
would never land.

Rejected here so nobody re-proposes them: `seedOwnAgentCommunity` (would be the first own-box seed
to carry the prefix its own family drops) and `workstationCommunity` (names the BOX, but a
workstation holds this community only once `apt install snmp` has run, and it would drag an SNMP
concept into `workstationFs.ts`).

**What the install calls it to the player needed no coinage.** The game already says **"read-write
community"** in `snmpwalk`'s own hint and `snmpset`'s flag description, so the install reuses that
wording rather than minting a second phrase for one concept.

**Enforcement status: convention only.** This repository declares no glossary and runs no
vocabulary lint, so nothing mechanical will catch a drifted synonym later — this section is the
record.

### RED steps

1. The install plants both configs and the agent answers `public` (AC-1, AC-2).
2. The community is seeded and crackable — hydra against a player's own box (AC-3).
3. Rotation through `nano` + restart, including the consumed line and the leak window
   (AC-4, AC-5, AC-6, AC-7).
4. The observable: B re-opens a port A filtered, and A's log holds it (AC-8, AC-9).
5. `scanResult` honours the filter at both vantages (AC-10, AC-11, AC-13).
6. The forward target's own filter, scan and reach agreeing (AC-12).

### PR-ready when

Each boundary's criteria pass, `npm run typecheck` and `npm run lint` are clean from `v2/`, the full
non-watch test gate is green, `testSnmpInstall` has RUN live and been falsified, AC-15's four
wire-checks are re-run unchanged, the mutation gate has run once per boundary with survivors
addressed or classified, and the version is bumped in both `v2/package.json` and
`v2/package-lock.json` (`npm install --package-lock-only`).

**Slice complete when** boundary 2's PR lands on `main`.

## Pre-PR Quality Gate

1. Implementation complete; refactoring assessed
2. Mutation gate run once for the accumulated scope; survivors addressed
3. `npm run typecheck` (`tsc -b` — a plain `tsc --noEmit` is a NO-OP here) and `npm run lint` pass
4. DDD glossary check — `N/A`, this repository does not use DDD
5. Full non-watch test gate green
6. Evidence freshness — re-run the focused mutation check after any later fix

---
*Delete this file when D8 closes out, promoting durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7/§9 and the as-built summary
into the epic's "Next action", as D3–D7 each did.*
