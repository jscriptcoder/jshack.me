# Network

Simulated network environment for hacking missions. Defines the topology, machines, ports, services, and DNS records that network commands interact with. The network is **per-machine** — each machine has its own interfaces, reachable machines, and DNS records.

## Files

| File                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                  | Core types: `NetworkInterface`, `RemoteMachine`, `Port`, `Vulnerability`, `DnsRecord`, `MachineNetworkConfig`, `NetworkConfig`                                                                                                                                                                                                                                                                                                                            |
| `wifiTypes.ts`              | `WifiConnection` type (`{ essid, bssid }`) and validator — replaces boolean WiFi state                                                                                                                                                                                                                                                                                                                                                                    |
| `initialNetwork.ts`         | Localhost interface constants: `localhostWlan0Down` (disconnected wlan0) and `localhostDisconnectedInterfaces` (loopback + wlan0 down)                                                                                                                                                                                                                                                                                                                    |
| `NetworkContext.tsx`        | React context — imports `useSession`, resolves config per `session.machine`, provides `getMachine`, `getLocalIP`, etc. Ships a dev-only `buildDebugVulnPort` helper that injects a synthetic vulnerable port into every LAN occupant when `VITE_DEBUG_VULN_EFFECT/_TIER` are set at build time (tree-shaken from prod via `import.meta.env.DEV`).                                                                                                         |
| `networkUtils.ts`           | Pure functions extracted from context: `buildMergedRouterView` (resolves forward rules against `internalMachines` NPCs + optional `occupantMachines` LAN workstations), `applySnmpFirewallOverrides`, `applyDaemonOverrides`, ACL filtering. `DynamicOverrideContext.overlaidOccupants` carries pid-file-overlayed workstations into the home-gateway NAT branch                                                                                          |
| `iptablesParser.ts`         | Pure parser for router's `/etc/iptables/rules.v4` — extracts `forward <port> to <ip>:<port>` rules into `NatForwardingRule[]`                                                                                                                                                                                                                                                                                                                             |
| `gatewayChain.ts`           | Pure fn: given a machine IP and mission layers, returns the ordered gateway chain from innermost to edge router                                                                                                                                                                                                                                                                                                                                           |
| `backdoorForwarding.ts`     | Installs chained NAT forward rules on every gateway between a backdoored machine and the public edge; picks free ports per gateway                                                                                                                                                                                                                                                                                                                        |
| `snmpFirewallParser.ts`     | Pure parser for SNMP firewall OIDs in `/etc/snmp/snmpd.conf` — maps `firewallSSH`/`firewallHTTP` `permit`/`deny` to port overrides                                                                                                                                                                                                                                                                                                                        |
| `aclParser.ts`              | Pure parser for switch `/etc/switch/acl.conf` — extracts `deny`/`allow` ACL rules with subnet and port matching                                                                                                                                                                                                                                                                                                                                           |
| `snmpAclParser.ts`          | Pure parser for SNMP ACL OIDs in `/etc/snmp/snmpd.conf` — maps `aclSSH`/`aclHTTP`/`aclFTP` `allow`/`deny` to port overrides                                                                                                                                                                                                                                                                                                                               |
| `sshdStateParser.ts`        | Pure parser for `/var/run/sshd.pid` — extracts `sshd:port=N` into SSH port override                                                                                                                                                                                                                                                                                                                                                                       |
| `ftpdStateParser.ts`        | Pure parser for `/var/run/vsftpd.pid` — extracts `vsftpd:port=N` into FTP port override                                                                                                                                                                                                                                                                                                                                                                   |
| `ncStateParser.ts`          | Pure parser for `/var/run/nc-*.pid` — extracts `nc:port=N,user=X,userType=T,home=P` into elite port overrides with owner                                                                                                                                                                                                                                                                                                                                  |
| `infraDaemonStateParser.ts` | Pure parser for infra daemon pid files (`/var/run/nginx.pid`, `/var/run/mysqld.pid`, `/var/run/redis.pid`, etc.) — accepts short shape `${binary}:port=${N}` (themed-network generators) and extended shape `${binary}:port=${N},user=U,userType=T,home=H` (player-run nginx). Reverse-derives pidFile→services from `INFRA_PID_CONFIGS`; port→service via canonical port table. Emits `InfraPortOverride[]` with optional `owner` from the extended form |
| `apache2StateParser.ts`     | Pure parser for `/var/run/apache2.pid` — extracts `apache2:port=N,user=U,userType=T,home=H` into `Apache2PortOverride` with owner. Port→service: 443→https, 8080→http-alt, else→http                                                                                                                                                                                                                                                                      |
| `dpkgStatus.ts`             | Debian-style `/var/lib/dpkg/status` parser/writer — RFC-822 format with Package/Status/Version fields for service version tracking                                                                                                                                                                                                                                                                                                                        |
| `applyVersionOverlay.ts`    | Wraps a `RemoteMachine` so `port.serviceVersion` reads come from dpkg/status if an entry exists; also overlays router `firmwareVersion`                                                                                                                                                                                                                                                                                                                   |
| `index.ts`                  | Module exports                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

**Severity** — vulnerability severity tiers. `critical`/`high`/`medium`/`low` all grant shells in Phase 3; `info` is reserved for Phase 4 typed effects (non-shell outcomes):

```typescript
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
```

**VulnerabilityEffect** — discriminated union of exploit outcomes. Determines what `msfconsole` does on a successful exploit:

```typescript
type VulnerabilityEffect =
  | { readonly kind: 'shell_limited'; readonly tier: EffectTier }
  | { readonly kind: 'shell_full'; readonly tier: EffectTier }
  | { readonly kind: 'file_read'; readonly tier: EffectTier }
  | { readonly kind: 'dir_list'; readonly tier: EffectTier }
  | { readonly kind: 'file_write'; readonly tier: EffectTier }
  | { readonly kind: 'password_reset'; readonly tier: EffectTier }
  | { readonly kind: 'backdoor_port_open'; readonly port: number; readonly tier: EffectTier }
  | { readonly kind: 'script_exec'; readonly tier: EffectTier };
// where EffectTier = 'guest' | 'user' | 'root'
```

**Vulnerability** — CVE metadata including severity, timed publication, typed effects, and attack logging patterns:

```typescript
type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
  readonly attackPattern: AttackPattern;
  readonly severity: Severity;
  readonly publishedAt: number; // game day when CVE becomes live (0 = always active)
  readonly effect: VulnerabilityEffect;
};
```

**Port** — includes `serviceVersion` for version scanning and optional `owner` for interactive services (backdoors via `nc`, exploits). Version comes from generation but can be overlaid at runtime via dpkg/status:

```typescript
type Port = {
  readonly port: number;
  readonly service: string;
  readonly serviceVersion: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp'; // defaults to 'tcp'; used by nmap -sU for UDP scanning
  readonly owner?: ServiceOwner; // username, userType, homePath
};
```

**RemoteMachine** — each machine has an IP, hostname, open ports, and user accounts. Routers additionally carry firmware metadata:

```typescript
type RemoteMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: readonly Port[];
  readonly users: readonly RemoteUser[];
  readonly firmwareVendor?: string; // router-only, set at generation time
  readonly firmwareVersion?: string; // router-only, overlaid from dpkg/status
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
- `getGatewayChainFor(machineIp)` — ordered gateway chain from the machine's layer out to the border router (empty for non-mission IPs)

## Dynamic Iptables

NAT forwarding rules are parsed on-demand from `/etc/iptables/rules.v4` on the router's filesystem. `NetworkProvider` reads the file via `useFileSystem()` — when the player edits it with `nano`, the filesystem state updates and the rules re-parse automatically.

- **Forwarded mode**: file is pre-populated with forwarding rules matching the generated topology
- **Router-first mode**: file has only comment headers (empty template for the player)
- Format: `forward <public_port> to <internal_ip>:<port>` — comments (`#`) and blank lines are ignored

### Backdoor chain forwarding

When the `backdoor_port_open` exploit effect plants an nc listener on an internal machine, `backdoorForwarding.ts` appends a `forward` rule to every gateway's `rules.v4` between that machine and the public edge (via `gatewayChain.ts`). Each gateway independently picks the backdoor port first, or the next free port if taken. The public-edge IP and port are reported back to the player so they can re-enter from outside. Rules survive nc-listener death — defenders can grep `/etc/iptables/rules.v4` as a forensic breadcrumb.

## Dynamic SNMP Firewall

For the SNMP entry variant, `NetworkProvider` also reads `/etc/snmp/snmpd.conf` from the router's filesystem. `snmpFirewallParser.ts` extracts `firewallSSH`/`firewallHTTP` OID values (`permit`/`deny`). When `snmpset` modifies the file, port state updates dynamically — `firewallSSH permit` opens port 22 on the router. `applySnmpFirewallOverrides()` overlays these changes onto the router's `RemoteMachine` view visible from localhost.

## Dynamic Switch ACLs

For managed Layer 3 switch gateways, `NetworkProvider` reads `/etc/switch/acl.conf` and SNMP ACL OIDs from `/etc/snmp/snmpd.conf`. Switch gateways use ACL deny rules instead of NAT/iptables — no address translation.

- **ACL rules** (`aclParser.ts`): `deny tcp any 10.42.2.0/24 port 22` blocks SSH to the downstream subnet. Players clear deny rules via `nano` or `snmpset`.
- **SNMP ACL OIDs** (`snmpAclParser.ts`): `aclSSH`/`aclHTTP`/`aclFTP` with `allow`/`deny` values. When `snmpset` changes `aclSSH` to `allow`, port 22 opens for downstream machines.
- **Port filtering**: `applyAclFiltering()` in `networkUtils.ts` closes ports on downstream machines when ACL deny rules are active. SNMP ACL `allow` overrides take precedence over static ACL deny rules.

## Dynamic Daemon Ports

PID files are the **source of truth for daemon-running state** across every infrastructure service. `applyDynamicOverrides` in `networkUtils.ts` reads each machine's `/var/run/*.pid` files and derives both port-open overrides (presence) and port-closure (absence) — symmetric semantics for ssh, ftp, nc backdoors, AND every entry in `INFRA_PID_CONFIGS` (nginx, mysqld, redis-server, dovecot, etc.).

**Per-daemon parsers:**

- `parseSshdState()` consumes `sshd:port=N` from `/var/run/sshd.pid`.
- `parseFtpdState()` consumes `vsftpd:port=N` from `/var/run/vsftpd.pid`.
- `parseNcPidFiles()` consumes `nc:port=N,user=X,userType=T,home=P` from every `/var/run/nc-*.pid`.
- `parseInfraDaemonState()` consumes `${binary}:port=${N}` from every infra pid file. Multi-line content is supported — nginx serving both 80 and 443 ships one `nginx.pid` containing both lines. Services sharing a pid file (http/https/http-alt → nginx.pid; imap/imaps/pop3 → dovecot.pid) share fate: if the pid file is missing, all their ports close together.

`applyDaemonOverrides()` merges the resulting overrides into the machine's `RemoteMachine.ports`, opening matching closed ports and adding new ones. PID-file ABSENCE drives the closure side — services whose pid file isn't on disk get their ports forced to `open: false` in the dynamic view.

**Player-driven daemon control** (sshd, vsftpd, nc): the corresponding command writes the pid file when started (`sshd(2222)`, `bash('/usr/sbin/vsftpd')`, `nc("-l", 4444)`). `systemctl('stop', service)` deletes it. nc listener pid files carry owner metadata so a remote `nc()` connection lands as the user who opened the listener.

**Generator-driven daemon stamping** (infra services): `buildInfrastructurePidFiles()` in `src/generation/filesystem/infraPidFiles.ts` builds the canonical pid file FileNodes from each machine's open infra ports, grouping ports by daemon (nginx, dovecot, etc.) into multi-line content. Every generator that opens an infra port must ship the matching pid file — mission/home networks get this via `buildMachineConfig`; themed networks (techparts.io, findit.io) call `buildInfrastructurePidFiles` directly and merge into `extraDirectories` via `mergeFileNodeChildren`.

Port binding follows Unix rules: ports below 1024 require root.

## Dpkg Status (Service Version Tracking)

`dpkgStatus.ts` implements a Debian-style `/var/lib/dpkg/status` parser/writer. The file uses RFC-822-like format: entries separated by blank lines, each entry containing `Package`, `Status`, and `Version` fields. The game uses this as the source-of-truth for service versions on each machine:

- **Generation time** — `buildInitialDpkgStatus(ports, firmwareVersion?)` seeds the file with one entry per running service. For routers, a synthetic `firmware` package entry is included.
- **Runtime mutation** — `apt upgrade` calls `setDpkgVersion(content, pkg, version)` to update a package's version in-place (preserving other fields) or append a new entry.
- **Read path** — `parseDpkgVersions(content)` returns a `Package -> Version` map consumed by the version overlay.

Exports: `DpkgEntry` type, `parseDpkgStatus`, `parseDpkgVersions`, `formatDpkgStatus`, `buildEntry`, `buildInitialDpkgStatus`, `setDpkgVersion`, `DPKG_STATUS_PATH`.

## Version Overlay

`applyVersionOverlay.ts` wraps a `RemoteMachine` so that `port.serviceVersion` reads come from `/var/lib/dpkg/status` if an entry exists for the port's service name; otherwise it falls through to the generation-time default. For routers, the `firmwareVersion` field is also overlaid from the `firmware` package entry.

This is applied transparently by `useNetworkCommands` — consumers like `nmap`, `msfconsole`, and the exploit-logging callback see post-overlay versions without any special handling. When a player runs `apt upgrade` on a machine, the dpkg/status file updates, and subsequent version reads reflect the patched version.
