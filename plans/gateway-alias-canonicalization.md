# Plan: Gateway-Alias Canonicalization

**Branch (plan)**: `feat/gateway-alias-canonicalization-plan`
**Branch (impl, future)**: `feat/gateway-alias-canonicalization`
**Status**: Active

## Goal

Translate ANY gateway LAN-side `.1` alias (home router AND inner-layer switch/router gateways) to the gateway's canonical primary IP inside `targetMachineIdFor`, so writes via `.1` and writes via the canonical IP land in the **same** `patches` row.

## Why

Today, when a player SSHes into the home router and writes `/etc/iptables/rules.v4`, the storage path is keyed by whichever IP the user addressed — typically the `.1` LAN-side alias (e.g., `10.222.193.1`). Other code paths (cross-LAN subscriptions, Realtime channel keys, `homeFileSystems` rebuild) use the router's **public IP** (e.g., `51.181.215.243`). Same machine, two storage keys, two universes that never converge.

This is the **storage hygiene foundation** for the cross-LAN work that follows:

- Problem B (LAN-side hides forwarded ports) — depends on a clean inside/outside distinction; today the merged-view collapse hides the bug.
- Problem C (cross-LAN seed-regen + `useForeignNetworks`) — depends on every router's writes being findable under one canonical key when a remote player subscribes.

A defensive prereq (L2 `ORDER BY created_at DESC` on the single-row `findActiveSession` query) ships separately in PR #143 — required so stacked sessions (`ssh user` → `su root`) resolve to the foreground tier deterministically once canonical writes start arriving on the router's public IP.

The original closed PR #142 included this fix as commit `d04ee12` but scoped to the home router only. This plan **broadens scope to ALL gateway aliases** (home + inner-layer) per the design decision on 2026-05-18.

## Acceptance Criteria

[Behaviour-driven; describe observable outcomes the system exhibits, not internal mechanism.]

- [ ] Writing to a home router via its `.1` LAN-side alias lands in the same `patches` row as writing via its public IP.
- [ ] Reading the home router's filesystem via its `.1` LAN-side alias returns the same content as reading via its public IP.
- [ ] Writing to an inner-layer gateway via its `.1` alias (medium/hard topology) lands under that gateway's canonical primary IP.
- [ ] The player's own LAN IP continues to resolve to their own hostname — no regression on self-targeting.
- [ ] LAN-occupant IPs continue to resolve to occupant hostnames — no regression on cross-player workstation targeting.
- [ ] Mission machine IPs and world machine IPs continue to pass through unchanged.
- [ ] Pathological collision (player's `ownLanIp == .1`) — `ownLanIp` precedence wins (resolves to own hostname, not gateway canonical IP).
- [ ] Existing 11 `targetMachineIdFor` tests + all 4489 project tests still pass.

## Steps

Each step follows **RED → GREEN → MUTATE → KILL → REFACTOR**. No production code without a failing test. Tests describe behaviour (what the function returns / what the system shows the user), not implementation (what was called internally).

### Step 1: Add `buildGatewayCanonicalIpMap` helper

Pure function in `src/network/networkUtils.ts` that mirrors the existing `buildGatewayAliasMap` but returns a slim `ReadonlyMap<aliasIp, canonicalIp>` — values are the gateway's primary `.ip`, not the full `GeneratedMachine`. Used by the call sites in Steps 3 and 4 so `targetMachineIdFor` doesn't need a `GeneratedMachine` dependency just to read `.ip`.

**RED**: For a `HomeNetwork` with home router (primary IP `X`, `.1` alias `A`) and one inner-layer router (subnet `S`, primary IP `Y`), the returned map equals `{A → X, S.1 → Y}`. Empty / null input returns an empty map.

**GREEN**: Iterate the entries of `buildGatewayAliasMap(homeNetwork)` and project the value from the `GeneratedMachine` to its `.ip`.

**MUTATE**: Run mutation testing on the new helper.

**KILL MUTANTS**: Address survivors. Likely candidates: empty-map handling, layer-0 vs inner-layer distinction.

**REFACTOR**: Consider whether `buildGatewayAliasMap` and the slim helper should share a common iteration. Defer unless duplication clearly hurts.

**Done when**: New test passes, no mutants survive, `npm run lint` + `npm run build` clean, no other tests regress.

### Step 2: Extend `targetMachineIdFor` to translate gateway aliases

Add a 6th parameter `gatewayAliasMap?: ReadonlyMap<string, string>` to `targetMachineIdFor` in `src/homeNetworks/homeNetworkHelpers.ts`. Defaults to `undefined` so the legacy passthrough behaviour stays intact for callers that haven't wired it yet (tests, transitional code paths).

Translation order:

1. `ownLanIp` match → `ownHostname` (existing — pinned highest so a pathological occupant-at-`.1` still self-targets correctly)
2. **NEW**: `gatewayAliasMap.get(targetIp)` → canonical IP (when the map is supplied AND the target matches an alias)
3. `activeSubnet` + occupant match → occupant.hostname (existing)
4. Passthrough (existing)

**RED**: Tests describe observable behaviour the helper exhibits:

- Given a home router whose `.1` alias maps to its public IP in `gatewayAliasMap`, the helper returns the public IP when called with the `.1` IP.
- Given an inner-layer router whose `.1` alias maps to its primary IP, the helper returns the primary IP.
- Given a player whose `ownLanIp` happens to equal a gateway alias IP (pathological — should never happen with the DHCP allocator, but defensively pinned), the helper returns the player's hostname (not the gateway's canonical IP).
- Given a non-`.1` LAN-occupant IP on the active subnet, the helper still returns the occupant's hostname (gateway map does NOT shadow occupant translation).
- Given a `.1` IP and an empty/omitted `gatewayAliasMap`, the helper passes through unchanged (legacy behaviour preserved).
- Mission/world machine IPs not in the map pass through unchanged.

**GREEN**: Insert the alias-map lookup between the existing `ownLanIp` check and the `activeSubnet` early-returns. Pure functional; no mutations.

**MUTATE**: Run mutation testing on the helper.

**KILL MUTANTS**: Likely survivors — precedence ordering, null/undefined handling on the map argument. Address each with a targeted test.

**REFACTOR**: Tighten the inline comment that documents the precedence order so future readers understand why `ownLanIp` precedes the gateway translation.

**Done when**: New tests pass, mutation testing reports no survivors, all 11 existing `targetMachineIdFor` tests still pass.

### Step 3: Extend `occupantAwareReadNode` symmetric

`occupantAwareReadNode` in `src/homeNetworks/homeNetworkHelpers.ts` wraps a `readNode` to apply the same IP→machineId translation on the read side. Add the alias map parameter so reads via `.1` resolve to the canonical key.

**RED**: A `readNode` wrapped by `occupantAwareReadNode` with a configured `gatewayAliasMap`, when called with a `.1` machineId, reads from the canonical primary IP key.

**GREEN**: Thread the alias map through the wrapped call.

**MUTATE**: Run mutation testing on the wrap.

**KILL MUTANTS**: Address survivors (parameter forwarding, default handling).

**REFACTOR**: N/A — wrap remains a thin pass-through.

**Done when**: Read symmetry verified — write via `.1` and read via canonical IP retrieve the same content (Step 6 verifies the full chain end-to-end).

### Step 4: Wire the alias map into `useNetworkCommands.resolveTargetMachineId`

`src/hooks/useNetworkCommands.ts:104-105` builds `resolveTargetMachineId` from `targetMachineIdFor`. Compute the slim alias map once via `useMemo(() => buildGatewayCanonicalIpMap(activeNetwork), [activeNetwork])` and pass to the helper.

**RED**: Browser-mode component test mounts a component that exercises `resolveTargetMachineId` through a `useNetworkCommands` consumer. With an `activeNetwork` containing a home router (public IP `P`, `.1` alias `A`), calling `resolveTargetMachineId(A)` returns `P`. With no active network, returns the input unchanged.

**GREEN**: Compute the alias map via `useMemo`, pass to `targetMachineIdFor`.

**MUTATE**: Run mutation testing on the hook wiring.

**KILL MUTANTS**: Address survivors. Likely candidates: memo-dep correctness (map recomputes when `activeNetwork` changes), null-network handling.

**REFACTOR**: Consider extracting a shared `useResolveTargetMachineId` hook to deduplicate the two call sites (this one + Step 5). Defer unless deduplication clearly wins.

**Done when**: New behaviour verified; existing `useNetworkCommands` tests still pass.

### Step 5: Wire the alias map into `Terminal.tsx.resolveTargetMachineId`

`src/components/Terminal/Terminal.tsx:134-142` builds a second `resolveTargetMachineId` (mirrors the one in `useNetworkCommands` — see the deduplication note in Step 4's REFACTOR). Same wiring: build the slim alias map, pass to `targetMachineIdFor`.

**RED**: Test exercises an authentication flow (`useAuthentication`) where a player SSHes into the home router via its `.1` alias. The resulting session row's `machine_id` is the canonical public IP, not the `.1` IP.

**GREEN**: Compute and pass the alias map.

**MUTATE**: Run mutation testing.

**KILL MUTANTS**: Address survivors.

**REFACTOR**: If Step 4's refactor extracted a shared hook, replace this site with the shared hook. Otherwise leave parallel.

**Done when**: SSH authentication via `.1` creates a session keyed by canonical IP; verified through behavioural assertion, not internal call inspection.

### Step 6: End-to-end write-via-`.1`, read-via-canonical-IP

Integration test exercising the full path through the application. Player edits a file on the home router by addressing the router's `.1` alias (e.g., via SSH + `nano /etc/iptables/rules.v4`), then a separate command reads the same path via the router's public IP. Content matches.

**RED**: Browser-mode integration test simulates: (a) authenticated write to the home router via `.1` using a real command (`cp`, `nano`, or `echo > path`), (b) read of the same path via the canonical IP using a different command. Asserts content is identical.

**GREEN**: All Steps 1-5 already deliver the behaviour; this step is verification of the contract holding through the application stack.

**MUTATE**: N/A — this is a high-level integration test, not a unit under mutation.

**REFACTOR**: N/A.

**Done when**: End-to-end test passes consistently (no flake).

### Step 7: Realtime subscription keyset audit + invariant test

`useFileSystemSync.machineIdsKey` in `src/filesystem/useFileSystemSync.ts:217-223` subscribes to `[workstationId, homeFileSystems keys, missionFileSystems keys, lanOccupantHostnames]`. `homeFileSystems` is keyed by canonical primary IPs (the home router's public IP is the key — see `generateHomeNetwork.ts` line ~123 where `network.fileSystems` is spread into the home network's `fileSystems`). So the Realtime subscription **already** uses the canonical key for the home router and gateway-alias canonicalization is consistent with the subscription side.

This step verifies (does not change) that contract via an invariant test and a module-level doc comment.

**RED**: Defensive test asserting `homeFileSystems` keys produced by `generateHomeNetwork(...)` do NOT contain any `.1` alias IPs. If a future generator change starts double-storing under both keys, this test fails loudly.

**GREEN**: Add the invariant test in `generateHomeNetwork.test.ts`. Add a doc comment to `homeNetworkHelpers.ts` documenting the contract (the alias map relies on `fileSystems` being keyed by canonical IPs, not aliases).

**MUTATE**: N/A — defensive invariant.

**REFACTOR**: N/A.

**Done when**: Invariant test in place; documentation captures the contract.

## Pre-PR Quality Gate

Before opening the implementation PR:

1. **Mutation testing** — run `mutation-testing` skill on `buildGatewayCanonicalIpMap` and `targetMachineIdFor`. No surviving mutants without justified equivalence.
2. **Refactoring assessment** — run `refactoring` skill. Decide on the shared-hook extraction (Step 4 REFACTOR).
3. **Typecheck + lint** — `npm run build` and `npm run lint` both clean.
4. **Full test run** — `npm run test:run` reports 4489+ tests passing (no regressions from steps 1-7).
5. **DDD glossary** — N/A; this is networking-infra code, no domain language.

## Post-merge smoke

Manual verification of the storage-key contract holding end-to-end. The cross-player observation parts wait for Problem C (cross-LAN seed-regen); this smoke covers the single-player + same-LAN cases.

1. Single-player: SSH into the home router via `.1`, write `/etc/iptables/rules.v4`. Query the `patches` table — row should have `machine_id` = router's public IP.
2. Single-player: SSH into the home router via its public IP (if the route exists; otherwise, after Problem C lands). Read the same file. Content should match the `.1`-side write.
3. Same-LAN cross-player (when Player B is in the same LAN): Player A writes via `.1`; Player B's `applyPatches` against the router (keyed by public IP) shows A's edits.
4. Smoke `testL2Bypass.ts` (per `CLAUDE.md` references) to verify no L2 enforcement regression from the new write keys.

## Risks & followups

- **Forced-canonical reads elsewhere**: any code path that reads patches keyed by `<subnet>.1` directly (bypassing `targetMachineIdFor` / `occupantAwareReadNode`) would still fail. Step 7's invariant test catches the generator side; a manual grep audit during implementation (search for `.1'` string literals, `internalIp` direct uses, `routerInternalIp` references) confirms no other direct-keyed read paths exist.
- **Workstation `ownLanIp == .1` pathological case**: forbidden today by the DHCP allocator (occupants get host octets in a range that excludes `.1`), but Step 2's test pins the precedence so a future allocator change can't silently break self-targeting.
- **Inner-layer gateway whose `.ip` already equals `.1`**: the slim alias map produces a self-loop entry (`'192.168.2.1' → '192.168.2.1'`), which is a harmless no-op. Step 2's tests cover this case implicitly via the inner-layer translation test.
- **Backward compatibility**: per `feedback_no_backward_compat`, no live players, free to break. The optional-parameter shape (`gatewayAliasMap?`) is for incremental wiring within this PR, not for external compatibility — defaults can be removed once all call sites are migrated (potentially in a follow-up commit on the same PR).

## Related work

- [Memory: project_cross_lan_seed_regen_approach](../memory/project_cross_lan_seed_regen_approach.md) — sequencing context; lists what to keep from closed PR #142.
- PR #143 — defensive L2 `ORDER BY` prereq (in review).
- Closed PR #142 commit `d04ee12` — original home-router-only canonicalization; this plan generalises scope to ALL gateways per 2026-05-18 decision.
- Followup: Problem B (LAN-side `nmap` hides forwarded ports) — depends on Problem A being clean.
- Followup: Problem C (cross-LAN seed-regen + `useForeignNetworks`) — depends on canonical write keys (this plan).

---

_Delete this file when the implementation PR merges to `main`. If `plans/` is empty after, delete the directory._
