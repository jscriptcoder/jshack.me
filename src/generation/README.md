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
// mission.objective    — what the player needs to find (flag, path, description)
```

## Pipeline

`generateMissionNetwork(seed)` runs these steps sequentially, each consuming from the same PRNG stream:

1. **PRNG** (`prng.ts`) — Mulberry32 seeded via FNV-1a hash of the seed string
2. **Topology** (`topology.ts`) — Flat subnet, machine count by difficulty, roles, IPs, interfaces, DNS, entry variant selection (ssh/ftp/nc)
3. **Users** (`users.ts`) — Root + 1-2 role-appropriate users per machine, md5-hashed passwords
4. **Attack Chain** (`attackChain.ts`) — Path from entry to target, access methods based on entry variant, credential placements
5. **Filesystems** (`filesystem.ts`) — FileNode trees with role configs, credential breadcrumbs, entry credential hints (for FTP/NC variants), noise, flag

## Files

| File                 | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `prng.ts`            | Mulberry32 PRNG: next, nextInt, pick, pickN, shuffle                                 |
| `types.ts`           | MissionNetwork, GeneratedMachine, AttackStep, EntryVariant, MissionObjective         |
| `pools.ts`           | Static data: usernames, passwords, hostnames, entry/port templates, credential hints |
| `topology.ts`        | Subnet generation, machine roles, entry variant selection, NetworkConfig             |
| `users.ts`           | Per-machine users + plaintext credential map                                         |
| `attackChain.ts`     | Attack path, credential placements, flag generation                                  |
| `filesystem.ts`      | FileNode trees via createFileSystem(), breadcrumbs, noise                            |
| `generateMission.ts` | Orchestrator composing all steps                                                     |

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
- `MissionNetwork.entryVariant` indicates the initial access method (ssh/ftp/nc)

## Entry Variants

The entry machine's initial access method varies per seed:

- **ssh** — classic SSH with guest credentials; ports: 22, 80
- **ftp** — player FTPs in, finds SSH credentials in accessible files, then SSHes; ports: 21, 22
- **nc** — player connects via netcat backdoor, finds SSH credentials, then SSHes; ports: 22, 4444

SSH is always available on the entry machine. FTP/NC variants place credential hint files (from `entryCredentialHintTemplates` in `pools.ts`) that leak SSH credentials for the same machine.
