# Plan: Inner Gateway NAT and SNMP Runtime Support

**Branch**: feat/inner-gateway-nat-snmp
**Status**: Active

## Goal

Make inter-layer gateways support NAT port forwarding and SNMP firewall control at runtime, so players can pivot through gateways using port forwarding or hack gateway firewalls via SNMP — matching the border router behavior.

## Context

Generation already works: `topology.ts` generates `natForwarding` rules for inner layers when `isForwarded` is true, and `routerEntryPortTemplates` includes SNMP as a possible variant for inner gateways in router-first mode. The gap is runtime: `resolveNat` and SNMP overrides in `NetworkContext` only read from the border router.

## Acceptance Criteria

- [ ] `resolveNat` resolves NAT on any gateway (border router or inner), not just the border router
- [ ] SNMP firewall overrides apply to inner gateways (snmpset opens ports on inner gateways)
- [ ] Inner gateways with `accessVariant === 'snmp'` get `/etc/snmp/snmpd.conf` generated
- [ ] Inner gateways with forwarded ports show those ports to upstream-layer machines (merged view)
- [ ] Existing border router NAT and SNMP behavior unchanged
- [ ] All tests pass, build succeeds

## Steps

### Step 1: Generate snmpd.conf for inner SNMP gateways

**Test**: Verify inner gateways with `accessVariant === 'snmp'` have `/etc/snmp/snmpd.conf` with community strings and firewall OIDs.
**Implementation**: In `filesystem.ts`, pre-generate SNMP configs for inner gateways before the machine loop (PRNG stability), then inject during the loop.
**Done when**: `filesystem.test.ts` confirms inner SNMP gateways have snmpd.conf with expected content.

### Step 2: Pass `layers` to NetworkProvider

**Test**: N/A (prop threading, verified by TypeScript compilation).
**Implementation**: Add `missionLayers` prop to `NetworkProvider` in `NetworkContext.tsx`. Pass `missionState.activeMission?.layers` from `App.tsx`.
**Done when**: Build passes with new prop threaded through.

### Step 3: Generalize iptables parsing to all gateways

**Test**: Unit test that `resolveNat` resolves NAT on an inner gateway IP (not just border router).
**Implementation**: In `NetworkContext.tsx`, replace single `iptablesRules` memo with `allIptablesRules: Map<ip, rules>` that reads from border router AND inner gateways. Generalize `resolveNat` to check the map for any target IP. Derive backward-compatible `iptablesRules` for existing border router code.
**Done when**: `resolveNat` works for any machine that has `/etc/iptables/rules.v4`.

### Step 4: Generalize SNMP overrides to all gateways

**Test**: Unit test that SNMP firewall overrides on an inner gateway update its port visibility.
**Implementation**: In `NetworkContext.tsx`, replace single `snmpFirewallOverrides` memo with `allSnmpOverrides: Map<ip, overrides>`. In `currentConfig` memo, apply SNMP overrides to all visible machines (not just border router).
**Done when**: `snmpset` on an inner gateway dynamically opens/closes its ports for upstream machines.

### Step 5: Apply merged port view for inner forwarded gateways

**Test**: Unit test that a forwarded inner gateway shows forwarded ports to upstream-layer machines.
**Implementation**: In `currentConfig` memo, for machines with iptables rules, apply `buildMergedRouterView` to merge forwarded ports into the gateway's visible port list (same pattern as border router from localhost).
**Done when**: Upstream-layer machines see forwarded ports on the inner gateway via nmap/ping.

### Step 6: Verify end-to-end with dumpMission script

**Test**: Run `dumpMission` with multi-layer seeds, verify inner gateway iptables and SNMP configs appear correctly in the output.
**Implementation**: Manual verification + fix any integration issues found.
**Done when**: Multi-layer missions work correctly with forwarded and SNMP inner gateways.

## Pre-PR Quality Gate

Before PR:

1. `npm run test:run` — all tests pass
2. `npm run build` — production build succeeds
3. `npm run lint` — no lint errors
4. `npm run format` — formatting clean

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
