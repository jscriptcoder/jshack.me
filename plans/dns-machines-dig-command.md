# Plan: DNS Machine Role & `dig` Command

**Branch**: feature/dns-machines-dig-command
**Status**: Active

## Goal

Add a new `dns` machine role running BIND with zone files, and a `dig` command that supports zone transfers (AXFR) to reveal subnet topology including downstream subnets the player hasn't reached yet.

## Design Decisions

### Zone file scope — what does a DNS machine reveal?

A DNS machine in layer N has zone files containing:

- **All machines in its own layer** (same subnet — peers)
- **Its upstream gateway** (.1 address)
- **All machines in downstream layers** (subnets the player hasn't reached yet)

This makes DNS zone transfer a powerful **strategic recon tool**: the player learns what machines exist behind firewalled gateways before breaking through. Hostnames hint at roles (e.g., `db-prod-01` suggests a database). The downstream IPs reveal the subnet ranges to target.

The zone file does NOT include machines from layers above (the player already has access to those).

### `dig` as a system utility (not apt-installable)

`dig` goes in `SYSTEM_UTILITY_NAMES` alongside `nslookup` — both are DNS tools that ship with most Linux distros. `dig` provides richer output (full DNS record format) and supports AXFR zone transfers, which `nslookup` does not.

### `dig` reads zone files from the DNS machine's filesystem

Like `snmpwalk` reads `/etc/snmp/snmpd.conf`, `dig` reads `/etc/bind/zones/db.<zone>` from the target DNS machine via `readFileFromMachine`. This means:

- `dig(@dns_ip, domain)` — standard A record lookup (reads zone file, returns matching record)
- `dig(@dns_ip, domain, "axfr")` — zone transfer (reads entire zone file, returns all records)
- `dig(domain)` — without `@server`, falls back to `resolveDomain` (like nslookup)

### DNS role placement

- Added to `allRoles` — can appear as any non-entry machine in subnet layers
- NOT added to `entryRoles` — DNS servers are infrastructure, not entry points
- Port 53 (DNS, UDP) + port 22 (SSH) + port 953 (rndc, closed by default)

### Zone transfer vulnerability — AXFR misconfiguration probability

Zone transfers require the DNS server to have `allow-transfer { any; }` in its config — a classic misconfiguration. Not all DNS machines have this — it's a PRNG roll during generation, following the same pattern as basic SNMP on gateways:

- **Easy networks**: 80% chance AXFR is enabled
- **Medium networks**: 60% chance AXFR is enabled
- **Hard networks**: 40% chance AXFR is enabled

When AXFR is **enabled**: `named.conf` has `allow-transfer { any; }` and `dig(@server, domain, "axfr")` dumps the full zone file with all cross-layer records.

When AXFR is **disabled**: `named.conf` has `allow-transfer { none; }` and `dig(@server, domain, "axfr")` returns "Transfer failed." The player can still use `dig(@server, hostname.mission)` for individual A record lookups — the zone file is still there and responds to single queries, just not bulk transfers.

This mirrors real-world pentesting: finding a DNS server doesn't guarantee zone transfer works. On harder networks, the player more often has to fall back to `nmap` subnet scans or guess hostnames one at a time.

### How zone file generation gets cross-layer data

The filesystem generator already receives full `layers` data and builds `gatewayDownstreamMap`. For DNS machines, we extend this: during filesystem generation in `generateNetwork.ts`, we collect all machines from the current layer and all downstream layers, then pass them as `dnsZoneRecords` to `buildMachineConfig`. The zone file generator in `networkConfig.ts` formats these into BIND zone file syntax.

## Acceptance Criteria

- [ ] `dns` is a valid `MachineRole` with ports 53 (UDP), 22 (SSH), 953 (rndc, closed)
- [ ] DNS machines get realistic hostnames, usernames, configs, web content, scripts, malware, and binary paths
- [ ] DNS machines have `/etc/bind/named.conf` and `/etc/bind/zones/db.mission` zone files
- [ ] Zone files contain A records for same-layer + downstream-layer machines
- [ ] `dig(@server, domain)` returns a single A record in realistic `dig` output format
- [ ] `dig(@server, domain, "axfr")` returns all zone records when AXFR is enabled
- [ ] `dig(@server, domain, "axfr")` returns "Transfer failed." when AXFR is disabled
- [ ] AXFR misconfiguration probability follows difficulty thresholds (easy 80%, medium 60%, hard 40%)
- [ ] `dig(domain)` without `@server` falls back to `resolveDomain` (like nslookup)
- [ ] `dig` is a system utility in `/bin/` (no apt install needed)
- [ ] `dig` is registered in `useNetworkCommands` with wifi/bricked guards
- [ ] DNS machines appear naturally in generated networks (home + mission)
- [ ] Existing tests pass; new tests cover dig command and zone file generation
- [ ] INFRA_PID_CONFIGS has `dns` entry for named daemon
- [ ] Hydra can brute-force SSH on DNS machines (already works via existing SSH brute-force)

## Steps — PR 1: DNS Machine Role (generation only, no command)

Adds the `dns` role to all generation pools and filesystem generation. No new commands yet — this PR makes DNS machines appear in networks with correct ports, configs, and zone files.

### Step 1: Add `dns` to MachineRole type and topology

**Test**: Write test in `topology.test.ts` that `allRoles` includes `'dns'` and DNS machines can appear in generated topologies.
**Implementation**:

- Add `'dns'` to `MachineRole` union in `src/generation/types.ts`
- Add `'dns'` to `allRoles` in `src/generation/topology.ts`
  **Done when**: TypeScript compiles with new role, topology test passes.

### Step 2: Add DNS port templates, hostnames, usernames

**Test**: Write test that `portTemplatesByRole.dns` has ports 53/22/953 and `hostnamesByRole.dns` / `usernamesByRole.dns` are non-empty arrays.
**Implementation**:

- Add `dns` entry to `portTemplatesByRole` in `src/generation/pools/ports.ts`: port 53 (dns, UDP, open), 22 (ssh, open), 953 (rndc, closed)
- Add `dns` hostnames to `hostnamesByRole` in `src/generation/pools/machines.ts` (15 entries: dns01, ns-primary, resolver, bind-srv, nameserver, ns-corp, dns-gw, etc.)
- Add `dns` usernames to `usernamesByRole` in `src/generation/pools/machines.ts` (15 entries: named, bind, dnsadm, dnsop, zonefile, etc.)
  **Done when**: Pool tests pass, TypeScript exhaustive checks satisfied.

### Step 3: Add DNS config templates, web content, vulnerability templates

**Test**: Write test that `configTemplatesByRole.dns` is non-empty and `webContentTemplatesByRole.dns` is non-empty.
**Implementation**:

- Add `dns` config templates in `src/generation/pools/filesystem.ts` (6 BIND named.conf variants)
- Add `dns` web content templates in `src/generation/pools/web.ts` (BIND admin panel pages)
- Add DNS vulnerability entry in `src/generation/pools/vulnerabilities.ts` (CVE for port 53)
- Add `dns: 'named.conf'` to `serviceConfigNames` in `generateFileSystems.ts`
- Add `dns` entry to `INFRA_PID_CONFIGS` in `generateFileSystems.ts`
  **Done when**: Pool lookup tests pass, filesystem generation doesn't crash for dns role.

### Step 4: Add DNS entries to mission pool files (scriptFix, scriptAuto, malware, binary paths)

**Test**: Write test that `scriptFixTemplatesByRole.dns`, `scriptAutoTemplatesByRole.dns`, `malwareTemplatesByRole.dns`, `binaryTargetPaths.dns`, and `binaryKeyPaths.dns` are all defined and non-empty.
**Implementation**:

- Add `dns` script fix templates in `src/generation/pools/scriptFix.ts` (2 templates: zone validation script, DNS health check)
- Add `dns` script auto templates in `src/generation/pools/scriptAuto.ts` (2 templates: zone sync, DNS cache flush)
- Add `dns` malware templates in `src/generation/pools/malware.ts` (2 templates: DNS tunnel exfiltrator, zone poisoner)
- Add `dns` binary target/key paths in `src/generation/binary.ts`
  **Done when**: All mission objective types work with dns-role target machines.

### Step 5: Generate DNS zone files and named.conf with AXFR probability

**Test**: Write test in `generateFileSystems.test.ts` (or new `dnsZoneFile.test.ts`) that:

1. A dns-role machine in layer 0 of a 2-layer network gets `/etc/bind/zones/db.mission`
2. The zone file contains A records for same-layer machines AND layer 1 machines
3. The zone file contains SOA and NS records
4. A dns-role machine in a 1-layer network only shows same-layer records
5. `named.conf` contains `allow-transfer { any; }` when AXFR roll succeeds
6. `named.conf` contains `allow-transfer { none; }` when AXFR roll fails

**Implementation**:

- Add `generateDnsZoneContent(hostname, records)` to `src/generation/filesystem/networkConfig.ts` — formats records into BIND zone file syntax with SOA, NS, and A records
- Add `generateDnsNamedConf(zoneName, zoneFilePath, allowAxfr)` to same file — generates `/etc/bind/named.conf` with `allow-transfer` set based on the AXFR probability roll
- AXFR probability follows the same pattern as basic SNMP on gateways:
  - Consume one PRNG roll per DNS machine for sequence stability
  - Compare against difficulty threshold: easy 80%, medium 60%, hard 40%
  - Result determines `allow-transfer { any; }` vs `allow-transfer { none; }`
- In `generateNetwork.ts`, when building filesystem for a dns-role machine:
  - Collect same-layer machines + all downstream-layer machines (using existing `layers` data)
  - Perform AXFR probability roll
  - Build DNS record list from their hostnames/IPs
  - Pass zone records + AXFR flag as extra options to `buildMachineConfig`
- In `generateFileSystems.ts` `buildMachineConfig`, when `machine.role === 'dns'`:
  - Generate zone file content using `generateDnsZoneContent`
  - Place at `/etc/bind/zones/db.mission`
  - Generate named.conf using `generateDnsNamedConf` (with AXFR flag)
  - Place at `/etc/bind/named.conf` (replaces the generic service config)

**Done when**: Zone file tests pass; AXFR probability tests pass; `dumpMissionNetwork.ts` shows zone files on dns machines.

### Step 6: Wire DNS zone data through generateNetwork pipeline

**Test**: Integration test: generate a medium/hard network with a dns-role machine, verify the zone file in the output filesystem contains records from deeper layers.
**Implementation**:

- In `generateNetwork.ts`, after building `gatewayDownstreamMap`, build a `dnsVisibleMachines` map: for each dns-role machine, collect all machines from its layer + all downstream layers
- Pass `dnsZoneRecords` through the options to `buildMachineConfig`
- Ensure the same data flow works for both `generateNetwork` (home networks) and `generateMission` (missions)
  **Done when**: Integration test passes; existing topology/filesystem tests still pass.

## Steps — PR 2: `dig` Command

Adds the `dig` command with standard lookup and AXFR zone transfer support.

### Step 7: Create `dig` command with basic A record lookup

**Test**: Write `dig.test.ts`:

1. `dig("@10.0.1.5", "web01.mission")` returns formatted dig output with A record
2. `dig("web01.mission")` without server falls back to `resolveDomain`
3. `dig()` with no args throws usage error
4. `dig("@10.0.1.5", "nonexistent.mission")` returns NXDOMAIN
5. `dig("@10.0.1.5", "web01.mission")` where 10.0.1.5 has no DNS port returns connection refused

**Implementation**:

- Create `src/commands/dig.ts` with `createDigCommand(context)`
- Context: `getMachine`, `resolveDomain`, `readFileFromMachine`, `getLocalIP`, `getGateway`
- Parse args: first arg starting with `@` is the DNS server IP, next is domain, optional third is query type
- For `@server` mode: validate machine exists and has port 53 open, read zone file from `/etc/bind/zones/db.mission`, parse it, find matching A record
- For no-server mode: use `resolveDomain` fallback (like nslookup)
- Returns `AsyncOutput` with realistic DNS query delay

**Output format**: Simplified like `snmpwalk` — recognizable as dig but stripped of noise. Every line is actionable, no QUESTION/AUTHORITY/OPT/flags/message-size clutter.

Standard query:

```
; <<>> DiG 9.16.0 <<>> web01.mission @10.0.1.5

;; ANSWER SECTION:
web01.mission.         3600  IN    A     10.0.1.50

;; SERVER: 10.0.1.5#53
;; Query time: 4 msec
```

NXDOMAIN:

```
; <<>> DiG 9.16.0 <<>> nonexistent.mission @10.0.1.5

;; status: NXDOMAIN

;; SERVER: 10.0.1.5#53
;; Query time: 4 msec
```

**Done when**: All dig tests pass.

### Step 8: Add AXFR zone transfer support to `dig`

**Test**: Add to `dig.test.ts`:

1. `dig("@10.0.1.5", "mission", "axfr")` returns all zone records (SOA + NS + all A records) when `named.conf` has `allow-transfer { any; }`
2. AXFR output includes records from downstream subnets
3. `dig("@10.0.1.5", "mission", "axfr")` returns "Transfer failed." when `named.conf` has `allow-transfer { none; }`
4. AXFR on a machine without DNS port returns error
5. Individual `dig(@server, hostname)` queries still work regardless of AXFR setting

**Implementation**:

- Extend dig command: when third arg is `"axfr"`, first read `named.conf` and check `allow-transfer` setting
- If `allow-transfer { any; }`: read entire zone file and output all records
- If `allow-transfer { none; }`: return "; Transfer failed." error message
- Parse zone file content to extract individual records

**Output format**: Simplified AXFR — flat list of A records, record count, no SOA wrapping.

AXFR success:

```
; <<>> DiG 9.16.0 <<>> mission AXFR @10.0.1.5

dns01.mission.         3600  IN    A     10.0.1.5
web01.mission.         3600  IN    A     10.0.1.50
gateway-sw.mission.    3600  IN    A     10.0.1.1
db-prod.mission.       3600  IN    A     10.0.2.15
admin-box.mission.     3600  IN    A     10.0.2.30
backup-srv.mission.    3600  IN    A     10.0.2.5

;; XFR size: 6 records
;; SERVER: 10.0.1.5#53
```

AXFR denied:

```
; <<>> DiG 9.16.0 <<>> mission AXFR @10.0.1.5

; Transfer failed.

;; SERVER: 10.0.1.5#53
```

**Done when**: AXFR tests pass; zone transfer works/fails based on named.conf config.

### Step 9: Register `dig` in command system

**Test**: Write test that `dig` appears in command list and is accessible without apt install.
**Implementation**:

- Add `'dig'` to `SYSTEM_UTILITY_NAMES` in `src/commands/availability.ts`
- Register `dig` in `src/hooks/useNetworkCommands.ts` with `wrapWithWifiCheck` and `wrapWithBrickedCheck`
- Add manual entry with synopsis, description, examples
  **Done when**: `help()` shows dig; `dig` works in terminal without `apt install`.

### Step 10: End-to-end verification and cleanup

**Test**: Manual verification with debug scripts:

1. `npx tsx scripts/dumpMissionNetwork.ts <seed>` shows dns-role machines with zone files
2. `npx tsx scripts/dumpHomeNetwork.ts <seed> <wifi>` shows dns-role machines in home networks
3. Zone files contain cross-layer records
4. Existing tests all pass

**Implementation**:

- Run `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`
- Fix any issues found
- Update documentation: CLAUDE.md, architecture.md, README.md, relevant module READMEs
  **Done when**: All checks green, docs updated, PR ready for review.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. `npm run build` — typecheck passes
4. `npm run lint` — no lint errors
5. `npm run format` — formatting clean
6. `npm run test:run` — all tests pass

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
