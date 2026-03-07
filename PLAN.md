# Plan: Dynamic Network Access & Iptables

## Goal

Each internal mission machine has a PRNG-selected access method (ssh/ftp/nc/exploit/http), and the router's port forwarding is configurable via an iptables rules file that the player can edit with nano (auto-applied on save).

## Acceptance Criteria

- [ ] Every internal machine has an `accessVariant` determining how it's accessed
- [ ] Machine ports reflect their access variant (NC backdoor, exploit vuln, FTP, HTTP, SSH)
- [ ] All machines are enriched with variant-specific data (owners, vulnerabilities)
- [ ] SSH supports `-p PORT` flag for non-default ports
- [ ] NAT resolution is port-aware (multi-port forwarding)
- [ ] Router has `/etc/iptables/rules.v4` with a simple forwarding format
- [ ] Player can edit iptables rules; changes are reflected in nmap/connections
- [ ] All existing tests pass, new behavior is tested

## Steps

### Step 1: Add `accessVariant` to `GeneratedMachine`

**Test**: Generate networks from multiple seeds, verify each machine has an `accessVariant` field, entry machine matches `entryVariant`, non-entry machines have PRNG-picked variants, determinism holds.
**Implementation**: Add `accessVariant: EntryVariant` to `GeneratedMachine` type. In `topology.ts`, PRNG-pick a variant for each non-entry machine. Entry machine gets the existing `entryVariant`. Router gets its existing variant (router-first) or `'ssh'` (forwarded mode).
**Done when**: Field exists on all machines, populated correctly, all existing tests pass.

### Step 2: Generate variant-specific ports per machine

**Test**: Machines with NC variant have a backdoor port, exploit variant has a vulnerability-compatible port, FTP variant has port 21, HTTP variant has port 80. Port closures don't close a machine's variant primary port.
**Implementation**: Replace `buildPorts(role)` for non-entry machines with a function that combines role base ports + access variant ports:

- SSH: role ports unchanged (SSH already present in all roles)
- FTP: add port 21 if not already present (fileserver already has it)
- NC: add a PRNG-picked backdoor port (4444/31337/8888/1337)
- Exploit: add a port matching a vulnerability template (if no existing port matches)
- HTTP: add port 80 if not already present (webserver already has it)

Port closures (`applyPortClosures`) must respect access variants — never close a machine's variant primary port.
**Done when**: Each machine has ports matching its access variant, closures are safe.

### Step 3: Enrich all machines with variant data

**Test**: Non-entry NC machines have backdoor owners, exploit machines have vulnerabilities, FTP machines have FTP owners. Owner types vary by PRNG.
**Implementation**: Extend `enrichMachineWithUsers` to handle all machines based on their `accessVariant`, not just the entry machine. Reuse existing `addNcBackdoorOwner`, `addExploitVulnerability`, `addFtpServerOwner`. The `isEntryVariant` check in `generateMission.ts` becomes a per-machine check using `accessVariant`.
**Done when**: All machines enriched based on their access variant.

### Step 4: SSH `-p` flag support

**Test**: `ssh("user@host")` connects on port 22 (default). `ssh("user@host", "-p", "2222")` connects on port 2222. Invalid port returns error. Port not found/closed returns "Connection refused".
**Implementation**: Parse `-p PORT` from ssh arguments. Default to port 22. Look up the specified port on the target machine instead of hard-coded `p.port === 22 && p.service === 'ssh'`. Validate port exists and is open.
**Done when**: SSH works with custom ports.

### Step 5: Port-aware NAT resolution

**Test**: Multi-port forwarding resolves correctly (port 22 -> machine A, port 2222 -> machine B). Existing single-entry forwarding still works. `buildForwardedRouterMachine` removed. Connections through router land on correct internal machines.
**Implementation**:

- Change `NatForwarding` type to port-level rules:
  ```
  { publicIp: string; rules: [{ publicPort: number; internalIp: string; internalPort: number }] }
  ```
- Change `resolveNat(ip)` to `resolveNat(ip, port)` returning `{ ip, port }`
- Move NAT resolution before machine lookup in SSH/FTP/NC/curl (early resolution)
- Remove `buildForwardedRouterMachine` — no longer needed with early port-aware NAT
- Update all callers: SSH, FTP, NC, curl, useAuthentication, Terminal.tsx
- Generate initial NAT rules from topology (forwarded mode creates rules for entry machine ports)

**Done when**: Connections through router use port-level NAT rules, old workaround removed.

### Step 6: Generate iptables rules file on router

**Test**: Forwarded mode: router has `/etc/iptables/rules.v4` with forward rules matching NAT config. Router-first mode: file has empty rules section (template for player).
**Implementation**: In `filesystem.ts`, generate `/etc/iptables/rules.v4` on the router machine. Format:

```
# Port Forwarding Rules
# forward <public_port> to <internal_ip>:<port>
forward 22 to 10.0.1.10:22
forward 80 to 10.0.1.11:80
```

Forwarded mode: pre-populated from NAT rules. Router-first mode: only comments and blank template. File is root-owned (must `su` to edit).
**Done when**: Router has correct iptables file for both modes.

### Step 7: Dynamic iptables parsing for NAT + port visibility

**Test**: Empty rules file -> no forwarding visible. Player adds rules -> `nmap` shows forwarded ports. NAT resolves through parsed rules. Router's own SSH always visible.
**Implementation**:

- Add iptables parser: reads `/etc/iptables/rules.v4` from router filesystem, parses `forward <port> to <ip>:<port>` lines into NAT rules
- `resolveNat` reads iptables file on demand from the router's filesystem (not cached statically)
- `nmap` of router's public IP from localhost shows: router's own ports + forwarded ports from iptables
- No save hooks — parsing is on-demand (read file at connection/scan time)
- Player edits file with nano -> next nmap/connection sees the changes

**Done when**: Player can edit iptables and see changes reflected in nmap and connections.

## Iptables Rules Format

Simple, human-readable format for `/etc/iptables/rules.v4`:

```
# Port Forwarding Rules
# forward <public_port> to <internal_ip>:<port>

forward 22 to 10.0.1.10:22
forward 80 to 10.0.1.11:80
forward 4444 to 10.0.1.12:4444
```

- One rule per line
- `#` comments and blank lines ignored
- Root-owned file (requires `su` to edit with nano)
- Auto-applied: no restart or reload command needed

## Dependencies

```
Step 1 -> Step 2 -> Step 3 (generation pipeline)
Step 4 (independent, can parallel with 1-3)
Step 5 (needs Step 4 for SSH port support)
Step 6 (needs Step 5 for NAT rules type)
Step 7 (needs Step 6 for iptables file)
```
