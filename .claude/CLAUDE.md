# CLAUDE.md

## Project Overview

**JSHACK.ME** is a web-based Linux-style terminal emulator with a retro amber-on-black CRT aesthetic. Interactive input uses a shell parser (commands, args, flags, single/double quotes, pipes `|`, redirect `>`); scripts (`.js` files executed via `node`) use JavaScript with command function calls. Features a virtual filesystem with Unix-like permissions for mission-based hacking challenges with procedurally generated contracts. Players start via an intro screen, choose their workstation name, username, and root password, boot into a Linux-style terminal, crack WiFi networks (each providing access to a different subnet of machines), and take contracts from a darknet marketplace. Deployed on Vercel at jshack.me.

## Code Style

**IMPORTANT:** Follow these skills — they are the source of truth for code patterns:

- **Functional programming**: @.claude/skills/functional/SKILL.md
- **TypeScript strict**: @.claude/skills/typescript-strict/SKILL.md

Development guidelines (TDD, workflow, testing principles): @.claude/docs/development-guidelines.md

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

# Simulate msfconsole(ip, port): reports CVE, effect, attack pattern, NAT chain — without running the game
npx tsx scripts/simulateExploit.ts home <gameSeed> <wifiIndex> <ip> <port> [--gameTime <days>]
npx tsx scripts/simulateExploit.ts mission <seed> <ip> <port> [--gameTime <days>]
```

## Key Architecture

Detailed architecture: @.claude/docs/architecture.md
Infrastructure design (network, machines, filesystems): @.claude/docs/infrastructure-design.md
Mission variations catalog (all generation axes): @.claude/docs/mission-variations.md

## Documentation Maintenance

When making any changes (adding/changing/deleting commands, hooks, machines, utils, features, refactors, bug fixes, etc.), always:

1. **Update `README.md`** if the change affects user-facing documentation (commands, features, setup, etc.)
2. **Update project docs** — check if any of these files need updates:
   - `.claude/docs/architecture.md` — architecture documentation
   - `.claude/docs/infrastructure-design.md` — Infrastructure design documentation
   - `.claude/docs/mission-variations.md` — mission generation variations catalog
   - `src/*/README.md` — per-module READMEs (commands, network, generation, hooks, etc.)

## Verification After Changes

- **After code changes**: Run `npm run build`, `npm run lint`, `npm run format`, and `npm run test:run` to verify everything passes.
- **After documentation changes (\*.md)**: Run `npm run format` to ensure consistent formatting.

## Deployment

Vercel deployment. Push to `main` triggers automatic deploy.
