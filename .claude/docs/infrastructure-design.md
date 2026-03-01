# Infrastructure Design — Network & Filesystem

## WiFi Hacking Gate

Before the player can access the network from localhost, they must crack a WiFi network. This is a progression gate before network access — it does not award a flag.

### WiFi Networks

| BSSID             | ESSID           | PWR (dBm) | CH  | ENC  | Crackable? | Reason           |
| ----------------- | --------------- | --------- | --- | ---- | ---------- | ---------------- |
| A4:CF:12:D3:8B:7A | JSHACK-CORP     | -42       | 6   | WPA2 | Yes        | Strong signal    |
| 8E:1F:64:A7:22:9C | NetGear-5G-Home | -71       | 11  | WPA3 | No         | WPA3 unsupported |
| D2:F0:B8:4E:91:C5 | FBI_Van_7       | -85       | 1   | WPA2 | No         | Signal too weak  |
| 00:11:22:33:44:55 | \<hidden\>      | -93       | 3   | WPA2 | No         | Signal too weak  |

**Password for JSHACK-CORP:** `cr4ck3d_w1f1`

### Player Flow

1. After gaining root access, the player can explore — `ifconfig()` and `help()` reveal next steps
2. `ifconfig()` shows `wlan0` is DOWN (no IP assigned)
3. Network commands (ping, nmap, ssh, etc.) fail with `"Network is unreachable"`
4. Player discovers aircrack commands via `help()` or `~/downloads/wifi_tools.txt`
5. `airmon("start", "wlan0")` — enables monitor mode
6. `airdump()` — scans and displays nearby WiFi networks (async output)
7. `aircrack("A4:CF:12:D3:8B:7A")` — cracks JSHACK-CORP, shows `KEY FOUND!` + nmcli hint
8. `nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")` — connects to WiFi
9. On success: `ifconfig()` shows wlan0 UP with IP 192.168.1.100, all network commands work
10. Later: `nmcli("disconnect")` drops WiFi (even from remote machines — returns to localhost)

### Implementation

- WiFi state: standalone `wifiConnected` state in `SessionProvider` (persisted to IndexedDB)
- Monitor mode: transient `useRef` in `useWifiCommands` hook (resets on page refresh)
- Localhost uses `wlan0` interface (not `eth0`) + `lo` loopback
- `NetworkContext` gates interfaces/machines/DNS when WiFi disconnected on localhost
- `useNetworkCommands` wraps network commands with WiFi connectivity check
- `nmcli` command (`src/commands/nmcli.ts`): connect/disconnect/status — `aircrack` only recovers the password, `nmcli` connects
- `nmcli("disconnect")` while SSH'd calls `SessionContext.disconnectWifi()` to atomically reset to localhost
- Hint file at `/home/jshacker/downloads/wifi_tools.txt` provides the aircrack + nmcli cheatsheet

## Static Machines

Four static machines exist. All other machines are procedurally generated per mission.

- **localhost** (192.168.1.100) — the player's starting machine (users: jshacker, guest, root)
- **gateway** (192.168.1.1) — local network router, config backups, dual-interface WAN+LAN (users: admin)
- **fileserver** (192.168.1.50) — FTP/SSH file server for practice (users: root, ftpuser, guest); ports 21/ftp + 22/ssh
- **webserver** (192.168.1.75) — web server with NC backdoor for practice (users: root, www-data, guest); ports 22/ssh + 80/http + 3306/mysql + 4444/elite

Machine filesystems are defined in `src/filesystem/machines/` and built via `fileSystemFactory.ts` with users, directories, and content. Common structure per machine: `/root/`, `/home/[users]/`, `/etc/` (passwd with MD5 hashes, hostname, hosts, configs), `/var/log/`, `/tmp/`.

## Network Topology

```
192.168.1.0/24 (Local LAN)
├── 192.168.1.1   gateway (eth0 LAN / eth1 WAN)
├── 192.168.1.50  fileserver (eth0 LAN, FTP + SSH)
├── 192.168.1.75  webserver (eth0 LAN, SSH + HTTP + MySQL + backdoor:4444)
└── 192.168.1.100 localhost (wlan0, requires WiFi crack)
```

Mission networks extend beyond the gateway — see "Mission Network Topology" below.

## DNS Records

- gateway.local → 192.168.1.1
- fileserver.local → 192.168.1.50
- webserver.local → 192.168.1.75

## Network Implementation

Network is per-machine — `NetworkContext` uses `session.machine` to resolve the active config. Each machine has its own interfaces, reachable machines, and DNS records defined in `src/network/initialNetwork.ts`. Types are in `src/network/types.ts`. Static machines are localhost, gateway, fileserver, and webserver; all other machines are generated per mission.

Localhost has a special WiFi gating layer: when `wifiConnected === false`, `NetworkContext` overrides localhost's config to return disconnected interfaces (wlan0 DOWN), empty machines, and empty DNS. WiFi commands (`airmon`, `airdump`, `aircrack`, `nmcli`) in `src/hooks/useWifiCommands.ts` manage the connection flow. WiFi network definitions live in `src/network/wifiNetworks.ts`.

## Mission Network Topology

Mission networks use a realistic router topology. Every mission generates a border router between localhost and the internal mission network.

```
localhost (192.168.1.100)
  can see --> <public>.x.x.x (router public IP only)

Router (<public>.x.x.x public / <private>.x.x.1 internal) — real machine with filesystem
  Public IP first octet picked from: [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212]
  Internal subnet picked from RFC 1918: 10.x.x.0/24, 172.{16-31}.x.0/24, 192.168.{2-254}.0/24
  [forwarded mode]: NAT forwards entry ports --> <private>.x.x.10 (entry/DMZ)
  [router-first mode]: no forwarding, player hacks router first

Entry/DMZ (<private>.x.x.10)
  can see --> <private>.x.x.11, <private>.x.x.12 (internal machines)

Internal (<private>.x.x.11, <private>.x.x.12)
  can see --> each other + entry + router internal IP (<private>.x.x.1)
  CANNOT see --> router public IP or localhost
```

### Router Details

- Role: `'router'` — has its own users, filesystem, firewall rules, routing tables
- Infrastructure-only: never the mission target, but contains hints about internal machines
- Dual interfaces: `eth0` (public IP) + `eth1` (internal gateway)
- `/etc/hosts` lists internal machine hostnames and IPs
- `/var/log/firewall.log` shows iptables traffic logs

### Network Modes

- **Forwarded** (easier): Router NATs entry machine ports to its public IP. Player connects to public IP and transparently lands on internal machine. Easy difficulty has 70% chance, medium 50%.
- **Router-first** (harder): No forwarding. Player must hack the router to reach internal machines. Hard difficulty always uses this mode. A credential placement on the router filesystem contains SSH credentials for the internal entry machine (so the player can reach it after hacking the router).

### NAT Resolution

`NetworkContext.resolveNat(ip)` handles the translation from public to internal IPs. Applied at three connection boundaries in `Terminal.tsx`: SSH login, FTP session, NC session.
