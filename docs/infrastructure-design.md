# Infrastructure Design — Network & Filesystem

## WiFi Hacking Gate

Before the player can access the network from localhost, they must crack a WiFi network. This is a progression gate before network access — it does not award a flag. Multiple WiFi networks are available, each providing access to a different subnet of machines.

### WiFi Networks (Seeded Generation)

WiFi networks are generated deterministically from the game seed via `generateWifiNetworks(seed)` in `src/generation/generateWifi.ts`. Each game produces:

- **2-3 crackable networks** — WPA2, strong signal (-35 to -65 dBm), unique ESSIDs picked from a 50-entry pool across 7 categories (corporate parody, café, residential, university, public infrastructure, IoT defaults, hacker scene). Each entry is tagged with a `WifiTier` (`'crowded' | 'shared' | 'solo'`) on the `WifiNetwork` type — feeds the planned home-network occupant allocator (slot density per tier). Passwords from encoded secrets (`WIFI_PASSWORDS`).
- **3-5 noise networks** — picked from a 40-entry pool. Each rolls one of three reasons rendering it uncrackable: WPA3 encryption, weak signal (< -80 dBm), or hidden ESSID. `aircrack` surfaces a clear diagnostic for each reason rather than completing silently.

A legacy static network list (`src/network/wifiNetworks.ts`) serves as fallback when no game seed exists.

### Home Networks (Cross-Player Shared LANs)

Each crackable WiFi network maps to a **shared persistent LAN** in the global `home_networks` catalog. When a player runs `nmcli connect <essid> <password>`, the server (`POST /api/join-home-network`) finds-or-creates the network row, allocates a random LAN slot, and returns `{ public_ip, lan_ip, hostname, network_seed }`. Two players who crack the same WiFi land on the same LAN with separate `.X` host octets and identity-derived hostname suffixes — full architecture in `src/homeNetworks/README.md`.

Topology generation goes through `generateHomeNetwork({ seed, essid, slotIp?, hostname? })` in `src/generation/generateHomeNetwork.ts` using the shared `generateNetwork()` pipeline (mission-quality machines, users, enrichment, port closures, filesystems). The seed comes from the server response (`'home-${public_ip}'`) so every occupant of a shared LAN sees identical topology. The slotIp determines the player's `localhostIp` on the LAN; the hostname propagates into `session.hostname` so the prompt, logs, and SSH handlers all observe the suffixed name.

Each WiFi network gets a **random difficulty** (equal probability easy/medium/hard), providing variety in network complexity:

- **Easy (1 layer)**: 2 machines behind a border router
- **Medium (2 layers)**: 2 layers separated by an inner gateway (5-7 machines total)
- **Hard (3 layers)**: 3 layers with 2 gateways (8-11 machines total)

Key properties:

- **1 border router** with a server-allocated public IP (kind=`home_network`); identical across all occupants of the LAN
- **Entry variants** (ssh, ftp, nc, exploit, http, snmp) randomly assigned per layer — no fixed entry method
- **Port closures** apply for lateral movement variety (~30% SSH, ~30% FTP closures, independent rolls)
- **Mission-quality filesystems** — credential leaks (same-machine ~30% guest-readable, cross-machine ~30% root/user-owned), web credential exposure (~30% on HTTP-serving machines), SNMP configs, iptables rules, role-based configs, noise files
- **Gateway .1 IP aliases** — inner gateway configs/filesystems are aliased under their downstream `.1` IPs so players can SSH into routers/gateways from inside the network
- **Per-player LAN slot** — each occupant gets a unique random `lan_ip` in `[.10, .250]` and a unique `hostname` (`${workstation_prefix}-${first-4-hex-chars-of-sha256(player_key)}`). `density_tier` controls `max_slots` (solo=1, shared=3, crowded=8). Tier-narrowed IP ranges deliberately rejected — they would leak crowdedness from the assigned IP.
- Private subnet per layer (RFC 1918), DNS records, and per-machine network configs

The `HomeNetwork` type includes: `layers`, `routerMachine`, `entryVariant`, `entryPoint`, `difficulty`, `natForwarding`, `networkConfig`, `fileSystems`, `machines`, `router` (publicIp, hostname, internalIp), `localhostIp`, `hostname?` (the player's assigned LAN suffix), and `essid`.

`HomeNetworksProvider` (`src/game/HomeNetworksContext.tsx`) wraps the React tree and exposes `useHomeNetworks() → { activeNetwork, joinedNetworks, ensureJoined(essid) }`. Materialization is **lazy**: home networks are only generated when the player connects. `ensureJoined` is idempotent (cache hit on rejoin, server-side existing-row return for cross-tab consistency). The cross-player visibility chunk (PRs #80, #81) handles trail-leaving — file writes, log appends, etc., propagate live across browsers via Supabase Realtime.

### Player Flow

1. Intro screen: player fills a single-screen 3-field form (workstation name, username, root password), starts new game (seed generated)
2. Boot screen: Linux-style boot sequence with hostname, username, and wlan0 detection
3. After gaining root access, the player explores — `ifconfig` and `help` reveal next steps
4. `ifconfig` shows `wlan0` is DOWN (no IP assigned)
5. Network commands (ping, nmap, ssh, etc.) fail with `"Network is unreachable"`
6. Player discovers aircrack commands via `help` or `~/downloads/wifi_tools.txt` and `~/README.txt`
7. `airmon start wlan0` — enables monitor mode
8. `airdump` — scans and displays nearby WiFi networks (seeded, async output)
9. `aircrack <BSSID>` — cracks a WPA2 network, shows `KEY FOUND!` + nmcli hint
10. `nmcli connect <ESSID> <password>` — server allocates a slot on the shared LAN, returns `Connected to <ESSID> — assigned <hostname> (<lan_ip>)` with the player's identity-derived hostname suffix and random LAN IP
11. On success: `ifconfig` shows wlan0 UP with the assigned IP from that LAN's subnet, machines visible. Prompt updates to `user@<hostname>>` (e.g. `user@skylab-9k3>`).
12. Player can switch networks: `nmcli connect <other> <pass>` auto-disconnects current. Reconnecting to a previously-joined LAN is a cache hit (idempotent server lookup; no new slot allocated).
13. `nmcli disconnect` drops WiFi (even from remote machines — returns to localhost). Hostname reverts to the workstationName.

### Implementation

- WiFi state: `WifiConnection | null` (`{ essid, bssid }`) in `SessionProvider` (persisted to IndexedDB)
- `wifiConnected` boolean derived as `connectedWifi !== null` for backward compat
- WiFi commands receive networks via `getWifiNetworks()` context (not static imports)
- `useWifiCommands` reads game seed from storage cache, generates networks via `generateWifiNetworks`, and pulls `ensureJoined` + `activeNetwork` from `useHomeNetworks()`
- Monitor mode: transient `useRef` in `useWifiCommands` hook (resets on page refresh)
- Localhost uses `wlan0` interface (not `eth0`) + `lo` loopback; IP is dynamic per home network subnet (server-allocated slot in `[.10, .250]`)
- `HomeNetworksProvider` wraps the game tree (inside `SessionProvider`) and owns the LAN-cache state; `useHomeNetworks()` exposes `activeNetwork`, `joinedNetworks`, `ensureJoined(essid)`
- `NetworkContext` accepts `homeNetwork` prop; switches machines/interfaces based on connected WiFi
- `FileSystemProvider` accepts `homeFileSystems` prop; merges home network machine filesystems
- `nmcli connect` awaits the server join → real network round-trip replaces the previous fake jitter delays; same network is a no-op (cache hit), different network auto-disconnects and reconnects
- `nmcli disconnect` while SSH'd calls `SessionContext.disconnectWifi()` to atomically reset to localhost; hostname reverts via `GameInner`'s sync effect
- `GameInner` (`src/App.tsx`) syncs `activeNetwork.hostname` into `session.hostname` when on localhost — propagates the LAN suffix to the prompt, log writers (`resolveLogSourceIP`), and SSH handlers
- Hint file at `/home/<username>/downloads/wifi_tools.txt` provides the aircrack + nmcli cheatsheet
- `~/README.txt` is the single guide file for new players (replaces the old `.mission` file)

## Machines

- **localhost** — the player's starting machine (users: `<username>`, guest, root). Generated at runtime via `generateLocalhost(gameState)` in `src/generation/generateLocalhost.ts`. Workstation name, username, and root password are configurable via the intro screen. The player's own user has no password (empty hash); guest password is seed-derived from the guest passwords pool.
- **Home network machines** — procedurally generated per WiFi network from the game seed using the shared `generateNetwork()` pipeline. Each WiFi provides a multi-layer network (easy: 2 machines, medium: 5-7, hard: 8-11) with a border router and optional inner gateways. Random difficulty per WiFi. Roles: webserver, database, fileserver, mailserver, iot, workstation, dns.
- **Mission machines** — procedurally generated per mission seed (independent of home networks).

All machine filesystems are generated at runtime and built via `fileSystemFactory.ts` with users, directories, and content. Common structure per machine: `/root/`, `/home/[users]/`, `/etc/` (passwd with MD5 hashes, hostname, hosts, configs), `/var/log/`, `/tmp/`. See `architecture.md` for the full filesystem permission model.

### Dynamic Connection Logs

When players connect to machines via SSH, FTP, or SCP, authentication events are logged to the target machine's filesystem in realistic Linux formats. `su` events are logged on the current machine. HTTP requests via `curl` log to the target's `/var/log/access.log`. Scan and brute-force commands (`nmap`, `gobuster`, `hydra`) write a single aggregate entry per completed sweep rather than one line per probed port / path / credential. Hydra additionally writes one normal auth-success line per cracked credential (indistinguishable from a legitimate login — defenders must correlate the aggregate with the success line to trace a breach).

| Log File              | Events                                                                  | Format                         |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `/var/log/auth.log`   | SSH, SCP, su (success/fail) + hydra ssh aggregates & forged successes   | Syslog                         |
| `/var/log/vsftpd.log` | FTP connect/login + hydra ftp aggregates & forged successes             | vsftpd                         |
| `/var/log/access.log` | HTTP requests (curl) + gobuster aggregates                              | Apache Combined / mod_security |
| `/var/log/mysql.log`  | MySQL connect/denied + hydra mysql aggregates & forged Connect lines    | MySQL general log              |
| `/var/log/redis.log`  | Redis auth events + hydra redis aggregates & forged authenticated lines | Redis                          |
| `/var/log/syslog`     | nc connect + hydra snmp aggregates & per-discovered-community lines     | Syslog                         |
| `/var/log/kern.log`   | nmap scan aggregates                                                    | iptables LOG                   |

Log files are created dynamically on first event (not pre-populated). They persist via IndexedDB patches and are world-readable. See `src/logging/README.md` for implementation details and `architecture.md` for integration.

**Multiplayer note (Phase 5):** writes to any path under `/var/log/...` bypass the server-side L1 patch-validation gate. Recon actions (nmap, curl, hydra, ssh-fail) leave logs on machines the actor doesn't have a session on — that's the gameplay (the network records probes as a side effect). L1 was designed for "I logged in, I'm mutating this machine" writes; ambient log appends are a different write class. The bypass is path-prefix based and server-controlled — clients can't smuggle non-log writes through it. See `src/patchRegistry/README.md` for the gate flow.

## Network Topology

There is no static LAN. All network machines come from procedurally generated home networks (per WiFi connection) and mission networks. Localhost starts disconnected (wlan0 DOWN) until the player cracks a WiFi network.

Both home networks and mission networks use the same multi-layer subnet topology and share building blocks (topology, users, enrichment, filesystem helpers). Home networks get a random difficulty per WiFi (easy: 1 layer/2 machines, medium: 2 layers/5-7 machines, hard: 3 layers/8-11 machines) and use the shared `generateNetwork()` pipeline. Mission networks derive difficulty from the seed and have their own orchestration for PRNG sequence stability.

## Network Implementation

Network is per-machine — `NetworkContext` uses `session.machine` to resolve the active config. Each machine has its own interfaces, reachable machines, and DNS records. Types are in `src/network/types.ts`. Network resolution priority: mission config → home network config → WiFi gate (disconnected).

`NetworkContext` accepts a `homeNetwork` prop from `useHomeNetworks`. Home networks now use the same layered topology as missions, so `NetworkContext` handles gateway iptables/SNMP parsing and layer-aware localhost visibility for both network types. When connected to a WiFi, localhost sees that network's layer 0 machines with a dynamic wlan0 IP from the subnet. Deeper layers are only reachable through gateways. When disconnected (`connectedWifi === null`), localhost gets disconnected interfaces, empty machines, and empty DNS. WiFi commands in `src/hooks/useWifiCommands.ts` manage the connection flow; WiFi networks are generated from the game seed via `src/generation/generateWifi.ts`.

## Mission Network Topology

Mission networks use a multi-layer subnet topology. Every mission generates a border router between localhost and the internal mission network. Difficulty controls network depth via isolated subnet layers:

- **Easy (1 layer)**: 2 machines in a single subnet behind the border router
- **Medium (2 layers)**: 2 layers separated by a gateway machine (5-7 machines total including gateway)
- **Hard (3 layers)**: 3 layers with 2 gateways (8-11 machines total including gateways)

Each layer has its own private subnet and entry variant. Gateway machines are dual-homed router-role machines with interfaces in both adjacent subnets. Subnet isolation: machines in one layer can only see other machines in their own layer — only gateways bridge layers. The target is always in the deepest layer (except portforward, which targets layer 0).

```
localhost (<dynamic IP from home network subnet>)
  can see --> <public>.x.x.x (border router public IP only)

Border Router (<public>.x.x.x public / <layer0-subnet>.1 internal)
  Public IP first octet picked from: [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212]
  Internal subnet picked from RFC 1918: 10.x.x.0/24, 172.{16-31}.x.0/24, 192.168.{2-254}.0/24
  [forwarded mode]: NAT forwards entry ports --> layer 0 entry machine
  [router-first mode]: no forwarding, player hacks router first

Layer 0 (<layer0-subnet>.10, .11, ...) — 2-3 machines
  can see --> each other + border router internal IP
  CANNOT see --> deeper layers

Gateway (<layer0-subnet>.x / <layer1-subnet>.1) — dual-homed, bridges layers 0 and 1
  [medium/hard only]

Layer 1 (<layer1-subnet>.10, .11, ...) — 2-3 machines
  can see --> each other + gateway
  CANNOT see --> layer 0 or border router

Gateway (<layer1-subnet>.x / <layer2-subnet>.1) — bridges layers 1 and 2
  [hard only]

Layer 2 (<layer2-subnet>.10, .11, ...) — 2-3 machines (target here)
  can see --> each other + gateway
  CANNOT see --> earlier layers
```

### Router & Gateway Details

- Border router role: `'router'` — has its own users, filesystem, firewall rules, routing tables
- Infrastructure-only: never the mission target, but contains hints about internal machines
- Dual interfaces: `eth0` (public IP) + `eth1` (internal gateway)
- `/etc/hosts` lists internal machine hostnames and IPs
- `/var/log/firewall.log` shows iptables traffic logs
- Gateway machines: dual-homed machines with interfaces in both adjacent subnets; `/etc/hosts` lists downstream machines
- **Router gateways** (`role: 'router'`): `/etc/iptables/rules.v4` with forwarding rules; SNMP uses firewall OIDs (`firewallSSH`/`firewallHTTP`, values: `permit`/`deny`)
- **Switch gateways** (`role: 'switch'`): Managed Layer 3 switches with `/etc/switch/acl.conf` containing deny rules. No NAT — when ACLs are cleared, traffic reaches downstream IPs directly. SNMP uses ACL OIDs (`aclSSH`/`aclHTTP`, values: `allow`/`deny`). `sysDescr` shows `Cisco IOS L3 Switch`, interfaces show `GigabitEthernet`. Switch gateways: activated via `switch` seed keyword (missions) or ~40% PRNG roll (home networks). Border gateway is always a router.

### Network Modes

- **Forwarded** (easier): Router NATs entry machine ports to its public IP. Player connects to public IP and transparently lands on internal machine. Easy difficulty has 70% chance, medium 50%.
- **Router-first** (harder): No forwarding. Player must hack the router to reach internal machines. Hard difficulty always uses this mode for the border router. A credential placement on the router filesystem contains SSH credentials for the internal entry machine (so the player can reach it after hacking the router).
- **Inner layer thresholds**: Inner gateways roll independently per layer. Easy 70%, medium 50%, hard 30% forwarding chance. This creates variety in multi-layer pivoting — hard missions always start with a router-first border, but inner gateways may have pre-populated NAT rules.
- **SNMP variant** (router-first only): Router has all TCP ports filtered and SNMP (UDP 161) open. Player discovers SNMP via `nmap -sU`, uses `snmpwalk` with the RW community string to find leaked credentials and firewall OIDs, then `snmpset` to open the SSH port. See `mission-variations.md` for full SNMP attack chain details.

### Port Closures

PRNG-driven SSH/FTP port closures (~30% each, independent rolls) add lateral movement variety. At most one SSH and one FTP closure per network. Entry machine, router, and script_fix/sabotage objectives are protected. When SSH is closed on a non-entry machine, FTP port 21 is ensured open and a root-owned NC backdoor is guaranteed (existing backdoor upgraded or new one added). The player can use a `script_exec` vulnerability via `msfconsole(target, port, '/path/to/script.js')` to blindly inject a script that starts sshd or vsftpd on the target. A dual closure (~15%) closes both SSH and FTP, adding an NC backdoor with root owner.

### NAT Resolution

`NetworkContext.resolveNat(ip, port)` handles port-level translation from public IP + port to internal machine IP + port. Rules are parsed dynamically from `/etc/iptables/rules.v4` on the router's filesystem (`src/network/iptablesParser.ts`). Applied at three connection boundaries in `Terminal.tsx`: SSH login, FTP session, NC session.

In forwarded mode, the iptables file is pre-populated with forwarding rules. In router-first mode, it starts as an empty template — the player can add rules with `nano` after hacking the router. Changes take effect immediately on the next `nmap` scan or connection attempt. Format: `forward <public_port> to <internal_ip>:<port>`.

### SNMP Firewall State

For the SNMP entry variant, `NetworkContext` also reads `/etc/snmp/snmpd.conf` from the router's filesystem (same dynamic pattern as iptables). The `parseSnmpFirewallConfig()` parser (`src/network/snmpFirewallParser.ts`) extracts `firewallSSH` and `firewallHTTP` OID values. When `snmpset` changes `firewallSSH` from `deny` to `permit`, port 22 dynamically opens on the router. The `applySnmpFirewallOverrides()` function overlays these port state changes onto the router's `RemoteMachine` view.

### Basic SNMP on Non-SNMP-Variant Gateways

Inner gateways without the SNMP access variant have a difficulty-based PRNG chance of basic read-only SNMP: easy 80%, medium 60%, hard 40%. Basic SNMP provides `rocommunity public` only — no rw community, no credential leaks, no firewall/ACL OIDs. Reconnaissance value is `ifAddr.1`/`ifAddr.2` (dual-homed gateway discovery).

Probability of basic SNMP per non-SNMP-variant inner gateway:

| Difficulty | No SNMP | Read-only |
| ---------- | ------- | --------- |
| Easy       | 20%     | 80%       |
| Medium     | 40%     | 60%       |
| Hard       | 60%     | 40%       |

Note: easy missions have no inner gateways (single layer). Medium has 1, hard has 2.

Full SNMP configs (SNMP-variant gateways and border routers) also include `ifAddr.2` and have credential leaks via `nsExtendArgs`. UDP port 161 is dynamically added to the network config for all basic-SNMP gateways so `snmpwalk` can reach them.

### Pid File as Port-State Source of Truth

PID files at `/var/run/*.pid` are the **single source of truth** for whether a daemon-backed port is open. `applyDynamicOverrides` in `networkUtils.ts` reads every relevant pid file on each machine and derives port-state symmetrically: pid-file PRESENCE opens the matching port, pid-file ABSENCE forces it to `open: false`. The same semantics apply uniformly across ssh, ftp, nc backdoors, AND every infra service in `INFRA_PID_CONFIGS` (nginx, mysqld, redis-server, postgres, mongod, postfix, dovecot, mosquitto, named, snmpd, smbd, Xvnc, openvpn).

**Pid file formats:**

- `sshd:port=N` — `/var/run/sshd.pid` (consumed by `parseSshdState`).
- `vsftpd:port=N` — `/var/run/vsftpd.pid` (consumed by `parseFtpdState`).
- `nc:port=N,user=X,userType=T,home=P` — `/var/run/nc-<port>.pid`, per backdoor (consumed by `parseNcPidFiles`). Owner metadata lets a remote `nc()` connect land as the listener's user.
- `${binary}:port=${N}` — every infra pid file (consumed by `parseInfraDaemonState`). Multi-line content is supported: nginx serving both 80 and 443 ships a single `nginx.pid` with two lines (`/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443`). Services sharing a pid file (http/https/http-alt → nginx.pid; imap/imaps/pop3 → dovecot.pid) share fate — if the pid file is missing, all of them close.

**Player-driven daemon control**: the corresponding command writes the pid file at start (`sshd [port]`, `vsftpd [port]`, `nc -l <port>`, or `bash('/usr/sbin/<daemon>')` from an NC shell). All daemon commands are root-only (`/usr/sbin/`, `execute: ['root']`). `systemctl stop <service>` deletes the pid file to close the port.

**Generator-driven daemon stamping**: every machine that ships an open infra port must also ship the corresponding pid file at generation time, otherwise `applyDynamicOverrides` closes the port. `buildInfrastructurePidFiles(ports)` in `src/generation/filesystem/infraPidFiles.ts` is the canonical builder — it groups ports by daemon binary and emits one multi-line pid file per binary. Mission and home generators get this via `buildMachineConfig`; themed networks (techparts.io, findit.io) call `buildInfrastructurePidFiles` directly and merge into `extraDirectories` via `mergeFileNodeChildren`.

**Backdoor flow**: when `msfconsole` exploits a CVE with `backdoor_port_open` effect, it writes `/var/run/nc-<port>.pid` on the target — the exploit's "shell" is the same backdoor pid-file mechanism as `nc -l` on the player's own machine. NPC-baked backdoors (elite-service ports with an owner in the generator output) get their pid file from `buildNcBackdoorPidFiles` at generation time so cross-player `nc()` against an NPC backdoor can derive the listener's tier server-side.

## Version Overlay System

`/var/lib/dpkg/status` is the authoritative source for installed package versions on each machine. RFC-822 format with `Package:`, `Status:`, `Version:` fields per entry.

- **Seeding**: `buildInitialDpkgStatus(ports, firmwareVersion?)` writes one entry per running service at generation time. Router machines also get a `firmware` package entry.
- **Overlay**: `applyVersionOverlay(machine, readFileFromMachine)` transparently wraps `RemoteMachine` so `port.serviceVersion` reads come from dpkg/status if an overlay exists. Also sets `machine.firmwareVersion` from the firmware package entry.
- **Updates**: `setDpkgVersion(content, pkg, version)` modifies a single package in the file. Used by `apt upgrade` and `apt install pkg=version`.
- **Consumers**: `useNetworkCommands` applies the overlay to every machine read — nmap, msfconsole, and the exploit-logging callback all see overlay-aware views transparently.

## Procedural Version Timelines

Each service has a `VersionTemplate` (prefix, separator, startTuple) in `pools/serviceTemplates.ts`. The walker in `timeline/walker.ts` bumps the tuple forward with weighted-random bump types (80% patch, 15% minor, 5% major) and randomized day-gaps (3-14 days per `CVE_TIMING_CONFIG`). Each entry also carries a `patchDelay` drawn from `[minPatchDelayDays, maxPatchDelayDays]` via a side-PRNG — the number of days a fix waits after its predecessor's CVE drops.

- **Deterministic**: seeded PRNG keyed on service/vendor name. Same game always produces the same timeline.
- **Cadence**: ~43 CVEs/year/service. Across ~15 services, ~1 new CVE somewhere on the network every 13 hours.
- **Patch delay**: after a CVE publishes, its fix is not immediately available — `findLatestSafeVersion` returns `undefined` until `prev.publishedAt + prev.patchDelay <= gameTime`. The config invariant `minSafeWindowDays > maxPatchDelayDays` (asserted at module load) guarantees every released fix has a positive safe window.
- **Two-layer lookup** (`vulnerabilityLookup.ts`): hand-authored historical CVEs (39 entries, `publishedAt=0`) checked first, then procedural walker entries. Hand-authored CVEs have no patch delay — they are immediately fixable.
- **Generic walker**: `buildTimelineFromTemplate(template, prngKey, upTo, timing)` is reused by both service and firmware timelines — no duplication.

## Router Firmware

Each router gets a `firmwareVendor` (Cisco IOS, MikroTik RouterOS, DD-WRT, OpenWRT, pfSense, EdgeOS) at topology generation time via a derived PRNG keyed on the router's IP. Firmware has its own procedural timeline (`pools/routerFirmware.ts` + same walker).

- `findFirmwareCve(vendor, version, gameTime)` — firmware CVE lookup
- `findExploitableCve(machine, port, gameTime)` — layers service CVE over firmware CVE; used by msfconsole
- `apt upgrade firmware` patches the router's firmware package in `/var/lib/dpkg/status`

## System Libraries

Every machine ships with 8 shared libraries (`libpam`, `libcrypt`, `libsystemd`, `libreadline`, `libssl`, `libz`, `libxml2`, `libpcre`) as files in `/lib/<libname>.so` — root-owned, world-readable, not executable (matches real Linux). Each library has its own procedural CVE timeline via the same walker (`pools/systemLibraryTemplates.ts`). libc is intentionally omitted from v1 (blast radius too broad).

Pre-installed `/bin/` and `/usr/sbin/` commands map to libraries via a static manifest in `src/commands/libraryDeps.ts` — 17 commands across the 8 libraries. Libraries are treated as _thematic capability groupings_, not strict real-world dependency charts (e.g., `rm`/`chmod`/`ps` → libpcre because their thematic role is "pattern-driven ops," even though real `rm` just calls `unlink`).

- **Runtime check** — before any command with a `libraryDeps` entry runs, the dispatcher verifies every linked `.so` exists. Missing file → glibc-style dynamic-linker error, command refuses to start. `ldd <command>` exposes this for inspection.
- **Local exploitation** — `msfconsole --local <command>` resolves the command's libraries → checks for a live CVE via `findLibraryCve` → rolls an effect from the command's pool (`systemCommandEffects.ts`). The library carries the vulnerability; the command carries the effect. One libpcre CVE → `dir_list` via `ls`, `file_read` via `grep`, `file_write` via `rm`.
- **Meta-packages** — `auth-libs` (libpam + libcrypt), `crypto-libs` (libssl), `system-libs` (libsystemd + libreadline), `data-libs` (libz + libxml2 + libpcre). `apt upgrade <meta-package>` expands to its children. `apt list -u` renders meta-package rows with aggregated status (worst-status-wins).
- **Destruction** — `apt remove <library>` deletes `/lib/<lib>.so` and the dpkg entry. Subsequent invocations of any dependent command hit the runtime check and fail. Real destructive behaviour, same semantics as real apt.

## Game Time

Real-world clock anchored at first game start (`src/session/gameTime.ts`). `getGameTime()` returns elapsed game days. Persisted in localStorage.

- CVEs with `publishedAt > gameTime` are not yet live — this drives the treadmill.
- Offline accrual: leaving the game for a week = a week of CVE publications on return.
- `resetGameTime()` clears the anchor on permadeath / new game.

## Typed Vulnerability Effects

Each `Vulnerability` carries an `effect: VulnerabilityEffect` — a discriminated union of 8 kinds. The effect picker in `timeline/effectPicker.ts` assigns effects based on the service being exploited.

| Effect                           | Description                                                                                       | 3rd arg to msfconsole      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| `shell_limited(tier)`            | Restricted nc_prompt at effect tier                                                               | none                       |
| `shell_full(tier)`               | Real SSH-style session                                                                            | none                       |
| `file_read(tier)`                | Dump a target file (cross-player workstations route through `exploitRead` server endpoint)        | target path                |
| `dir_list(tier)`                 | List a target directory (cross-player workstations route through `exploitRead`)                   | target path                |
| `file_write(tier)`               | Upload attacker content to target                                                                 | `local:remote`             |
| `password_reset(tier)`           | Reset a user's password on target                                                                 | none                       |
| `backdoor_port_open(port, tier)` | Plant a persistent nc listener + install NAT forwards on the gateway chain out to the public edge | none                       |
| `script_exec(tier)`              | Run a player-written JS script on target                                                          | attacker-local script path |

Per-service distribution: SSH is the universal hammer; FTP gets read/write/list/backdoor (no shells); databases add password_reset + script_exec; web services add script_exec; VNC/OpenVPN/Modbus/DNS/MQTT get shell + backdoor only.

### Forced Effects (`Port.forcedEffect`)

Ports can carry an optional `forcedEffect?: VulnerabilityEffect` that overrides the vulnerability's natural effect. `findExploitableCve` checks this first — if set, it clones the natural vulnerability with the forced effect, or synthesizes a minimal stub if no natural CVE exists. Two consumers:

1. **Seed keywords** — `shell-limited`, `shell-full`, `file-read`, `dir-list`, `file-write`, `password-reset`, `backdoor-port`, `script-exec` + `tier-root`/`tier-user`/`tier-guest` force a specific effect on the target machine's first open non-SSH port.
2. **SSH closure enrichment** — `applyPortClosures` stamps `{ kind: 'script_exec', tier: 'root' }` on an open port when SSH is closed, ensuring the player can always inject a script to restart sshd.
