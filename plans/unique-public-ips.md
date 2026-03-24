# Plan: Collision-Aware Unique Public IP Generation

**Branch**: feat/unique-public-ips
**Status**: Active

## Goal

Extract duplicated IP generation into a shared utility and make public IP generation collision-aware, ensuring no two networks share the same public IP within a game session.

## Acceptance Criteria

- [ ] No duplicated IP generation code between `topology.ts` and `generateHomeNetwork.ts`
- [ ] `generatePublicIp` accepts an optional `usedIps` set and never returns a duplicate
- [ ] `generatePrivateSubnet` is shared (already duplicated — extract alongside)
- [ ] All existing tests pass unchanged
- [ ] New tests cover collision avoidance behavior
- [ ] Home network generation passes used IPs through so multiple WiFi networks get unique public IPs
- [ ] Mission generation receives used IPs (home network public IPs) to avoid overlap

## Steps

### Step 1: Extract shared IP utilities (pure refactor)

**Test**: Write tests for `generatePublicIp` and `generatePrivateSubnet` as standalone functions in a new `src/generation/ip.test.ts`. Tests verify:
- Public IP format matches `{firstOctet}.{1-254}.{1-254}.{2-254}`
- First octet is from the known pool of 12 prefixes
- Private subnet produces valid RFC 1918 addresses in all three ranges
- Deterministic: same seed produces same result
- `publicFirstOctets` is exported and contains exactly the 12 known prefixes

**Implementation**: Create `src/generation/ip.ts` exporting:
- `publicFirstOctets`
- `generatePublicIp(prng: Prng): string`
- `generatePrivateSubnet(prng: Prng): string`

Update `topology.ts` and `generateHomeNetwork.ts` to import from `ip.ts` instead of defining locally.

**Done when**: All new tests pass, all existing tests pass, no duplicated IP code remains.

### Step 2: Add `usedIps` collision avoidance to `generatePublicIp`

**Test**: In `ip.test.ts`, add tests:
- When `usedIps` contains the would-be IP, function retries and returns a different IP (use a seeded PRNG where the first result is known, pre-populate `usedIps` with that result)
- When `usedIps` is omitted/empty, behavior unchanged (deterministic output matches Step 1 tests)
- Generates many IPs in a loop feeding results back into `usedIps` — all unique

**Implementation**: Change signature to `generatePublicIp(prng: Prng, usedIps?: ReadonlySet<string>): string`. When `usedIps` is provided, retry (re-roll all four octets) if the generated IP is already in the set. Add a safety cap (e.g., 100 attempts) that throws if the space is somehow exhausted.

**Done when**: Collision avoidance tests pass, existing tests still pass (no `usedIps` arg = same behavior).

### Step 3: Wire `usedIps` through home network generation

**Test**: In `generateHomeNetwork.test.ts`, add a test: generate multiple home networks (varying `wifiIndex`) for the same game seed, collect their `router.publicIp` values, assert all unique.

**Implementation**: `generateHomeNetwork` already receives `gameSeed` and `wifiIndex`. The caller (`useHomeNetworks.ts`) maps over WiFi networks with `.map()`. Change this to a `.reduce()` or loop that accumulates `usedIps` across iterations, passing the growing set into each `generateHomeNetwork` call. This requires adding an optional `usedIps?: ReadonlySet<string>` parameter to `generateHomeNetwork`.

**Done when**: Home network public IPs are guaranteed unique across all WiFi networks in a game session.

### Step 4: Wire `usedIps` through mission generation

**Test**: In `generateMission.test.ts`, add a test: generate a mission with `usedIps` containing a known IP, verify the mission's `routerPublicIp` differs from it.

**Implementation**: Add optional `usedIps?: ReadonlySet<string>` to `generateTopology`'s overrides object (or as a direct parameter). Pass it through to `generatePublicIp`. Update `generateMission` to accept and forward `usedIps`. Update the mission acceptance call site to pass in current home network public IPs.

**Done when**: Mission public IPs never collide with home network public IPs or other active mission public IPs.

### Step 5: Update docs

**Implementation**: Update `CLAUDE.md`, `architecture.md`, and `infrastructure-design.md` to document:
- The shared `ip.ts` utility
- Collision avoidance behavior
- How `usedIps` flows through generation

**Done when**: Docs reflect the new architecture.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. Typecheck and lint pass
4. DDD glossary check (if applicable)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
