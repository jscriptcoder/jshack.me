# Plan: Subnet Difficulty Layers

**Branch**: feature/subnet-difficulty-layers
**Status**: Active

## Goal

Redesign mission network topology so difficulty adds nested subnet layers, each requiring
its own entry variant to breach — making difficulty meaningful and multi-hop mandatory.

## Design

### Current State

- All difficulties: 1 router (public IP) → 1 flat subnet with 2-6 machines
- Difficulty controls machine count (2/3-4/4-6) and hop count (1/2/all)
- Hops are skippable — player can hydra any machine on the subnet directly
- Extra machines on harder missions serve no purpose

### Proposed State

```
Easy (1 layer):
  Router → [Subnet A: 2-3 machines incl. target]

Medium (2 layers):
  Router → [Subnet A: 2-3 machines] → Gateway → [Subnet B: 2-3 machines incl. target]

Hard (3 layers):
  Router → [Subnet A: 2-3 machines] → GW → [Subnet B: 2-3 machines] → GW → [Subnet C: 2-3 machines incl. target]
```

### Key Design Decisions

1. **Each subnet boundary has its own entry variant** (SSH, FTP, NC, exploit, HTTP, SNMP) —
   difficulty stacks entry challenges, not just machines.

2. **Gateways are dual-homed machines** with interfaces in both subnets — identical pattern
   to the existing outer router (eth0 = upstream subnet, eth1 = downstream gateway .1).

3. **Subnet isolation is enforced via NetworkConfig** — machines only see peers in their own
   subnet + the gateways on their boundary. Commands need NO changes because reachability is
   already data-driven via `getMachine(ip)`.

4. **Target always in deepest subnet** — the player must breach every layer to reach it.

5. **Each layer can independently be forwarded or router-first** — inner gateways follow the
   same `isForwardedMode()` probability as the outer router, per difficulty.

6. **Each layer has its own unique RFC 1918 subnet prefix** — e.g., Subnet A = `10.45.0`,
   Subnet B = `172.16.5`, Subnet C = `192.168.42`.

7. **Machine count per layer: 2-3** — total count: easy ~2-3, medium ~5-7 (+ gateway),
   hard ~8-11 (+ 2 gateways). Gateways count as machines in their upstream subnet.

8. **PRNG breaking change accepted** — multi-layer generation changes PRNG consumption.
   All seeds produce different missions. Acceptable since game is pre-1.0.

### Why Commands Don't Need Changes

All network commands (nmap, ssh, ping, ftp, nc, curl, hydra, scp) check reachability via
`getMachine(ip)` which reads from `NetworkContext.currentConfig.machines`. This list is
pre-computed per machine in `NetworkConfig.machineConfigs[currentMachineIp]`. If we generate
the config so subnet A machines don't include subnet B machines, isolation is automatic.

Example: Player on subnet A machine (10.45.0.5) runs `nmap("172.16.5.0/24")`. `getMachines()`
returns only subnet A peers — no subnet B machines match — nmap shows nothing. After hacking
the gateway and SSHing into it, `session.machine` changes to the gateway's IP, and
`getMachines()` now returns subnet B machines. `nmap("172.16.5.0/24")` works.

### Gateway Visibility Model

A gateway between Subnet A and Subnet B:
- Has IP in subnet A (e.g., 10.45.0.3) — this is how subnet A machines reach it
- Has gateway IP in subnet B (e.g., 172.16.5.1) — this is its eth1 interface
- `machineConfigs[10.45.0.3]` shows: subnet B machines + subnet A machines (both directions)
- Subnet A machines see the gateway as a regular peer (at 10.45.0.3)
- Subnet B machines see the gateway as their router (at 172.16.5.1)

## Acceptance Criteria

- [ ] Easy missions work identically to today (1 subnet, same machine count)
- [ ] Medium missions have 2 isolated subnets with a gateway between them
- [ ] Hard missions have 3 isolated subnets with gateways between each pair
- [ ] Player cannot nmap/ping/ssh machines in deeper subnet without hacking the gateway
- [ ] Each gateway has its own entry variant (independently chosen)
- [ ] Target is always in the deepest subnet
- [ ] All 8 objective types work with multi-subnet layouts
- [ ] Existing seed keywords work (difficulty, entryVariant, mode, objective overrides)
- [ ] Briefing reflects the layered structure appropriately
- [ ] All existing tests updated, new tests cover subnet isolation and multi-layer generation
- [ ] Seeded generation is fully deterministic

## Steps

### PR 1: Introduce SubnetLayer type and refactor topology internals

Restructure the internal topology generation to think in terms of subnet layers,
without changing any external behavior. Easy/medium/hard all still produce the same
output — just organized differently internally.

**Test**: Write tests that verify:

- `generateTopology` result includes a `layers` array
- For all difficulties, `layers` has exactly 1 entry (behavior unchanged)
- Each `SubnetLayer` has: `subnet` prefix, `gateway` machine, `entryVariant`, `machines`,
  `isForwarded` flag
- The flat `machines` and `networkConfig` fields are derived from `layers` consistently
- All existing topology tests still pass unchanged

**Implementation**:

- Add `SubnetLayer` type to `src/generation/types.ts`:
  ```
  { subnet, gateway, entryVariant, machines, isForwarded, natForwarding? }
  ```
- Add `layers: readonly SubnetLayer[]` to `TopologyResult`
- Refactor `generateTopology` to internally create a single `SubnetLayer`, then flatten
  it into the existing output shape
- Existing consumers (generateMission, attackChain, filesystem) continue reading the
  flat fields — no changes needed yet

**Done when**: All existing tests pass + new tests verify SubnetLayer structure.

---

### PR 2: Extract subnet generation into composable function

Factor out the per-subnet generation logic so it can be called N times for N layers.
Still generates only 1 layer for all difficulties.

**Test**: Write tests that verify:

- `generateSubnetLayer(prng, config)` produces a valid SubnetLayer with correct
  subnet prefix, gateway, machines, entry variant, and ports
- Gateway machine has role `'router'`, dual interfaces, correct hostname
- Machine count is within specified range
- Subnet prefix is unique (not colliding with provided `usedSubnets`)
- Entry variant assignment follows same distribution as current

**Implementation**:

- Extract machine generation, IP assignment, port building, role assignment, and
  network config building into `generateSubnetLayer()` in `src/generation/topology.ts`
- `generateTopology` calls `generateSubnetLayer` once and wraps the result
- The function accepts config: `{ minMachines, maxMachines, usedSubnets, entryVariantOverride? }`

**Done when**: Extracted function is tested independently + all existing tests pass.

---

### PR 3: Multi-layer topology generation for medium and hard

The core behavior change: medium generates 2 layers, hard generates 3 layers.

**Test**: Write tests that verify:

- Medium: `layers.length === 2`, hard: `layers.length === 3`, easy: `layers.length === 1`
- Each layer has a unique subnet prefix
- Each layer has its own independently chosen entry variant
- Gateway between layers N and N+1 exists as a machine in layer N
- Gateway has dual interfaces (eth0 in layer N subnet, eth1 as layer N+1 gateway .1)
- Machines in layer N cannot see machines in layer N+1 (verify via `networkConfig`)
- Machines in layer N+1 see their gateway at .1 but not layer N machines
- Gateway's `machineConfigs` entry shows machines from both adjacent layers
- Per-layer machine count: 2-3 (excluding gateway machines from count)
- Total machine count: easy ~2-3, medium ~5-7, hard ~8-11
- Each layer independently rolls forwarded/router-first (verify statistically)
- Deterministic for same seed

**Implementation**:

- Update difficulty config from `{ minMachines, maxMachines }` to `{ layers, machinesPerLayer }`
- Call `generateSubnetLayer` N times in a loop, passing `usedSubnets` to avoid collisions
- Create gateway machines connecting adjacent layers — reuse existing router generation
  pattern (dual interfaces, iptables for forwarded mode, credentials for router-first)
- Build `NetworkConfig` with per-subnet isolation:
  - Layer N machines see: own subnet peers + upstream gateway (at .1) + downstream gateway (at its layer N IP)
  - Gateway sees: both adjacent layer machines
- Flatten all layers into `machines` and `networkConfig` for backward compat
- Update `entryVariant` on `TopologyResult` to refer to outermost layer only
  (each inner layer's variant is on the `SubnetLayer`)

**Done when**: Multi-layer topology tests pass + existing easy-difficulty tests still pass.

---

### PR 4: Attack chain and objective placement across layers

Update the attack chain to place the target in the deepest subnet and handle
objective-specific concerns across layers.

**Test**: Write tests that verify:

- Target machine is always in the deepest layer (last in `layers` array)
- Easy: target in layer 0 (same as today)
- Medium: target in layer 1
- Hard: target in layer 2
- All 8 objective types generate valid objectives with multi-layer target
- `portforward` objective targets a gateway (not the outer router) when multi-layer
- `forensics` evidence spans multiple layers (logs on machines across subnets)
- `sabotage` targets a machine in the deepest layer
- `backdoor` targets a machine in the deepest layer
- Port closures skip gateway machines (gateways need SSH for pivoting)
- Credential leaks can appear on any layer's machines
- Encrypted exfiltrate key can be on a different layer than the target

**Implementation**:

- Update `buildMissionObjective` to receive `layers` and pick target from deepest
- Update `buildPath` — path now crosses layer boundaries via gateways
- Update `applyPortClosures` to protect gateway machines (like entry machines)
- Update `placeCredentialLeak` — can place on any reachable machine
- Special handling: `portforward` may target an inner gateway instead of outer router
- Special handling: `forensics` distributes evidence across layers

**Done when**: Attack chain tests verify correct target placement and objective generation.

---

### PR 5: Gateway filesystem generation

Generate realistic filesystem content for inner gateway machines — iptables rules,
host mappings, credentials for downstream subnet access.

**Test**: Write tests that verify:

- Gateway machines have `/etc/iptables/rules.v4` (forwarded mode: populated, router-first: template)
- Gateway machines have `/etc/hosts` with downstream machine hostnames
- Gateway machines have `/etc/hostname` and `/etc/passwd`
- Router-first gateways have downstream SSH credentials on filesystem (as breadcrumb)
- SNMP gateway variant has `/etc/snmp/snmpd.conf` with firewall OIDs
- Forwarded gateway NAT rules point to correct downstream entry machine ports
- Gateway filesystem permissions match existing router patterns

**Implementation**:

- Extend `generateFileSystems` to handle gateway machines using existing router filesystem
  patterns (already generates iptables, hosts, SNMP config for outer router)
- Factor out router filesystem generation into reusable function
- Apply to both outer router and inner gateways
- Each gateway's `/etc/hosts` lists only its downstream subnet machines

**Done when**: Filesystem tests verify gateway content + existing filesystem tests pass.

---

### PR 6: NAT resolution through gateway chain

Update NAT resolution so forwarded-mode gateways transparently forward traffic
to their downstream entry machines, matching the existing router NAT pattern.

**Test**: Write tests that verify:

- `resolveNat(gatewayIp, port)` resolves to downstream entry machine for forwarded gateways
- Non-forwarded (router-first) gateways don't resolve NAT
- Multi-hop NAT: outer router forwards to gateway, gateway forwards to inner machine
- Credentials validate against the resolved (innermost) machine, not the gateway
- Dynamic iptables rules (player-added via nano) work on gateways

**Implementation**:

- Update `NetworkContext.resolveNat` to check iptables on any machine with forwarding rules,
  not just the outer mission router
- Each gateway's `/etc/iptables/rules.v4` is parsed independently
- Multi-hop resolution: if resolveNat returns a gateway IP, check that gateway's rules too

**Done when**: NAT tests verify single and multi-hop resolution.

---

### PR 7: Briefing, mission board, seed overrides, and documentation

Update player-facing text and documentation to reflect the layered network model.

**Test**: Write tests that verify:

- Briefing includes network depth hint for medium ("layered network") and hard ("deeply segmented network")
- Seed keyword `entryVariant` applies to outermost layer only (inner layers are independent)
- Seed keyword `forwarded`/`router-first` applies to outermost layer only
- Mission board difficulty descriptions reflect the subnet model
- `parseSeedOverrides` still works for all existing keywords

**Implementation**:

- Update `formatMissionBriefing` in `accept.ts` — add network topology hint based on difficulty
- Review `missionBoard.ts` descriptions — update difficulty labels if needed
- Update `parseSeedOverrides` — existing keywords control outermost layer
- Update documentation:
  - `.claude/CLAUDE.md` — difficulty model, gateway machines
  - `.claude/docs/architecture.md` — multi-layer topology
  - `.claude/docs/infrastructure-design.md` — subnet isolation model
  - `.claude/docs/mission-variations.md` — difficulty axis now means layers
  - `src/generation/README.md` — generation pipeline changes

**Done when**: Briefing tests pass, docs are up to date, seed overrides work.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| PRNG sequence changes break all seeds | In-progress missions regenerate differently | Accept as pre-1.0 breaking change; clear mission on version bump |
| Machine count growth (up to ~11) | Slower generation, more complex for player | Cap at 2-3 per layer; keep easy identical |
| Gateway + router-first + SNMP combo | Very complex entry sequence | Limit SNMP to outer router only (inner gateways pick from ssh/ftp/nc/exploit/http) |
| `portforward` objective with inner gateways | Ambiguity about which router to configure | Target outermost router for portforward (no change needed) |
| `forensics` evidence across isolated subnets | Player can't see all logs from one machine | Distribute evidence; briefing hints at multi-subnet investigation |
| Forwarded-mode gateway NAT chains | Complex multi-hop resolution | Implement iterative resolveNat (resolve until stable) |

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. Typecheck and lint pass (`npm run build && npm run lint`)
4. Format check (`npm run format`)
5. All tests pass (`npm run test:run`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
