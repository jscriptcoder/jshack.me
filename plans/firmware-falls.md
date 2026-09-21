# Plan: Phase 3 Slice 9 — Firmware Falls

**Epic:** `plans/legacy-parity-epic.md` — Phase 3 (the "V" series), slice 9. Grill record: the
epic's `### Slice 9 — resolved decisions (grilling, 2026-09-21)` section, decisions 81–90
(**89 supersedes 82's ordering**; **81 takes up slice 1a's `<vendor>-firmware` escape hatch**).
Prior slice close-out: "Phase 3 slice 8 — libraries fall" (#519–#527, v0.235.0–v0.243.0).
**This is the last V-series axis; it closes V4 and the phase.**

**Status:** Active — PR1 (#528, v0.244.0), PR2 (#529, v0.245.0) and PR3 (#531, v0.246.0) merged. PR4 next.

**Delivery:** Four independent PRs, sequenced to trunk (NOT a stack), per the convention slices
1–8 used. Each merges to `main`; the next branches from updated `main`. **PR1 and PR2 are
independent of each other and may land in either order.** PR3 needs both — PR1 for the timeline
firmware derives from, PR2 for the floor its `medium`/`low` rolls land on. PR4 needs PR1 only.
Versions 0.244.0 → 0.247.0, bumped in both `v2/package.json` and `v2/package-lock.json` per PR.

**Branches (proposed):** PR1 `feat/firmware-is-a-package`, PR2 `feat/exploit-tier-is-a-floor`,
PR3 `feat/firmware-opens-the-door`, PR4 `feat/snmpwalk-names-the-firmware`.

---

## Goal

Make a router's firmware the third CVE axis: a gateway, switch or AP whose every service scans
clean still falls to `msfconsole <host> <port>`, because the image it runs has an unpatched hole.
`apt list -u` on the device is the defender's view and `apt upgrade` is the whole defence;
`snmpwalk` is the recon that names what the device runs before a shot is fired.

## Scope boundary

The firmware axis and its defender view, its recon and the one correction it cannot ship without.
Firmware *vendors*, *templates* and the per-box vendor pick already shipped with slice 1a —
`FIRMWARE_TEMPLATES`, `FIRMWARE_VENDORS` and `pickFirmwareVendor` exist and are stamped onto every
router-class box today; they are simply wired to nothing. The eight effect **handlers** are slice
5's and are reused, not rebuilt. The library axis (slice 8) is untouched: `--local` is not a
firmware route and firmware does not link libraries.

**Not built, deliberately:** a reboot-to-flash mechanic (decision 90 — belongs to its own slice
covering all packages); firmware in `nmap -sV` (decision 27 — a router's image answers to no
port); a CVE in the SNMP walk (decision 88); per-vendor effect pools (decision 86).

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 4 / 24 | Every NPC box is frozen at `startTuple` and never patches. This is what makes decision 89 necessary rather than decorative — see PR3. |
| 9 | Severity → tier. Decision 83 reuses the **library** floor (`critical`/`high` → root, `medium`/`low` → user), not `exploitEffect.ts`'s service floor. |
| 10 | Three axes; firmware is the third, and routers, switches AND the shared AP gateway are all in. A fully patched gateway can still fall. |
| 25 | One axis-blind `liveCve(key, version, gameDay)`. Firmware attaches per-axis **interpretation**; it does not grow a second derivation. `key` is the firmware package. |
| 26 | The CVE serial is a stable package number plus a scrambled index. The six vendors already hold reserved `cveNumber` 16–21 — no renumbering. |
| 27 | Firmware never appears in a port table. Unchanged by this slice. |
| 32 | `formatExploit` is required on all seven catalog rows. Firmware never gets a row (decision 87), so the rule is untouched. |
| 64 | Highest-severity-wins with a fixed tie-break. Decision 89 reuses this rule verbatim for the service-vs-firmware contest. |

## Resolved decisions

All ten (81–90) live in the epic's `### Slice 9 — resolved decisions` section and are not restated
here. The mapping from decision to PR is each slice's **Decisions** line below.

---

## Slices

All four are **behavior change** — fast RED-GREEN-REFACTOR increments, with the
mutation-or-alternate gate run once per PR at PR readiness. PR2, PR3 and PR4 change what a server
handler authorizes or renders and therefore each carry a `scripts/test*.ts` wire-check against
`vercel dev` + supabase (the epic's routine-evidence line). PR1 is pure `src/core` and proves
itself at the unit layer.

**Required implementation skills:** `tdd`, `testing` and `functional` throughout; `refactoring`
where a PR also tidies already-tested code; `mutation-testing` at each PR boundary's readiness.

---

### PR1 — A router's firmware is a package like any other

**Value**: A player standing on a gateway they hold sees its firmware in `apt list -u` with the
CVE that is open on it, and closes it with `apt upgrade`. The defender's half of the axis, shipped
before anything can attack it — the same shape slices 1 and 2 used.
**Path**: `apt list -u` / `apt upgrade` / `apt install <pkg>=<version>` → `parseDpkgVersions` →
`upgradeStatusFor` + `liveCve` → the manifest the box carries.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk.
**Decisions**: 81, plus the free downgrade consequence recorded in the routine list.

**Acceptance criteria**
- [x] A generated router, switch, inner gateway, deep gateway and AP gateway each record
      `<vendor>-firmware` in `/var/lib/dpkg/status` at that vendor's start tuple; a workstation and
      an NPC host record no firmware row at all.
- [x] `apt list -u` on a box holding firmware lists its row once the hole has landed, in the same
      `<pkg> <version> [<cve> <severity> · upgradable → <target>]` shape every other package uses,
      and the `no fix yet — ETA ~N days` form inside the patch delay.
- [x] `apt upgrade` moves the firmware version forward and the row clears.
- [x] `apt install <vendor>-firmware=<earlier release>` downgrades it; the same command on a box
      carrying no firmware refuses with the existing not-installed error.
- [x] `apt list` (the catalog) names no firmware package on any box.
- [x] `nmap -sV` output is byte-identical to today on every box, router-class included.

**RED**: `apt list -u` on a generated AP gateway at a game day past the vendor's first publication
asserts the firmware row; fails today because `packageTimeline('firmware', …)` returns `[]` and
`exposureOf` filters the row out.
**GREEN**: re-key `FIRMWARE_TEMPLATES` by package name, add `firmwarePackageOf(vendor)` and
`isFirmwarePackage(key)`, give `packageTimeline` and `displayVersion` a lookup that consults both
tables while `PACKAGE_TEMPLATES` (the apt catalog) keeps only services and libraries, and stamp
`firmwarePackageOf(vendor)` in `installedPackages`.
**REFACTOR**: assess whether `startingVersionOf` / `startingFirmwareVersionOf` collapse once both
tables are reachable through one lookup.
**PRE-PR MUTATION**: run once over `packageVersions.ts` + `packageManifest.ts` via the repo's
throwaway-config recipe. Expect survivors on the vendor rows — the same untested-table shape slice
8's gate found on the seventeen legacy `libraryDeps` rows.
**PR-ready when**: criteria met, gates green, commit approved.

> Corrects two recorded rationales: `apt.test.ts`'s *"a router's owner does not upgrade its
> firmware through apt"* and `packageTimeline.test.ts`'s *"there is no shelf to take a release
> off"*. Both tests should assert against the six vendor keys rather than the retired `'firmware'`
> string. `packageTimeline.ts`'s `no-timeline` doc, which names a router's firmware as its example,
> needs a new example.

> **As built (#528):** firmware joined the one `PACKAGE_TEMPLATES` table instead of a second
> lookup — that table was never the `apt list` catalog (the catalog is built from
> `APT_PACKAGES` + `BASE_IMAGE_PACKAGES`), so the split decision 81 asks for already existed.
> `startingFirmwareVersionOf` and `FIRMWARE_PACKAGE` are retired and `isFirmwarePackage` was
> never needed, which answers the REFACTOR question: the two start lookups collapsed into one.
> Mutation 87 killed / 29 survived; the firmware display-prefix survivors are left for PR4's
> `sysDescr` tests to pin.

---

### PR2 — An exploit lands on the lowest account at or above its tier

**Value**: A player exploiting a router gets the shell the CVE earned instead of a silent refusal.
Repairs a live gap: router-class boxes carry only root, so against the 10/50/30/10 severity roll
and the service floor, **roughly 90% of a router's live service CVEs refuse today** and read
exactly like "not vulnerable".
**Path**: `msfconsole <host> <port>` → `handleExploitCreateSession` → the account resolver → the
effect branches; and the two local paths through `msfconsole --local`.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk. Independent of PR1 — may land before it.
**Decisions**: 84, and 85's uniformity falls out of it.

**Acceptance criteria**
- [x] On a box carrying all three tiers, a `user`-tier outcome still lands on the `user` account —
      today's behaviour, unchanged.
- [x] On a root-only router, a `user`-tier outcome lands on **root**: an exploit that refuses today
      opens a shell.
- [x] A box holding nobody at or above the granted tier still refuses, and the refusal is the same
      one a clean box gives.
- [x] The session's `userType` stays the **CVE's** tier, not the account's; the filesystem views
      for `file_read`, `dir_list`, `file_write` and `script_exec` stay at the CVE's tier too.
- [x] `password_reset` on a root-only router rewrites root's hash, and the granted plaintext still
      keys on the CVE's tier.
- [x] The rule is identical on all three call sites — remote, own-box `--local`, and cross-player
      local elevate.

**RED**: a `high`-severity service CVE fired at a generated AP gateway asserts a root shell; fails
today with the generic refusal because no `user` account exists.
**GREEN**: introduce a tier ordering (none exists today) and replace the three
`.find((candidate) => candidate.userType === outcome.tier)` lookups with lowest-at-or-above.
**REFACTOR**: the three sites are the same expression three times — assess one shared resolver.
**PRE-PR MUTATION**: run once over the new ordering helper and the three resolvers. Boundary
mutants matter here: the ordering comparison is exactly the `>=` vs `>` case the mutator rules
call out, so the suite needs a case sitting **on** the tier as well as above and below it.
**PR-ready when**: criteria met, wire-check green, gates green, commit approved.

> Corrects `exploitCreateSession.ts`'s *"Every generated box carries all three tiers, so a miss is
> reachable only once a rooted player has edited the file"* — false for every router-class box.
> **Accepted cost to record in the code, not just here:** deleting a `user` account now promotes a
> `user`-tier hole to root, so hardening by deleting accounts stops working.

> **As built (#529):** one shared resolver `accountAtOrAbove(fs, tier)` in `passwdAccount.ts`
> replaced the three exact-tier `.find` lookups across all three sites (remote
> `exploitCreateSession`, own-box `msfconsole --local`, cross-player `exploitLocalElevate`). A
> created file's owner follows the resolved account, not the bare tier word (option A), so a
> user-tier write on a root-only router is owned by root. Mutation 29 killed / 0 survived (0
> timeouts); all five exploit wire-checks green.

---

### PR3 — A gateway that scans clean still falls

**Value**: The axis itself. A router whose services are patched — or whose firmware simply out-ranks
them — hands over a shell, a file, a reset password or a backdoor through the image it runs.
**Path**: `msfconsole <host> <port>` → `handleExploitCreateSession` → port → service outcome **and**
the box's firmware outcome → severity contest → slice 5's existing effect handlers → the port's own
sweep log.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk. Needs PR1 (the timeline) and PR2 (the floor).
**Decisions**: 82, 83, 86, 87, 89; 85 observable here.

**Acceptance criteria**
- [x] A gateway whose port-22 service has no live CVE falls through firmware; the response carries
      the firmware CVE and its severity.
- [x] When both the service and the firmware have a live CVE, the **higher severity** answers; an
      equal severity falls to the **service**.
- [x] The firmware outcome's tier is the library floor — `critical`/`high` → root, `medium`/`low`
      → user — and never the service floor.
- [x] Each of the eight effect kinds is reachable from the firmware pool, at the documented
      weights, seeded so one box always falls the same way.
- [x] The trace lands in the **port's** own sweep log, tagged with that daemon, naming the CVE —
      no firmware-specific log and no new catalog row.
- [x] A box with no firmware entry (workstation, NPC host) behaves exactly as today.
- [x] Firing at a router port whose service *and* firmware are both clean gives the same refusal it
      gives today.

**RED**: `msfconsole <ap gateway> 22` on a day when `openssh-server` is clean and the vendor's
firmware CVE has landed asserts a shell; fails today because `exploitOutcome` returns `undefined`
for any key with no service pool.
**GREEN**: a firmware interpreter beside `exploitEffect.ts`'s service one and `localExploit.ts`'s
library one — the third per-axis reader of the same `liveRelease` — plus the severity contest at
the single resolution point in `handleExploitCreateSession`.
**REFACTOR**: three interpreters now share `shellFor`, a severity rank and a pool-pick shape.
Assess extraction **after** green, and only if the collapsed version is smaller than the three.
**PRE-PR MUTATION**: run once over the firmware interpreter and the contest. The contest's
comparison is the decision-64 shape whose strict `>` is load-bearing for the tie rule, so the suite
needs an equal-severity pair pinning that the service wins.
**PR-ready when**: criteria met, wire-check green, gates green, commit approved.

> **As built (#531):** the firmware interpreter (`firmwareExploit.ts`) reads the image from the
> box's own manifest, and the contest `higherSeverityOutcome` sits at the single resolution point in
> `handleExploitCreateSession`, weighing the service and firmware outcomes (higher severity wins, an
> equal severity falls to the service). The REFACTOR extracted one shared `severityRank` into
> `packageTimeline.ts` — `localExploit.ts` dropped its private copy — but the two tier-floor tables
> stayed separate per axis, each with its own rationale. The tie-to-service rule is what keeps every
> router's permanently-live sshd hole reachable. Mutation 40/40 killed / 0 survived (0 timeouts);
> all four exploit wire-checks green (ApGateway 15/15 with net-new firmware coverage, OwnLan 53/53,
> DeepChain 11/11, CrossPlayer 14/14).

---

### PR4 — A walk says what the device runs

**Value**: A player who walks a device learns its vendor and firmware version before spending a
move on it — the recon step the axis otherwise lacks, and the only remote read of a firmware
version in the game.
**Path**: `snmpwalk <host> <community>` → the identity block → the device's manifest.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk. Needs PR1 (the display version).
**Decisions**: 88.

**Acceptance criteria**
- [ ] `sysDescr` renders the firmware display version and the hostname — e.g.
      `MikroTik RouterOS 7.14.2 gw-swift-fox`.
- [ ] A switch whose firmware is not Cisco no longer claims to be Cisco.
- [ ] A router and a switch remain distinguishable in a walk, through interface naming
      (`eth0` vs `GigabitEthernet0/1`).
- [ ] No CVE, severity or upgrade state appears anywhere in the walk.
- [ ] The client-rendered walk and the server-resolved walk agree.

**RED**: a walk of a generated switch whose vendor is `openwrt` asserts `OpenWRT` in `sysDescr`;
fails today against the hardcoded `'Cisco IOS L3 Switch'`.
**GREEN**: carry the firmware display string on `SnmpIdentity`, read it from the manifest in both
identity builders, and render it in place of `PLATFORM[kind].description`.
**REFACTOR**: `PLATFORM` loses half its job — assess whether it collapses to the interface namer.
**PRE-PR MUTATION**: run once over `walk.ts` and the two identity builders.
**PR-ready when**: criteria met, wire-check green, gates green, commit approved.

> Corrects `walk.ts`'s claim that the per-kind description is *"the whole of the difference a walk
> can see between a router and a switch"* — after this it is the interface naming that carries it.

---

## Pre-PR quality gate (every PR)

1. Implementation complete; refactoring assessed or `N/A` recorded.
2. Mutation gate run once for the accumulated PR scope via the repo's throwaway-config recipe
   (`npm run encode` first; `--reporters json,progress`; read `reports/mutation/mutation.json`;
   **quote the run with the fewest timeouts**, since a timeout counts as killed).
3. `npm run typecheck` and `npm run lint` clean, from `v2/`.
4. Complete non-watch suite: `npx vitest run`.
5. `npm run build` clean.
6. Wire-check where the PR changes what a server handler authorizes or renders (PR2, PR3, PR4).
7. Version bumped in `v2/package.json` and `v2/package-lock.json`.

## Close-out

When PR4 lands: retire the as-built into the epic as
`### Phase 3 slice 9 — firmware falls`, mark the roadmap row and the **V4 acceptance row** shipped
— **this is the PR that closes V4 and the V series** — and delete this file per the convention
slices 1–8 followed.

---
*Delete this file at close-out; remove `plans/` only if it is then empty (it will not be — the
epic lives there).*
