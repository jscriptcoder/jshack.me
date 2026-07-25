# Plan: Shared-Network Reconciliation

**Branch**: `feat/shared-network-reconciliation`
**Status**: Active — awaiting approval, no code written
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

- [ ] Two identities that join the same ESSID resolve the **same AP gateway machine**, and a
      third identity's `nmap <public IP>` returns the same gateway regardless of join order.
- [ ] A NAT forward published by one occupant is visible in another player's public scan of
      that AP, and reaching that port lands on the publishing occupant's box.
- [ ] No player has implicit access to an AP gateway: reading or writing its filesystem
      requires a session obtained through the normal crack-and-connect path.
- [ ] Bricking an AP gateway takes its public IP **permanently** dark, while the ESSID stays
      visible, crackable, joinable, and internally reachable between occupants.
- [ ] Two occupants of one ESSID never share a LAN address, and never land on an NPC's or the
      gateway's address; a reconnecting occupant gets the same address it had before.
- [ ] Two occupants of one ESSID see the **same** NPC hosts at the same addresses, and the
      same deep chains behind the same inner gateways.
- [ ] A file written to an NPC by one occupant is visible to another occupant of that ESSID
      (today this happens ~1 in 6 times *by accident* — see the aliasing note in Slice 4).
- [ ] Every occupant of a shared AP appears in every other occupant's `nmap` of the LAN — no
      occupant is hidden by an octet-reservation rule.
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

### Slice 1: Every occupant of an ESSID sees one shared AP gateway at `.1`

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

### Slice 2: Bricking an AP gateway kills the WAN but leaves the LAN alive

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
**RED**: A behavior test that bricks the gateway then asserts the WAN-dark / LAN-alive split;
extend `scripts/testRouterBrick.ts` + `scripts/testBrickedDark.ts` for the wire path.
**GREEN**: Separate the WAN gate (public scan / public session) from the LAN gate (occupant
resolution / same-LAN session) so `canBoot` on the gateway governs only the former.
**MUTATE**: Run on the boot/dark-gate paths — these are pure predicates and mutate well.
**KILL MUTANTS**: Address survivors distinguishing WAN-dark from LAN-dark.
**REFACTOR**: Assess only.
**Done when**: criteria met, both brick wire-checks pass, human approves the commit.

### Slice 3: Occupant LAN addresses come from a real DHCP lease

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
- An allocated octet never collides with the gateway (`.1`), a reserved address (`.0`/`.255`),
  or an NPC octet of that ESSID.
- A reconnecting occupant receives the **same** address it held before (permanent lease per
  `(essid, owner_key)`, no GC).
- Concurrent first-joiners of a fresh ESSID resolve to distinct addresses.
**RED**: Unit tests for the allocator over a fake store (collision → redraw; existing lease →
read-back; exhaustion → clean failure), then a wire-check.
**GREEN**: `network_lan_leases(essid, owner_key)` PK with a `UNIQUE (essid, octet)`
constraint; lazy allocate on join with `INSERT … ON CONFLICT` win-or-read and redraw on the
unique violation — the `allocatePublicIp` shape one level down. `assignHomeNetwork` stops
deriving `localIp`.
**MUTATE**: Run on the allocator. `scripts/testPublicIpAllocation.ts` is the template for the
new `scripts/testLanLeaseAllocation.ts`.
**KILL MUTANTS**: Address survivors in the redraw/exhaustion branches.
**REFACTOR**: Assess whether the two allocators share a seam worth extracting — only if it
adds value; do not force a generic allocator abstraction.
**Done when**: criteria met, new wire-check passes, human approves the commit.

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
**RED**: A behavior test asserting two distinct owner keys on one ESSID generate identical
host lists; and a test asserting an occupant previously hidden by the reservation rule is now
visible.
**GREEN**: Reseed `generateHomeLan` from the ESSID and drop the per-player seed parameter
(**14 production call sites + 5 scripts** — grep before scoping, per the project convention);
delete the octet-reservation branch in `mergeLanOccupants`.
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
**GREEN**: Reseed `computeInnerGatewayId` / `computeDeepGatewayId` / `generateDeepLayer` /
`seedNetworkDepth` and the switch-ACL seeding from the ESSID rather than the owner key.
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
