# WIP: JSHACK.ME CTF Terminal Game

## Current Step

Mission E2E tests complete — all entry variants tested end-to-end

## Status

✅ COMPLETE — Mission E2E Playwright tests (SSH/FTP/NC variants + lifecycle) passing (906 unit tests + 5 E2E tests)

## Completed

- [x] Step 1: Core terminal with JavaScript execution
- [x] Step 2: Virtual file system with permissions
- [x] Step 3: File system commands (pwd, ls, cd, cat)
- [x] Step 4: User authentication (su with MD5 hashing)
- [x] Step 5: Network infrastructure (interfaces, machines, DNS)
- [x] Step 6: Network commands (ifconfig, ping, nmap, nslookup)
- [x] Step 7: Remote access (ssh command)
- [x] Step 8: Place flags in file system
- [x] Step 9: Add hints and breadcrumbs
- [x] Step 10: Remote machine file systems
- [x] Step 11: Additional exploitation commands (exit, ftp, nc)
- [x] Step 12: Session persistence (IndexedDB, migrated from localStorage)
- [x] Hidden Network Flags (14-16)
- [x] Playwright E2E test (full 16-flag CTF playthrough)
- [x] WiFi hacking gate (airmon, airdump, aircrack)
- [ ] Step 13: Mission system (procedurally generated contracts)

## Recent Session (2026-02-19, Session 5)

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
  - `src/mission/missionBoard.ts` — 5 hardcoded sample contracts with formatted ASCII board
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
  - `session.wifiConnected` boolean added to Session type (persisted to IndexedDB)
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

## Next Action — Mission System Phase 4

Expand mission types, difficulty tiers, more machine role templates, more vulnerability patterns. See `.claude/docs/missions-design.md` and `PLAN.md` Step 13.

_Hidden network flag specs (14-16) archived to `docs/archive/`. See `.claude/docs/ctf-design.md` for the current CTF reference._

---

## Deferred: Victory Tracking

Flag detection, progress display, `flags()` command, victory celebration. See PLAN.md Step 13 for full spec.

---

## Infrastructure Ready

### Machines with Per-Machine Filesystems

| Machine    | IP            | Users                 | Flags                                              |
| ---------- | ------------- | --------------------- | -------------------------------------------------- |
| localhost  | 192.168.1.100 | jshacker, root, guest | FLAG 1, 2, 3                                       |
| gateway    | 192.168.1.1   | admin, guest          | FLAG 4, 5, 6                                       |
| fileserver | 192.168.1.50  | root, ftpuser, guest  | FLAG 7                                             |
| webserver  | 192.168.1.75  | root, www-data, guest | FLAG 8, 9, 10                                      |
| darknet    | 203.0.113.42  | root, ghost, guest    | FLAG 11, 12, 13                                    |
| shadow     | 10.66.66.1    | root, operator, guest | FLAG 14 — Fix the Script (nano+node debug)         |
| void       | 10.66.66.2    | root, dbadmin, guest  | FLAG 15 — Script Discovery (nano+node data mining) |
| abyss      | 10.66.66.3    | root, phantom, guest  | FLAG 16 — Exploit Script (nano+node XOR cipher)    |

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
- root@darknet: d4rkn3tR00t
- ghost@darknet: sp3ctr3
- guest@darknet: sh4d0w
- root@shadow: sh4d0w_r00t
- operator@shadow: c0ntr0l_pl4n3
- guest@shadow: demo
- root@void: v01d_null
- dbadmin@void: dr0p_t4bl3s
- guest@void: demo
- root@abyss: d33p_d4rk
- phantom@abyss: sp3ctr4l
- guest@abyss: demo

### Test Coverage

- 906 unit tests across 64 colocated test files
- 5 Playwright E2E tests: 1 CTF playthrough (16 flags + WiFi gate) + 4 mission playthroughs (SSH/FTP/NC variants + lifecycle)
- All commands with logic are tested
- WiFi commands tested: airmon (9), airdump (6), aircrack (8)
- FTP subcommands tested (cd, lcd, ls, lls, get, put)
- NC command and subcommands tested (nc, cat, cd, ls)
- Curl command tested (27 tests: errors, GET, POST, headers, DNS, async)
- Decrypt command tested (17 tests)
- Output command tested (16 tests)
- Resolve command tested (14 tests)
- Nano command tested (9 tests: existing/new files, permissions, errors)
- Node command tested (16 tests: execution, context access, execute permission, errors)
- NanoEditor component tested (17 tests: rendering, save, exit flow, modified indicator)
- Async commands tested with fake timers
- React hooks tested with React Testing Library (useCommandHistory, useVariables, useAutoComplete, usePathAutoComplete)
- React components tested with React Testing Library (TerminalOutput, TerminalInput, NanoEditor)
