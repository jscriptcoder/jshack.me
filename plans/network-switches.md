# Plan: Managed Layer 3 Switches as Gateway Devices

## Overview

Add managed Layer 3 switches as an alternative gateway device between subnet layers.
Currently, all gateways are routers with NAT/iptables. Switches use **ACLs** (allow/deny
rules) instead of NAT port forwarding, giving players a different puzzle type.

### Key Differences: Router vs Switch

| Aspect          | Router                          | Switch                           |
| --------------- | ------------------------------- | -------------------------------- |
| Access control  | NAT/iptables port forwarding    | ACL deny/allow rules             |
| Config file     | `/etc/iptables/rules.v4`        | `/etc/switch/acl.conf`           |
| SNMP OIDs       | `firewallSSH`, `firewallHTTP`   | `aclSSH`, `aclHTTP`              |
| SNMP values     | `permit` / `deny`               | `allow` / `deny`                 |
| Address mapping | Public port -> internal IP:port | No mapping, direct IP access     |
| Player goal     | Add NAT forwarding rules        | Clear deny ACLs to allow traffic |

### Design Constraints

- Border gateway (to internet) is **always a router** — switches only replace inner gateways
- Switches always use ACL-deny mode (no "forwarded" equivalent)
- When ACLs are cleared, player connects directly to internal IPs (no port remapping)
- Same SNMP tools (`snmpwalk`, `snmpset`) work on switches with different OIDs

---

## Phase 1: Type System & Data Pools

### Step 1.1: Extend `MachineRole` and add `GatewayType`

- [x] File: `src/generation/types.ts`
- Add `'switch'` to `MachineRole` union
- Add `type GatewayType = 'router' | 'switch'`
- Add `readonly gatewayType: GatewayType` to `SubnetLayer`

### Step 1.2: Add switch data pools

- [x] File: `src/generation/pools/machines.ts`
  - Add `switch` usernames: `netadmin`, `switchadm`, `vlanadm`, `portadm`, `l3admin`,
    `acluser`, `switchops`, `trunkadm`, `spanadm`, `uplinkadm`
  - Add `switch` hostnames: `sw-core-01`, `l3-switch`, `dist-sw`, `agg-switch`,
    `sw-access`, `switch-mgmt`, `sw-dist-01`, `vlan-sw`, `trunk-sw`, `sw-edge`

- [x] File: `src/generation/pools/ports.ts`
  - Add `switch` port template: SSH(22), HTTP(80), SNMP(161/udp)

- [x] File: `src/generation/pools/filesystem.ts`
  - Add `switch` entries to config/target/tamper templates

---

## Phase 2: ACL Parser & SNMP ACL Parser

### Step 2.1: Create ACL parser

- [x] New file: `src/network/aclParser.ts`
- ACL file format:
  ```
  # Access Control List
  # Syntax: <action> <proto> any <subnet> port <port>
  deny tcp any 10.42.2.0/24 port 22
  deny tcp any 10.42.2.0/24 port 80
  ```
- Export `AclRule` type and `parseAclRules(content): readonly AclRule[]`

### Step 2.2: Create SNMP ACL parser

- [x] New file: `src/network/snmpAclParser.ts`
- Switch SNMP OIDs: `aclSSH deny`, `aclHTTP deny`
- Export `SnmpAclOverride` type and `parseSnmpAclConfig(content): readonly SnmpAclOverride[]`
- Port map: `{ aclSSH: 22, aclHTTP: 80, aclFTP: 21 }`

### Step 2.3: Parser tests

- [x] New file: `src/network/aclParser.test.ts`
- [x] New file: `src/network/snmpAclParser.test.ts`

---

## Phase 3: Topology Generation

### Step 3.1: Switch gateway generation

- [x] File: `src/generation/topology.ts`
- Inner gateways: PRNG roll to decide `'router'` vs `'switch'` (only for multi-layer)
- Border gateway always stays `'router'`
- Switch gateways use `role: 'switch'`, switch hostname pool
- Switch layers: `isForwarded` is always `false` (no NAT), force ACL-deny mode
- **PRNG stability**: consume the roll regardless, only apply for multi-layer

### Step 3.2: Propagate `gatewayType` through layers

- [x] File: `src/generation/topology.ts`
- Set `gatewayType` on each `SubnetLayer`
- Switch gateways: `natForwarding` is `undefined`

---

## Phase 4: Filesystem Generation

### Step 4.1: Switch filesystem content

- [x] File: `src/generation/filesystem.ts`
- Extend `buildMachineConfig` role checks to handle `'switch'`:
  - Service config name → `'switch.conf'`
  - Firewall log → ACL log format
  - `/etc/switch/acl.conf` instead of `/etc/iptables/rules.v4`
  - `/etc/hosts` for both `'router'` and `'switch'`

### Step 4.2: Switch SNMP config

- [x] File: `src/generation/filesystem.ts`
- New function `generateSwitchSnmpConfig` with ACL OIDs:
  ```
  aclSSH deny
  aclHTTP deny
  ```
- Different `sysDescr`: `Cisco IOS L3 Switch <hostname> 15.2(4)E`

### Step 4.3: Wire into generation pipeline

- [x] File: `src/generation/generateNetwork.ts`
- [x] File: `src/generation/generateMission.ts`
- SNMP pre-generation loops must distinguish router vs switch gateways

---

## Phase 5: Network Context & Dynamic Resolution

### Step 5.1: Parse ACLs from switch filesystems

- [x] File: `src/network/NetworkContext.tsx`
- New `useMemo` for `allAclRules` — reads `/etc/switch/acl.conf` from switch gateways
- New `useMemo` for `allSnmpAclOverrides` — reads SNMP ACL OIDs from switch snmpd.conf

### Step 5.2: ACL-based port filtering on downstream machines

- [x] File: `src/network/networkUtils.ts`
- Key logic: when a switch with deny ACLs sits between viewer and target,
  the denied ports appear closed on the target machine
- Build `machineIp -> switchGatewayIp` map from layer structure
- Combine ACL rules with SNMP ACL overrides (allow overrides deny)
- Apply as port visibility filter in `applyDynamicOverrides`

### Step 5.3: `resolveNat` — no changes needed

- Switches don't do NAT, so `resolveNat` returns unchanged IP:port (default behavior)
- No iptables rules on switches = no NAT translation = works automatically

---

## Phase 6: SNMP Commands

### Step 6.1: Update `snmpwalk`

- [x] File: `src/commands/snmpwalk.ts`
- Handle `acl` prefix OIDs → format as `ACL-MIB::aclSSH.0 = STRING: deny`
- ACL OIDs hidden from public community (same as firewall OIDs)

### Step 6.2: Update `snmpset`

- [x] File: `src/commands/snmpset.ts`
- Accept `acl`-prefixed OIDs as writable
- ACL values: `allow` / `deny` (distinct from firewall `permit` / `deny`)
- Output format: `ACL-MIB::aclSSH.0: deny → allow`

### Step 6.3: SNMP command tests

- [x] File: `src/commands/snmpwalk.test.ts` — switch ACL OID tests
- [x] File: `src/commands/snmpset.test.ts` — switch ACL value tests

---

## Phase 7: Integration & Edge Cases

### Step 7.1: Enrichment

- [x] File: `src/generation/enrichment.ts`
- Update `role === 'router'` checks to include `role === 'switch'`

### Step 7.2: Seed keyword override

- [x] File: `src/generation/generateMission.ts`
- Add `switch` keyword to force inner gateways to be switches (for testing)

### Step 7.3: Mixed gateway types

- Hard networks can have one router gateway + one switch gateway
- Verify heterogeneous gateway types work end-to-end

---

## Phase 8: Documentation

- [x] `.claude/CLAUDE.md` — update gateway/access control sections
- [x] `.claude/docs/infrastructure-design.md` — switch section
- [x] `.claude/docs/mission-variations.md` — gateway type variation axis

---

## Potential Challenges

1. **PRNG sequence stability**: Adding the router/switch roll must not shift PRNG for
   existing seeds. Always consume the roll, only apply for multi-layer networks.

2. **ACL filtering across layers**: Most complex part — determining which switch sits
   between viewer and target requires layer structure awareness in NetworkContext.

3. **Mixed gateway types**: Hard networks may have heterogeneous gateways — each layer
   must be handled independently by its gateway's type.

4. **Player discoverability**: Switches need clear signals (hostname, config files,
   SNMP OIDs) so players know they're dealing with a switch vs router.
