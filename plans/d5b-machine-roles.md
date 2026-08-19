# Plan: D5b — NPC machines have a kind, and it shows

**Branch**: one per slice, `feat/d5b-<slice>`
**Status**: Active
**Grill record**: ["D5b — resolved scope & decisions"](legacy-parity-epic.md#d5b--resolved-scope--decisions-grill-me-2026-08-18) — ten locked decisions, not to be re-litigated here.
**Current version**: 0.156.0 (slices 1–4 shipped). Each slice is a feature change, so each bumps the minor in both `v2/package.json` and `v2/package-lock.json`.

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
- [x] `ls /etc` on a generated box as **guest** names what the box is for — `mysql.cnf` on a
      database box, `device.conf` on a camera — including on the roles whose door has not shipped.
- [x] `curl http://<camera>` returns something a camera would serve, not the corporate-portal page.
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

### Slice 2: What a box is called matches what it runs — ✔ COMPLETE (v0.154.0, #429)

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

### Slice 3: A box admits what it is when you read it — ✔ COMPLETE (v0.155.0)

**Value**: The three roles whose door has not shipped stop being empty promises. A player standing
on a box at the lowest tier can tell what it is for — and reads something the hostname did not
already tell them.
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
- **The contents are a real config, not a label.** A database box's file names its data directory
  and bind address; a webserver's names its document root and listen port; a fileserver's names
  its share path. The box's own hostname and the port its signature service is on are interpolated,
  so the file is about THIS box and reading it is worth doing.
- **The file follows the ROLE, not the service.** A `db-11` carries `mysql.cnf` with nothing
  listening, and a `www-04` that failed its http roll still carries `httpd.conf` — unlike
  `/var/log/vsftpd.log`, which follows its daemon. A config states what a box is configured to be;
  a log claims something happened. Only the second is a lie on a box that never ran it.
- A host whose name matches no role carries no config file — the same flat fallback `placementOf`
  takes, and what leaves the existing synthetic-`host-N` suite untouched.
- Nothing already generated moves: the template draw takes its **own seed stream**, as
  `pickWebPage` and `hostBackdoor` do, so every NPC account and password stays where it is.
- Routers and switches are unchanged: `routerFs` already lays down its own config, and this slice
  does not touch that builder.

**RED**: A test reading the role config file from a generated box's `/etc` as guest — failing
today because `/etc` holds only `passwd`. A companion test asserts guest **can** read it while
`/etc/passwd` stays unreadable to guest, so the new permission constant is not quietly wider than
intended. A third asserts the content is this box's: the hostname it was built for appears in the
file, which no fixed stub could satisfy.

**GREEN**: A per-role config filename map (legacy's `serviceConfigNames`,
`machineConfig.ts:160`, adopted verbatim) and role-keyed template pools in
`pools/configFiles.ts` beside `pools/webPages.ts`, carried over from legacy's
`configTemplatesByRole` (`pools/filesystem.ts:88`) rather than authored fresh; a
`SERVICE_CONFIG_FILE` permission constant in `baseFs.ts` — world-readable, root-write, never
executable, mirroring `WEB_PAGE_FILE`'s reasoning — and a second entry in the `/etc` dir.

**Deliberate deviation from legacy, decided at planning**: legacy's templates interpolate
`{{user}}` — the box's uid-1000 account name. v2's do not. `/etc/passwd` is guest-unreadable on
purpose because account names and inline hashes are what a player is meant to earn, and a
guest-readable file that names the account hands back half of that for free. Hostname and port
only. Slice 5 is where account names get their attention.

**MUTATE**: Stryker over the config-file construction, the template fill, and the permission
constant. Mutants that matter: guest removed from or root removed from the read list, the role
lookup returning a fixed name, the file omitted for one role, and the interpolation dropped so
every box of a role reads identically.

**KILL MUTANTS**: The guest-readable assertion is what kills the permission mutants; assert on the
whole permission value, not on one list. Slice 1's rare-role trap does **not** recur here — a role
is reached by NAMING a host (`namedHost('db', 11)`, slice 2's helper) rather than by sampling a
population, so `dns` and `mailserver` are as reachable as `workstation`. Assert each role's file
by name, and that no pool is empty.

**REFACTOR**: Assess whether `/etc` construction in `buildRemoteHostFs` now wants its own function.

**Done when**: acceptance criteria met; the tier boundary proved in both directions (config
readable by guest, `passwd` still not); the existing suite green untouched, which is the evidence
that no draw moved; mutation report presented.

**As built** — shipped v0.155.0.

- `core/generation/pools/configFiles.ts` holds `CONFIG_BY_ROLE` — a filename, five templates, and
  for two roles a catalog service — plus `roleConfigFile({ role, hostname, seed, ports })`. The
  filenames are legacy's `serviceConfigNames` verbatim; the templates are adapted from its
  `configTemplatesByRole`, not copied.
- **The port is read off the box for the roles whose daemon the world ships** (`webserver` → http,
  `fileserver` → ftp), falling back to the catalog default where the box is not running it. So
  `www-4` answering on 8000 keeps a config stating 8000, and `nas-88` on 2121 states 2121: the file
  and a scan cannot disagree. Every other role bakes the conventional port as a literal — a
  `mysql.cnf` says 3306 because nothing can contradict it until D6 puts a `mysqld` there to be
  scanned, at which point the row grows a `service` and the interpolation arrives with it.
- **Every template stays in its role's own idiom.** Legacy filed postgres configs under `mysql.cnf`
  and samba under `vsftpd.conf`; carried over, those would have contradicted D6 the moment mysql
  shipped. No template bakes 8080 or 8000 either, so the alt-port test cannot pass by accident.
- `SERVICE_CONFIG_FILE` in `baseFs.ts` mirrors `WEB_PAGE_FILE` — world-read, root-write, never
  executable — and sits beside `PASSWD_FILE` as the deliberate contrast: passwd guards the account
  names and inline hashes a player earns, and this file names neither.
- The role is read back off the hostname, as slice 2's placement is, and a name no role claims keeps
  no config. That fallback is why the whole pre-existing suite, whose hosts are synthetic `host-N`,
  is untouched by this slice.
- **Mutation caught slice 1's trap wearing a new costume.** The first run scored 93.41% with six
  survivors: five templates that could be blanked to `""` unnoticed — four of them `dns` — and the
  seed, which could be blanked because nothing compared two boxes. The tests read two octets per
  role, so three of every five pool entries had never been drawn. Not rare *roles* this time but
  unreached *entries inside* a role's pool. Fixed by asserting over a LAN's worth of addresses per
  role — every config names the host it sits on and leaves no placeholder unfilled — plus a second
  test that two boxes of one role do not keep byte-identical files. 91/91 after, timeouts 15 → 0,
  runtime 8 min → 3 min. **Any per-box pool added by a later slice inherits this: assert it over the
  population, or the entries a player meets are the ones no test has read.**
- Refactor assessed, nothing changed: `/etc` is six lines with one conditional spread, so extracting
  it would add a name and a hop without removing a branch, and `roleOfHostname`'s second call per
  box is a map lookup that would cost `hostServices` a wider signature to avoid.
- Evidence: 3025 tests across 154 files; typecheck and lint clean. No wire-checks — nothing in
  `api/` changed and no machine_id moved.

---

### Slice 4: The page a box serves fits the box — ✔ COMPLETE (v0.156.0)

**Value**: A camera stops serving an internal corporate portal, and so does somebody's laptop. The
contradiction slice 1 created by naming boxes is closed for half of every page the world serves.
**Path**: `curl http://<host>` → `buildRemoteHostFs`'s `/var/www/html/index.html` → `pickWebPage`
→ the role's bucket.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Which roles earn a bucket — settled by measurement, not by guess.** Over 40 generated LANs, the
84 boxes serving `:80` break down as: `webserver` 29.8%, `workstation` 27.4%, `iot` 23.8%,
`fileserver` 10.7%, `database` 4.8%, `dns` + `mailserver` 3.6%. The planning sketch assumed `iot`
was the contradiction to fix; it is under a quarter of it. **A personal machine serves more pages
than a camera does** — there are more than twice as many workstations, and the flat 0.3 http rate
applies to both — so `laptop-7` returning "Internal corporate portal v3.1.0" is the same lie a
player meets slightly more often. Two buckets ship: `iot` and `workstation`, together 51% of served
pages. What is left on the general bucket is mostly `webserver` (29.8%), which is what those four
pages already read as. `database` and `fileserver` are deferred: between them 15%, and both already
say what they are through the `/etc` config slice 3 gave them.

**Acceptance criteria** (present and confirm before any code):
- A camera-role host that serves the web returns a page that reads as a camera's, and a
  workstation-role one returns a page that reads as somebody's own machine — neither returns the
  corporate portal.
- A role with no bucket authored — `webserver`, `fileserver`, `database`, `mailserver`, `dns` — and
  a host whose name claims no role both return today's four general-server pages, **byte-identical**
  to what they return now. `pick` consumes one `next()` whatever the pool's length, so swapping in a
  role-keyed pool is draw-stable, exactly as slice 1's hostname pools were.
- Every new page holds to the properties the four existing ones already hold to: it names the host
  serving it, it links no path its host does not serve, and it leaks recon that promises nothing —
  a version and a careless comment, the two things `curl` shows that a browser will not.
- Every entry of every bucket is reachable across the population. Slice 3's trap, carried forward: a
  page a player can meet that no test has ever read is a page that can be blanked unnoticed.

**RED**: A test fetching the page from a generated `iot` host and from a `workstation` one,
asserting each reads as its kind — failing today because `pickWebPage` has one pool and both get the
corporate portal. Paired with a byte-stability test for the general bucket, written **before** the
change so it proves the invariant rather than blessing whatever happens.

**GREEN**: `pickWebPage` grows its `role` argument as its docstring promised, typed
`DrawnRole | undefined` to match what `roleOfHostname` returns and what `placementOf` already takes.
`WEB_PAGES` becomes the general-server bucket; `iot` and `workstation` buckets are authored beside
it in a `Partial<Record<DrawnRole, readonly string[]>>` — sparse on purpose here, unlike
`rolePlacement`'s full record, because an absent row means "nothing particular to serve" and the
general bucket is the right answer for it. The seed stays the caller's own composed stream,
unchanged. `renderPage.test.ts`'s call site takes the new argument.

**MUTATE**: Stryker over `pickWebPage`. Mutants that matter: the role argument ignored, the fallback
returning empty rather than the general bucket, the hostname interpolation dropped, and any single
page blanked.

**KILL MUTANTS**: Assert on page content, not on which bucket was consulted. Bucket entries are
proved reachable over the population sweep, as slice 3's templates are.

**REFACTOR**: Assess bucket organisation now that a second bucket exists — and whether the four
role-keyed pools this epic has accumulated (hostnames, placement, configs, pages) want one home, or
whether that question belongs to slice 5, where the fifth lands.

**Done when**: acceptance criteria met; the general bucket's pages proved byte-identical; the
no-dead-links property test passing over every bucket; mutation report presented.

**As built** — shipped v0.156.0.

- `pickWebPage` takes `role: DrawnRole | undefined`, the type `roleOfHostname` returns and
  `placementOf` already accepts. `WEB_PAGES` became `GENERAL_SERVER_PAGES`; `IOT_PAGES` and
  `WORKSTATION_PAGES` sit beside it, four entries each, and `PAGES_BY_ROLE` is a
  **`ReadonlyMap<DrawnRole | undefined, readonly string[]>`** — keyed by a role OR by the absence of
  one, so the lookup is total and the function is one expression:
  `pick(PAGES_BY_ROLE.get(role) ?? GENERAL_SERVER_PAGES)`.
- **That Map shape came out of the mutation run.** The first pass left one survivor — the
  `role === undefined ? undefined : PAGES_BY_ROLE[role]` guard, which is equivalent, since indexing
  an object with `undefined` yields `undefined` at runtime and the guard existed only to satisfy the
  type. Removing the branch was better code on its own merits and took the score to 22/22.
- **Byte stability was proved two ways, not asserted once.** At every address where a `www-`, `db-`,
  `mail-`, `nas-` or `dns-` box and a nameless box both serve, the page is identical — and an md5
  golden pins the four general templates, captured before the buckets existed so it blesses nothing
  this slice did.
- **A preservation test failed for the wrong reason first, and that was worth catching.** It
  compared `www-N` against `host-N` at every address; `webserver` publishes at 0.95 where a nameless
  box rolls 0.3, so most comparisons had a page on one side only. Corrected to compare where both
  serve, with a guard that more than 50 addresses qualify — WHICH hosts serve is the placement
  table's business, not this slice's.
- Every entry of every bucket is proved reachable across the population, the width pinned at 4 as
  the general pool's already was. Slice 3's lesson applied without being relearned.
- Authoring rule made explicit in the module docstring: **no page hints at a mechanic the game does
  not have.** "Default password unchanged" would send a player after something that does not exist —
  the same sin as linking a path the host cannot serve.
- Refactor assessed, nothing merged: the four role-keyed tables this epic has accumulated
  (`HOSTNAME_PREFIXES`, `PLACEMENT_BY_ROLE`, `CONFIG_BY_ROLE`, `PAGES_BY_ROLE`) are keyed alike but
  are not the same knowledge — adding a hostname prefix implies nothing about pages, and they change
  for different reasons. One home would be a table every generation module depends on, with each
  cell typed separately anyway. Slice 5 lands the fifth and may revisit.
- Evidence: 3030 tests across 154 files; typecheck and lint clean; mutation 22/22 on
  `pools/webPages.ts`. No wire-checks — nothing in `api/` changed.
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
- ~~Which roles earn a web bucket beyond `iot`~~ — **settled at slice 4 planning**: `iot` AND
  `workstation`, chosen by measuring 40 generated LANs rather than by intuition. A personal machine
  turns out to serve more pages than a camera does (27.4% of served pages against 23.8%), so fixing
  only the camera would have left the larger half of the same lie standing. `database` and
  `fileserver` deferred — 15% between them, and slice 3's config file already speaks for both.
- ~~Config file contents~~ — **settled at slice 3 planning**: a real config with recon value,
  carried over from legacy's `configTemplatesByRole` rather than a stub header naming the role. A
  file whose only content is "this is a camera" says nothing the hostname did not. `{{user}}` is
  dropped from legacy's fill set — see the deviation note in slice 3.
- ~~The deep-layer role seed's composition~~ — **settled in slice 1**: `${essid}-${parentMachineId}`,
  so a deep host's role varies by which gateway fronts it rather than by address alone.

---
*Delete this file when the plan is complete, and fold the as-built into
`v2/docs/conventions-and-gotchas.md` plus the D5b row of `legacy-parity-epic.md`.*
