# CLAUDE.md

## Project Overview

**JSHACK.ME** is a web-based Linux-style terminal emulator with a retro amber-on-black CRT aesthetic. Interactive input uses a shell parser (commands, args, flags, single/double quotes, pipes `|`, redirect `>`); scripts (`.js` files executed via `node`) use JavaScript with command function calls. Features a virtual filesystem with Unix-like permissions for mission-based hacking challenges with procedurally generated contracts. Players start via an intro screen, choose their workstation name, username, and root password, boot into a Linux-style terminal, crack WiFi networks (each providing access to a different subnet of machines), and take contracts from a darknet marketplace. Deployed on Vercel at jshack.me.

## Code Style

**IMPORTANT:** Follow these skills — they are the source of truth for code patterns:

- **Functional programming**: @.claude/skills/functional/SKILL.md
- **TypeScript strict**: @.claude/skills/typescript-strict/SKILL.md

Development guidelines (TDD, workflow, testing principles): @docs/development-guidelines.md

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

# Inspect a single mission machine's port state — forcedEffect, version, findExploitableCve result per open port.
# Useful for verifying CVE/effect assignment when the runtime disagrees with expectations.
npx tsx scripts/inspectPort.ts <seed> <targetIp> [<gameTimeDays>]

# L2 base-FS backfill — regenerate every existing home_networks row's FS and bulk-populate machine_filesystems.
# Idempotent (ON CONFLICT DO NOTHING). Use --dry-run to preview row counts before live writes.
npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts [--dry-run]

# L2 base-FS backfill for world_networks (findit.io, playground, future themed nets). World rows ship via
# SQL migration, so re-run this after any new themed-network migration to populate machine_filesystems.
# Same idempotent semantics as the home backfill.
npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorldNetworkBaseFs.ts [--dry-run]

# L2 base-FS backfill for workstations — regenerate every workstations row's FS and bulk-populate
# machine_filesystems. Idempotent (ON CONFLICT DO NOTHING). The api/register-workstation endpoint
# handles go-forward; this script catches any pre-existing rows or populate misses.
npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorkstationBaseFs.ts [--dry-run]

# Verify the L2 RLS posture on the machine_filesystems table (anon denied, service_role allowed).
npx dotenv -e .env.development.local -- npx tsx scripts/verifyMachineFilesystemsRls.ts

# Verify the L2 RLS posture on the workstations table (anon denied, service_role allowed).
# Same shape as verifyMachineFilesystemsRls — 5 probes, expects 5/5 after the migration applies.
npx dotenv -e .env.development.local -- npx tsx scripts/verifyWorkstationsRls.ts

# Verify the L2 dual-write SQL functions behave correctly (upsert/remove with own-workstation bypass).
npx dotenv -e .env.development.local -- npx tsx scripts/verifyDualWrite.ts

# Forge signed envelopes against /api/patches and verify L2 enforces (3/3 scenarios: no_session 403,
# permission_denied 403, root 200). Requires vercel:dev running. Optional --machine-id <ip> to scope to a
# specific machine (e.g. 192.0.2.80 for findit.io); without it picks any restrictive row in machine_filesystems.
npx dotenv -e .env.development.local -- npx tsx scripts/testL2Bypass.ts [--machine-id <ip>]

# Forge signed envelopes against /api/patches and verify the L1 ambient-log-path allowlist (handler.ts
# AMBIENT_LOG_FILES). 14 cases: 8 allowlisted log files bypass to 200, 6 non-allowlisted /var/log/ paths
# (incl. /var/log/payload.sh, subdirs, rotated suffixes) gate to 403 no_session. Self-cleaning. Requires
# vercel:dev running.
npx dotenv -e .env.development.local -- npx tsx scripts/testAmbientLogAllowlist.ts

# Forge signed envelopes against /api/patches listPatchesForMachines and verify the read-path filter
# (3/3 scenarios: no-session caller drops secrets keeps allowlist, guest-session caller's walker drops
# root-only keeps allowlist, owner gets everything). Self-cleaning. Requires vercel:dev running.
npx dotenv -e .env.development.local -- npx tsx scripts/testReadPathPrivacy.ts

# End-to-end smoke for /api/register-workstation against vercel:dev. 8 checks: fresh-register 201,
# idempotent-repeat 200, conflicting-repeat 409, tampered-signature 401, plus DB-side row + machine_filesystems
# count + /etc/passwd presence. Self-cleaning so it can be re-run idempotently.
npx dotenv -e .env.development.local -- npx tsx scripts/testRegisterWorkstation.ts

# L2 bypass verifier scoped to a freshly-registered workstation. Registers a workstation through the real
# endpoint, then runs the same 3-scenario test (no_session/permission_denied/root) against its workstation_id.
# Closes the loop on chunk #1b: proves intruders with cracked sessions on a player's own box can't bypass L2.
npx dotenv -e .env.development.local -- npx tsx scripts/testL2BypassWorkstation.ts

# Server-side userType validation smoke test. Forges signed envelopes against /api/sessions
# (createSession) and verifies four scenarios: usertype_mismatch (400), usertype_underivable (400),
# legitimate match (200), and mission stand-in no-op (200). Self-cleaning so it can be re-run idempotently.
# Requires vercel:dev running and at least one machine_filesystems row with non-null /etc/passwd content
# (re-run scripts/backfillHomeNetworkBaseFs.ts after the selective-content migration applies).
npx dotenv -e .env.development.local -- npx tsx scripts/testCreateSessionUserType.ts
```

## Key Architecture

Detailed architecture: @docs/architecture.md
Infrastructure design (network, machines, filesystems): @docs/infrastructure-design.md
Mission variations catalog (all generation axes): @docs/mission-variations.md
Phase 5 technology decisions: @docs/technology-choices.md

## Documentation Maintenance

When making any changes (adding/changing/deleting commands, hooks, machines, utils, features, refactors, bug fixes, etc.), always:

1. **Update `README.md`** if the change affects user-facing documentation (commands, features, setup, etc.)
2. **Update project docs** — check if any of these files need updates:
   - `docs/architecture.md` — architecture documentation
   - `docs/infrastructure-design.md` — Infrastructure design documentation
   - `docs/mission-variations.md` — mission generation variations catalog
   - `docs/technology-choices.md` — Phase 5 stack decisions (rationale + alternatives)
   - `src/*/README.md` — per-module READMEs (commands, network, generation, hooks, etc.)

## Verification After Changes

- **After code changes**: Run `npm run build`, `npm run lint`, `npm run format`, and `npm run test:run` to verify everything passes.
- **After documentation changes (\*.md)**: Run `npm run format` to ensure consistent formatting.

## Deployment

Vercel deployment. Push to `main` triggers automatic deploy.
