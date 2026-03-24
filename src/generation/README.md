# Seeded Network Generators

Deterministic engines that generate all game content from seed strings and game state. Same seed always produces identical output. Pure generation pipelines — React integration lives in `src/mission/` (missions) and `src/game/` (home networks). Localhost is also generated at runtime via `generateLocalhost(gameState)`.

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

`generateMissionNetwork(seed, usedIps?)` runs these steps sequentially, each consuming from the same PRNG stream:

1. **PRNG** (`prng.ts`) — Mulberry32 seeded via FNV-1a hash of the seed string
2. **Topology** (`topology.ts`) — Flat subnet, machine count by difficulty, roles, IPs, interfaces, DNS, entry variant selection (ssh/ftp/nc/exploit/http/snmp)
3. **Users** (`users.ts`) — Root + 1-2 role-appropriate users per machine, md5-hashed passwords. Guest passwords picked from `guestPasswords` pool (not hardcoded).
4. **Objective** (`attackChain.ts`) — Objective generation (exfiltrate with ACCESS-KEY, tamper with old/new values, credential_theft with root password, script_fix with broken script + bug type, sabotage with machine bricking, backdoor with nc listener, portforward with iptables rule), client email generation
5. **Filesystems** (`filesystem.ts`) — FileNode trees with role configs, noise, target file at dynamic path with thematic content. Web content generation for machines with open HTTP ports. HTTP entry variant places SSH credentials in `/var/www/html/` (body-based or `.headers` sidecar). `/bin/` is populated with system utility binaries; `/usr/bin/` is left empty (players must `apt install` tools). Router gets `/etc/iptables/rules.v4` — pre-populated with forwarding rules in forwarded mode, empty template in router-first mode. SNMP variant routers get `/etc/snmp/snmpd.conf` with community strings, system OIDs, leaked credentials, and firewall OIDs.

## Files

| File                     | Purpose                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prng.ts`                | Mulberry32 PRNG: next, nextInt, pick, pickN, shuffle                                                                                                                                      |
| `types.ts`               | MissionNetwork, GeneratedMachine, EntryVariant, MissionObjective                                                                                                                          |
| `pools.ts`               | Static data: usernames, passwords, guest passwords, hostnames, client handles, vulnerability/port/entry templates, target/tamper/script-fix file templates by role, web content templates |
| `ip.ts`                  | Shared IP utilities: `generatePublicIp(prng, usedIps?)`, `generatePrivateSubnet(prng)`, `publicFirstOctets`                                                                               |
| `topology.ts`            | Network topology generator (machines, roles, entry variant, NetworkConfig); uses `ip.ts` for IP generation                                                                                |
| `users.ts`               | Per-machine users + plaintext credential map                                                                                                                                              |
| `attackChain.ts`         | Objective generation (exfiltrate/tamper/credential_theft/script_fix/sabotage/backdoor/portforward), client email                                                                          |
| `binary.ts`              | Binary noise wrapping for target files, binary file path pools                                                                                                                            |
| `filesystem.ts`          | FileNode trees via createFileSystem(), noise, dynamic target file placement, router iptables rules                                                                                        |
| `generateMission.ts`     | Orchestrator composing all mission generation steps                                                                                                                                       |
| `generateLocalhost.ts`   | Localhost filesystem generation from `GameState` — player username, root password, seed-derived guest password, `README.txt` guide, hint files, pre-installed tools                       |
| `generateWifi.ts`        | WiFi network generation from game seed — 2-3 crackable WPA2 + 3-5 noise (WPA3/weak/hidden). Passwords from encoded secrets.                                                               |
| `generateHomeNetwork.ts` | Home network generation from game seed + WiFi index — router (unique public IP via `usedIps`) + 2-4 machines with roles, users, ports, filesystems                                        |

## Difficulty

Derived from the seed string (or explicit keywords):

- **easy** — 2 machines, 1 hop to target
- **medium** — 3-4 machines, up to 2 hops
- **hard** — 4-6 machines, full chain

Seeds containing "easy", "medium", or "hard" force that difficulty; otherwise derived from a hash of the seed. See "Seed Keywords" below for controlling other axes.

## Machine Roles

| Role        | Ports        | Typical users       |
| ----------- | ------------ | ------------------- |
| webserver   | 22, 80, 443  | www-data, webadmin  |
| database    | 22, 3306     | dbadmin, mysql      |
| fileserver  | 21, 22       | ftpuser, backup     |
| mailserver  | 22, 25, 143  | postmaster, mailadm |
| iot         | 22, 80, 1883 | admin, device       |
| workstation | 22           | jsmith, developer   |

## Output Types

All output types are compatible with the existing codebase:

- `MissionNetwork.networkConfig` matches `NetworkConfig` from `src/network/types.ts`
- `MissionNetwork.fileSystems` values are `FileNode` trees from `src/filesystem/types.ts`
- `GeneratedMachine.remoteMachine` matches `RemoteMachine` from `src/network/types.ts`
- `MissionNetwork.entryVariant` indicates the initial access method (ssh/ftp/nc/exploit/http)

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

| Axis          | Keywords                                                                                        | Notes                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                                                                        | Same as before, now unified in parser                                             |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`, `http`                                                           | Falls back if template unavailable (e.g. nc+router-first)                         |
| Network mode  | `forwarded`, `router-first`                                                                     | Hyphenated to avoid false matches                                                 |
| Objective     | `exfiltrate`, `tamper`, `credential-theft`, `script-fix`, `sabotage`, `backdoor`, `portforward` | Hyphen variant for credential_theft / script_fix; portforward forces router-first |
| Encryption    | `gpg`                                                                                           | Forces exfiltrate + encrypted target file                                         |

Example seeds: `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`, `test-exploit-router-first`, `IRONGATE-nc-gpg-22`

PRNG sequence is preserved when overrides are active — the PRNG call is always consumed, but its result is discarded in favor of the override. Seeds without keywords produce identical networks as before.

## Encrypted Exfiltrate

Exfiltrate objectives have a ~25% chance (or 100% with `gpg` keyword) of encrypting the target file. The decryption key is placed on a different machine in the attack path (~25% chance of binary wrapping). Players must find the key, escalate to root, and use `gpg(file, key)` to reveal the ACCESS-KEY. The encryption uses a deterministic XOR+FNV-1a checksum scheme (`src/utils/crypto.ts`) — same key always produces identical ciphertext.

## Binary File Wrapping

Some exfiltrate targets (~25%) and encryption keys (~25%) are wrapped in binary noise. `cat` shows garbled output; `strings` extracts the readable data. Binary files use deep paths that look like compiled binaries (e.g., `/opt/app/data.bin`, `/var/lib/export.dat`). See `binary.ts` for the wrapping utility and path pools.
