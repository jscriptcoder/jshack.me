# Network

Simulated network environment for hacking missions. Defines the topology, machines, ports, services, and DNS records that network commands interact with. The network is **per-machine** — each machine has its own interfaces, reachable machines, and DNS records.

## Files

| File                    | Description                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`              | Core types: `NetworkInterface`, `RemoteMachine`, `Port`, `Vulnerability`, `DnsRecord`, `MachineNetworkConfig`, `NetworkConfig`         |
| `wifiTypes.ts`          | `WifiConnection` type (`{ essid, bssid }`) and validator — replaces boolean WiFi state                                                 |
| `initialNetwork.ts`     | Localhost interface constants: `localhostWlan0Down` (disconnected wlan0) and `localhostDisconnectedInterfaces` (loopback + wlan0 down) |
| `NetworkContext.tsx`    | React context — imports `useSession`, resolves config per `session.machine`, provides `getMachine`, `getLocalIP`, etc.                 |
| `networkUtils.ts`       | Pure functions extracted from context: `buildMergedRouterView`, `applySnmpFirewallOverrides`, `applyDaemonOverrides`, ACL filtering    |
| `iptablesParser.ts`     | Pure parser for router's `/etc/iptables/rules.v4` — extracts `forward <port> to <ip>:<port>` rules into `NatForwardingRule[]`          |
| `snmpFirewallParser.ts` | Pure parser for SNMP firewall OIDs in `/etc/snmp/snmpd.conf` — maps `firewallSSH`/`firewallHTTP` `permit`/`deny` to port overrides     |
| `aclParser.ts`          | Pure parser for switch `/etc/switch/acl.conf` — extracts `deny`/`allow` ACL rules with subnet and port matching                        |
| `snmpAclParser.ts`      | Pure parser for SNMP ACL OIDs in `/etc/snmp/snmpd.conf` — maps `aclSSH`/`aclHTTP`/`aclFTP` `allow`/`deny` to port overrides            |
| `sshdStateParser.ts`    | Pure parser for `/var/run/sshd.pid` — extracts `sshd:port=N` into SSH port override                                                    |
| `ftpdStateParser.ts`    | Pure parser for `/var/run/vsftpd.pid` — extracts `vsftpd:port=N` into FTP port override                                                |
| `ncStateParser.ts`      | Pure parser for `/var/run/nc-*.pid` — extracts `nc:port=N,user=X,userType=T,home=P` into elite port overrides with owner               |
| `index.ts`              | Module exports                                                                                                                         |

## Network Topology

There is no static network topology. All network machines are procedurally generated:

- **Home networks** — generated per WiFi connection via `generateHomeNetwork()`. Each uses the same multi-layer topology as missions (random difficulty: easy=1 layer/2 machines, medium=2 layers/5-7 machines, hard=3 layers/8-11 machines) with a border router, optional inner gateways, and mission-quality filesystems.
- **Mission networks** — generated per mission seed via `generateMissionNetwork()`. Independent subnets with routers and internal machines.

Localhost starts disconnected (wlan0 DOWN, no IP). After cracking a WiFi network and connecting, localhost gets a dynamic IP from the home network's subnet and can see that network's machines.

## Key Types

**MachineNetworkConfig** — per-machine network view:

```typescript
type MachineNetworkConfig = {
  readonly interfaces: readonly NetworkInterface[];
  readonly machines: readonly RemoteMachine[];
  readonly dnsRecords: readonly DnsRecord[];
};

type NetworkConfig = {
  readonly machineConfigs: Readonly<Record<string, MachineNetworkConfig>>;
};
```

**Port** — includes optional `owner` for interactive services (backdoors via `nc`, exploits) and optional `vulnerability` for version scanning:

```typescript
type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
};

type Port = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp'; // defaults to 'tcp'; used by nmap -sU for UDP scanning
  readonly owner?: ServiceOwner; // username, userType, homePath
  readonly vulnerability?: Vulnerability; // CVE info for nmap -sV / msfconsole
};
```

**RemoteMachine** — each machine has an IP, hostname, open ports, and user accounts:

```typescript
type RemoteMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: readonly Port[];
  readonly users: readonly RemoteUser[];
};
```

## Network Resolution

`NetworkProvider` accepts `homeNetwork` (active WiFi subnet), `missionNetworkConfig`, `missionMachines`, and `missionRouterMachine` props. Network config resolution priority:

1. **Mission machines** — if the player is SSH'd into a mission machine, its config is returned directly from `missionNetworkConfig`
2. **Home network machines** — if SSH'd into a home network machine, its config comes from `homeNetwork.networkConfig`
3. **Localhost + WiFi connected** — shows home network machines with dynamic wlan0 IP from the subnet. If mission also active, mission router is appended to visible machines.
4. **Localhost + WiFi disconnected** — disconnected interfaces, empty machines, empty DNS

Mission machines live on dynamically generated subnets (e.g., `10.x.x.0/24`) and only see each other. The entry point is the bridge — reachable from localhost, with the rest of the mission network accessible from there.

## Context API

`useNetwork()` provides read-only queries. All results are **session-aware** — they return data for the current machine (`session.machine`):

- `getMachine(ip)` — find a reachable machine by IP
- `getMachines()` — list all reachable machines
- `getInterface(name)` — get a network interface (e.g., `eth0`, `eth1`)
- `getInterfaces()` — list all interfaces on current machine
- `getLocalIP()` — current machine's eth0 IP address
- `getPublicIP()` — home router's public IP (for NAT'd source IP in cross-network logs); `null` if no home network
- `getGateway()` — current machine's gateway IP
- `resolveDomain(domain)` — DNS lookup (per-machine DNS records)
- `getDnsRecords()` — all DNS records visible from current machine
- `resolveNat(ip, port)` — translate router public IP + port to internal machine IP + port via parsed iptables rules

## Dynamic Iptables

NAT forwarding rules are parsed on-demand from `/etc/iptables/rules.v4` on the router's filesystem. `NetworkProvider` reads the file via `useFileSystem()` — when the player edits it with `nano`, the filesystem state updates and the rules re-parse automatically.

- **Forwarded mode**: file is pre-populated with forwarding rules matching the generated topology
- **Router-first mode**: file has only comment headers (empty template for the player)
- Format: `forward <public_port> to <internal_ip>:<port>` — comments (`#`) and blank lines are ignored

## Dynamic SNMP Firewall

For the SNMP entry variant, `NetworkProvider` also reads `/etc/snmp/snmpd.conf` from the router's filesystem. `snmpFirewallParser.ts` extracts `firewallSSH`/`firewallHTTP` OID values (`permit`/`deny`). When `snmpset` modifies the file, port state updates dynamically — `firewallSSH permit` opens port 22 on the router. `applySnmpFirewallOverrides()` overlays these changes onto the router's `RemoteMachine` view visible from localhost.

## Dynamic Switch ACLs

For managed Layer 3 switch gateways, `NetworkProvider` reads `/etc/switch/acl.conf` and SNMP ACL OIDs from `/etc/snmp/snmpd.conf`. Switch gateways use ACL deny rules instead of NAT/iptables — no address translation.

- **ACL rules** (`aclParser.ts`): `deny tcp any 10.42.2.0/24 port 22` blocks SSH to the downstream subnet. Players clear deny rules via `nano` or `snmpset`.
- **SNMP ACL OIDs** (`snmpAclParser.ts`): `aclSSH`/`aclHTTP`/`aclFTP` with `allow`/`deny` values. When `snmpset` changes `aclSSH` to `allow`, port 22 opens for downstream machines.
- **Port filtering**: `applyAclFiltering()` in `networkUtils.ts` closes ports on downstream machines when ACL deny rules are active. SNMP ACL `allow` overrides take precedence over static ACL deny rules.

## Dynamic Daemon Ports

`NetworkProvider` reads PID files (`/var/run/sshd.pid`, `/var/run/vsftpd.pid`, `/var/run/nc-*.pid`) from each machine's filesystem. When the player starts a daemon (e.g., `sshd(2222)`, `bash('/usr/sbin/vsftpd')`, `systemctl('start', 'sshd')`, or `nc("-l", 4444)`), the command writes a PID file. `systemctl('stop', service)` deletes the PID file to close the port. `parseSshdState()`, `parseFtpdState()`, and `parseNcPidFiles()` extract port overrides, and `applyDaemonOverrides()` opens the corresponding port on the machine's `RemoteMachine` view. This enables dynamic SSH/FTP/backdoor port opening from NC shells during lateral movement.

`nc` listener PID files include owner metadata (`user`, `userType`, `home`) so that when another player connects via `nc()`, they land as the user who opened the listener. Port binding follows Unix rules: ports below 1024 require root.
