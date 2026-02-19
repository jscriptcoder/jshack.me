# Network

Simulated network environment for CTF puzzles. Defines the topology, machines, ports, services, and DNS records that network commands interact with. The network is **per-machine** — each machine has its own interfaces, reachable machines, and DNS records.

## Files

| File                 | Description                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `types.ts`           | Core types: `NetworkInterface`, `RemoteMachine`, `Port`, `DnsRecord`, `MachineNetworkConfig`, `NetworkConfig`           |
| `initialNetwork.ts`  | `createInitialNetwork()` — defines per-machine network configs (interfaces, reachable machines, DNS) for all 8 machines |
| `NetworkContext.tsx` | React context — imports `useSession`, resolves config per `session.machine`, provides `getMachine`, `getLocalIP`, etc.  |
| `index.ts`           | Module exports                                                                                                          |

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

**Port** — includes optional `owner` for interactive services (backdoors via `nc`):

```typescript
type Port = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly owner?: ServiceOwner; // username, userType, homePath
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

`NetworkProvider` accepts an optional `missionNetworkConfig` prop. When a mission is active, the provider merges mission machines into the network view:

1. **Mission machines** — if the player is SSH'd into a mission machine, its config is returned directly from `missionNetworkConfig`
2. **Localhost merge** — when on localhost with an active mission, mission machines are appended to localhost's reachable machines and their DNS records are merged in. This lets `nmap`, `ping`, `ssh`, etc. discover and reach the mission entry point.
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
