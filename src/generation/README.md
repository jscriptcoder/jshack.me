# Seeded Network Generators

Deterministic engines that generate all game content from seed strings and game state. Same seed always produces identical output. Pure generation pipelines — React integration lives in `src/mission/` (missions) and `src/game/` (home networks). Localhost is also generated at runtime via `generateLocalhost(gameState)`.

Missions and home networks share building blocks: topology (`topology.ts`), users (`users.ts`), enrichment (`enrichment.ts`), and filesystem helpers (`filesystem/`). Home networks use the shared `generateNetwork()` pipeline (`generateNetwork.ts`) that composes these. Missions have their own orchestration for PRNG sequence stability but import enrichment functions from the shared module.

## Usage

```typescript
import { generateMissionNetwork } from './generateMission';

const mission = generateMissionNetwork('HEIST-7734');
// mission.machines     — generated machines with roles, ports, users
// mission.fileSystems  — FileNode tree per machine (keyed by IP)
// mission.networkConfig — NetworkConfig compatible with existing NetworkContext
// mission.objective    — mission goal (type, target, expectedProof, clientEmail)
// mission.clientEmail  — client email for mail() completion
```

## Pipeline

### Shared Pipeline (`generateNetwork.ts`)

Home networks use `generateNetwork(options)`, which runs these steps (missions share the same building blocks but have their own orchestration for PRNG sequence stability):

1. **PRNG** (`prng.ts`) — Mulberry32 seeded via FNV-1a hash of the seed string
2. **Topology** (`topology.ts`) — Multi-layer subnet topology with per-difficulty layer count (easy: 1, medium: 2, hard: 3), machine roles, IPs, interfaces, DNS, per-layer entry variant selection (ssh/ftp/nc/exploit/http/snmp)
3. **Users** (`users.ts`) — Root + 1-2 role-appropriate users per machine, md5-hashed passwords. Root passwords always from `MISSION_PASSWORDS` (never in hydra's wordlist). Regular user passwords from `WORDLIST_PASSWORDS` (crackable via hydra) on most machines, except FTP-entry machines where they come from `MISSION_PASSWORDS` (not crackable — forces FTP recon). Guest passwords from `guestPasswords` pool.
4. **Enrichment** (`enrichment.ts`) — NC/exploit/FTP port owner assignment with weighted PRNG distribution
5. **Port Closures** (`enrichment.ts: applyPortClosures`) — ~30% SSH/FTP closures with NC backdoor fallbacks
6. **Config Updates** — Merge users and port closures into network configs
7. **Base Filesystems** — Role configs, credential leaks, web content, SNMP configs (full for SNMP-variant, basic read-only via difficulty-based PRNG roll for others), iptables rules, PID files, DNS zone files (for dns-role machines)

### Mission Pipeline (`generateMission.ts`)

`generateMissionNetwork(seed, usedIps?)` has its own orchestration (imports `enrichMachineWithUsers` and `applyPortClosures` from `enrichment.ts`) for PRNG sequence stability, then adds mission-specific steps:

- **Objective** (`attackChain.ts`) — Objective generation (exfiltrate with ACCESS-KEY, tamper with old/new values, credential_theft with root password, script_fix with broken script + bug type, script_auto with write-from-scratch automation script, sabotage with machine bricking, backdoor with nc listener, portforward with iptables rule, malware with malicious script/binary + PID file), client email generation
- **Filesystems** (`filesystem/`) — FileNode trees with role configs, noise, target file at dynamic path with thematic content. Web content generation for machines with open HTTP ports. HTTP entry variant places SSH credentials in `/var/www/html/` (body-based or `.headers` sidecar). `/bin/` is populated with system utility binaries; `/usr/bin/` is left empty (players must `apt install` tools). Gateways get `/etc/iptables/rules.v4` — pre-populated with forwarding rules in forwarded mode, empty template in router-first mode. Border router is always router-first on hard; inner gateways have 30% forwarding chance on hard. SNMP variant routers get `/etc/snmp/snmpd.conf` with community strings, system OIDs, leaked credentials, and firewall OIDs. Non-SNMP-variant inner gateways have a difficulty-based chance (easy 80%, medium 60%, hard 40%) of basic read-only SNMP (`rocommunity public` only, `ifAddr.1`/`ifAddr.2` for subnet discovery, no credential leaks or firewall OIDs). All SNMP configs include `ifAddr.2` to reveal dual-homed subnets.
- **Binary Wrapping** (`binary.ts`) — Optional binary noise wrapping for target/key files

### Home Network Pipeline (`generateHomeNetwork.ts`)

`generateHomeNetwork(gameSeed, wifiIndex, essid, usedIps?)` calls `generateNetwork()` (with base filesystems enabled), then adds:

- **Difficulty** — Random per WiFi (equal probability easy/medium/hard)
- **Gateway .1 Aliases** — Router and inner gateway configs/filesystems aliased under their downstream `.1` IPs so players can SSH into gateways from inside the network

## Files

| File                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prng.ts`                | Mulberry32 PRNG: next, nextInt, pick, pickN, shuffle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `types.ts`               | MissionNetwork, GeneratedMachine, EntryVariant, MissionObjective                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pools/`                 | Static data split by domain: machines (usernames, passwords, hostnames, handles), ports (port/entry templates, SNMP), vulnerabilities (templates + default versions), serviceTemplates (version templates for 20 services), routerFirmware (firmware templates for 6 vendors), filesystem (configs, noise, target/tamper files, key placements), web content, credentials (leak/HTTP entry templates), scripts (fix templates), scriptAuto (automation templates), forensics (evidence pools), malware (malware templates per role), database (table templates, tamper/fix scenarios, sabotage targets) |
| `ip.ts`                  | Shared IP utilities: `generatePublicIp(prng, usedIps?)`, `generatePrivateSubnet(prng)`, `publicFirstOctets`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `topology.ts`            | Network topology generator (machines, roles, entry variant, NetworkConfig); uses `ip.ts` for IP generation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `users.ts`               | Per-machine users + plaintext credential map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `enrichment.ts`          | Machine enrichment: NC/exploit/FTP port owner assignment, port closures (~30% SSH/FTP with NC fallbacks); extracted from `generateMission.ts` for shared use                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ftpCredentials.ts`      | FTP virtual user credential generation. Generates separate FTP passwords from `WORDLIST_PASSWORDS`, formats/parses `/etc/vsftpd/virtual_users.conf` (`username:md5hash` per line). FTP-entry machines always get virtual users; ~40% of other FTP-open machines get them for variety                                                                                                                                                                                                                                                                                                                    |
| `generateNetwork.ts`     | Shared pipeline: topology → users → enrichment → port closures → config updates → base filesystems; used by home networks                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `attackChain.ts`         | Objective generation (exfiltrate/tamper/credential_theft/script_fix/sabotage/backdoor/portforward/malware/db_exfiltrate/db_tamper/db_sabotage/db_fix), client email                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `generateDatabase.ts`    | MySQL database generator + MySQL credentials (separate from system users) + mission enrichment functions (inject ACCESS-KEY, tamper/fix scenarios, sabotage targets into generated databases). Returns `GenerateDatabaseResult` with both the database and plaintext credentials for leak templates                                                                                                                                                                                                                                                                                                     |
| `generateRedisData.ts`   | Redis key-value data generator for machines with port 6379 open. Generates `/var/lib/redis/data.json` (key-value store) and `/etc/redis/redis.conf` (with optional `requirepass`). ~35% of database machines get Redis                                                                                                                                                                                                                                                                                                                                                                                  |
| `binary.ts`              | Binary noise wrapping for target files, binary file path pools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `filesystem/`            | FileNode trees via createFileSystem(), split into: `helpers.ts` (mkFile, mkDir, template/tree utilities), `networkConfig.ts` (SNMP, ACL, iptables generators), `forensicsEvidence.ts` (forensics log generation + calling cards), `machineConfig.ts` (single-machine filesystem builder), `generateFileSystems.ts` (multi-machine orchestrator)                                                                                                                                                                                                                                                         |
| `generateMission.ts`     | Mission orchestrator: own pipeline (imports enrichment.ts) + objective, attack chain, custom filesystems, binary wrapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `generateLocalhost.ts`   | Localhost filesystem generation from `GameState` — player username, root password, seed-derived guest password, `README.txt` guide, hint files, pre-installed tools                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `generateWifi.ts`        | WiFi network generation from game seed — 2-3 crackable WPA2 + 3-5 noise (WPA3/weak/hidden). Passwords from encoded secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `generateHomeNetwork.ts` | Home network generation: calls `generateNetwork()` with random difficulty (easy/medium/hard per WiFi), adds gateway .1 IP aliases for internal reachability                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `vulnerabilityLookup.ts` | `findVulnForService(service, version, gameTime)` — two-layer CVE lookup: hand-authored historical CVEs first, then procedural walker fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `firmwareLookup.ts`      | `findFirmwareCve(vendor, version, gameTime)`, `findLatestSafeFirmware(vendor, gameTime)`, `findPinnableFirmwareVersion(vendor, version, gameTime)` — router firmware CVE lookup via the same walker infrastructure                                                                                                                                                                                                                                                                                                                                                                                      |
| `findExploitableCve.ts`  | `findExploitableCve(machine, port, gameTime)` — layered exploit lookup: service CVE first, firmware CVE fallback for routers. Used by msfconsole                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `timeline/`              | Procedural version timeline generator — deterministic CVE generation from service/firmware version templates. See [Timeline Pipeline](#timeline-pipeline) below                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Credential Leaks & Lateral Movement

Three types of credential leaks are placed during filesystem generation in `machineConfig.ts`:

- **Same-machine credential leaks** (~30% per machine) — Guest-owned files containing a non-root user's credentials. Placed in realistic locations (backup scripts, config files, deploy logs). DB-themed templates use MySQL credentials when available. Templates in `credentialLeakTemplates` (`src/generation/pools/credentials.ts`). Always consumes 2 PRNG calls for stability.
- **Cross-machine credential leaks** (~30% per non-target machine) — Root/user-owned files referencing a same-layer peer machine's credentials. Requires privilege escalation to discover (not world-readable). Templates include deploy scripts, ansible inventories, `.ssh/config`, backup crons, `.bash_history` with ssh commands. Uses `crossMachineCredentialLeakTemplates` with `{{target_ip}}`, `{{target_username}}`, `{{target_password}}` placeholders. Layer mapping via `buildSameLayerCredentials()` in `src/generation/filesystem/sameLayerCredentials.ts`. Always consumes 3 PRNG calls. Skipped on target machines.
- **Web credential exposure** (~30% on non-HTTP-entry machines with open HTTP/HTTPS/HTTP-ALT ports) — Same-machine credentials placed in `/var/www/html/` discoverable via curl/gobuster. Supports body-based (creds in file content) and header-based (`.headers` sidecar, requires `curl -i`). Uses `webCredentialTemplates`. HTTP-entry machines use `httpEntryCredentialTemplates` instead (100% placement). Always consumes 2 PRNG calls.

## Difficulty

Derived from the seed string (or explicit keywords):

- **easy** — 1 subnet layer, 2 machines
- **medium** — 2 subnet layers with 1 gateway, 2-3 machines per layer, 5-7 total
- **hard** — 3 subnet layers with 2 gateways, 2-3 machines per layer, 8-11 total

Seeds containing "easy", "medium", or "hard" force that difficulty; otherwise derived from a hash of the seed. See "Seed Keywords" below for controlling other axes.

## Machine Roles

| Role        | Ports        | Typical users       |
| ----------- | ------------ | ------------------- |
| webserver   | 22, 80, 443  | www-data, webadmin  |
| database    | 22, 3306     | dbadmin, mysql      |
| fileserver  | 21, 22       | ftpuser, backup     |
| mailserver  | 22, 25, 143  | postmaster, mailadm |
| iot         | 22, 80, 1883 | admin, device       |
| dns         | 22, 53, 953  | dnsadmin, bind      |
| workstation | 22           | jsmith, developer   |
| router      | 22, 80       | netops, routeadm    |
| switch      | 22, 80, 161  | netadmin, switchadm |

## Output Types

All output types are compatible with the existing codebase:

- `MissionNetwork.networkConfig` matches `NetworkConfig` from `src/network/types.ts`
- `MissionNetwork.fileSystems` values are `FileNode` trees from `src/filesystem/types.ts`
- `GeneratedMachine.remoteMachine` matches `RemoteMachine` from `src/network/types.ts`
- `MissionNetwork.entryVariant` indicates the initial access method (ssh/ftp/nc/exploit/http)
- `MissionNetwork.layers` is `readonly SubnetLayer[]` — per-layer topology with machines, subnet, and entry variant

## Entry Variants

The entry machine's initial access method varies per seed:

- **ssh** — classic SSH; ports: 22, 80
- **ftp** — player FTPs in to explore files; ports: 21, 22
- **nc** — player connects via netcat backdoor; ports: 22, (4444|31337|8888|1337)
- **exploit** — player scans with `nmap("-sV")` to find vulnerable service, runs `msfconsole(host, port)` for restricted shell; ports: 22, (80|3306|6379)
- **http** — player discovers port 80 via nmap, uses `curl` to explore web content; ports: 22, 80

NC, exploit, and FTP variants select a variable owner type via PRNG: guest (60%), user (30%), or root (10%). NC backdoors exclude root (remapped to user) since backdoors are planted by attackers, not by root on their own machine. This adds difficulty variety — guest owners have limited file visibility, while root owners can read root-only files.

## Seed Keywords

Players and developers can embed keywords in the seed string to control generation axes. Keywords are case-insensitive and matched via `includes()`. `parseSeedOverrides(seed)` extracts all overrides in one pass.

| Axis          | Keywords                                                                                                                               | Notes                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                                                                                                               | Same as before, now unified in parser                                                                                        |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`, `http`                                                                                                  | Falls back if template unavailable (e.g. nc+router-first)                                                                    |
| Network mode  | `forwarded`, `router-first`                                                                                                            | Hyphenated to avoid false matches                                                                                            |
| Objective     | `exfiltrate`, `tamper`, `credential-theft`, `script-fix`, `script-auto`, `sabotage`, `backdoor`, `portforward`, `forensics`, `malware` | Hyphen variant for credential_theft / script_fix / script_auto; portforward forces router-first; forensics/malware force SSH |
| Encryption    | `gpg`                                                                                                                                  | Forces exfiltrate + encrypted target file                                                                                    |
| Gateway type  | `switch`                                                                                                                               | Forces inner gateways to be managed L3 switches (ACLs instead of NAT)                                                        |

Example seeds: `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`, `test-exploit-router-first`, `IRONGATE-nc-gpg-22`, `test-switch-snmp-hard`

PRNG sequence is preserved when overrides are active — the PRNG call is always consumed, but its result is discarded in favor of the override. Seeds without keywords produce identical networks as before.

## Encrypted Exfiltrate

Exfiltrate objectives have a ~25% chance (or 100% with `gpg` keyword) of encrypting the target file. The decryption key is placed on a different machine in the attack path (~25% chance of binary wrapping). Players must find the key, escalate to root, and use `gpg(file, key)` to reveal the ACCESS-KEY. The encryption uses a deterministic XOR+FNV-1a checksum scheme (`src/utils/crypto.ts`) — same key always produces identical ciphertext.

## Binary File Wrapping

Some exfiltrate targets (~25%) and encryption keys (~25%) are wrapped in binary noise. `cat` shows garbled output; `strings` extracts the readable data. Binary files use deep paths that look like compiled binaries (e.g., `/opt/app/data.bin`, `/var/lib/export.dat`). See `binary.ts` for the wrapping utility and path pools.

## Vulnerability Lookup

CVE resolution uses a two-layer architecture introduced during the vulnerability rework:

1. **Hand-authored CVEs** (`pools/vulnerabilities.ts`) — 39 `VulnerabilityTemplate` entries for historical CVEs. Checked first for exact service+version matches. Also exports `DEFAULT_SERVICE_VERSION` and `defaultServiceVersion` helper.
2. **Procedural walker** (`timeline/`) — deterministic version timeline generation that produces CVEs for any service/version/gameTime combination. Used as fallback when no hand-authored CVE matches.

Lookup entry points:

- `findVulnForService(service, version, gameTime)` (`vulnerabilityLookup.ts`) — primary service CVE lookup. Tries hand-authored templates, then procedural walker.
- `findFirmwareCve(vendor, version, gameTime)` (`firmwareLookup.ts`) — router firmware CVE lookup via walker infrastructure. Also provides `findLatestSafeFirmware` and `findPinnableFirmwareVersion` for defense/patching logic.
- `findExploitableCve(machine, port, gameTime)` (`findExploitableCve.ts`) — top-level exploit resolution used by msfconsole. Tries service CVE first, falls back to firmware CVE for routers.

## Timeline Pipeline

The `timeline/` directory implements a procedural version timeline generator that produces deterministic CVEs from version templates. This powers the second layer of vulnerability lookup — when no hand-authored CVE matches, the walker generates one.

### Timeline Files

| File               | Purpose                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `walker.ts`        | `buildTimelineFromTemplate` — walks a `VersionTemplate` forward with weighted-random bump types (80% patch, 15% minor, 5% major) and randomized day-gaps. Also exports `buildTimeline` (service-specific wrapper), `findLatestSafeVersion`, `findGeneratedVersion` |
| `generatedVuln.ts` | `buildGeneratedVuln(service, entry)` — constructs a deterministic `Vulnerability` from a walker entry (CVE id, severity, attack pattern, effect)                                                                                                                   |
| `effectPicker.ts`  | Per-service effect distribution. Picks one of 8 `VulnerabilityEffect` kinds based on the service (SSH = universal hammer, FTP = read/write/list/backdoor only, databases add password_reset + script_exec, etc.)                                                   |
| `config.ts`        | `CVE_TIMING_CONFIG` (minSafeWindowDays: 3, maxSafeWindowDays: 14), `DEFAULT_LATEST_VERSION`, `getLatestSafeVersion(service, gameTime)`                                                                                                                             |
| `index.ts`         | Barrel re-exports                                                                                                                                                                                                                                                  |

### Pool Data for Timelines

| File                        | Purpose                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pools/serviceTemplates.ts` | `VersionTemplate` type + `serviceTemplates` record (20 services) + `formatVersion`. Template data providing base versions and naming for the walker |
| `pools/routerFirmware.ts`   | `FirmwareVendor` type, `firmwareTemplates` (6 vendors: Cisco, MikroTik, DD-WRT, OpenWRT, pfSense, EdgeOS), `FIRMWARE_VENDORS` list                  |
