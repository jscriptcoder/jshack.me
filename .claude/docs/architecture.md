# Architecture

## Project Structure

```
src/
├── components/Terminal/   # Terminal UI (Terminal.tsx orchestrator, Input, Output, NanoEditor)
├── session/               # SessionContext — global session state (user, machine, path, wifiConnected)
├── filesystem/            # Virtual filesystem with IndexedDB persistence
│   ├── FileSystemContext.tsx   # React context provider for filesystem operations + patch persistence
│   ├── fileSystemUtils.ts      # Pure utility functions (path resolution, tree ops, patches, traversal checks)
│   ├── fileSystemFactory.ts    # Factory for generating machine filesystems
│   ├── machineFileSystems.ts   # Imports from __encoded.ts, exports Record + MachineId
│   ├── machines/               # Per-machine filesystem definitions (localhost, fileserver, webserver + gateway)
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
│   ├── binary.ts              # Binary noise wrapping for credential/target files; binary path pools
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
└── mission-playthrough.spec.ts # Playwright E2E (mission system — SSH/FTP/NC variants + lifecycle)
```

## Terminal Features

- ASCII banner on startup ("JSHACK.ME v0.17.2")
- Dynamic prompt: `username@machine>` (managed via SessionContext)
- Command history (up/down arrows)
- Tab autocompletion for commands and variables
- Tab path autocompletion inside string arguments (files and directories)
- `const`/`let` variable declarations with immutability enforcement

## Session Context

`SessionContext` (`src/session/SessionContext.tsx`) is the single source of truth for session state: username, userType, machine, currentPath, theme. WiFi state (`wifiConnected`) is a standalone `useState<boolean>` in `SessionProvider` — not part of the `Session` type — because it's global shared state (persisted to IndexedDB, synced across tabs) rather than per-tab session state.

Key methods: `setUsername()`, `setMachine()`, `setCurrentPath()`, `setWifiConnected()`, `disconnectWifi()`, `pushSession()` (before SSH), `popSession()` (exit), `popAllSessions()` (mission abort — resets to bottom of stack), `canReturn()`.

Session stack enables SSH nesting — `pushSession()` saves state before connecting, `popSession()` restores it on `exit()`. WiFi state is not included in snapshots (it doesn't change per SSH hop).

## Persistence Architecture

Three-layer system:

1. **`storage.ts`** — Low-level storage wrapper. IndexedDB (`jshack-db`, stores: `session`, `filesystem`) for shared state; sessionStorage helpers for per-tab session.
2. **`storageCache.ts`** — Pre-load cache, called in `main.tsx` before React mounts. Loads session from sessionStorage (sync), WiFi/patches/mission from IndexedDB (async). Bridges with sync `useState` initializers.
3. **Contexts** — `SessionContext` writes session to sessionStorage and WiFi to IndexedDB. `FileSystemContext` writes patches to IndexedDB.

**Storage layout:**

| State                                                   | Storage                             | Scope   |
| ------------------------------------------------------- | ----------------------------------- | ------- |
| Session (user, machine, path, theme, SSH stack, FTP/NC) | sessionStorage                      | Per-tab |
| WiFi connected                                          | IndexedDB (`wifiConnected` key)     | Shared  |
| Mission seed                                            | IndexedDB (`activeMissionSeed` key) | Shared  |
| Filesystem patches                                      | IndexedDB (`patches` key)           | Shared  |
| Bricked machines                                        | IndexedDB (`brickedMachines` key)   | Shared  |

Filesystem persistence uses patches (diffs from base filesystem). Each write/create operation records a `FileSystemPatch` with machineId, path, content, owner, and optional `isNew` flag. Patches are replayed on initialization via `applyPatches()`. Both static and mission filesystem patches are persisted to IndexedDB. On reload with an active mission, mission patches are replayed on top of regenerated filesystems. Mission patches are cleaned up on mission end/transition.

**Patch-aware deletion**: File creation patches are tagged with `isNew: true`. When deleting a file, if the existing patch has `isNew`, the patch is simply removed (the file never existed in the base filesystem, so no null-content tombstone is needed). Deleting a base filesystem file records a `content: null` patch. The `isNew` flag is preserved through write-after-create sequences by `upsertPatch`.

Mission seed persistence: the active mission seed string is stored in IndexedDB (session store). On reload, the full `MissionNetwork` is regenerated from the seed (deterministic), then any persisted mission patches (apt installs, nano edits, etc.) are replayed on top. Session state (machine, path, stack) persists per-tab via sessionStorage; all filesystem patches (static + mission) persist via IndexedDB.

## Cross-Tab Sync

Multiple browser tabs can run independent terminal sessions with shared state via the `BroadcastChannel` API (`src/utils/crossTabSync.ts`). Each tab has its own session (user, machine, path, SSH stack, FTP/NC mode) but filesystem patches, WiFi state, mission state, and theme are synchronized across tabs in real time.

**Architecture**: A single `jshack-sync` BroadcastChannel carries typed messages. Each context that needs sync creates a channel inside its subscription effect and closes it on cleanup. The channel ref is updated so broadcast calls always use the active channel. This pattern is StrictMode-safe — React's cleanup + re-run cycle gets a fresh channel instead of reusing a closed one. Messages are fire-and-forget — IndexedDB persistence serves as the durable backing store.

**Synced state**:

- **Filesystem patches** — `FileSystemContext` broadcasts each patch after `writeFileToMachine` / `createFileOnMachine`. Receiving tabs apply the patch to their local filesystem state via `applyPatches()`.
- **WiFi state** — `SessionContext` broadcasts `wifi-changed` on connect/disconnect. Receiving tabs update standalone `wifiConnected` state. WiFi disconnect from another tab resets the session to localhost (same as `disconnectWifi()`).
- **Mission state** — `useMissionState` broadcasts `mission-changed` with the seed (or null) on start/abort/complete. Receiving tabs regenerate the full `MissionNetwork` from the seed. `MissionProvider` detects cross-tab mission abort and calls `popAllSessions()` if the session is on a mission machine.
- **Theme** — `SessionContext` broadcasts `theme-changed`. Receiving tabs update `session.theme`, triggering `applyTheme()` via the existing effect.

**Echo loop prevention**: Each context broadcasts only on locally-initiated changes (explicit method calls). BroadcastChannel does not deliver messages to the posting tab, so echo loops cannot occur.

**Graceful fallback**: When `BroadcastChannel` is unavailable (older browsers, SSR), `createSyncChannel()` returns no-op stubs. Tabs work independently, same as before.

**Dynamic tab title**: `SessionContext` updates `document.title` based on the current session mode: `username@machine — JSHACK.ME`, `ftp> — JSHACK.ME`, or `nc shell — JSHACK.ME`.

## Filesystem Permission Model

Unix-realistic permission model with owner-scoped access and directory traversal checking.

**Owner-scoped permissions**: Files and directories are only accessible to their owner + root. Guest-owned items are world-readable (matching real Unix behavior where guest home dirs are typically open). Root-owned items are root-only unless marked as system directories.

**System directories**: Directories like `/var/`, `/tmp/`, `/etc/`, `/home/`, `/usr/`, `/boot/`, `/srv/`, `/opt/` use a `worldReadable` flag — all users can list and traverse them, but individual files inside may be restricted by their own permissions.

**Directory traversal checking**: Accessing `/home/operator/notes.txt` requires execute permission on every parent directory (`/`, `/home/`, `/home/operator/`). The `checkTraversal()` function in `fileSystemUtils.ts` walks the path and verifies execute permission at each level. Root bypasses all traversal checks. Traversal is wired into `canReadFromMachine`/`canWriteFromMachine` in `FileSystemContext`, and injected as `canTraverse`/`canTraverseOnMachine` dependency into commands that do manual permission checks.

**`cd` checks execute, not read**: Matches real Unix — `cd` into a directory requires execute permission. `ls` requires read permission on the target but execute on all parents. This applies to main `cd`, FTP `cd`/`lcd`, and NC `cd`.

**Generated mission filesystems** (`src/generation/filesystem.ts`): `mkFile` and `mkDir` helpers produce owner-scoped permissions. `mkDir` accepts an optional `worldReadable` parameter for system directories. `mkScript` has its own explicit permission logic for script_fix objectives.

## Nano Editor

`nano(path)` returns `{ __type: 'nano_open', filePath }`. Terminal.tsx renders `NanoEditor` as a fixed overlay. Ctrl+S saves (creates or updates file via FileSystemContext), Ctrl+X/Escape exits (prompts if unsaved changes). Tab inserts 2 spaces.

## Authentication

`useAuthentication` (`src/hooks/useAuthentication.ts`) encapsulates all password-related state and login logic, extracted from Terminal.tsx. Manages three authentication flows:

- **su** — validates password against `/etc/passwd` hashes on the current machine, switches user type and home path
- **SSH** — validates against remote machine user list, pushes session stack, resolves NAT, switches to remote machine
- **FTP** — two-stage login (username prompt → password prompt), validates against remote machine, creates FTP session

Terminal.tsx triggers auth flows via `startPasswordPrompt()` (from `su` command), `startSshPrompt()` (from SSH async follow-up), and `startFtpPrompt()` (from FTP async follow-up). Submit handlers receive the current `input` and a `clearInput` callback (state ownership stays in Terminal.tsx).

## Async Output Pattern

Network commands (ping, nmap, ssh, nslookup) and WiFi commands (airdump, aircrack) return `AsyncOutput` with `start(onLine, onComplete)` and optional `cancel()`. Terminal disables input during execution. The `onComplete` callback can trigger a password prompt (used by SSH/FTP via `useAuthentication`).

## Tab Autocompletion

Two layers of tab completion, tried in order:

1. **Path completion** (`usePathAutoComplete`) — activated when the cursor is inside a string literal (single or double quotes). Scans the input to detect quote state, extracts the partial path, resolves the directory via `FileSystemContext`, and filters entries by prefix. Directories append `/`. Single match auto-completes; multiple matches advance to the longest common prefix and display the match list. Cursor is repositioned after completion via `requestAnimationFrame`.

2. **Command/variable completion** (`useAutoComplete`) — fallback when not inside a string. Matches command names (appends `()`) and variable names against the full input. Case-insensitive prefix matching.

`TerminalInput` passes `cursorPosition` to `onTab`, enabling mid-input completion. `Terminal.tsx` orchestrates both hooks in `handleTab`.

**Mode-aware path completion** (`usePathCompletionAdapters`): A hook that adapts filesystem APIs for different terminal modes and manages three `usePathAutoComplete` instances internally:

- **Default/NC mode** — uses NC session's `targetIP` and `currentPath` when NC mode is active, otherwise uses the main session's filesystem. Without this, path completion would resolve against the main session's machine (localhost).
- **FTP remote** — resolves against the FTP target machine for remote commands (`cd`, `ls`).
- **FTP local** — resolves against the origin machine for local commands (`lcd`, `lls`).

FTP mode operates on two machines simultaneously. The adapter detects which FTP command is being typed and routes to the correct instance: dual-argument commands (`get(remote, local)`, `put(local, remote)`) switch context per argument position by counting commas before the cursor. Returns a single `getPathCompletions` function that handles all mode switching internally.

## WiFi Hacking Gate

Network access from localhost requires cracking a WiFi network first. See `infrastructure-design.md` for full details (WiFi networks, player flow, password, implementation).

## Bricked Machine System

`reboot()` (root-only, apt-installable) reboots the current machine with an animated shutdown/boot sequence. If critical boot files are missing, the machine is permanently bricked.

**Boot check order**: `/boot/vmlinuz` checked first — if missing, GRUB error and halt. If vmlinuz exists but `/boot/initrd.img` missing, kernel loads then panics (VFS: Unable to mount root fs). Deleting either file is enough to brick.

**State**: `brickedMachines: ReadonlySet<string>` in `SessionContext` (initialized from `storageCache`). Persisted to IndexedDB (`brickedMachines` key in session store), synced across tabs via `bricked-changed` BroadcastChannel message.

**Connection gating**: `wrapWithBrickedCheck` HOF in `useNetworkCommands.ts` (outermost wrapper — checked before WiFi) blocks ssh, ftp, nc, ping, nmap, curl, exploit, hydra, gobuster to bricked machines. Error: `"Connection timed out — host <ip> appears to be down"`. nslookup is not gated (DNS doesn't require the target to be up).

**Localhost bricking**: Terminal.tsx checks `isMachineBricked('localhost')` at the top of render. If true, renders a frozen kernel panic screen with no input. Only recovery: `reset("confirm")` (which clears IndexedDB) or clearing browser site data.

**Remote bricking**: After bricking a remote machine, the reboot command pops the SSH session (returns to parent machine). The bricked machine is then unreachable via any connection command.

**Cleanup**: `clearAllData()` clears the entire IndexedDB session store, which includes bricked machines state. No explicit cleanup needed for mission machines.

## Available Commands

See `src/commands/` for implementations and `src/hooks/useCommands.ts` for the registry.

Main commands: help, man, echo, author, clear, pwd, ls, cd, cat, rm, su, whoami, airmon, airdump, aircrack, nmcli, ifconfig, ping, nmap, nslookup, ssh, exit, ftp, nc, curl, exploit, gobuster, hydra, gpg, reboot, output, resolve, strings, nano, node, missions, accept, abort, mail, apt, theme, reset, xterm.

FTP mode (when connected via ftp): pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye.

NC mode (when connected via nc): pwd, cd, ls, cat, whoami, help, exit — read-only shell access.

## Command Access Control

Unified filesystem-based access model (`src/commands/availability.ts`). All commands visible in `help()` and tab-complete. Execution gated by binary file permissions. See `CLAUDE.md` for command categories (builtins, game, system utilities, apt-installable).

**Mechanism:** `wrapWithAccessCheck` HOF checks binary existence and execute permissions at execution time. Shell builtins and game commands bypass the check.

**Filesystem integration:** `fileSystemFactory.ts` creates `/boot/`, `/bin/`, and `/usr/bin/` directories on all machines. `/bin/` contains system utility binary stubs. `/usr/bin/` is empty on remote/mission machines (populated via `apt install`). `createBinaryEntries()` applies `RESTRICTED_EXECUTE` permissions automatically. `mergeExtraDirectories()` does one-level-deep directory merging to prevent mission `extraDirectories` from overwriting factory-created `/usr/`.

**Error messages:** Binary missing → `"bash: name: command not found"` (with apt install hint). Binary exists but no execute permission → `"bash: name: Permission denied"`.

## Seeded Mission Network Generator

`src/generation/` contains the engine for procedurally generating mission networks from a seed string. See `mission-variations.md` for the complete catalog of all generation axes, templates, and pools.

**Pipeline**: `generateMissionNetwork(seed)` composes 7 steps: PRNG (`prng.ts`) → Topology (`topology.ts`) → Users (`users.ts`) → Port Closures (`generateMission.ts: applyPortClosures`) → Attack Chain (`attackChain.ts`) → Filesystems (`filesystem.ts`) → Binary Wrapping (`binary.ts`). Seeds can embed keywords to override generation axes — see `parseSeedOverrides()` in `generateMission.ts`.

**Key properties**: Deterministic (same seed → identical network). 5 machine roles, 3 difficulty tiers, 5 entry variants, 2 network modes, 5 objective types. Output types match existing `NetworkConfig`, `RemoteMachine`, `FileNode`. Mission passwords imported from `src/secrets/__encoded.ts`.

## Mission System Integration

`src/mission/` integrates the generator with React contexts. See `mission-variations.md` for entry variants, objective types, templates, and briefing intel.

**Provider hierarchy:**

```
SessionProvider → MissionProvider → FileSystemProvider → NetworkProvider → Terminal
```

**App.tsx orchestration:** Holds `activeMission` state + `startMission`/`abortMission`/`completeMission` callbacks. Passes mission filesystems, network config, machines, and router machine to their respective providers. On init: checks `storageCache` for persisted seed, regenerates mission if present.

**Context integration:**

- `FileSystemContext` accepts optional `missionFileSystems` prop — merges on mission start, removes on end. All patches (static + mission) are persisted to IndexedDB. On initial mount with a persisted mission, cached mission patches are replayed on top of regenerated filesystems. On mission end/transition, mission patches are cleaned up from state.
- `NetworkContext` accepts optional `missionNetworkConfig`, `missionMachines`, `missionRouterMachine` props. Checks mission config first, then static. `resolveNat(ip, port)` translates router public IP + port to internal machine IP + port based on iptables rules parsed dynamically from the router's filesystem. `findMachineUsers(ip)` searches both configs.

**Mission commands:** `missions()` (browse contracts), `accept(seed)` (generate + start), `abort()` (pop all sessions, clear state), `mail(recipient, content)` (submit proof, verify by objective type, calls `completeMission()`).

**Objective types:** exfiltrate, tamper, credential_theft, script_fix, sabotage. See `mission-variations.md` for details and completion criteria.

## SEO & Open Graph

Static assets in `public/`: robots.txt, sitemap.xml, og-image.png (1200x630), apple-touch-icon.png. Meta tags in `index.html` cover SEO, Open Graph, and Twitter Cards.

To regenerate OG image: edit `public/og-image.html`, open at 1200x630 viewport, screenshot.
