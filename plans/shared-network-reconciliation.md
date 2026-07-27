# Plan: Shared-Network Reconciliation

**Branch**: one per slice, cut off `main`
**Status**: Active — Slice 1 ✅ MERGED (PR #326, `7c9338b`, v0.88.0),
Slice 2 ✅ MERGED (PR #327, `88054bf`, v0.89.0),
Slice 3a ✅ MERGED (PR #328, `6ae4109`, v0.90.0),
Slice 3b-i ✅ MERGED (PR #329, `21e3f9e`, v0.91.0),
Slice 3b-ii ✅ MERGED (PR #330, `879dcc4`, v0.92.0),
Slice 4 ✅ DONE on `feat/shared-lan-population` (v0.93.0, awaiting PR).
**Next: Slice 5 — depth is shared. Slice 4 turned out WIDER than scoped (it had to take the L1
gateway identity and the NPC filesystems with it — see its as-built), so Slice 5 is
correspondingly NARROWER: strictly the deep chain BELOW L1, i.e. `seedNetworkDepth`,
`generateDeepLayer`, `computeDeepGatewayId` and the deep base filesystems. Everything on the
LAN itself — population, addresses, gateway boxes, NPC boxes — is already shared.**
**Parent**: `plans/multiplayer-crossplayer-epic.md` item #5 (decision record; grilled & resolved 2026-07-25)
**Follows**: item #4 (unique public-IP allocation, v0.87.0)
**Precedes**: item #6 (procedural world expansion) — do NOT pull it in here

## Goal

Make the ESSID the seed for the whole network, so every occupant of an access point sees
one shared gateway, one LAN population, and one set of deep chains — and delete
`network_registry`, whose every column then becomes derivable or already-stored elsewhere.

## Proposed language (no glossary exists in this repo — confirm or rename)

- **AP gateway** — the single shared `.1` per ESSID that bears the public IP. Replaces the
  per-player "home router"/"edge router" for this object. Chosen over "shared router" because
  it names *whose* it is (the access point's, i.e. nobody's) rather than just asserting
  sharing.
- **LAN lease** — an occupant's allocated host octet on an ESSID's `/24`.
- Retiring: **"own router"** as a concept. After Slice 1 no player owns a gateway.

## Acceptance Criteria

- [x] Two identities that join the same ESSID resolve the **same AP gateway machine**, and a
      third identity's `nmap <public IP>` returns the same gateway regardless of join order.
      *(Slice 1.)*
- [x] A NAT forward published by one occupant is visible in another player's public scan of
      that AP, and reaching that port lands on the publishing occupant's box. *(Slice 1 — the
      gateway's `rules.v4` is now one shared journal-backed file; covered by the cross-player
      wire-checks and the UI smoke's nano-write → shared-journal read-back.)*
- [x] No player has implicit access to an AP gateway: reading or writing its filesystem
      requires a session obtained through the normal crack-and-connect path. *(Slice 1 — this
      was already the status quo; the slice preserved it while flipping the read path from
      local regeneration to server-materialized.)*
- [x] Bricking an AP gateway takes its public IP **permanently** dark, while the ESSID stays
      visible, crackable, joinable, and internally reachable between occupants. *(Slice 2 —
      plus the bricked box itself now refuses ssh from inside its own LAN. Visibility and
      crackability are client-side seeded and never touched the gateway; the rest is proven
      end to end by `testGatewayBrickLanAlive.ts`.)*
- [x] Two occupants of one ESSID never share a LAN address, and never land on an NPC's or the
      gateway's address; a reconnecting occupant gets the same address it had before. *(Slices
      3a + 4: `UNIQUE (essid, octet)` for occupant-vs-occupant, the NPC exclusion set for
      occupant-vs-NPC, the `.1` octet CHECK for the gateway, and a permanent lease for the
      return case.)*
- [~] Two occupants of one ESSID see the **same** NPC hosts at the same addresses, and the
      same deep chains behind the same inner gateways. *(Slice 4 did the hosts, their
      addresses, their names, their machine ids AND their filesystems; the deep chains behind
      the now-shared inner gateways are Slice 5.)*
- [x] A file written to an NPC by one occupant is visible to another occupant of that ESSID.
      *(Slice 4 — needed the NPC filesystems keyed `(essid, ip)` too, not just the id: the
      journal replays over the base tree.)*
- [x] Every occupant of a shared AP appears in every other occupant's `nmap` of the LAN — no
      occupant is hidden by an octet-reservation rule. *(Slice 4 deleted the rule.)*
- [ ] `network_registry` no longer exists; cross-player scan, session, FS-read, write, and
      source-IP-trace behavior is unchanged by its removal.
- [ ] `npm run typecheck` and `npm run lint` pass; every affected `scripts/test*.ts`
      wire-check passes against `vercel dev` + local supabase.

## Reduction Program

Applies to Slices 6a–6b only. The rest of this plan is behavior change and is NOT part of
this program.

**Ledger/report**: To be produced by `reduce-system-complexity` at the start of Slice 6a
(diagnosis + conservation ledger), recorded in this file.
**Conserved contract**: The observable results of the three registry-backed lookups —
cross-player public scan (`resolvePublicScan`), public ssh session creation
(`authCreateSessionPublic`), cross-player FS read (`resolveCrossPlayerFs`), remote write
permission / upsert / remove (`remoteWritePermission`, `upsertPatch`, `removePatch`), and
Story-6 source-IP traces (`crossPlayerSourceIp`). Same inputs → same outcomes, including
bricked-dark behavior and trace source IPs.
**Superseded mechanism**: The `network_registry` table, its
`network_registry_workstation_machine_id_idx` index, its write in `registerNetwork`, the
`findRegistryByPublicIp` / `findRegistryByOwnerKey` / `findRegistryByMachineId` dependency
shapes, and the PR #306 occupancy-fallback special case that exists only to survive
last-writer-wins eviction.
**Terminal slice**: Slice 6b.
**Owner and removal condition**: Slice 6a leaves `network_registry` in place as a temporary
bridge (still written, no longer read). Owner: this plan. Removal condition: Slice 6b, once
every lookup reads only `network_public_ips` / `home_network_occupants` and all wire-checks
pass. Latest acceptable removal point: before this plan is closed — the bridge must not
outlive the plan.
**Behavior gate**: All existing cross-player wire-checks (`testCrossPlayerRead`,
`testCrossPlayerWrite`, `testCrossPlayerSuElevate`, `testCrossPlayerSuTrace`,
`testCrossPlayerScanTrace`, `testCrossPlayerConnectionTrace`, `testBrickedDark`,
`testRouterBrick`, `testSameLanCrossPlayerFs`, `testSharedJournal`, `testPublicIpAllocation`)
pass unchanged in behavior, plus the full unit suite.
**Mechanism gate**: Like-for-like accounting at Slice 6b — one table, one index, one
migration's worth of write path, three dependency shapes collapsed to two sources, and one
retired architecture invariant (`conventions-and-gotchas.md` §7 occupancy-fallback rule), with
nothing equivalent reintroduced elsewhere.

## Slices

Walking-skeleton order: shared gateway → brick semantics → addressing → shared population →
shared depth → registry removal. Each slice is one PR.

### Slice 1: Every occupant of an ESSID sees one shared AP gateway at `.1` — ✅ MERGED (PR #326, v0.88.0)

**As-built.** `computeApGatewayId(essid)` in an `ap-gw:` namespace (deliberately NOT `ed25519-`
prefixed — no keypair is involved, an access point has no owner), with the admin password,
hostname and sshd presence reseeded to `ap-gw-admin-` / `ap-gw-host-` / `ap-gw-ssh-`.
`computeRouterId` / `isOwnRouter` and the owner-keyed `seedRouter*` / `buildRouterBaseFs` are
gone; `materializeRouterFs` → `materializeApGatewayFs`; the gateway arm of both
`RegistryMachine` unions carries `essid` instead of `owner_key`, and the `api/` reverse-lookups
select it.

**The non-obvious part, for whoever reads this next:** dropping `isOwnRouter` alone would have
failed silently. `ownLanBaseFsForMachineId` matches ANY host on the viewer's generated LAN and
the `.1` is still on it, so each occupant would have kept rebuilding the gateway from their own
seed and never seen another's writes. The `.1` is excluded there too — that exclusion is the
load-bearing half of the change.

**The verify-first question is answered:** a player ALREADY had to crack their own router — ssh
always prompted and authenticated server-side against the seeded `/etc/passwd`. So this slice did
NOT add a crack requirement. What changed is (a) the credential reseeds from the ESSID and (b) the
access path flips from local regeneration to server-materialized, which is what makes another
occupant's writes visible.

**Evidence:** RED 3/4 (sharpest: one identical id returned for two different ESSIDs) · 1885 unit
tests · mutation 100% on `router.ts` (9/9) and `lanHostIdentity.ts` (122 killed, 0 survived) ·
16/16 wire-checks · UI smoke test (scan → ssh → read → nano write → shared-journal persistence,
with the ESSID → password → served `/etc/passwd` → login chain verified end to end).

**Carried forward, out of scope here:** the shell prompt shows the machine-id name part
(`root@ap-gw`) while scans and log traces show the seeded hostname (`gw-main`) — a pre-existing
mismatch, previously `router`. And on some ESSIDs the `.1` gateway and the switch can draw the
same name from `ROUTER_HOSTNAMES` (distinct ids, cosmetic only).

**Value**: Actor = any player on a shared AP. Two identities on one ESSID stop having private,
conflicting `.1` machines that both claim the same public IP; an outside scanner resolves one
stable gateway whatever the join order.
**Path**: `nmcli` join → `registerNetwork` (stamps the ESSID-derived gateway id) → another
identity's `nmap <public IP>` → `resolvePublicScan` → the same AP gateway, its own `sshd` plus
the union of occupants' forwards parsed from its shared `rules.v4`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria**:
- Two identities joining ESSID X register the **same** gateway machine id.
- A third identity's `nmap <X's public IP>` resolves the same gateway hostname and ports
  regardless of which occupant joined last.
- A forward written to the gateway's `rules.v4` by one occupant is visible in another
  player's public scan and routes to the publishing occupant's box.
- No player has implicit gateway access: FS read/write on it requires a session.
**RED**: A behavior test asserting two distinct owner keys on one ESSID resolve one identical
gateway machine id and one identical seeded admin credential; and a public-scan test asserting
resolution is join-order-independent.
**GREEN**: Add an ESSID-namespaced gateway identity (proposed `computeApGatewayId(essid)` in an
`ap-gw:` hash namespace, distinct from the workstation/inner/deep namespaces per the
`workstation_id` invariant); seed its base FS and admin password from the ESSID
(`routerFs.ts` `seedRouterAdminPw`, `buildRouterBaseFs`); point `lanHostIdentity` octet 1 at
it; have `registerNetwork` stamp it.
**MUTATE**: Run Stryker on the new identity + seeding modules. Expect the documented
equivalent classes (§4 of conventions) rather than chasing them.
**KILL MUTANTS**: Address survivors in the identity derivation and the ESSID-seeding paths.
**REFACTOR**: Assess only.
**Verify first, before writing code**: whether a player today must already crack their own
router to ssh into it, or gets the admin password implicitly. This determines whether "no
implicit access" is a *new* restriction or already the status quo. It changes the test, not
the design.
**Done when**: criteria met, `computeRouterId`'s per-player derivation is no longer used for
the `.1`, wire-checks touching the router path pass, human approves the commit.

### Slice 2: Bricking an AP gateway kills the WAN but leaves the LAN alive — ✅ MERGED (PR #327, v0.89.0)

**As-built.** The model we settled on: an access point is radio + switch + router in one box.
A brick kills the ROUTER — WAN routing and the box's own management plane, on *every*
interface — while radio and switching are dumb and survive. So the AP's public IP goes
permanently dark and the gateway refuses ssh from inside its own LAN, but the ESSID keeps
admitting joiners, occupants keep scanning the subnet, and occupant-to-occupant ssh keeps
working.

The production change is small and lives in one place: `handleAuthCreateSession` gained a
`findPatches` dep, replays the resolved host's journal over its seeded base via
`materializeMachineFs`, and gates on `canBoot` before the passwd check. The handler now
validates credentials against the materialized tree rather than the pristine base, matching
what its three sibling session handlers already did.

**The non-obvious part, for whoever reads this next:** the fix is not scoped to the gateway.
`handleAuthCreateSession` serves EVERY own-LAN host, so the same defect made bricked NPCs
loginable too — and gating the whole handler is less code than special-casing the `.1`. A
dead box is dead on every interface, whatever kind of box it is.

**Evidence:** RED 5/6 failing for the right reason (sharpest: a bricked AP gateway returned
`200` with a root session on the correct seeded admin password; the 6th test is the
over-gating guard and passes in both states) · 1891 unit tests · mutation 97.65% on
`authCreateSession.ts` with **100% of the new gate's mutants killed** — the 2 survivors are
pre-existing and equivalent (`account === null` is redundant with `!passwordOk`;
`formatSshdAuthLine` branches on `=== 'success'`, so `''` yields the identical failure line)
· 24/24 wire-check scripts, including the new `testGatewayBrickLanAlive.ts` at 11/11.

**Pre-existing failure, NOT from this slice:** `testUpsertPatch` is 10/12 — `removePatch` of
an `is_new` file/dir leaves a tombstone row where the script expects the row deleted.
Confirmed identical on `main` with this work stashed, and it touches `/api/patches`, which
this slice does not modify. Needs its own triage: either the script's expectation is stale or
`removePatch` regressed.

**Value**: Actor = occupants of a bricked AP. A gateway brick becomes a permanent scar on one
network's internet access rather than the erasure of the network, so no future player is
locked out of an AP bricked before they arrived.
**Path**: attacker `su root` on the gateway → `rm /boot/vmlinuz` → public IP permanently dark
to scans and public ssh, while the ESSID still broadcasts, still cracks, still joins, and
occupants still reach each other over LAN IPs.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria**:
- After a gateway brick: `nmap <public IP>` and public ssh are dark, permanently.
- After the same brick: the ESSID appears in a wifi scan, can be cracked and joined, an
  occupant's `nmap <subnet>` still lists fellow occupants, and same-LAN ssh still works.
- No forward through the bricked public IP resolves, ever.
- **A bricked own-LAN host refuses ssh from inside the LAN too** — `ssh root@<.1>` on a
  bricked AP gateway is `host_unreachable`, not a successful login. Applies to every host
  the own-LAN handler serves (gateway and NPC alike): a dead box is dead on every
  interface. Added after the verify-first pass below; approved 2026-07-26.
**Starting point (verified on branch cut)**: both `testRouterBrick.ts` and `testBrickedDark.ts`
assert only the **WAN** half — gateway brick → public scan host-down + public ssh 404. That half
is CONSERVED by this slice, so neither script is expected to go red on the WAN assertions; they
are extended with the LAN-alive half, which nothing asserts today. Note the stakes changed under
Slice 1: the gateway is now shared per ESSID, so one player's brick is permanent for every
current and future occupant of that AP — which is precisely why the LAN must survive it.
**RED**: A behavior test that bricks the gateway then asserts the WAN-dark / LAN-alive split;
extend `scripts/testRouterBrick.ts` + `scripts/testBrickedDark.ts` for the wire path.
**GREEN**: Give `handleAuthCreateSession` a `findPatches` dep, replay the resolved host's
journal over its seeded base, and gate on `canBoot` before the passwd check — the same shape
the three other session handlers already use.

**Correction to this slice's original GREEN, from the verify-first pass.** The plan predicted
we would need to "separate the WAN gate from the LAN gate so `canBoot` governs only the
former". That separation ALREADY holds and needed no work: the WAN paths
(`resolvePublicScan`, `authCreateSessionPublic`) gate on the gateway's `canBoot`, while
`authCreateSessionSameLan`, `handleNmapScan` and `handleRegisterNetwork` never consult the
gateway — so occupant↔occupant ssh, LAN scans and joining already survive a brick, and the
ESSID pool is client-side seeded so cracking/joining were never at risk.

The real gap is the INVERSE: `handleAuthCreateSession` (the own-LAN path serving
`ssh root@<.1>`) has no `findPatches` dep at all, authenticates against the pure regenerated
base FS, and therefore CANNOT observe a `/boot` tombstone. A bricked gateway keeps serving
ssh to every occupant, so "permanently dark" is today only half true. Had we built the plan's
original GREEN, this slice would have produced only passing characterization tests and zero
production change.
**MUTATE**: Run on the boot/dark-gate paths — these are pure predicates and mutate well.
**KILL MUTANTS**: Address survivors distinguishing WAN-dark from LAN-dark.
**REFACTOR**: Assess only.
**Done when**: criteria met, both brick wire-checks pass, human approves the commit.

### Slice 3: Occupant LAN addresses come from a real DHCP lease — SPLIT into 3a + 3b (approved 2026-07-26)

Split because the `assignHomeNetwork` read sweep is 11 production call sites across 9 files
plus 11 wire-checks — see the scope finding below. The criteria, the NPC-clause deferral and
the preflight below are shared by both halves; 3a discharges them at the storage layer and 3b
makes them player-visible.

**Value**: Actor = any occupant. Two players on one ESSID can no longer collide on an address,
and (with Slice 4 landing next) can no longer land on top of a world object.
**Path**: `nmcli` join → `registerNetwork` → lazy lease allocation → the occupant's `localIp`
is the leased address everywhere it is read (occupant list, same-LAN connect, traces).
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`,
plus `evaluate-existing-solutions` **preflight only** (the platform primitive — a DB unique
constraint — is already the chosen mechanism, proven by `allocatePublicIp`; this is a
same-pattern application, not a new generic mechanism).
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria**:
- Two identities joining one ESSID receive different host octets, always.
- An allocated octet never collides with the gateway (`.1`) or a reserved address
  (`.0`/`.255`).
- A reconnecting occupant receives the **same** address it held before (permanent lease per
  `(essid, owner_key)`, no GC).
- Concurrent first-joiners of a fresh ESSID resolve to distinct addresses.

**The NPC-collision clause moved to Slice 4 (decided 2026-07-26).** It originally read "…or an
NPC octet of that ESSID", which is not yet a definable set: `generateHomeLan` seeds its NPC
draw off `home-lan-${seedPubkeyHex}-${essid}`, so every viewer sees a different NPC set on one
ESSID. There is nothing here for an allocator to avoid, and no test that could prove it did.
Slice 4 reseeds that generator off the ESSID alone, which is the first point the set exists —
so the exclusion belongs there. Until then, an occupant landing on an NPC's octet is resolved
where it already is: `mergeLanOccupants` drops the generated host and the occupant wins.

**Scope note — ~~`generateHomeLan`'s signature changes here, not in Slice 4~~. It was predicted
that once the address became a lease, the leased octet would have to be passed in, migrating
part of Slice 4's call-site sweep forward into this slice. That did NOT happen** (as built,
3b-ii): the generator stopped placing the player altogether rather than being told where it
sits, so it still takes `(seedPubkeyHex, essid)` and still derives a *reserved* octet from
`assignHomeNetwork` to hold vacant. The player is placed afterwards by `withSelfHost`, from the
lease. The full call-site sweep therefore remains Slice 4's cost, undiminished.

### `evaluate-existing-solutions` preflight (2026-07-26) — status: proposed

**Depth**: lightweight preflight, per this slice's skill list. No external research was needed
and none was done: the mechanism is a Postgres UNIQUE constraint, already owned, already
proven in this repo.

**Local capability found**: `core/network/allocatePublicIp.ts` over
`supabase/migrations/20260625000000_network_public_ips.sql`. Read-first, draw, claim against a
UNIQUE column, redraw on `23505`, bounded attempts, effects injected so `core/` stays
framework-agnostic; the Supabase `INSERT … ON CONFLICT … DO NOTHING` lives in the `api/`
adapter (`api/network.ts:392-432`). This is a direct structural template for the LAN lease.

**Decision**: reuse the pattern, not the code. The two allocators differ in a way that matters
— the public-IP draw is over a practically unbounded routable space where exhaustion is
pathological, while a LAN lease draws from **253 octets** where exhaustion is reachable and the
candidate pool must be filtered against known-taken addresses. A shared generic allocator would
have to be parameterised over pool, exclusion set, and exhaustion semantics to serve both; that
is more mechanism than the duplication costs. Assess extraction at REFACTOR with both
implementations in hand, and do not force it.

**Bespoke baseline considered and rejected**: an application-level "read all leases, pick a
free one, insert" has a lost-update race between the read and the insert that only a
transaction or a constraint closes — so the constraint is the smaller, safer mechanism, not
merely the familiar one.

**Re-evaluation trigger**: if a third allocator of this shape appears, revisit extraction.

### ⚠️ Scope finding — this slice is two PRs, not one (2026-07-26, proposed)

The preflight grep for `assignHomeNetwork(` shows it is not a local helper — it is the
**address oracle for the entire same-LAN subsystem**, used to re-derive *other players'*
addresses without a database read:

- **9 production files, 11 call sites**: `core/scan/nmapScan.ts` (×2),
  `core/sessions/authCreateSessionSameLan.ts` (×2), `core/network/resolveOccupants.ts`,
  `core/scan/workstationPortResolver.ts`, `core/generation/generateHomeLan.ts`,
  `adapters/networkApi.ts`, `ui/env.ts`, `ui/state.ts`, `ui/connectionPersistence.ts`.
- **11 wire-check scripts**, plus a migration comment and `docs/cross-player-architecture.md`.

Every one of those turns from a pure synchronous derivation into a lease lookup. That is the
whole cost of the slice, and it is not one reviewable PR alongside a new table, a new
allocator, and a new wire-check.

**Note the inversion this forces.** `20260621120000_home_network_occupants.sql` deliberately
does NOT store LAN IP, on the stated grounds that it re-derives from `(owner_key, essid)` and
storing it "would only risk drift". Once the address is leased, that rationale reverses: the
lease becomes the source of truth and the derivation becomes the drift. The migration comment
and the `minimize-api-projections` note in `resolveOccupants.ts` both need rewriting, not just
the code.

**The lease cannot live on the occupancy row.** `handleUnregisterOccupant` DELETEs the
`(essid, owner_key)` row on `nmcli disconnect`, so a lease stored there would not survive a
disconnect — directly violating criterion 3 (a reconnecting occupant keeps its address). The
separate `network_lan_leases` table is load-bearing for permanence, exactly as planned.

**Proposed split (needs approval before code):**

- **Slice 3a — the lease exists.** Migration + `allocateLanLease` + allocation on join +
  `scripts/testLanLeaseAllocation.ts`. Nothing reads the lease yet; addresses still come from
  the derivation, so player-visible behavior is unchanged. Horizontal, but independently
  verifiable at the wire and it unblocks 3b — the `planning` exception applies. Discharges
  criteria 1–4 at the storage layer.
- **Slice 3b — the lease is the address.** The 11-site read sweep plus the client join
  response, `generateHomeLan`'s signature, and the doc/migration-comment corrections. This is
  where the address a player actually sees becomes the leased one.

**Seeding proposal for 3a, to keep 3b boring:** have the first draw for an
`(essid, owner_key)` return today's `assignHomeNetwork(owner_key, essid)` octet, and only
redraw on collision. Every currently-connected occupant then leases the address it already
has, so 3b changes no address except the genuinely-colliding ones — which is the entire point
of the slice. Without this, 3b silently relocates every existing player.
#### Slice 3a: The lease exists — ✅ COMPLETE on `feat/lan-dhcp-lease` (v0.90.0), awaiting commit approval

**As-built.** `network_lan_leases(essid, owner_key)` PK with `UNIQUE (essid, octet)` and a
`CHECK (octet BETWEEN 2 AND 254)`. `allocateLanLease` in `core/` is read-first → offer the
preferred octet → claim → redraw → bounded exhaustion, with the store effects injected; the
`INSERT … ON CONFLICT (essid, owner_key) DO NOTHING` and the `23505` → redraw mapping live in
the `api/` adapter, mirroring `allocatePublicIp` exactly. `handleRegisterNetwork` gained an
`allocateLanLease` dep and calls it before either write, so a failure is a clean
`lease_allocation_failed` 500 rather than a join that registers a player on a network they hold
no address on.

**The preferred octet is today's derived one**, composed in the adapter
(`derivedOctetFor`), so every already-connected occupant leased the address it was already
using. Only genuine collisions redrew. That adapter helper is explicitly transitional and dies
with the derivation in 3b.

**Evidence:** RED 8/8 on the allocator against a throwing stub, then RED 3/3 on the handler —
the sharpest being that a lease-allocation failure returned `200`, i.e. the join succeeded
while the player held no address · 1902 unit tests (was 1891; +11, none broken) · mutation
**100% on both changed files**, `allocateLanLease.ts` 18/18 and `registerNetwork.ts` 50/50,
zero survivors · 24/25 wire-checks green including the new `testLanLeaseAllocation.ts` at
10/10.

**The check that mattered:** `testLanLeaseAllocation.ts` searches for two identities whose pure
derivations collide on one ESSID, then joins them CONCURRENTLY. Both derived `.51`; they came
out on `.51` and `.95`. That is the defect this slice exists to close, proven at the wire under
a real race — which is exactly what no unit test over a fake store can establish, and what
`testPublicIpAllocation.ts` never did for its own allocator.

**REFACTOR assessed and declined.** With both allocators in hand, a shared abstraction would
need to be parameterised over key arity (`essid` vs `essid + owner_key`), value type (string vs
number), and whether a caller-supplied first candidate precedes the draw — three parameters to
share roughly eight lines of loop. The preflight predicted this; it holds. Revisit only if a
third allocator of this shape appears.

**Pre-existing failure, NOT from this slice:** `testUpsertPatch` remains 10/12, unchanged and
still untriaged (see Slice 2).

**Class**: Behavior change (server-side; no player-visible address changes yet).
**Value**: The `(essid, octet)` uniqueness the whole slice rests on becomes a database
invariant rather than a hope about hash distribution. Nothing reads the lease yet, so this is
horizontal — it qualifies under the `planning` exception because it is independently verifiable
at the wire and it is the only thing blocking 3b.
**Path**: `nmcli` join → `registerNetwork` → `allocateLanLease` → a row in
`network_lan_leases`. Observable via the new wire-check and by inspecting the table.
**RED**: Unit tests for `allocateLanLease` over a fake store — existing lease → read-back with
no claim attempted; fresh → the preferred octet is claimed; preferred taken by another occupant
→ redraw; a concurrent self-write winning the `(essid, owner_key)` race → adopt its octet;
exhaustion → clean failure. Plus a range test proving a redraw never yields `.0`/`.1`/`.255`.
**GREEN**: `network_lan_leases(essid, owner_key)` PK with `UNIQUE (essid, octet)`; lazy
allocation on join via `INSERT … ON CONFLICT (essid, owner_key) DO NOTHING`, adopting on no-row
and redrawing on `23505` — the `allocatePublicIp` shape one level down.
**Seeding (approved 2026-07-26)**: the FIRST candidate for an `(essid, owner_key)` is that
identity's current `assignHomeNetwork(owner_key, essid)` octet; only a collision redraws. Every
already-connected occupant therefore leases the address it already holds, so 3b relocates
nobody except genuinely-colliding players. Without this, 3b would silently move every existing
player and break saved connections and the hardcoded expectations in 11 wire-checks at once.
**MUTATE**: Run on `allocateLanLease`. `scripts/testPublicIpAllocation.ts` is the template for
`scripts/testLanLeaseAllocation.ts` — but note it does NOT race concurrent joins (its checks
4a/4b drive the claim primitive sequentially), so criterion 4 needs a genuinely concurrent
wire-check that nothing in the repo has today.
**KILL MUTANTS**: Address survivors in the redraw/exhaustion branches.
**REFACTOR**: Assess whether the two allocators share a seam worth extracting — the preflight
predicts NOT (differing pool bounds and exhaustion semantics); confirm with both in hand.
**Done when**: criteria 1–4 hold at the storage layer, `testLanLeaseAllocation.ts` passes
including a concurrent-join check, no player-visible address changes, human approves.

#### Slice 3b: The lease is the address — SPLIT into 3b-i + 3b-ii (2026-07-26, mid-slice)

**Reconnaissance (2026-07-26), before criteria were approved.** The 11 sites are not one kind
of change. They split three ways:

*Mechanical (5 sites, 4 server handlers).* `resolveOccupants.ts:97`, `nmapScan.ts:220,241`,
`authCreateSessionSameLan.ts:177,221` each already issue an occupancy query; each gains one
`listLeasesByEssid` read and resolves addresses from that map.

*Prefetch-shaped (1 site).* `workstationPortResolver.ts:51` is built as a SYNCHRONOUS closure
over data the adapter prefetches, deliberately so `core/` carries no async materialization
wiring. It cannot issue a query — the adapter must prefetch the lease and pass the address in.
It is also on the cross-player PUBLIC path (NAT forward → workstation), so a forward's
`internalIp` and the leased address must agree or every published forward goes dead.

*Generation (1 site — WRONG, corrected below).* `generateHomeLan.ts:38`.

**⚠️ Correction found while implementing (2026-07-26): `generateHomeLan` is EIGHT production
call sites, not one.** `nmap.ts:264`, `ssh.ts:286`, `lanHostIdentity.ts:68,148,225`,
`remoteHostId.ts:30`, `nmapScan.ts:240`, `authCreateSession.ts:153`, plus ~8 wire-checks — and
crucially it is called with OTHER players' keys (`lanHostIdentity`, `remoteHostId`) to
regenerate their NPC filler. Threading a leased octet through it means threading a lease
lookup into deep pure generation code reached from both client and server. That is the
SELF-address problem, not the fellow-occupant one, and it is what forced the split.

**The split (approved pattern from 3a/3b; recorded here as the reason).** Every address a
player is REACHED at is server-resolved; every address a player SEES ITSELF at is client-side
and blocked on the client learning its lease. Those are separable, and the first is where the
actual bug lives (two occupants at one address). So:

- **3b-i — every address the SERVER resolves comes from the lease.** Fellow-occupant lists,
  same-LAN ssh + its trace source, scan traces, and the NAT-forward target. Criteria 1, 3, 5.
- **3b-ii — the player's own address is the leased one, cached for offline.** The
  `registerNetwork` response carries the lease, the 4 client sites consume it,
  `generateHomeLan` takes the octet, and `restoreConnection` reads a client-side cache.
  Criteria 2, 4.

**Known intermediate state between them (deliberate, and strictly an improvement).** After
3b-i a REDRAWN player is reached by everyone at its leased address, while its own client still
shows the derived one. Uncollided players — every player today, since 3a seeded leases from the
derivation — see no difference at all. Before 3b-i a collided pair shared one address and one of
them was unreachable; after it, both are reachable. The disagreement is confined to the
collided player's own view of itself, which 3b-ii resolves.

*Client, and NOT mechanical (4 sites).* This is where the slice's real decisions live:
- `networkApi.ts:73` swallows a registration failure and returns the derived address, on the
  stated grounds that "the LAN address is local-deterministic". Once the server allocates it,
  that premise is gone and the failure posture must be chosen, not inherited.
- `connectionPersistence.ts:61` (`restoreConnection`) is SYNCHRONOUS and offline: it rehydrates
  from localStorage with no network call, deliberately independent of the current scan list. A
  server-held address breaks that unless the leased address is cached client-side.
- `env.ts:221` and `state.ts:365` both fall back to the pure derivation when the network client
  is not wired.

**`assignHomeNetwork` SURVIVES this slice — the earlier guess that it might be deletable was
wrong.** Its `localIp` is `192.168.${subnet}.${host}` where **`subnet` is ESSID-seeded** and
still load-bearing (it is the AP's `/24`, shared by every occupant); only the `host` octet
becomes the lease. So the module's contract splits rather than disappears: an ESSID→subnet
function stays, the octet comes from the lease, and the hostname draw is untouched. It also
remains the source of the preferred octet that seeds a NEW lease.

##### Slice 3b-i: every address the SERVER resolves comes from the lease — ✅ COMPLETE (awaiting commit approval)

**Class**: Behavior change.
**Value**: Actor = any occupant. The address every OTHER player reaches you on — in the
occupant list, over same-LAN ssh, in the traces you leave, and through a NAT forward — is the
one you hold a lease on. Two occupants can no longer answer to a single address.
**Path**: five server-side readers resolve addresses from `network_lan_leases` instead of
re-deriving them from `(owner_key, essid)`.

**As built.**
- New `core/network/lanAddress.ts`: `lanSubnetFor` (the ESSID-seeded `/24`, moved out of
  `assignHomeNetwork`, which now calls it), `lanAddressFor` (total, for a known octet),
  `leasedAddress` (the single place a missing lease becomes "no address"), and
  `lanAddressesByOwner` (one ESSID's leases → `owner_key → Ipv4`, built off ONE subnet
  computation per request).
- `resolveOccupants`, `authCreateSessionSameLan`, `nmapScan` each gained a
  `listLeasesByEssid` dep — ONE `SELECT owner_key, octet … WHERE essid = $1` per request,
  issued BEHIND the LAN-boundary gate so no address reaches a non-occupant.
- `resolvePublicScan` and `authCreateSessionPublic` gained a single-row `readLease`, since
  the public path needs exactly the target owner's address. `buildWorkstationResolver` now
  TAKES `lanIp: string | null` rather than deriving it, keeping `core/` synchronous.
- Failure posture, uniform: an address that cannot be read is never guessed. Where the address
  IS the answer (`resolveOccupants`, same-LAN connect, public gate) a lease-read failure is a
  clean 500; where the trace is best-effort (`nmapScan`) it silently skips, exactly as an
  occupancy-read failure already did.
- Two gates now stand where one did: occupancy (are you PRESENT?) and lease (are you
  ADDRESSED?). Both are load-bearing because a lease outlives occupancy — a disconnected
  player still holds an address and must still be refused. Tests pin that case in both the
  same-LAN connect and the scan.
- 10 wire-checks re-pointed. The six that seed occupancy via `service_role` now seed the lease
  alongside it (a join allocates the lease FIRST, so seeding one without the other described a
  state the server never produces); the ones that join for real read the issued lease back
  instead of re-deriving it; the three NAT-forward checks publish forwards at the leased
  address. All of them now also clear `network_lan_leases` on setup/teardown — leases outlive
  occupancy, so a stale one from a prior run holds an octet forever.

**Evidence.** RED at each reader before its GREEN (4 → 5 → 4 → 4 failing, each on the address
itself: leased `.2` expected, derived `.221` received). 1928 unit tests (was 1902, +26, none
broken). Mutation on the 8 changed files: `homeNetwork` 100%, `workstationPortResolver` 100%,
`resolveOccupants` 100% covered, `nmapScan` 100% covered, `authCreateSessionSameLan` 98.56%
covered, `authCreateSessionPublic` 98.56%, `resolvePublicScan` 97.37% covered, `lanAddress`
91.67%. Every survivor on a line this slice touched was killed or removed; the ONE remaining
(`lanAddress.ts:38`, `octet === null ? null : …` → `false ? …`) is equivalent — a null octet
would yield `192.168.N.null`, which no forward or target can name, so the behaviour is
identical. The rest sit on pre-existing lines (`'success' : 'failure'`,
`account === null || !passwordOk`, `vantage: 'external'`) untouched here. No-coverage mutants
are the `?? []` fallbacks, which a list query cannot produce. 24/25 wire-checks green (the
holdout is the long-standing `testUpsertPatch` 10/12 tombstone triage). Typecheck + lint clean.

**Killing the survivors found real gaps, not test padding.** The occupancy gate in both the
same-LAN connect and the scan survived deletion entirely, because the new lease gate returns
the same 403 for the fixtures as written. It is genuinely load-bearing for a
disconnected-but-leased player — a case no test covered. Likewise, `if (leases.error) return`
survived because the fixture returned null data alongside the error; the test now returns ROWS
with the error, pinning that a failed read is not trusted just because it handed something
back.

**Deferred to 3b-ii, and why (see the correction above).** `nmapScan`'s own-LAN `selfIp` stays
derived: `generateHomeLan` seeds the caller's NPC filler AROUND the derived self octet, so the
self-exclusion has to use the same value the generator did. It is the caller's private view of
itself and reaches no other player.

##### Slice 3b-ii: the player's own address is the leased one — ✅ COMPLETE (v0.92.0)

**Class**: Behavior change.
**Scope**: `adapters/networkApi.ts:73`, `ui/env.ts:221`, `ui/state.ts:365`,
`ui/connectionPersistence.ts:61`, `core/generation/generateHomeLan.ts` (+ its 8 callers, and
the lease threading `lanHostIdentity`/`remoteHostId` need), `nmapScan.ts`'s own-LAN `selfIp`,
and the `registerNetwork` response shape.
**Doc corrections still owed**: `20260621120000_home_network_occupants.sql` (the LAN-IP
projection rationale) and `docs/cross-player-architecture.md:104`. The
`minimize-api-projections` note in `resolveOccupants.ts` was rewritten in 3b-i.

**✅ The hard part — RESOLVED 2026-07-26. The generator drops `self`; the lease never enters
the generation layer.**

⚠️ **Correction to the framing this section carried:** there is no "another player's LAN"
caller group. All 8 `generateHomeLan` call sites pass the CALLER'S OWN key — `ownerKeyHex` is
merely a parameter name. The `lanHostIdentity`/`remoteHostId` sites are reached from handlers
that pass the verified caller's `publicKey` (`resolveInnerGatewayScan.ts:162`,
`authCreateSessionInnerGateway.ts:299`, `remoteWritePermission.ts:110`), and `nmap.ts`/`ssh.ts`
pass `env.identity.publicKeyHex`. So the candidate answer previously recorded here — own-view
callers take the octet, other-player callers stay derived — was not merely cheap-and-imperfect,
it was WRONG: it would make one owner's LAN generate two different NPC layouts depending on
which code path asked, and an inner-gateway `ssh` the client offered would 404 server-side.

**The self octet does two unrelated jobs**: it PLACES the `self` host, and it is EXCLUDED from
the NPC draw (which shifts the whole filler layout). Only the client `nmap` view actually
consumes the `self` entry — `nmapScan.ts` filters it straight back out, and both ssh paths only
match a target IP. So the two jobs get split by owner:

- **The generator keeps deriving.** `generateHomeLan(ownerKeyHex, essid)` keeps its signature
  and emits only NPC filler — `.1` gateway, inner gateway, switch, siblings — still holding the
  DERIVED octet out of `usableOctets` as a reserved hole. It stays a pure function of
  owner+ESSID with no DB dependency, and the filler layout stays byte-identical to today.
- **The lease places the player.** The own-view caller appends `self` at its LEASED address,
  exactly as `mergeLanOccupants` already overlays fellow occupants, dropping a filler host that
  collides on that octet.

**Why this is the right split, not just the cheap one.** The 5 server handlers never read
`self`, so none of them needs a lease read — the blast radius collapses to the client's own
view. Making the NPC layout depend on a mutable lease would also point AWAY from Slice 4, which
wants population seeded by the ESSID alone and shared by every occupant; keeping the filler a
pure derivation keeps that door open.

**Why the reserved hole still earns its place.** `allocateLanLease` PREFERS the derived octet,
so for every player except a genuinely-colliding one the leased octet IS the derived one and
`self` lands exactly in the hole the generator left. Slice 4 deletes the hole along with the
per-viewer draw.

**Accepted imperfection.** A REDRAWN player (the collided minority) can land on a filler octet;
`self` then displaces that host in the player's own view. If the displaced host was an inner
gateway, that player loses one depth entry while the server still resolves ssh to it at an
address the client shows as the player's own box. This is the same deferred-imperfection class
already documented in `mergeLanOccupants`, at a far lower rate (only redrawn players, ~4% of
them), and Slice 4 rebuilds this surface. Rejected as scope creep: teaching the allocator's
redraw to avoid the owner's own generated octets.

**Wire-check impact**: the scripts no longer import `assignHomeNetwork` for addresses (3b-i
moved them to `lanAddressFor` / lease read-back), but several still call `generateHomeLan` for
inner-gateway and NPC hosts — a signature change touches ~8 of them.
**Offline posture (decided 2026-07-26): cache the lease, else fail.** The leased address is
persisted client-side on each successful join. Reconnecting to a network the player already
holds a lease on works with the server unreachable, and `restoreConnection` stays SYNCHRONOUS
and offline by reading that cache. A first-ever join to a new ESSID with the server unreachable
fails with a clear error — you cannot be allocated an address by a server you cannot reach.
Rejected: falling back to the derivation, which would reinstate a second source of truth and
let a player transiently hold a colliding address that changes under them on the next join.
The cache is only ever a copy of a real lease, never an independent allocator.

**Acceptance criteria (the five approved for 3b, marked with where each lands)**:
- ✅ 3b-i — Two occupants whose derived octets COLLIDE reach each other on distinct LEASED
  addresses, and the occupant list, LAN scan, same-LAN ssh and log traces all agree on those
  addresses.
- 🔜 3b-ii — A player's own address — in `nmcli`/`ifconfig`, in scan self-exclusion, and as the
  source IP stamped on another player's `auth.log` — is the leased one. (The `auth.log` and
  scan-trace source halves landed in 3b-i, since the server resolves them; `nmcli`/`ifconfig`
  and self-exclusion are client-side and remain.)
- ✅ 3b-i — A NAT forward published to a workstation's leased address resolves through the
  public path; the public scan/ssh gate and the same-LAN path never disagree on that address
  (both now read the same lease).
- 🔜 3b-ii — Reconnecting to a known ESSID with the server unreachable restores the cached
  leased address; a first join to a new ESSID with the server unreachable fails and leaves the
  player disconnected rather than silently addressed.
- ✅ 3b-i — `nmap` from inside the LAN lists every occupant at its leased address.

**RED**: A behavior test that two occupants whose derived octets COLLIDE resolve to different
addresses end to end, and that each reaches the other on its leased address.
**GREEN**: The sweep. `assignHomeNetwork` stops deriving `localIp`; the ESSID→subnet half stays.
**MUTATE**: Run on the changed handlers.
**REFACTOR**: Assess whether `assignHomeNetwork` still earns its existence once `localIp` is
gone from it (it would retain only the hostname draw).
**Done when**: all five acceptance criteria hold end to end, every same-LAN wire-check passes,
the three doc corrections are made, human approves.

##### Slice 3b-ii as-built (2026-07-27)

**Where the lease enters the client.** `handleRegisterNetwork` now returns
`{ ok, local_ip }` — it already allocated the lease and threw the octet away. `joinHomeNetwork`
validates that body with a schema (a 200 naming no address is NOT an address), returns
`HomeNetworkAssignment | null`, and `env.homeNetwork.join` is nullable end to end. `nmcli`
starts ONE join promise and awaits it in two places (the stream renders the outcome, the exit
code reports it) — no mutable outcome flag, no second allocation attempt.

**The generator stopped placing the player.** `generateHomeLan` emits NPC filler only. Its
golden test is byte-identical minus the self row, which is the evidence that the filler layout
did not move. The derived octet stays OUT of the draw as a reserved vacancy, since
`allocateLanLease` offers it first. `withSelfHost` (beside `mergeLanOccupants`, same knowledge:
overlaying authoritative addresses onto filler) appends the player at `wlan0.ipv4` and drops a
filler host on that octet — the inverse of the occupant rule, because a fellow occupant can be
omitted from this viewer's LAN and the viewer cannot.

**Consequence worth knowing:** `nmapScan`'s self-exclusion and its `assignHomeNetwork` import
are GONE — with no self in the filler there is nothing to exclude. That was the last derived
address on the server.

**Offline posture, as built.** `lanLeaseCache` (key `jshack:lan-lease:<essid>`) is written by
`persistConnection` ONLY. That is deliberate: every path that addresses `wlan0` goes through
`env.setInterface`, so one writer covers the server join and any future one, and two writers of
one key would rot. Disconnect does NOT clear it (the lease outlives occupancy server-side).
`restoreConnection` dropped its `seedPubkeyHex` parameter — it recalls rather than derives, and
a stored ESSID with no remembered address comes back OFFLINE.

**Both derivation fallbacks are gone**, not just the server-backed path: `ui/env.ts`'s unwired
seam and `ui/state.ts`'s pre-client branch now return null. A client with no server does not
get to invent an address. Cost: the jsdom full-arc test in `Terminal.test.tsx` had to stub
`fetch`, because connecting now genuinely requires an issuer. That is the approved posture
showing up as test friction, not a regression.

**Evidence.** RED before each GREEN (join response → own view → offline restore → nmcli
refusal), each failing on the address itself. 1941 unit tests (was 1928, +13). Mutation on the
changed files: `registerNetwork` / `lanLeaseCache` / `mergeLanOccupants` / `generateHomeLan` /
`networkApi` / `nmapScan` **100%**, `connectionPersistence` 94.29% (2 equivalent), `nmap.ts`
survivors all pre-existing help-text literals — the one real gap it found (my own new
`wlan0.ipv4` guard, masked by `isOnline`) is now killed. Wire-checks 24/25 green (the lone gap
is the long-standing `testUpsertPatch` 10/12 tombstone triage, untouched by this slice).
Typecheck + lint clean.

**Doc corrections discharged:** the `home_network_occupants` migration comment (LAN IP is a
lease in its own table, and WHY it lives there — it outlives occupancy) and
`cross-player-architecture.md`'s `buildWorkstationPortResolver` line. Also swept three stale
"local-deterministic" module docs (`homeNetwork`, `networkApi`, `ui/env`) that still promised a
derivable address.

**Left standing deliberately:** the reserved-octet vacancy in `generateHomeLan` (Slice 4
deletes it with the per-viewer draw), and the accepted imperfection recorded above — a REDRAWN
player can displace a filler gateway in its own view. Not worth machinery for a surface Slice 4
rebuilds.

### Slice 4: Every occupant of an ESSID sees the same LAN population

**Value**: Actor = any occupant. The LAN stops being a per-viewer illusion — two players
standing on one `/24` see the same machines at the same addresses. Also fixes a live bug.
**Path**: `nmap <subnet>` from inside the LAN → ESSID-seeded population + real occupants →
one consistent host list for everyone on the AP.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A` (the `mergeLanOccupants` reservation deletion is incidental to a
behavior change, not a reduction program — it is removed because its cause is gone).
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria**:
- Two identities on one ESSID see the same NPC hosts, hostnames, and addresses.
- A file written to an NPC by one occupant is visible to the other occupant.
- Every occupant appears in every other occupant's LAN scan — no occupant is dropped by an
  octet-reservation rule.
- The viewer's own host still appears correctly and is not displaced.
- **An allocated LAN lease never collides with an NPC octet of that ESSID** (deferred here
  from Slice 3, decided 2026-07-26 — see that slice for why it was undefinable earlier). The
  ESSID-seeded NPC set feeds the Slice 3 allocator as an exclusion set. This matters MORE
  after this slice than before it: while the population was per-viewer, an occupant landing on
  an NPC's octet only hid that NPC from one player, but once the population is shared, one
  player joining removes that NPC — and orphans any journal already written to it — for every
  occupant of the AP.
**RED**: A behavior test asserting two distinct owner keys on one ESSID generate identical
host lists; and a test asserting an occupant previously hidden by the reservation rule is now
visible.
**GREEN**: Reseed `generateHomeLan` from the ESSID and drop the per-player seed parameter;
delete the octet-reservation branch in `mergeLanOccupants`. Also delete the reserved-octet
vacancy: once the NPC set is ESSID-seeded it becomes the allocator's exclusion set, so no
occupant can be offered an NPC's octet and nothing needs holding open.
**Sweep, counted on `73f6340`** (re-grep before starting — this is a snapshot, not a promise):
8 production call sites across 6 files (`commands/nmap`, `commands/ssh`,
`generation/lanHostIdentity` ×3, `generation/remoteHostId`, `scan/nmapScan`,
`sessions/authCreateSession`), 9 call sites across 7 `scripts/test*.ts`, and 78 across unit
tests. A further ~13 modules import only the `HomeLan`/`LanHost` types and are untouched by a
seed change. The unit-test sites dominate the mechanical cost; most pass a pubkey purely to
satisfy the signature and simply lose the argument.
**MUTATE**: Run on `generateHomeLan` and `mergeLanOccupants`.
**KILL MUTANTS**: Address survivors around occupant/NPC precedence on collision.
**REFACTOR**: Assess — this slice deletes a rule rather than adding one; check the merge
function still earns its existence.
**Aliasing note (fixed by construction here, not separately)**: `hostMachineId`
(`remoteHostId.ts`) is `` `${hostname}-${suffix('host:'+essid+':'+ip)}` ``. The suffix half is
viewer-independent; only `hostname` varies, drawn from a 6-element pool. So today ~1 in 6
same-octet draws make two occupants' *private* NPC boxes alias onto one `machine_id` and share
a journal. ESSID-seeding makes the ids align intentionally. **Add an explicit regression test
for this** — it is a real bug being closed, and it deserves a test that would fail today.
**Done when**: criteria met, aliasing regression test present and passing, all LAN wire-checks
pass, human approves the commit.

**AS BUILT (v0.93.0).** RED at the layer that still has a viewer: `handleNmapScan` logs the
same machine ids and the same lines for two different verified signers on one ESSID — it failed
on hostnames, ids AND population before the change. `generateHomeLan(essid)` now takes no
identity at all (the "same for everyone" claim became a tautology inside it, so the evidence
lives at its consumers: the scan handler, `ownChainBaseFsForMachineId`, `hostForMachineId`).

**Wider than planned, and necessarily so.** The plan scoped the generator; criterion 3 (a
write by one occupant is visible to another) also required the BOXES to be shared:
`buildRemoteHostFs` / `hostServices` / `buildDeepHostFs` were owner-seeded, so a shared
`machine_id` still replayed a journal over a per-viewer tree — different accounts, different
passwords, different open ports at one address. Keyed `(essid, ip)` now. The L1 gateway
identity came along for a different reason: `generateHomeLan` builds the inner gateway's
hostname, so dropping its key parameter forced `seedInnerGatewayHostname` onto the ESSID, and
shipping a shared NAME over a per-player BOX would have been worse than either end state.
`computeInnerGatewayId` / `buildInnerGatewayBaseFs` / `buildSwitchBaseFs` /
`seedInnerGatewayAdminPw` moved with it. Slice 5 is correspondingly narrower: strictly the
deep chain BELOW L1 (`seedNetworkDepth`, `generateDeepLayer`, `computeDeepGatewayId`).

**Two rules deleted, and why they were only ever workarounds.** The gateway-octet reservation
in `mergeLanOccupants` and the reserved-octet vacancy in the generator both existed because a
per-viewer population is invisible to the allocator — there was nothing an allocation could
avoid. With one shared population the allocator excludes NPC octets outright, so the collision
does not arise and hiding an occupant buys nothing. The exclusion covers the preferred octet
AND every redraw; `drawLanOctet` draws from the ALLOWED pool rather than rejecting afterwards,
so an exclusion never consumes one of the 8 attempts. It governs what may be ISSUED, not what
is held — an existing lease is returned untouched, so nobody is relocated out from under a
saved connection.

**Evidence.** 1961 unit tests (was 1945 at branch point, 1928 two slices ago). Mutation
**100%** on `generateHomeLan`, `lanHostIdentity`, `remoteHostId`, `mergeLanOccupants`,
`registerNetwork`, `allocateLanLease`, `lanAddress`. `remoteHostFs` 95.71% / `routerFs` 96.15%
— all 7 survivors sit on lines this slice did not touch (the `hasSsh` knob is pinned to 1.0,
so its mutants are equivalent by construction). **Wire-checks 26 scripts / 179 checks, all
green**, including two new ones in `testLanLeaseAllocation`: a join whose derived octet is an
NPC is leased elsewhere, and the address the join REPORTS is that relocated one. Local
`network_lan_leases` truncated on request (none of the 7 rows actually collided with the new
NPC sets, but they predate the exclusion).

**Mutation earned its keep here.** The allocator's tests inject `redrawOctet`, so
`drawLanOctet`'s exclusion filter — the whole point of the change — could be DELETED with the
suite green. Nothing else would have caught it.


### Slice 5: Depth is shared — inner gateways and deep chains seed from the ESSID

**Value**: Actor = any occupant. Deep chains stop being private per-player worlds behind
shared addresses; two players sshing the same inner gateway find the same machines behind it.
**Path**: `nmap` → inner gateway at its octet → `ssh user@<inner>:<fwd>` → the same deep chain
for every occupant, with deep traces attributed consistently.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.
**Acceptance criteria**:
- Two identities on one ESSID resolve the same inner gateway and switch machine ids, the same
  chain depth, and the same deep hosts.
- A deep-layer write by one occupant is visible to the other.
- Deep `auth.log` / `kern.log` traces still record the fronting gateway's `<deep subnet>.1` as
  the source, unchanged from Story 5b.
**RED**: A behavior test asserting two owner keys on one ESSID produce identical chains
(ids, depth, gateway kinds); a shared-write visibility test.
**GREEN**: Reseed `computeDeepGatewayId` / `generateDeepLayer` / `seedNetworkDepth` /
`seedDeepGatewayAdminPw` / `buildDeepGatewayBaseFs` / `buildDeepSwitchBaseFs` and the
switch-ACL seeding from the ESSID rather than the owner key. `computeInnerGatewayId` is
already done — Slice 4 took the whole L1 gateway identity with it, so this slice starts
strictly below L1. Note `buildDeepHostFs` is ALSO already `(essid, ip)`: the deep NPC's tree
followed its coordinate-keyed `machine_id` in Slice 4, so only WHICH deep hosts a chain
reaches is still private.
**MUTATE**: Run on the chain identity + depth derivations.
**KILL MUTANTS**: Address survivors in chain-key composition (parent id + octet must still
prevent aliasing across branches).
**REFACTOR**: Assess only.
**Size risk**: This is the slice most likely to need splitting (chain identity vs. deep
generation vs. ACL/trace paths). Split on contact if it exceeds one PR — do not force it.
**Done when**: criteria met, `testDeepChainReach` / `testDeepSwitchChain` / `testDeepScanTrace`
/ `testInnerGatewayReach` / `testInnerGatewayScan` pass, human approves the commit.

### Slice 6a: Registry-backed lookups re-home onto the network and occupancy tables

**Value**: Every cross-player lookup stops depending on `network_registry`, with identical
observable results — the necessary, independently verifiable step before the table can go.
**Path**: The three lookup shapes (`findRegistryByPublicIp`, `findRegistryByOwnerKey`,
`findRegistryByMachineId`) read `network_public_ips` + `home_network_occupants` instead.
**Class**: Reduction transition.
**Required implementation skills**: `reduce-system-complexity` (governing), plus `testing` and
`mutation-testing` for preservation evidence. `tdd` RED is **`N/A`** — no behavior changes;
never fabricate a failing mechanism-shape test.
**Reduction program**: See the Reduction Program section; terminal slice is 6b.
**Transition/terminal evidence**: `behavior gate: pass` (full cross-player wire-check suite +
unit suite green, unchanged). Independent verification: each re-homed lookup covered by its
existing wire-check. Bridge: `network_registry` remains written but unread — owner: this plan;
removal condition: Slice 6b; bounded lifetime: must not outlive this plan.
`mechanism gate: pending — no net-reduction claim`.
**Acceptance criteria**: All cross-player scan / session / FS-read / write / trace behavior is
byte-identical before and after; no lookup reads `network_registry`; the table is still
present and still written.
**Preservation baseline**: The full existing wire-check suite plus the unit suite, green
before any change.
**Preservation change**: Re-point the three lookups; add the `workstation_machine_id` index on
`home_network_occupants` mirroring the registry's existing one; derive the gateway id from the
ESSID rather than reading `router_machine_id`.
**MUTATE or alternate evidence**: Mutation on the re-homed resolver modules where meaningful;
otherwise record `N/A` plus the wire-check integration evidence, which is the stronger signal
for `api/` correctness per the project's wire-check convention.
**Done when**: behavior gate passes, mechanism gate truthfully pending, human approves.

### Slice 6b: `network_registry` is deleted

**Value**: Retires the table, its index, its write path, and the occupancy-fallback special
case that existed only to survive its last-writer-wins eviction.
**Path**: Same trigger-to-outcome paths as 6a, now with the superseded mechanism gone.
**Class**: Terminal reduction.
**Required implementation skills**: `reduce-system-complexity` (governing), `testing`,
`mutation-testing` as applicable. `tdd` RED is `N/A`.
**Reduction program**: Terminal slice of the program above.
**Transition/terminal evidence**: Behavior gate passes; like-for-like mechanism gate passes
(table + index + write path + one dependency shape + one architecture invariant removed,
nothing equivalent reintroduced); the 6a bridge is gone.
**Acceptance criteria**:
- `network_registry` and its index no longer exist; a migration drops them.
- `registerNetwork` no longer writes it; `NetworkRegistryRow` is gone.
- The PR #306 occupancy-fallback special case is removed as a distinct concept — occupancy is
  simply the source.
- `conventions-and-gotchas.md` §7's "any cross-player by-`machine_id` resolver needs the
  occupancy fallback" invariant is deleted, and §7 records the new single-source rule.
- Every wire-check and unit test passes unchanged in behavior.
**Preservation baseline**: As 6a.
**Preservation change**: Drop the table, index, write path, and type; delete the fallback
branch; update all `scripts/test*.ts` that seed `network_registry` directly (**14 scripts
reference it** — grep before scoping).
**MUTATE or alternate evidence**: `N/A` for mutation on deleted code; evidence is the passing
wire-check suite plus the mechanism accounting.
**Done when**: both gates pass, superseded machinery gone, docs updated, human approves.

## Pre-PR Quality Gate

Before each PR, from `v2/`:
1. Mutation or reviewed `N/A` + alternate evidence (do NOT run Stryker while `vercel dev` is
   up — it reports false survivors, per conventions §4).
2. Refactoring / reduction assessment per the slice's class.
3. `npm run typecheck` (`tsc -b` — a plain `tsc --noEmit` is a no-op here) and `npm run lint`.
   There is no Prettier in v2.
4. Affected `scripts/test*.ts` wire-checks green against `vercel dev` (port 3100) + local
   supabase — `api/` type and DB-constraint correctness is not caught by `tsc`.
5. Version bump in `v2/package.json` + `v2/package-lock.json`
   (`npm install --package-lock-only`) for every feature slice.

## Out of Scope

- Procedural ESSID generation and injector tuning (epic item #6 — follows this plan).
- Pivot / operate-from-a-hop source-IP masking (epic item #2 — still needs its own grill).
- Presence/TTL heartbeat, WiFi-strength-as-density, matchmaking (epic item #7).

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
