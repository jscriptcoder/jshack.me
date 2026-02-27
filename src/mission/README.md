# Mission System

Integrates the seeded network generator (`src/generation/`) with React contexts and terminal commands so players can discover, accept, and play procedurally generated hacker-for-hire contracts.

## Files

| File                 | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `useMissionState.ts` | Hook owning mission state and IndexedDB persistence                |
| `MissionContext.tsx` | React context providing mission state + methods to child consumers |
| `missionBoard.ts`    | Hardcoded contract listings and ASCII board formatter              |
| `index.ts`           | Barrel exports                                                     |

## How It Works

### Lifecycle

1. Player types `missions()` — displays the darknet contract board (hardcoded listings in `missionBoard.ts`)
2. Player types `accept("SEED")` — the `accept` command generates a `MissionNetwork` via `generateMissionNetwork(seed)` and passes the full network to `useMissionState.startMission(mission)`, which stores it in state and persists only the seed to IndexedDB
3. Generated filesystems and network config flow as props from `App.tsx` into `FileSystemProvider` and `NetworkProvider`, making mission machines explorable with existing commands
4. Player hacks through the mission network using ssh, ftp, nc, curl, nmap, cat, etc.
5. Player completes the mission by sending proof to the client via `mail("client@darkmail.onion", "proof")` — the `mail` command verifies the proof based on objective type and calls `completeMission()`
6. Player can `abort()` at any time — calls `abortMission()`, which clears state and pops all SSH sessions back to localhost

### Objective Types

- **exfiltrate** — Find a document containing an ACCESS-KEY on the target machine, mail it to the client
- **exfiltrate (encrypted)** — Target file is encrypted; find the decryption key on another machine, use `decrypt(file, key)` as root, then mail the ACCESS-KEY
- **tamper** — Modify a specific value in a target file (e.g., change a grade from "F" to "A"), then mail the client to confirm
- **credential_theft** — Discover the root password on the target machine, mail it to the client

### Completion via `mail()`

The `mail(recipient, content)` command is the universal completion mechanism:

- Recipient must match the mission's `clientEmail` (shown in the briefing)
- For exfiltrate/credential_theft: content must match `objective.expectedProof`
- For tamper: `mail` reads the target file from the target machine and verifies the old value is gone and new value is present

### State Management

`useMissionState` is the single owner of mission state. It lives in `App.tsx` and feeds into the provider hierarchy:

```
App (useMissionState)
  → MissionProvider (exposes state + methods via useMission() hook)
    → FileSystemProvider (receives missionFileSystems prop)
      → NetworkProvider (receives missionNetworkConfig + missionMachines props)
        → Terminal
```

### Persistence

Only the seed string is persisted to IndexedDB (`activeMissionSeed` key in the session store). On page reload, `useMissionState` checks the storage cache for a persisted seed and regenerates the full `MissionNetwork` deterministically. Session state (current machine, path, SSH stack) and static filesystem patches persist via existing mechanisms. Mission filesystem patches are intentionally excluded from persistence.

### Network Isolation

Mission machines live on their own subnet (e.g., `10.x.x.0/24`) behind a router with a public IP (45.x.x.x). From localhost, only the router's public IP is visible. Two modes: forwarded (router NATs to internal DMZ) or router-first (hack the router to reach internal machines).

### Entry Variants

The entry machine's initial access method varies per seed:

- **ssh** — classic SSH with user credentials
- **ftp** — player FTPs in, finds SSH credentials in accessible files, then SSHes for full access
- **nc** — player connects via netcat backdoor, finds SSH credentials, then SSHes
- **exploit** — player scans with `nmap("-sV")`, exploits a vulnerable service, finds SSH credentials, then SSHes
- **http** — player discovers port 80 via nmap, uses curl to find SSH credentials

SSH is always available on the entry machine; other variants just change the _initial foothold_.

The mission briefing only shows the target (IP or domain) — the player must figure out how to connect.
