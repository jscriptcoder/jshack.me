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

- **Shell builtins** (cd, exit, clear, echo, pwd, help, whoami) — always available, no binary needed
- **Game commands** (missions, accept, abort, mail, output, resolve, author, theme, reset, xterm) — always available
- **System utilities** in `/bin/` — always present, world-executable (except `reboot`: root-only)
- **Apt-installable tools** in `/usr/bin/` — require `apt install` as root (needs network); only WiFi tools (airmon, airdump, aircrack), node, and gpg are pre-installed on localhost; world-executable once installed (except `gpg`: root-only)
- **Root-only binaries**: `reboot` and `gpg` have `execute: ['root']`

### Filesystem Permissions

Unix-realistic permission model with owner-scoped access and directory traversal checking. See `architecture.md` for full details (owner-scoped permissions, `worldReadable` flag, `checkTraversal`, `cd` execute vs read).

### Tool Availability (apt install)

Hacking tools must be installed via `apt('install', '<tool>')` as root. On localhost, only WiFi tools (airmon, airdump, aircrack), node, and gpg are pre-installed; all other tools require `apt install` after connecting to WiFi. `apt install` requires network connectivity — on localhost, WiFi must be connected first. The availability system (`src/commands/availability.ts`) wraps commands with `wrapWithAccessCheck` which checks binary existence and execute permissions at execution time.

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

### Persistence, Cross-Tab Sync, Bricked Machines, WiFi Gate

See `architecture.md` for full details. Key points:

- **sessionStorage** (per-tab): session state. **IndexedDB** (shared): filesystem patches, WiFi, mission seed, bricked machines.
- `BroadcastChannel` syncs filesystem patches, WiFi, missions, bricked machines, and theme across tabs.
- `reboot()` bricks machines missing `/boot/vmlinuz` or `/boot/initrd.img`. Bricked machines are unreachable.
- WiFi must be cracked before network access on localhost. See `infrastructure-design.md` for networks/flow.
- SSH key persistence: after first SSH/SCP password auth, `~/.ssh_keys` on the source machine stores `user@ip` entries. Subsequent connections auto-authenticate.

### Mission System

See `architecture.md` for integration details, `mission-variations.md` for all generation axes.

- `generateMissionNetwork(seed)` deterministically produces a full network. Seeds embed keywords for overrides (difficulty, entry variant, network mode, objective, domain, gpg, snmp).
- Provider hierarchy: `SessionProvider → MissionProvider → FileSystemProvider → NetworkProvider → Terminal`
- Commands: `missions()`, `accept(seed)`, `abort()`, `mail(recipient, content)`
- Five objectives: exfiltrate, tamper, credential_theft, script_fix, sabotage
- NAT resolution via `resolveNat(ip, port)` using iptables rules on router filesystem

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
