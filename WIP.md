# WIP: JSHACK.ME Hacker Terminal Game

## Current Step

Random SSH/FTP port closures in mission networks

## Status

✅ COMPLETE — PRNG-driven port closures (~30% SSH, ~30% FTP, independent rolls) add lateral movement variety. When SSH is closed, FTP port 21 is ensured open. Entry machine, router, and script_fix objectives are protected. Attack chain routes through FTP/HTTP when SSH is unavailable. (1046 unit tests across 68 files)

## Completed

- [x] Core terminal with JavaScript execution
- [x] Virtual file system with permissions
- [x] File system commands (pwd, ls, cd, cat)
- [x] User authentication (su with MD5 hashing)
- [x] Network infrastructure (interfaces, machines, DNS)
- [x] Network commands (ifconfig, ping, nmap, nslookup)
- [x] Remote access (ssh command)
- [x] Additional exploitation commands (exit, ftp, nc, curl, exploit, decrypt, strings, output, resolve)
- [x] Session persistence (IndexedDB)
- [x] WiFi hacking gate (airmon, airdump, aircrack, nmcli)
- [x] Mission system — procedurally generated contracts (seeded generator, router topology, NAT forwarding, entry variants)
- [x] Remove static CTF content (7 machines, 16 flags, E2E CTF test) — mission-only game

## Recent Session (2026-03-01, Session 15)

Implemented:

- **Restored static fileserver machine (192.168.1.50)**:
  - FTP/SSH file server for practicing FTP commands before missions
  - Users: root (b4ckup2024), ftpuser (tr4nsf3r), guest (anonymous)
  - Ports: 21/ftp + 22/ssh, DNS: fileserver.local
  - `/srv/ftp/` content tree: public/ (readme, changelog), uploads/ (backup notes, meeting notes, traffic CSV), config/ (key fragment)
  - Registered in encode pipeline, network config, and filesystem map
- **Restored static webserver machine (192.168.1.75)**:
  - Web server with NC backdoor for practicing nc connections
  - Users: root (r00tW3b!), www-data (d3v0ps2024), guest (w3lcome)
  - Ports: 22/ssh + 80/http + 3306/mysql + 4444/elite (backdoor owned by www-data)
  - DNS: webserver.local
  - `/var/www/html/` (index, robots, htaccess, style.css), `/var/www/backups/` (db_backup.sql, manifest), `/opt/tools/` (scanner binary, backdoor log)
  - Apache/MySQL configs, access/error/mysql/syslog logs
- **Restored flag-stripped files from main branch**:
  - Fileserver: .backup_notes.txt, meeting_notes_2024.txt, .key_fragment (all CTF flags removed)
  - Webserver: scanner binary, .htaccess, style.css, backups/ with db_backup.sql (all CTF flags removed)
- **FTP path autocompletion with dual-machine context switching**:
  - FTP mode operates on two machines simultaneously — path completion now resolves against the correct one
  - Remote FTP commands (cd, ls) complete against the FTP target machine
  - Local FTP commands (lcd, lls) complete against the origin machine
  - Dual-argument commands (get, put) switch context per argument by counting commas before cursor
  - Two separate `usePathAutoComplete` instances (remote + local) created for FTP mode
  - `getFtpPathCompletions` in Terminal.tsx selects the appropriate completion source
  - Resolves the known limitation noted in Session 8
- **Test count**: 1039 unit tests across 68 files

## Previous Session (2026-02-28, Session 14)

Implemented:

- **Cross-tab sync via BroadcastChannel**:
  - Multiple browser tabs run independent terminal sessions with shared state
  - `src/utils/crossTabSync.ts` — BroadcastChannel wrapper with typed messages (filesystem-patch, wifi-changed, mission-changed, theme-changed), graceful no-op fallback when unavailable
  - `FileSystemContext.tsx` — broadcasts each filesystem patch on write/create, subscribes to receive and apply patches from other tabs
  - `SessionContext.tsx` — broadcasts WiFi connect/disconnect and theme changes, subscribes to receive both. WiFi disconnect from another tab resets session to localhost. Added dynamic `document.title` (`username@machine — JSHACK.ME`, `ftp> — JSHACK.ME`, `nc shell — JSHACK.ME`)
  - `useMissionState.ts` — broadcasts mission start (seed) and abort/complete (null), subscribes to regenerate or clear mission from other tabs
  - `MissionContext.tsx` — detects cross-tab mission abort while session is on a mission machine, calls `popAllSessions()` to reset to localhost
  - No echo loops: BroadcastChannel does not deliver messages to the posting tab
  - Zero refactoring of existing providers/contexts — sync layer is purely additive
  - **Version bump**: 0.7.0 → 0.8.0
  - **Test count**: 1017 unit tests across 68 files

## Previous Session (2026-02-27, Session 13)

Implemented:

- **Script fix mission objective type (`script_fix`)**:
  - 4th objective type: player finds a broken JS script on the target machine, fixes with `nano()`, runs with `node()`, mails the ACCESS-KEY
  - 3 bug types (~33% each): syntax (missing paren/quote/brace), logic (wrong comparison/filter), corrupted (data replaced with `???`, hint file nearby)
  - `ScriptBugType` type + optional fields on `MissionObjective`: `scriptBugType`, `scriptHintPath`, `scriptHintContent`, `scriptOwner`
  - `ScriptFixTemplate` type + `scriptFixTemplatesByRole` pool (2 templates per role = 8 main + 2 router)
  - Variable permissions: ~60% user-owned (anyone can edit/run), ~40% root-owned (must `su` first)
  - `mkScript()` helper in `filesystem.ts` with owner-based permissions
  - `findLeafDir()` helper for merging corrupted hint files alongside scripts in the same directory
  - Seed keyword: `script-fix` in `parseSeedOverrides()`
  - Mission briefing hints in `accept.ts` (with extra hint for corrupted type)
  - `verifyScriptFix()` in `mail.ts` (simple string comparison, same as exfiltrate)
  - Dummy PRNG rolls consumed for binary + encrypt to preserve sequence alignment
  - No binary wrapping or encryption (scripts must be readable/editable)
  - **Test count**: 1006 unit tests across 67 files

## Previous Session (2026-02-22, Session 12)

Implemented:

- **Tool availability system — `apt install` on remote machines**:
  - On remote/mission machines, hacking tools (nmap, john, nc, ftp, exploit, etc.) are not pre-installed — players must `apt('install', '<tool>')` as root
  - `src/commands/availability.ts` — Command categorization (shell builtins, system utilities, apt-installable, game-specific), `isCommandInstalled()` filesystem check, `wrapWithInstallCheck()` HOF, binary stub constants, `createBinaryEntries()` helper
  - `src/commands/apt.ts` — `apt('install', pkg)` with async install animation, `apt('list')` / `apt('list', '--installed')`, root-only install enforcement
  - `src/filesystem/fileSystemFactory.ts` — Added `/bin/` and `/usr/bin/` directories to all machine filesystems. `mergeExtraDirectories()` helper for one-level-deep directory merging (prevents mission `extraDirectories` from overwriting factory `/usr/`)
  - Localhost: `/bin/` has system utilities, `/usr/bin/` has all apt-installable tools (pre-installed)
  - Gateway: `/bin/` has system utilities, `/usr/bin/` empty
  - Mission machines: `/bin/` has system utilities, `/usr/bin/` empty (must `apt install`)
  - Install check wrapping in `useCommands.ts` follows existing `wrapWithWifiCheck` pattern
  - Wrapping order: permission (outermost) → install check → command execution
  - 22 new tests (apt: 12, availability: 10)
  - **Version bump**: 0.5.0 → 0.6.0
  - **Test count**: 984 unit tests across 66 files

## Previous Session (2026-02-21, Session 11)

Implemented:

- **Seed keywords for mission generation control**:
  - Players and devs can embed keywords in seed strings to override all four major generation axes
  - Difficulty: `easy`, `medium`, `hard` (refactored existing parser into unified `parseSeedOverrides`)
  - Entry variant: `ssh`, `ftp`, `nc`, `exploit` (falls back if template unavailable, e.g. `nc` in router-first mode)
  - Network mode: `forwarded`, `router-first` (hyphenated to avoid false matches)
  - Objective type: `exfiltrate`, `tamper`, `credential-theft` (hyphen variant for credential_theft)
  - `SeedOverrides` type in `types.ts`, `parseSeedOverrides()` exported from `generateMission.ts`
  - PRNG sequence preserved: override calls consume the PRNG roll but discard the result, so existing seeds produce identical networks
  - Overrides passed through `generateTopology` (via `TopologyOverrides`) and `generateAttackChain` (via `objectiveTypeOverride` field)
  - Debug script (`dumpMission.ts`) shows active overrides in overview section
  - Example: `accept("HEIST-ssh-forwarded-tamper-hard")` forces SSH entry, forwarded mode, tamper objective, hard difficulty
  - **Test count**: 941 unit tests across 63 files (all passing, no regressions)

## Previous Session (2026-02-21, Session 10)

Implemented:

- **Remove static CTF content — mission-only game**:
  - Deleted 7 static machine files (gateway, fileserver, webserver, darknet, shadow, void, abyss) and their tests (11 files total)
  - Deleted E2E CTF playthrough test (`e2e/ctf-playthrough.spec.ts`)
  - Simplified `machineFileSystems.ts` to only register localhost + minimal gateway filesystem
  - Simplified `encode.ts` to only encode localhost
  - Simplified `initialNetwork.ts` to only localhost + gateway (removed 6 machine configs, 3 DNS zones)
  - Updated localhost filesystem: removed 3 flags, updated content to point to missions
  - Updated command examples (curl, ftp, nc, ssh, ping, nslookup) to use generic IPs instead of static machine references
  - Removed webserver/darknet server configs from curl command
  - Fixed curl test for per-machine custom headers (now uses gateway IP)
  - Updated all documentation: README, CLAUDE.md, architecture.md, ctf-design.md, WIP.md, PLAN.md, LEARNINGS.md
  - **Test count**: 904 unit tests across 61 files + 4 Playwright E2E tests

## Previous Session (2026-02-21, Session 9)

Implemented:

- **Realistic mission network topology (router + DMZ)**:
  - Every mission now generates a border router between localhost and the internal mission network
  - Router has a public IP (45.x.x.x), dual interfaces (eth0 public + eth1 internal), its own filesystem with firewall rules, routing tables, and internal machine hints
  - Two network modes: **forwarded** (easier — router NATs entry ports to DMZ, transparent to player) and **router-first** (harder — must hack router first to reach internal network)
  - Difficulty-based mode selection: easy 70% forwarded, medium 50%, hard always router-first
  - Added `'router'` to `MachineRole` union type + `routerPublicIp`, `routerMachine`, `natForwarding` to `MissionNetwork`
  - Router data pools: usernames, hostnames, port templates, config templates, target file templates, entry port templates, vulnerability template (CVE-2019-11510 Pulse Secure VPN)
  - `NetworkContext.resolveNat(ip)` translates router public IP to internal entry machine IP when forwarding is active
  - NAT resolution applied at 3 connection boundaries in `Terminal.tsx`: SSH login, FTP session, NC session
  - From localhost, only the router's public IP is visible. In forwarded mode, `getMachine(publicIP)` returns a synthetic machine with the entry machine's ports/users
  - Mission briefing (`accept.ts`) shows router public IP as gateway, with mode-aware hints
  - Router filesystem contains `/etc/hosts` (internal machine list), `/etc/route.conf` (routing table), `/var/log/firewall.log` (iptables traffic)
  - Updated all documentation: CLAUDE.md, architecture.md, ctf-design.md, missions-design.md, mission-variations.md
  - **Test count**: 950 unit tests across 65 files

## Previous Session (2026-02-20, Session 8)

Implemented:

- **NC mode path autocomplete fix**:
  - Path tab completion in NC mode was resolving against the main session's machine (localhost) instead of the NC target machine
  - Created `useCallback` wrappers in `Terminal.tsx` that adapt `listDirectoryFromMachine`, `getNodeFromMachine`, and `resolvePathForMachine` to the simpler `usePathAutoComplete` interface, binding the NC session's `targetIP`, `currentPath`, and `userType`
  - When NC mode is active, `usePathAutoComplete` receives the NC-specific wrappers; otherwise uses the default session-based functions
  - Example: `cat('ind` + Tab now correctly autocompletes to `cat('index.html')` on the NC machine
  - **Known limitation**: FTP path completion has a similar issue — resolves against the origin machine, so remote commands (`cd`, `ls`) autocomplete wrong. FTP is harder to fix because dual-argument commands (`get(remote, local)`, `put(local, remote)`) need per-argument context based on cursor position. Deferred for now.
  - **Test count**: 938 unit tests across 65 files + 5 Playwright E2E tests

## Previous Session (2026-02-20, Session 7)

Implemented:

- **Thematic target paths for missions**:
  - Target files are now role-appropriate instead of always `/root/flag.txt`
  - `targetFileTemplatesByRole` in `pools.ts` — 3 templates per role (fileserver, database, webserver, workstation) with `{{flag}}` and `{{user}}` placeholders
  - `targetContent` field added to `MissionObjective` type — carries full file content with embedded flag
  - `selectTargetFile()` in `attackChain.ts` — PRNG-selects a template based on target machine's role
  - `placeTargetFile()` + `buildNestedDirs()` in `filesystem.ts` — places file at dynamic path using `extraDirectories`
  - Target paths use `/srv/` and `/opt/` prefixes to avoid conflicting with factory-managed directories (`/var/`, `/home/`, `/etc/`)
  - Examples: `/srv/records/patient_discharge_2024.csv` (fileserver), `/opt/mysql/dumps/users_backup.sql` (database), `/srv/www/data/users.json` (webserver), `/opt/projects/classified_memo.txt` (workstation)
  - Updated E2E test for new target path and PRNG-shifted attack chain
  - **Test count**: 938 unit tests across 65 files + 5 Playwright E2E tests

## Previous Session (2026-02-20, Session 6)

Implemented:

- **Vulnerability scanning & exploit system**:
  - `Vulnerability` type on `Port` (CVE, description, serviceVersion) in `src/network/types.ts`
  - `exploit` entry variant + `exploit` attack method in `src/generation/types.ts`
  - `entryCredential` field on `MissionNetwork` (shows varied guest password in SSH briefing)
  - Guest password pool (`guestPasswords`) — no longer hardcoded `"guest"`
  - Vulnerability templates (5 real CVEs) and exploit entry port templates in `pools.ts`
  - `nmap("-sV", target)` — version detection with `VERSION` column + `VULNERABILITIES:` section
  - `exploit(host, port)` command — exploits vulnerable port, drops into NC-like restricted shell
  - Exploit entry variant in generator pipeline (topology, users, attack chain, filesystem, orchestrator)
  - Registered `exploit` in `useNetworkCommands.ts` + `permissions.ts` (user tier, WiFi gated)
  - `accept()` shows exploit hint and SSH password for respective variants
  - 32 new tests (exploit.test.ts + nmap -sV tests + generation tests)
  - **Test count**: 938 unit tests across 65 files + 5 Playwright E2E tests

## Session 5 (2026-02-19)

Implemented:

- **Mission E2E Playwright tests** (`e2e/mission-playthrough.spec.ts`):
  - 4 tests covering all 3 entry variants (SSH, FTP, NC) + mission lifecycle (abort/re-accept)
  - SSH variant (TEST-1-easy): SSH to target, su to root, capture flag
  - NC variant (MEDTECH-4A7F-easy): NC backdoor to entry, find creds, SSH to target, capture flag
  - FTP variant (NOVA-7E2A-easy): FTP to entry, download creds file, SSH to target, capture flag
  - Lifecycle test: accept mission → SSH in → abort → verify back on localhost → accept new mission
  - Shared `completeWifiGate` helper (WiFi gate is prerequisite for all mission tests)
  - Uses deterministic seeds with pre-verified attack chains, credentials, and flags
- **Bug fix: `su` on mission machines** — `getUsers()` in `useCommands.ts` only searched static `config.machineConfigs`. Mission machine IPs aren't in static config → "user does not exist" error. Added `findMachineUsers(ip)` to `NetworkContext` that searches both static and mission configs. `useCommands.ts` now delegates to this centralized lookup.
- **Test count**: 906 unit tests across 64 files + 5 Playwright E2E tests (1 CTF + 4 mission)

## Previous Session (2026-02-19, Session 4)

Implemented:

- **Encode mission passwords at build time (anti-cheat)**:
  - Moved 20 hardcoded passwords from `pools.ts` into `src/secrets/secrets.ts` as `MISSION_PASSWORDS` (JSON-stringified array)
  - `pools.ts` now imports decoded passwords from `secrets/__encoded.ts` at runtime
  - Added `pretest`, `pretest:run`, `pretest:coverage` npm hooks to ensure `__encoded.ts` exists before tests
  - Updated `users.test.ts` to import passwords from plaintext source (matching existing test pattern)
  - Verified: `s3cur3!`, `p4ssw0rd` etc. return zero matches in `dist/` after build
- **Test count**: 906 tests across 64 files (unchanged)

## Previous Session (2026-02-19, Session 3)

Implemented:

- **Mission system Phase 3 — First Mission Template (E2E Proof of Concept)**:
  - **Bug fix: Entry machine unreachable from localhost** — `NetworkContext.tsx` searched peer lists for mission machine records, but machines never appear in their own peer list. Replaced with direct lookup into `GeneratedMachine.remoteMachine`, passed via new `missionMachines` prop from `App.tsx`.
  - **Bug fix: FTP entry credential hints placed in nonexistent `/srv/ftp/`** — Two of three FTP hint templates used `/srv/ftp/` paths, but entry machines have no `/srv/ftp/` directory. Changed all `ftpPath` values to `/home/{{localUser}}/` which the filesystem factory always creates.
  - **Bug fix: Double network generation in `accept`** — `accept` generated the network for the briefing, then `startMission` generated it again internally. Changed `startMission` to accept `MissionNetwork` directly instead of a seed string. Only the seed is persisted.
  - Updated tests: `useMissionState.test.ts`, `accept.test.ts`, `filesystem.test.ts` (new FTP path validation test)
- **Test count**: 906 tests across 64 files

## Previous Session (2026-02-19, Session 2)

Implemented:

- **Mission system Phase 2 — Integration & Mission Board**:
  - `src/mission/MissionContext.tsx` — React context for active mission state (start/abort/complete)
  - `src/mission/missionBoard.ts` — 1 hardcoded sample contract with formatted ASCII board (more to be added with e2e tests)
  - `src/commands/missions.ts` — Browse darknet contracts, shows formatted mission board
  - `src/commands/accept.ts` — Accept a mission by seed, generates network, shows briefing with entry hint
  - `src/commands/abort.ts` — Abort active mission, pops all SSH sessions back to localhost
  - `src/App.tsx` — Orchestrates mission state, passes to FileSystem/Network providers
  - `src/filesystem/FileSystemContext.tsx` — Accepts `missionFileSystems` prop, merges/removes dynamically
  - `src/network/NetworkContext.tsx` — Accepts `missionNetworkConfig` prop, injects mission machines into localhost
  - `src/session/SessionContext.tsx` — Added `popAllSessions()` for mission abort
  - `src/utils/storage.ts` + `storageCache.ts` — Mission seed persistence (IndexedDB)
  - `src/filesystem/machineFileSystems.ts` — Widened `MachineId` from literal union to `string`
  - Generator tweaks: varied entry access methods (SSH/FTP/NC), entry credential hints, NC backdoor owner
  - `src/filesystem/machines/darknet.ts` — Added `.contracts` breadcrumb file for mission discovery
  - Mission completion detection in Terminal.tsx — scans command output for mission flag
  - 23 new tests (missions, accept, abort, missionBoard)
- **Test count**: 895 tests across 64 files

## Previous Session (2026-02-19)

Implemented:

- **Seeded network generator (Phase 1)**: Pure generation engine for procedurally generated mission networks
  - `src/generation/prng.ts` — Mulberry32 PRNG seeded via FNV-1a hash, methods: next(), nextInt(), pick(), pickN(), shuffle()
  - `src/generation/types.ts` — MissionNetwork, GeneratedMachine, AttackStep, MissionObjective, CredentialPlacement types
  - `src/generation/pools.ts` — Data pools: usernames/passwords/hostnames per role, port templates, log/config templates, noise/red-herring files
  - `src/generation/topology.ts` — Generates flat subnet, assigns machine roles, builds NetworkConfig with interfaces/DNS/reachability
  - `src/generation/users.ts` — Generates root + 1-2 role users per machine, md5 hashing, plaintext credential map
  - `src/generation/attackChain.ts` — Builds attack path from entry to target, assigns methods (ssh/ftp), plans credential placements in files
  - `src/generation/filesystem.ts` — Builds FileNode trees per machine using existing createFileSystem(), injects breadcrumbs/noise/flag
  - `src/generation/generateMission.ts` — Orchestrator: seed string → complete MissionNetwork
  - Deterministic: same seed always produces identical output
  - 4 machine roles (webserver, database, fileserver, workstation), 3 difficulty tiers
  - Output types match existing NetworkConfig, RemoteMachine, FileNode for future integration
  - 66 new unit tests (determinism, variation, structure, credential embedding)
- **Test count**: 872 tests across 60 files

## Previous Session (2026-02-18)

Implemented:

- **Theme system**: `theme()` command with 4 persistent color themes (amber, green, cyan, light)
  - `src/theme/themes.ts` — Theme definitions, types (`ThemeId`, `ThemeColors`, `ThemeDefinition`), 14 semantic color tokens per theme
  - `src/theme/applyTheme.ts` — Sets CSS custom properties (`--theme-*`) on `:root` from a `ThemeDefinition`
  - `src/commands/theme.ts` — `theme()` lists themes (marks active with `*`), `theme("green")` switches theme
  - `session.theme` added to Session type (persisted to IndexedDB, backward compatible)
  - `SessionContext` — `setTheme` callback + `useEffect` applies theme on change
  - `storageCache.ts` — applies theme before React mounts (prevents flash of wrong colors)
  - `index.css` — replaced Tailwind color `@apply` with CSS variable references, `:root` amber fallbacks
  - All components migrated from Tailwind color classes to inline `style` with `var(--theme-*)`:
    - `Terminal.tsx` — bg-black → var(--theme-bg)
    - `TerminalOutput.tsx` — all text-amber-_, text-red-_ → CSS vars, AuthorCard links with hover handlers
    - `TerminalInput.tsx` — border, prompt, input, caret → CSS vars
    - `NanoEditor.tsx` — title bar, editor, status bar, help bar, key badges → CSS vars
  - Theme registered in `useCommands.ts`, guest-accessible (unrestricted)
  - `disconnectWifi` fixed to preserve `prev.theme` instead of losing it
  - Theme preserved through `pushSession`/`popSession` (SSH nesting)
  - 12 new unit tests: theme command (7), applyTheme (5)
  - Updated test fixtures in storage.test.ts, storageCache.test.ts, TerminalOutput.test.tsx, TerminalInput.test.tsx
- **Test count**: 806 tests across 54 files

## Previous Session (2026-02-18)

Implemented:

- **WiFi hacking gate**: Network access from localhost now requires cracking a WiFi network — a progression gate between flags 3 and 4 (no flag awarded). Inspired by the aircrack-ng suite.
  - `src/network/wifiNetworks.ts` — 4 WiFi networks (1 crackable WPA2, 1 WPA3, 2 weak signal)
  - `src/commands/airmon.ts` — Enable/disable monitor mode on wlan0
  - `src/commands/airdump.ts` — Async WiFi network scanner (progressive table output)
  - `src/commands/aircrack.ts` — Async WPA2 key cracker with progress (auto-connects on success)
  - `src/hooks/useWifiCommands.ts` — Hook wiring commands with session state + monitor mode ref
  - `wifiConnected` standalone state in `SessionProvider` (persisted to IndexedDB, synced across tabs)
  - Localhost changed from `eth0` to `wlan0` + `lo` loopback in `initialNetwork.ts`
  - `NetworkContext` gates interfaces/machines/DNS when WiFi disconnected on localhost
  - `useNetworkCommands` wraps network commands with WiFi check (throw "Network is unreachable")
  - `ifconfig()` NOT gated — player needs it to see wlan0 is DOWN
  - Hint file at `/home/jshacker/downloads/wifi_tools.txt` (aircrack cheatsheet)
  - Flag 3 hint updated to point toward `ifconfig()` and `help()`
  - E2E test updated with WiFi cracking step between flag 3 and flag 4
  - 23 new unit tests: airmon (9), airdump (6), aircrack (8)
  - WiFi state persists across page refresh; monitor mode is transient (resets on refresh)
- **Path autocomplete**: Tab completion inside string arguments for file/directory paths
  - `src/hooks/usePathAutoComplete.ts` — detects cursor inside quotes, resolves directory, filters entries by prefix
  - `TerminalInput` passes `cursorPosition` to `onTab`; `Terminal.tsx` tries path completion first, falls through to command/variable completion
  - Directories append `/` in completions; single match auto-completes, multiple matches show list + advance to common prefix
  - 16 unit tests covering string detection, absolute/relative paths, single/multiple matches, edge cases
- **Test count**: 794 tests across 52 files

## Previous Session (2026-02-13)

Implemented:

- **Content encoding (anti-cheat)**: All filesystem content and sensitive strings are encoded at build time to prevent finding flags or passwords by searching the JS bundle
  - `src/utils/contentCodec.ts` — XOR+Base64 encode/decode for strings, plus recursive FileNode tree transformers (`encodeFileSystem`/`decodeFileSystem`)
  - `scripts/encode.ts` — Pre-build script: imports all 8 machine filesystems + secrets, encodes content, writes `src/filesystem/machines/__encoded.ts` and `src/secrets/__encoded.ts`
  - `__encoded.ts` files (generated, gitignored) — encoded data that decodes at import time
  - `machineFileSystems.ts` imports from `./machines/__encoded`, `wifiNetworks.ts` imports from `../secrets/__encoded`
  - `src/secrets/secrets.ts` — plaintext secrets registry (WiFi password, etc.), only used by encode script + tests
  - `predev` and `prebuild` npm hooks auto-run `npm run encode` before `dev` and `build`
  - Added `tsx` dev dependency for running the encode script
  - 8 unit tests for codec round-trips (strings, empty strings, special characters, full FileNode trees, structure preservation)
  - Encoding scheme: UTF-8 bytes → XOR with static key → Base64. Only `content` strings encoded; tree structure (names, types, permissions) stays as plain JSON.
  - Existing unit tests unchanged (they import source machine files directly)
  - Verified: `grep -r "FLAG{" dist/` returns zero matches after build
- **Test count**: 738 tests across 47 files

## Previous Session (2026-02-12)

Implemented:

- **Playwright E2E test**: Full CTF playthrough test covering all 16 flags in a real browser
  - `e2e/ctf-playthrough.spec.ts` — single sequential test with 16 `test.step` blocks
  - `playwright.config.ts` — Chromium-only, 5min timeout, auto-starts Vite dev server
  - Helper functions: `countThenWait` (avoids stale DOM matching), `suTo`, `sshTo`, `ftpConnect`, `ncConnect`, `writeInNano`, `saveAndExitNano`, `expectFlag`
  - Completes in ~23 seconds; run with `--headed` for visual demo
  - Added `@playwright/test` dev dependency, `test:e2e` npm script
  - Excluded `e2e/` from Vitest config to avoid Playwright/Vitest conflict
- **Bug fix: `su` user type on remote machines** (Terminal.tsx): `getMachine(session.machine)` returns undefined because machines don't list themselves in their own network config. Added fallback that searches all `networkConfig.machineConfigs` entries to find the correct user type.

## Previous Session (2026-02-12)

Implemented:

- **Bug fix: `su` on remote machines**: `getUsers()` returned empty array on remote machines because `getMachine()` only searches reachable machines (not the machine itself). Fixed in `useCommands.ts` to search across all `config.machineConfigs` entries instead.
- **Flag 15 — Void Data Miner**: Full filesystem for void database node (10.66.66.2)
  - `/home/dbadmin/recovery/` — manifest.txt (extraction instructions), 5 CSV tables (pipe-delimited, 20 rows each)
  - Each table has flag fragment at rows[13].split("|")[3]: fragments join to FLAG{void_data_miner}
  - `/home/dbadmin/.abyss_notes` — phantom/sp3ctr4l credentials for abyss (Flag 16 setup)
  - `/var/log/` — auth.log (leaks dbadmin password), syslog, mysql.log (database noise)
  - Noise: dbadmin .bashrc (db aliases), .bash_history, /etc/crontab, /etc/mysql/my.cnf, guest .bash_history
  - Added maintenance port 9999 (dbadmin owner) to void in `initialNetwork.ts`
  - 27 behavior-focused tests: script extraction, CSV format (header, field count, anomaly markers), credential hints, manifest hints
- **Flag 16 — Abyss Decryptor**: Full filesystem for abyss deep node (10.66.66.3)
  - `/home/phantom/vault/` — README.txt, cipher.txt (XOR algorithm docs), key.txt (ABYSS), encoded_payload.txt (21 hex bytes)
  - XOR decode with repeating key "ABYSS" produces FLAG{abyss_decryptor}
  - `/var/log/auth.log` — NO phantom password leak (creds come from void's .abyss_notes)
  - Noise: phantom .bashrc (vault aliases), .bash_history, /etc/crontab, syslog, guest .bash_history
  - 7 behavior-focused tests: XOR decode, simulated node script, vault contents, auth.log does NOT leak phantom password
- **Test count**: 730 tests across 46 files

## Previous Session (2026-02-12)

Implemented:

- **Flag 14 — Shadow Debugger**: Full filesystem for shadow monitoring node (10.66.66.1)
  - `/home/operator/diagnostics/` — README.txt, access.log (21 pipe-delimited lines, tag fields spell FLAG), check_logs.js (2 bugs: off-by-one + wrong delimiter)
  - `/srv/ftp/exports/` — system_report.txt (operator creds + void hint), network_status.txt (noise)
  - `/var/log/` — auth.log (backup credential path), syslog, monitoring.log (node health checks)
  - Noise: operator .bashrc (monitoring aliases), scripts/ (check_nodes.sh, rotate_logs.sh), /etc/crontab, /etc/monitoring.conf, guest .bash_history
  - Added FTP port 21 to shadow in `initialNetwork.ts`
  - Added `/root/.hidden_network` on darknet (lists services per hidden machine)
  - 5 behavior-focused tests: buggy script throws TypeError, partial fix gives empty output, full fix extracts flag, format validation

## Previous Session (2026-02-12)

Implemented:

- **Per-machine network configs**: Network system is now session-aware — each machine has its own interfaces, reachable machines, and DNS
  - Added `MachineNetworkConfig` type and changed `NetworkConfig` to hold `machineConfigs` record
  - `NetworkContext` imports `useSession`, resolves config per `session.machine` via `useMemo`
  - All getter functions (`getInterfaces`, `getMachine`, `getLocalIP`, etc.) unchanged externally
  - 8 per-machine configs: localhost, gateway, fileserver, webserver, darknet, shadow, void, abyss
- **Gateway dual interfaces**: eth0 (WAN: 198.51.100.10) + eth1 (LAN: 192.168.1.1)
  - Added `/etc/network.conf` with WAN IP and NAT config for in-game discovery
- **Darknet dual interfaces**: eth0 (public: 203.0.113.42) + eth1 (hidden: 10.66.66.100)
  - Hidden 10.66.66.0/24 network with 3 new machines
  - Darknet sees gateway via WAN IP only + hidden network — cannot route to private LAN
- **Hidden network skeleton machines**: shadow (10.66.66.1), void (10.66.66.2), abyss (10.66.66.3)
  - Minimal filesystems with root + named user + guest, hostname, hosts
  - Hidden DNS: shadow.hidden, void.hidden, abyss.hidden
  - Reachable only from darknet or each other
- **Test count**: 681 tests across 42 files (unchanged — no test changes needed)

## Previous Session (2026-02-12)

Implemented:

- **nano command**: Full-screen nano-style text editor overlay for creating/editing files
  - `nano(path)` validates path, returns `nano_open` special output type
  - `NanoEditor.tsx` component: fixed overlay, amber CRT aesthetic, textarea-based editing
  - Ctrl+S save, Ctrl+X/Escape exit, Tab inserts 2 spaces, cursor position tracking
  - Exit prompt (Y/N/C) when unsaved changes exist
  - Calls `writeFile`/`createFile` from FileSystemContext — changes persist to IndexedDB
  - 9 tests for nano command, 17 tests for NanoEditor component
- **node command**: Execute JavaScript files with access to all terminal commands
  - `node(path)` reads file content and evaluates via `new Function()` with full command context
  - Lazy getter pattern resolves circular dependency (node needs execution context that includes node)
  - Tries expression mode first, falls back to statement execution
  - 12 tests covering execution, context access, and error handling
- **Execute permission**: Added Unix-like execute permission to filesystem
  - `FilePermissions` now has `execute` field alongside `read` and `write`
  - Directories: `execute` matches `read`. Scripts/binaries: `execute` matches `read`. Data files: `execute: ['root']`
  - Only `node()` checks execute permission — `cat`, `ls`, `cd` etc. unchanged
  - User-created files (nano, output, ftp get/put): `execute: ['root', owner]`
  - 4 new tests in node.test.ts for execute permission behavior
- **Permission tiers**: Both nano and node added to user-tier (same as strings, output, etc.)
- **Test count**: 674 tests across 41 colocated files

## Previous Session (2026-02-10)

Implemented:

- **Prettier code formatter**: Set up Prettier for consistent code formatting across the project
  - Installed `prettier` and `eslint-config-prettier`
  - Created `.prettierrc` matching existing code style (single quotes, semicolons, trailing commas, 2-space indent, 100 char width)
  - Created `.prettierignore` for dist/coverage/node_modules/binary files
  - Added `eslint-config-prettier` as last entry in `eslint.config.js` (disables conflicting ESLint rules)
  - Added `npm run format` and `npm run format:check` scripts
  - Formatted entire codebase — all 632 tests pass, build succeeds
- **SEO & Open Graph**: Full search engine optimization and social sharing support
  - Added `robots.txt` and `sitemap.xml` for search engine crawlers
  - Created OG image (1200x630) with CRT terminal aesthetic — ASCII banner, nmap scan, amber glow
  - Generated `og-image.png` via Playwright screenshot of `og-image.html` template
  - Created `apple-touch-icon.png` (180x180) for iOS home screen
  - Added comprehensive meta tags to `index.html`: SEO (description, keywords, author, theme-color, canonical), Open Graph (title, description, image, url, type, site_name), Twitter Card (summary_large_image)
- **IndexedDB migration**: Migrated all persistence from localStorage to IndexedDB
  - Created `src/utils/storage.ts` — IndexedDB wrapper with typed read/write for `session` and `filesystem` stores
  - Created `src/utils/storageCache.ts` — Pre-load cache: loads IndexedDB before React mounts (async→sync bridge)
  - Updated `src/main.tsx` — Async startup: `await initializeStorage()` before `createRoot().render()`
  - Updated `SessionContext.tsx` and `FileSystemContext.tsx` — Replaced localStorage with cache reads and IndexedDB writes
  - One-time auto-migration from localStorage keys (`jshack-session`, `jshack-filesystem`) for returning users
  - Added `fake-indexeddb` dev dependency for test environment polyfill
  - 28 new tests (14 for storage wrapper, 14 for cache/migration)
- **Test count**: 632 tests across 38 colocated files (before nano/node)

## Session (2026-02-09)

Implemented:

- **CTF redesign Phase 1-5**: Complete flag system overhaul
  - Phase 1: Command restrictions by user type (guest/user/root tiers)
  - Phase 2: 12 flag files, encrypted files (AES-256-GCM), binary for strings, hint files
  - Phase 3: Web content for all machines (gateway, webserver, darknet)
  - Phase 4: Playtest, fix FTP/NC ls hidden file consistency, update docs
  - Phase 5: Filesystem noise for realism (configs, logs, dotfiles, red herrings across all 5 machines)
- **Filesystem noise**: Added ~35 noise files across all machines
  - /etc files: hostname, hosts, crontab, iptables.rules, vsftpd.conf, apache2.conf, my.cnf
  - Home dotfiles: .bash_history, .bashrc on localhost; .bash_history on gateway guest, darknet ghost/root
  - Logs: syslog, firewall.log, mysql.log, cron.log
  - Web assets: robots.txt, .htaccess, style.css on gateway and webserver
  - Red herrings: nmap_cheatsheet.txt, todo.txt, meeting_notes, tmp_data.csv, backup_manifest.txt
  - Darknet flavor: ghost tools/ with port_scanner.py, /etc/hosts with .onion entries
- **FTP/NC ls hidden file support**: Added `-a` flag to show dotfiles (consistent with regular ls)
- **Test count**: 604 tests across 36 colocated files (before IndexedDB migration)

## Previous Session (2026-02-08)

Implemented:

- **Command restrictions by user type** (`src/commands/permissions.ts`):
  - Guest: basic navigation only (ls, cd, cat, su, help, man, echo, whoami, pwd, clear, author)
  - User: all basic + network/analysis tools (nmap, ssh, ftp, nc, curl, ifconfig, ping, nslookup, strings, output, resolve, exit)
  - Root: all user + decrypt
  - Restricted commands wrapped with permission-checking fn (clear "permission denied" error)
  - `help()` and tab autocomplete filter out restricted commands
  - `man()` can still look up any command (for learning)
  - Privileges update instantly on `su()` via `session.userType` in `useMemo` deps
  - FTP/NC modes unaffected (separate command sets)
  - 21 tests for permissions module
- **CTF flag redesign plan** (`CTF_DESIGN.md`): 12-flag progression, command tiers, escalation paths
- **Test count**: 604 tests across 36 colocated files

Previous session (2026-02-08):

- **curl command**: HTTP client for fetching web content from remote machines
  - `curl(url)` - GET request, serves from `/var/www/html/` on target machine
  - `curl(url, "-X POST")` - POST request, reads from `/var/www/api/{endpoint}.json`
  - `curl(url, "-i")` - include HTTP response headers (Server, Content-Type, custom)
  - Per-machine server config (Apache/nginx, custom headers like X-Powered-By)
  - DNS resolution via existing `resolveDomain()`
  - Port validation: must be open HTTP/HTTPS/HTTP-ALT service
  - AsyncOutput with 400-600ms delay for realism
  - 27 tests covering errors, GET, POST, headers, DNS, async, cancellation
- **Web content added to machine filesystems**:
  - Gateway: `/var/www/html/index.html` (router page), `admin.html` (root-only, has flag)
  - Webserver: `/var/www/api/users.json`, `config.json` (DB creds + flag)
  - Darknet: `/var/www/html/index.html` (ASCII art), `/var/www/api/secrets.json` (encoded hint + flag)
- **New flags**: FLAG{router_admin_panel}, FLAG{api_config_exposed}, FLAG{darknet_api_discovered}
- **Test count**: 572 tests across 35 colocated files

## Session (2026-02-07)

Implemented:

- **Filesystem persistence**: User-created/modified files now survive page refresh
  - Patches approach: only the diff from base filesystem is stored in localStorage (`jshack-filesystem`)
  - `FileSystemPatch` type: machineId, path, content, owner
  - Patches upserted (deduped by machineId + path) on every `writeFileToMachine`/`createFileOnMachine`
  - `applyPatches()` replays patches on top of base filesystem at init
  - Covers `output(cmd, file)`, FTP `get`/`put`, and any future write operations
  - Clear `jshack-filesystem` from localStorage to reset to factory state
- **output command**: Capture command output to variable or file
  - `output(cmd)` - returns string for sync, Promise for async
  - `output(cmd, filePath)` - writes output to file
  - 16 tests covering sync/async capture and file writing
- **resolve command**: Unwrap Promises and display resolved value
  - Shows "Resolving..." then displays the value
  - Handles both resolved values and rejections
  - 14 tests covering all scenarios
- **stringify utility**: Extracted shared stringification logic
  - Used by echo, output, and resolve commands
  - 12 tests for stringify, removed echo tests (trivial wrapper)
- **ping fix**: Only respond to known machines, 100% packet loss for unknown IPs
- **strings command**: Extract printable strings from binary files
  - `strings(file, [minLength])` - extracts ASCII sequences (4+ chars default)
  - Added binary file detection to `cat` - shows warning for binary files
  - Added `/bin/sudo` binary on webserver with hidden FLAG
- **Test count**: 545 tests across 34 colocated files (before curl)

## Session (2026-02-06)

Implemented:

- **decrypt command**: Decrypt files using Web Crypto API (AES-256-GCM)
  - Takes file path and 64-character hex key (256 bits)
  - Returns AsyncOutput with "Decrypting..." progress
  - Validates key format (hex, correct length)
  - Handles permission checks and file validation
  - 17 tests covering all edge cases
- **Crypto utilities** (`src/utils/crypto.ts`):
  - `hexToBytes()`, `bytesToHex()` - hex/binary conversion
  - `generateKey()` - random 256-bit key generation
  - `encryptContent()`, `decryptContent()` - AES-256-GCM operations
- **Test encrypted files**: Added to localhost `/home/jshacker/`:
  - `secret.enc` - encrypted file with test flag
  - `keyfile.txt` - decryption key for testing
- **Test count**: 469 tests across 30 colocated files

## Session (2026-02-05)

Implemented:

- **Dynamic nc owner**: nc command no longer hardcodes "ghost" user
  - Added `ServiceOwner` type with username, userType, homePath
  - Extended `Port` type with optional `owner` field
  - nc command reads context from `port.owner` instead of hardcoding
  - Added backdoor on webserver port 4444 (www-data user)
  - Banner now shows actual port number (e.g., `# 4444 #`)
- **Fixed nc commands**: Corrected `resolvePath` signature in cd, ls, cat
- **NC command tests**: nc (28), cat (11), cd (13), ls (14)
- **Test count**: Now 452 tests across 29 colocated files

## Session (2026-02-04)

Implemented:

- **nc (netcat) command**: Connect to arbitrary ports on remote machines
  - Shows service banners for common ports (ssh, http, ftp, mysql)
  - Interactive mode for special services (port 31337 on darknet)
  - Runs as configured user with real filesystem access (read-only)
  - Commands: pwd, cd, ls, cat, whoami, help, exit
  - Minimal `$` prompt - players must discover context with whoami/pwd
  - Service named "elite" (not "backdoor") to be less obvious
- **State consolidation**: Moved `currentPath` from FileSystemContext to SessionContext
  - SessionContext is now single source of truth for: machine, username, userType, currentPath
  - FileSystemContext reads location from SessionContext (no more duplication)
  - Removed `switchMachine()` - session state changes handle machine switching
  - `pushSession()` no longer takes parameter (reads from session)
  - `popSession()` fully restores all state including currentPath
- **Session persistence**: localStorage saves/restores session state
  - Persists: session (machine, user, path), sessionStack (SSH history), ftpSession, ncSession
  - Validates persisted data with type guards before restoring
  - Fallback to defaults if localStorage is empty/invalid/corrupted
  - Auto-saves on every state change
- **Component tests**: TerminalOutput (19 tests), TerminalInput (26 tests)
- **FTP command tests**: cd (15), lcd (15), ls (12), lls (12), get (13), put (13)
- **Test count**: 386 tests across 25 colocated files

## Blockers

None currently.

## Next Action — Mission System Expansion

- [ ] Expand mission types (plant, chain), difficulty tiers, more machine role templates, more vulnerability patterns. See `.claude/docs/missions-design.md`.

## Future Ideas

### User-Generated Content

Allow players to create and share missions via seed codes. Community voting, ratings, weekly challenges.

### Backend Integration

Mission catalog API, player accounts, leaderboards. Options: Supabase, Firebase, or self-hosted.

### Nano + Scripting Mission Concepts

Advanced mission ideas that require `nano` (edit/create files) + `node` (execute JS) as core gameplay:

- **Custom Cipher Decode** — target file encoded with a non-standard cipher (rotation, base-N, substitution map); player finds hint describing the algorithm, writes a decoder script
- **Log Parser / Data Extraction** — large log file (200-500 lines) with ACCESS-KEY fragmented across specific entries; hint describes the extraction pattern (every Nth line, specific field); too tedious to do manually
- **Brute Force a PIN / Token** — locked resource requires a numeric PIN with constraints (divisibility, digit sum, etc.); player writes a brute-force script to find valid candidates
- **Config Generator / Exploit Payload** — craft a file in a specific format to bypass validation (checksum must match body, fields must satisfy relationships); closest to real exploit development
- **Fragmented Key Assembly** — key split across multiple machines in different formats (hex, base64, reversed); player collects fragments and writes an assembly script
- **Chained Concepts** — hard missions combining 2-3 of the above (e.g., fix broken script → parse log → assemble fragments)

Note: "Debug a Broken Script" (Concept 6 from original brainstorm) is already implemented as the `script_fix` objective type.

---

## Infrastructure Ready

### Static Machines

| Machine    | IP            | Users                 | Purpose                     |
| ---------- | ------------- | --------------------- | --------------------------- |
| localhost  | 192.168.1.100 | jshacker, root, guest | Starting machine            |
| gateway    | 192.168.1.1   | admin, guest          | Static border router        |
| fileserver | 192.168.1.50  | root, ftpuser, guest  | FTP/SSH practice server     |
| webserver  | 192.168.1.75  | root, www-data, guest | Web server with NC backdoor |

All other machines are procedurally generated per mission.

### Known Passwords (MD5 hashed)

- root@localhost: sup3rus3r
- jshacker@localhost: h4ckth3pl4n3t
- guest@localhost: guestpass
- admin@gateway: n3tgu4rd!
- guest@gateway: guest2024
- root@fileserver: b4ckup2024
- ftpuser@fileserver: tr4nsf3r
- guest@fileserver: anonymous
- root@webserver: r00tW3b!
- www-data@webserver: d3v0ps2024
- guest@webserver: w3lcome

### Test Coverage

- 1039 unit tests across 68 colocated test files
- 4 Playwright E2E tests: mission playthroughs (SSH/FTP/NC variants + lifecycle)
- All commands with logic are tested
- Async commands tested with fake timers
- React hooks and components tested with React Testing Library
- IndexedDB persistence tested
