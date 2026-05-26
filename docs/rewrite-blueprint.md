# JSHACK.ME Rewrite Blueprint

A complete snapshot of every feature, system, and design decision in the current React/TypeScript codebase, prepared for a from-scratch rewrite in Solid.js.

The goal: a Solid engineer (or future Claude session) can re-implement the whole game from this folder without reading the original source, while keeping every gameplay-meaningful behavior intact. Mission content is deferred — multiplayer + CVEs + cross-player are the priority.

## How to read this

- **Start with Section 4 (Multiplayer Foundation)** if you're scoping the rewrite — it's the load-bearing system and the longest section. Identity → signed envelope → L1 → L2 (reads + writes + auth) → deferred L3 are all enumerated, with the threat-model summary table at §4.18.
- **Section 3 (CVE & Exploit System)** is the second-most-protected design — the 8 effect kinds, day-0 vs procedural timing, library CVE chain, defense treadmill, msfconsole variants. Worth reading before touching network/exploit code.
- **Section 5 (Shared World)** documents the seed-regen cross-LAN approach, foreign LAN occupants, and the React closure-capture pattern (which will need a different shape under Solid's signal model).
- **Sections 1, 2, 6** describe terminal UX, network/daemon model, and filesystem/generation — read once each to scope work.
- **Section 7 (Game Shell)** covers intro/boot/lifecycle/persistence and ends with a deliberately-skimmed mission overview.

## Security layer index

Captured across multiple sections (Section 4 is the hub):

| Layer | Where documented | What it protects |
| ---- | ---------------- | ---------------- |
| L0 — transport / envelope | §4.3 signed envelope + §4.3 replay protection | Forgery, replay, signature malleability |
| L1 — session presence    | §4.8 + ambient-log allowlist                  | "Caller has no session on this machine"  |
| L2 — write permission    | §4.9 walker + machine_filesystems projection  | Guest writing to root-owned paths        |
| L2 — read privacy        | §4.10 three-tier read filter                  | No-session callers reading secrets       |
| L2 — auth + userType     | §4.6 createSession + authCreateSession        | Forging "I am root" via envelope         |
| L3 — game-logic (deferred) | §4.17 + §4.18 boundary table                  | Forge bypasses on exploitRead/password_reset |
| RLS (Supabase)           | §4.4 per-table posture                        | Direct anon SELECT on sensitive tables   |
| Anti-cheat (client)      | §6.11 build-time secrets encoding             | Flag/password search through JS bundle   |

## Sections

1. [Terminal & Commands](sections/01-terminal-and-commands.md)
2. [Network & Infrastructure](sections/02-network-and-infrastructure.md)
3. [CVE & Exploit System](sections/03-cve-and-exploits.md)
4. [Multiplayer Foundation](sections/04-multiplayer-foundation.md) ← **start here for the rewrite scope**
5. [Shared World & Cross-Player](sections/05-shared-world-and-cross-player.md)
6. [Filesystem, Users, Generation](sections/06-filesystem-and-generation.md)
7. [Game Shell & Lifecycle](sections/07-game-shell-and-lifecycle.md)

## Out of scope for this blueprint

- **Mission content** — Player explicitly deferred. Section 7.14 sketches the lifecycle and points at `docs/mission-variations.md`. Multiplayer + CVEs come first; missions get redesigned on top.
- **UI styling specifics** — The CRT amber-on-black aesthetic and theme catalog are noted (§7.9) but exact CSS values aren't reproduced; the rewrite can re-derive from `src/theme/themes.ts`.
- **Test coverage strategy** — TDD principles in `docs/development-guidelines.md` carry over; the smoke-test catalog (§4.19) is what matters for multiplayer.

## Cross-cutting concerns the rewrite should design for from day one

1. **Server-authoritative gameTime** — Currently `Date.now() - startedAt` client-side. Memory `project_multiplayer_design_notes` flags this as anti-cheat work. Bake server-stamped gameTime into the API surface from the start (§7.5).
2. **Solid's signal model vs React closure-capture pattern** — The whole `useNetworkCommands` ref-wrap + `flushSync` pattern documented in §5.9 is a React-specific bug shape. Solid signals don't capture stale values the same way; this should simply not exist in the rewrite. Don't port the workaround.
3. **Shared permission walker as a pure module** — §4.9 + §6.2. The walker is byte-identical client + server; keep that property in the rewrite (single `permissionWalker.ts`, imported by both sides).
4. **Patch-stream + Realtime hint-only broadcasts** — §4.14. Don't ship full payloads through Realtime. The hint architecture (`{ machine_id, originator_key }` → refetch via signed endpoint) is the load-bearing design.
5. **/etc/passwd as the canonical credential source** — §6.3 + §4.6. No `passwordHash` field on RemoteUser, no `/etc/shadow`. Sabotage-via-garble is a real attack vector by design.
6. **Identity vs wallet keypair split** — §4.1 + §4.2 + §7.8. Two keypairs, different storage, different threat models. Don't merge them.
7. **`'ed25519:'` prefix in computeWorkstationId** — §4.1. Load-bearing invariant; calling derive with raw playerKey produces a divergent suffix and silently breaks auth.

## Glossary (quick reference)

- **L1 / L2 / L3** — server-side patch-validation layers; see Security Layer Index above.
- **machine_id** — canonical identifier for a machine on the wire. For a player's own workstation, this is `${workstation_name}-${first-8-hex(sha256('ed25519:' + playerKeyHex))}`.
- **gameTime** — whole days elapsed since the player's `startedAt` anchor. Drives CVE publication timing.
- **publishedAt** — game days from `startedAt` after which a CVE is exploitable. Hand-authored CVEs have `publishedAt=0` (day-0); procedural CVEs are time-gated.
- **effect kind** — one of 8 outcomes a CVE can produce: shell_full (tiered), shell_limited, file_read, dir_list, file_write, password_reset, backdoor_port_open, script_exec.
- **userType** — `'guest' | 'user' | 'root'`. The tier the session walks at.
- **Layer 0** — the player's local LAN interface (vs deeper subnet layers behind a router).
- **occupant** — a player who has joined a shared home network.
- **seed-regen** — the cross-LAN resolution strategy: any foreign-IP access regenerates the entire foreign HomeNetwork client-side from its seed and slots it into the local network view.


---

# 1. Terminal & Commands

This section documents the user-facing CLI layer of jshack.me: the terminal UI, shell parser, command registry, scripting runtime, and special modes (nano, lynx, nc, FTP, MySQL, Redis). A fresh engineer should be able to re-implement every behavior from this document.

## 1.1 Terminal UI

### Core Components

**Terminal.tsx** (src/components/Terminal/Terminal.tsx): main orchestrator
- Manages input state: `input` (string), `asyncRunning` (bool), `editorState` (nano), `lynxState` (lynx)
- Manages output: `lines` (array of OutputLine), auto-scroll on new output
- Command execution pipeline: tokenize -> parse -> execute via `src/shell/`
- Mode switching: normal -> password prompt -> FTP mode -> NC mode -> MySQL mode -> Redis mode
- Async streaming with cancellation: stores `asyncCancelRef` and calls `.cancel()` on Ctrl+C
- Editor & browser overlays: NanoEditor and LynxBrowser as fixed z-50 overlays
- Prompts and auth handling: password mask, FTP username/password two-stage, SSH key auto-auth
- Logging callbacks: `onSuAuth`, `onSshAuth`, `onFtpAuth` write to target machine log files

**TerminalInput.tsx** (src/components/Terminal/TerminalInput.tsx): input line
- Prompt: `user@machine>` (normal), hidden (password/username), `ftp>` (FTP), `$` (NC), `mysql>` (MySQL), `redis>` (Redis)
- Rendering: prompt (dim), input (bright), cursor (theme caret color)
- Password mode: `type="password"` input, masks with `*`
- Keyboard bindings:
  - **Enter**: calls `onSubmit()` (executes command)
  - **ArrowUp**: calls `onHistoryUp()` (navigate history backward)
  - **ArrowDown**: calls `onHistoryDown()` (navigate history forward)
  - **Tab**: calls `onTab(cursorPosition)` for autocomplete
  - Disabled in password/username mode (no history, no tab)
- Cursor positioning: programmatic changes reset cursor to end via `useEffect`
- Text input: `isUserInput` ref tracks whether change is user-typed or programmatic

**TerminalOutput.tsx** (src/components/Terminal/TerminalOutput.tsx): output rendering
- Line types: `banner`, `command`, `result`, `error`, `author`
- All colors use CSS custom properties (`var(--theme-*)`) for theme switching
- Auto-scroll on new lines

**NanoEditor.tsx** (src/components/Terminal/NanoEditor.tsx): text editor overlay
- Layout: title bar, textarea, status bar, help bar
- Title: `GNU nano 7.2 [filename] [Modified]`
- Full-screen overlay: `fixed z-50`, dark background, theme colors
- **Ctrl+S**: saves via `onSave()` (existing) or `onCreate()` (new file)
- **Ctrl+X** or **Escape**: exits if unmodified; prompts if modified
- **Tab**: inserts 2 spaces at cursor
- Exit prompt: **Y** (save+close), **N** (discard+close), **C** (cancel)
- Status bar: cursor position, messages (auto-clear 3s)

**LynxBrowser.tsx** (src/components/Terminal/LynxBrowser.tsx): text-mode browser overlay
- Layout: title bar (page title + URL), scrollable body, status bar, help bar
- Fetch lifecycle: injected `onFetch(url)` callback (wired to use same NAT/logging as `curl`)
- HTML parsing: semantic markup via `renderHtml`, keeps multi-word link text atomic
- History stack: caches `{ url, response, rendered }` per page; Back is instant
- **ArrowUp/Down**: move cursor, **Enter/Right**: follow, **Left/Backspace**: back, **q/Escape**: quit

## 1.2 Shell Parser

The shell parser lives in `src/shell/` and handles tokenization, quoting, pipes, redirects, execution.

### Tokenization (tokenize.ts)

```
Token = {word, value} | {pipe} | {redirect}
```

Features:
- Single quotes: 'literal' (no escaping)
- Double quotes: "quoted" (supports `\"` and `\` escapes only)
- Backslash escapes: outside quotes, `\<char>` becomes `<char>`
- Pipes: `|` separates stages
- Redirect: `>` writes output to file
- Whitespace: spaces and tabs are boundaries

### Parsing (parse.ts)

```
Stage = {command: string, args: string[]}
Pipeline = {stages: Stage[], redirect?: {path: string}}
```

Features:
- Extracts redirect (trailing `> <path>`) - only legal at end
- Splits pipes, validates no empty groups
- Builds stages: first word is command, rest are args

### Execution (execute.ts)

```
execute(pipeline, registry, options) -> unknown
```

Flow:
1. For each intermediate stage, run and collect output as string
2. Async intermediate stages: collected synchronously (must complete immediately)
3. Pass string output as stdin to next stage (via ShellContext)
4. Run final stage, optionally feeding stdin
5. If redirect, write output via RedirectWriter callback
6. Return final result or undefined (if redirect)

Stdin passing: If command implements `fnShell(ctx, ...args)`, it receives stdin. Otherwise falls back to `fn(...args)`.


## 1.4 Scripting

node <file>.js execution:

Sync mode: Uses new Function constructor
Async mode: Uses AsyncFunction constructor, enables await

Execution context: All commands + writeFile() helper

writeFile(path, content): Write file with current user permissions
- string: written as-is
- string[]: joined with newline
- Objects: pretty-printed JSON
- Respects user write permissions

## 1.5 Hooks

useCommands: Top-level hook returning { commands, commandNames, lynxFetch }

useFtpCommands, useNcCommands, useMysqlCommands, useRedisCommands: Mode-specific, return null when inactive

useCommandHistory: Up/down navigation

useAuthentication: Password prompt state management

## 1.6 Special Modes

NC Mode: nc <host> <port> - read-only shell (pwd, cd, ls, cat, whoami, help, exit)

FTP Mode: ftp <host> - file transfer (pwd, lpwd, cd, lcd, ls, lls, get, put, quit)

MySQL Mode: mysql <host> <user> - SQL execution (SHOW TABLES, SELECT, UPDATE, DELETE, etc.)

Redis Mode: rediscli <host> - key-value commands (KEYS, GET, SET, DEL, etc.)

Nano Editor: nano <path> - text editor overlay with Ctrl+S save, Ctrl+X exit

Lynx Browser: lynx <url> - text browser with arrow key navigation

## 1.7 Tab Completion

classifyCursor: Determines if completion is for command, path, or flag

Completion algorithm:
- Commands: prefix match, longest common prefix, trailing space
- Paths: split dir+prefix, list+filter, common prefix, trailing slash
- Handles quotes and escapes

---

End of Section 1: Terminal & Commands

Comprehensive catalog of every command, parser feature, UI component, and execution mode.
For re-implementation, follow this structure and refer to file paths for original source.
All behavior is deterministic and reproducible from this specification.


---

# 2. Network & Infrastructure

## 2.1 Core Types (Machine, Port, Interface, etc.)

The network simulation is **per-machine** — each machine maintains its own view of reachable machines, network interfaces, and DNS records. All types are defined in `src/network/types.ts`.

### NetworkInterface

Represents a single network interface (lo, eth0, wlan0, etc.) on a machine:

```typescript
type NetworkInterface = {
  readonly name: string;              // "lo", "eth0", "wlan0", etc.
  readonly flags: readonly string[];  // ["UP", "LOOPBACK", "RUNNING"]
  readonly inet: string;              // IP address (e.g., "192.168.1.100")
  readonly netmask: string;           // Netmask (e.g., "255.255.255.0")
  readonly gateway: string;           // Gateway IP (e.g., "192.168.1.1")
  readonly mac: string;               // MAC address (e.g., "02:42:ac:11:00:02")
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
  readonly port: number;              // 22, 80, 443, etc.
  readonly service: string;           // "ssh", "http", "https", "mysql", "elite", etc.
  readonly serviceVersion: string;    // "OpenSSH_7.4" (overlaid at runtime from dpkg/status)
  readonly open: boolean;             // Port is listening
  readonly protocol?: "tcp" | "udp";  // Defaults to "tcp"
  readonly owner?: ServiceOwner;      // User who started the daemon (backdoors, apache2, nginx)
  readonly forwarded?: boolean;       // True if added by NAT forwarding rules
  readonly forcedEffect?: VulnerabilityEffect; // Overrides vulnerability's natural effect
};

type ServiceOwner = {
  readonly username: string;          // User who started the service
  readonly userType: "root" | "user" | "guest";
  readonly homePath: string;          // Home directory (e.g., "/root", "/home/alice")
};
```

Port generation templates per machine role are in `src/generation/pools/ports.ts`. Role-specific port templates (webserver has SSH+HTTP+HTTPS; database has SSH+MySQL; etc.) define which ports are open/closed by default.

### RemoteMachine

The public network view of a machine — what's visible to other machines on the network:

```typescript
type RemoteMachine = {
  readonly ip: string;                // "10.45.12.100"
  readonly hostname: string;          // "webserver", "router", etc.
  readonly ports: readonly Port[];    // Open and closed ports
  readonly users: readonly RemoteUser[];  // User accounts (no password hashes)
  readonly firmwareVendor?: string;   // Router-only: "Cisco IOS", "MikroTik", etc.
  readonly firmwareVersion?: string;  // Router-only: overlaid from /var/lib/dpkg/status
};

type RemoteUser = {
  readonly username: string;
  readonly userType: "root" | "user" | "guest";
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
  readonly domain: string;            // "webserver.corp.local"
  readonly ip: string;                // "10.45.12.100"
  readonly type: "A";                 // Only A records in Phase 3
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
  readonly subnet: string;            // "10.45.12.0/24"
  readonly gateway: GeneratedMachine; // The .1 machine bridging to next layer
  readonly gatewayType: GatewayType;  // "router" or "switch"
  readonly entryVariant: EntryVariant; // "ssh", "ftp", "nc", "exploit", "http", "snmp"
  readonly machines: readonly GeneratedMachine[];
  readonly isForwarded: boolean;      // NAT forwards entry ports to this layer
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

Parser: `src/network/ncStateParser.ts`. Extracts port, username, userType, homePath. Scans /var/run for nc-*.pid files and parses each.

**Player control**: `nc("-l", port)` command writes `/var/run/nc-<port>.pid` with the invoking user's identity.

**Backdoor plants**: `msfconsole` with `backdoor_port_open` effect writes the pid file on the target. For NPC-baked backdoors (elite ports with owner in generation), `buildNcBackdoorPidFiles()` generates the pid file at creation time.

### 2.3.4 Infrastructure Daemons (nginx, mysqld, redis, etc.)

**Pid files**: One per daemon binary (nginx.pid, mysqld.pid, redis.pid, dovecot.pid, etc.)
**Content format — short form** (generation): `${binary}:port=${N}` (e.g., `/usr/sbin/nginx:port=80`)
**Content format — extended form** (player-run): `${binary}:port=${N},user=U,userType=T,home=H`
**Multi-line support**: Services sharing a pid file are grouped; one line per service

**Supported services** (from `INFRA_PID_CONFIGS` in `src/generation/filesystem/infraPidFiles.ts`):
- http, https, http-alt → nginx.pid → /usr/sbin/nginx → www-data
- mysql → mysqld.pid → /usr/sbin/mysqld → mysql
- postgresql → postgres.pid → /usr/sbin/postgres → postgres
- redis → redis.pid → /usr/sbin/redis-server → redis
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
  readonly domain: string;            // "webserver.corp.local"
  readonly ip: string;                // "10.45.12.100"
  readonly type: "A";
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

**Client handles**: 45 hardcoded choices for NPC usernames (xR0gu3x, cyph3rpunk, zer0day_, etc.)

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



---

# 3. CVE & Exploit System

The CVE and exploit system is the backbone of jshack.me's gameplay treadmill. It drives procedural vulnerability discovery, time-locked patch delays, and eight distinct exploit effect types that determine what an attacker can accomplish. The system is split into two layers: hand-authored day-0 CVEs (pools/vulnerabilities.ts) and procedurally generated timeline CVEs (timeline/) that spawn throughout game time, with one new CVE approximately every 13 hours across running services.

## 3.1 The Eight Exploit Effects

Every CVE resolves to one of eight distinct effects. These are not generic "RCE" outcomes — they are specific, type-checked interactions with explicit player-facing output and gameplay consequences.

### 3.1.1 shell_full(tier)

**What triggers it**: Any service vulnerability (SSH, HTTP, databases, mail services, DNS, etc.) can land a shell_full. Rolled from each service's effect pool with probability roughly 15–30%.

**What it does**: Opens a full SSH-style interactive shell on the target machine as the specified tier (guest / user / root). The player can run commands, change directories, read/write files — all the interactive behaviors of a real SSH session. Tier determines which files are readable and which commands are executable.

**Who can use it**: Any user on the player's local workstation can trigger this exploit. The resulting shell runs as the effect's declared tier on the remote machine, not the attacker's local tier.

**Restrictions & caveats**: The player's actual view depends on the remote machine's real user list and filesystem permissions. If the effect declares tier: user but the remote machine has no non-root users, the shell falls back to a plausible username (e.g., service_user or similar). The shell is traceable — all activity lands in /var/log/auth.log on the remote machine.

### 3.1.2 shell_limited(tier)

**What triggers it**: Databases, mail services, and some other services can land shell_limited with 10–15% probability. It is the default fallback for any service without a registered effect pool.

**What it does**: Opens an NC-style restricted shell (read-only recon only). No binary execution, no file writes. The player can run pwd, cd, ls, cat, whoami, help, exit — exploration verbs only. Useful for reconnaissance but not for lateral movement or persistence.

**Who can use it**: Any user. The tier determines which paths and files are visible.

**Restrictions & caveats**: Cannot run scripts or binaries. This is the weakest shell effect — deliberately limiting to encourage lateral movement and privilege escalation rather than immediate domination.

### 3.1.3 file_read(tier)

**What triggers it**: HTTP services, databases, mail, FTP, rsync, and others. Rolled with 15–25% probability per service.

**What it does**: Dumps the contents of a single remote file to the attacker's terminal. Invoked as msfconsole <host> <port> <path>. The effect reads the file as the specified tier — if the tier has no permission, the command outputs "File not found or permission denied."

**Who can use it**: Any user triggers it; the tier determines what files are readable (e.g., a guest-tier read cannot access root-only files like /etc/shadow).

**Restrictions & caveats**: One file per exploit. For cross-player workstations, the read routes through the server's exploitRead endpoint, which regenerates the target's filesystem at the CVE-granted tier and reads from that view. For NPC machines, the read is local. The path must exist and the tier must have permission.

### 3.1.4 dir_list(tier)

**What triggers it**: HTTP services, databases, FTP, rsync, and others. Rolled with 10–20% probability.

**What it does**: Lists the contents of a single remote directory as the specified tier. Invoked as msfconsole <host> <port> <path>. Returns entry names only (no detailed stat info). If the tier has no permission, outputs "Directory not found or permission denied."

**Who can use it**: Any user triggers it; the tier determines visibility.

**Restrictions & caveats**: One directory per exploit. Cross-player reads route through the server. Works recursively — the player can probe directory structure without multiple exploits.

### 3.1.5 file_write(tier)

**What triggers it**: HTTP services, databases, FTP, rsync, and others. Rolled with 15–25% probability.

**What it does**: Uploads a local file to a remote path as the specified tier. Invoked as msfconsole <host> <port> <local:remote> (colon-separated source and destination). For example, msfconsole 10.0.0.5 80 /tmp/shell.php:/var/www/html/shell.php uploads the local shell.php to the remote web root.

**Who can use it**: Any user triggers it; the tier determines which remote paths are writable. A guest-tier write cannot overwrite root-owned files.

**Restrictions & caveats**: The destination parent directory must exist. The tier must have write permission on the destination. Writes as the specified tier, so group/world permissions are respected. This is the gateway effect for persistence (plant a backdoor script, then execute it via script_exec CVE on the same or different service).

### 3.1.6 password_reset(tier)

**What triggers it**: Databases and some mail services. Rolled with 10–15% probability.

**What it does**: Resets the password of a user at the specified tier to a new deterministic value derived from the CVE id (e.g., pwned-9042-user). The new password is output to the terminal in plaintext so the player can su or SSH with it. Invoked without a third argument (msfconsole <host> <port>).

**Who can use it**: Any user triggers it. The tier selects *which* user's password to reset (the only user of that tier on the machine).

**Restrictions & caveats**: /etc/passwd must exist and be readable as root (the read tier is hardcoded to root regardless of the effect's tier — the tier is the victim selector, not the attacker's privilege). If no user of the specified tier exists on the target, the exploit fails with "no <tier> user found." The new password is hashed as MD5 (matching /etc/passwd format) and written back to the file.

### 3.1.7 backdoor_port_open(tier, port)

**What triggers it**: Most services (mail, DNS, VNC, OpenVPN, MQTT, some databases) can land backdoor_port_open with 5–15% probability. The port is rolled from a fixed set: [31337, 4444, 1337, 12345, 8080].

**What it does**: Plants a persistent netcat listener on the specified port as the specified tier. The listener is implemented as a /var/run/nc-<port>.pid file that persists across reboots. Future nc() connections to that port land as the tier that the backdoor was planted at.

**Who can use it**: Any user triggers it. The tier controls which user the listener runs as (and thus what files are accessible via the resulting shell).

**Restrictions & caveats**: The port must not already be open (or the parent directory /var/run/ must be writable, which is always true). If multiple backdoors exist on the same machine, nc to each port lands as its own tier. Deleting the pid file (via apt remove or manual /var/run/ cleanup) closes the port.

### 3.1.8 script_exec(tier)

**What triggers it**: Databases, HTTP services, and some others. Rolled with 10–20% probability.

**What it does**: Blindly executes a JavaScript file on the remote machine as the specified tier. The script runs for side effects only — no output is captured or returned. Invoked as msfconsole <host> <port> <script_path>. The player writes /tmp/exploit.js locally, then msfconsole 10.0.0.5 3306 /tmp/exploit.js executes it on the database server as the CVE tier.

**Who can use it**: Any user triggers it. The tier determines what the script can mutate (a guest-tier script cannot write root-owned files).

**Restrictions & caveats**: The local script file must exist and be readable. Execution is sandboxed — the script cannot call system commands or reach back to localhost. Script errors are caught and reported as "Script injection failed: <error>". This is the primary lever for spreading persistence across the network (write a backdoor startup script, execute it on the target via script_exec, then nc to the planted backdoor).

## 3.2 CVE Catalog (pools/vulnerabilities.ts)

The hand-authored CVE table contains 39 VulnerabilityTemplate entries covering 22 services and ports. All have publishedAt: 0 (active from game start) and are distributed across all eight effect kinds to give day-0 players full exploit variety without waiting for the timeline.

Services covered: HTTP (ports 80, 8080, 8443): Apache, nginx, Struts, Tomcat, PulseSecure, Elasticsearch (9 CVEs); FTP (port 21): vsftpd, ProFTPD (3 CVEs); MySQL (port 3306): MySQL, MariaDB (3 CVEs); Redis (port 6379): Redis (2 CVEs); Mail (ports 25, 143, 110): Exim, Postfix, Dovecot, Courier (6 CVEs); MQTT (port 1883): Mosquitto (2 CVEs); SMB (port 445): Samba (1 CVE); PostgreSQL (port 5432): PostgreSQL (2 CVEs); MongoDB (port 27017): MongoDB (2 CVEs); rsync (port 873): rsync (2 CVEs); VNC (port 5900): TightVNC, RealVNC (2 CVEs); Modbus (port 502): ModbusTCP, Modicon M340 (2 CVEs); OpenVPN (port 1194): OpenVPN (2 CVEs); DNS (port 53): BIND (2 CVEs).

Each entry is built via mkTemplate(spec), which auto-derives the CVE description and attack pattern from the effect kind, ensuring coherence between what the log shows and what msfconsole does.

## 3.3 Layer-1 (Hand-Authored, Day-0) vs Layer-2 (Procedural, Time-Gated)

The two-layer lookup in findVulnForService reflects a deliberate design choice: Layer 1 hand-authored (checked first) contains 39 curated CVE templates with publishedAt: 0, guaranteed live from game start, never subject to patch delays, and providing day-0 exploit variety. Layer 2 procedural (fallback) is generated deterministically from VersionTemplate entries, published on a randomized timeline, subject to patchDelay, and producing infinite CVE variety.

**Priority**: Hand-authored CVEs win on exact (service, version) match. This allows designers to override treadmill timing for specific versions when needed.

## 3.4 Procedural Timeline (1 CVE / 13h)

The procedural timeline is the engine of the treadmill. Across 15 actively running services on a typical network, a new CVE publishes roughly once every 12–14 hours of game time, creating relentless upgrade pressure.

buildTimelineFromTemplate walks a service's version starting tuple forward with weighted randomness: 80% patch bumps, 15% minor bumps, 5% major bumps. Between each version, the timeline randomizes a day-gap (3–14 game days). Each version also draws a separate patch delay (1–2 days), controlling when the fix becomes available.

**Timing configuration (CVE_TIMING_CONFIG)**:
- minSafeWindowDays: 3
- maxSafeWindowDays: 14
- minPatchDelayDays: 1
- maxPatchDelayDays: 2

Invariant: maxPatchDelayDays < minSafeWindowDays, guaranteeing every fix has a positive safe window before the next CVE drops.

Cadence: With an average gap of ~8.5 days per CVE, each service produces ~43 CVEs per year. With ~15 running services, the network experiences a new CVE roughly every 12–14 hours of continuous play.

## 3.5 Service Version + CVE Resolution (findExploitableCve)

findExploitableCve(machine, port, gameTime) is the canonical exploit-resolution entry point:
1. Service CVE lookup: Calls findVulnForService (Layer 1 hand-authored, Layer 2 procedural walker)
2. Firmware CVE fallback (routers only): Calls findFirmwareCve
3. forcedEffect override: Overrides natural effect or synthesizes a stub
4. Return: Single Vulnerability | undefined

**Owner stamping** is critical: the port must have an owner field set. Ports without owners are "service-not-exploitable." Owners are assigned during network generation (60% guest, 30% user, 10% root) and indicate which tier actually owns the service.

## 3.6 Port Owner Stamping

Port.owner is a required field for successful exploitation. Owners are assigned during network generation and represent "who started this service?" A port without an owner (service crashed, port firewalled) is not exploitable, creating gameplay incentive to investigate why an exploit doesn't work.

## 3.7 msfconsole Command

**Pattern 1: Remote service exploit** - msfconsole <host> <port>
**Pattern 2: Exploit with file argument** - msfconsole <host> <port> <path>
**Pattern 3: Exploit with upload** - msfconsole <host> <port> <local:remote>
**Pattern 4: Local library exploitation** - msfconsole --local <command>

NAT resolution translates forwarded ports to internal targets. Session creation pushes shells onto the SSH/su stack. Logging records to /var/log/auth.log or /var/log/syslog.

## 3.8 Library CVE Subsystem

Eight shared libraries power all pre-installed commands: libpam, libcrypt, libsystemd, libreadline, libssl, libz, libxml2, libpcre. Each has its own procedural CVE timeline.

17 commands map to libraries via static manifest. Before execution, the dispatcher checks all linked .so files exist under /lib/. Missing library — glibc-style dynamic-linker error, command refuses to start.

**Local exploitation**: msfconsole --local <command> resolves library CVE, rolls effect from command's own pool. Library carries vulnerability; command carries semantics. One libpcre CVE via ls lands dir_list; via grep lands file_read; via rm lands file_write.

**Defense**: apt remove libpam deletes /lib/libpam.so, making su/ssh unusable. apt upgrade libpam patches the version.

**Meta-packages**: auth-libs (libpam+libcrypt), crypto-libs (libssl), system-libs (libsystemd+libreadline), data-libs (libz+libxml2+libpcre). apt upgrade auth-libs expands to both libraries.

## 3.9 Router Firmware

Each router has a firmwareVendor (Cisco, MikroTik, DD-WRT, OpenWRT, pfSense, EdgeOS) with its own procedural CVE timeline. findFirmwareCve walks firmware timeline; findExploitableCve tries service CVE first, then firmware CVE for routers. apt upgrade firmware patches router's firmware package entry in /var/lib/dpkg/status.

## 3.10 apt Mechanics

**apt list**: List all packages with install status.
**apt list -u**: Show packages with pending updates (vulnerable versions).
**apt install <package>**: Install package or suite. Fails if not root, WiFi required on localhost, or package not installable.
**apt install <package>=<version>**: Pin to specific version (upgrade or downgrade).
**apt upgrade**: Upgrade all packages to latest safe versions.
**apt upgrade <package>**: Upgrade single package or meta-package.
**apt remove <package>**: Delete package and all binaries/files. For libraries, makes dependent commands unusable.

## 3.11 Defense Treadmill

When a CVE publishes at gameTime T, from T to T+1-2 days CVE is live and no fix exists. From T+patchDelay onward, fix is available. Defenders can use iptables, systemctl, permissions, or version pinning during the window.

## 3.12 hydra (Batched Cracking)

hydra supports ssh, ftp, mysql, redis, snmp services. Syntax: hydra -l <username> -P <wordlist> <service> <target> [port]. Generates single aggregate log entry per sweep and one forged success line per cracked credential. Cross-player workstations dispatch to server's crackCredentialsBatch endpoint with batch size scaled from wordlist size.

## 3.13 exploitRead (Cross-Player Read)

When file_read or dir_list effects target a cross-player workstation, the read routes through the server's /api/exploitRead endpoint to regenerate the target's base filesystem and run the permission walker at the CVE-granted tier.

## 3.14 Wordlists & Wordlist Progression (Deferred)

**Current state**: Wordlists are static. **Future**: Wordlist progression — when a player cracks a credential, the plaintext password is appended to their local wordlist, creating compounding discovery mechanics.

---

**Summary**: The CVE and exploit system drives jshack.me's core gameplay loop. Hand-authored day-0 CVEs provide immediate variety; procedural timelines create relentless patch pressure; eight distinct effects force strategy adaptation; patch-delay window creates defense window encouraging creative thinking.


---

# 4. Multiplayer Foundation

This section captures the server-authoritative multiplayer machinery that every other surface (filesystem, network, missions, CVEs) sits on top of. The rewrite MUST stand this layer up first; everything else assumes it works.

The model is **zero-trust client, ship-first**: clients are untrusted (Burp/ZAP/curl are part of the threat model), the security boundary is `Vercel function + Supabase RLS + shared permission walker`, and we explicitly accept a small set of forge-bypass gaps until an L3 "smart server" lands post-launch. Reads, writes, sessions, and Realtime broadcasts all route through signed Ed25519 envelopes verified server-side.

## 4.1 Identity (Ed25519 + computeWorkstationId)

The player is identified by a **32-byte Ed25519 keypair** generated on first launch and persisted in `localStorage` under the key `jshack.identity`:

```ts
type Identity = {
  readonly privateKey: Uint8Array; // 32 bytes — never leaves the device
  readonly publicKey: Uint8Array; // 32 bytes — the player's identifier
  readonly publicKeyHex: string; // 64-char lowercase hex
};
```

Library: `@noble/ed25519` v3 (sync API). SHA-512 is wired explicitly at module load (`ed.hashes.sha512 = sha512` from `@noble/hashes`). Sign/verify are pure synchronous functions; signing is deterministic per Ed25519 spec — same `(key, message)` always produces the same signature, no nonce randomness needed at sign time.

`getIdentity()` is the lazy singleton entry point: reads or generates on first call, caches for the page lifetime. `loadIdentity` is defensive — any malformed storage (missing fields, bad hex, wrong length) returns `null` rather than throwing, so `getOrCreateIdentity` falls back to `generateIdentity` instead of crashing on boot. Silent reset on corruption is intentional and documented in `project_multiplayer_identity_wallet_keys`.

### computeWorkstationId — the canonical machine_id for a player's own box

Under the eliminated-localhost model, the player's own workstation is stored everywhere (patches.machine_id, sessions.machine_id, Realtime channels, occupant.hostname) as:

```
workstation_id = `${workstationName}-${first-8-hex(sha256('ed25519:' + playerKeyHex))}`
```

The eight-hex suffix is the **identity-derived disambiguator**. Two players who choose the same workstation name (`skylab`) get different storage keys because their suffixes differ. The `'localhost'` literal is gone from storage but preserved as a CLI loopback alias.

### The `'ed25519:'` prefix is LOAD-BEARING

`deriveHostnameSuffix` computes `sha256(utf8('ed25519:' + playerKeyHex)).hex().slice(0, 8)`. Calling it with the raw `playerKeyHex` (no prefix) produces a divergent suffix and silently breaks every cross-player auth/L1/L2/lookup path. This bug surfaced as `su` returning 401 even with the right password (PR 2 in the cross-player base-FS chunk).

**Rule for the rewrite**: the only callable helper is `computeWorkstationId(workstationName, playerKeyHex)`. The `'ed25519:'` prefix is applied inside the helper. Callers MUST NOT compose the input themselves. The single source of truth lives in `src/homeNetworks/homeNetworkHelpers.ts` and is shared by:

- the client (prompt, /etc/hostname, machine_id storage)
- `regenWorkstationRows` (server-side base-FS regen)
- handler.ts `isOwnWorkstationOnServer` and the read-path filter's `isOwnWorkstation`
- every smoke script that needs to predict a machine_id

`parseWorkstationId(id)` is the inverse — returns `{ name, suffix }` or `undefined` if the input doesn't have workstation_id shape. Pattern: `/^(.+)-([0-9a-f]{8})$/`. The "last 8 hex" rule handles names with internal hyphens (e.g. `skylab-prime` → name `skylab-prime`, suffix `deadbeef`). Used by `getBaseFs` / `exploitRead` / `crackCredentials` to dispatch on machine type — non-workstation IDs return `400 unsupported_machine_type`.

### Identity reset

No in-game UI. Clear `localStorage` manually (devtools / new browser profile) to abandon identity. Deliberate friction — identity reset wipes reputation, darknet listings, messages.

### CLI surface

`identity` command prints `Identity: ed25519:<64 hex>\nFingerprint: <first 16 hex>`. Fingerprint is a UI convenience for cross-player recognition.

## 4.2 Wallet key (separate from identity)

The **wallet key** is a separate Ed25519 keypair that lives in the player's in-game virtual filesystem (a file under their home directory). Unlike the identity, the wallet key:

- Can be **stolen** by another player who cracks the box and exfiltrates the file.
- Is **lost on permadeath** (game restart wipes the FS).
- Has no fixed location — generators may place it differently per seed.

Identity defends "this is who I am" (cryptographic). Wallet defends "this is what I own" (gameplay). The wallet-defense premise depends on `/etc/passwd` and root-owned files NOT being readable by no-session callers (see §4.10 — without that, anyone with a signed envelope could pull the wallet hash without ever cracking the box).

## 4.3 Signed request envelope

Every authenticated POST to `/api/*` uses the same three-field envelope:

```ts
type SignedEnvelope = {
  readonly payload: string;     // JSON-stringified action object — the SIGNED BYTES
  readonly publicKey: string;   // 64-char hex Ed25519 pubkey
  readonly signature: string;   // 128-char hex Ed25519 signature over UTF-8 bytes of payload
};
```

### Key rule: sign the literal string, not a re-canonicalized object

The signed bytes are the **literal `payload` string the client produced**. The server never re-canonicalizes — it verifies the bytes as transmitted and parses them after. Eliminates the entire "different libraries serialize objects differently" bug class (key order, whitespace, number formatting, unicode normalization).

JSON-string-inside-JSON is ugly in logs but stays human-readable. Beats base64 for debugging the inevitable signature failures.

### Replay protection

Every payload includes:

- `ts`: client wall-clock at signing (`Date.now()`). Rejected if `|now - ts| > REPLAY_WINDOW_MS` (120s). Bidirectional rejection guards against future-timestamp attacks and absorbs ±60s clock skew.
- `nonce`: 16 random bytes (128 bits, hex-encoded, regex `/^[0-9a-f]{32}$/i`). Server records each nonce in Upstash Redis with a 120s TTL via atomic `SET NX EX`; duplicates rejected. Combined: an attacker can't replay an envelope after the window (ts rejection) or within it (nonce rejection).

Both are necessary. ts alone allows in-window replay; nonce alone needs unbounded storage.

### Server-side verification order (verify.ts)

Cheapest-checks-first to avoid hitting Upstash on garbage:

1. **Envelope structural shape** — regex + zod (sub-µs).
2. **Ed25519 signature verify** — ~50µs CPU.
3. **`JSON.parse`** the payload bytes.
4. **Base schema** (action / ts / nonce) + caller-provided action schema.
5. **Timestamp window** check.
6. **Nonce dedupe** — single Upstash round-trip, only if all above passed.

Returns `{ ok: true, publicKey, payload }` on success, or `{ ok: false, reason }`:

| Reason              | HTTP | Meaning                                            |
| ------------------- | ---- | -------------------------------------------------- |
| `envelope_invalid`  | 400  | Wrapper shape wrong (missing fields, bad hex)      |
| `signature_invalid` | 401  | Ed verify returned false / malformed point         |
| `payload_malformed` | 400  | Signed bytes weren't valid JSON                    |
| `payload_invalid`   | 400  | JSON parsed but rejected by schema                 |
| `timestamp_skew`    | 401  | `ts` outside the 120s window                       |
| `replay`            | 401  | Nonce already seen within the window               |

Auth-class problems get 401; structural problems get 400.

### Client-side flow (sign.ts)

```ts
const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
fetch('/api/allocate-ip', { method: 'POST', body: JSON.stringify(envelope) });
```

`signRequest` injects `action`, `ts`, `nonce` itself — caller-supplied versions of those fields are stripped, so a misbehaving caller can't backdoor a stale timestamp or pre-known nonce.

### Constants

- `REPLAY_WINDOW_MS = 120_000` (120 seconds)
- `NONCE_HEX_LENGTH = 32` (16 random bytes)
- payload max length: 8192 chars
- publicKey: 64 hex chars; signature: 128 hex chars

### Nonce store abstraction

`NonceStore` is an interface over "atomic set-if-not-exists with TTL":

- `createUpstashNonceStore(setFn)` — wraps `redis.set(key, value, { ex: 120, nx: true })`. Returns `{ fresh: true }` on first write, `{ fresh: false }` on duplicate.
- `noopNonceStore` — always reports fresh. Used in local dev when Upstash env vars aren't set. Replay protection is effectively disabled in this mode (acceptable for dev).

A single `Redis` client is shared across the rate limiter (`prefix: 'allocate-ip'` / `'sessions'` / `'patches'` / `'register-workstation'` / `'join-home-network'` / `'lookup-home-network'`) and the nonce store (`prefix: 'nonce:*'`).

## 4.4 Database schema (Supabase Postgres)

All multiplayer state lives in seven tables. The **universal RLS posture** across every table: anon + authenticated denied by default; only `service_role` (used inside Vercel functions) reads/writes. The handful of `SELECT FOR anon` policies on `public_ips`, `home_networks`, `home_network_occupants`, `world_networks` exist because those rows are publicly discoverable in-game (nmap, WiFi scan) — there's no secrecy at the registry layer.

### 4.4.1 `public_ips`

Global unique registry of every allocated public IP across all network kinds. PRIMARY KEY on `ip` is the collision-prevention mechanism — concurrent allocations re-roll on PK conflict.

```sql
CREATE TABLE public_ips (
  ip             TEXT        PRIMARY KEY,
  kind           TEXT        NOT NULL CHECK (kind IN (
                              'mission_instance', 'home_network', 'pivot',
                              'npc_faction', 'darknet_hub', 'world_network'
                             )),
  owner_key      TEXT,
  instance_ref   TEXT,
  allocated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX public_ips_owner_key_idx ON public_ips (owner_key) WHERE owner_key IS NOT NULL;
CREATE INDEX public_ips_kind_idx ON public_ips (kind);
```

RLS: SELECT open to anon (IPs are public by nature — players nmap them); INSERT/UPDATE/DELETE no policies (service_role only).

### 4.4.2 `sessions`

Server-authoritative session registry. Each row = a player's presence on a machine with credentials. The L1 patch-validation gate consults this table on every mutating write.

```sql
CREATE TABLE sessions (
  session_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key        TEXT        NOT NULL,                   -- hex Ed25519 pubkey
  machine_id        TEXT        NOT NULL,                   -- target machine IP / workstation_id
  credentials       JSONB       NOT NULL,                   -- { username, userType }
  parent_session_id UUID        REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_ip         TEXT,                                   -- denormalized parent.machine_id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT,
  kind              TEXT        NOT NULL DEFAULT 'ssh'      -- session kind, see §4.6
);

CREATE INDEX sessions_active_by_player_idx ON sessions (player_key) WHERE ended_at IS NULL;
CREATE INDEX sessions_parent_idx           ON sessions (parent_session_id) WHERE parent_session_id IS NOT NULL;
```

RLS: ALL operations denied to anon + authenticated. service_role only.

`parent_session_id` forms a tree per the hop chain. `source_ip` denormalizes `parent.machine_id` so log-realism reads it directly without walking the chain. Cascade-end on parent end is **application-level recursion**, not FK action — we want UPDATE (ended_at + end_reason), not DELETE.

### 4.4.3 `patches`

Per-player journal of every FS mutation. Composite PK doubles as natural UPSERT key.

```sql
CREATE TABLE patches (
  player_key  TEXT        NOT NULL,
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  content     TEXT,                                       -- null = base-fs deletion marker
  owner       TEXT        NOT NULL,                       -- 'root' | 'user' | 'guest'
  permissions JSONB,                                      -- { read, write, execute }
  is_new      BOOLEAN     NOT NULL DEFAULT false,
  node_type   TEXT        NOT NULL DEFAULT 'file',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);
```

RLS: ALL denied to anon + authenticated. service_role only.

The PK prefix scan serves `WHERE player_key = me` queries. Cross-player reads (`listPatchesForMachines`) hit the `machine_id` predicate.

### 4.4.4 `home_networks` + `home_network_occupants`

Cracked-WiFi LAN catalog. Two players who crack the same WiFi join the same LAN with separate occupant rows.

```sql
CREATE TABLE home_networks (
  public_ip       TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  essid_template  TEXT        NOT NULL,
  density_tier    TEXT        NOT NULL CHECK (density_tier IN ('crowded','shared','solo')),
  max_slots       INT         NOT NULL CHECK (max_slots > 0),
  seed            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX home_networks_template_tier_idx ON home_networks (essid_template, density_tier, created_at);

CREATE TABLE home_network_occupants (
  network_id    TEXT        NOT NULL REFERENCES home_networks(public_ip) ON DELETE CASCADE,
  player_key    TEXT        NOT NULL,
  lan_ip        TEXT        NOT NULL,
  hostname      TEXT        NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
);
CREATE INDEX home_network_occupants_player_idx ON home_network_occupants (player_key);
```

RLS: SELECT open to anon (schema is public game state — knowing a LAN exists doesn't leak occupancy beyond what in-LAN nmap reveals). INSERT/UPDATE/DELETE no policies — service_role only.

`(network_id, player_key)` PK enforces "one slot per player per LAN" for idempotent joins. `UNIQUE (network_id, lan_ip)` and `UNIQUE (network_id, hostname)` prevent slot collisions.

### 4.4.5 `world_networks`

Shared persistent themed networks (playground, findit.io, techparts.io, future: office, police, university, café). Ships content via SQL migration, not the API.

```sql
CREATE TABLE world_networks (
  public_ip   TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  seed        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  theme       TEXT        NOT NULL DEFAULT 'playground',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX world_networks_theme_idx ON world_networks (theme);
```

RLS: SELECT open to anon (world content is universally visible). INSERT/UPDATE/DELETE no policies — content curation via service_role + migrations.

Seed row: playground at `203.0.113.42` (TEST-NET-3 IETF docs range). Themed rows added via additional migrations (search-metadata, findit, techparts).

### 4.4.6 `workstations`

One row per player. Drives the L2 own-workstation base-FS backfill — without this, an intruder with a cracked session on Player A's workstation could forge envelopes that bypass L2 (no rows in `machine_filesystems` for A's machine_id → leaf-only fallback permits everything).

```sql
CREATE TABLE workstations (
  player_key       TEXT        PRIMARY KEY,
  workstation_name TEXT        NOT NULL,
  username         TEXT        NOT NULL,
  seed             TEXT        NOT NULL,                  -- added later for /etc/passwd hash regen
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS: ALL denied to anon + authenticated. service_role only.

Idempotency: `INSERT ... ON CONFLICT (player_key) DO NOTHING` + read-back select. Same `(workstation_name, username)` → 200; mismatch → 409 (silent overwrite would change workstation_id and orphan every dependent `machine_filesystems` row).

Stored fields are intentionally minimal — only what's needed to regenerate the workstation FS deterministically server-side. `rootPassword` is **not** persisted; `/etc/passwd` hash is dual-written into `machine_filesystems.content` at registration time and lives there.

### 4.4.7 `machine_filesystems`

Server-side projection of current FS state. Used by L2 to walk permissions. Per-machine (not per-player) — last-write-wins is a property of the projection, not the journal.

```sql
CREATE TABLE machine_filesystems (
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  owner       TEXT        NOT NULL,
  permissions JSONB       NOT NULL,
  content     TEXT,                                       -- nullable; populated only for paths in FS_PROJECTED_CONTENT_PATHS
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path)
);
CREATE INDEX machine_filesystems_path_prefix_idx ON machine_filesystems (machine_id, path text_pattern_ops);
```

RLS: ALL denied to anon + authenticated. service_role only.

`text_pattern_ops` supports `LIKE 'prefix%'` index scans even under non-C UTF-8 collations (cascade-delete path needs prefix-range queries). `content` is selectively populated — see §4.16.

### Dual-write SQL functions

Two plpgsql functions wrap patch + projection writes in a single Postgres transaction. The Vercel function (`api/patches.ts`) issues exactly one RPC and the database guarantees atomicity:

- `upsert_patch_with_fs(p_player_key, p_machine_id, p_path, p_content, p_owner, p_permissions, p_is_new, p_node_type, p_dual_write, p_project_fs_content) RETURNS VOID` — writes the `patches` row; if `p_dual_write AND p_permissions IS NOT NULL`, also writes the `machine_filesystems` row (`content` filled when `p_project_fs_content` is true, NULL otherwise).
- `remove_patches_with_fs(p_player_key, p_machine_id, p_path, p_path_prefix, p_dual_write) RETURNS TABLE (deleted_path TEXT)` — deletes from `patches` (exact + descendants via LIKE 'prefix%') and, if `p_dual_write`, cascades to `machine_filesystems`.

Execution is locked down: `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role`. Anon + authenticated cannot bypass RLS via the function.

## 4.5 Server endpoints (`api/`)

Every endpoint is a Vercel function following the same shape: `method guard → env var lookup → Supabase + Upstash client construction → handleXRequest(req.body, deps)`. The handler is **pure** and unit-tested separately; the file in `api/` is glue only.

Common middleware: `verifySignedRequest` (envelope + signature + replay), then `rateLimiter` (per-pubkey sliding window via `@upstash/ratelimit`), then dispatch on `payload.action`. Distinct rate-limit prefixes per endpoint (`allocate-ip`, `sessions`, `patches`, `register-workstation`, `join-home-network`, `lookup-home-network`) keep budgets independent.

### 4.5.1 `/api/register-workstation`

Once-per-game endpoint. Records `(player_key, workstation_name, username, seed)` in `workstations` and populates `machine_filesystems` with the workstation's base FS via `regenWorkstationRows` (calls `generateLocalhost` deterministically, then `bulkInsertMachineFs` with `ON CONFLICT DO NOTHING`).

- 201 `inserted: true` on fresh insert.
- 200 `inserted: false` on idempotent repeat (same name + username).
- 409 `already_registered` on mismatch (different workstation_name for same player_key).
- 401 `signature_invalid` on tampered signature.

Rate limit: 5/min per pubkey. Populate is best-effort — failure logs but doesn't fail the request; `scripts/backfillWorkstationBaseFs.ts` catches misses idempotently.

### 4.5.2 `/api/allocate-ip`

Mints a new public IP under one of six `kind` values (mission_instance / home_network / pivot / npc_faction / darknet_hub / world_network). PK conflict on `public_ips(ip)` triggers re-roll. Fresh PRNG per allocation (seeded with `randomUUID()`) so allocations are non-deterministic across requests on the same process.

Rate limit: 30/min per pubkey.

### 4.5.3 `/api/join-home-network`

Idempotent: existing occupant row for `(essid_template, density_tier, player_key)` short-circuits and returns the existing slot. Otherwise:

1. Find a network with free slots for the (template, tier).
2. If none, allocate a new public_ip via `allocateIp({kind:'home_network'})` and INSERT a new `home_networks` row.
3. On new-network insert, fire `populateBaseFsBestEffort` — `regenHomeNetworkRows({seed, publicIp})` + bulk insert with `ON CONFLICT DO NOTHING`.
4. Pick a LAN IP via `pickRandomLanIp` excluding (a) NPC octets (deterministic from `getReservedLanOctets`) and (b) existing occupant octets on this LAN.
5. INSERT `home_network_occupants` row.
6. Broadcast occupant change via Realtime REST API.

Rate limit: 30/min per pubkey.

### 4.5.4 `/api/lookup-home-network`

Read endpoint for the cross-LAN seed-regen resolver. Fetches a foreign `home_networks` row by `public_ip`. RLS keeps anon SELECT off the table directly; this signed-envelope endpoint is the read boundary.

Rate limit: 120/min per pubkey.

### 4.5.5 `/api/sessions`

Single endpoint, action-dispatched. Four actions, all sharing the verify+rate-limit prelude:

- **`createSession`** — for kinds with envelope-trusted tier (`exploit`, `effect_one_shot`, `nc` legacy path). Server-stamps `player_key`. Performs **server-side userType validation** against `/etc/passwd` projection: if `findEtcPasswdContent` returns content and the username appears, `deriveUserTypeFromEtcPasswd` must match the claimed `userType` (else 400 `usertype_mismatch`). No-op cases (no projection / no matching user) **permit the claim** — kinds reaching this validation use synthetic placeholders (`'msf'`, shell-effect names, pidfile sentinels) by design. Auth-required kinds (ssh/scp/su/ftp/mysql/redis/snmp) sent here return 403 `use_authcreatesession`.
- **`authCreateSession`** — server-authoritative auth + session creation for auth-required kinds. Each kind reads its credential file from `machine_filesystems.content` and validates:
  - `ssh`/`scp`/`su` → `/etc/passwd` (password or savedKey fingerprint = `md5(username:targetIp:hash)`)
  - `ftp` → `/etc/vsftpd/virtual_users.conf` overlay; `/etc/passwd` fallback; userType always from `/etc/passwd`; password-only (savedKey rejected)
  - `mysql` → `/var/lib/mysql/data.json` (multi-user JSON; userType from the entry)
  - `redis` → `/etc/redis/redis.conf` requirepass (shared secret; sentinel `username:'redis'`, `userType:'root'`); no requirepass directive = open access
  - `snmp` → `/etc/snmp/snmpd.conf` rwcommunity (shared secret; sentinel `username:'snmp'`, `userType:'root'`)
  - `nc` → `/var/run/nc-<port>.pid` (method:`'pidfile'` only; credentials parsed from `nc:port=X,user=Y,userType=Z,home=W`; server-derived, never trusted from envelope)
  - All failure modes collapse to **401 `invalid_credentials`** (no info leak about machine state or username existence).
- **`endSession`** — UPDATE filter `player_key + ended_at IS NULL`. Cascade-ends all active descendants with `end_reason='cascade'` via app-level recursion. Three failure cases (not exists / not yours / already ended) collapse to **404 `session_not_found`**.
- **`listSessions`** — caller's active sessions only, ordered `created_at ASC`. Returns `SessionSummary[]` including `kind` for client-side rehydration filtering.

Rate limit: 60/min per pubkey. Insert with explicit `kind` (required since the migration — no server default).

### 4.5.6 `/api/patches`

Single endpoint, action-dispatched. Seven actions:

- **`upsertPatch`** — L1 + L2 gate (§4.8, §4.9), then RPC `upsert_patch_with_fs`. Realtime hint broadcast on success.
- **`removePatch`** — L1 + L2 gate, then RPC `remove_patches_with_fs`. Realtime hint broadcast.
- **`listPatchesForMachines`** — cross-player read; runs the three-tier read filter (§4.10).
- **`clearOwnedPatches`** — DELETE `WHERE player_key=me AND machine_id=$workstation_id`. Both filters load-bearing.
- **`getBaseFs`** — cross-player workstation FS replication (§4.11).
- **`exploitRead`** — single-path file_read / dir_list CVE effect (§4.12).
- **`crackCredentials`** — batched hydra (§4.13).

Rate limit: 120/min per pubkey.

## 4.6 Session model (kinds, userType validation contract)

A session row = `(player_key, machine_id, credentials{username, userType}, kind)` + parent/source-IP hop-chain + lifecycle timestamps.

### Ten kinds, three categories

**Shell-class** (go on the SessionContext snapshot stack; rehydration filters to these for linear-chain reconstruction):
- `ssh` — SSH login
- `su` — user switch on same machine (parent_session_id = previous session; same machine_id)
- `exploit` — post-exploit shell (`shell_full` CVE effect)

**Protocol** (live in dedicated client-side state; pushed/ended on login/logout):
- `ftp`, `mysql`, `redis`, `nc`

**Transient one-shot** (pushed via `withTransientSession` for a single patch fire, then ended):
- `scp`, `snmp`, `effect_one_shot`

The L1 patch-validation gate doesn't care which kind — it only asks "does any active session row exist for `(player_key, machine_id)`?". `kind` matters at rehydration (SessionContext filters to `('ssh','su','exploit')` before reconstructing the linear chain — protocol sessions don't go on the stack).

### Server-side userType validation contract

`createSession` reads `/etc/passwd` content from `machine_filesystems` (the projected-content overlay; `/etc/passwd` is in `FS_PROJECTED_CONTENT_PATHS`). If the file is projected AND the claimed username has a matching entry, the server derives the canonical userType and rejects mismatches with **400 `usertype_mismatch`**.

### Relaxed `usertype_underivable` rule (2026-05-11)

Earlier defense-in-depth rejected ANY claim where userType couldn't be derived. This broke legitimate cross-player CVE flows — the kinds that REACH `createSession` (`effect_one_shot`, `exploit`, `nc` legacy) use synthetic placeholder usernames (`'msf'`, shell-effect names, pidfile sentinels) that don't appear in `/etc/passwd` by design.

**Current rule**: only actual mismatches reject. No-projection / no-matching-entry cases **permit the envelope-trusted tier**. Sabotage-via-garble (attacker who CVE'd `/etc/passwd` into mush) is still enforced — but via `authCreateSession`, which IS the path real player logins take. Garble breaks login; it doesn't (and shouldn't) break CVE effects, which bypass auth by definition.

Auth-required kinds (ssh/scp/su/ftp/mysql/redis/snmp) cannot reach `createSession` at all — they're blocked at the dispatch gate with **403 `use_authcreatesession`**.

### Hop chain semantics

- SSH from localhost to A: `A.parent = null` (localhost implicit, never tracked).
- SSH from A to B: `B.parent = A.session_id`.
- `su` on A from alice to root: new row with `parent = A.session_id`, same `machine_id`, different `credentials`.
- `source_ip` denormalizes parent's `machine_id` so access-log realism reads it directly without walking.

### Server-stamped `player_key`

Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field (400 `payload_invalid`).

## 4.7 Patch model

A patch row encodes a single FS mutation in the canonical journal:

```ts
type PatchRow = {
  readonly player_key: string;      // server-stamped
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;  // null = base-fs deletion marker
  readonly owner: 'root' | 'user' | 'guest';
  readonly permissions?: FilePermissions;
  readonly is_new?: boolean;        // true = file/dir created via patch
  readonly node_type?: 'file' | 'directory';
};
```

### Client API surface

```ts
upsertPatch(identity, patch: FileSystemPatch) → Promise<void>
removePatch(identity, { machineId, path }) → Promise<void>
listPatchesForMachines(identity, machine_ids: string[]) → Promise<FileSystemPatch[]>
clearOwnedPatches(identity, workstation_id) → Promise<void>
getBaseFs(identity, machine_id) → Promise<{baseFs: FileNode|null}>
exploitRead(identity, { machine_id, path, kind }) → Promise<{content|entries}>
crackCredentials(identity, { machine_id, service, candidate_hashes, user_filter? })
  → Promise<{hits: {username, matched_hash}[], attempts: number}>
```

Wrappers handle camelCase ↔ snake_case translation defensively — callers only see `FileSystemPatch`.

### Two-call deletion

`broadcastAndRecordPatch` decides per case:

| Case                              | Server calls                                       |
| --------------------------------- | -------------------------------------------------- |
| Write/create (`content !== null`) | `upsertPatch`                                      |
| Delete isNew file                 | `removePatch`                                      |
| Delete base-fs file               | `removePatch` THEN `upsertPatch` (null marker)     |

### Last-write-wins ordering

`listPatchesForMachines` orders `updated_at ASC`. Client-side `applyPatches` reduces in array order, so the latest write per `(machine_id, path)` wins automatically.

### Reset semantics: `clearOwnedPatches`, not `clearAllPatches`

`reset confirm` wipes `WHERE player_key = me AND workstation_id = me`. Does NOT wipe the player's mutations on OTHER players' machines — those are gameplay actions in the shared world. Concrete scenario: A roots B's box and `rm`s a file. A resets → A's local game starts over, but B's view of the deleted file stays deleted.

### Defensive content sanitization

Postgres TEXT columns reject NUL bytes (`U+0000`, error 22P05). Mock binary contents (e.g. `/usr/bin/nmap`'s `'\x7fELF\0\0\0...'` placeholder) carry them. `sanitizeContent` replaces with `U+FFFD` REPLACEMENT CHARACTER before the upsert adapter. Done at the handler (not the client wrapper) as defense-in-depth — any signed envelope, including hand-crafted ones, gets cleaned.

## 4.8 L1 validation + ambient log allowlist

Every mutating action on a remote machine MUST be backed by an active session row for this player on that machine. The player's own workstation is exempt (`isOwnWorkstationOnServer` short-circuit — suffix match against `deriveHostnameSuffix('ed25519:' + playerKey)`).

```
verify → rate-limit → if (not own workstation AND not ambient log path):
                        findActiveSession(player_key, machine_id)
                          - DB error           → 500 session_lookup_failed
                          - no row             → 403 no_session
                          - active row exists  → proceed to L2
                      ... existing action logic
```

### Ambient log path allowlist (AMBIENT_LOG_FILES)

Recon actions (nmap, curl, hydra, gobuster, ssh-failure logging) leave trail logs on the target machine without the actor having a session there. L1 was designed for "I logged in, I'm mutating" mutations; ambient log writes are a different class — the network records the probe as a side effect; cross-player visibility on those logs gives defenders agency.

Hard-coded allowlist (exhaustive — every entry has a real writer in the codebase):

| File                  | Writers                                |
| --------------------- | -------------------------------------- |
| `/var/log/auth.log`   | ssh, scp, su, hydra-ssh                |
| `/var/log/access.log` | curl, gobuster, HTTP CVEs              |
| `/var/log/kern.log`   | nmap                                   |
| `/var/log/vsftpd.log` | ftp, hydra-ftp, FTP CVEs               |
| `/var/log/mysql.log`  | mysql, hydra-mysql, MySQL CVEs         |
| `/var/log/redis.log`  | redis, hydra-redis, Redis CVEs         |
| `/var/log/mail.log`   | mail CVEs                              |
| `/var/log/syslog`     | nc, hydra-telnet, generic CVE fallback |

**Allowlist (not `/var/log/` prefix)** so a forged envelope can't plant arbitrary files anywhere under `/var/log/` on a machine the actor doesn't own (e.g. `/var/log/payload.sh`, `/var/log/.ssh/config`). Adding a new logger means adding an entry — bypass is intentionally append-only and code-controlled.

**Bypass applies ONLY to `upsertPatch`**. `removePatch` on an allowlisted log path still requires a session — covering tracks needs real access. Predicate runs on the verified `payload.path`; client cannot spoof.

## 4.9 L2 validation (shared walker, machine_filesystems projection, Pattern A)

After L1 (or ambient log / own-workstation bypass), L2 confirms the active session's credentials have permission for the requested mutation on the target path.

```
fetchSessionCredentials(player_key, machine_id)
  → Credentials | own-workstation bypass | 500
  → if no bypass:
      findMachineFs(machine_id, path)
        → row     → canWrite({userType, target: row.permissions, parentChain: []})
                      → deny  → 403 permission_denied
                      → allow → proceed to dual-write RPC
        → no row  → permit (leaf-only fallback)
        → error   → 500 fs_lookup_failed
```

### Shared walker

`canWrite` / `canRead` live in `src/filesystem/permissionWalker.ts` — a single **pure module that the client also imports**. Both sides agree on allow/deny by construction. The walker takes `{ userType, target: FilePermissions, parentChain: FilePermissions[] }` and returns `{ allowed: boolean, reason?: string }`. Today's L2 write wiring is leaf-only (empty parentChain); the read filter (§4.10) uses the full ancestor chain.

### Pattern A: eager denormalization

Every successful patch dual-writes to `machine_filesystems` in the same Postgres transaction via the RPC. Base FS for shared networks is bulk-populated at provision time:

| Network               | Coverage today                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| Workstation (own-box) | Bypassed for owner writes; full for non-owner access via `register-workstation` populate + backfill |
| Home network LANs     | Full — populated at create time (Step 7 in `join-home-network`) + idempotent backfill |
| World networks        | Full — populated via `scripts/backfillWorldNetworkBaseFs.ts` (re-run after each new themed-network migration) |
| Mission machines      | Leaf-only — blocked on `mission_instances` (decided 2026-04-23)                      |

"Leaf-only" means only paths that have ever been patched have rows in `machine_filesystems`. L2 enforces forever on those; permissive on truly-untouched paths. As soon as anyone touches a path once, L2 takes over for it.

### Why dual-write through SQL functions

Atomicity. The plpgsql functions wrap both writes in one transaction so a `patches` row never exists without its `machine_filesystems` projection (when applicable). A two-call JS approach would either need an explicit transaction (Supabase JS doesn't expose one cleanly) or risk skew on partial failure.

### Multi-player overlap caveat

`machine_filesystems` is shared per machine; `patches` is per-player. If two players hold patches at the same path and one deletes, the projection row goes away even though the other player's patch still exists. L2 falls back to "absence → permit" (under-permissions until the remaining player's next write re-projects). Acceptable for v1 — a future reconcile step (recompute `machine_filesystems` from surviving patches) closes the gap.

## 4.10 Read-path privacy filter (3 tiers)

`listPatchesForMachines` runs a **per-row filter** before returning. Without this, anyone who can sign a request and name a discoverable machine_id could pull `/root/*`, wallet keys, and `/etc/passwd` hashes — breaking the wallet-defense gameplay premise.

For each row in the SQL result:

1. **Owner of the workstation** (suffix-match on requester's `player_key`) → keep. Workstation-only — never fires for other players' workstations or non-workstation machines.
2. **Has active session on the machine** → walker `canRead` with the **full ancestor chain** (`ancestorPaths(path).map(fsLookup)`). Drop if denied. Leaf-only fallback (`target === null → permit`) keeps parity with L2 writes.
3. **No session** → keep only if path matches `READ_ALLOWLIST` glob patterns; default-deny otherwise.

```ts
export const READ_ALLOWLIST: readonly string[] = [
  '/var/run/*.pid',
  '/etc/iptables/rules.v4',
  '/etc/snmp/snmpd.conf',
  '/etc/switch/acl.conf',
  '/var/www/**',
  '/var/lib/dpkg/status',
];
```

The patterns describe files **observable from outside the box** via simulated network protocols (port banners, HTTP, nmap -sV, firewall probing). Leaking them through the patch stream mirrors what an off-box observer can already gather; excluding them would make the simulation inconsistent for no-session callers.

Files NOT on this list (`/etc/passwd`, `/root/*`, `/home/<user>/*`, wallet keys, shell history, `/var/log/*`) drop through default-deny. `/etc/passwd` specifically excluded — passwords live inline in `/etc/passwd` in this game; letting no-session callers fetch the hash list would enable offline cracking without ever establishing presence on the box.

### Performance

Two extra round-trips (`findMachineFsBatch` + `findActiveSessionsBatch`) run in **parallel** after the SQL select. Single SQL call each. Distinct 500 error codes (`session_lookup_failed` / `fs_lookup_failed`) so callers can tell what broke.

### Universality

The filter applies uniformly to every machine type (workstations, home-net, world-net, mission). Only tier 1 is workstation-specific (the suffix match).

## 4.11 Cross-player base FS replication (`getBaseFs`)

When player A establishes a session on player B's workstation, A's client fires `getBaseFs(B's workstation_id)` once and the server returns the tier-walked base FS. Subsequent patches are layered via `listPatchesForMachines`.

```
parseWorkstationId(machine_id) → 400 unsupported_machine_type if not workstation shape
findWorkstationsByName(parsed.name) → 404 workstation_not_found if no matching row
                                       (matching row's computeWorkstationId must equal payload.machine_id)

regen = generateLocalhost({seed: row.seed, workstationName, username,
                          rootPassword: GET_BASE_FS_SENTINEL_ROOT_PASSWORD}, machine_id)

collectProjectedPathsFromTree(regen) → list of paths in FS_PROJECTED_CONTENT_PATHS
findFsContentBatch(machine_id, projectedPaths) → Map<path, content>  (real /etc/passwd hash etc.)
overlaid = overlayProjectedContent(regen, contentMap)

tier dispatch:
  Owner (suffix-match)              → return baseFs: overlaid (unfiltered)
  Has active session                 → walker-filter via filterFileNodeForRead at user_type → return baseFs: filtered
  No session                         → return baseFs: null (defense in depth)
```

### Why a placeholder rootPassword

The real `rootPassword` isn't persisted server-side (decision #2 in the L2 plan — minimal storage). `generateLocalhost` needs *some* string to hash for `/etc/passwd`'s placeholder; the sentinel value's md5 is `md5('GET_BASE_FS_SENTINEL')` which is useless for cracking. The **overlay** step then replaces `/etc/passwd` content with what's actually stored in `machine_filesystems.content` — so the FS A receives matches the FS the server's auth path validates against.

### Non-workstation routing

NPC home / world / mission machines aren't routed here. A regenerates them identically from seed locally (the seed is in `home_networks.seed` / `world_networks.seed`, fetched via `/api/lookup-home-network` for cross-LAN). Workstations are the only machine type that needs server-side regen because the player's identity-derived `workstation_id` doesn't appear in any catalog the foreign LAN can read.

## 4.12 `exploitRead` endpoint

Cross-player single-path read for `file_read` and `dir_list` CVE effects. msfconsole's wiring wraps the call in `withTransientSession(kind='effect_one_shot')` at the CVE-granted tier, then signs the envelope.

```
parseWorkstationId → 400 if not workstation shape
findWorkstationsByName + match → 404 if missing
regen + overlay (same as getBaseFs)

tier dispatch:
  Owner suffix match → effectiveUserType = 'root'
  Else: findActiveSession → 403 no_session if absent (FORGE GUARD)
        effectiveUserType = sessionRow.credentials.userType

listPatchesForMachines (cross-player) → applyPatches onto overlaid tree
                                        (so post-NEW-GAME files like /root/secret.txt are visible)

resolveNodeAndParentChain(merged, path)
  if kind === 'file_read':
    if !node || node.type !== 'file' → return { content: null }
    canRead({userType, target, parentChain}) → if denied: { content: null }
    else: { content: node.content ?? '' }
  if kind === 'dir_list':
    if !node || node.type !== 'directory' → return { entries: null }
    canRead → if denied: { entries: null }
    else: { entries: Object.keys(children).sort() }
```

### Tier source: the session row's `user_type`

The tier comes from the **active `effect_one_shot` session row's `user_type`** (minted by `withTransientSession` on the client at the CVE-granted userType). NEVER read from the wire envelope — the schema explicitly rejects a `tier` field. This makes the trust source identical to `writeRemoteFile + upsertPatch`, which already establishes that an attacker can mint any tier via `createSession`. That's the documented L3 gap (§4.17).

## 4.13 `crackCredentials` endpoint (batched hydra)

Pre-auth batched brute-force for SSH/FTP. Caller sends md5(plaintext) candidate hashes for a wordlist batch (1..200 entries); server reads B's projected credential files and returns matching `{username, matched_hash}` pairs.

```
parseWorkstationId → 400 if not workstation shape
findWorkstationsByName + match → 404 if missing

paths = service === 'ftp' ? ['/etc/passwd', '/etc/vsftpd/virtual_users.conf'] : ['/etc/passwd']
findFsContentBatch(machine_id, paths) → contentByPath

build userHashes from /etc/passwd (lines split on ':', username:hash pairs)
if service === 'ftp' and virtual_users.conf has content:
  parseVirtualUsersConf(vu) overlays vu.passwordHash onto userHashes  (overlay precedence)

apply optional user_filter (drop everyone except named user)

candidateSet = lowercase(payload.candidate_hashes)
for (username, hash) of effectiveUsers:
  if candidateSet.has(hash.toLowerCase()) → hits.push({username, matched_hash: hash})

attempts = effectiveUsers.size * candidate_hashes.length
return { hits, attempts }
```

### Trust model — pre-auth by design

No session check. Hydra is the **PRE-auth tool**. Raw stored hashes never cross the wire — candidate md5s are values an attacker could compute themselves from any wordlist, so server-side hash matching leaks no more than offline brute-force already does. Natural per-batch RTT paces STATUS lines; `SERVER_MAX_HYDRA_BATCH_SIZE = 200` caps per-request work.

### Why skip regen + applyPatches (unlike `exploitRead`)

Credential paths are in `FS_PROJECTED_CONTENT_PATHS`, so every patch that mutates them dual-writes the new content to `machine_filesystems.content` (`upsert_patch_with_fs` honors `p_project_fs_content`). `findFsContentBatch` therefore returns the post-patch state directly. `password_reset` rolls land here naturally because the patch's content arrives via the same dual-write path.

### Validation rejections

zod rejects (400 `payload_invalid`): oversized batch (>200), empty `candidate_hashes`, non-hex hash, unsupported service. Unsupported `machine_id` → 400 `unsupported_machine_type`. Missing workstation row → 404 `workstation_not_found`.

## 4.14 Realtime channels (hint-only broadcasts)

After every successful `upsertPatch` / `removePatch`, the handler fires a **fire-and-forget** broadcast to a per-machine channel:

```
verify → rate-limit → mutate → if ok:
  broadcast(`patches:${machine_id}`, 'patch_change', { machine_id, originator_key })
```

Server-to-Realtime path: `api/patches.ts` POSTs directly to `${SUPABASE_URL}/realtime/v1/api/broadcast` with the `service_role` key. Direct fetch beats opening a WebSocket per Vercel function invocation — these functions are short-lived. The REST endpoint is one-shot, idiomatic for server-side publish.

### Hint, not payload

The payload is `{ machine_id, originator_key }` — **not the full patch**. Subscribers (`subscribeToMachine` in `realtime.ts`, wired into `FileSystemContext`):

1. **Skip the hint** if `originator_key === own_pubkey` (local optimistic apply + BroadcastChannel cross-tab fan-out already covered same-identity writes).
2. **Otherwise**, accumulate `machine_id` into a debounced (~150ms) refetch set.
3. **On debounce flush**, fire `listPatchesForMachines([...affectedMachineIds])` against the signed endpoint and splice the authoritative result into local `patches` state. Pending in-flight local writes (tracked in a `Map<key, FileSystemPatch>`) are replayed on top so a cross-player refetch doesn't clobber what the user just typed.

Result: cross-player writes appear within ~300-500ms (debounce + round-trip), with zero risk of forged content corrupting local state.

### Trust model — closed by hint architecture

The Realtime broadcast channel is anon-publishable from the browser bundle (the anon key ships in the bundle by design), so any client can call `channel.send()`. Under the prior full-payload design, a malicious player could forge a `patch_change` event with fake content; the local view diverged from server truth until the next page reload.

Hint-only defangs this architecturally:

- There's no content / path / owner in the broadcast — **nothing to inject**.
- Forged hints just trigger a refetch via the signed endpoint, which returns server truth.
- Spamming forged hints with `originator_key = victim_pubkey` makes the victim skip ONE refetch per forgery; authentic hints from real writers (different `originator_key`) still trigger refetches. Net effect: harmless DoS-style noise, no data corruption.

The earlier attempt to close the vector via Supabase Realtime authorization rules (`private: true` channels + RLS on `realtime.messages`) was reverted — the new `sb_publishable_*` key format and unspecified `setAuth()` requirements made the configuration brittle. See `project_realtime_publish_authorization` for the post-mortem.

### Client subscription wrapper

`subscribeToMachine(supabase, machine_id, onHint)` returns an `unsubscribe` cleanup function. Must be called on component unmount / view-keyset change — channels leak across React Strict Mode's double-effect cycle and across mid-session network transitions. Wire-shape (snake_case) → client-shape (camelCase) translation lives in `realtime.ts`.

Lazy singleton anon-key Supabase client (`getRealtimeClient`): reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from build-time env. Returns `null` if either missing — `FileSystemContext` degrades to no live updates rather than crashing.

## 4.15 BroadcastChannel cross-tab sync

`BroadcastChannel('jshack.patches')` fans patch writes across all open tabs of the same browser (same identity). Pairs with Realtime for cross-device — same identity in two tabs of the same browser gets the BroadcastChannel path (cheaper); same identity across browsers / devices gets the Realtime path.

Same `applyExternalPatch` handler is shared by both paths.

### Decision: keep both for now

After Realtime ships, BroadcastChannel cross-tab sync is technically redundant. Decision 2026-04-30: keep both, share `applyExternalPatch`. Revisit deletion post-launch when Realtime reliability is measured. See `project_broadcast_channel_vs_realtime`.

## 4.16 Selective FS content projection (`FS_PROJECTED_CONTENT_PATHS`)

`machine_filesystems.content` is selectively populated for a TS-allowlisted set of paths:

```ts
export const FS_PROJECTED_CONTENT_PATHS: readonly string[] = [
  '/etc/passwd',
  '/etc/vsftpd/virtual_users.conf',
  '/var/lib/mysql/data.json',
  '/etc/redis/redis.conf',
  '/etc/snmp/snmpd.conf',
  '/var/run/*.pid',
];

export const shouldProjectFsContent = (path: string): boolean =>
  matchesAnyGlobPattern(path, FS_PROJECTED_CONTENT_PATHS);
```

### Why these paths and not others

The bulk of patched files (logs, configs, scripts) keeps `content = NULL` in `machine_filesystems` — the `patches` table is the canonical content store, per-player. The original storage concern that motivated the column drop (20260503210309) is preserved for everything else.

These specific paths are projected because **the server needs to read them server-side** to make auth decisions on cross-player flows:

- `/etc/passwd` — `createSession` userType validation; `authCreateSession` ssh/scp/su; `crackCredentials`.
- `/etc/vsftpd/virtual_users.conf` — `authCreateSession` ftp overlay; `crackCredentials` ftp.
- `/var/lib/mysql/data.json` — `authCreateSession` mysql.
- `/etc/redis/redis.conf` — `authCreateSession` redis.
- `/etc/snmp/snmpd.conf` — `authCreateSession` snmp; also in `READ_ALLOWLIST` (snmpwalk sessionless read).
- `/var/run/*.pid` — `authCreateSession` nc pidfile auth; also in `READ_ALLOWLIST` (port-scan visibility).

### Adding a new path

A one-line change here. The dual-write SQL function (`upsert_patch_with_fs`) checks `p_project_fs_content` on every call and stores content only when the path matches this allowlist. Adding a new entry → re-run the relevant backfill script (`backfillHomeNetworkBaseFs.ts`, `backfillWorldNetworkBaseFs.ts`, `backfillWorkstationBaseFs.ts`) for existing rows.

### Projected paths force own-workstation dualWrite

Normal rule: own-workstation patches skip the `machine_filesystems` dual-write (player owns their own box; L2 not applicable for self-writes). **Exception**: paths in `FS_PROJECTED_CONTENT_PATHS` MUST dual-write even on own-workstation, because cross-player auth flows (nc-pidfile, SSH/FTP login from another player) read those paths server-side. Skipping projection for self-writes leaves the row absent → server returns 401 `invalid_credentials` when another player tries to nc / ssh / ftp in.

Handler logic in `upsertPatch`:

```ts
const isOwn = isOwnWorkstationOnServer(machine_id, publicKey);
const dualWrite = !isOwn || shouldProjectFsContent(path);
```

Same exception applies to `removePatch` — own-workstation removes of `/etc/passwd`, `/var/run/*.pid`, etc. must dual-delete or the cross-player projection lingers stale.

## 4.17 Known forge bypasses (accepted L3 gap)

The threat model accepts that any client with a valid Ed25519 keypair can forge envelopes the in-game UI would never send. Per `project_multiplayer_security_model` and `project_multiplayer_ship_first`, real mitigation is L3 game-logic re-run server-side — explicitly deferred until post-launch.

### `exploitRead` forge bypass

Any client can:

1. Sign `createSession` with `kind: 'effect_one_shot'`, claiming arbitrary `userType` (e.g. `'root'`) and a synthetic placeholder username not in `/etc/passwd` (so userType validation no-ops).
2. Get back a `session_id` at the forged tier.
3. Call `exploitRead` directly with `machine_id = victim's workstation_id`, `path = '/root/wallet.key'`, `kind = 'file_read'`.
4. Server walks at the forged-tier `userType`, reads the file, returns the content.

The entire in-game CVE flow is skipped. The active session row exists (server-stamped from the envelope), so the L1 `no_session` guard doesn't fire; the userType in the row is what the attacker claimed.

### `password_reset` inherits the same gap

`password_reset` reads `/etc/passwd` at root tier regardless of the CVE's declared tier (hardcoded — see `project_password_reset_read_tier`). Mint a root-tier `effect_one_shot` session → call `exploitRead` for `/etc/passwd` → `upsertPatch` new content. No CVE port required.

### Why we ship anyway

L3 game-logic re-run is multi-month work (replicate CVE eligibility, port resolution, NAT chain, gameTime publication check, wallet ownership, etc. server-side). Indie multiplayer dies of scope creep faster than security holes. The accepted threat model is: scripted forge bypasses exist, real defenses (gameTime / wallet / hop-chain validation) ship layer by layer post-launch. See `project_multiplayer_ship_first`.

## 4.18 Threat model & layered defense (L1, L2, L3 boundary)

| Layer       | What it checks                                                                                                                    | Status                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| L0 (transport) | Ed25519 signature + replay window + nonce dedupe                                                                              | Shipped                                                                                                          |
| L1          | Active session exists on `machine_id` for `player_key`                                                                            | Shipped (PR #78)                                                                                                 |
| L2 (writes) | Session credentials have write permission on target path (walker against `machine_filesystems`)                                   | Shipped — full on home + world + own-workstations; leaf-only on missions                                         |
| L2 (reads)  | Three-tier read filter on `listPatchesForMachines`: owner / session+walker / no-session+allowlist. Universal across machine types | Shipped                                                                                                          |
| L2 (auth)   | Server-authoritative auth + userType derivation in `authCreateSession`; userType validation against `/etc/passwd` in `createSession` | Shipped (PR #122 + relaxation 2026-05-11)                                                                     |
| L3 (game-logic) | Re-run CVE eligibility, port resolution, gameTime publication, wallet ownership, hop-chain validity server-side                | Post-launch — accepted scoped gaps documented (§4.17)                                                            |

### Boundary

The security boundary is **`Vercel function + Supabase RLS + shared permission walker on stored perms`**, NOT the client. Burp / ZAP / curl / hex-edited browser bundle are all the same threat. Smoke tests (§4.19) explicitly forge envelopes to verify this.

### What's closed by L1 + L2 today (on covered networks)

- Cross-player escalation: a guest with a legit session on machine X cannot overwrite root-owned files on X.
- Within-session escalation on patched paths: once a path is touched once, L2 enforces forever.
- Burp/ZAP/custom-client bypass on writes — RLS-backed boundary.
- No-session read of /etc/passwd hashes — three-tier filter drops them (wallet-defense premise restored).
- Forged Realtime broadcasts — hint-only architecture defangs.
- userType promotion via createSession lie — server validates against /etc/passwd projection.
- ssh/scp/su forge — auth-required kinds blocked from createSession; must go through authCreateSession which validates credentials.

### What's still open (deferred to L3)

- `exploitRead` / `password_reset` forge (mint effect_one_shot session at arbitrary tier).
- Mission machine untouched-path attacks (need server-side `mission_instances` + base-FS backfill).
- CVE eligibility re-run (was the CVE leading to this session published-by-now? did the target port match? was the attacker's gameTime advanced enough?).
- Wallet-ownership validation (server doesn't yet refuse to transfer to a non-existent wallet, etc.).
- Hop-chain realism (source_ip is currently denormalized from parent; not yet validated against the parent's session machine).

## 4.19 Smoke test catalog (`scripts/test*.ts`, `scripts/verify*.ts`)

Wire-payload smoke scripts that forge signed envelopes against a real `vercel:dev` server. Each verifies an integration seam unit tests can't cover (signed envelope → handler → SQL → wire response). All self-cleaning, idempotent — re-runnable.

| Script                            | Purpose                                                                                          | Scenarios |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| `testL2Bypass.ts`                 | Forge `upsertPatch` against a generic machine. Proves L2 fires on cross-player attempts.         | 3 (no_session 403 / guest permission_denied 403 / root 200) |
| `testL2BypassWorkstation.ts`      | Same as above, scoped to a freshly-registered workstation. Closes the own-workstation chunk.     | 3         |
| `testReadPathPrivacy.ts`          | Forge `listPatchesForMachines`. Three-tier filter on wire payload.                               | 3 (no-session / guest-session / owner) |
| `testGetBaseFs.ts`                | Cross-player base-FS replication endpoint.                                                       | 7 (owner full / no_session null / guest filter / user with /etc/passwd overlay / root full / 400 unsupported / 404 missing) |
| `testExploitRead.ts`              | Cross-player file_read / dir_list CVE-effect endpoint.                                            | 11 (owner content+entries / no_session 403 / tier-walked file_read+dir_list at guest/user/root / projected /etc/passwd / missing path null / file-as-directory null / 400 unsupported / 404 missing) |
| `testCrackCredentials.ts`         | Batched hydra endpoint.                                                                          | 12 (ssh hit/miss / user_filter / ftp overlay precedence / /etc/passwd fallback / 400 unsupported / 404 missing / oversized / empty / non-hex / unsupported service / pre-auth no-session hit) |
| `testCreateSessionUserType.ts`    | Server-side userType validation in createSession.                                                 | 4 (usertype_mismatch 400 / synthetic placeholder 200 / legitimate match 200 / mission stand-in no-op 200) |
| `testRegisterWorkstation.ts`      | End-to-end `/api/register-workstation`.                                                          | 8 (fresh 201 / idempotent 200 / conflicting 409 / tampered signature 401 / missing seed 400 + DB-side row + machine_filesystems count + /etc/passwd presence) |
| `testAmbientLogAllowlist.ts`      | L1 ambient-log-path allowlist on `upsertPatch`.                                                   | 14 (8 allowlisted log files → 200 bypass / 6 non-allowlisted /var/log/ paths → 403 no_session) |
| `testLookupHomeNetwork.ts`        | `/api/lookup-home-network` for cross-LAN seed-regen resolver.                                     | Coverage of public_ip lookups |
| `testServerAuth.ts`               | `authCreateSession` arms (ssh/scp/su/ftp/mysql/redis/snmp/nc).                                    | Per-kind credential matrix |
| `verifyDualWrite.ts`              | L2 dual-write SQL functions (upsert/remove with own-workstation bypass).                          | DB-direct verification of dual_write flag + project_fs_content + own-bypass |
| `verifyMachineFilesystemsRls.ts`  | RLS posture on `machine_filesystems` table.                                                      | 5 probes (anon INSERT 42501, anon SELECT empty, service_role INSERT ok, service_role SELECT ok, anon still empty post-write) |
| `verifyWorkstationsRls.ts`        | RLS posture on `workstations` table (same shape).                                                | 5 probes |

### Prerequisites for smoke runs

- Local Supabase up (`npm run supabase:start; npm run db:reset`).
- Relevant backfill ran (`scripts/backfillWorldNetworkBaseFs.ts` after every new themed-network migration; `scripts/backfillHomeNetworkBaseFs.ts` for home rows; `scripts/backfillWorkstationBaseFs.ts` for workstations).
- `vercel:dev` running (`npm run vercel:dev`) — `/api/*` endpoints are Vercel functions; `npm run dev` alone won't expose them.
- `.env.development.local` pointing at the dev Supabase project + Upstash (or noop adapters will trigger via missing env vars).

### Why smoke matters more than unit tests for this layer

Past Phase 4 effects shipped with green unit tests but multiple latent bugs that surfaced only in Phase 5 wire-payload testing. The rule (per `feedback_e2e_test_new_primitives`): unit tests prove layers in isolation; integration seams (effect → session → patch → L1 → DB) drift silently. Watch the network tab. Smoke first; then declare a chunk shipped.


---

# 5. Shared World & Cross-Player

The Solid.js rewrite will inherit the full cross-player multiplayer model without significant structural change — home networks, world networks, themed networks, and foreign-network seeding all operate above the filesystem/UI layers that Solid replaces. This section documents the invariants, patterns, and data structures that must port faithfully.

## 5.1 Public IP universe

Every network is anchored by a unique `public_ip` in the `public_ips` table, with a `kind` discriminant:

- `mission_instance` — player current mission instance, allocated on mission start, deallocated on mission end
- `home_network` — shared LAN occupant by multiple players (cracked WiFi), allocated on first join, persists for game
- `world_network` — themed persistent world content (playground, findit.io, techparts.io), seeded in migrations
- `pivot`, `npc_faction`, `darknet_hub` — reserved for future expansion (currently out of scope)

The allocator (`src/ipRegistry/allocate.ts`) rolls random IPs via a seeded PRNG until finding one not in the table; reserved ranges (`203.0.113.0/24`, `192.0.2.0/24`, `198.51.100.0/24`) guarantee no real-world collision. The rewrite generation pipeline stays the same.

## 5.2 Home networks (Model B tiered hybrid)

Home networks model cracked-WiFi LANs as shared persistent infrastructure [[project_multiplayer_home_network_model]]. When two players connect to the same ESSID, the server allocates each a unique LAN slot on the same /24 subnet.

### 5.2.1 Join flow

1. Player runs `nmcli connect ESSID PASSWORD` (WiFi password from aircrack)
2. Browser signs and POSTs to `/api/join-home-network` with workstation identity
3. Server handler verifies Ed25519 signature, schema, 10-minute replay window, rate-limits per pubkey (30 req/min)
4. Idempotency check: queries `home_network_occupants` for existing (network_id, player_key) row, returns if found
5. Find-or-create network: searches `home_networks` for (essid_template, density_tier) with free slots, reuses oldest first
6. Allocates new IP if needed: rolls via `allocateIp`, inserts into `public_ips` (kind=home_network)
7. L2 backfill: regenerates base filesystem from seed, bulk-inserts into `machine_filesystems` (best-effort)
8. Slot allocation: random LAN IP in .10-.250 range, excluding reserved NPC octets and occupied octets
9. Inserts `home_network_occupants` row, publishes hint on `occupants:NETWORK_ID` Realtime channel
10. Browser receives response, `HomeNetworksProvider` generates HomeNetwork, subscribes to occupant updates

Idempotency invariant: endpoint safe to call multiple times. Rejoining same WiFi after refresh reads existing row, returns same slot, no new IP allocated.

### 5.2.2 Slot allocation & density tiers

Allocation is random within .10-.250, independent of density tier — tier only controls max_slots:
- `solo` — 1 slot
- `shared` — 3 slots  
- `crowded` — 8 slots

Random flat distribution reveals nothing about occupancy or order.

### 5.2.3 Network generation from seed

Every occupant sees same topology because all call `generateHomeNetwork` with same seed (home-PUBLIC_IP). Generator runs deterministically:
- Difficulty: easy (1 layer, 2 machines) / medium (2 layers, 5-7) / hard (3 layers, 8-11)
- Entry variant: ssh, ftp, nc, exploit, http, snmp (randomly per layer)
- Port closures: approx 30% SSH, approx 30% FTP (independent rolls)
- Filesystem: mission-quality with leaked credentials, web artefacts, config files

All occupants materialize same machines with same machine_ids, so cross-player patches:<machine_id> Realtime subscriptions automatically synchronize writes.

### 5.2.4 Hostname suffix & identity-derived addressing

Every player's hostname is: workstationName-XXXXXXXX (8 hex chars of SHA256(ed25519:pubkey))

The suffix is:
- Stable per identity (same player, same suffix on every LAN)
- Always applied (no occupancy signal leakage)
- 8 hex = 32 bits (65k-player birthday-collision threshold)
- Storage key (patches.machine_id, sessions.machine_id, Realtime channel name)

Computed once at game start and threaded through SessionProvider, BootScreen, generateLocalhost.

### 5.2.5 WiFi strength & pool generation

WiFi networks seeded per game (`generateWifiNetworks`):
- 2-3 crackable: WPA2, strong signal (-35 to -65 dBm), tagged with WifiTier (solo/shared/crowded)
- 3-5 noise: WPA3 / weak signal / hidden ESSID with clear diagnostics

## 5.3 World networks (table + dispatch)

`world_networks` rows represent persistent shared networks visible to every player. Schema:

```sql
world_networks (
  public_ip TEXT PRIMARY KEY REFERENCES public_ips(ip),
  seed TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  theme TEXT NOT NULL DEFAULT playground,
  public_domain TEXT,
  search_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

Browser flow: listWorldNetworks → generateWorldNetworks (theme-specific generator) → every player generates same machine_ids from same seed → writes stream via patches:<machine_id> Realtime → useWorldNetworks exposes handlers to NetworkProvider/FileSystemProvider.

## 5.4 Themed networks

Runtime layer mapping `world_networks.theme` to dynamic behavior (request handlers) or static content. Request handlers are pure functions observing curl requests, returning HandlerResponse or null (fall through).

### 5.4.1 Registry pattern

- `handlerRegistry.ts` maps theme string to RequestHandler
- `generators/registry.ts` maps theme to generator function
- `CurlContext.getHandler(filesystemIp)` resolves handler at request time

Pure-function contract: no closures over DB state, read-only fs, return null to fall through, return HandlerResponse to own request, no custom headers.

### 5.4.2 findit.io (search engine)

Single-machine world network at 192.0.2.80 with theme=search-engine

Handler: GET /?q=QUERY only; reads /etc/findit/index.json (snapshotted from peer rows); scores entries (keywords weight 3, title 2, description 1); returns top 10 as HTML.

Generator: router is only machine; ports 80+443; /var/www/html/index.html landing page; /etc/findit/index.json from peer rows; snapshotted at boot.

### 5.4.3 techparts.io (hand-authored CVE)

Single-machine at 198.51.100.80 with theme=techparts

Content: hand-authored manifest (HTML/text), well-formed semantic, no scripts/styles/class/id, all hrefs resolve.

Generator: no handler, every URL falls through; ports 80 (Apache/2.4.49 with shell_full:user CVE) + 443 (nginx); time-gated CVE exploitable 3-14 days in.

Authorization: one player exploits, write lands in shared machine_filesystems, other players see on next curl.

### 5.4.4 playground (smoke surface)

Single world network at 203.0.113.42. Guaranteed to exist, same machines/IPs across all players.

### 5.4.5 Adding a new themed network

1. Author content in `src/themedNetworks/content/THEME/` (TS module, kind discriminator)
2. Write generator in `src/themedNetworks/generators/THEME.ts`, register in registry
3. If dynamic: write handler in `src/themedNetworks/handlers/THEME.ts`, register in handlerRegistry
4. Add migration: INSERT into public_ips + world_networks
5. Test: `npm run db:reset` → `npm run dev`

## 5.5 Occupants (home_network_occupants)

```sql
home_network_occupants (
  network_id TEXT NOT NULL REFERENCES home_networks(public_ip),
  player_key TEXT NOT NULL,
  lan_ip TEXT NOT NULL,
  hostname TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
)
```

PK = idempotency key. UNIQUE constraints: (network_id, lan_ip) prevents reuse; (network_id, hostname) catches 50% birthday collision around 65k players.

Occupant row projection: `listOccupants` deliberately omits player_key (server-side only). Exposing pubkeys to LAN peers lets observers link identity across LANs. Clients filter by hostname instead.

## 5.6 isOnLayer0 predicate

Determines visible machines when SSH'd into gateway — occupants visible only on same broadcast domain.

Returns true: router public IP, router .1 alias, any NPC on layer-0 subnet, inner gateway layer-0-facing IP.

Returns false: inner-layer IPs.

Critical for gameplay: players can nmap each other on home LAN, but deep-layer machines don't leak to border-router occupants.

## 5.7 Cross-LAN routing (seed-regen approach)

When player accesses foreign IP, browser performs client-side seed-regen [[project_cross_lan_seed_regen_approach]]:

1. Curl/gobuster/nmap on foreign IP triggers `useForeignNetworks.ensureForeignReachable(ip)`
2. Validate public IPv4 (reject RFC1918, loopback, CGNAT)
3. Short-circuit if own active home public IP
4. POST signed envelope to `/api/lookup-home-network`
5. Server verifies signature/nonce, returns home_networks row or 404
6. Browser regenerates foreign HomeNetwork from seed
7. Fetch listOccupants (lazy subscription)
8. Merge foreign fileSystems into FileSystemProvider
9. Merge foreign occupants into targetMachineIdFor resolver

Seed-regen invariant: no persistent server state — network materialized entirely from seed. Reload to refetch.

Uniform across access vectors: same trigger for ssh, curl, nmap, gobuster, hydra, exploit, scp.

## 5.8 Foreign LAN occupant resolution

Once foreign network materialized, occupants visible via same IP→machine_id translation as home LAN.

`buildForeignLanOccupantMap` composes foreign networks+occupants into Map<foreign_lan_ip, ForeignLanOccupantEntry>.

Translation applied at same precedence as own-LAN in `targetMachineIdFor`: gateway-alias canonicalization → own-LAN occupants → foreign-LAN occupants → passthrough.

Wiring: `buildResolveTargetMachineId` threads foreign networks+occupants; write paths (logFs) and read paths use same translation so writers/readers agree.

## 5.9 React closure-capture pattern (ref-wrap recipe)

Commands created during render capture resolver state in closure. When async pre-resolve materializes foreign network, OLD closure has OLD resolver with empty iptables/fileSystems. Fix: ref-wrapping [[project_react_closure_capture_pattern]].

Applied to: resolveTargetMachineIdRef, resolveNatRef, readFileFromMachineRef, getNodeFromMachineRef, createFileOnMachineRef.

Ref object stable across renders; .current always points to LATEST resolver. OLD command closure captured ref (not OLD resolver); when exec runs async AFTER foreign network materializes, .current yields NEW state.

flushSync requirement: When `awaitCrossPlayerBaseFs` populates base filesystem rows, it updates FileSystemContext state. If OLD closure calls `createFileOnMachine` before flushSync, mutation checks OLD parentNode state and fails. Solution: `flushSync(setFileSystems)` inside async pre-resolve.

## 5.10 Cross-player write paths (double-resolution rule)

When Player A writes to Player B workstation (SSH, scp, command), write must resolve to same canonical machine_id at session creation AND inner write time [[project_cross_player_write_path_canonical_id]].

Pattern: FIRST RESOLUTION for session creation → SECOND RESOLUTION for inner write. If different, session rejected.

Defense-in-depth: `resolveTargetMachineId` deterministic once foreign networks materialized. If regen happens between calls (race), write fails loudly (session mismatch) rather than silently landing on wrong machine.

## 5.11 Workstation visibility

Own-LAN visibility (PR #118, 2026-05-05): Occupants visible via lanOccupants array (fetched listOccupants, subscribed Realtime hints). Render as RemoteMachine: IP=subnet+lan_ip, hostname=prefix-suffix, ports closed, no visible users.

Foreign-LAN visibility: Once foreign networks materialize, occupants visible same way. Foreign IP→workstation_id identical to own-LAN.

Workstations remain sealed: players can't enumerate user accounts until they crack root. Threat model [[project_realtime_publish_authorization]]: exposing user lists enables precomputed dictionary attacks.

## 5.12 Per-network public-key scoping & Realtime subscription

Patches scoped to machine_id, published on patches:<machine_id>. For home-network occupants, machine_id is workstation's hostname (identity-derived), so patches from any player converge.

Realtime subscription: subscribe to patches:<machine_id> on load, server publishes hints {checksum, originator_key} on INSERT, ignore hints where originator_key===ownPlayerKey, hints trigger listPatchesForMachines SELECT, cross-player writes converge within ~100-500ms.

Occupant hints: separate channel occupants:<network_id>, payload {network_id, originator_key} only, self-skip, 150ms debounce (rapid hints coalesce into one fetch).

Foreign network subscription (lazy): first curl/ssh/nmap on foreign IP triggers ensureForeignReachable → listOccupants → subscription to foreign occupants Realtime channels → writes stream live → unsubscribe on reload.

## 5.13 Player-hosted websites (apache2/nginx)

Players run own daemons via `apache2 [port]` / `nginx [port]` (root-only for privileged ports).

Generator: `buildInfrastructurePidFiles(ports)` groups daemon ports by binary, emits one multi-line pid file (nginx 80+443 ships one nginx.pid with two lines).

Port state: PID file PRESENCE opens port, ABSENCE closes (canonical source). Player-run writes pid file at start. `systemctl stop SERVICE` deletes it.

Daemon control: apache2/nginx apt-installable in /usr/bin/, require root, write pid; sshd/vsftpd pre-installed in /usr/sbin/; nc -l writes /var/run/nc-PORT.pid with user/tier metadata.

Cross-player NAT forwarding: player who roots home router edits /etc/iptables/rules.v4 to forward public IP to workstation port. Wiring: buildMergedRouterView applies applyDynamicOverrides to occupants, occupant pid files merge into router port state, forward rules resolve NPC+occupant machines, NPC wins on collision.

Sibling-parser: parses Apache /var/run/apache2.pid and extracts owner metadata. Same for nginx, nc, vsftpd.

Pending: mutable router NAT, findit.io registration.

## 5.14 Machine access vector catalog (6 categories)

Every access flow categorized [[project_machine_access_vector_catalog]]:

1. Auth-driven: SSH, FTP, MySQL, Redis (credential login, role-level)
2. CVE-session: msfconsole on vulnerable service (transient session)
3. Backdoor-connect: nc to pre-existing backdoor (reverse shell)
4. CVE-no-session: library/binary vulnerabilities (command-level effect)
5. Hydra: brute-force auth (credential discovery)
6. Read-only: world-readable files, SNMP public, HTTP GET (passive recon)

Rewrite inherits all six. No UI layer changes.

## 5.15 NAT / firewall routing across LANs

Own-LAN NAT: parses /etc/iptables/rules.v4, maps public IP+port → internal IP+port, applied at SSH/FTP/NC boundaries, dynamic changes take effect on next scan.

LAN-side vs WAN-side: real iptables NAT fires only on WAN, forwarded ports invisible from inside. `applyDynamicOverrides` detects LAN-side by comparing visible IP to canonical resolution — when different (gateway .1 alias), NAT-merge skipped.

Foreign router forwarding: out of scope, planned separate piece.

---

## Key invariants for Solid rewrite

1. Seed-based determinism: all topologies regenerated from seed, no persistent state beyond world_networks rows, reload to regenerate.

2. Occupant rows ephemeral: players rejoin, get new slot, old rows age out, state consistent because always re-fetched+filtered.

3. Machine_id canonical: workstation's hostname IS storage key, IP must translate to hostname, cross-LAN writes must double-resolve.

4. Realtime subscription lifecycle: reload unsubscribes foreign channels, reconnect triggers new load+resubscription, Solid effects need same lifecycle.

5. Same resolution path: targetMachineIdFor single source of truth, both logFs.writeFileToMachine and occupantAwareReadNode use it.

---

# 6. Filesystem, Users, Generation

This section documents jshack.me's virtual filesystem architecture, user authentication system, seeded procedural content generation, and anti-cheat encoding mechanisms. The filesystem is deterministic and permission-aware; users are typed (root/user/guest) with mapped command privileges; generation produces identical networks from identical seeds via Mulberry32 PRNG; and sensitive content is encoded at build time to prevent bundle inspection.

## 6.1 Virtual Filesystem Types (Node Shape)

Every file and directory in a virtual machine is a FileNode — an immutable tree structure with name, type, owner, permissions, optional content, and optional children.

```typescript
type FileNode = {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly owner: UserType;  // 'root' | 'user' | 'guest'
  readonly permissions: FilePermissions;
  readonly content?: string;  // file content only
  readonly children?: Readonly<Record<string, FileNode>>;  // subdirectories
};

type FilePermissions = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};
```

**FilePermissions** represent Unix-style access control per user type. The execute permission on a directory enables traversal (directory descent in path resolution). Every node carries its owner and three permission lists — root always bypasses all checks.

**Factory-managed directories** (/root, /home, /etc, /var, /tmp, /boot, /bin, /usr/bin, /usr/sbin, /lib) are created by createFileSystem(config) from a MachineFileSystemConfig. Extra directories (e.g., /srv, /opt) can be merged via the extraDirectories field using mergeFileNodeChildren(), which recursively combines directory children to avoid clobbering sibling paths.

**Guest-owned files** have read/write/execute permissions for all user types (['root', 'user', 'guest']). User-owned files default to ['root', 'user']. Root-owned files default to ['root'] only. Scripts created by mkScript() are world-readable and world-writable (if user-owned) or root-writable-only (if root-owned), allowing players to execute them without escalation — critical for mission objectives.

## 6.2 Permission Model & Tier Walker

The permission system maps user types to command tiers. oot grants all access; user grants most access (home, most binaries, most networking); guest grants limited access (home, read-only in many places, no privilege escalation).

**Permission Walker** (src/filesystem/permissionWalker.ts) is a pure shared module imported by both client and server for identical allow/deny decisions:

```typescript
checkPermission({
  userType: 'user',
  mode: 'read',  // 'read' | 'write' | 'execute'
  target: permissions,  // target node's permissions
  parentChain: [root_perms, home_perms, ...immediate_parent_perms]
}) → { allowed: true } | { allowed: false, error: 'Permission denied' }
```

Logic:
1. If userType === 'root', allow unconditionally.
2. For each parent in the chain (root-to-immediate-parent), check that the user has execute permission. Parent execution failure blocks traversal regardless of target.
3. Check that the user appears in the target's mode-specific list.

Three mode-locked wrappers (canRead, canWrite, canExecute) are provided for call-site clarity. The walker is deterministic — same inputs always produce identical results, enabling client-side patch filtering to agree with server-side L2 enforcement.

**Default permissions for new files**: Files created via 
ano, createFile, or patches without explicit permissions default to execute: ['root'] only (matching Unix umask behavior where new files are not executable). Edits preserve existing permissions via FileSystemPatch.permissions. The chmod command adds execute permission.

## 6.3 /etc/passwd Canonical Format

The /etc/passwd file is a canonical plaintext record of all users on a machine. It is generated by generatePasswdContent() from the UserConfig[] array passed to createFileSystem().

**Format** (7 colon-delimited fields):
`
username:passwordHash:uid:gid:gecos:home:shell
root:5f4dcc3b5aa765d61d8327deb882cf99:0:0:root:/root:/bin/bash
jsmith:2c26b46911185131006ba5d4b4970f1f:1000:1000:jsmith:/home/jsmith:/bin/bash
guest:e99a18c428cb38d5f260853678922e03:1001:1001:guest:/home/guest:/bin/bash
`

- **username**: User identity (root, jsmith, guest).
- **passwordHash**: MD5 hash of the plaintext password (MD5 per RFC 1321, used in this game for deterministic reproducibility).
- **uid/gid**: Numeric user/group ID (root is always 0; others are 1000+).
- **gecos**: User comment field (same as username in this game).
- **home**: Home directory path (/root for root, /home/username for others).
- **shell**: Default shell (/bin/bash in this game).

**Authentication parsing**: The su command and SSH login both read /etc/passwd (if readable by the user), then compare the plaintext password against the stored hash. Server-side login handlers strip the hash from response objects — only the filesystem persists it.

**UserType derivation**: When a user logs in, their userType is determined by their username:
- oot → 'root'
- Anything else → 'user'
- Special case: guest → 'guest' (if explicitly configured)

The game does not implement POSIX groups; gid is always equal to uid, and group permissions are ignored. Guest users exist as a gameplay tier below regular users.

## 6.4 Authentication Flows

### 6.4.1 su (Local Privilege Escalation)

su [username] prompts for a password, reads /etc/passwd (if readable by the current user), hashes the plaintext input, and compares against the stored hash. Success escalates to the target user's privileges; failure returns "authentication failed".

**On FTP-entry machines**: SSH passwords are non-wordlist (from MISSION_PASSWORDS pool), so hydra cracking fails. However, FTP virtual users (in /etc/vsftpd/virtual_users.conf) have passwords from the wordlist and can be cracked. Guest users are omitted on FTP-entry machines to prevent bypassing the FTP requirement.

**Password pools**:
- **MISSION_PASSWORDS** (120 entries) — non-crackable, reserved for root accounts and FTP-entry machines.
- **WORDLIST_PASSWORDS** (60 entries) — crackable by hydra, used for regular user SSH passwords.
- **GUEST_PASSWORDS** (20 entries) — always in hydra's wordlist, used for guest accounts.

### 6.4.2 ssh (Remote Login)

SSH login checks /etc/passwd, compares the password hash, and returns a RemoteUser object (username + userType, no hash). Saved SSH keys in .ssh/authorized_keys can bypass password authentication — format: <public_key> <username@hostname>.

FTP-entry networks force players to FTP first (guest SSH is omitted; root SSH is non-crackable), then discover SSH credentials via a credential leak in /var/ftp/ or web content.

### 6.4.3 ftp (FTP Virtual Users)

FTP credentials are separate from system users. The /etc/vsftpd/virtual_users.conf file stores FTP-specific accounts in format:
`
username:md5hash
username:md5hash
`

Passwords are drawn from WORDLIST_PASSWORDS (crackable), differing from system SSH passwords. FTP-entry machines always have virtual users; ~40% of other FTP-open machines get them for variety. Players can crack FTP via hydra, discover credentials in HTML content (curl), or find them in backup scripts / config files (privilege-escalation-required leaks).

### 6.4.4 hydra (Batched Cracking)

The hydra command batches password guesses across SSH, FTP, and other services. It uses the WORDLIST_PASSWORDS + GUEST_PASSWORDS pools (60 + 20 = 80 candidates). Root passwords from MISSION_PASSWORDS are explicitly excluded (via generation logic), ensuring root cannot be cracked via hydra — players must find the root password via a credential leak or escalation.

## 6.5 GeneratedUser Intermediate Type

At generation time, GeneratedUser extends RemoteUser with a passwordHash field:

```typescript
type GeneratedUser = RemoteUser & {
  readonly passwordHash: string;
};

type RemoteUser = {
  readonly username: string;
  readonly userType: UserType;
};
```

During filesystem generation in uildMachineConfig(), the GeneratedUser[] is converted to UserConfig[] for the filesystem factory, which writes the hashes into /etc/passwd content. When the network is serialized to the client, hashes are stripped via stripGeneratedUser() — the client only receives RemoteUser (username + userType), and must read /etc/passwd to access hashes. This ensures hashes are only visible to players who can read the file, not baked into the network config JSON.

## 6.6 Seeded RNG (prng.ts)

All procedural generation is deterministic via a seeded Mulberry32 PRNG initialized with FNV-1a hash of the seed string:

```typescript
const fnv1aHash = (str: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const createPrng = (seed: string): Prng => {
  let state = fnv1aHash(seed);
  const next = (): number => {
    // Mulberry32: produces float in [0, 1)
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // ... nextInt, pick, pickN, shuffle
};
```

**PRNG API**:
- 
ext() — float in [0, 1)
- 
extInt(min, max) — integer in [min, max] inclusive
- pick(items) — random element from array
- pickN(items, n) — Fisher-Yates partial shuffle, returns n random elements
- shuffle(items) — full shuffle via pickN(items, items.length)

**Seed determinism**: Same seed always produces identical PRNG state sequence, hence identical network topology, user credentials, and filesystem content. Keyword overrides (e.g., "HEIST-hard-ssh-forwarded") still consume PRNG calls for sequence stability — the override discards the PRNG result in favor of the keyword.

## 6.7 IP / Binary Generation

**Public IP generation** (src/generation/ip.ts):
```typescript
generatePublicIp(prng, usedIps?) → string
```

Picks a realistic first octet from a pool of hosting/cloud prefixes (45, 51, 62, 78, 91, 103, etc.) and randomizes the remaining three octets. When usedIps is provided (a Set of already-allocated IPs), re-rolls until a unique IP is found (max 100 attempts).

**Private subnet generation**:
```typescript
generatePrivateSubnet(prng) → string
```

Returns a prefix from RFC 1918 ranges:
- 50% chance: 10.x.x
- 30% chance: 172.{16-31}.x
- 20% chance: 192.168.{2-254} (avoids 192.168.1.x, the localhost/gateway default)

**Binary wrapping** (src/generation/binary.ts):

Some exfiltrate targets (~25%) and encryption keys (~25%) are wrapped in binary noise. cat shows garbled output; strings (which extracts contiguous printable runs >= 4 chars) recovers the readable parts. Binary files use deep paths like /opt/app/data.bin or /var/lib/export.dat to simulate compiled binaries or database dumps.

```typescript
wrapInBinaryNoise(prng, content: string) → string
```

Generates an ELF magic header (\x7fELF + noise), then for each line of content, wraps it with random non-printable bytes before and after. Footer noise rounds out the structure. Non-printable ranges: Latin-1 (128–255), control characters (1–8, 14–31), null bytes.

## 6.8 Filesystem Templates Per Machine Type

Each machine role (webserver, database, fileserver, workstation, mailserver, iot, dns, router, switch) has role-specific directory templates and config file pools:

**Role-specific configs** (src/generation/pools/filesystem.ts):
- Templates for service configurations (nginx, apache, mysql, postfix, bind, snmpd, etc.)
- Placeholder vars: {{port}}, {{hostname}}, {{username}}, {{password}}, {{ip}}, {{subnet}}

**Built-in directories** (all roles):
- /root — root home directory with optional custom content
- /home/{user} — per-user home directories with noise files and red herrings
- /etc/passwd — auto-generated from user list
- /etc/{config} — role-specific configs (nginx.conf, my.cnf, snmpd.conf, etc.)
- /var/log — log files from arLogContent
- /var/run — PID files for active services (sshd, vsftpd, nginx, etc.)
- /tmp — world-writable temp directory
- /boot — kernel files (vmlinuz, initrd.img)
- /bin, /usr/bin, /usr/sbin — system utilities and pre-installed tools
- /lib — shared libraries (loaded at day-zero version)

**Extra directories** (merged via mergeFileNodeChildren()):
- /srv, /opt, /var/www — role-specific content (web pages, databases, scripts, target files)
- /usr/local — custom paths for binary-wrapped files or encryption keys

**Credential leaks** (~30% per machine):
- Same-machine: guest-readable files (backup scripts, deploy logs, .bash_history) containing non-root user credentials
- Cross-machine: root/user-owned files (ansible inventories, .ssh/config) containing same-layer peer credentials (requires escalation to discover)
- Web credential exposure: guest-readable files in /var/www/html/ containing same-machine credentials

## 6.9 Generated Config Files (/etc/hosts, resolv.conf, network/interfaces, DNS zone)

**DNS configuration** (generateDnsZoneContent(), generateDnsNamedConf()):
- Zone file format (BIND-compatible) with SOA, NS, A records for all machines in the network
- 
amed.conf with zone file path and ACLs

**SNMP configuration** (generateSnmpConfig(), generateBasicSnmpConfig()):
- SNMP-variant machines: full community strings, system OIDs, leaked credentials, firewall OIDs, dual-homed subnet discovery (ifAddr.2)
- Non-SNMP-variant machines: difficulty-based chance (easy 80%, medium 60%, hard 40%) of basic read-only SNMP (ocommunity public only)

**iptables rules** (generateIptablesContent()):
- Router/gateway: forwarding or NAT rules (depending on network mode)
- Format: /etc/iptables/rules.v4 (saved iptables rules)

**ACL rules** (generateAclContent(), for managed switches):
- Switch-role gateways: per-port ACL rules instead of NAT

## 6.10 Generation Pools Catalog

Procedural generation pulls from static data pools organized by domain:

### Machines Pool
- Usernames per role (webserver: www-data, webadmin; database: dbadmin, mysql; etc.)
- Hostname templates (e.g., prod-db-{n}, web-{region}-{n})
- Role-specific user counts and personality details

### Ports Pool
- Port templates per entry variant (SSH port 22, FTP port 21, etc.)
- Non-standard ports for backdoors (4444, 31337, 8888, 1337)
- Port closures: ~30% of SSH/FTP ports close with NC backdoor fallbacks

### Vulnerabilities Pool
- 39 hand-authored VulnerabilityTemplate entries (historical CVEs)
- Fallback to procedural timeline walker for any service/version/gameTime combo not hand-authored
- CVE coverage: SSH, FTP, HTTP, MySQL, Redis, SNMP, DNS, SMTP, MQTT, IoT, etc.

### Filesystem Configs Pool
- Role-appropriate config templates (nginx.conf for webserver, my.cnf for database, etc.)
- Credential leak templates (~30% placement), cross-machine credential leak templates (~30%), web credential templates
- Noise files (readme, logs, backups) and red herrings (decoys, fake credentials)

### Web Content Pool
- HTML, CSS, JavaScript templates per role
- Thematic content (product pages, admin panels, status dashboards)

### Scripts Pool
- script_fix: broken JavaScript with syntax/logic/corruption bugs
- script_auto: automation scripts for local or remote API flavors
- scriptFix templates: bug templates (missing semicolon, wrong operator, corrupted byte)

### Forensics Pool
- Evidence templates (log entries with attacker handles, artifacts, timestamps)
- Evidence pools split by attack chain stage (reconnaissance, lateral movement, exfiltration)

### Malware Pool
- Malware templates per role (cryptominer, data exfiltrator, persistence backdoor)
- Binary wrapping: ~25% wrapped in noise
- Calling cards: PID files, beacon artifacts, log entries

### Database Pool
- Table schema templates per role
- Tamper/fix scenarios: rows to modify, column filters, old/new values
- Sabotage targets: credential tables, audit logs, schema permissions

### Redis Pool
- Key-value store templates (cache, session storage, feature flags)
- Password-protected: ~35% of database machines

### Firmware/Library/Service Templates
- Router firmware: Cisco, MikroTik, DD-WRT, OpenWRT, pfSense, EdgeOS (each with version timelines)
- System libraries: libpam, libcrypt, libsystemd, libreadline, libssl, libz, libxml2, libpcre
- Service versions: 20 services (Apache, nginx, MySQL, PostgreSQL, OpenSSH, etc.)

## 6.11 Secrets / Anti-Cheat Encoding (Build-Time)

Sensitive strings (WiFi passwords, mission root passwords, SNMP community strings) are XOR+Base64 encoded at build time to prevent bundle inspection. The encode script (scripts/encode.ts) is auto-run by predev, prebuild, pretest hooks.

**Encoding flow**:
1. src/secrets/secrets.ts — plaintext key-value pairs (e.g., WIFI_PASSWORD, MISSION_PASSWORDS JSON array)
2. 
pm run encode — invokes scripts/encode.ts:
   - Imports plaintext secrets
   - For each key-value pair: calls encodeContent(value) (XOR + Base64)
   - Writes src/secrets/__encoded.ts (gitignored)
3. App code imports from __encoded.ts, not the plaintext source
4. Tests import from plaintext source directly (unaffected by encoding)

**Verification**: grep -r "FLAG{" dist/ and grep -r "cr4ck3d_w1f1" dist/ after build should return zero matches. Mission flags are generated at runtime (not embedded in bundle), so only encoded secrets should be checked.

**Current secrets**:
- WIFI_PASSWORD — legacy static WiFi password
- WIFI_PASSWORDS — JSON array of 40 passwords for seeded WiFi generation
- MISSION_PASSWORDS — JSON array of 120 non-crackable passwords (reserved for root/FTP-entry)
- GUEST_PASSWORDS — JSON array of 20 guest passwords (always in hydra's wordlist)
- WORDLIST_PASSWORDS — JSON array of 60 crackable passwords for hydra
- SNMP_COMMUNITIES — JSON array of 24 SNMP read-write community strings

## 6.12 contentCodec (XOR+Base64 Encoding)

The contentCodec module (src/utils/contentCodec.ts) provides XOR encoding for filesystem content and secrets:

```typescript
const CODEC_KEY = 'JSHACK_CTF';  // arbitrary but fixed

encodeContent(plain: string) → string  // XOR + Base64
decodeContent(encoded: string) → string
encodeFileSystem(root: FileNode) → FileNode  // recursively encodes all content
decodeFileSystem(root: FileNode) → FileNode
```

**XOR mechanics**:
- Cycle the codec key (JSHACK_CTF) byte-by-byte across the plaintext
- Base64 encode the XORed bytes
- Reverse: Base64 decode, XOR again (XOR is self-inverse)

This is an anti-cheat measure to prevent bundle inspection (e.g., strings dist/bundle.js | grep FLAG). The codec key is hardcoded — changing it would invalidate previously encoded data.

## 6.13 Storage Layer (IndexedDB, storageCache, crossTabSync)

User-created/modified files are persisted as FileSystemPatch arrays in IndexedDB (database jshack-db, store ilesystem, key patches). On init, patches are replayed on top of the base filesystem. Only the diff is stored — clearing the database resets to factory state.

**FileSystemPatch format**:
```typescript
type FileSystemPatch = {
  readonly machineId: string;  // machine IP or hostname
  readonly path: string;       // /path/to/file
  readonly content: string | null;  // null = deletion
  readonly owner: UserType;
  readonly permissions?: FilePermissions;  // explicit permissions (preserve on edit)
  readonly isNew?: true;  // hint for patch ordering
  readonly nodeType?: 'file' | 'directory';  // empty dirs need explicit type
};
```

**Persistence flow**:
1. User creates/edits a file via writeFile(), createFile(), or patch mutation
2. Client calls roadcastAndRecordPatch(), which:
   - Emits BroadcastChannel message for same-origin tabs
   - Dispatches server upsert/remove call
   - Appends to in-flight patches array, awaits server response
3. Server L2 permission check validates the patch (via permissionWalker)
4. Server stores the patch in IndexedDB
5. Client and server apply patches to in-memory filesystem state
6. On reload, patches are fetched from server and replayed on the base filesystem

**Multi-tab coordination**:
- BroadcastChannel sync (useFileSystemSync.ts): patches are broadcast to same-origin tabs
- IndexedDB sharing: session storage per tab, filesystem patches shared globally
- Debounced rehydration: after tab regains focus, fetch latest patches from server with exponential backoff

**Mission patch lifecycle**:
- On mission start, patches are generated and stored with the mission seed
- On mission change/end, old patches are cleared, new patches loaded
- Mission reload (same seed) replays the same patches on a regenerated base filesystem

## 6.14 Workstation Base-FS Generation

**Localhost filesystem** (src/generation/generateLocalhost.ts):

Generated from GameState at runtime, not static. The player's username and game seed determine content:

- /root — root home (password from gameState, or seed-derived guest password)
- /home/{playerUsername} — player home directory
  - README.txt — welcome guide (help commands, su, WiFi cracking, missions)
  - .bash_history — sample command history
  - .bashrc — shell configuration
  - /home/{playerUsername}/downloads/ — cheatsheets (nmap, wireless tools)
- /etc/passwd — auto-generated from root + player user
- /bin — system utilities (bash, cat, ls, echo, grep, etc.)
- /usr/bin — pre-installed tools (LOCALHOST_PREINSTALLED_TOOLS: nmap, airmon, airdump, etc.)
- /lib — shared libraries at day-zero versions

**Day-zero library versions**: All machines start with the same library versions on day zero (e.g., libssl 1.1.1a, libpam 1.1.8). Version timelines allow players to upgrade libraries via pt upgrade and test exploit effects locally via msfconsole --local.

**Guest password generation**: If the seed keyword guest is absent, a seed-derived PRNG generates a deterministic guest password from the guest password pool (players can crack guest on their own localhost to test hydra).

## 6.15 Machine Filesystem Assembly

The generation pipeline orchestrates filesystem creation for all machines in a mission or home network:

1. **Topology generation** (generateTopology()) — determines machines, roles, IPs, subnets
2. **User generation** (generateUsers()) — roots + role-appropriate users, hashed passwords
3. **Network enrichment** (enrichMachineWithUsers(), pplyPortClosures()) — assigns port owners, closes ~30% of SSH/FTP with NC fallbacks
4. **Filesystem generation** (generateFileSystems()) — orchestrates per-machine filesystem builds:
   - For each machine:
     - Call uildMachineConfig() with PRNG, machine, users, credentials, options
     - Generate role-specific configs, credential leaks, web content, target files
     - Call createFileSystem(config) to build the FileNode tree
     - Store in ileSystems: Record<machineIp, FileNode>
5. **Serialization** — strip hashes from users, encode filesystem content (optional), return to client

**Critical load-bearing details**:
- PRNG consumption is fixed per machine type — overriding a keyword (e.g., "easy" vs. derived difficulty) still consumes the PRNG call, maintaining sequence stability
- Credential leaks always consume 2–3 PRNG calls, even if the roll says "skip" — ensures generation determinism
- FTP-entry machines skip guest users and use non-wordlist SSH passwords — gameplay constraint
- Target file path is dynamic (from objective), not hardcoded — allows reuse of the same filesystem generation code for all objective types

---

**Next steps for Solid.js rewrite**: Port FileNode and FileSystemPatch types to Solid data structures; reimplement permissionWalker as pure functions (no changes needed); implement Solid stores for filesystem state (replacing React Context); adapt BroadcastChannel and IndexedDB sync to Solid reactivity; ensure the contentCodec and PRNG remain pure (no SolidJS changes needed). Generation code is entirely pure functions — no UI framework changes required.

---

# 7. Game Shell & Lifecycle

The game shell is the player-facing UI layer that wraps all core systems. It manages the intro/boot flow, session state (the "current user/machine/path" context), game time (the procedural CVE timeline), multi-tab synchronization, persistence across refreshes, and the visual theme. This section covers everything from first boot to darknet marketplace access.

## 7.1 App Entry & Lifecycle (App.tsx)

`App.tsx` is the root component and orchestrates three screen states:

- **Intro** — New-game menu or continue-game prompt
- **Boot** — Linux-style animated boot sequence (new games only)
- **Game** — Main terminal interface wrapped in `SessionProvider` + `GameSession`

```
IntroScreen → (isNewGame) → BootScreen → Terminal
                 ↓
            (continueGame)
                 ↓
              Terminal
```

### New-Game Flow

1. **IntroScreen** collects username, workstation name, and root password via three-field form. A "New Game" button clears any previous game state; "Continue" button restores cached game state.
2. **Form submission** (or Enter key):
   - Validates hostname (2–24 chars, alphanumeric + hyphens, lowercase)
   - Validates username (2–24 chars, starts with letter, [a-z0-9_-], no reserved names like `root`, `guest`, `admin`)
   - Validates root password (minimum 4 characters, must match confirmation)
   - Generates a random 16-character hex `gameSeed` via `crypto.getRandomValues()`
   - Fires-and-forgets `registerWorkstation()` to the server (async, non-blocking — UX doesn't wait)
3. **BootScreen** runs a Linux-style boot animation with hardware init, kernel logs, systemd startup messages, and automatic login. Takes ~3 seconds.
4. **Game session begins** — `SessionProvider` wraps `GameSession`, which stitches together all child providers (`HomeNetworksProvider`, `MissionProvider`, `FileSystemProvider`, `NetworkProvider`) and mounts `Terminal`.

### Session Restoration (Continue)

When the app detects `cachedGame` (from `storageCache.getCachedGameState()`), it skips intro and boot, jumping directly to the terminal. The `sessionStorage` per-tab and IndexedDB shared stores are pre-populated before React mounts via `storageCache.ts`, guaranteeing no flicker.

### Hostname Computation

The player's full hostname combines workstation name + an 8-character identity-derived suffix:

```
"skylab" + "-a1b2c3d4" = "skylab-a1b2c3d4"
```

The suffix is computed once per identity (lazy-created on first intro) and is stable across sessions. It's used as the unique machine ID internally (`workstation_id`) but stripped from the prompt display via `displayPromptHostname()` to keep the prompt clean. This prevents prompt clutter while maintaining a permanent, collision-resistant identity.

The full hostname is computed at app startup via `computePlayerHostname(workstationName, identity)` and threaded through to every consumer: IntroScreen preview, BootScreen, SessionProvider prompt, and `/etc/hostname` file content.

## 7.2 Intro / Boot Screen (Username, Workstation Name, Root Password)

`IntroScreen.tsx` is a single-screen form that gathers three pieces of player configuration:

### Fields

1. **Workstation name** (required, 2–24 chars)
   - Lowercase alphanumeric + hyphens (validated via `/^[a-z0-9][-a-z0-9]*[a-z0-9]$/`)
   - Example: `skylab`, `my-pc`, `darknet-box`
   - Shown in prompt and `/etc/hostname` on localhost

2. **Username** (required, 2–24 chars)
   - Starts with letter, then [a-z0-9_-]
   - Rejected: `root`, `guest`, `admin`, `daemon`, `bin`, `sys`, `nobody`
   - Shown as `${username}@${hostname}>` in the prompt
   - Creates a home directory `/home/${username}` and entry in `/etc/passwd`

3. **Root password** (required, 4+ characters)
   - Confirmation field ensures no typos
   - Never exposed in-game; stored server-side as md5 hash in `/etc/passwd`
   - Used locally to authenticate `su` commands and to validate cross-player access on shared LANs
   - The player's own `su` command accepts this password with no brute-force check; remote players must hydra-crack it

### Prompt Preview

While the player types hostname and username, the form shows a live preview of the in-game prompt: `${trimmedUsername}@${displayPromptHostname(full_workstation_id)}>`. The preview strips the identity suffix automatically so the player sees the same clean prompt they'll get in-game.

### Menu Button Styling

Menu buttons (NEW GAME, CONTINUE, START, BACK) have bordered styling with theme-aware colors. On hover, they invert to accent background with accent text. Keyboard navigation: Enter submits, Escape cancels.

## 7.3 Boot Sequence (Linux-Style)

`BootScreen.tsx` plays a ~3-second Linux boot animation for new games. The sequence is non-interactive; players watch it complete then the terminal appears.

### Boot Sequence Steps

1. **BIOS messages** — "Initializing system…", "Memory test… 4096 MB OK" (dim text)
2. **Kernel load** — "Loading Linux 5.15.0…", "Loading initial ramdisk" (standard text)
3. **Kernel boot logs** — Realistic kernel timestamps and subsystem init lines (dim text, scrolling)
4. **systemd startup** — Service init messages with "[  OK  ]" prefixes:
   - Journal Service
   - Local File Systems
   - Login Service
   - Network Manager
   - OpenSSH server
   - wlan0 device found
   - Network target
   - Multi-User System target
5. **Login prompt** — `${hostname} login: ${username} (automatic login)` (standard text)
6. **Completion** — Triggers `onComplete()` callback, which sets screen to 'game'

Each step has a `delay` property (milliseconds) that stagger the lines for realistic boot pace. Blank lines separate phases. The container auto-scrolls to bottom as lines are added. No input is accepted during boot.

## 7.4 Session Context (Current Machine, User, PWD, Hop Chain)

`SessionContext` (`src/session/SessionContext.tsx`) is the single source of truth for the player's current terminal session state.

### Core Session Type

```typescript
type Session = {
  readonly username: string;        // Player-chosen, e.g., "jshacker"
  readonly userType: UserType;      // 'root' | 'user' | 'guest'
  readonly machine: string;         // IP or hostname, e.g., "192.168.1.75"
  readonly hostname?: string;       // Display name for prompt, e.g., "dist-rtr"
  readonly currentPath: string;     // Working directory, e.g., "/home/jshacker"
  readonly theme: ThemeId;          // 'amber' | 'green' | 'cyan' | 'light'
};
```

### Default Session

On app start (or new tab), the session initializes to:
- `username` = player-chosen name from intro
- `userType` = 'user'
- `machine` = 'localhost'
- `currentPath` = '/home/${username}'
- `theme` = cached theme or 'amber' (default)

### Session Stack (SSH + su)

The session stack is a LIFO queue of snapshots. Pushing a session saves the current state; popping restores the previous state.

#### Snapshot Types

```typescript
type SessionSnapshot = {
  readonly session: Session;
  readonly reason: 'ssh' | 'su' | 'exploit';
};
```

#### Operations

- **`pushSession(reason)`** — Save current session to stack (before SSH, su, or exploit shell)
- **`popSession()`** — Restore previous session from stack
- **`popAllSessions()`** — Reset to bottom of stack (mission abort, returns home)
- **`canReturn()`** — Check if stack has entries

#### Example Flow

```
Start: user@localhost:/home/user>
SSH to 192.168.1.5
  → pushSession('ssh')
  → setMachine('192.168.1.5')
  → user@192.168.1.5>
su root (with password)
  → pushSession('su')
  → setUsername('root', 'root')
  → root@192.168.1.5>
exit
  → popSession()
  → user@192.168.1.5>
exit
  → popSession()
  → user@localhost:/home/user>
```

WiFi state (`connectedWifi`) is NOT part of snapshots — it doesn't change per SSH hop. Disconnecting WiFi from another tab resets the session to localhost but preserves other context.

### Hostname Display

The `hostname` field is optional and provides a display name for the prompt. The prompt uses `session.hostname ?? session.machine`. For localhost, an effect syncs `workstationName` into `session.hostname` so the prompt shows `user@skylab>` instead of `user@localhost>`. For remote machines, `setMachine(ip, hostname)` can set a display name from network config (e.g., `user@dist-rtr>` instead of `user@45.x.x.x>`).

### FTP Mode

FTP mode tracks both local and remote filesystem state simultaneously:

```typescript
type FtpSession = {
  readonly remoteMachine: string;
  readonly remoteUsername: string;
  readonly remoteUserType: UserType;
  readonly remoteCwd: string;
  readonly originMachine: string;
  readonly originUsername: string;
  readonly originUserType: UserType;
  readonly originCwd: string;
};
```

- **`enterFtpMode(session)`** / **`exitFtpMode()`** — Toggle FTP mode
- **`updateFtpRemoteCwd(path)`** / **`updateFtpOriginCwd(path)`** — Navigate directories on either side
- Prompt changes to `ftp>` when active
- All FTP commands (`pwd`, `ls`, `cd`, `get`, `put`, `quit`) operate on this dual state

### NC Mode

NC mode represents an interactive netcat shell:

```typescript
type NcSession = {
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: UserType;
  readonly currentPath: string;
};
```

- **`enterNcMode(session)`** / **`exitNcMode()`** — Toggle NC mode
- **`updateNcCwd(path)`** — Navigate directories (read-only filesystem)
- Prompt changes to `$` when active
- Commands: `pwd`, `cd`, `ls`, `cat`, `whoami`, `help`, `exit` (no binary execution)

## 7.5 Game Time Model (Shared Universe Time, Server-Stamped)

`gameTime.ts` implements a real-world-clock time model for the procedural CVE timeline. The defense treadmill (Phase 3) advances CVE availability based on elapsed game time.

### API

```typescript
export const MS_PER_DAY = 86400000;  // Milliseconds in one 24-hour day

// Initialize anchor on first call; idempotent thereafter
initGameTimeIfUnset(): number

// Read anchor without side effects
readStartedAt(): number | null

// Compute whole game days elapsed since anchor
getGameTime(): number

// Clear anchor (called on permadeath / new game)
resetGameTime(): void
```

### How It Works

On first app load (new game), `initGameTimeIfUnset()` records `Date.now()` in `localStorage` under `jshack_started_at`. On subsequent loads, the function detects the stored anchor and returns it without writing.

`getGameTime()` returns `Math.floor((Date.now() - startedAt) / MS_PER_DAY)` — the number of whole 24-hour periods elapsed since the anchor was set. This is called by the vulnerability lookup layer whenever a CVE needs to be checked: if the CVE's `publishedAt` field (measured in game days since `startedAt`) is <= the result of `getGameTime()`, the CVE is "active" and can be exploited.

### Offline Accrual

If a player leaves the game for a week, they return to a week's worth of newly-published CVEs. This matches real system administration: patches accumulate while you're away. The game feels alive even when you're not playing.

### Permadeath / New Game

`resetGameTime()` clears the `localStorage` entry. The next `initGameTimeIfUnset()` call generates a fresh anchor, advancing all CVEs forward in the timeline.

### Multiplayer Note (Future)

In multiplayer, gameTime is intended to become **server-stamped** rather than client-computed, to prevent clock-tampering exploits. The current memory notes "shared universe time, anti-cheat server-stamped gameTime" as the target. The Solid rewrite should plan for this from the start: read gameTime from server-issued tokens or signed envelopes, not from `Date.now() - startedAt`.

## 7.6 Game Seed (Scope, Derivation)

`gameSeed.ts` generates the 16-character hex seed that drives all deterministic generation.

```typescript
export const generateGameSeed = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
```

### Scope

The seed controls:

1. **Home network topology** — Every WiFi network the player can crack generates its own LAN via `generateNetwork(gameSeed, wifiNetwork)`, producing deterministic machines, services, CVEs, credentials, and filesystems. Same seed + same WiFi = same machines forever.
2. **Mission networks** — `generateMissionNetwork(seed)` produces a full network from a mission seed string. Different mission seeds = different networks.
3. **Localhost** — Generated via `generateLocalhost(gameState, hostname)`, which uses the game seed to derive guest account password and other deterministic content.

The seed does NOT control:
- Session state (current user, machine, path — these are transient per-tab)
- Theme choice (persisted but player-controlled)
- Filesystem patches (mutable via gameplay)

### Storage

Seed is persisted in `IndexedDB` as part of `GameState`, which also holds username, workstation name, and root password. On app reload, the cached seed deterministically regenerates every home-network machine and mission (if one is active).

## 7.7 WiFi System (Multi-WiFi, airmon/airdump/aircrack)

The WiFi hacking gate is the gatekeeper to network access. From localhost, the player cannot reach any remote networks until they crack a WiFi connection.

### WiFi Network Definitions

Static WiFi networks are defined in `src/network/wifiNetworks.ts`:

```typescript
type WifiNetwork = {
  readonly bssid: string;              // MAC address, e.g. "A4:CF:12:D3:8B:7A"
  readonly essid: string;              // Network name
  readonly power: number;              // Signal strength (-42 to -93)
  readonly channel: number;            // WiFi channel (1–11)
  readonly encryption: 'WPA2' | 'WPA3' | 'WEP' | 'OPEN';
  readonly crackable: boolean;          // Is the password discoverable?
  readonly password?: string;           // (if crackable) Plaintext password from secrets
  readonly tier?: WifiTier;             // 'crowded' | 'shared' | 'solo' (crackable only)
};
```

Example network:
```javascript
{
  bssid: 'A4:CF:12:D3:8B:7A',
  essid: 'JSHACK-CORP',
  power: -42,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: secrets.WIFI_PASSWORD,  // Visible only in __encoded.ts for Vercel
  tier: 'solo',
}
```

Current catalog includes 4 networks: one crackable (JSHACK-CORP) and 3 noise networks (NetGear, FBI Van, hidden).

### WiFi Hacking Workflow

1. **`airmon start wlan0`** — Enable monitor mode (localhost only)
   - Validates: on localhost, not already connected
   - Sets `setMonitorMode(true)` state
   - Only one mode toggle per command (no `stop` check during `start`)

2. **`airdump`** — Scan for networks (localhost + monitor mode)
   - Lists all networks in tabular format: BSSID, Power, Channel, Encryption, ESSID
   - Async command with 600ms scan delay before output
   - Non-cancellable

3. **`aircrack <bssid>`** — Crack WPA/WPA2 password (localhost + monitor mode)
   - Validates BSSID exists
   - If not crackable, throws "WPA3 encryption not supported" error
   - Simulated brute-force: iterates through wordlist, outputs progress every 400ms
   - On success, calls `setWifiConnected({ essid, bssid })`
   - Persists connection to IndexedDB (`wifiConnected` key)

### WiFi State

`connectedWifi: WifiConnection | null` is stored in `SessionContext` as a separate `useState`, not part of the core `Session` type. This separation reflects its nature: it's global shared state (all tabs see it), not per-tab session state.

```typescript
type WifiConnection = {
  readonly essid: string;
  readonly bssid: string;
};
```

### Persistence & Sync

- **Storage** — IndexedDB, shared across all tabs
- **BroadcastChannel sync** — When a tab connects/disconnects WiFi, it broadcasts `wifi-changed` to other tabs, which update their `connectedWifi` state

### Effects

Once WiFi is connected, the session's machine can reach networks on that BSSID's generated LAN. The home network is generated deterministically from `(gameSeed, wifiNetwork)`, so cracking the same BSSID always generates the same machines.

### Multiplayer Note

In multiplayer, the home network is **shared** with other players who cracked the same WiFi (Model B tiered hybrid, see Section 5). Each cracked WiFi joins the player to a `home_networks` row via `/api/join-home-network`, allocating an occupant slot.

## 7.8 Wallet (In-Game Balance, Separate Keypair)

The in-game wallet is a separate Ed25519 keypair that lives in the virtual filesystem (`~/.wallet/key.pem` on localhost) and can be lost or stolen.

### Split Keys

Two different Ed25519 keypairs:

1. **Player identity** (`src/identity/`) — Persisted in localStorage, never changes, tied to the player's browser profile. Used for server-authenticated requests. Determines the workstation's unique ID suffix.
2. **Wallet keypair** — Lives in the filesystem as a regular file. Can be copied between machines via SCP, exfiltrated, encrypted, deleted. Lost on permadeath (reset command).

The split prevents a compromised wallet from compromising the player's identity. Wallet defense is gameplay; identity defense is platform.

### Wallet File

```
~/.wallet/key.pem
  - Type: Ed25519 private key in PEM format
  - Owner: ${username} (player's user)
  - Permissions: 0600 (user-readable only)
  - Accessible: Via cat (plaintext), can be copied via SCP
```

### Balance Tracking

The balance is stored alongside the keypair in `~/.wallet/balance.json`:

```json
{
  "satoshis": 500000,
  "lastUpdated": 1672531200000
}
```

- Only the wallet owner can read/write balance
- No automatic reward distribution (future feature — Phase 4)
- Mission completion will update the balance via a privileged write (or server-side in multiplayer Phase 5)

### Vault Use Case

In future multiplayer, players can deposit their wallet on a shared LAN machine for safekeeping. The machine's root can encrypt/lock it; other players can authenticate with it for transactions.

## 7.9 Theme System (amber/green/cyan/light)

Terminal colors are themeable via CSS custom properties. Player can switch themes at runtime with the `theme()` command.

### Available Themes

| ID      | Name           | Style                  |
| ------- | -------------- | ---------------------- |
| `amber` | Amber (default) | Classic amber CRT      |
| `green` | Green Phosphor | Green-on-black terminal |
| `cyan`  | Cyan           | Cyan/blue CRT          |
| `light` | Light          | Dark on light bg       |

### Color Tokens (14)

Each theme defines 14 semantic color tokens applied via CSS `--theme-*` variables:

- `--theme-bg` — Page background
- `--theme-text` — Primary text (results, descriptions)
- `--theme-text-bright` — Bright text (banner, commands, input, headings)
- `--theme-text-dim` — Dim text (prompt, status bar, cursor position)
- `--theme-error` — Error messages
- `--theme-accent` — Inverted backgrounds (nano title bar, badges)
- `--theme-accent-text` — Text on accent backgrounds
- `--theme-border` — Input border, help bar background
- `--theme-scroll-thumb` — Scrollbar thumb
- `--theme-scroll-thumb-hover` — Scrollbar thumb on hover
- `--theme-caret` — Input cursor color
- `--theme-link` — Hyperlinks
- `--theme-link-hover` — Hyperlink hover state
- `--theme-avatar-border` — Author card avatar border

### Application Flow

1. **Before React mounts** — `storageCache.ts` reads the persisted theme from IndexedDB and calls `applyTheme()` to set CSS variables immediately (prevents flash of wrong colors).
2. **React mount** — `SessionContext` initializes with the cached theme value. A `useEffect` calls `applyTheme()` whenever `session.theme` changes.
3. **User switches theme** — `theme("green")` calls `setTheme()` on the session context, which updates the persisted session and triggers the `useEffect` to apply the new CSS variables.

### Components & CSS Variables

Components use inline `style` attributes with `var(--theme-*)` instead of Tailwind color classes:

```jsx
<div style={{ color: 'var(--theme-text)' }}>Result text</div>
```

Fallback values are defined in `:root` in `src/index.css` (amber defaults) so the page renders correctly before JavaScript runs.

### User Command

```
theme()               — List all themes, mark active with *
theme("green")        — Switch to named theme
reset("confirm")      — Reset theme back to amber + clear all IndexedDB
```

Theme choice persists across sessions via IndexedDB (same store as WiFi/mission/patches).

## 7.10 Multi-Tab Support & Cross-Tab Sync (BroadcastChannel)

Multiple browser tabs can run independent terminal sessions with shared state.

### Per-Tab Independence

Each tab has its own session state (user, machine, path, SSH stack, FTP/NC/MySQL mode). Typing commands in one tab does not affect another tab's terminal. But:

- **Filesystem patches** — Shared. A file written in tab A immediately appears in tab B.
- **WiFi state** — Shared. Cracking WiFi in tab A enables network access in tab B.
- **Mission state** — Shared. Accepting a mission in tab A loads it in tab B.
- **Theme** — Shared. Switching theme in tab A updates tab B.

### Implementation

`src/utils/crossTabSync.ts` provides `createSyncChannel()`, which returns a `BroadcastChannel`-based messenger (or no-op stubs if unavailable).

Each context that needs sync creates a channel inside its subscription effect and closes it on cleanup. The channel ref is updated so broadcast calls always use the active channel. This pattern is React StrictMode-safe: the cleanup + re-run cycle gets a fresh channel instead of reusing a closed one.

### Messages

```javascript
// Filesystem patches
{ type: 'patch', machineId, patch: FileSystemPatch }

// WiFi state
{ type: 'wifi-changed', connected: WifiConnection | null }

// Mission state
{ type: 'mission-changed', seed: string | null }

// Theme
{ type: 'theme-changed', themeId: ThemeId }
```

### Echo Loop Prevention

Each context broadcasts only on locally-initiated changes (explicit method calls). `BroadcastChannel` does not deliver messages to the posting tab, so echo loops cannot occur. Messages are fire-and-forget; `IndexedDB` serves as the durable backing store.

### Tab Title Updates

`SessionContext` updates `document.title` based on the current session mode:
- `username@machine — JSHACK.ME` (normal)
- `ftp> — JSHACK.ME` (FTP mode)
- `nc shell — JSHACK.ME` (NC mode)
- `mysql> — JSHACK.ME` (MySQL mode)
- `redis> — JSHACK.ME` (Redis mode)

### Graceful Fallback

When `BroadcastChannel` is unavailable (older browsers), `createSyncChannel()` returns no-op stubs. Tabs work independently; shared state is only written/read via IndexedDB, so slow async consistency is the fallback. Modern browsers (all current versions) support `BroadcastChannel`.

### Relationship to Supabase Realtime

In multiplayer, `BroadcastChannel` and Supabase Realtime are both active and share `applyExternalPatch`. Decision recorded in memory: keep both for now; revisit deletion post-launch when Realtime reliability is measured.

## 7.11 Session Persistence (IndexedDB, Restore on Refresh)

Three-layer persistence architecture ensures state survives page refresh:

### Layer 1: Storage API (`storage.ts`)

Low-level adapter:
- **IndexedDB** — Shared state: WiFi connection, mission seed, filesystem patches, bricked machines, theme
- **sessionStorage** — Per-tab state: Session (user, machine, path, theme, SSH stack), FTP/NC/MySQL mode

### Layer 2: Cache Loader (`storageCache.ts`)

Pre-loads caches before React mounts:

1. Call `loadSessionFromSessionStorage()` (sync)
2. Call `loadGameState()` from IndexedDB (async)
3. Call `loadWifiConnected()`, `loadActiveMissionSeed()`, `loadPatches()`, `loadBrickedMachines()` (async)
4. Call `applyTheme()` to set CSS variables (prevents flash)
5. Mount React with initial state populated

### Layer 3: Contexts

Each context writes to storage on state changes:

- **SessionContext** — Writes session + WiFi to storage on every mutation
- **FileSystemContext** — Writes patches to IndexedDB after each write/create/delete
- **MissionProvider** — Writes mission seed to IndexedDB on start/abort/complete
- **useMissionState** — Persists active mission seed

### Storage Layout

| State                           | Storage                         | Scope  |
| ------------------------------- | ------------------------------- | ------ |
| Session (user, machine, path, theme, stacks)  | sessionStorage            | Per-tab |
| WiFi connected                  | IndexedDB                       | Shared |
| Mission seed                    | IndexedDB                       | Shared |
| Filesystem patches              | IndexedDB                       | Shared |
| Bricked machines                | IndexedDB                       | Shared |
| SSH keys (`~/.ssh_keys`)        | Filesystem patches (IndexedDB)  | Shared |

### Patch-Based Persistence

Filesystem changes are stored as patches (diffs from base), not full snapshots. Each patch records:
- Machine ID (localhost, home network IP, mission IP, etc.)
- Path
- New content (or `null` for deletion)
- Owner
- Optional `isNew` flag (file didn't exist in base)

On init, patches are replayed in order via `applyPatches()`, reconstructing the current filesystem state. This approach is space-efficient and simplifies merging concurrent edits across machines.

### Mission Persistence

Active mission seed is stored in IndexedDB. On reload:
1. `useMissionState` reads the seed
2. `generateMissionNetwork(seed)` deterministically regenerates the full network
3. Cached mission patches are replayed on top

When a mission ends/transitions, mission patches are cleaned up.

### Permadeath Clears IndexedDB

`reset("confirm")` calls `clearAllData()`, which deletes all IndexedDB stores. This:
- Clears WiFi connection (forces re-crack)
- Clears mission seed (mission lost)
- Clears filesystem patches (localhost state reset, home networks reset)
- Clears bricked machines
- Leaves identity untouched (identity is in localStorage, separate from game state)
- Leaves theme choice untouched (stored in session, restored via sessionStorage)

## 7.12 Permadeath / New-Game Flow

When the player loses their workstation, they can either repair or start fresh.

### Permadeath Trigger

**Localhost bricked** — If the player deletes `/boot/vmlinuz` or `/boot/initrd.img` and reboots, the machine is permanently bricked. `Terminal.tsx` checks `isMachineBricked('localhost')` at the top of render. If true, it displays a frozen kernel panic screen with no input acceptance.

### Recovery Options

1. **Repair** — Not currently available in Phase 2. Phase 3 will allow admins to repair via privileged commands or server-side actions.
2. **Reset** — Type `reset confirm` (or explicit button in modal). This clears all IndexedDB, but:
   - **Identity preserved** — Ed25519 keypair in localStorage stays intact. The player's workstation ID suffix stays the same on the same LAN.
   - **Wallet lost** — Any wallet files in the filesystem are deleted (permadeath = financial loss).
   - **Session reset** — Current machine/user/path reset to localhost/player-username/home.
   - **WiFi reset** — Cracked WiFi networks are forgotten. Must re-crack.
   - **Missions aborted** — Active mission is cleared. Must accept a new seed.

### New-Game Intention

`reset confirm` is explicit and intentional — not accidentally triggered. A modal confirms the action before clearing. This makes permadeath a meaningful consequence.

### Identity Persistence

The player's Ed25519 identity is stored in `localStorage.jshack.identity`, NOT in IndexedDB. Even a full reset doesn't wipe identity. This allows:
- Same player reputation across resets (multiplayer messaging/darknet listings)
- Predictable workstation ID (identity-derived suffix stays the same)
- Cross-session key integrity (same keys for API requests)

To truly wipe identity, the player must clear browser `localStorage` manually via devtools. Identity reset is an explicit "new game" action.

## 7.13 Help / Man Pages

The terminal provides two commands for documentation:

### `help`

Lists all available commands grouped by category (General, Filesystem, Mission, Network, WiFi). All commands are visible; execution is gated by binary file permissions (`/bin/<cmd>`), so `help` may list commands the player can't yet run.

### `man <command>`

Displays detailed manual for a command in Unix man(1) style:

- NAME — Short description
- SYNOPSIS — Usage syntax
- DESCRIPTION — Detailed explanation
- ARGUMENTS — Argument descriptions + required/optional flags
- EXAMPLES — Usage examples

Commands must define a `manual` property on their `Command` type for detailed docs.

### Command Discovery

Tab completion and help are the same source: the command registry in `useCommands()`. No hidden commands.

## 7.14 Mission System OVERVIEW (Skim Only)

The mission system is the gameplay loop: browse contracts, accept missions (each is a seeded procedural network), hack the network, complete objectives, get paid.

This section is a brief overview. User intends to design fresh mission content in Phase 4+, so implementation details are deferred to `docs/mission-variations.md`.

### Mission Provider Hierarchy

```
SessionProvider
  → GameSession (generates localhost + home networks)
    → MissionProvider (manages active mission seed + state)
      → FileSystemProvider (merges mission filesystems)
        → NetworkProvider (merges mission network config)
          → Terminal
```

### 7.14.1 Darknet Marketplace

`missions()` displays the hardcoded mission board — a list of contracts with difficulty, objective type, and client info. Contracts are defined in `src/mission/missionBoard.ts` as a static array of objects with `title`, `description`, `seed`, `difficulty`, `objectiveType`, and `clientEmail`. New missions are added by editing this file (future: dynamic darknet server).

### 7.14.2 Contract Lifecycle

1. **Browse** — `missions()` lists all available contracts
2. **Accept** — `accept("SEED")` generates the `MissionNetwork` deterministically and calls `startMission()`:
   - `generateMissionNetwork(seed)` produces machines, network config, vulnerabilities, filesystems
   - Mission filesystems are merged into `FileSystemProvider`
   - Mission network config is merged into `NetworkProvider`
   - Router machine is added to the network for SSH/nmap/etc.
3. **Hack** — Player uses existing commands (ssh, ftp, nc, curl, nmap, exploit) to infiltrate the network
4. **Complete** — Player sends proof to client via `mail(client_email, proof)`:
   - Command validates proof against objective type
   - On success, calls `completeMission()`, which clears mission state
5. **Abort** — Type `abort()` to quit. Calls `abortMission()`, which:
   - Clears mission state
   - Pops all SSH sessions (returns to localhost)
   - Removes mission filesystems + network config

### 7.14.3 Mission Instances (Per-Acceptance, Permanent, Shareable)

Each `accept(seed)` creates a new mission instance from the seed. The instance is:
- **Persistent** — Persisted to IndexedDB (seed + patches)
- **Per-acceptance** — Same seed accepted twice = two separate instances (not merged)
- **Shareable** — On multiplayer LANs, the instance can be accessed/hacked by other players (future feature, blocked on `mission_instances` table)

Decided 2026-04-23: instances are permanent + shareable + unrestricted (completed, aborted, and post-permadeath all persist). Public IP is the instance key; visiting ≠ accepting.

### 7.14.4 Generation Axes (High Level)

The seeded generator controls (full catalog in `docs/mission-variations.md`):

1. **Difficulty** (easy/medium/hard) — Network depth via isolated subnet layers
2. **Entry variant** (ssh/ftp/nc/exploit/http/snmp) — How to gain initial access
3. **Network mode** (forwarded/router-first) — Port forwarding or gateway hacking
4. **Objective type** (exfiltrate/tamper/credential_theft/sabotage/backdoor/portforward/script_fix/forensics/malware) — What to accomplish
5. **Domain entry** — Domain-based briefing (forces nslookup)
6. **Encryption** — Target file encrypted (requires key discovery)
7. **Gateway type** — Managed switches with ACLs (vs NAT routers)
8. **Forced effect** — Specific vulnerability effect on target machine
9. **Forced tier** — Privilege level of forced effect (root/user/guest)

All axes can be controlled via seed keywords (case-insensitive substring match), e.g., `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`. PRNG derivation falls back when no keyword is present.

## References

- `src/App.tsx` — App root, screen state machine
- `src/components/IntroScreen.tsx`, `BootScreen.tsx` — Intro/boot UI
- `src/session/SessionContext.tsx` — Session state + stack
- `src/session/gameTime.ts` — Game time model
- `src/game/gameSeed.ts`, `types.ts` — Seed generation + GameState type
- `src/network/wifiNetworks.ts`, `wifiTypes.ts` — WiFi definitions
- `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts` — WiFi hacking commands
- `src/theme/themes.ts`, `applyTheme.ts` — Theme system
- `src/utils/crossTabSync.ts` — BroadcastChannel sync
- `src/utils/storageCache.ts`, `storage.ts` — Persistence layer
- `src/mission/missionBoard.ts`, `MissionContext.tsx` — Mission system
- `src/commands/help.ts`, `man.ts` — Documentation commands
- `docs/mission-variations.md` — Mission generation axes catalog
