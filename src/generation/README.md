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
5. **Filesystems** (`filesystem.ts`) — FileNode trees with role configs, credential breadcrumbs, entry credential hints (for FTP/NC/exploit variants), noise, target file at dynamic path with thematic content

## Files

| File                 | Purpose                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prng.ts`            | Mulberry32 PRNG: next, nextInt, pick, pickN, shuffle                                                                                                                      |
| `types.ts`           | MissionNetwork, GeneratedMachine, AttackStep, EntryVariant, MissionObjective                                                                                              |
| `pools.ts`           | Static data: usernames, passwords, guest passwords, hostnames, client handles, vulnerability/port/entry templates, credential hints, target/tamper file templates by role |
| `topology.ts`        | Subnet generation, machine roles, entry variant selection, NetworkConfig                                                                                                  |
| `users.ts`           | Per-machine users + plaintext credential map                                                                                                                              |
| `attackChain.ts`     | Attack path, credential placements, objective generation (exfiltrate/tamper/credential_theft), client email                                                               |
| `filesystem.ts`      | FileNode trees via createFileSystem(), breadcrumbs, noise, dynamic target file placement                                                                                  |
| `generateMission.ts` | Orchestrator composing all steps                                                                                                                                          |

## Difficulty

Derived from the seed string (or explicit keywords):

- **easy** — 2 machines, 1 hop to target
- **medium** — 3-4 machines, up to 2 hops
- **hard** — 4-6 machines, full chain

Seeds containing "easy" or "hard" force that difficulty; otherwise derived from a hash of the seed.

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
- **nc** — player connects via netcat backdoor, finds SSH credentials, then SSHes; ports: 22, 4444
- **exploit** — player scans with `nmap("-sV")` to find vulnerable service, runs `exploit(host, port)` for restricted shell, finds SSH credentials, then SSHes; ports: 22, (80|3306|6379)

SSH is always available on the entry machine. FTP/NC/exploit variants place credential hint files (from `entryCredentialHintTemplates` in `pools.ts`) that leak SSH credentials for the same machine. The exploit variant additionally attaches a `Vulnerability` (from `vulnerabilityTemplates`) and a `ServiceOwner` to the vulnerable port.

NC and exploit variants select a variable owner type via PRNG: guest (60%), user (30%), or root (10%). This adds difficulty variety — guest owners have limited file visibility, while root owners can read root-only files. Root owners have hints placed in `/tmp/` instead of their home directory.
