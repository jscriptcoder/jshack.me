# Network

Simulated network environment for hacking missions. Defines the topology, machines, ports, services, and DNS records that network commands interact with. The network is **per-machine** — each machine has its own interfaces, reachable machines, and DNS records.

## Files

| File                    | Description                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`              | Core types: `NetworkInterface`, `RemoteMachine`, `Port`, `Vulnerability`, `DnsRecord`, `MachineNetworkConfig`, `NetworkConfig`     |
| `initialNetwork.ts`     | `createInitialNetwork()` — defines per-machine network configs (interfaces, reachable machines, DNS) for all 8 machines            |
| `NetworkContext.tsx`    | React context — imports `useSession`, resolves config per `session.machine`, provides `getMachine`, `getLocalIP`, etc.             |
| `iptablesParser.ts`     | Pure parser for router's `/etc/iptables/rules.v4` — extracts `forward <port> to <ip>:<port>` rules into `NatForwardingRule[]`      |
| `snmpFirewallParser.ts` | Pure parser for SNMP firewall OIDs in `/etc/snmp/snmpd.conf` — maps `firewallSSH`/`firewallHTTP` `permit`/`deny` to port overrides |
| `sshdStateParser.ts`    | Pure parser for `/var/run/sshd.pid` — extracts `sshd:port=N` into SSH port override                                                |
| `ftpdStateParser.ts`    | Pure parser for `/var/run/ftpd.pid` — extracts `ftpd:port=N` into FTP port override                                                |
| `index.ts`              | Module exports                                                                                                                     |

## Network Topology

```
198.51.100.0/24 (Internet)
│
├── 198.51.100.10 ─── gateway eth0 (WAN)
│                     gateway eth1 (LAN) ─── 192.168.1.1
│                                             │
│                                        192.168.1.0/24 (Local LAN)
│                                             ├── 192.168.1.50  fileserver
│                                             ├── 192.168.1.75  webserver
│                                             └── 192.168.1.100 localhost (player)
│
└── 203.0.113.42 ─── darknet eth0 (Public)
                      darknet eth1 ─── 10.66.66.100
                                        │
                                   10.66.66.0/24 (Hidden Network)
                                        ├── 10.66.66.1  shadow
                                        ├── 10.66.66.2  void
                                        └── 10.66.66.3  abyss
```

### Reachability Rules

- **LAN machines** (localhost, gateway, fileserver, webserver) reach each other + darknet via gateway NAT
- **Darknet** sees only gateway's WAN IP (198.51.100.10) + hidden network — cannot route to 192.168.1.x
- **Hidden machines** (shadow, void, abyss) only reach each other + darknet's eth1 (10.66.66.100)

## Machines & Services

| Machine    | IP           | Open Ports         | Services                           |
| ---------- | ------------ | ------------------ | ---------------------------------- |
| gateway    | 192.168.1.1  | 22, 80, 443        | ssh, http, https                   |
| fileserver | 192.168.1.50 | 21, 22             | ftp, ssh                           |
| webserver  | 192.168.1.75 | 22, 80, 3306, 4444 | ssh, http, mysql, elite (backdoor) |
| darknet    | 203.0.113.42 | 22, 8080, 31337    | ssh, http-alt, elite (backdoor)    |
| shadow     | 10.66.66.1   | 21, 22             | ftp, ssh                           |
| void       | 10.66.66.2   | 22                 | ssh                                |
| abyss      | 10.66.66.3   | 22                 | ssh                                |

## DNS Records (Per-Machine)

**LAN + Darknet DNS** (available to localhost, gateway, fileserver, webserver):

| Domain           | IP           | Type |
| ---------------- | ------------ | ---- |
| gateway.local    | 192.168.1.1  | A    |
| fileserver.local | 192.168.1.50 | A    |
| webserver.local  | 192.168.1.75 | A    |
| darknet.ctf      | 203.0.113.42 | A    |
| www.darknet.ctf  | 203.0.113.42 | A    |

**Hidden DNS** (available to darknet, shadow, void, abyss):

| Domain        | IP         | Type |
| ------------- | ---------- | ---- |
| shadow.hidden | 10.66.66.1 | A    |
| void.hidden   | 10.66.66.2 | A    |
| abyss.hidden  | 10.66.66.3 | A    |

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

## Mission Network Integration

`NetworkProvider` accepts optional `missionNetworkConfig` and `missionMachines` props. When a mission is active, the provider merges mission machines into the network view:

1. **Mission machines** — if the player is SSH'd into a mission machine, its config is returned directly from `missionNetworkConfig`
2. **Localhost merge** — when on localhost with an active mission, `missionMachines` (array of `GeneratedMachine`) provides full `RemoteMachine` records (with ports and users) that are appended to localhost's reachable machines. Mission DNS records are also merged in. This lets `nmap`, `ping`, `ssh`, etc. discover and reach mission machines.
3. **No mission** — when `missionNetworkConfig` is undefined, behavior is unchanged (static tutorial network only)

Mission machines live on dynamically generated subnets (e.g., `10.x.x.0/24`) and only see each other. The entry point is the bridge — reachable from localhost, with the rest of the mission network accessible from there.

## Context API

`useNetwork()` provides read-only queries. All results are **session-aware** — they return data for the current machine (`session.machine`):

- `getMachine(ip)` — find a reachable machine by IP
- `getMachines()` — list all reachable machines
- `getInterface(name)` — get a network interface (e.g., `eth0`, `eth1`)
- `getInterfaces()` — list all interfaces on current machine
- `getLocalIP()` — current machine's eth0 IP address
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

## Dynamic Daemon Ports

`NetworkProvider` reads PID files (`/var/run/sshd.pid`, `/var/run/ftpd.pid`) from each machine's filesystem. When the player starts a daemon (e.g., `sshd(2222)` or `bash('/usr/sbin/ftpd')`), the command writes a PID file. `parseSshdState()` and `parseFtpdState()` extract port overrides, and `applyDaemonOverrides()` opens the corresponding port on the machine's `RemoteMachine` view. This enables dynamic SSH/FTP port opening from NC shells during lateral movement.
