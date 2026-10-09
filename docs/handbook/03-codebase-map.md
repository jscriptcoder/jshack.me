# 3. Codebase map

A folder-by-folder reference: what lives where, and which chapter explains it. Use it to find the
file you need; read [chapter 1](./01-architecture.md) first for why the folders are split this way.

Sizes are as of v0.278.0 (2026-09-27): about 64,700 lines of non-test TypeScript in `src/`, 2,500 in
`api/`, and 28,000 in `scripts/` (mostly wire-checks).

## Top level

```text
index.html              Static page shell: meta tags, favicon, <div id="root">, loads src/main.tsx
src/                    The game (client) and the shared core
api/                    The three Vercel Functions (every file here is an endpoint)
scripts/                Build helpers, wire-checks, operator scripts
supabase/               Database migrations and local stack config
public/                 Static assets served as-is (favicon, social image, robots.txt, sitemap.xml)
docs/                   Documentation (this handbook, as-built deep dives, legacy notes)
.claude/                AI-assistant instructions and the e2e runbook skill (see below)
package.json            Scripts, dependencies, the version shown in the boot banner
vite.config.ts          Vite build + Vitest config
tsconfig*.json          Project references: app (src/) and node (vite.config.ts, api/, scripts/)
eslint.config.js        Lint rules, including "relative imports end in .js"
stryker.config.json     Mutation testing config (mutates src/core only)
vercel.json             { "regions": ["fra1"] }
.env.development.local  Local Supabase URL and keys (git-ignored; you create it)
```

Generated or local-only, all git-ignored: `dist/` (build output), `node_modules/`, `reports/` (Stryker
output), `.stryker-tmp/` (Stryker sandboxes), `.vercel/` (project link), `src/core/secrets/__encoded.ts`
(written by `npm run encode`), `*.tsbuildinfo`.

## `src/`: the client and the shared core

```text
src/
  main.tsx          Entry point: paint theme, spend ?fresh, render <App>
  index.css         Tailwind import and fallback theme colours
  vite-env.d.ts     Declares __APP_VERSION__
  ui/               Solid screens and all client state            → chapter 4
  adapters/         Signed HTTP clients and the tab channel       → chapter 9
  core/             Framework-free game logic, shared with api/   → chapters 5–10
  test/             Test setup and factories                      → chapter 11
```

### `src/ui/`

| File or folder                                    | Contents                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `state.ts`                                        | All client state (module-level signals), boot, command execution, sync.                |
| `env.ts`                                          | `buildCommandEnv`: builds the object each command receives.                            |
| `activeRoot.ts`                                   | Which filesystem tree the shell is standing in.                                        |
| `sessionRehydrate.ts`                             | Rebuild the hop stack from server session rows after a reload.                         |
| `connectionPersistence.ts`, `themePersistence.ts` | Small `localStorage` helpers.                                                          |
| `identity.ts`, `seed.ts`                          | Page-lifetime identity memo; the player's own base session and tree.                   |
| `renderPage.ts`                                   | HTML → text lines for the `lynx` browser.                                              |
| `freshTab.ts`, `sleep.ts`, `banner.ts`            | `?fresh` flag, abortable sleep, the ASCII banner.                                      |
| `theme/applyTheme.ts`                             | Writes the palette as CSS custom properties.                                           |
| `screens/`                                        | `App`, `Intro`, `BootScreen`, `Terminal`, `TerminalLoading`, `Nano`, `Lynx`, `Author`. |

### `src/adapters/`

`patchApi.ts` (`/api/patches`), `networkApi.ts` (`/api/network`), `sessionsApi.ts` (`/api/sessions`),
`crossTabSync.ts` (`BroadcastChannel`). There is no database or IndexedDB adapter.

### `src/core/`

| Folder             | What it holds                                                                                                             | Chapter |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| `types.ts`         | Branded primitive types (`MachineId`, `AbsPath`, `PlayerKeyHex`, `EpochMs`) and `UserType`.                               | —       |
| `shell/`           | Tokenizer, pipeline parser, flag binder, `runCommandLine`, completion, prompt, history.                                   | 5       |
| `commands/`        | The `Command` contract (`types.ts`), the registry, availability gates, one file per command, sub-shells.                  | 5       |
| `scripting/`       | The `node` sandbox.                                                                                                       | 5       |
| `packages/`        | The `apt` catalog, the dpkg manifest, version templates.                                                                  | 5, 8    |
| `wordlist/`        | The shipped wordlist and the one cracking rule.                                                                           | 5       |
| `generation/`      | World generation: PRNG, topology, machine builders, content builders, `pools/` of authored text, `device/` for IoT kinds. | 6       |
| `identity/`        | Keypairs, signing, machine-id derivations.                                                                                | 6, 9    |
| `gameConfig/`      | New-game choices and validation.                                                                                          | 4, 6    |
| `secrets/`         | Spoiler pools and their obfuscation codec.                                                                                | 6       |
| `services/`        | The service catalog and the pidfile reader ("what is running").                                                           | 6, 7    |
| `filesystem/`      | Tree types, paths, journal replay, the shared permission walker, the filesystem view.                                     | 7       |
| `network/`         | Interfaces, WiFi, addressing, allocators, firewall files, reachability resolvers, DNS, the web, cross-player reads.       | 7       |
| `scan/`            | What `nmap` shows from each vantage, and the scan traces.                                                                 | 7       |
| `snmp/`            | SNMP config files, walk rendering, set grammar.                                                                           | 7       |
| `sessions/`        | Server handlers for every login door, elevation, exploit, sweep, database/store/SNMP door, reboot.                        | 8       |
| `mysql/`, `redis/` | Datadir schemas and statement engines for the database and key-value store.                                               | 8       |
| `cve/`             | The world clock and the vulnerability derivation.                                                                         | 8       |
| `findit/`          | The in-game search engine.                                                                                                | 8       |
| `logging/`         | One formatter per log file; source-IP and writer-key rules.                                                               | 8       |
| `patches/`         | Server handlers for the journal (write, list, remove, log appends, traces), L1, L2, the read filter.                      | 9, 10   |
| `signedRequest/`   | Envelope schema, signing, verification.                                                                                   | 9       |
| `boot/`            | `canBoot` (the brick check) and the boot-id marker.                                                                       | 4, 8    |
| `theme/`           | Colour palettes and the neon effects, as data.                                                                            | 4       |

Tests sit next to the code they test (`x.ts` and `x.test.ts` in the same folder).

### `src/test/`

`setup.ts` (jest-dom matchers), `smoke.test.ts`, `worldContent.ts` and `deviceBoxes.ts` (readers over
the generated world), and `factories/`: `commandEnv.ts` (`mockCommandEnv`), `filesystem.ts` (tree
builders), `lanDatabase.ts` and `lanStore.ts` (find real generated database and store fixtures).

## `api/`

`network.ts`, `patches.ts`, `sessions.ts`. Each is one `POST` endpoint routing on the payload's
`action`. Do not add helper modules here: every file becomes a deployed function. See
[chapter 10](./10-server-and-database.md).

## `scripts/`

| Script                     | Purpose                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `encode.ts`                | Writes `src/core/secrets/__encoded.ts`. Runs before dev, build, typecheck and tests.                                             |
| `checkBudgets.ts`          | Post-build bundle-size and per-box timing budget.                                                                                |
| `test*.ts` (80 files)      | Wire-checks: drive the real `api/` endpoints against `vercel dev` and local Supabase.                                            |
| `publicAddressOf.ts`       | A declared network's derived public address, for a wire-check to aim at; stops the run for a network the world does not declare. |
| `seedCrossPlayerTarget.ts` | One-shot setup for a two-player browser run (not self-cleaning; run with `clean` after).                                         |
| `restoreSite.ts`           | Operator tool: reset a fixed site (`findit.io`, `hackademy.io`) to its generated state. Can target production.                   |
| `verifyPatchesRls.ts`      | Checks row-level security on `patches` (anonymous access denied).                                                                |

Run any of them with `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts`.

## `supabase/`

`config.toml` (local stack: project `jshack-me`, ports 5442x) and `migrations/` (12 forward-only SQL
files). `.branches/` and `.temp/` are CLI state and git-ignored.

## `docs/`

| Path                                 | Kind                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `handbook/`                          | This maintainer's handbook.                                                                     |
| `project-status.md`                  | Where the project stands, where to pick up, and how it got here.                                |
| `conventions-and-gotchas.md`         | Working conventions, gates, mutation lessons, operational gotchas, invariants. Long; search it. |
| `backlog.md`                         | Deliberately deferred work and future content ideas.                                            |
| `cross-player-architecture.md`       | As-built cross-player system.                                                                   |
| `world-content-architecture.md`      | As-built generated content and its rules.                                                       |
| `discovery-architecture.md`          | As-built DNS and public web (findit.io).                                                        |
| `vulnerability-architecture.md`      | As-built vulnerability system.                                                                  |
| `e2e-shared-network-verification.md` | Two-player browser journeys and a coverage map.                                                 |
| `legacy/`                            | The retired React app's design, and the rewrite blueprint. Historical.                          |
| `mission-ideas/`                     | Legacy mission designs, input to the planned missions feature.                                  |

## `.claude/`

The project was developed with an AI coding assistant. `.claude/CLAUDE.md` holds always-apply project
rules (they are also stated in this handbook), `.claude/settings.json` its settings, and
`.claude/skills/e2e/SKILL.md` the end-to-end runbook, which is readable by humans too and is the most
detailed guide to driving the game in a browser. None of it is needed to build or run the game.
