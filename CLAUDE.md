# CLAUDE.md

## Project Overview

**JSHACK.ME** is a web-based JavaScript terminal emulator with a retro amber-on-black CRT aesthetic. Features a virtual filesystem with Unix-like permissions for mission-based hacking challenges with procedurally generated contracts. Deployed on Vercel at jshack.me.

## Code Style

**IMPORTANT:** Follow these skills — they are the source of truth for code patterns:

- **Functional programming**: @.claude/skills/functional/SKILL.md
- **TypeScript strict**: @.claude/skills/typescript-strict/SKILL.md

Key rules (see skills for full details):

- `type` over `interface`, `readonly` everywhere, no `any`, no `as Type`
- Immutable data: spread operators, `slice()`, `map()`, `filter()` — never mutate
- Pure functions, early returns, max 2 levels nesting, comments for complex/non-obvious logic

## Build & Development Commands

```bash
npm run dev           # Start Vite dev server (auto-runs encode first)
npm run build         # TypeScript compile + Vite production build (auto-runs encode first)
npm run encode        # Generate encoded filesystems + secrets (__encoded.ts files)
npm run lint          # Run ESLint
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting without modifying (CI-friendly)
npm test              # Run tests in watch mode (auto-runs encode first)
npm run test:run      # Run tests once (auto-runs encode first)
npm run test:coverage # Run tests with coverage (auto-runs encode first)
npm run test:e2e      # Run Playwright E2E test (mission playthrough)
```

## Tech Stack

- **React 19** + **TypeScript** — UI framework
- **Vite** — Build tool and dev server
- **Tailwind CSS v4** — Styling (via `@tailwindcss/vite` plugin)
- **Prettier** — Code formatting (single quotes, semicolons, trailing commas, 100 char width)
- **Vitest** + **React Testing Library** — Unit testing
- **Playwright** — E2E testing (Chromium, mission playthrough)

## Key Architecture

Detailed architecture: @.claude/docs/architecture.md
Infrastructure design (network, machines, filesystems): @.claude/docs/infrastructure-design.md
Mission system design (procedural generation, contracts): @.claude/docs/missions-design.md
Mission variations catalog (all generation axes): @.claude/docs/mission-variations.md

### Command Execution Flow

User input flows through `Terminal.tsx`:

1. Checked for variable operations (`const`/`let`) via `useVariables` hook
2. Otherwise executed as command via `new Function()` with commands/variables injected into scope

### Adding New Commands

1. Create file in `src/commands/` exporting a `Command` object (see `src/components/Terminal/types.ts` for type)
2. Register in `src/hooks/useCommands.ts` via `commands.set('name', myCommand)`
3. Add permission tier in `src/commands/permissions.ts` (guest/user/root)

### Command Restrictions

Commands are tiered by user type (`src/commands/permissions.ts`):

- **guest**: help, man, echo, whoami, pwd, ls, cd, cat, rm, su, clear, author, exit, ssh, ping, curl, nslookup, xterm
- **user**: All guest + apt, ifconfig, nmap, ftp, nc, exploit, gobuster, strings, output, resolve, nano, node, john, hydra, airmon, airdump, aircrack, nmcli, missions, accept, abort, mail
- **root**: All user + decrypt, reboot

### Filesystem Permissions

Unix-realistic permission model with owner-scoped access and directory traversal checking. Files/directories are only accessible to their owner + root (guest-owned items are world-readable). System directories (`/var`, `/tmp`, `/etc`, `/home`, `/usr`, etc.) are world-readable via `worldReadable` flag. Accessing a file requires execute permission on every parent directory (`checkTraversal` in `fileSystemUtils.ts`). `cd` checks execute permission (not read), matching real Unix. See `.claude/docs/architecture.md` for full details.

### Tool Availability (apt install)

On remote/mission machines, hacking tools must be installed via `apt('install', '<tool>')` as root. The availability system (`src/commands/availability.ts`) wraps apt-installable commands with a filesystem check for `/usr/bin/<command>`.

- **Shell builtins** (cd, echo, pwd, etc.) — always available
- **System utilities** (ls, cat, ssh, ping, etc.) — always available, binaries in `/bin/`
- **Apt-installable** (nmap, john, hydra, nc, ftp, exploit, gobuster, etc.) — require `/usr/bin/<name>` to exist; pre-installed on localhost only
- **Game-specific** (missions, accept, mail, etc.) — always available

The filesystem factory (`fileSystemFactory.ts`) creates `/boot/`, `/bin/`, and `/usr/bin/` directories on all machines. `mergeExtraDirectories()` handles one-level-deep merging to prevent mission generation's `extraDirectories` from overwriting factory directories.

### Content Encoding (Anti-Cheat)

Sensitive content is XOR+Base64 encoded at build time to prevent finding flag strings or passwords in the JS bundle.

- `npm run encode` generates `src/filesystem/machines/__encoded.ts` (localhost only) and `src/secrets/__encoded.ts` (both gitignored)
- `predev`/`prebuild`/`pretest`/`pretest:run`/`pretest:coverage` hooks auto-run encode
- `machineFileSystems.ts` imports from filesystem `__encoded.ts`, not source machine files
- `wifiNetworks.ts` imports from secrets `__encoded.ts`, not the plaintext `src/secrets/secrets.ts`
- `pools.ts` imports mission passwords from secrets `__encoded.ts` (not hardcoded in source)
- Unit tests import source files directly (unaffected by encoding)
- Verify: `grep -r "FLAG{" dist/` and `grep -r "cr4ck3d_w1f1" dist/` after build should return zero matches (mission flags are generated at runtime, not embedded in the bundle)

### Secrets Registry

`src/secrets/secrets.ts` defines sensitive non-filesystem strings (e.g., WiFi password, mission passwords) as key-value pairs. The `encode` script encodes them into `src/secrets/__encoded.ts`. App code imports from `__encoded`, tests import from the source file directly.

Current secrets: `WIFI_PASSWORD` (WiFi cracking gate), `MISSION_PASSWORDS` (JSON-stringified array of 60 passwords used by mission generator), `GUEST_PASSWORDS` (JSON-stringified array of 7 guest passwords used by mission generator).

To add a new secret: add the key-value pair to `src/secrets/secrets.ts`, then run `npm run encode`.

### Special Output Types

Commands return objects with `__type` for custom rendering (see `src/components/Terminal/types.ts`):

- `'clear'`, `'author'`, `'password_prompt'`, `'nano_open'`, `'async'`
- `AsyncOutput` streams lines with delays for network commands (ping, nmap, ssh, nslookup)

### Persistence

Two storage mechanisms split by scope:

- **sessionStorage** (per-tab): Session state (user, machine, path, SSH stack, FTP/NC mode, theme). Each tab gets an independent session — opening a new tab starts fresh at `localhost /home/jshacker`.
- **IndexedDB** (`jshack-db`, shared): Filesystem patches, WiFi state, mission seed, bricked machines. Shared across all tabs.

Key details:

- `storageCache.ts` pre-loads IndexedDB data + sessionStorage before React mounts (sync cache for `useState` initializers)
- `SessionContext` writes session to `sessionStorage` via `useEffect`; WiFi state writes to IndexedDB separately
- Filesystem uses a patches approach — only diffs from base filesystem are stored
- Mission seed persisted to IndexedDB session store (`activeMissionSeed` key); full network regenerated from seed on reload
- Mission filesystem patches are NOT persisted — only static machine patches are saved
- `reset("confirm")` clears both IndexedDB and sessionStorage, then reloads

### Cross-Tab Sync

Multiple browser tabs run independent terminal sessions with shared state via `BroadcastChannel` (`src/utils/crossTabSync.ts`). Filesystem patches, WiFi state, mission state, bricked machines, and theme sync across tabs in real time. Session (user, machine, path, SSH stack, FTP/NC mode), terminal output, and command history are per-tab. Graceful no-op fallback when `BroadcastChannel` is unavailable. Dynamic tab title shows `username@machine — JSHACK.ME`.

### Bricked Machine System

`reboot()` (root-only, apt-installable) reboots the current machine. If critical boot files (`/boot/vmlinuz`, `/boot/initrd.img`) are missing, the machine fails to boot and becomes permanently unreachable ("bricked").

- **Boot check**: vmlinuz checked first (GRUB error), then initrd.img (kernel panic). Either missing = bricked.
- **Bricked state**: `brickedMachines: ReadonlySet<string>` in `SessionContext`, persisted to IndexedDB (`brickedMachines` key), synced across tabs via `bricked-changed` message.
- **Connection gating**: `wrapWithBrickedCheck` HOF in `useNetworkCommands.ts` blocks ssh, ftp, nc, ping, nmap, curl, exploit, hydra, gobuster to bricked machines with `"Connection timed out — host <ip> appears to be down"`.
- **Localhost bricking**: If localhost is bricked, Terminal.tsx renders a frozen kernel panic screen (no input, no recovery except clearing browser data via `reset("confirm")` or dev tools).
- **Router bricking**: Bricking a mission router makes the entire internal network unreachable (all connections route through the router's public IP).
- **Cleanup**: Bricked state clears when IndexedDB is cleared (via `reset("confirm")`).

### WiFi Hacking Gate

Network access from localhost requires cracking a WiFi network first. This is a progression gate before network access.

- `wifiConnected` (standalone `useState` in `SessionProvider`, persisted to IndexedDB, synced across tabs) tracks WiFi state
- When `wifiConnected === false` on localhost:
  - `ifconfig()` shows `wlan0` as DOWN (no IP) + loopback `lo`
  - Network commands (ping, nmap, ssh, ftp, nc, curl, nslookup) throw `"Network is unreachable"`
  - `NetworkContext` returns empty machines/DNS lists
- Player flow: `airmon("start", "wlan0")` → `airdump()` → `aircrack("A4:CF:12:D3:8B:7A")` → `nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")` → WiFi connected
- WiFi networks defined in `src/network/wifiNetworks.ts` (4 networks, 1 crackable)
- Commands in `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts`, `nmcli.ts`
- Hook: `src/hooks/useWifiCommands.ts` (manages monitor mode state via `useRef`)
- WiFi gating only applies on localhost; remote machines are unaffected

### Mission System

After completing the 16-flag tutorial, players can take on procedurally generated hacker-for-hire contracts from a darknet marketplace.

- **MissionContext** (`src/mission/MissionContext.tsx`) — React context providing `activeMission`, `startMission`, `abortMission`, `completeMission`, `isMissionActive` via `useMission()` hook
- **App.tsx orchestration** — Mission state lives in `App.tsx`, passed as props to `FileSystemProvider` (`missionFileSystems`) and `NetworkProvider` (`missionNetworkConfig`, `missionRouterMachine`). `MissionProvider` wraps both for command access.
- **Generator** — `generateMissionNetwork(seed)` in `src/generation/generateMission.ts` deterministically produces a full network from a seed string. Seeds can embed keywords to control generation: difficulty (`easy`/`medium`/`hard`), entry variant (`ssh`/`ftp`/`nc`/`exploit`/`http`), network mode (`forwarded`/`router-first`), objective (`exfiltrate`/`tamper`/`credential-theft`/`script-fix`/`sabotage`), domain entry (`domain`), encrypted exfiltrate (`decrypt`). `parseSeedOverrides(seed)` extracts overrides; PRNG sequence is preserved (calls consumed but overridden).
- **Router topology** — Every mission has a real, hackable router (role `'router'`) between localhost and internal machines. Router has a PRNG-varied public IP (from realistic prefixes like 45, 51, 62, 78, etc.) and internal machines on a PRNG-varied private subnet (10.x.x/24, 172.{16-31}.x/24, or 192.168.{2-254}/24). Dual interfaces (public + internal), filesystem with firewall rules and internal machine hints. Two modes: **forwarded** (easier — NAT ports to DMZ, transparent to player) and **router-first** (harder — must hack router first to reach internal network).
- **Entry variants** — Entry machine initial access varies: ssh (classic), ftp (find SSH creds via FTP), nc (find SSH creds via backdoor), exploit (scan with `nmap -sV`, exploit vulnerable port), http (discover SSH creds via `curl` on port 80, possibly in response headers via `-i`). Selected by PRNG per seed. In forwarded mode, variant applies to the internal entry machine; in router-first mode, variant applies to the router.
- **NAT resolution** — `NetworkContext.resolveNat(ip, port)` translates router public IP + port to internal machine IP + port based on iptables rules parsed dynamically from `/etc/iptables/rules.v4` on the router's filesystem (`src/network/iptablesParser.ts`). Applied at SSH/FTP/NC connection boundaries in `Terminal.tsx`. Players can edit the iptables file with `nano` to add/remove forwarding rules — changes take effect on the next connection or `nmap` scan.
- **Commands** — `missions()` browses contracts, `accept(seed)` starts a mission, `abort()` cancels and returns to localhost, `mail(recipient, content)` submits proof to complete
- **Completion** — Player sends proof via `mail("client@darkmail.onion", "proof")`. Five objective types: exfiltrate (find ACCESS-KEY, optionally encrypted — requires `decrypt(file, key)` as root), tamper (modify a file), credential_theft (steal root password), script_fix (fix broken script with nano, run with node — scripts call `_decode(checksum)` which returns the ACCESS-KEY if the checksum is correct, then player mails it to the client), sabotage (gain root, delete `/boot/vmlinuz`, reboot to brick the target machine). The `mail` command verifies proof and calls `completeMission()`.
- **Isolation** — From localhost, only the router's public IP is reachable. Internal machines are discovered after connecting to the router or through forwarded ports. Mission filesystem patches are excluded from IndexedDB persistence.
- **Persistence** — Only the seed string is persisted; full network regenerated on reload

### Node Execution Circular Dependency

`node(path)` needs the execution context which includes `node` itself. Resolved via a lazy getter pattern: mutable `let resolvedExecutionContext` in `useCommands.ts` is set after building the full command map, and node's factory captures a getter that's only called at execution time.

## Styling

- **Theme**: Retro amber-on-black CRT aesthetic
- **Colors**: `text-amber-400`/`text-amber-500` text, `bg-black` background, `text-red-500` errors
- **Font**: Monospace (`font-mono`), full viewport height

## Documentation Maintenance

When making any changes (adding/changing/deleting commands, hooks, machines, utils, features, refactors, bug fixes, etc.), always:

1. **Update `README.md`** if the change affects user-facing documentation (commands, features, setup, etc.)
2. **Update project docs** — check if any of these files need updates:
   - `WIP.md` — current work in progress
   - `LEARNINGS.md` — lessons learned, gotchas, decisions
   - `CLAUDE.md` — project instructions (this file)
   - `.claude/docs/architecture.md` — architecture documentation
   - `.claude/docs/infrastructure-design.md` — Infrastructure design documentation
   - `.claude/docs/mission-variations.md` — mission generation variations catalog
   - `src/*/README.md` — per-module READMEs (commands, network, generation, hooks, etc.)

## Verification After Changes

- **After code changes**: Run `npm run build`, `npm run lint`, `npm run format`, and `npm run test:run` to verify everything passes.
- **After documentation changes (\*.md)**: Run `npm run format` to ensure consistent formatting.

## Deployment

Vercel deployment. Push to `main` triggers automatic deploy.
