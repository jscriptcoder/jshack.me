# Seeded Mission Network Generator

Deterministic engine that generates a complete hackable network from a seed string. Same seed always produces identical output. Pure generation pipeline — React integration lives in `src/mission/`.

## Usage

```typescript
import { generateMissionNetwork } from './generateMission';

const mission = generateMissionNetwork('HEIST-7734');
// mission.machines     — generated machines with roles, ports, users
// mission.fileSystems  — FileNode tree per machine (keyed by IP)
// mission.networkConfig — NetworkConfig compatible with existing NetworkContext
// mission.attackChain  — step-by-step path from entry to target
// mission.objective    — mission goal (type, target, expectedProof, clientEmail)
// mission.clientEmail  — client email for mail() completion
```

## Pipeline

`generateMissionNetwork(seed)` runs these steps sequentially, each consuming from the same PRNG stream:

1. **PRNG** (`prng.ts`) — Mulberry32 seeded via FNV-1a hash of the seed string
2. **Topology** (`topology.ts`) — Flat subnet, machine count by difficulty, roles, IPs, interfaces, DNS, entry variant selection (ssh/ftp/nc/exploit)
3. **Users** (`users.ts`) — Root + 1-2 role-appropriate users per machine, md5-hashed passwords. Guest passwords picked from `guestPasswords` pool (not hardcoded).
4. **Attack Chain** (`attackChain.ts`) — Path from entry to target, access methods based on entry variant, credential placements, objective generation (exfiltrate with ACCESS-KEY, tamper with old/new values, credential_theft with root password), client email generation
5. **Filesystems** (`filesystem.ts`) — FileNode trees with role configs, credential breadcrumbs, entry credential hints (for FTP/NC/exploit variants), noise, target file at dynamic path with thematic content. `/bin/` is populated with system utility binaries; `/usr/bin/` is left empty (players must `apt install` tools).

## Files

| File                 | Purpose                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prng.ts`            | Mulberry32 PRNG: next, nextInt, pick, pickN, shuffle                                                                                                                      |
| `types.ts`           | MissionNetwork, GeneratedMachine, AttackStep, EntryVariant, MissionObjective                                                                                              |
| `pools.ts`           | Static data: usernames, passwords, guest passwords, hostnames, client handles, vulnerability/port/entry templates, credential hints, target/tamper file templates by role |
| `topology.ts`        | Subnet generation, machine roles, entry variant selection, NetworkConfig                                                                                                  |
| `users.ts`           | Per-machine users + plaintext credential map                                                                                                                              |
| `attackChain.ts`     | Attack path, credential placements, objective generation (exfiltrate/tamper/credential_theft), client email                                                               |
| `binary.ts`          | Binary noise wrapping for credential/target files, binary file path pools, binary hint templates                                                                          |
| `filesystem.ts`      | FileNode trees via createFileSystem(), breadcrumbs, noise, dynamic target file placement                                                                                  |
| `generateMission.ts` | Orchestrator composing all steps                                                                                                                                          |

## Difficulty

Derived from the seed string (or explicit keywords):

- **easy** — 2 machines, 1 hop to target
- **medium** — 3-4 machines, up to 2 hops
- **hard** — 4-6 machines, full chain

Seeds containing "easy", "medium", or "hard" force that difficulty; otherwise derived from a hash of the seed. See "Seed Keywords" below for controlling other axes.

## Machine Roles

| Role        | Ports       | Typical users      |
| ----------- | ----------- | ------------------ |
| webserver   | 22, 80, 443 | www-data, webadmin |
| database    | 22, 3306    | dbadmin, mysql     |
| fileserver  | 21, 22      | ftpuser, backup    |
| workstation | 22          | jsmith, developer  |

## Output Types

All output types are compatible with the existing codebase:

- `MissionNetwork.networkConfig` matches `NetworkConfig` from `src/network/types.ts`
- `MissionNetwork.fileSystems` values are `FileNode` trees from `src/filesystem/types.ts`
- `GeneratedMachine.remoteMachine` matches `RemoteMachine` from `src/network/types.ts`
- `MissionNetwork.entryVariant` indicates the initial access method (ssh/ftp/nc/exploit)
- `MissionNetwork.entryCredential` provides the entry credential (SSH variant uses a regular user; NC/exploit variants use the port owner — guest/user/root per PRNG)

## Entry Variants

The entry machine's initial access method varies per seed:

- **ssh** — classic SSH with user credentials shown in briefing; ports: 22, 80
- **ftp** — player FTPs in, finds SSH credentials in accessible files, then SSHes; ports: 21, 22
- **nc** — player connects via netcat backdoor, finds SSH credentials, then SSHes; ports: 22, (4444|31337|8888|1337)
- **exploit** — player scans with `nmap("-sV")` to find vulnerable service, runs `exploit(host, port)` for restricted shell, finds SSH credentials, then SSHes; ports: 22, (80|3306|6379)

SSH is always available on the entry machine. FTP/NC/exploit variants place credential hint files (from `entryCredentialHintTemplates` in `pools.ts`) that leak SSH credentials for the same machine. The exploit variant additionally attaches a `Vulnerability` (from `vulnerabilityTemplates`) and a `ServiceOwner` to the vulnerable port.

NC and exploit variants select a variable owner type via PRNG: guest (60%), user (30%), or root (10%). This adds difficulty variety — guest owners have limited file visibility, while root owners can read root-only files. Root owners have hints placed in `/tmp/` instead of their home directory.

## Seed Keywords

Players and developers can embed keywords in the seed string to control generation axes. Keywords are case-insensitive and matched via `includes()`. `parseSeedOverrides(seed)` extracts all overrides in one pass.

| Axis          | Keywords                                   | Notes                                                     |
| ------------- | ------------------------------------------ | --------------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                   | Same as before, now unified in parser                     |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`              | Falls back if template unavailable (e.g. nc+router-first) |
| Network mode  | `forwarded`, `router-first`                | Hyphenated to avoid false matches                         |
| Objective     | `exfiltrate`, `tamper`, `credential-theft` | Hyphen variant for credential_theft                       |
| Encryption    | `decrypt`                                  | Forces exfiltrate + encrypted target file                 |

Example seeds: `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`, `test-exploit-router-first`, `IRONGATE-nc-decrypt-22`

PRNG sequence is preserved when overrides are active — the PRNG call is always consumed, but its result is discarded in favor of the override. Seeds without keywords produce identical networks as before.

## Encrypted Exfiltrate

Exfiltrate objectives have a ~25% chance (or 100% with `decrypt` keyword) of encrypting the target file. The decryption key is placed on a different machine in the attack path (~25% chance of binary wrapping). Players must find the key, escalate to root, and use `decrypt(file, key)` to reveal the ACCESS-KEY. The encryption uses a deterministic XOR+FNV-1a checksum scheme (`src/utils/crypto.ts`) — same key always produces identical ciphertext.

## Binary File Wrapping

Some credential breadcrumbs (~30%), exfiltrate targets (~25%), entry credential hints (~20%), and encryption keys (~25%) are wrapped in binary noise. `cat` shows garbled output; `strings` extracts the readable data. Binary files use deep paths that look like compiled binaries (e.g., `/usr/local/bin/monitor_agent`, `/opt/lib/libauth.so`). Hints for binary placements mention the `strings` command. See `binary.ts` for the wrapping utility and path pools.
