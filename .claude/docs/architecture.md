# Architecture

## Project Structure

```
src/
├── components/Terminal/   # Terminal UI (Terminal.tsx orchestrator, Input, Output, NanoEditor)
├── session/               # SessionContext — global session state (user, machine, path, wifiConnected)
├── filesystem/            # Virtual filesystem with IndexedDB persistence
│   ├── FileSystemContext.tsx   # Filesystem operations + patch persistence
│   ├── fileSystemFactory.ts    # Factory for generating machine filesystems
│   ├── machineFileSystems.ts   # Imports from __encoded.ts, exports Record + MachineId
│   ├── machines/               # Per-machine filesystem definitions (8 machines)
│   │   └── __encoded.ts        # GENERATED (gitignored) — encoded trees for production
│   └── types.ts                # FileNode, FilePermissions, FileSystemPatch types
├── secrets/               # Sensitive non-filesystem strings (WiFi password, etc.)
│   ├── secrets.ts              # Plaintext source (used by encode script + tests)
│   └── __encoded.ts            # GENERATED (gitignored) — encoded secrets for production
├── hooks/                 # React hooks (commands, history, autocomplete, variables)
├── network/               # Per-machine network simulation (interfaces, DNS, machines)
├── commands/              # Command implementations (colocated with .test.ts files)
│   ├── ftp/               # FTP mode commands (pwd, ls, cd, get, put, quit)
│   └── permissions.ts     # Command restrictions by user type
├── generation/            # Seeded mission network generator
│   ├── prng.ts                # Mulberry32 PRNG seeded via FNV-1a hash
│   ├── types.ts               # MissionNetwork, GeneratedMachine, AttackStep, EntryVariant, etc.
│   ├── pools.ts               # Data pools (usernames, hostnames, entry/port templates); passwords from encoded secrets
│   ├── topology.ts            # Network topology generator (machines, IPs, DNS, entry variant)
│   ├── users.ts               # User generator (per-machine users + credential map)
│   ├── attackChain.ts         # Attack chain generator (path, methods, credential placements)
│   ├── filesystem.ts          # Filesystem generator (role templates, breadcrumbs, noise, entry creds)
│   └── generateMission.ts     # Orchestrator: seed → MissionNetwork
├── mission/               # Mission system integration (Phase 2)
│   ├── MissionContext.tsx     # React context for active mission state + start/abort/complete
│   ├── missionBoard.ts       # Hardcoded mission contracts + ASCII board formatter
│   └── index.ts               # Barrel export
├── utils/                 # Utilities (md5, crypto, contentCodec, storage, stringify)
├── test/setup.ts          # Test setup (jest-dom, fake-indexeddb)
└── App.tsx                # Root component (mission state + wraps Terminal with providers)

scripts/
└── encode.ts              # Pre-build: encodes filesystems + secrets into __encoded.ts files

e2e/
├── ctf-playthrough.spec.ts     # Playwright E2E (full 16-flag CTF playthrough)
└── mission-playthrough.spec.ts # Playwright E2E (mission system — SSH/FTP/NC variants + lifecycle)
```

## Terminal Features

- ASCII banner on startup ("JSHACK.ME v0.3.0")
- Dynamic prompt: `username@machine>` (managed via SessionContext)
- Command history (up/down arrows)
- Tab autocompletion for commands and variables
- Tab path autocompletion inside string arguments (files and directories)
- `const`/`let` variable declarations with immutability enforcement

## Session Context

`SessionContext` (`src/session/SessionContext.tsx`) is the single source of truth for session state: username, userType, machine, currentPath, wifiConnected.

Key methods: `setUsername()`, `setMachine()`, `setCurrentPath()`, `setWifiConnected()`, `disconnectWifi()`, `pushSession()` (before SSH), `popSession()` (exit), `popAllSessions()` (mission abort — resets to bottom of stack), `canReturn()`.

Session stack enables SSH nesting — `pushSession()` saves state before connecting, `popSession()` restores it on `exit()`. WiFi state is included in snapshots.

## Persistence Architecture

Three-layer system:

1. **`storage.ts`** — Low-level IndexedDB wrapper (`jshack-db`, stores: `session`, `filesystem`)
2. **`storageCache.ts`** — Pre-load cache, called in `main.tsx` before React mounts. Bridges async IndexedDB with sync `useState` initializers. Handles one-time localStorage migration.
3. **Contexts** — Read from cache (sync), write to IndexedDB via `useEffect` (async)

Filesystem persistence uses patches (diffs from base filesystem). Each write/create operation records a `FileSystemPatch` with machineId, path, content, and owner. Patches are replayed on initialization via `applyPatches()`. Mission filesystem patches are excluded from persistence — only static machine patches are saved to IndexedDB.

Mission seed persistence: only the active mission seed string is stored in IndexedDB (session store, key `activeMissionSeed`). On reload, the full `MissionNetwork` is regenerated from the seed (deterministic). Session state (machine, path, stack) and static filesystem patches already persist via existing mechanisms.

## Nano Editor

`nano(path)` returns `{ __type: 'nano_open', filePath }`. Terminal.tsx renders `NanoEditor` as a fixed overlay. Ctrl+S saves (creates or updates file via FileSystemContext), Ctrl+X/Escape exits (prompts if unsaved changes). Tab inserts 2 spaces.

## Async Output Pattern

Network commands (ping, nmap, ssh, nslookup) and WiFi commands (airdump, aircrack) return `AsyncOutput` with `start(onLine, onComplete)` and optional `cancel()`. Terminal disables input during execution. The `onComplete` callback can trigger a password prompt (used by SSH).

## Tab Autocompletion

Two layers of tab completion, tried in order:

1. **Path completion** (`usePathAutoComplete`) — activated when the cursor is inside a string literal (single or double quotes). Scans the input to detect quote state, extracts the partial path, resolves the directory via `FileSystemContext`, and filters entries by prefix. Directories append `/`. Single match auto-completes; multiple matches advance to the longest common prefix and display the match list. Cursor is repositioned after completion via `requestAnimationFrame`.

2. **Command/variable completion** (`useAutoComplete`) — fallback when not inside a string. Matches command names (appends `()`) and variable names against the full input. Case-insensitive prefix matching.

`TerminalInput` passes `cursorPosition` to `onTab`, enabling mid-input completion. `Terminal.tsx` orchestrates both hooks in `handleTab`.

## WiFi Hacking Gate

Network access from localhost requires cracking a WiFi network first. This is a progression gate between flags 3 and 4 — not a flag itself.

**State**: `session.wifiConnected` (boolean, persisted to IndexedDB). When `false` on localhost:

- `ifconfig()` shows `wlan0` DOWN (no IP) + loopback `lo`
- Network commands (ping, nmap, ssh, ftp, nc, curl, nslookup) throw `"Network is unreachable"`
- `NetworkContext` returns empty machines/DNS

**Player flow**:

1. `airmon("start", "wlan0")` — enables monitor mode (transient `useRef`, not persisted)
2. `airdump()` — async scan revealing 4 nearby WiFi networks
3. `aircrack("A4:CF:12:D3:8B:7A")` — cracks JSHACK-CORP, reveals password + nmcli hint
4. `nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")` — connects to WiFi, sets `wifiConnected: true`

**Implementation**:

- WiFi networks: `src/network/wifiNetworks.ts` (4 networks with signal/encryption/crackability)
- Commands: `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts`, `nmcli.ts`
- Hook: `src/hooks/useWifiCommands.ts` (wires commands with session + monitor mode ref)
- Gating: `useNetworkCommands.ts` wraps network commands with `wrapWithWifiCheck`
- `NetworkContext` switches localhost interfaces between `localhostDisconnectedInterfaces` and `localhostConnectedInterfaces` based on WiFi state
- localhost uses `wlan0` (not `eth0`) + `lo` loopback
- `nmcli("disconnect")` while SSH'd calls `SessionContext.disconnectWifi()` — atomically resets to localhost, clears session stack + FTP/NC sessions

## Available Commands

See `src/commands/` for implementations and `src/hooks/useCommands.ts` for the registry.

Main commands: help, man, echo, author, clear, pwd, ls, cd, cat, su, whoami, airmon, airdump, aircrack, nmcli, ifconfig, ping, nmap, nslookup, ssh, exit, ftp, nc, curl, exploit, decrypt, output, resolve, strings, nano, node, missions, accept, abort, theme, reset.

FTP mode (when connected via ftp): pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye.

NC mode (when connected via nc): pwd, cd, ls, cat, whoami, help, exit — read-only shell access.

## Seeded Mission Network Generator

`src/generation/` contains the engine for procedurally generating mission networks from a seed string.

**Pipeline**: `generateMissionNetwork(seed)` composes these steps:

1. **PRNG** (`prng.ts`) — Mulberry32 PRNG seeded via FNV-1a hash of the seed string. Provides `next()`, `nextInt()`, `pick()`, `pickN()`, `shuffle()`.
2. **Topology** (`topology.ts`) — Generates machines on a flat subnet (`10.x.x.0/24`), assigns roles (webserver/database/fileserver/workstation), selects an entry variant (ssh/ftp/nc/exploit) for the entry machine, builds `NetworkConfig` with interfaces, DNS, and per-machine reachability.
3. **Users** (`users.ts`) — Generates root + 1-2 role-appropriate users per machine, hashes passwords with `md5()`. Guest passwords are picked from a `guestPasswords` pool (not hardcoded). Returns both `RemoteUser[]` per machine and a plaintext credential map.
4. **Attack Chain** (`attackChain.ts`) — Picks a target machine, builds an attack path (entry → intermediates → target), assigns access methods based on entry variant for the first hop (ssh/ftp/nc/exploit) and ssh for subsequent hops, plans credential placements. Selects a role-appropriate target file template (from `targetFileTemplatesByRole` in `pools.ts`) and fills the `{{flag}}` placeholder into thematic content.
5. **Filesystems** (`filesystem.ts`) — Builds `FileNode` trees per machine using the existing `createFileSystem()` factory. Injects role-based configs, credential breadcrumbs, noise files, red herrings, entry credential hints (for FTP/NC/exploit entry variants), and the target file at a dynamic path (from `objective.targetPath`) with thematic content embedding the flag.

**Output**: `MissionNetwork` containing seed, difficulty, machines, filesystems, network config, attack chain, objective, and entry variant. Same seed always produces identical output.

**Data Pools** (`pools.ts`) — Static arrays for usernames, hostnames, guest passwords, port templates, entry port templates (ssh/ftp/nc/exploit variants), vulnerability templates (real CVEs with service versions), entry credential hint templates, log templates, config templates, noise/red-herring files, and target file templates by role (thematic paths and content with `{{flag}}` placeholder). Mission passwords are imported from `src/secrets/__encoded.ts` (encoded at build time via the secrets registry) to prevent bundle inspection.

**Key properties**:

- Deterministic: same seed → identical network (deep equality)
- 4 machine roles, 3 difficulty tiers (easy=2, medium=3-4, hard=4-6 machines)
- 4 entry variants (ssh, ftp, nc, exploit) — entry machine's initial access method varies per seed
- Output types match existing `NetworkConfig`, `RemoteMachine`, `FileNode`

## Mission System Integration

`src/mission/` integrates the generator with React contexts so players can discover, accept, and play missions.

**Architecture — App.tsx orchestration:**

- `App.tsx` holds `activeMission` state + `startMission`/`abortMission`/`completeMission` callbacks
- Passes `activeMission.fileSystems` to `FileSystemProvider` as `missionFileSystems` prop
- Passes `activeMission.networkConfig` to `NetworkProvider` as `missionNetworkConfig` prop
- Passes `activeMission.machines` to `NetworkProvider` as `missionMachines` prop (for correct localhost injection)
- `MissionProvider` wraps everything, providing mission state + methods to commands via `useMission()` hook
- On init: checks `storageCache` for persisted seed, regenerates mission if present

**Provider hierarchy:**

```
SessionProvider → MissionProvider → FileSystemProvider → NetworkProvider → Terminal
```

**FileSystemContext integration:**

- Accepts optional `missionFileSystems` prop
- Merges mission filesystems into state when mission starts, removes when mission ends
- `STATIC_MACHINE_KEYS` set filters patches — only static machine patches persist to IndexedDB

**NetworkContext integration:**

- Accepts optional `missionNetworkConfig` prop and `missionMachines` prop (array of `GeneratedMachine`)
- When resolving config for current machine: checks mission config first, then static config
- When on localhost with active mission: uses `missionMachines` to get full `RemoteMachine` records (with ports and users) for localhost's reachable machine list, plus merges mission DNS
- `findMachineUsers(ip)` — searches both static config and `missionNetworkConfig` for user lists. Used by `useCommands.ts` for `su` user validation on any machine (static or mission-generated).

**Mission commands:**

- `missions()` — displays hardcoded darknet contract board (5 contracts across difficulties)
- `accept(seed)` — generates network from seed, passes `MissionNetwork` to `startMission`, displays briefing with entry point and access hint
- `abort()` — pops all sessions back to localhost, clears mission state

**Mission completion:**

- `Terminal.tsx` scans command output (both sync results and async output lines) for the active mission's flag string
- When flag is detected, displays ASCII "MISSION COMPLETE" banner and calls `completeMission()`

**Entry variant system:**

- Entry machine is NOT always SSH-accessible initially
- PRNG selects an entry variant: `ssh` (classic), `ftp` (explore via FTP, find SSH creds), `nc` (explore via backdoor, find SSH creds), or `exploit` (scan with `nmap -sV`, exploit vulnerable port for restricted shell, find SSH creds)
- SSH is always available on the entry machine, but FTP/NC/exploit entry variants require finding credentials first
- Exploit variant attaches a `Vulnerability` (CVE, description, service version) and `ServiceOwner` to a non-SSH port on the entry machine
- `nmap("-sV", target)` reveals service versions and CVE details; `exploit(host, port)` exploits the vulnerability and drops into a restricted NC-like shell
- Mission briefing shows the initial access command based on variant

## SEO & Open Graph

Static assets in `public/`: robots.txt, sitemap.xml, og-image.png (1200x630), apple-touch-icon.png. Meta tags in `index.html` cover SEO, Open Graph, and Twitter Cards.

To regenerate OG image: edit `public/og-image.html`, open at 1200x630 viewport, screenshot.
