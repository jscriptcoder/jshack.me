# Plan: D8 — `snmpwalk` / `snmpset`

**Branch**: `feat/d8-snmp-walk` (slice 2)
**Status**: Active — slice 1 MERGED (#465, v0.185.0, 2026-08-27); slice 2 next,
not yet planned; slices 3–7 outlined only
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
| 2 | a player walks it with `public` | identity OIDs return; the walk lands in `snmpd.log` | outlined |
| 3 | a player cracks the RW community | `hydra <host> snmp` → the port table renders | outlined |
| 4 | a player opens a port, no shell | `snmpset` adds a forward; `nmap` shows it | outlined |
| 5 | a device on a deep layer answers | the inner-gateway vantage | outlined |
| 6 | a player runs their own agent | owner filters a port; `127.0.0.1` still works | outlined |
| 7 | a player reconfigures another's | B opens a forward into A's LAN | outlined |

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

## Slices 2–7 (outline only — plan each when its predecessor lands)

- **Slice 2** — `snmpwalk <host> [community]`, the RO tier, identity OIDs in the format decision 5
  fixes, and `formatArrival` on `snmpd.log`. First slice with a command.
- **Slice 3** — the RW community as an md5 in root-only `/var/lib/snmp/snmpd.conf`, `secretOn`,
  `CRACK_CHANCE.community` at 0.6, `hydra <host> snmp` with no login field, and the RW walk
  rendering the port table. **Owes a wire-check.**
- **Slice 4** — `snmpset`, parity with `nano`, LAN-bounded forwards, overwrite reporting
  `old → new`, no session row. **Owes a wire-check.**
- **Slice 5** — the inner-gateway vantage. Budget for EVIDENCE, not plumbing: `reachServiceHost`
  takes the daemon as a parameter, and D7 spent two slices proving paths that already worked.
  Expect RED to come from mutating production. **Open**: how `snmpwalk` addresses a forwarded inner
  gateway — D7 used `redis-cli -p <fwd> <gw>`, real `snmpwalk` takes `host:port`, and the choice
  binds `snmpset` too.
- **Slice 6** — `apt install snmp` ships `snmpd`; `iptables/rules.v4` gains the `deny <port>` rule
  kind; the local filter blocks remote traffic but never localhost. **Open**: whether an installed
  agent is scannable from off-box, since placement covers generation only.
- **Slice 7** — the cross-player set against another player's AP gateway. `targetWriterKey` already
  gives the one-row guarantee. **Owes a wire-check.**

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
