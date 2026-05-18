# Plan: LAN-side `nmap` hides forwarded ports (Problem B, broadened)

**Plan branch**: `feat/lan-hides-nat-forwards-plan`
**Impl branches** (each its own PR): `feat/snmpset-canonicalize-write`, `feat/canonicalize-gateway-state-reads`, `feat/lan-side-hides-nat-forwards`
**Status**: Active

## Goal

LAN-side scans of a gateway show only the gateway's own ports — NAT-forwarded ports stay invisible from inside the LAN (real iptables PREROUTING semantic). Reaching that goal cleanly first requires closing two Problem A coverage gaps so writes and reads on gateway state agree on a single canonical key.

## Why

Problem A (PR #145) canonicalized writes via `targetMachineIdFor` for callers that route through `useNetworkCommands` / `Terminal.tsx`, and canonicalized override reads via `readNodeForOverrides`. Smoke testing surfaced two leaks:

1. **Write-side leak — `snmpset`** (`src/commands/snmpset.ts:230-236`): the command receives the raw `writeFileToMachine` (not `logFs.writeFileToMachine`) in `useNetworkCommands.ts:772-794`, so it passes the user-typed gateway IP straight through. `snmpset 192.168.1.1 ...` writes the snmpd.conf patch under `192.168.1.1` while SSH+nano on the same gateway writes under the canonical public IP.
2. **Read-side leak — gateway-state memos** (`src/network/NetworkContext.tsx:217-284`): `allIptablesRules`, `allSnmpOverrides`, `allAclRules`, and `allSnmpAclOverrides` iterate `gatewayIps` (which already contains both `.1` and canonical entries) and call raw `getNodeFromMachine` per IP — they never canonicalize, so the maps end up double-keyed with diverging content. `applyDynamicOverrides:409,525` then does `ctx.<map>.get(machine.ip)`, picking up only the patches that happen to land under the same key the viewer is using. That produces an **inverse asymmetry** today: `snmpset` changes show on LAN scans but not WAN; iptables changes show on WAN but not LAN. `applyAclFiltering:361-373` already papers over the symptom with a reverse-lookup workaround — evidence that the underlying disagreement bites broadly.

Both gaps must be closed before the intended Problem B (split the LAN-side branch in `applyDynamicOverrides`) is meaningful. Without (1) and (2), the LAN-side scan still partly hides forwards by accident (state-lookup drift), and a future fix to the canonicalization would silently re-expose them.

Per `feedback_grep_all_call_sites_when_replacing_a_pattern`: the audit (see Risks) confirms `snmpset` is the only direct `writeFileToMachine` caller targeting gateway IPs. Other direct callers either target session-bound IPs already canonicalized at session creation (`useRedisCommands.ts:89`, `useMysqlCommands.ts:83`) or receive `context.writeFileToMachine` from a wrapped source (`commands/ftp/get.ts:149`, `commands/ftp/put.ts:149`, internal mutations).

## Acceptance Criteria

Behaviour-driven; each criterion describes observable system behaviour, not internal mechanism.

- [ ] **`snmpset` write canonicalizes.** After `snmpset 192.168.1.1 private firewallSSH=permit` on a home router whose canonical IP is `45.x.y.z`, the resulting `patches` row's `machine_id` is `45.x.y.z` — not `192.168.1.1`.
- [ ] **SNMP firewall changes are symmetric across LAN and WAN views.** After the snmpset above, both `nmap 192.168.1.1` (from inside the LAN) and `nmap 45.x.y.z` (from outside) show port 22 OPEN on the router.
- [ ] **iptables forwards are visible from WAN view.** After SSH-ing into the router and adding a forward rule via nano on `/etc/iptables/rules.v4`, `nmap 45.x.y.z` from outside shows the forwarded port.
- [ ] **iptables forwards are INVISIBLE from LAN view.** The same forward rule does NOT appear in `nmap 192.168.1.1` from inside the LAN — the LAN scan shows only the router's own ports. No "forwarded" marker, no compromise. (PREROUTING semantic.)
- [ ] **Inner gateways behave the same.** A home network with a multi-layer topology (e.g., inner subnet `10.0.1.0/24` with gateway primary IP `10.0.0.50`, aliased at `10.0.1.1`): snmpset/SSH writes via `10.0.1.1` produce patches keyed by `10.0.0.50`; nmap from inside the inner subnet against `10.0.1.1` hides forwards; nmap against `10.0.0.50` from a higher layer shows forwards.
- [ ] **Switch-gateway ACL changes stay symmetric.** A switch ACL change via `snmpset … aclSSH=allow` affects downstream port visibility identically whether the downstream machine is scanned from inside-the-LAN or from upstream — switches filter on packets in both directions, not just WAN-side. (Validates that we only special-case the NAT-merge step, not the ACL filtering step.)
- [ ] **No regression on player's own LAN IP, mission machines, world-network gateways, or LAN-occupant workstations.**
- [ ] **L2 enforcement unaffected.** `scripts/testL2Bypass.ts` and `scripts/testL2BypassWorkstation.ts` continue to report green.
- [ ] **Full test suite green.** `npm run test:run` reports no new failures.

## PR Decomposition

Three independently mergeable PRs, in order. Each PR ships with its own behaviour tests and is independently revertable. Per `feedback_no_backward_compat` no migration concerns.

### PR 1 — Close the write-side gap on `snmpset`

Branch: `feat/snmpset-canonicalize-write`. Smallest of the three; lands first so subsequent reads behave correctly.

### PR 2 — Close the read-side gap on gateway-state memos

Branch: `feat/canonicalize-gateway-state-reads`. Eliminates the dual-key drift in `allIptablesRules` / `allSnmpOverrides` / `allAclRules` / `allSnmpAclOverrides`. Deletes the now-redundant alias workaround in `applyAclFiltering`.

### PR 3 — Skip NAT merge on LAN-side gateway views

Branch: `feat/lan-side-hides-nat-forwards`. The actual Problem B — by-design strict-realism asymmetry. Lands last because the underlying state must be uniform first.

---

## Steps

Each step follows **RED → GREEN → MUTATE → KILL → REFACTOR**. Tests describe what the player observes; no test asserts which function was called internally. Project test conventions (factory functions, no `let`/`beforeEach`, no metadata-only tests — see `CLAUDE.md` Testing Guidelines) apply throughout.

---

### PR 1: `snmpset` write canonicalizes

#### Step 1.1: snmpset writes use the canonical machineId for patch + transient session

**RED**: A test exercising `createSnmpsetCommand` through the same wiring `useNetworkCommands` uses. Set up: a home router with `.1` alias `192.168.1.1` and canonical public IP `45.0.0.1`. Run `snmpset('192.168.1.1', 'private', 'firewallSSH=permit')`. Assert:

- The `writeFileToMachine` call receives `machineId: '45.0.0.1'` (canonical), not `'192.168.1.1'`.
- The `withTransientAuthSession` call's `params.machine_id` is `'45.0.0.1'`.

Phrased as a behavioural test at the wiring layer: "given a player addresses the router by its `.1` alias, the resulting state-mutating side effects target the canonical IP". This is observable as the patch row's key after the command finishes — that's what the player ultimately sees through subsequent reads.

Test file: extend `src/hooks/useNetworkCommands.test.tsx` (or its current sibling) with a focused suite. Avoid touching `src/commands/snmpset.test.ts` — at the snmpset level the canonicalization happens in the context the wiring supplies, so the unit-level snmpset tests remain unchanged.

**GREEN**: In `src/hooks/useNetworkCommands.ts` at the snmpset wiring site (currently lines 772-794):

- Replace the `writeFileToMachine` arg with `logFs.writeFileToMachine` (the already-canonicalizing wrapper).
- In the `withTransientAuthSession` arg, change `machine_id: params.machine_id` to `machine_id: resolveTargetMachineId(params.machine_id)`.

Both changes are purely wiring — no `snmpset.ts` source change required.

**MUTATE**: Manual mutation testing against the changed lines.

- Mutant: revert `logFs.writeFileToMachine` back to bare `writeFileToMachine` → test should fail.
- Mutant: drop `resolveTargetMachineId` from the transient session line → test should fail.
- Mutant: pass `params.machine_id` to both, ignoring `targetIP` → same test fails.

If any mutant survives, add a focused assertion (e.g., explicit canonical-IP check on `transientSessionCalls[0].machine_id`).

**KILL MUTANTS**: Address each survivor. Likely surface: missing assertion on the transient-session arg vs only the write arg.

**REFACTOR**: Consider whether the snmpset wiring deserves its own helper (similar to how `createSnmpsetCommand`'s context is already factored). Defer unless duplication clearly emerges — the wiring is one call site.

**Done when**: New test green; full suite green; mutation testing reports zero survivors.

#### Step 1.2: Audit + invariant test for `writeFileToMachine` callers targeting gateway IPs

**RED**: A grep-based invariant test (or a documented audit checklist in the PR description) verifies that the only direct `writeFileToMachine` callers in `src/commands/**` that pass user-typed IPs (rather than session-bound machineIds) route through `logFs.writeFileToMachine` at the wiring site.

Concretely: a static check (could be a small Vitest test that walks the AST or uses simple regex with `fs.readFileSync` of the source tree) asserts the audit is up to date — listing the call sites and their wrapping status. If a new direct caller lands without canonicalization, the test surfaces it.

Pragmatic alternative if the static check is too heavyweight: a one-time audit recorded in the PR description with explicit listing of each direct caller and whether it routes user-typed IPs. Lower confidence but lower complexity. Plan author defers the choice to implementation time; both achieve the same risk mitigation.

**GREEN**: If the AST/regex test is chosen, write it. Otherwise document the audit results in the PR.

**MUTATE**: N/A for an audit-style check.

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: Audit recorded (either as a test or in the PR body) with a list of every `writeFileToMachine` call site and its canonicalization status.

#### PR 1 Quality Gate

1. Mutation testing (Step 1.1).
2. Typecheck + lint (`npm run build`, `npm run lint`).
3. Full test suite (`npm run test:run`).
4. Smoke against running dev environment (manual): run `snmpset 192.168.1.1 private firewallSSH=permit` in a home network and inspect the Supabase `patches` table to confirm `machine_id` is the canonical IP.

---

### PR 2: Read-side canonicalization for gateway-state memos

This PR has the largest blast radius. Plan to land it on a quiet branch with extra mutation testing.

#### Step 2.1: Make `allIptablesRules` canonical-keyed

**RED**: A test at the `NetworkContext` consumer level. Given: a home network with router at canonical `45.0.0.1` aliased to `192.168.1.1`. Given: a patch on `/etc/iptables/rules.v4` for machine_id `45.0.0.1`. Expected: `allIptablesRules.get('45.0.0.1')` returns the parsed rules, AND `allIptablesRules.get('192.168.1.1')` ALSO returns the SAME rules (canonical-key lookup transparent to either alias key). The map keys are canonical-only after the change.

(Alternative wording, equally valid: assert that `applyDynamicOverrides` invoked on a `.1`-keyed `RemoteMachine` view picks up the iptables rules patch that was written to the canonical key. This phrasing tests the observable outcome — the LAN view sees the patched content — without locking in the memo's internal key shape.)

Use the second phrasing in the failing test, since it describes player-visible behaviour.

**GREEN**: In `src/network/NetworkContext.tsx`, refactor the `allIptablesRules` memo (currently lines 217-227) to:

1. Iterate `gatewayIps` and read each.
2. Use `buildGatewayCanonicalIpMap(homeNetwork)` (already exists from Problem A) to fold alias entries into their canonical key during map construction.
3. The resulting map has canonical-IP keys only; LAN-side and WAN-side lookups both resolve through the alias map.

Update `applyDynamicOverrides:409` to canonicalize `machine.ip` before lookup (use `ctx.homeGatewayByAliasIp.get(machine.ip)?.ip ?? machine.ip` — or a new `ctx.gatewayAliasMap` that mirrors `buildGatewayCanonicalIpMap`).

Either approach is acceptable. Plan recommends the latter (introduce `ctx.gatewayAliasMap: ReadonlyMap<string, string>` on `DynamicOverrideContext`) to keep the call sites concise and avoid scattering `homeGatewayByAliasIp` unwrapping logic. Tradeoff: one extra context field vs cleaner call sites. Lean cleaner.

**MUTATE**: Mutation surface:

- Strip the alias fold during memo construction → patches keyed under `.1` survive only there, LAN view shows them but WAN does not (test fails).
- Drop the lookup canonicalization in `applyDynamicOverrides` → mirror failure.
- Use the alias map's value as the lookup key (off-by-one error of direction) → tests fail.

**KILL MUTANTS**: Address each. The behaviour test should already cover most; add focused unit tests if any survive.

**REFACTOR**: After Step 2.1 lands, `allIptablesRules`/etc. all share the same pattern — fold via alias map. Consider extracting a helper `buildCanonicalKeyedRulesMap(gatewayIps, readNode, aliasMap, parser)` and using it for all four memos. Defer to Step 2.5 after the four parallel changes ship so duplication is visible.

**Done when**: Test green. Full suite green. No mutants survive.

#### Step 2.2: Make `allSnmpOverrides` canonical-keyed

Same shape as Step 2.1. Behaviour test: after `snmpset` write at canonical IP, `nmap` from `.1` reflects the firewall override.

#### Step 2.3: Make `allAclRules` canonical-keyed + delete the workaround

Same shape. Behaviour test: ACL deny rule on a switch gateway (whose `.1` alias is `10.0.1.1` and canonical is `10.0.0.50`) is visible to both LAN-side and WAN-side dynamic-override lookups against the switch's downstream subnet machines.

**Additional refactor**: After this step, the alias workaround in `applyAclFiltering:361-373` is redundant. Delete it (and the dependent fields like `aliasAclRules`/`aliasSnmpAclOverrides`) in this step's REFACTOR phase. Verify the existing switch-ACL tests still pass with the simpler implementation.

#### Step 2.4: Make `allSnmpAclOverrides` canonical-keyed

Same shape; covers the SNMP ACL OID path (`snmpset 10.0.1.1 private aclSSH=allow` on a switch gateway).

#### Step 2.5: Extract shared helper for canonical-keyed memos (REFACTOR)

After Steps 2.1-2.4 have green tests, all four memos in `NetworkContext.tsx` share the same shape. Extract:

```ts
const buildCanonicalKeyedRulesMap = <T>(
  gatewayIps: readonly string[],
  readNode: NodeReader,
  aliasMap: ReadonlyMap<string, string>,
  configPath: string,
  parse: (content: string) => readonly T[],
): ReadonlyMap<string, readonly T[]> => { … };
```

**RED**: Existing tests after Steps 2.1-2.4 should fully cover this — no new test required. The refactor is a pure structural change; if any existing test breaks, the refactor is wrong.

**GREEN**: Extract the helper. Replace the four memos' bodies with calls to it.

**MUTATE**: Verify the helper through its existing consumers' tests.

**REFACTOR**: This IS the refactor step; assess whether anything else clears up after extraction.

**Done when**: Four memo bodies collapse to single-line calls; existing tests pass; no regression.

#### PR 2 Quality Gate

1. Mutation testing for the helper and each memo's behaviour.
2. Typecheck + lint.
3. Full test suite.
4. Smoke: in a home network with both home-router and an inner switch gateway, run `snmpset` against each and verify the changes show on both LAN-side and WAN-side scans.

---

### PR 3: Skip NAT merge on LAN-side gateway views

Now that gateway state is uniformly canonical-keyed, the asymmetry between LAN-side and WAN-side scans is no longer accidental. PR 3 makes it intentional and by-design.

#### Step 3.1: LAN-side gateway scan returns router-own ports only

**RED**: Behavioural test: given a home router with canonical IP `P` and `.1` alias `A`, and given `/etc/iptables/rules.v4` contains a forward rule `forward 80 to 192.168.1.10:80`:

- `applyDynamicOverrides({ ip: P, … }, ctx)` returns a machine view that includes the forwarded port 80.
- `applyDynamicOverrides({ ip: A, … }, ctx)` returns a machine view that does NOT include the forwarded port 80.

The router's own ports (e.g., 22, 80 if the router itself listens) are present in both views — only the gateway-NAT-merge step is gated.

**GREEN**: In `applyDynamicOverrides` (`src/network/networkUtils.ts:399-439`), add an early check at the start of the gateway-NAT-merge branch:

```ts
// LAN-side gateway view: the player is scanning the router from inside its
// own LAN (machine.ip is a .1 alias). Real iptables PREROUTING only fires
// on packets arriving on the WAN interface, so forwards stay invisible
// from inside. The view shows only the router's own ports.
const isLanSideGatewayView = ctx.gatewayAliasMap.has(machine.ip);
if (isLanSideGatewayView) {
  // Skip the gateway-NAT-merge step entirely. Daemon-state / SNMP /
  // ACL branches below still apply (they affect the router's OWN port
  // state, which is symmetric across both interfaces).
} else {
  // Existing gateway-NAT-merge logic at lines 405-439.
}
```

The `else` branch keeps the existing logic untouched. Mission / world-network gateways don't appear in `gatewayAliasMap` (it's built from `HomeNetwork` only — see Problem A), so the existing behaviour for those is preserved.

**MUTATE**: Mutation surface:

- Flip the `isLanSideGatewayView` predicate → LAN view shows forwards.
- Drop the LAN-side branch → falls back to merging always (same as before this PR).
- Use canonical key instead of alias key when checking → both views skip the merge (wrong direction).

**KILL MUTANTS**: Behaviour test catches the first two. Add a "WAN view still shows forwards" assertion to catch the third.

**REFACTOR**: Document the asymmetry in a doc comment block above `applyDynamicOverrides` so future readers understand why the LAN branch is special-cased.

**Done when**: Test green; full suite green; all mutants killed.

#### Step 3.2: Inner gateways behave the same

**RED**: Repeat Step 3.1's test against a HomeNetwork with a multi-layer topology. Inner gateway at canonical `10.0.0.50` aliased to `10.0.1.1`; iptables rule `forward 8080 to 10.0.1.50:80`. Scanning `10.0.1.1` from inside the inner subnet hides the forward; scanning `10.0.0.50` from outside the inner subnet shows it.

**GREEN**: No new code if Step 3.1 used `gatewayAliasMap.has(machine.ip)` — `buildGatewayCanonicalIpMap` already covers inner-layer entries (verified in Problem A's tests).

**MUTATE**: N/A if no new code; if any inner-layer-specific logic crept in, mutate it.

**KILL MUTANTS**: N/A or per-mutation.

**REFACTOR**: N/A.

**Done when**: Inner-gateway test green; Step 3.1 logic confirmed sufficient.

#### Step 3.3: Regression checks (existing tests)

**RED**: No new test — exercise the existing test suite to confirm no behavioural regression on:

- Mission inner gateways (not affected; not in `gatewayAliasMap`)
- World-network routers (not affected; `collectWorldGatewayIps` doesn't emit `.1` aliases per `networkUtils.ts:192-198`)
- Player's own LAN IP (resolved before the gateway-NAT branch — see `applyDynamicOverrides` early sections)
- LAN-occupant workstations (no gateway-rules path)

**GREEN**: Existing test suite passes unchanged.

**MUTATE**: N/A.

**KILL MUTANTS**: N/A.

**REFACTOR**: N/A.

**Done when**: `npm run test:run` reports zero new failures.

#### PR 3 Quality Gate

1. Mutation testing (Step 3.1).
2. Typecheck + lint.
3. Full test suite.
4. **In-game smoke**: critical for this PR — per `feedback_e2e_test_new_primitives` this is the kind of integration seam where unit tests are necessary but not sufficient.
   - Set up a home network. Add an iptables forward via SSH+nano on the router (writes go to canonical IP via Problem A).
   - From inside the LAN, `nmap 192.168.1.1` — confirm the forwarded port is NOT in the output.
   - From inside the LAN, `nmap <public-IP>` — confirm the forwarded port IS in the output (when reachable via the routing fiction).
   - Verify the router's own SSH port (22) is visible from BOTH views (sanity check that we didn't break router-own port visibility).
   - Inner-gateway smoke (the carry-over from Problem A) — covered automatically by Step 3.2's tests, but a manual in-game verification on a medium/hard topology is worth doing here since the PR adds new behaviour at the same site.

---

## Pre-PR Quality Gate

For every PR in the chain:

1. **Mutation testing** — manual since the project doesn't run Stryker. Each step's MUTATE block enumerates the expected survivors; any unkilled survivor blocks merge unless explicitly justified as equivalent.
2. **Refactoring assessment** — invoke the `refactoring` skill after green. Defer changes that don't add value.
3. **Typecheck + lint** — `npm run build` and `npm run lint` both clean.
4. **Full suite** — `npm run test:run`; 4500+ tests expected.
5. **DDD glossary** — N/A; networking-infra code.

## Post-merge smoke

After the chain merges:

1. **Single-player verification of all three PRs together**:
   - `snmpset <home-router-.1> private firewallSSH=permit` → patches table row keyed by canonical IP (PR 1).
   - Both `nmap 192.168.1.1` and `nmap <public-IP>` show SSH OPEN on the router (PR 2 — symmetric SNMP).
   - SSH into the router, add a NAT forward via nano — `nmap <public-IP>` shows the forward; `nmap 192.168.1.1` doesn't (PR 3 — LAN hides).
2. **Inner-gateway smoke** on a medium topology — repeat the above against `10.0.1.1` / `10.0.0.50`. Closes Problem A's pending inner-gateway smoke too.
3. **`scripts/testL2Bypass.ts`** still green.
4. **Two-browser cross-player check** (when possible): Player A's `snmpset` change against the router shows in Player B's LAN scan (canonical-keyed Realtime subscription). Hard to set up before Problem C — manual local verification with two browsers and the debug vuln port env vars (`reference_debug_vuln_port`) is fine.

## Risks & followups

- **Mission inner gateways still drift.** `buildGatewayCanonicalIpMap` is HomeNetwork-only (per Problem A's plan). Mission inner gateways at `<subnet>.1` aliases still suffer the read/write key mismatch in this plan's scope. **Decision**: defer per the multiplayer ship-first stance and the `mission_instances`-blocked status from `project_l2_followups`. Document the gap in `project_cross_lan_trilogy` after this chain merges. If a player report surfaces the divergence before mission redesign, the same pattern (canonical-keyed memos, alias map covering mission gateways) plugs in cleanly.
- **`appendToMachineLog` callers** (`Terminal.tsx:334`, log handlers in `src/logging/handlers/`) pass `session.machine` — already canonicalized at session creation. **No fix needed in this plan**. Documented in PR 1's audit step.
- **Persistent-session writes** (`useMysqlCommands.ts:83`, `useRedisCommands.ts:89`) pass `<session>.machineId` — set at session creation through `createSession`, which uses `targetMachineIdFor`. Same story as above. No fix needed.
- **FTP commands** (`ftp/get.ts:149`, `ftp/put.ts:149`) take `context.writeFileToMachine` — wired from `createFtpCommand` factory which receives the canonicalized `writeFileToMachine`. Verify during the PR 1 audit step.
- **`feedback_no_backward_compat`**: no migration discipline. Existing patches on `.1` keys (from before PR 1) will become "orphaned" — they remain in the DB but no read path will surface them. Acceptable per the no-live-players stance. Reset Supabase if test data accumulates noise; production starts clean at multiplayer launch.
- **PR 2's blast radius**: the four-memo refactor touches every dynamic gateway-state read path. If a regression surfaces post-merge, the symptom is broad (any gateway port behaviour). The mutation testing + behavioural tests should catch this in CI; the in-game smoke is the safety net.
- **`feedback_real_latency_over_fake_delays`**: PR 1 doesn't add new delays. The existing `SET_DELAY_MS` jitter in `snmpset.ts` is real CPU-bound delay simulation, not network. No change.

## Cleanup (carry from Problem A)

- Delete `plans/gateway-alias-canonicalization.md` as part of PR 1 (it documented PR #145 which is merged; the cleanup instruction in the plan's footer was missed at merge time).

## Related work

- [Memory: project_cross_lan_trilogy](../memory/project_cross_lan_trilogy.md) — sequencing context (A → B → C).
- [Memory: project_router_lan_side_forward_visibility](../memory/project_router_lan_side_forward_visibility.md) — original brainstorm for this problem.
- PR #145 — Problem A (gateway-alias canonicalization, partial coverage; this plan closes the gaps).
- Followup: Problem C — cross-LAN seed-regen + `useForeignNetworks` slice. Depends on canonical keys being uniform (which PR 2 of this plan delivers).

---

_Delete this file when all three implementation PRs merge to `main`. If `plans/` is empty after, delete the directory._
