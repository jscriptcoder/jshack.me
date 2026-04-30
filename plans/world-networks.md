# Plan: World Networks

**Branch**: feat/world-networks
**Status**: Active

## Goal

Ship the `world_networks` infrastructure: persistent shared networks visible to every player, generated deterministically so all players see identical machine_ids. One initial themed row (`playground`) serves as the multiplayer smoke-test surface today; future content rows (office, police station, university, café) ship as data, not code.

This replaces the abandoned `test_networks` direction (PR #83). Same infrastructure cost, but the result is production-ready instead of a graft.

## Acceptance Criteria

- [ ] `world_networks` table with `(public_ip, seed, name, description, theme, created_at)`
- [ ] `'world_network'` added to `public_ips.kind` so reserved IPs live in the same registry; allocator's PK-conflict-retry naturally skips them
- [ ] One seeded `playground`-themed row that we can use to smoke-test cross-player visibility
- [ ] Client-side `listWorldNetworks()` reads the table directly via the anon-key Supabase client (RLS allows anon SELECT)
- [ ] `useWorldNetworks` hook returns `MissionNetwork[]` (the full networks, not just fileSystems — that was the bug in PR #83)
- [ ] `NetworkProvider` accepts a new `worldNetworks` prop and integrates them into:
  - `findMachineByIp` (so `nmap`, `ssh`, `curl` etc. resolve their IPs)
  - Localhost visibility (their routers visible from localhost like mission routers are)
  - `overrideCtx` (daemon state lookups for SSH/FTP/etc. on world machines)
  - `gatewayIps` (iptables / SNMP / ACL parsers run on their gateways)
- [ ] `FileSystemProvider` picks them up via the existing `homeFileSystems` merge
- [ ] Two browsers with different identities can `nmap` the playground, `ssh` in, write a file, and see each other's writes live without page reload

## Out of scope (later)

- Discovery UX: `nmap` / catalog browse / lore-driven IP leaks. For v1, world networks auto-appear in every player's view (cheapest, sufficient).
- Themed content beyond `playground`: office / police / university etc. are content rows, written when there's actual gameplay design to back them.
- Per-theme generator variants: all networks use the existing `generateMissionNetwork`. A theme-aware generator (different service mixes per theme) is a future content pass.
- Player ownership of world networks: world content is unowned. Player-run services (per the [shared networks taxonomy](../C--Users-User-Projects-jshack-me/memory/project_multiplayer_shared_networks.md)) is a separate concept.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.

### Step 1: Migration — `world_networks` table + extend `public_ips.kind` + seed

**Acceptance criteria**: New SQL migration. Creates `world_networks(public_ip PK, seed, name, description, theme, created_at)` with FK `public_ip → public_ips(ip) ON DELETE CASCADE`. Extends `public_ips.kind` enum with `'world_network'`. RLS: anon-readable. Seeds one row with `theme='playground'` at `203.0.113.42`.
**Done when**: `npm run db:reset` clean, both rows queryable.

### Step 2: Allocator skip tripwire

**Acceptance criteria**: One test in `src/ipRegistry/allocate.test.ts` framing the PK-conflict-retry contract specifically for `world_network` reserved IPs. No production code change.
**Done when**: tests green.

### Step 3: Client wrapper — `listWorldNetworks()` direct anon read

**Acceptance criteria**: `src/worldNetworks/client.ts` exports `listWorldNetworks(supabaseClient?): Promise<ReadonlyArray<WorldNetwork>>`. Direct query of `world_networks` via `getRealtimeClient()`. Graceful degradation (returns `[]` on null client or DB error). 6 tests.
**Done when**: tests green, mutation report clean, human approves commit.

### Step 4: `useWorldNetworks` hook + generation helper

**Acceptance criteria**: `generateWorldNetworks(rows, generator)` runs the (injected) generator per row with a fake allocator pinning each row's `public_ip`. Returns `ReadonlyArray<MissionNetwork>` (the full networks — not just fileSystems, which was the PR #83 mistake). `useWorldNetworks` hook fetches at mount, generates, exposes the array.
**Done when**: tests green, mutation report clean, human approves commit.

### Step 5: Extend `NetworkProvider` for world networks

This is the load-bearing step. The bug discovered in PR #83 lived here.

**Acceptance criteria**:

- New `worldNetworks?: ReadonlyArray<MissionNetwork>` prop on `NetworkProvider`
- `findMachineByIp` searches world networks' machines (in addition to mission + home)
- `gatewayIps` collector includes world network gateways (so iptables/SNMP/ACL parsers see them)
- Localhost visibility: world network routers added to the visible-machines list when on localhost (parallels the existing missionRouterMachine path)
- `overrideCtx` includes world networks for daemon state
- DNS records for world network domains added to localhost DNS view

Tests for each of these surfaces.

**Done when**: tests green, mutation report clean, human approves commit.

### Step 6: Wire into `App.tsx` + smoke

**Acceptance criteria**:

- App.tsx calls `useWorldNetworks()`
- Passes `fileSystems` slice merged into `homeFileSystems` for `FileSystemProvider`
- Passes the full `worldNetworks` array into `NetworkProvider`
- Two-browser smoke: `nmap 203.0.113.42` works, `ssh` works, write/refresh-not-needed cross-player visibility works.

**Done when**: gate green, smoke pass, human approves commit.

### Step 7: Pre-PR gate + module README

**Acceptance criteria**: build/lint/format/test green. New `src/worldNetworks/README.md` documents the feature (production framing, not "remove at release"). `docs/technology-choices.md` notes the world_networks layer alongside missions and home networks.

## Pre-PR Quality Gate

1. Mutation testing on new code
2. Refactoring assessment
3. Typecheck and lint pass
4. Manual smoke (two browsers, see each other write live on the playground)
5. Docs updated

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
