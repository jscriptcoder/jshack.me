# Plan: D5b — NPC machines have a kind, and it shows

**Branch**: one per slice, `feat/d5b-<slice>`
**Status**: Active
**Grill record**: ["D5b — resolved scope & decisions"](legacy-parity-epic.md#d5b--resolved-scope--decisions-grill-me-2026-08-18) — ten locked decisions, not to be re-litigated here.
**Current version**: 0.153.0 (slice 1 shipped). Each slice is a feature change, so each bumps the minor in both `v2/package.json` and `v2/package-lock.json`.

## Goal

A generated LAN stops reading as a bag of interchangeable boxes and becomes a population a player
can read: `cam-31` is a camera, `web-04` publishes something, `db-11` is worth coming back to when
`mysql` ships.

## Acceptance Criteria

- [x] `nmap <subnet>` on a generated LAN returns hostnames that name what the boxes are — `cam-31`,
      `web-04`, `db-11` — rather than `iphone-40` and `desktop-7`, and the same ESSID returns the
      same population to every occupant on every reload.
- [x] Across a population, a webserver-named box answers on `:80` far more often than a phone-named
      one does, and a camera-named box offers `:22` far less often than today's flat rate — each
      measured over the 8×253 sample, not asserted on one host.
- [x] A LAN's roles read as a home network: personal devices and cameras are common, a mailserver
      or a database box is a find.
- [ ] `ls /etc` on a generated box as **guest** names what the box is for — `mysql.cnf` on a
      database box, `device.conf` on a camera — including on the roles whose door has not shipped.
- [ ] `curl http://<camera>` returns something a camera would serve, not the corporate-portal page.
- [ ] `hydra <camera> ssh` returns an account that belongs on a camera (`sensor`, `mqtt`), not
      `deploy`.
- [x] Every host's own address is unchanged by this work: NPC octets are byte-stable, so no
      occupant's issued lease can collide with an NPC that moved.
- [x] The player's own hostname is untouched, and `homeNetwork.test.ts`'s golden does not move.

## Constraints carried from grounding (do not rediscover these)

- **The octet layout must not move.** `api/network.ts:714` derives the lease allocator's excluded
  octet set from `generateHomeLan`, so a shifted octet would let an occupant be issued an address
  an NPC already holds — deleting that machine from every occupant's view and orphaning whatever
  was written to it. `prng.pick` consumes exactly one `next()` regardless of pool size, so
  **swapping a hostname pool for a role-keyed one of any length is draw-stable**; adding a draw to
  that same prng is not. Every new draw in this plan takes its **own seed stream**, which is the
  rule `pools/webPages.ts` already states: "appending to a shared PRNG sequence would re-roll every
  value picked after it".
- **Hostnames change, so NPC `machine_id`s change** (`hostMachineId` prefixes the hostname to its
  coordinate hash). That is locked decision 10 and is accepted. Its consequence for this plan:
  cross-player rows written against old ids stop resolving, and a wire-check that holds a
  machine_id across the rename will fail confusingly. Slice 1 re-runs the cross-player scripts
  **individually** — the suite is not sweep-safe.
- **`DEVICE_TYPES` keeps one meaning**: the name of a personal device. It stays exported from
  `homeNetwork.ts` for `assignHomeNetwork` (the player's own DHCP name, golden-locked) and is
  reused unchanged as the `workstation` role's prefix pool. It is not edited and not moved.
- **`routerFs` keeps its own builder.** Only its private `ROUTER_SSH_PROBABILITY` relocates.

## Reduction Program

`N/A — no reduction program.` Slice 2 relocates one constant (`ROUTER_SSH_PROBABILITY`) into the
shared placement table, collapsing two sources of truth for what a router runs into one. That is a
behavior-preserving move of a single value inside a behavior-changing slice, committed separately
from the feature work; it is not a mechanism-reduction program and this plan makes no net-reduction
claim for it. `reduce-system-complexity` is `N/A` throughout.

## A note on the domain term

`MachineRole` is not coined here. It is adopted verbatim from the legacy generator
(`src/generation/types.ts:19`), including its nine members, so `webserver`, `database`,
`fileserver`, `workstation`, `mailserver`, `iot`, `dns`, `router`, `switch` mean in v2 exactly what
they meant in the app this one replaces. No new domain vocabulary is invented by this plan.

## Slices

Every slice below is a **behavior change** and follows RED → GREEN → MUTATE → KILL MUTANTS →
REFACTOR. Each is one PR.

---

### Slice 1: A player scans a LAN and the boxes say what they are — ✔ COMPLETE (v0.153.0, #428)

**Value**: A player running `nmap <subnet>` reads a population instead of a list. This is the
walking skeleton — the role exists and shows before anything depends on it.
**Path**: `nmap <subnet>` → `generateHomeLan(essid)` → per-sibling role derivation → role-keyed
hostname prefix → the scan table the player reads. Deep layers take the same derivation behind
`generateDeepLayer`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` `N/A` (no mechanism retired).
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before any code):
- A generated LAN's machine hostnames carry role-appropriate prefixes, and the octet suffix is
  unchanged in form and value.
- The same ESSID yields the same roles and names on every call and for every viewer.
- Across the 8×253 population, personal devices and cameras are common while `database`,
  `mailserver` and `dns` are each rare — with the band chosen to exclude a uniform draw.
- Deep-layer hosts behind an inner gateway are named the same way, not left flat.
- Every generated octet on every sample ESSID is identical to the pre-change layout.

**RED**: A test over a generated LAN asserting a machine named for a role it was assigned — failing
today because every sibling name comes from `DEVICE_TYPES` regardless. Paired with the octet-
stability test, which must be written **before** the hostname change lands so it can prove the
invariant rather than bless whatever happens: capture the current octet lists for the population
ESSIDs, then assert they survive.

**GREEN**: A role module exporting `MachineRole` and `hostRole`, deriving on its own seed
namespace; a role-keyed prefix pool record with `workstation` bound to the existing `DEVICE_TYPES`;
the weighted draw kept **local to that module** rather than added to the `Prng` API, since one
caller does not earn a shared abstraction. `generateHomeLan` and `generateDeepLayer` swap
`prng.pick(DEVICE_TYPES)` for the role's pool — one `pick` per sibling, as before.

**MUTATE**: Stryker over the role module and the two generators. The mutants that matter: a
weighting inverted (rare becomes common), a role lookup that ignores its argument and returns a
constant, and an off-by-one in the weighted draw's cumulative comparison.

**KILL MUTANTS**: The population bands must be tight enough that a uniform draw fails them — the
`remoteHostFs.test.ts` pattern of naming the mutant each band excludes applies directly.

**REFACTOR**: Assess whether the two generators' now-identical naming step wants a shared helper,
or whether two call sites is too few to justify it.

**Done when**: acceptance criteria met; `generateHomeLan.test.ts`'s golden updated deliberately
(the NPC side is expected to move) and `homeNetwork.test.ts`'s golden untouched (the player side is
not); the octet-stability test passing; **and** the cross-player wire-checks that carry a
machine_id re-run live and individually — never back-to-back, since ESSID-seeded ids make the
scripts each other's stale rows.

**As built** — shipped v0.153.0 in #428.

- `core/generation/machineRole.ts` holds `DRAWN_ROLES` (the seven a machine is rolled for),
  `MachineRole` (those plus `router`/`switch`, which a host's `kind` already names), and
  `machineRole(seed, ip)` on its own `role-…` stream. The weights are expanded into a flat pool and
  drawn with the ordinary `pick`, rather than walked as cumulative thresholds — a threshold walk
  needs a past-the-last-threshold fallback that `next()`'s [0, 1) range makes unreachable, and so
  an unkillable mutant. Weights: workstation 32, iot 26, webserver 16, fileserver 12, database 7,
  mailserver 4, dns 3.
- `core/generation/pools/hostnames.ts` keys the prefix pools by role, binding `workstation` to the
  untouched `DEVICE_TYPES`. Both generators swap one `pick(DEVICE_TYPES)` for one
  `pick(HOSTNAME_PREFIXES[role])` — draw-for-draw identical, which is what holds the octets.
- The octet-stability test was written and proved **before** the rename: verified by inserting a
  `prng.next()` ahead of the switch draw and watching both it and the golden go red. It then passed
  untouched while only the golden moved.
- **The population sample is itself under test.** Stryker's first pass left five survivors, all in
  the `dns` pool: at 3% over 8 ESSIDs the pool was never drawn from, so blanking it changed nothing
  observable. Fixed by widening to a 60-ESSID naming sample **and** asserting the sample reaches
  every role — a later weighting change cannot silently stop covering one. Slices 2 and 5 add
  per-role behaviour to those same rare roles and inherit this trap.
- Evidence: 111 mutants / 0 survivors; 3013 tests across 154 files; typecheck and lint clean; eight
  cross-player wire-checks green individually against `vercel dev` + supabase.
- **Gotcha found and recorded in `v2/docs/conventions-and-gotchas.md` §6**: `testDeepChainReach`
  bricks a gateway in its final check and the row outlives the process, so the script poisons its
  own next run — and `supabase stop`/`start` round-trips through the docker volume, so the state
  survives that too. Re-running alone reproduces the RED identically and cannot distinguish it from
  a regression; `supabase db reset` is what settles it.

---

### Slice 2: What a box is called matches what it runs — ✔ COMPLETE (v0.154.0)

**Value**: A player who reads `web-04` off a scan and probes it is usually right. The name stops
being decoration and becomes a lead.
**Path**: `nmap <host>` / any door → `buildRemoteHostFs` → `hostServices` → role-aware placement →
the ports `/var/run` records and every downstream reader reports.
**Class**: Behavior change, with one behavior-preserving relocation committed separately.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A` — see the plan-level note; no net-reduction claim is made for the
constant move.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before any code):
- Across the population, a `webserver`-named host answers on `:80` markedly more often than a
  `workstation`-named one, and an `iot`-named host offers `:22` markedly less often than the flat
  rate does today.
- A `(role, service)` pair with no override generates at exactly today's flat rate — the existing
  population counts for an unweighted pairing are unchanged.
- A router still runs ssh on every generated gateway, exactly as before.

**RED**: A population test asserting the per-role rates above, failing today because placement
ignores the role entirely. A second test pins an un-overridden pairing to its current count, so the
default path is proved to still be the default rather than accidentally re-tuned.

**GREEN**: A sparse `Partial<Record<MachineRole, Partial<Record<ServiceName, number>>>>` consulted
by `hostServices` ahead of `spec.placement`. Then, as its **own commit**, `routerFs` reads the
router row's `ssh` override instead of its private `ROUTER_SSH_PROBABILITY`, with the constant
deleted — value preserved at 1, so the router population test written first stays green across the
move.

**MUTATE**: Stryker over `hostServices` and the override lookup. Mutants that matter: the override
ignored so the flat value always wins, the fallback dropped so an un-overridden pair generates
never or always, and the `>=` comparison flipped — the same flip `remoteHostFs.test.ts` already
brackets for the flat path.

**KILL MUTANTS**: Bands per role sized as slice 1's were, each naming the mutant it excludes.

**REFACTOR**: Assess whether `hostServices`'s roll now wants extracting from its `flatMap`.

**Done when**: acceptance criteria met; the un-overridden-pairing count unchanged; the router
population test green both before and after the constant's relocation; mutation report presented.

**As built** — shipped v0.154.0.

- `core/generation/rolePlacement.ts` holds `PLACEMENT_BY_ROLE` and `placementOf(role, spec)`. Every
  role carries a row, empty where it has nothing to say, so a role added later cannot inherit
  somebody else's placement and the lookup has no missing-row branch. Cells shipped: `iot`
  `{ ssh: 0.1 }`, `webserver` `{ http: 0.95 }`, `fileserver` `{ ftp: 0.9 }`, `database`
  `{ ftp: 0.6 }`, `router` `{ ssh: 1 }`.
- **The role is read BACK off the hostname** (`roleOfHostname` in `pools/hostnames.ts`), not
  re-derived from the coordinates. The plan assumed a lookup by seed; that would have been wrong
  for deep hosts, which are named from their fronting gateway's stream — invisible to anything
  downstream of `generateDeepLayer`. Proved by doing it: with the role re-derived from
  `machineRole(essid, ip)`, webserver-named deep hosts serve at 0.39 — the flat rate — and the
  deep-layer test goes red. Slice 1's "no two roles share a name" test became load-bearing here.
- Counts over the 8 x 253 sample: `www` http 1916 (flat 629), `cam` ssh 216 (flat 823), `nas` ftp
  1806 and `db` ftp 1169 (flat 556). An un-overridden pairing is unchanged to the host, which the
  whole existing suite proves incidentally — its synthetic `host-N` names match no role, so every
  count captured before this slice still holds.
- The override moves the THRESHOLD only, never the stream: a box that keeps a service lands on the
  port it always would have, and the ssh/http rolls captured before ftp existed did not move.
- **The router value shipped in the commit that reads it, not before.** The first mutation run left
  `router: { ssh: 1 }` -> `{}` alive because nothing consulted the row yet; the row went out empty
  and the value arrived with `routerFs`. `rolePlacement.ts` finished at 100% (13/13).
- Surviving mutants, all pre-existing and reported rather than fixed: `>=`/`<` boundary flips on
  continuous PRNG draws (equivalent — `next()` never lands exactly on a threshold), the
  `altPorts.length > 0` guard no catalog row exercises, and three on `seedApGatewayHasSsh` that are
  alive only because its rate is pinned at 1, which makes seed and comparison genuinely unable to
  matter. The last three survived identically against the old private constant.
- Two comment-only changes rode along: the catalog's `Slice 2 (generation):` field tags and
  `routerFs`'s `Story 5.1` tag are gone, and `placement` now says it is the rate for a box with
  nothing particular to say about the service. **103 such tags remain across 60 files** — a sweep
  of its own, not this slice's.
- No wire-checks: nothing in `api/` changed and no machine_id moved. Slice 1 remains the only slice
  in this plan that needs them.

---

### Slice 3: A box admits what it is when you read it

**Value**: The three roles whose door has not shipped stop being empty promises. A player standing
on a box at the lowest tier can tell what it is for.
**Path**: `ssh`/`nc`/`ftp` onto a generated host → `ls /etc` or `cat` as **guest** → the role's
config file.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before any code):
- Every generated machine carries exactly one role config file in `/etc`, named for its role.
- A **guest** can read it — unlike `/etc/passwd`, which guest must not read.
- A database box carries `mysql.cnf` before any `mysqld` exists to run, and a camera carries
  `device.conf`.
- Routers and switches are unchanged: `routerFs` already lays down its own config, and this slice
  does not touch that builder.

**RED**: A test reading the role config file from a generated box's `/etc` as guest — failing
today because `/etc` holds only `passwd`. A companion test asserts guest **can** read it while
`/etc/passwd` stays unreadable to guest, so the new permission constant is not quietly wider than
intended.

**GREEN**: A per-role config filename map (legacy's `serviceConfigNames`, `machineConfig.ts:160`),
a `SERVICE_CONFIG_FILE` permission constant in `baseFs.ts` — world-readable, root-write, never
executable, mirroring `WEB_PAGE_FILE`'s reasoning — and a second entry in the `/etc` dir.

**MUTATE**: Stryker over the config-file construction and the permission constant. Mutants that
matter: guest removed from or root removed from the read list, the role lookup returning a fixed
name, and the file omitted for one role.

**KILL MUTANTS**: The guest-readable assertion is what kills the permission mutants; assert on the
whole permission value, not on one list.

**REFACTOR**: Assess whether `/etc` construction in `buildRemoteHostFs` now wants its own function.

**Done when**: acceptance criteria met; the tier boundary proved in both directions (config
readable by guest, `passwd` still not); mutation report presented.

---

### Slice 4: The page a box serves fits the box

**Value**: A camera stops serving an internal corporate portal. The contradiction slice 1 created
by naming boxes is closed.
**Path**: `curl http://<host>` → `buildRemoteHostFs`'s `/var/www/html/index.html` → `pickWebPage`
→ the role's bucket.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before any code):
- A camera-role host that serves the web returns a page that reads as a camera's.
- A role with no bucket authored returns a page from the general-server bucket — today's four
  pages, unchanged.
- No page links a path its host does not serve; the existing property test covers the new buckets
  as well as the old.

**RED**: A test fetching the page from a generated `iot` host and asserting it is not drawn from
the general bucket — failing today because `pickWebPage` has one pool.

**GREEN**: `pickWebPage` grows its `role` argument as its docstring promised; `WEB_PAGES` becomes
the general-server bucket; an `iot` bucket is authored. The seed stays the caller's own composed
stream — unchanged.

**MUTATE**: Stryker over `pickWebPage`. Mutants that matter: the role argument ignored, the
fallback returning empty rather than the general bucket, and the hostname interpolation dropped.

**KILL MUTANTS**: Assert on page content, not on which bucket was consulted.

**REFACTOR**: Assess bucket organisation only if a second bucket lands in this slice.

**Done when**: acceptance criteria met; the no-dead-links property test passing over every bucket;
mutation report presented.

---

### Slice 5: The account you crack fits the box

**Value**: The name a player types at `su`, and the one `hydra` hands back, belongs to the box it
came from.
**Path**: `hydra <host> ssh` / `ssh` / `su` → `/etc/passwd` on the generated host → the role's
account pool.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before any code):
- A camera-role host's uid-1000 account is drawn from a camera's names, a mailserver's from a
  mail's.
- The crack curve's **shape** is unchanged: the proportion of NPC user accounts that are crackable
  is what it was, because `CRACK_CHANCE` is untouched — only which specific boxes fall moves.
- Root, guest, uids, gids, home paths and shells are untouched.

**RED**: A test asserting a generated `iot` host's non-root account comes from the iot pool —
failing today because the pool is one flat list of eight.

**GREEN**: A role-keyed account pool record replacing `HOST_USERNAMES` at its single draw site.
**Recorded, not discovered:** the username is drawn from the host-fs prng immediately before the
password, so this re-rolls every NPC password in the world. That is free under the
no-backward-compat licence and is locked decision 9's accepted cost. Preserving the old draw order
with a dummy pick was considered and rejected as a hack that buys nothing before launch.

**MUTATE**: Stryker over the account draw. Mutants that matter: the role ignored so one pool always
wins, and a pool swapped between roles.

**KILL MUTANTS**: Assert the drawn name is a member of the role's pool **and** not a member of
another role's, so a swapped-pool mutant cannot survive on overlap.

**REFACTOR**: Assess whether the role-keyed pools across slices 1, 3, 4 and 5 now want one home.
This is the first point at which four role-keyed records exist and the question can be answered
from evidence rather than anticipated.

**Done when**: acceptance criteria met; the crackable-proportion population test unchanged;
mutation report presented.

---

## Pre-PR Quality Gate

Before each PR, from `v2/`:

1. **Mutation** — `mutation-testing` over the slice's changed files; survivors addressed or their
   value put to the human.
2. **Refactoring assessment** — `refactoring`; `reduce-system-complexity` is `N/A` for every slice
   in this plan.
3. **Typecheck and lint** — `npm run typecheck` (`tsc -b`; a plain `tsc --noEmit` is a no-op here)
   and `npm run lint`.
4. **Full suite** green.
5. **Version bumped** in `v2/package.json` and `v2/package-lock.json`
   (`npm install --package-lock-only`).
6. **Slice 1 only** — cross-player wire-checks re-run live and **individually** against
   `vercel dev` + supabase, because the machine_id rename is exactly the condition that produces a
   confusing RED, and the suite is not sweep-safe.

There is no DDD glossary in this repo; the term check is satisfied by adopting legacy's
`MachineRole` verbatim rather than coining anything.

## Open for planning within slices (from the grill, deliberately undecided)

- ~~The seven weights~~ — **settled in slice 1**: 32/26/16/12/7/4/3. `dns` kept its place at 3
  even with no `nslookup` to run against it, on the reading that a role a player meets rarely is
  worth having named when they do.
- ~~Which override cells get values now~~ — **settled in slice 2**: `iot { ssh: 0.1 }`,
  `webserver { http: 0.95 }`, `fileserver { ftp: 0.9 }`, `database { ftp: 0.6 }`, `router
  { ssh: 1 }`. `fileserver` and `database` took the ftp signature now rather than waiting for
  their own door — a dump has to leave the box somehow, and ftp is the only door either can
  express today. `workstation`, `mailserver` and `dns` stay flat: a cell invented before its
  door ships is a number with no claim behind it.
- Prefix pool depth per role, before repeats inside one LAN start to read as generated. Slice 1
  shipped 4–7 names per role and `DEVICE_TYPES` for `workstation`; repeats within one LAN are
  visible on the larger networks and may want revisiting once placement makes names load-bearing.
- Which roles earn a web bucket beyond `iot`.
- Config file contents — a stub header naming the role, or something with recon value.
- ~~The deep-layer role seed's composition~~ — **settled in slice 1**: `${essid}-${parentMachineId}`,
  so a deep host's role varies by which gateway fronts it rather than by address alone.

---
*Delete this file when the plan is complete, and fold the as-built into
`v2/docs/conventions-and-gotchas.md` plus the D5b row of `legacy-parity-epic.md`.*
