# Architecture

## Project Structure

```
src/
├── components/Terminal/   # Terminal UI (Terminal.tsx orchestrator, Input, Output, NanoEditor)
├── session/               # SessionContext — global session state (user, machine, path, wifiConnected)
├── filesystem/            # Virtual filesystem with IndexedDB persistence
│   ├── FileSystemContext.tsx   # React context provider for filesystem operations + patch persistence
│   ├── fileSystemUtils.ts      # Pure utility functions (path resolution, tree ops, patches)
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

- ASCII banner on startup ("JSHACK.ME v0.13.0")
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

Filesystem persistence uses patches (diffs from base filesystem). Each write/create operation records a `FileSystemPatch` with machineId, path, content, owner, and optional `isNew` flag. Patches are replayed on initialization via `applyPatches()`. Mission filesystem patches are excluded from persistence — only static machine patches are saved to IndexedDB.

**Patch-aware deletion**: File creation patches are tagged with `isNew: true`. When deleting a file, if the existing patch has `isNew`, the patch is simply removed (the file never existed in the base filesystem, so no null-content tombstone is needed). Deleting a base filesystem file records a `content: null` patch. The `isNew` flag is preserved through write-after-create sequences by `upsertPatch`.

Mission seed persistence: only the active mission seed string is stored in IndexedDB (session store). On reload, the full `MissionNetwork` is regenerated from the seed (deterministic). Session state (machine, path, stack) persists per-tab via sessionStorage; static filesystem patches persist via IndexedDB.

## Cross-Tab Sync

Multiple browser tabs can run independent terminal sessions with shared state via the `BroadcastChannel` API (`src/utils/crossTabSync.ts`). Each tab has its own session (user, machine, path, SSH stack, FTP/NC mode) but filesystem patches, WiFi state, mission state, and theme are synchronized across tabs in real time.

**Architecture**: A single `jshack-sync` BroadcastChannel carries typed messages. Each context that needs sync creates a channel on mount and closes it on unmount. Messages are fire-and-forget — IndexedDB persistence serves as the durable backing store.

**Synced state**:

- **Filesystem patches** — `FileSystemContext` broadcasts each patch after `writeFileToMachine` / `createFileOnMachine`. Receiving tabs apply the patch to their local filesystem state via `applyPatches()`.
- **WiFi state** — `SessionContext` broadcasts `wifi-changed` on connect/disconnect. Receiving tabs update standalone `wifiConnected` state. WiFi disconnect from another tab resets the session to localhost (same as `disconnectWifi()`).
- **Mission state** — `useMissionState` broadcasts `mission-changed` with the seed (or null) on start/abort/complete. Receiving tabs regenerate the full `MissionNetwork` from the seed. `MissionProvider` detects cross-tab mission abort and calls `popAllSessions()` if the session is on a mission machine.
- **Theme** — `SessionContext` broadcasts `theme-changed`. Receiving tabs update `session.theme`, triggering `applyTheme()` via the existing effect.

**Echo loop prevention**: Each context broadcasts only on locally-initiated changes (explicit method calls). BroadcastChannel does not deliver messages to the posting tab, so echo loops cannot occur.

**Graceful fallback**: When `BroadcastChannel` is unavailable (older browsers, SSR), `createSyncChannel()` returns no-op stubs. Tabs work independently, same as before.

**Dynamic tab title**: `SessionContext` updates `document.title` based on the current session mode: `username@machine — JSHACK.ME`, `ftp> — JSHACK.ME`, or `nc shell — JSHACK.ME`.

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

Network access from localhost requires cracking a WiFi network first. This is a progression gate before network access — not a flag itself.

**State**: `wifiConnected` (standalone `useState<boolean>` in `SessionProvider`, persisted to IndexedDB). When `false` on localhost:

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

Main commands: help, man, echo, author, clear, pwd, ls, cd, cat, rm, su, whoami, airmon, airdump, aircrack, nmcli, ifconfig, ping, nmap, nslookup, ssh, exit, ftp, nc, curl, exploit, gobuster, hydra, decrypt, reboot, output, resolve, strings, nano, node, missions, accept, abort, mail, apt, theme, reset, xterm.

FTP mode (when connected via ftp): pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye.

NC mode (when connected via nc): pwd, cd, ls, cat, whoami, help, exit — read-only shell access.

## Tool Availability System

On remote/mission machines, hacking tools are not pre-installed. Players must install them via `apt('install', '<tool>')` as root. This adds realism and an additional challenge layer.

**Mechanism:** `src/commands/availability.ts` defines command categories and a `wrapWithInstallCheck` higher-order function (same pattern as `wrapWithWifiCheck`). At execution time, it checks if `/usr/bin/<command>` exists in the current machine's filesystem. On localhost, all tools are pre-installed.

**Categories:**

- **Shell builtins** (cd, exit, echo, pwd, etc.) — always available, no binary check
- **System utilities** (ls, cat, ssh, ping, apt, etc.) — always available, binaries in `/bin/`
- **Apt-installable** (nmap, john, hydra, nc, ftp, exploit, gobuster, airmon, airdump, aircrack, decrypt, node, nslookup) — require `/usr/bin/<name>` binary; pre-installed on localhost only
- **Game-specific** (missions, accept, mail, etc.) — always available, no binary check

**Filesystem integration:** `fileSystemFactory.ts` creates `/boot/`, `/bin/`, and `/usr/bin/` directories on all machines. `/bin/` contains system utility binary stubs. `/usr/bin/` is empty on remote/mission machines (populated via `apt install`). `mergeExtraDirectories()` does one-level-deep directory merging to prevent mission `extraDirectories` from overwriting factory-created `/usr/`.

**Wrapping order** in `useCommands.ts`: install check wraps the base command, then permission restriction wraps on top. At execution: permission checked first (outermost) → install check → actual execution.

## Seeded Mission Network Generator

`src/generation/` contains the engine for procedurally generating mission networks from a seed string.

**Pipeline**: `generateMissionNetwork(seed)` composes these steps. Seeds can embed keywords to override generation axes (difficulty, entry variant, network mode, objective type, domain entry, encrypted exfiltrate) — see `parseSeedOverrides()` in `generateMission.ts`.

1. **PRNG** (`prng.ts`) — Mulberry32 PRNG seeded via FNV-1a hash of the seed string. Provides `next()`, `nextInt()`, `pick()`, `pickN()`, `shuffle()`.
2. **Topology** (`topology.ts`) — Generates a router with a PRNG-varied public IP (from realistic hosting prefixes like 45, 51, 62, 78, etc.) and internal machines on a PRNG-varied private subnet (10.x.x.0/24, 172.{16-31}.x.0/24, or 192.168.{2-254}.0/24). The router is a real `GeneratedMachine` with role `'router'`, dual interfaces (public eth0 + internal eth1), its own filesystem, and users. Internal machines have roles (webserver/database/fileserver/workstation). Two network modes are supported: **forwarded** (easier — router NATs ports to the entry/DMZ machine, player connects transparently) and **router-first** (harder — no forwarding, player must hack the router to reach internal machines). Selects an entry variant (ssh/ftp/nc/exploit/http) and builds `NetworkConfig` with interfaces, DNS, and per-machine reachability. Internal machines see each other + router's internal gateway IP but NOT the router's public IP.
3. **Users** (`users.ts`) — Generates root + 1-2 role-appropriate users per machine, hashes passwords with `md5()`. Guest passwords are picked from a `guestPasswords` pool (not hardcoded). Returns both `RemoteUser[]` per machine and a plaintext credential map.
4. **Port Closures** (`generateMission.ts: applyPortClosures`) — PRNG-driven SSH/FTP port closures (~30% each, independent rolls) increase lateral movement variety. At most one SSH and one FTP closure per network. Entry machine, router, script_fix, and sabotage objectives are protected from SSH closures. When SSH is closed, FTP port 21 is ensured open. Always consumes 4 PRNG calls for sequence stability.
5. **Attack Chain** (`attackChain.ts`) — Picks a target machine, builds an attack path (entry → intermediates → target), assigns access methods based on entry variant for the first hop (ssh/ftp/nc/exploit/http) and ssh/ftp/http for subsequent hops (PRNG selects based on available ports — checks `hasSsh` to avoid routing through closed SSH), plans credential placements. Generates objective per type: exfiltrate (ACCESS-KEY in target file, optionally encrypted with key on a different machine), tamper (file with old/new values from `tamperFileTemplatesByRole`), credential_theft (root password), or sabotage (no target file — player bricks the machine). Generates client email from `clientHandles` pool. In router-first mode, `generateMission.ts` adds a bridge credential placement on the router filesystem containing SSH credentials for the internal entry machine (so the player can reach it after hacking the router).
6. **Filesystems** (`filesystem.ts`) — Builds `FileNode` trees per machine using the existing `createFileSystem()` factory. Injects role-based configs, credential breadcrumbs, noise files, red herrings, entry credential hints (for FTP/NC/exploit/HTTP entry variants), web content for webserver machines, and the target file at a dynamic path (for exfiltrate/tamper objectives; skipped for credential_theft and sabotage).
7. **Binary Wrapping** (`binary.ts`) — Probabilistically wraps credential breadcrumbs (~30%), exfiltrate targets (~25%), and entry credential hints (~20%) in non-printable "binary noise". `cat` shows garbled output; `strings` extracts readable data. Binary files use deep paths like `/usr/local/bin/monitor_agent`.

**Output**: `MissionNetwork` containing seed, difficulty, machines, filesystems, network config, attack chain, objective, clientEmail, entry variant, routerDomain, and domainEntry flag. Same seed always produces identical output.

**Data Pools** (`pools.ts`) — Static arrays for usernames, hostnames, guest passwords, client handles, port templates, entry port templates (ssh/ftp/nc/exploit/http variants), vulnerability templates (real CVEs with service versions), entry credential hint templates, log templates, config templates, noise/red-herring files, target file templates by role (with `{{access_key}}` placeholder for exfiltrate), and tamper file templates by role (with `{{tamperOldValue}}` placeholder). Mission passwords are imported from `src/secrets/__encoded.ts` (encoded at build time via the secrets registry) to prevent bundle inspection.

**Key properties**:

- Deterministic: same seed → identical network (deep equality)
- 5 machine roles (webserver, database, fileserver, workstation, router), 3 difficulty tiers (easy=2, medium=3-4, hard=4-6 internal machines + 1 router)
- 5 entry variants (ssh, ftp, nc, exploit, http) — initial access method varies per seed
- 2 network modes: forwarded (transparent NAT to DMZ) vs router-first (hack the router)
- Router is infrastructure-only (never the mission target) but has realistic content (firewall rules, routing tables, internal machine hints)
- Output types match existing `NetworkConfig`, `RemoteMachine`, `FileNode`

## Mission System Integration

`src/mission/` integrates the generator with React contexts so players can discover, accept, and play missions.

**Architecture — App.tsx orchestration:**

- `App.tsx` holds `activeMission` state + `startMission`/`abortMission`/`completeMission` callbacks
- Passes `activeMission.fileSystems` to `FileSystemProvider` as `missionFileSystems` prop
- Passes `activeMission.networkConfig` to `NetworkProvider` as `missionNetworkConfig` prop
- Passes `activeMission.machines` to `NetworkProvider` as `missionMachines` prop (for correct localhost injection)
- Passes `activeMission.natForwarding` and `activeMission.routerMachine` to `NetworkProvider` for NAT resolution
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

- Accepts optional `missionNetworkConfig`, `missionMachines`, `missionNatForwarding`, and `missionRouterMachine` props
- When resolving config for current machine: checks mission config first, then static config
- When on localhost with active mission: only the router's public IP is visible (not internal machines). In forwarded mode, the router appears with the entry machine's ports/users so connections are transparent.
- `resolveNat(ip)` — translates the router's public IP to the internal entry machine IP when port forwarding is active (identity function otherwise). Applied at SSH/FTP/NC connection boundaries in `Terminal.tsx`.
- `findMachineUsers(ip)` — searches both static config and `missionNetworkConfig` for user lists. Used by `useCommands.ts` for `su` user validation on any machine (static or mission-generated).

**Mission commands:**

- `missions()` — displays hardcoded darknet contract board (missions added incrementally with e2e tests)
- `accept(seed)` — generates network from seed, passes `MissionNetwork` to `startMission`, displays briefing with entry point, client email, objective-specific instructions, and variant-specific intel hint. Intel varies by entry variant: SSH (~50% shows credentials via `briefingRevealsCredentials`, ~50% hints at default credentials), FTP (hints at FTP service), NC (hints at backdoor), exploit (hints at vulnerable software), HTTP (hints at web server). Domain entry mode appends "Resolve the target domain first" and omits `ssh()` command. No command names appear in intel text — hints use natural language.
- `abort()` — pops all sessions back to localhost, clears mission state
- `mail(recipient, content)` — submits proof to the client to complete a mission. Verifies proof based on objective type.

**Objective types:**

- **exfiltrate** — Player finds an ACCESS-KEY in a target file and mails it to the client. Verification: content matches `objective.expectedProof`.
- **tamper** — Player modifies a target file (e.g., changes a grade from "F" to "A") and mails the client. Verification: `mail` reads the target file from the target machine via `readFileFromMachine`, checks `tamperOldValue` is gone and `tamperNewValue` is present.
- **credential_theft** — Player discovers the root password on the target machine and mails it to the client. Verification: content matches `objective.expectedProof` (the root password).
- **script_fix** — Player finds a broken script on the target machine, fixes it with `nano()`, and runs it with `node()`. Scripts call `_decode(checksum)` — a function injected only into `node()`'s execution context during script_fix missions. If the checksum is correct (script was properly fixed), `_decode()` returns the ACCESS-KEY. The player then mails it to the client like an exfiltrate mission. The ACCESS-KEY never appears in the script source (anti-cheat). Bug types: syntax (missing paren/quote), logic (wrong comparison), corrupted (data replaced with `???`, hint file nearby). ~60% user-owned (anyone can edit/run), ~40% root-owned (must `su` first).
- **sabotage** — Player bricks the target machine by gaining root, deleting `/boot/vmlinuz`, and running `reboot()`. Verification: `mail` checks `isMachineBricked(targetIP)`. No target file needed. SSH protected from port closures (player needs shell access).

**Mission completion:**

- Player sends proof via `mail("client@darkmail.onion", "proof")` — the mail command in `src/commands/mail.ts` validates the proof and calls `completeMission()`, displaying an ASCII "MISSION COMPLETE" banner.

**Entry variant system:**

- Entry machine is NOT always SSH-accessible initially
- PRNG selects an entry variant: `ssh` (classic), `ftp` (explore via FTP, find SSH creds), `nc` (explore via backdoor, find SSH creds), `exploit` (scan with `nmap -sV`, exploit vulnerable port for restricted shell, find SSH creds), or `http` (discover port 80 via nmap, use `curl` to find SSH creds in web content or response headers via `-i`)
- SSH is always available on the entry machine, but FTP/NC/exploit/HTTP entry variants require finding credentials first
- HTTP variant uses `.headers` sidecar files — a file at `/var/www/html/page.headers` injects custom HTTP response headers into curl responses for that page
- Exploit variant attaches a `Vulnerability` (CVE, description, service version) and `ServiceOwner` to a non-SSH port on the entry machine
- `nmap("-sV", target)` reveals service versions and CVE details; `exploit(host, port)` exploits the vulnerability and drops into a restricted NC-like shell
- Mission briefing shows the initial access command based on variant

## SEO & Open Graph

Static assets in `public/`: robots.txt, sitemap.xml, og-image.png (1200x630), apple-touch-icon.png. Meta tags in `index.html` cover SEO, Open Graph, and Twitter Cards.

To regenerate OG image: edit `public/og-image.html`, open at 1200x630 viewport, screenshot.
