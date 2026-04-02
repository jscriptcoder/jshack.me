# CLAUDE.md

## Project Overview

**JSHACK.ME** is a web-based JavaScript terminal emulator with a retro amber-on-black CRT aesthetic. Features a virtual filesystem with Unix-like permissions for mission-based hacking challenges with procedurally generated contracts. Players start via an intro screen, choose their workstation name, username, and root password, boot into a Linux-style terminal, crack WiFi networks (each providing access to a different subnet of machines), and take contracts from a darknet marketplace. Deployed on Vercel at jshack.me.

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
npm run encode        # Generate encoded secrets (__encoded.ts file)
npm run lint          # Run ESLint
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting without modifying (CI-friendly)
npm test              # Run tests in watch mode (auto-runs encode first)
npm run test:run      # Run tests once (auto-runs encode first)
npm run test:coverage # Run tests with coverage (auto-runs encode first)
npm run test:e2e      # Run Playwright E2E test (mission playthrough)
```

### Debug Scripts

Use these scripts to inspect generated networks when debugging mission or home network issues. Prefer these over writing ad-hoc scripts.

```bash
# Dump a full mission network (machines, ports, users, objective, filesystems)
npx tsx scripts/dumpMissionNetwork.ts <seed>

# Dump home networks for a game seed (all crackable WiFi, or a specific index)
npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex]

# View full content of a specific file on a machine (works on both scripts)
npx tsx scripts/dumpMissionNetwork.ts <seed> --cat <ip|hostname>:<path>
npx tsx scripts/dumpHomeNetwork.ts <gameSeed> <wifiIndex> --cat <ip|hostname>:<path>
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
Mission variations catalog (all generation axes): @.claude/docs/mission-variations.md

### Command Execution Flow

User input flows through `Terminal.tsx`:

1. Checked for variable operations (`const`/`let`) via `useVariables` hook
2. Otherwise executed as command via `new Function()` with commands/variables injected into scope

### Adding New Commands

1. Create file in `src/commands/` exporting a `Command` object (see `src/components/Terminal/types.ts` for type)
2. Register in `src/hooks/useCommands.ts` via `commands.set('name', myCommand)`
3. If it needs a binary, add to `SYSTEM_UTILITY_NAMES` (for `/bin/`) or `APT_TOOL_NAMES` (for `/usr/bin/`) in `src/commands/availability.ts`
4. If it should be root-only, add to `RESTRICTED_EXECUTE` in `availability.ts`

### Command Access Control

Commands use a unified filesystem-based access model (`src/commands/availability.ts`). All commands are visible to all users in `help()` and tab-complete. Execution is gated by binary file permissions:

- **Shell builtins** (cd, exit, clear, echo, pwd, help, whoami, bash) — always available, no binary needed
- **Game commands** (missions, accept, abort, mail, output, resolve, author, theme, reset, xterm) — always available
- **System utilities** in `/bin/` — always present, world-executable (except `reboot`: root-only)
- **Apt-installable tools** in `/usr/bin/` — require `apt install` as root (needs network); only WiFi tools (airmon, airdump, aircrack), node, and gpg are pre-installed on localhost; world-executable once installed (except `gpg`: root-only)
- **Admin utilities** in `/usr/sbin/` — root-only daemon management (`sshd`, `vsftpd`, `systemctl`); write PID files to `/var/run/` for dynamic port opening via `NetworkContext`
- **Backdoor listener** — `nc("-l", port)` opens a listener on any machine; part of `netcat` apt package (`/usr/bin/nc`); any user can run it but ports < 1024 require root; writes `/var/run/nc-<port>.pid` with owner info
- **Root-only binaries**: `reboot`, `gpg`, `sshd`, `vsftpd`, and `systemctl` have `execute: ['root']`

### Filesystem Permissions

Unix-realistic permission model with owner-scoped access and directory traversal checking. See `architecture.md` for full details (owner-scoped permissions, `worldReadable` flag, `checkTraversal`, `cd` execute vs read).

### Tool Availability (apt install)

Hacking tools must be installed via `apt('install', '<tool>')` as root. On localhost, only WiFi tools (airmon, airdump, aircrack), node, and gpg are pre-installed; all other tools require `apt install` after connecting to WiFi. `apt install` requires network connectivity — on localhost, WiFi must be connected first. The availability system (`src/commands/availability.ts`) wraps commands with `wrapWithAccessCheck` which checks binary existence and execute permissions at execution time.

The filesystem factory (`fileSystemFactory.ts`) creates `/boot/`, `/bin/`, and `/usr/bin/` directories on all machines. `mergeExtraDirectories()` handles one-level-deep merging to prevent mission generation's `extraDirectories` from overwriting factory directories.

### Content Encoding (Anti-Cheat)

Sensitive content is XOR+Base64 encoded at build time to prevent finding flag strings or passwords in the JS bundle.

- `npm run encode` generates `src/secrets/__encoded.ts` (gitignored)
- `predev`/`prebuild`/`pretest`/`pretest:run`/`pretest:coverage` hooks auto-run encode
- `wifiNetworks.ts` imports from secrets `__encoded.ts`, not the plaintext `src/secrets/secrets.ts`
- `generateWifi.ts` imports WiFi passwords from secrets `__encoded.ts`
- `pools/` modules import mission passwords from secrets `__encoded.ts` (not hardcoded in source)
- Unit tests import source files directly (unaffected by encoding)
- Verify: `grep -r "FLAG{" dist/` and `grep -r "cr4ck3d_w1f1" dist/` after build should return zero matches (mission flags are generated at runtime, not embedded in the bundle)

### Secrets Registry

`src/secrets/secrets.ts` defines sensitive non-filesystem strings (e.g., WiFi password, mission passwords) as key-value pairs. The `encode` script encodes them into `src/secrets/__encoded.ts`. App code imports from `__encoded`, tests import from the source file directly.

Current secrets: `WIFI_PASSWORD` (legacy static WiFi password), `WIFI_PASSWORDS` (JSON-stringified array of 40 passwords for seeded WiFi generation), `MISSION_PASSWORDS` (JSON-stringified array of 120 passwords used by mission generator), `GUEST_PASSWORDS` (JSON-stringified array of 20 guest passwords used by mission generator), `SNMP_COMMUNITIES` (JSON-stringified array of 24 SNMP read-write community strings used by mission generator and hydra SNMP brute-force).

To add a new secret: add the key-value pair to `src/secrets/secrets.ts`, then run `npm run encode`.

### MySQL Client

`mysql(host, username[, password])` connects to a remote machine's MySQL database (port 3306). Requires `apt install mysql`. Enters an interactive `mysql>` prompt with regex-parsed SQL:

- **Supported**: `SHOW TABLES`, `DESCRIBE`, `SELECT` (with `WHERE col = 'val' [AND ...]`), `UPDATE`, `DELETE FROM`, `DROP TABLE`, `exit`/`quit`
- **Error tiers**: known keyword + bad syntax → MySQL error 1064; unrecognized/complex → "Unsupported SQL syntax" message; table/column not found → real MySQL error codes
- **Data model**: Single database per machine stored as `/var/lib/mysql/data.json`. Generated deterministically for machines with port 3306 open (database role). Contains 2-4 tables (always `users` + random picks from sessions, api_keys, config, audit_log)
- **Persistence**: Mutations (UPDATE, DELETE, DROP) write modified JSON back via `writeFileToMachine` — reuses existing filesystem patch/IndexedDB/cross-tab sync
- **Session**: `MysqlSession` in `SessionContext` — `mysql>` prompt, bypasses `new Function()` in Terminal.tsx, routes raw SQL input to the executor
- **Auth**: MySQL has its own credential system (`MysqlCredential[]` in `MysqlDatabase.credentials`), separate from system users. Generated by `generateDatabase()` with passwords from the `MISSION_PASSWORDS`/`GUEST_PASSWORDS` pools. Each database gets a MySQL root, 1 app user (from `mysqlUsernames` pool), and ~50% chance of a `readonly` guest. DB-themed credential leak templates (`credentialType: 'mysql'`) are populated with MySQL credentials instead of system credentials. Hydra supports `hydra(ip, 'mysql')` to brute-force MySQL credentials (explicit only, like SNMP)
- **Implementation**: `src/commands/mysql/` (parser, executor, formatter, types), `src/commands/mysql.ts` (command entry point), `src/hooks/useMysqlCommands.ts` (hook)

### Connection Logging

`src/logging/` records SSH, FTP, SCP, su, MySQL, and HTTP auth events to target machine log files in realistic Linux formats. Terminal.tsx defines logging callbacks (`onSuAuth`, `onSshAuth`, `onFtpAuth`, `onMysqlAuth`) passed into `useAuthentication`. Log entries persist via IndexedDB patches and sync across tabs. See `src/logging/README.md` for full details and `architecture.md` for integration.

- `/var/log/auth.log` — SSH, SCP, su (syslog format)
- `/var/log/vsftpd.log` — FTP (vsftpd format)
- `/var/log/mysql.log` — MySQL connections (MySQL general log format)
- `/var/log/access.log` — curl HTTP requests (Apache Combined format)

### Special Output Types

Commands return objects with `__type` for custom rendering (see `src/components/Terminal/types.ts`):

- `'clear'`, `'author'`, `'password_prompt'`, `'nano_open'`, `'async'`
- `AsyncOutput` streams lines with delays for network commands (ping, nmap, ssh, nslookup)

### Game State, Intro Screen, Boot Screen

The game starts with an intro screen (`src/components/IntroScreen.tsx`) where the player fills a single-screen 3-field form (workstation name, username, root password) for "New Game" or clicks "Continue" (loads existing game). New games show a Linux boot sequence (`src/components/BootScreen.tsx`) before the terminal.

- `GameState = { seed, workstationName, username, rootPassword }` persisted in IndexedDB (`src/game/types.ts`)
- Game seed drives WiFi network generation and home network generation (deterministic)
- Terminal prompt shows hostname: `session.hostname ?? session.machine`. On localhost, an effect syncs `workstationName` into `session.hostname`. On SSH'd machines, hostname is set from the remote machine's network config during connection.
- Player username is configurable (no longer hardcoded); appears in prompt, home directory, and `/etc/passwd`
- Root password is player-chosen; guest password is seed-derived from the guest passwords pool
- Player's own user has no password (empty hash in `/etc/passwd`)
- Localhost is generated at runtime via `generateLocalhost(gameState)` in `src/generation/generateLocalhost.ts`
- `reset("confirm")` wipes all data and returns to the intro screen
- App screen flow: `IntroScreen → BootScreen (new game only) → Terminal`

### Persistence, Cross-Tab Sync, Bricked Machines, WiFi Gate

See `architecture.md` for full details. Key points:

- **sessionStorage** (per-tab): session state. **IndexedDB** (shared): filesystem patches, WiFi connection, mission seed, bricked machines, game state.
- `BroadcastChannel` syncs filesystem patches, WiFi, missions, bricked machines, and theme across tabs.
- WiFi state is `WifiConnection | null` (tracks `{ essid, bssid }`, not a boolean). Stored in IndexedDB, synced via BroadcastChannel.
- `reboot()` bricks machines missing `/boot/vmlinuz` or `/boot/initrd.img`. Bricked machines are unreachable.
- Multiple WiFi networks are generated per game seed. Each provides access to a layered network of machines. Home networks use the same multi-layer topology as missions (easy=1 layer, medium=2 layers, hard=3 layers) with a random difficulty per WiFi network. All network machines come from `generateHomeNetwork()` per WiFi connection, which delegates to the shared `generateNetwork()` pipeline. `useHomeNetworks` accumulates `usedIps` across WiFi networks to guarantee unique public IPs. See `infrastructure-design.md`.
- SSH key persistence: after first SSH/SCP password auth, `~/.ssh_keys` on the source machine stores `user@ip` entries. Subsequent connections auto-authenticate.

### Mission System

See `architecture.md` for integration details, `mission-variations.md` for all generation axes.

- `generateMissionNetwork(seed, usedIps?)` deterministically produces a multi-layer subnet topology. Seeds embed keywords for overrides (difficulty, entry variant, network mode, objective, domain, gpg, snmp). When `usedIps` is provided, the router's public IP is guaranteed unique (re-rolls on collision). Shared IP utilities in `src/generation/ip.ts` provide `generatePublicIp` and `generatePrivateSubnet` — used by both mission and home network generation. Missions and home networks share building blocks: topology (`topology.ts`), users (`users.ts`), enrichment (`enrichment.ts`), and filesystem helpers (`filesystem/`). Home networks use the shared `generateNetwork()` pipeline (`src/generation/generateNetwork.ts`) that composes these. Missions have their own orchestration in `generateMission.ts` for PRNG sequence stability.
- Subnet layers: easy=1 layer (2 machines), medium=2 layers (5-7 machines), hard=3 layers (8-11 machines). Each layer has its own entry variant and private subnet. Gateways are dual-homed router-role machines with interfaces in both adjacent subnets. Subnet isolation enforced via NetworkConfig — machines in one layer cannot see machines in other layers. Target is always in the deepest layer (except portforward which targets layer 0). Seed keywords for entry variant and network mode apply to the outermost layer only.
- Provider hierarchy: `SessionProvider → GameSession (useHomeNetworks, generateLocalhost) → MissionProvider → FileSystemProvider → NetworkProvider → Terminal`
- Commands: `missions()`, `accept(seed)`, `abort()`, `mail(recipient, content)`
- Fourteen objectives: exfiltrate, tamper, credential_theft, script_fix, script_auto, sabotage, backdoor, portforward, forensics, malware, db_exfiltrate, db_tamper, db_sabotage, db_fix
- NAT resolution via `resolveNat(ip, port)` using iptables rules on any gateway's filesystem (border router and inner gateways). SNMP firewall overrides also apply to all gateways — inner gateways with SNMP access variant get `snmpd.conf` and respond to `snmpset` for dynamic port opening. `NetworkContext` handles layered home networks the same way — gateway iptables/SNMP parsing, layer-aware localhost visibility, and `.1` IP aliases for inner gateways.
- **Switch gateways**: Inner gateways can be managed Layer 3 switches (`GatewayType = 'switch'`) instead of routers. Switches use ACL deny rules (`/etc/switch/acl.conf`) instead of NAT/iptables. No address translation — when ACLs are cleared, traffic reaches downstream IPs directly. SNMP on switches uses ACL OIDs (`aclSSH`, `aclHTTP` with `allow`/`deny` values) instead of firewall OIDs (`firewallSSH`/`firewallHTTP` with `permit`/`deny`). Switch gateways are activated via the `switch` seed keyword for missions or a ~40% PRNG roll for home networks. Border gateway is always a router.
- **Basic SNMP on gateways**: Non-SNMP-variant inner gateways have a difficulty-based PRNG chance (easy 80%, medium 60%, hard 40%) of having basic read-only SNMP enabled. **Basic read-only**: `rocommunity public` only — interface OIDs for subnet discovery, no credential leaks, no firewall/ACL OIDs. Full SNMP configs (SNMP-variant gateways) also include credential leaks and firewall/ACL OIDs. One PRNG roll is consumed per gateway for sequence stability.

### Node Execution

`node(path)` executes JavaScript files with access to all terminal commands. Two execution modes:

- **Sync mode** (default): Uses `new Function()`. Expression-first, falls back to statement mode. Echo calls are buffered and joined.
- **Async mode** (when script contains `await`): Uses `AsyncFunction` constructor. Returns `AsyncOutput` to Terminal for streaming. Commands returning `AsyncOutput` (hydra, nmap, etc.) are auto-wrapped so `await hydra(...)` resolves to `string[]`. Provides `console.log()`, `sleep(ms)`, and cancellation via Ctrl+C.

**Programmatic auth in scripts**: Interactive commands accept optional credentials for scripting: `su('root', 'pw')` (sync inline auth), `await ssh('user@ip', 'pw')`, `await scp(src, dst, 'pw')`, `await ftp('ip', 'user', 'pw')`. `su` is synchronous so subsequent lines run as the new user. SSH/SCP/FTP embed credentials in their async follow-up data.

**Circular dependency**: `node(path)` needs the execution context which includes `node` itself. Resolved via a lazy getter pattern: mutable `let resolvedExecutionContext` in `useCommands.ts` is set after building the full command map, and node's factory captures a getter that's only called at execution time.

## Styling

- **Theme**: Retro amber-on-black CRT aesthetic
- **Colors**: `text-amber-400`/`text-amber-500` text, `bg-black` background, `text-red-500` errors
- **Font**: Monospace (`font-mono`), full viewport height

## Documentation Maintenance

When making any changes (adding/changing/deleting commands, hooks, machines, utils, features, refactors, bug fixes, etc.), always:

1. **Update `README.md`** if the change affects user-facing documentation (commands, features, setup, etc.)
2. **Update project docs** — check if any of these files need updates:
   - `.claude/CLAUDE.md` — project instructions (this file)
   - `.claude/docs/architecture.md` — architecture documentation
   - `.claude/docs/infrastructure-design.md` — Infrastructure design documentation
   - `.claude/docs/mission-variations.md` — mission generation variations catalog
   - `src/*/README.md` — per-module READMEs (commands, network, generation, hooks, etc.)

## Verification After Changes

- **After code changes**: Run `npm run build`, `npm run lint`, `npm run format`, and `npm run test:run` to verify everything passes.
- **After documentation changes (\*.md)**: Run `npm run format` to ensure consistent formatting.

## Deployment

Vercel deployment. Push to `main` triggers automatic deploy.
