# Plan: SNMP Attack Vector for Router-First Missions

**Branch**: feat/snmp-attack-vector
**Status**: Active

## Goal

Add an SNMP entry variant where the router has no open TCP ports but exposes SNMP on UDP 161. The player discovers SNMP via UDP scan, uses `snmpwalk` to find credentials and firewall OIDs, then `snmpset` to open the SSH port.

## Acceptance Criteria

- [ ] Port type supports `protocol` field (`'tcp' | 'udp'`, default `'tcp'`)
- [ ] `nmap -sU` scans UDP ports only; default scan shows TCP only
- [ ] `apt("install", "snmp")` installs both `snmpwalk` and `snmpset` binaries
- [ ] `'snmp'` entry variant generates router with filtered TCP + open UDP 161
- [ ] Router filesystem contains `/etc/snmp/snmpd.conf` with OID data, community strings, and firewall OIDs
- [ ] `snmpwalk(host)` streams SNMP OID data (read-only with `"public"`, full with RW community)
- [ ] `snmpset(host, community, "firewallSSH=permit")` modifies `snmpd.conf` firewall OIDs
- [ ] NetworkContext dynamically reads SNMP firewall OIDs to determine router port open/closed state
- [ ] Seed keyword `'snmp'` forces SNMP entry variant
- [ ] Briefing hint mentions "legacy management protocols" for SNMP missions
- [ ] Full attack chain works: `nmap -sU` → `snmpwalk` → `snmpset` → `ssh`
- [ ] All existing tests pass, no regressions

## PR Breakdown

### PR 1: Port protocol field + nmap UDP scan

Foundation change. Extends the port model with protocol awareness and gives nmap the ability to scan UDP.

### PR 2: SNMP entry variant + generation infrastructure

Adds the `'snmp'` entry variant, router SNMP port templates, SNMP config file generation on the router filesystem, apt multi-binary package support, and seed override keyword.

### PR 3: snmpwalk command

New async apt-installable command that reads SNMP OID data from the router's `/etc/snmp/snmpd.conf` and streams it with community string access control.

### PR 4: snmpset command + dynamic firewall state

New async command that writes firewall OID changes to `snmpd.conf`. NetworkContext reads firewall OIDs to dynamically determine port open/closed state, closing the full attack loop.

---

## PR 1: Port protocol field + nmap UDP scan

### Step 1: Add `protocol` field to Port type

**Test**: Port with `protocol: 'udp'` is valid; ports without protocol default to `'tcp'` semantics.
**Implementation**: Add `readonly protocol?: 'tcp' | 'udp'` to `Port` type in `src/network/types.ts`.
**Done when**: Type compiles, existing tests pass (no runtime changes — purely additive type).

### Step 2: nmap shows protocol in port line formatting

**Test**: `formatPortLine` shows `161/udp` for UDP port, `22/tcp` for TCP port (explicit or default).
**Implementation**: Update `formatPortLine` in `src/commands/nmap.ts` to use `port.protocol ?? 'tcp'` instead of hardcoded `'tcp'`.
**Done when**: Port line format reflects actual protocol.

### Step 3: nmap parses `-sU` flag

**Test**: `parseNmapArgs` extracts `udpScan: true` when `-sU` is in either arg position.
**Implementation**: Extend `parseNmapArgs` to detect `-sU` flag alongside existing `-sV` parsing. Return new `udpScan` boolean.
**Done when**: Args parser correctly identifies UDP scan flag in any position, including combined `-sU -sV`.

### Step 4: nmap filters ports by protocol during scan

**Test**: Machine with both TCP and UDP ports — default scan shows only TCP ports, `-sU` scan shows only UDP ports. Combined `-sU -sV` shows UDP ports with version info.
**Implementation**: In the scan output logic, filter `machine.ports` by protocol before rendering. Default: `protocol !== 'udp'` (show TCP + unset). With `-sU`: `protocol === 'udp'`.
**Done when**: TCP-only and UDP-only scans work correctly, range scan summaries also respect protocol filter.

---

## PR 2: SNMP entry variant + generation infrastructure

### Step 5: Add `'snmp'` to EntryVariant type

**Test**: Type-level — code using `EntryVariant = 'snmp'` compiles.
**Implementation**: Add `'snmp'` to the `EntryVariant` union in `src/generation/types.ts`. Update `allVariants` in `topology.ts`. Handle `'snmp'` in `variantEnrichmentFlag` (returns `null` — no port owner enrichment needed).
**Done when**: Type system accepts `'snmp'` as a valid entry variant, no type errors.

### Step 6: Add router SNMP port template

**Test**: When SNMP entry variant is selected in router-first mode, router has port 22/tcp `open: false`, port 161/udp `open: true`.
**Implementation**: Add SNMP template to `routerEntryPortTemplates` in `src/generation/pools.ts`:
```typescript
{ variant: 'snmp', ports: [
  { port: 22, service: 'ssh', open: false },
  { port: 161, service: 'snmp', open: true, protocol: 'udp' },
]}
```
Update `PortTemplate` type in pools.ts to include optional `protocol` field. Update `buildPortsFromTemplate` in topology.ts to propagate protocol.
**Done when**: Router in SNMP variant has correct port configuration.

### Step 7: Add SNMP seed override keyword

**Test**: `parseSeedOverrides('test-snmp-mission')` returns `entryVariant: 'snmp'`.
**Implementation**: Add `'snmp'` case to the entry variant parsing chain in `parseSeedOverrides` in `src/generation/generateMission.ts`.
**Done when**: Seed containing 'snmp' keyword produces SNMP entry variant.

### Step 8: Generate SNMP config file on router filesystem

**Test**: Router in SNMP variant has `/etc/snmp/snmpd.conf` containing community strings, system OIDs, interface data, extend script args with credentials, and firewall OIDs with `deny` values.
**Implementation**: In `src/generation/filesystem.ts`, when `machine.role === 'router'` and entry variant is `'snmp'`, generate `/etc/snmp/snmpd.conf` with:
- `rocommunity` line (always `public`)
- `rwcommunity` line (PRNG-picked from pool: `private`, `ADMIN`, `C1sc0`, `write`, `secret`)
- System OIDs from machine properties (hostname, IPs, interfaces)
- `nsExtendArgs` entries containing router SSH credentials (from credentials map)
- `firewallSSH deny` and `firewallHTTP deny` lines

Need to pass `entryVariant` into `generateFileSystems` / `buildMachineConfig` to conditionally generate SNMP config.
**Done when**: Generated router filesystem contains well-formed snmpd.conf.

### Step 9: Apt multi-binary package support + snmp package

**Test**: `apt("install", "snmp")` creates both `/usr/bin/snmpwalk` and `/usr/bin/snmpset` binaries.
**Implementation**:
1. Add optional `binaries` field to `AptPackageInfo` type in `availability.ts`
2. Add `'snmpwalk'` and `'snmpset'` to `APT_TOOL_NAMES`
3. Add `'snmp'` to `APT_INSTALLABLE` set
4. Add `{ name: 'snmp', description: 'SNMP tools for network management', version: '5.9.1', binaries: ['snmpwalk', 'snmpset'] }` to `APT_PACKAGES`
5. Update `apt.ts` install logic to create binaries from `package.binaries ?? [package.name]`
**Done when**: Installing `snmp` package creates both command binaries, both pass access checks.

### Step 10: SNMP briefing hint

**Test**: Mission with SNMP entry variant includes hint about "legacy management protocols" in briefing output.
**Implementation**: Add SNMP-specific hint text in `formatMissionBriefing` or `formatObjectiveHint` in `src/commands/accept.ts`. Since the hint is about entry method (not objective), add an entry-variant hint section below the objective hint:
```
  Intel: Perimeter is locked down — no exposed services. However,
  legacy management protocols may still be enabled with default
  community credentials.
```
Pass `entryVariant` through `MissionNetwork` (already available) and conditionally render.
**Done when**: SNMP mission briefing includes the management protocol hint.

---

## PR 3: snmpwalk command

### Step 11: Create snmpwalk command with basic structure

**Test**: `snmpwalk()` with no args throws usage error. `snmpwalk("nonexistent.ip")` throws connection error. `snmpwalk("localhost")` throws cannot-query-localhost error.
**Implementation**: Create `src/commands/snmpwalk.ts` with `createSnmpwalkCommand(context)`. Context needs `getMachine`, `getLocalIP`, `resolveDomain`, `getNodeFromMachine`. Returns `AsyncOutput`. Basic arg parsing: `snmpwalk(host[, community])` where community defaults to `"public"`.
**Done when**: Error cases handled correctly.

### Step 12: snmpwalk reads and streams SNMP OID data with "public" community

**Test**: Machine with `/etc/snmp/snmpd.conf` — `snmpwalk(host)` streams system OIDs (sysDescr, sysName, ifDescr, ifAddr) but NOT extend scripts or firewall OIDs. Output prefixed with `[READ-ONLY]`.
**Implementation**: Parse `snmpd.conf` content. With `"public"` community, output only safe system information lines. Stream each OID line with jittered delays via `AsyncOutput`. Add hint line: `Community "public" is READ-ONLY`.
**Done when**: Public community shows limited system info.

### Step 13: snmpwalk with RW community shows full data including credentials

**Test**: `snmpwalk(host, "private")` streams all OIDs including `nsExtendArgs` (with credentials) and `FIREWALL-MIB` entries. Wrong RW community string gets rejected.
**Implementation**: Compare supplied community against `rwcommunity` line in snmpd.conf. If match, show `[READ-WRITE]` banner and stream all OIDs. If no match and not `"public"`, throw error.
**Done when**: RW community reveals sensitive data, wrong community is rejected.

### Step 14: Register snmpwalk in useCommands

**Test**: `snmpwalk` command is available after `apt("install", "snmp")`.
**Implementation**: Import and register `createSnmpwalkCommand` in `src/hooks/useCommands.ts` with appropriate context.
**Done when**: Command is functional end-to-end in the terminal.

---

## PR 4: snmpset command + dynamic firewall state

### Step 15: Create snmpset command with validation

**Test**: `snmpset()` throws usage error. Read-only community throws error. Non-writable OID throws error. Invalid value throws error (e.g., `"banana"` for firewallSSH).
**Implementation**: Create `src/commands/snmpset.ts` with `createSnmpsetCommand(context)`. Context needs `getMachine`, `getLocalIP`, `resolveDomain`, `getNodeFromMachine`, `createFileOnMachine`. Parse 3 args: `(host, community, "oid=value")`. Validate community is RW, OID starts with `firewall`, value is `permit` or `deny`.
**Done when**: All validation/error cases covered.

### Step 16: snmpset modifies snmpd.conf firewall OIDs

**Test**: `snmpset(host, rwCommunity, "firewallSSH=permit")` changes the `firewallSSH` line in `/etc/snmp/snmpd.conf` from `deny` to `permit`. Subsequent `snmpwalk` shows updated value.
**Implementation**: Read snmpd.conf, find the firewall OID line, replace value, write back via `createFileOnMachine`. Stream async output: connection → authentication → old value → new value → success.
**Done when**: snmpd.conf is modified on the router filesystem.

### Step 17: NetworkContext reads SNMP firewall OIDs for dynamic port state

**Test**: Router with SNMP variant and `firewallSSH deny` in snmpd.conf — port 22 shows as `open: false` in getMachine view. After `firewallSSH permit`, port 22 shows as `open: true`.
**Implementation**: In `NetworkContext.tsx`, add `useMemo` hook (like iptables) that reads `/etc/snmp/snmpd.conf` from router filesystem, parses `firewallSSH` value. Create `snmpFirewallParser.ts` for parsing logic. When building the router's `RemoteMachine` view from localhost, overlay the dynamic firewall state onto the router's ports.
**Done when**: Port state dynamically reflects snmpd.conf firewall OID values.

### Step 18: Register snmpset in useCommands + end-to-end verification

**Test**: Full attack chain — generate SNMP mission, nmap -sU finds 161/udp, snmpwalk reads data, snmpset opens SSH, nmap shows 22/tcp open, ssh connects.
**Implementation**: Register `createSnmpsetCommand` in `useCommands.ts`. Write integration test (or E2E test) covering the full flow.
**Done when**: Complete SNMP attack chain works end-to-end.

---

## Pre-PR Quality Gate (each PR)

Before each PR:

1. `npm run test:run` — all tests pass
2. `npm run build` — builds successfully
3. `npm run lint` — no lint errors
4. `npm run format` — formatting clean

---

## Documentation Updates (final PR)

- Update `README.md` with new commands (snmpwalk, snmpset) and SNMP variant
- Update `.claude/docs/architecture.md` with SNMP firewall pattern
- Update `.claude/docs/infrastructure-design.md` with SNMP entry variant
- Update `.claude/docs/mission-variations.md` with SNMP generation axis
- Update `src/commands/README.md` with snmpwalk/snmpset
- Update `src/generation/README.md` with SNMP variant
- Bump version in all 4 locations

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
