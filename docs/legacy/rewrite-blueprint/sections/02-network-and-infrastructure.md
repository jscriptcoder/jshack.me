# 2. Network & Infrastructure

## 2.1 Core Types (Machine, Port, Interface, etc.)

The network simulation is **per-machine** — each machine maintains its own view of reachable machines, network interfaces, and DNS records. All types are defined in `src/network/types.ts`.

### NetworkInterface

Represents a single network interface (lo, eth0, wlan0, etc.) on a machine:

```typescript
type NetworkInterface = {
  readonly name: string; // "lo", "eth0", "wlan0", etc.
  readonly flags: readonly string[]; // ["UP", "LOOPBACK", "RUNNING"]
  readonly inet: string; // IP address (e.g., "192.168.1.100")
  readonly netmask: string; // Netmask (e.g., "255.255.255.0")
  readonly gateway: string; // Gateway IP (e.g., "192.168.1.1")
  readonly mac: string; // MAC address (e.g., "02:42:ac:11:00:02")
};
```

**Localhost interfaces** (initial state):

- `loopback` (lo): UP, LOOPBACK, RUNNING; 127.0.0.1/255.0.0.0
- `wlan0`: DOWN; 0.0.0.0 with disconnected flags; becomes active when player connects to a WiFi network with dynamic IP from that subnet

Defined in `src/network/initialNetwork.ts`.

### Port

A network service listening on a port. Includes version info for scanning/exploitation and optional owner metadata for backdoors:

```typescript
type Port = {
  readonly port: number; // 22, 80, 443, etc.
  readonly service: string; // "ssh", "http", "https", "mysql", "elite", etc.
  readonly serviceVersion: string; // "OpenSSH_7.4" (overlaid at runtime from dpkg/status)
  readonly open: boolean; // Port is listening
  readonly protocol?: 'tcp' | 'udp'; // Defaults to "tcp"
  readonly owner?: ServiceOwner; // User who started the daemon (backdoors, apache2, nginx)
  readonly forwarded?: boolean; // True if added by NAT forwarding rules
  readonly forcedEffect?: VulnerabilityEffect; // Overrides vulnerability's natural effect
};

type ServiceOwner = {
  readonly username: string; // User who started the service
  readonly userType: 'root' | 'user' | 'guest';
  readonly homePath: string; // Home directory (e.g., "/root", "/home/alice")
};
```

Port generation templates per machine role are in `src/generation/pools/ports.ts`. Role-specific port templates (webserver has SSH+HTTP+HTTPS; database has SSH+MySQL; etc.) define which ports are open/closed by default.

### RemoteMachine

The public network view of a machine — what's visible to other machines on the network:

```typescript
type RemoteMachine = {
  readonly ip: string; // "10.45.12.100"
  readonly hostname: string; // "webserver", "router", etc.
  readonly ports: readonly Port[]; // Open and closed ports
  readonly users: readonly RemoteUser[]; // User accounts (no password hashes)
  readonly firmwareVendor?: string; // Router-only: "Cisco IOS", "MikroTik", etc.
  readonly firmwareVersion?: string; // Router-only: overlaid from /var/lib/dpkg/status
};

type RemoteUser = {
  readonly username: string;
  readonly userType: 'root' | 'user' | 'guest';
};
```

Users in `RemoteUser` carry no password hashes — hashes live canonically in `/etc/passwd` on the filesystem. Machine assembly (generation) strips hashes from `GeneratedUser` before populating `RemoteMachine.users`.

### MachineNetworkConfig

Per-machine network view — what that machine can see:

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

The config is **per-machine-ID** — machines in the same subnet see different machines than machines in other subnets. Mission machines see only their layer and adjacent gateways. Home network machines see only their layer. Localhost (when connected to WiFi) sees layer-0 machines and the border router.

### DNS Records

Simple A record for DNS lookups:

```typescript
type DnsRecord = {
  readonly domain: string; // "webserver.corp.local"
  readonly ip: string; // "10.45.12.100"
  readonly type: 'A'; // Only A records in Phase 3
};
```

## 2.2 Network Topology Model (LAN, Subnet, Gateway, Layers, Hop Chain)

### Network Layers & Subnet Topology

Both home networks and mission networks use the same **multi-layer subnet topology**:

**Easy**: 1 layer, 2 machines (layer 0 only), border router
**Medium**: 2 layers + 1 gateway, 5-7 machines total
**Hard**: 3 layers + 2 gateways, 8-11 machines total

Key invariant: machines in one layer see only their own layer's machines and their gateway (the `.1` IP). Machines cannot see deeper layers without pivoting through a gateway.

Defined in `src/generation/types.ts` as `SubnetLayer`:

```typescript
type SubnetLayer = {
  readonly subnet: string; // "10.45.12.0/24"
  readonly gateway: GeneratedMachine; // The .1 machine bridging to next layer
  readonly gatewayType: GatewayType; // "router" or "switch"
  readonly entryVariant: EntryVariant; // "ssh", "ftp", "nc", "exploit", "http", "snmp"
  readonly machines: readonly GeneratedMachine[];
  readonly isForwarded: boolean; // NAT forwards entry ports to this layer
};
```

### Network Resolution Priority (Mission vs Home vs Disconnected)

`NetworkContext` (in React) resolves the active network config based on:

1. **Mission machines** — if SSH'd into a mission-network IP, return that machine's mission config
2. **Home network machines** — if SSH'd into a home-network IP, return that machine's home config
3. **Localhost + WiFi connected** — return home network config with dynamic wlan0 IP
4. **Localhost + WiFi disconnected** — return disconnected state (lo only, no reachable machines, no DNS)

### Gateway Roles & Addressing

**Border Router** (`role: "router"`):

- Has a public IP (allocated from `src/ipRegistry/`, kind=`mission_instance` for missions)
- Has an internal IP in layer-0 subnet (e.g., 10.45.12.1)
- Dual interfaces: `eth0` (public), `eth1` (layer-0 gateway)
- Owns `/etc/iptables/rules.v4` for NAT forwarding rules
- Owns `/etc/snmp/snmpd.conf` for SNMP firewall OIDs
- Ships users, filesystem, and can be hacked like any other machine

**Inner Gateways** (layer-to-layer bridges):

- **Router gateway** (`role: "router"`): NAT-capable with `/etc/iptables/rules.v4` and SNMP firewall OIDs
- **Switch gateway** (`role: "switch"`): Layer-3 managed switch with `/etc/switch/acl.conf` ACL rules; no NAT, only ACL-based filtering (40% of inner gateways)

Both gateway types are **dual-homed**:

- `eth0`: IP in upstream subnet (e.g., 10.x.x.y)
- `eth1`: IP in downstream subnet as `.1` (e.g., 10.y.y.1)

### Gateway `.1` Aliasing

For usability, gateways support SSH connections to their downstream `.1` IP. In `src/homeNetworks/homeNetworkHelpers.ts`, the function `targetMachineIdFor` canonicalizes `.1` alias traffic to the gateway's primary IP. Example: home router has primary IP 203.45.67.89 (public) + 10.45.12.1 (internal). When a player on the LAN SSH's to 10.45.12.1, writes/reads canonicalize to machine_id="203.45.67.89" so cross-player edits via the `.1` interface land in the same `patches` row as cross-LAN access via the public IP.

### Hop Chain (Gateway Chain to Public Edge)

When an exploit plants a backdoor (`backdoor_port_open` effect), the function `findGatewayChainFor(machineIp, layers)` in `src/network/gatewayChain.ts` returns the ordered list of gateways from the target's layer to the border router. Each gateway installs a NAT forward rule, picking a free public port on itself. The outermost (border) router's port is reported to the player so they can reconnect from outside.

Implemented in `src/network/backdoorForwarding.ts`.

## 2.3 Daemons & State Parsers

PID files at `/var/run/*.pid` are the **single source of truth** for daemon-running state. Each daemon's state — port number, owner — is encoded in the PID file content and parsed at runtime.

### 2.3.1 SSH (sshd)

**Pid file**: `/var/run/sshd.pid`
**Content format**: `sshd:port=N` (e.g., `sshd:port=2222`)
**Port**: Any valid port 1-65535; default 22
**Open by default**: Yes (on all machines)
**Owner**: root (always; SSH requires privileged port)

Parser: `src/network/sshdStateParser.ts`. Extracts port from `sshd:port=N`, validates 1-65535.

**Player control**: `sshd(port)` command writes the pid file; `systemctl stop ssh` deletes it.

### 2.3.2 FTP (vsftpd)

**Pid file**: `/var/run/vsftpd.pid`
**Content format**: `vsftpd:port=N` (e.g., `vsftpd:port=2121`)
**Port**: Any valid port; default 21
**Open by default**: Yes (on fileserver and some entry machines)
**Owner**: root (FTP requires privileged port for < 1024)

Parser: `src/network/ftpdStateParser.ts`. Extracts port from `vsftpd:port=N`.

**Player control**: `bash('/usr/sbin/vsftpd')` or direct `vsftpd(port)` command writes pid file.

### 2.3.3 NC Backdoors (elite service)

**Pid files**: `/var/run/nc-<port>.pid` (one per listener)
**Content format**: `nc:port=N,user=U,userType=T,home=H` (e.g., `nc:port=4444,user=root,userType=root,home=/root`)
**Port**: Arbitrary ephemeral ports (e.g., 4444, 8888, 31337)
**Owner**: The user who started the listener; tier (`root`/`user`/`guest`) determines shell privileges
**Open by default**: No; only when player runs `nc -l <port>` or exploit plants one

Parser: `src/network/ncStateParser.ts`. Extracts port, username, userType, homePath. Scans /var/run for nc-\*.pid files and parses each.

**Player control**: `nc("-l", port)` command writes `/var/run/nc-<port>.pid` with the invoking user's identity.

**Backdoor plants**: `msfconsole` with `backdoor_port_open` effect writes the pid file on the target. For NPC-baked backdoors (elite ports with owner in generation), `buildNcBackdoorPidFiles()` generates the pid file at creation time.

### 2.3.4 Infrastructure Daemons (nginx, mysqld, redis, etc.)

**Pid files**: One per daemon binary (nginx.pid, mysqld.pid, redis-server.pid, dovecot.pid, etc.)
**Content format — short form** (generation): `${binary}:port=${N}` (e.g., `/usr/sbin/nginx:port=80`)
**Content format — extended form** (player-run): `${binary}:port=${N},user=U,userType=T,home=H`
**Multi-line support**: Services sharing a pid file are grouped; one line per service

**Supported services** (from `INFRA_PID_CONFIGS` in `src/generation/filesystem/infraPidFiles.ts`):

- http, https, http-alt → nginx.pid → /usr/sbin/nginx → www-data
- mysql → mysqld.pid → /usr/sbin/mysqld → mysql
- postgresql → postgres.pid → /usr/sbin/postgres → postgres
- redis → redis-server.pid → /usr/sbin/redis-server → redis
- mongodb → mongod.pid → /usr/sbin/mongod → mongodb
- smtp → postfix.pid → /usr/sbin/postfix → postfix
- imap, imaps, pop3 → dovecot.pid → /usr/sbin/dovecot → dovecot
- mqtt → mosquitto.pid → /usr/sbin/mosquitto → mosquitto
- dns → named.pid → /usr/sbin/named → bind
- snmp → snmpd.pid → /usr/sbin/snmpd → snmp
- smb → smbd.pid → /usr/sbin/smbd → root
- modbus → modbusd.pid → /usr/sbin/modbusd → root
- openvpn → openvpn.pid → /usr/sbin/openvpn → root
- vnc → vncserver.pid → /usr/sbin/Xvnc → root
- rsync → rsyncd.pid → /usr/sbin/rsyncd → root

Parser: `src/network/infraDaemonStateParser.ts`. Parses short + extended forms; validates port against PORT_TO_SERVICE table.

**Generator responsibility**: Every machine that ships an open infra port must include the matching pid file via `buildInfrastructurePidFiles(ports)`. Omitting the pid file causes the port to close at runtime.

**Fate-sharing**: Services sharing a pid file (e.g., http/https/http-alt in nginx.pid) close together when the pid file is absent. Exception: if `apache2.pid` exists, `http`/`https` ports served by apache2 are NOT closed when nginx.pid is absent.

### 2.3.5 Apache2 / Nginx (Player-Run Web Servers)

**Apache2 pid file**: `/var/run/apache2.pid`
**Nginx pid file**: `/var/run/nginx.pid`
**Content format**: `${binary}:port=N,user=U,userType=T,home=H` (required: all four fields)
**Port mapping for apache2**: 443→https, 8080→http-alt, else→http
**Port mapping for nginx**: 80→http, 443→https, 8080→http-alt

Parser: `src/network/apache2StateParser.ts`. Validates all four fields required; port range 1-65535.

**Player control**: `apache2(port)` and `nginx(port)` commands write pid files with the invoking user. Enforces privilege requirement (port < 1024 needs root).

## 2.4 Iptables, NAT, Firewalls, ACL

### Iptables & Port Forwarding (NAT)

**File**: `/etc/iptables/rules.v4` on router machines
**Format**:

```
# Comments and blank lines ignored
forward <public_port> to <internal_ip>:<internal_port>
forward 2222 to 10.45.12.100:22
forward 8080 to 10.45.12.50:80
```

Parser: `src/network/iptablesParser.ts`

**Semantics**:

- **Forwarded mode**: Rules pre-populated at generation; easy missions 70% chance, medium 50%
- **Router-first mode**: File starts as empty template; player must edit with `nano`
- **NAT resolution**: `resolveNat(publicIp, publicPort)` returns `{internalIp, internalPort}`
- **LAN-side visibility**: Forwarded ports stay hidden from LAN-side scans (PREROUTING semantic)
- **Backdoor NAT installation**: When `msfconsole` plants backdoor, calls `findGatewayChainFor(targetIp, layers)` to get ordered gateway list. For each gateway, appends a `forward` rule to its `/etc/iptables/rules.v4`. Each gateway picks the first free public port. Border router's final port is reported to player.

Implemented in `src/network/backdoorForwarding.ts`.

### SNMP Firewall OIDs (Router variant)

**File**: `/etc/snmp/snmpd.conf` on router machines
**Format**:

```
firewallSSH permit    # Port 22 open
firewallSSH deny      # Port 22 closed
firewallHTTP permit   # Port 80 open
firewallHTTP deny     # Port 80 closed
```

Parser: `src/network/snmpFirewallParser.ts`. Maps firewallSSH→22, firewallHTTP→80; value permit/deny → open true/false.

**Gameplay**: SNMP entry variant locks out TCP connections. Player discovers SNMP via `nmap -sU`, uses `snmpwalk` with RW community string to find firewall OIDs, then `snmpset` changes `deny` to `permit` to open ports dynamically.

### ACL Rules (Switch gateway variant)

**File**: `/etc/switch/acl.conf` on switch gateways
**Format**:

```
deny tcp any 10.45.2.0/24 port 22   # Block SSH to downstream subnet
allow tcp any 10.45.2.0/24 port 80  # Allow HTTP
```

Parser: `src/network/aclParser.ts`. Last matching rule wins (like real ACLs).

**Gameplay**: No NAT; layer filtering is purely ACL-based. Player clears deny rules via `nano` or SNMP ACL OIDs.

### SNMP ACL OIDs (Switch variant)

**File**: `/etc/snmp/snmpd.conf` on switch gateways
**Format**:

```
aclSSH allow    # Port 22 open to downstream
aclSSH deny     # Port 22 closed to downstream
aclHTTP allow   # Port 80 open
aclFTP allow    # Port 21 open
```

Parser: `src/network/snmpAclParser.ts`. Maps aclSSH→22, aclHTTP→80, aclFTP→21; value allow/deny → allowed true/false.

**Precedence**: SNMP ACL `allow` overrides static ACL deny rules.

## 2.5 DNS: Zone Files, AXFR, dig

**DNS records** are per-machine and stored in `MachineNetworkConfig.dnsRecords`:

```typescript
type DnsRecord = {
  readonly domain: string; // "webserver.corp.local"
  readonly ip: string; // "10.45.12.100"
  readonly type: 'A';
};
```

**Resolution** via `useNetwork().resolveDomain(domain)` on the current machine.

**Stored in filesystem**: DNS-serving machines (role=`dns`) have a `/var/lib/bind/zone.local` file with realistic BIND zone file format.

**Phase 3 limitation**: AXFR (zone transfers) and `dig` command are not yet implemented. Future work will add full zone-transfer reconnaissance.

## 2.6 Logging Formats & Triggers

All logging is **append-only** to machine filesystem paths. Log files are created on first write, are world-readable, and persist via IndexedDB.

Defined in `src/logging/`.

### 2.6.1 Auth Log (`/var/log/auth.log`)

**Format**: Syslog (RFC 3164)
**Triggers**: SSH/SCP login success/fail, su success/fail, hydra SSH brute-force aggregate

**Example**: `Mar 21 14:30:00 webserver sshd[1234]: Accepted password for admin from 10.0.1.100 port 45000 ssh2`

Formatters (`src/logging/formatters.ts`):

- `formatSyslogLine()` — generic syslog template
- `formatSshAccepted()` — password auth success
- `formatSshAcceptedKey()` — public-key auth success
- `formatSshFailed()` — password auth failure
- `formatScpAccepted()` / `formatScpFailed()` — SCP
- `formatSuSuccess()` / `formatSuFailed()` — su command
- `formatHydraBruteForceSsh()` — SSH brute-force aggregate

**Logged on**: Target machine (the one with sshd listening). When port is NAT-forwarded, log lands on the backend where sshd actually runs.

### 2.6.2 FTP Log (`/var/log/vsftpd.log`)

**Format**: vsftpd native
**Triggers**: FTP connect, login success/fail, hydra FTP brute-force aggregate

**Example**: `[2026-03-21 14:30:00] OK LOGIN: Client "10.0.1.100", user "ftpuser"`

Formatters: `formatFtpConnect()`, `formatFtpLoginOk()`, `formatFtpLoginFailed()`, `formatHydraBruteForceFtp()`.

### 2.6.3 MySQL Log (`/var/log/mysql.log`)

**Format**: MySQL general log
**Triggers**: MySQL connect success/fail, query attempts, hydra MySQL brute-force aggregate

**Example**: `2026-03-21T14:30:00.000000Z	42 Connect	admin@10.0.1.100 on webapp_db using TCP/IP`

Formatters: `formatMysqlConnect()`, `formatMysqlAccessDenied()`, `formatMysqlAttack()`, `formatHydraBruteForceMysql()`.

### 2.6.4 Redis Log (`/var/log/redis.log`)

**Format**: Redis native
**Triggers**: Redis connect, auth success/fail, hydra Redis brute-force aggregate

**Example**: `1234:M 21 Mar 2026 14:30:00.000 * Client connected from 10.0.1.100`

Formatters: `formatRedisConnect()`, `formatRedisAuth()`, `formatRedisAuthDenied()`, `formatHydraBruteForceRedis()`.

### 2.6.5 Access Log (`/var/log/access.log`)

**Format**: Apache Combined Log Format (also used for gobuster aggregates as mod_security style)
**Triggers**: HTTP requests (curl), gobuster directory enumeration aggregate

**Example**: `10.0.1.100 - - [21/Mar/2026:14:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234`

Formatters: `formatAccessLog()`, `formatGobusterScanAggregate()` (mod_security style).

### 2.6.6 Kernel Log (`/var/log/kern.log`)

**Format**: iptables LOG style
**Triggers**: nmap port scan aggregate

**Example**: `Mar 21 14:30:00 webserver kernel: [iptables] Port scan from 10.0.1.100 — probed ports 22,80,443 (3 hits)`

Formatters: `formatNmapScanAggregate()`.

### 2.6.7 Syslog (`/var/log/syslog`)

**Format**: Syslog (generic)
**Triggers**: nc connections, hydra SNMP aggregate, SNMP community discovery

**Example**: `Mar 21 14:30:00 webserver xinetd[9999]: START: connection from=10.0.1.100 to port=4444`

Formatters: `formatXinetdConnection()`, `formatHydraBruteForceSnmp()`, `formatSnmpCommunityDiscovered()`.

### 2.6.8 Scan & Brute-Force Aggregates

Scan tools (nmap, gobuster) and brute-force tools (hydra) do **not** log one entry per probe/attempt. Instead they emit one aggregate line showing summary counts. Hydra additionally writes one normal login line per successful crack (indistinguishable from a legitimate login). This mirrors real defensive tooling (netfilter LOG, fail2ban) which summarizes enumeration bursts rather than flooding logs.

## 2.7 IP Registry & Allocation

Public IPs are server-allocated per `src/ipRegistry/`. Clients sign requests with their identity key; server verifies signature and returns a unique public IP.

**Kinds**:

- `mission_instance` — per-mission border router (player-owned)
- `home_network` — player's home LAN router (player-owned)
- `pivot` — player-controlled relay machine (player-owned)
- `npc_faction` / `darknet_hub` — world-owned infrastructure (future)

**Allocation**: Random IP roll in public space with INSERT-or-retry on PK conflict. Deterministic per request (verified public key + kind + optional instance_ref).

## 2.8 Initial Workstation Network Shape

Localhost starts with:

- **Hostname**: player-configured (e.g., "skylab")
- **Users**: root (password from intro), current user (empty password), guest (seed-derived)
- **Interfaces**: lo (127.0.0.1), wlan0 (DOWN, 0.0.0.0)
- **Reachable machines**: none (must crack WiFi first)

Generated via `generateLocalhost(gameState)` in `src/generation/generateLocalhost.ts`.

**After connecting to WiFi**:

- **wlan0**: UP with dynamic IP from home-network subnet (e.g., 10.45.12.100)
- **Hostname**: suffixed with player identity hash (e.g., "skylab-9k3d")
- **Reachable machines**: all layer-0 machines + border router public IP + border router internal IP
- **DNS**: home network's DNS records
- **Gateway**: border router's internal IP (10.45.12.1 for border in that subnet)

## 2.9 Reconnaissance Behavior (nmap, ping, connect)

### nmap

- **TCP scan** (`nmap <ip>` or `nmap -p <ports> <ip>`): Probes open ports on the target
- **UDP scan** (`nmap -sU <ip>`): Probes UDP ports (discovers SNMP on 161)
- **Version scan**: Automatic; versions overlaid from `/var/lib/dpkg/status`
- **Logging**: One aggregate line in `/var/log/kern.log` showing source IP and probed ports
- **NAT-aware**: When scanning a forwarded port, `resolveNat` translates public→internal and logs on the backend

### ping

- **ICMP echo**: Checks machine reachability
- **Response**: Target machine responds if reachable in the network config
- **Logging**: Not logged

### connect (nc / SSH / FTP)

- **Socket attempt**: Try to connect to IP:port
- **Success**: Reach the target machine (either direct or through NAT)
- **Logging**: Depends on the service (SSH logs to auth.log, FTP to vsftpd.log, nc to syslog)
- **NAT resolution**: Applied before logging; log lands on the backend machine

## 2.10 Pools (Ports, Machines, Web Banners)

### Port Pools (`src/generation/pools/ports.ts`)

**Role-based templates** define default open/closed ports per machine role.

**Backdoor ports** (elite service, nc listeners): 4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234

**Entry port templates** define layer-specific access variants (ssh: 22+80; ftp: 21+22; nc: 22+4444/31337/8888; exploit: 80/443; http: 80+443; snmp: 22+80+161udp).

### Machine Pools (`src/generation/pools/machines.ts`)

**Client handles**: 45 hardcoded choices for NPC usernames (xR0gu3x, cyph3rpunk, zer0day\_, etc.)

**Role-specific usernames**: Pool of realistic usernames per machine role (www-data, webadmin, apache for webserver; dbadmin, postgres, mysql for database; etc.).

### Web Content Templates (`src/generation/pools/web.ts`)

Realistic HTML templates for `/var/www/html/index.html`:

- **Generic servers**: "Status OK", build version, admin links
- **Router admin panels**: Cisco IOS, MikroTik, pfSense, OPNsense HTML login forms
- **IoT devices**: GoAhead httpd, Hikvision IP camera, HVAC controller BMS, Sensor Hub

All use `{{hostname}}` and `{{timestamp}}` substitution.

### Vulnerability Pools (`src/generation/pools/vulnerabilities.ts`)

**Hand-authored CVEs** (39 entries, `publishedAt=0`, always live):

- Iconic exploits (Apache/2.4.49 CVE-2024-9001, vsftpd 2.3.4 smiley-face backdoor, etc.)
- Diverse effects (shell_limited, shell_full, file_read, file_write, dir_list, password_reset, backdoor_port_open, script_exec)
- Per-service distributions (SSH = universal hammer; FTP = read/write/backdoor; databases = password_reset/script_exec; web = script_exec)

**Procedural CVEs** (walker-generated from `src/generation/timeline/walker.ts`):

- ~43 CVEs per service per year (1 new CVE every ~13 hours across 15 services)
- Procedural timelines for: HTTP, nginx, Apache, SSH, FTP, MySQL, PostgreSQL, Redis, MongoDB, DNS, SMTP, IMAP, MQTT, Modbus, VNC, OpenVPN
- Router firmware timelines (Cisco IOS, MikroTik, DD-WRT, OpenWRT, pfSense, EdgeOS)
- System library timelines (libpam, libcrypt, libssl, libz, libxml2, libpcre, libsystemd, libreadline)

**Patch delay**: After CVE publishes, fix is not immediately available. `minPatchDelayDays` and `maxPatchDelayDays` control window. Config invariant ensures every fix has a positive safe window.

## 2.11 dpkg/status & Version Overlay System

**File**: `/var/lib/dpkg/status` (RFC-822 format)

**Example**:

```
Package: nginx
Status: install ok installed
Version: 1.24.0

Package: firmware
Status: install ok installed
Version: 2.4.1
```

**Seeding**: `buildInitialDpkgStatus(ports, firmwareVersion?, libraryVersions?)` writes one entry per running service at generation time. Routers get a synthetic `firmware` entry. System libraries get one entry each.

**Runtime overlay**: `applyVersionOverlay(machine, readFileFromMachine)` wraps `RemoteMachine` so `port.serviceVersion` reads come from dpkg/status if available. Also sets `machine.firmwareVersion` from the firmware package entry.

**Updates**: `setDpkgVersion(content, pkg, version)` modifies a single package in-place. Used by `apt upgrade` and `apt install pkg=version`.

**Consumers**: `useNetworkCommands` applies the overlay to every machine read — nmap, msfconsole, and the exploit-logging callback all see overlay-aware versions transparently.
