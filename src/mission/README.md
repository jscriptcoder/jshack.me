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
5. When any command output contains the mission flag, `Terminal.tsx` detects it and calls `completeMission()`
6. Player can `abort()` at any time — calls `abortMission()`, which clears state and pops all SSH sessions back to localhost

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

Mission machines live on their own subnet (e.g., `10.x.x.0/24`) and only see each other. The entry point machine is injected into localhost's reachable machines and DNS when a mission is active, so the player can SSH/FTP/NC into it from localhost. When the mission ends, the injected entries are removed.

### Entry Variants

The entry machine's initial access method varies per seed:

- **ssh** — classic SSH with guest credentials shown in the briefing
- **ftp** — player FTPs in, finds SSH credentials in accessible files, then SSHes for full access
- **nc** — player connects via netcat backdoor, finds SSH credentials, then SSHes

SSH is always available on the entry machine; FTP/NC variants just change the _initial foothold_.
