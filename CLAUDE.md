# CLAUDE.md

## Project Overview

**JSHACK.ME** is a web-based JavaScript terminal emulator with a retro amber-on-black CRT aesthetic. Features a virtual filesystem with Unix-like permissions for CTF-style hacking puzzles (16 flags). Deployed on Vercel at jshack.me.

## Code Style

**IMPORTANT:** Follow these skills — they are the source of truth for code patterns:

- **Functional programming**: @.claude/skills/functional/SKILL.md
- **TypeScript strict**: @.claude/skills/typescript-strict/SKILL.md

Key rules (see skills for full details):

- `type` over `interface`, `readonly` everywhere, no `any`, no `as Type`
- Immutable data: spread operators, `slice()`, `map()`, `filter()` — never mutate
- Pure functions, early returns, max 2 levels nesting, no comments explaining code

## Build & Development Commands

```bash
npm run dev           # Start Vite dev server (auto-runs encode first)
npm run build         # TypeScript compile + Vite production build (auto-runs encode first)
npm run encode        # Generate encoded filesystems + secrets (__encoded.ts files)
npm run lint          # Run ESLint
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting without modifying (CI-friendly)
npm test              # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage
npm run test:e2e      # Run Playwright E2E test (full CTF playthrough)
```

## Tech Stack

- **React 19** + **TypeScript** — UI framework
- **Vite** — Build tool and dev server
- **Tailwind CSS v4** — Styling (via `@tailwindcss/vite` plugin)
- **Prettier** — Code formatting (single quotes, semicolons, trailing commas, 100 char width)
- **Vitest** + **React Testing Library** — Unit testing
- **Playwright** — E2E testing (Chromium, full CTF playthrough)

## Key Architecture

Detailed architecture: @.claude/docs/architecture.md
CTF design (network, machines, filesystems): @.claude/docs/ctf-design.md
Mission system design (procedural generation, contracts): @.claude/docs/missions-design.md

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

- **guest**: help, man, echo, whoami, pwd, ls, cd, cat, su, clear, author
- **user**: All guest + ifconfig, ping, nmap, nslookup, ssh, ftp, nc, curl, strings, output, resolve, exit, nano, node, airmon, airdump, aircrack, nmcli
- **root**: All user + decrypt

### Content Encoding (Anti-Cheat)

Sensitive content is XOR+Base64 encoded at build time to prevent finding `FLAG{` strings or passwords in the JS bundle.

- `npm run encode` generates `src/filesystem/machines/__encoded.ts` and `src/secrets/__encoded.ts` (both gitignored)
- `predev`/`prebuild` hooks auto-run encode
- `machineFileSystems.ts` imports from filesystem `__encoded.ts`, not source machine files
- `wifiNetworks.ts` imports from secrets `__encoded.ts`, not the plaintext `src/secrets/secrets.ts`
- Unit tests import source files directly (unaffected by encoding)
- Verify: `grep -r "FLAG{" dist/` and `grep -r "cr4ck3d_w1f1" dist/` after build should return zero matches

### Secrets Registry

`src/secrets/secrets.ts` defines sensitive non-filesystem strings (e.g., WiFi password) as key-value pairs. The `encode` script encodes them into `src/secrets/__encoded.ts`. App code imports from `__encoded`, tests import from the source file directly.

To add a new secret: add the key-value pair to `src/secrets/secrets.ts`, then run `npm run encode`.

### Special Output Types

Commands return objects with `__type` for custom rendering (see `src/components/Terminal/types.ts`):

- `'clear'`, `'author'`, `'password_prompt'`, `'nano_open'`, `'async'`
- `AsyncOutput` streams lines with delays for network commands (ping, nmap, ssh, nslookup)

### Persistence

Session and filesystem state persist to IndexedDB (`jshack-db` database):

- `storageCache.ts` pre-loads data before React mounts (sync cache for `useState` initializers)
- `SessionContext` and `FileSystemContext` write updates via `useEffect` (async, fire-and-forget)
- Filesystem uses a patches approach — only diffs from base filesystem are stored
- `reset("confirm")` clears IndexedDB and reloads to factory state

### WiFi Hacking Gate

Network access from localhost requires cracking a WiFi network first. This is a progression gate (not a flag) between flags 3 and 4.

- `session.wifiConnected` (boolean, persisted) tracks WiFi state
- When `wifiConnected === false` on localhost:
  - `ifconfig()` shows `wlan0` as DOWN (no IP) + loopback `lo`
  - Network commands (ping, nmap, ssh, ftp, nc, curl, nslookup) throw `"Network is unreachable"`
  - `NetworkContext` returns empty machines/DNS lists
- Player flow: `airmon("start", "wlan0")` → `airdump()` → `aircrack("A4:CF:12:D3:8B:7A")` → `nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")` → WiFi connected
- WiFi networks defined in `src/network/wifiNetworks.ts` (4 networks, 1 crackable)
- Commands in `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts`, `nmcli.ts`
- Hook: `src/hooks/useWifiCommands.ts` (manages monitor mode state via `useRef`)
- WiFi gating only applies on localhost; remote machines are unaffected

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
   - `PLAN.md` — planned features and roadmap
   - `LEARNINGS.md` — lessons learned, gotchas, decisions
   - `CLAUDE.md` — project instructions (this file)
   - `.claude/docs/architecture.md` — architecture documentation
   - `.claude/docs/ctf-design.md` — CTF design documentation

## Verification After Changes

- **After code changes**: Run `npm run build`, `npm run lint`, `npm run format`, and `npm run test:run` to verify everything passes.
- **After documentation changes (\*.md)**: Run `npm run format` to ensure consistent formatting.

## Deployment

Vercel deployment. Push to `main` triggers automatic deploy.
