# CTF Design — Network & Filesystem

## WiFi Hacking Gate

Before the player can access the network from localhost, they must crack a WiFi network. This is a progression gate between flags 3 (root escalation) and flag 4 (network exploration) — it does not award a flag.

### WiFi Networks

| BSSID             | ESSID           | PWR (dBm) | CH  | ENC  | Crackable? | Reason           |
| ----------------- | --------------- | --------- | --- | ---- | ---------- | ---------------- |
| A4:CF:12:D3:8B:7A | JSHACK-CORP     | -42       | 6   | WPA2 | Yes        | Strong signal    |
| 8E:1F:64:A7:22:9C | NetGear-5G-Home | -71       | 11  | WPA3 | No         | WPA3 unsupported |
| D2:F0:B8:4E:91:C5 | FBI_Van_7       | -85       | 1   | WPA2 | No         | Signal too weak  |
| 00:11:22:33:44:55 | \<hidden\>      | -93       | 3   | WPA2 | No         | Signal too weak  |

**Password for JSHACK-CORP:** `cr4ck3d_w1f1`

### Player Flow

1. After finding flag 3, the hint says to check `ifconfig()` and `help()`
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

- WiFi state: `session.wifiConnected` (persisted to IndexedDB)
- Monitor mode: transient `useRef` in `useWifiCommands` hook (resets on page refresh)
- Localhost uses `wlan0` interface (not `eth0`) + `lo` loopback
- `NetworkContext` gates interfaces/machines/DNS when WiFi disconnected on localhost
- `useNetworkCommands` wraps network commands with WiFi connectivity check
- `nmcli` command (`src/commands/nmcli.ts`): connect/disconnect/status — `aircrack` only recovers the password, `nmcli` connects
- `nmcli("disconnect")` while SSH'd calls `SessionContext.disconnectWifi()` to atomically reset to localhost
- Hint file at `/home/jshacker/downloads/wifi_tools.txt` provides the aircrack + nmcli cheatsheet

## Per-Machine Filesystems

Each machine has its own filesystem defined in `src/filesystem/machines/`. Built via `fileSystemFactory.ts` with users, directories, and content.

| Machine    | IP            | Users                 | Purpose                                                        |
| ---------- | ------------- | --------------------- | -------------------------------------------------------------- |
| localhost  | 192.168.1.100 | jshacker, guest, root | Starting machine                                               |
| gateway    | 192.168.1.1   | admin                 | Router, config backups, dual-interface (WAN+LAN)               |
| fileserver | 192.168.1.50  | ftpuser, root         | FTP server with /srv/ftp                                       |
| webserver  | 192.168.1.75  | www-data, root        | Web server with /var/www                                       |
| darknet    | 203.0.113.42  | ghost, root           | Final flag + ROT13 challenge, dual-interface (public + hidden) |
| shadow     | 10.66.66.1    | operator, root        | Flag 14 debug challenge, FTP exports + diagnostics             |
| void       | 10.66.66.2    | dbadmin, root         | Flag 15 CSV extraction, maintenance port 9999                  |
| abyss      | 10.66.66.3    | phantom, root         | Flag 16 XOR cipher challenge, SSH only                         |

Common structure per machine: `/root/`, `/home/[users]/`, `/etc/` (passwd with MD5 hashes, hostname, hosts, configs), `/var/log/`, `/tmp/`. Noise files (dotfiles, configs, logs, red herrings) create realistic Linux environments. Noise files never contain `FLAG{` patterns.

## Network Topology

```
198.51.100.0/24 (Internet)
│
├── 198.51.100.10 ─── gateway eth0 (WAN)
│                     gateway eth1 (LAN) ─── 192.168.1.1
│                                             │
│                                        192.168.1.0/24 (Local LAN)
│                                             ├── 192.168.1.50  fileserver (eth0)
│                                             ├── 192.168.1.75  webserver (eth0)
│                                             └── 192.168.1.100 localhost (wlan0, requires WiFi crack)
│
└── 203.0.113.42 ─── darknet eth0 (Public)
                      darknet eth1 ─── 10.66.66.100
                                        │
                                   10.66.66.0/24 (Hidden Network)
                                        ├── 10.66.66.1  shadow
                                        ├── 10.66.66.2  void
                                        └── 10.66.66.3  abyss
```

## Reachability Rules

- LAN machines reach each other + darknet (via gateway NAT)
- Darknet sees ONLY gateway's WAN IP (198.51.100.10) + hidden network — cannot route to 192.168.1.x
- Hidden machines only reach each other + darknet's eth1 (10.66.66.100)

## DNS Records

LAN + Darknet DNS (available to localhost, gateway, fileserver, webserver):

- gateway.local → 192.168.1.1
- fileserver.local → 192.168.1.50
- webserver.local → 192.168.1.75
- darknet.ctf / www.darknet.ctf → 203.0.113.42

Hidden DNS (available to darknet, shadow, void, abyss):

- shadow.hidden → 10.66.66.1
- void.hidden → 10.66.66.2
- abyss.hidden → 10.66.66.3

## Network Implementation

Network is per-machine — `NetworkContext` uses `session.machine` to resolve the active config. Each machine has its own interfaces, reachable machines, and DNS records defined in `src/network/initialNetwork.ts`. Types are in `src/network/types.ts`.

Localhost has a special WiFi gating layer: when `session.wifiConnected === false`, `NetworkContext` overrides localhost's config to return disconnected interfaces (wlan0 DOWN), empty machines, and empty DNS. WiFi commands (`airmon`, `airdump`, `aircrack`, `nmcli`) in `src/hooks/useWifiCommands.ts` manage the connection flow. WiFi network definitions live in `src/network/wifiNetworks.ts`.
