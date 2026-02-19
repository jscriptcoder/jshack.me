# WIP: JSHACK.ME CTF Terminal Game

## Current Step

Theme system — complete, all tests passing

## Status

✅ COMPLETE — Theme system with persistent color themes (all 806 tests pass)

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

## Recent Session (2026-02-18)

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

## Next Action — Hidden Network Flags (14-16)

Three new flags on the hidden 10.66.66.0/24 network machines, each requiring the player to **write and execute JavaScript** with `nano` + `node`. Difficulty ramp: debug existing code → write data-gathering code → write a full decoder.

### Overview

| #   | Flag                    | Machine | Difficulty   | Recon    | Key Skills                       | Idea Source         |
| --- | ----------------------- | ------- | ------------ | -------- | -------------------------------- | ------------------- |
| 14  | `FLAG{shadow_debugger}` | shadow  | Intermediate | FTP      | nano, node, JavaScript debugging | Idea 1 (Fix Script) |
| 15  | `FLAG{void_data_miner}` | void    | Advanced     | NC :9999 | nano, node, cat() in code        | Idea 3 (Discovery)  |
| 16  | `FLAG{abyss_decryptor}` | abyss   | Expert       | SSH only | nano, node, XOR cipher decoding  | Idea 4 (Exploit)    |

### Credential Discovery Chain

Player reaches hidden network from darknet (after Flags 12-13).

Connection variety: **FTP → NC → SSH** (each machine uses a different recon method).

```
darknet (as root/ghost)
├── ifconfig() → see eth1: 10.66.66.100
├── /etc/hosts → shadow.hidden, void.hidden, abyss.hidden
├── /root/.hidden_network → lists services per machine:
│     shadow: FTP (port 21, guest/demo)
│     void: maintenance service (port 9999)
│     abyss: SSH only
│
├── shadow (FTP recon → SSH to solve)
│   ├── ftp("10.66.66.1") → login as guest/demo
│   ├── Browse /srv/ftp/exports/ → find operator creds + void hint
│   ├── quit() → ssh("operator", "10.66.66.1") with discovered password
│   └── Solve Flag 14 (debug script with nano+node)
│
├── void (NC recon → SSH to solve)
│   ├── nc("10.66.66.2", 9999) → connects as dbadmin (read-only shell)
│   ├── Browse recovery/ → preview challenge, find abyss hint
│   ├── exit() → ssh("guest", "10.66.66.2") → su("dbadmin") with password from auth.log
│   └── Solve Flag 15 (data extraction with nano+node)
│
└── abyss (SSH only — hardest)
    ├── ssh("guest", "10.66.66.3") → demo
    ├── /var/log/auth.log → phantom password
    ├── su("phantom") → solve Flag 16 (XOR cipher with nano+node)
    └── Credentials for phantom discovered via void NC recon
```

---

### FLAG 14: `FLAG{shadow_debugger}` — Fix the Script

**Machine**: shadow (10.66.66.1) | **User**: operator | **Difficulty**: Intermediate

**Theme**: Shadow is a monitoring/control server. Operator has a diagnostic script that extracts status tags from access logs, but it has 2 bugs. Player must debug with `nano` then run with `node`.

**Files to create**:

#### `/home/operator/diagnostics/README.txt` (readable by user+guest)

```
SHADOW MONITORING SYSTEM
========================

Diagnostic script: check_logs.js
Data source: access.log

The check_logs.js script extracts the tag field from each log entry
and concatenates them to reveal a status message. Operator reports
it's throwing errors and producing wrong output.

Log format: timestamp|source_ip|method|endpoint|status|tag

Run: node("diagnostics/check_logs.js")
Fix: nano("diagnostics/check_logs.js")
```

#### `/home/operator/diagnostics/access.log` (readable by user+guest)

21 log lines. The `tag` field (last column, pipe-delimited) of each line spells `FLAG{shadow_debugger}` one character at a time:

```
2024-03-15 08:00:01|10.66.66.100|GET|/api/heartbeat|200|F
2024-03-15 08:00:12|10.66.66.2|POST|/api/metrics|201|L
2024-03-15 08:00:23|10.66.66.3|GET|/api/status|200|A
2024-03-15 08:00:34|10.66.66.100|GET|/api/health|200|G
2024-03-15 08:00:45|10.66.66.2|DELETE|/api/cache|204|{
2024-03-15 08:00:56|10.66.66.100|POST|/api/report|201|s
2024-03-15 08:01:07|10.66.66.3|GET|/api/nodes|200|h
2024-03-15 08:01:18|10.66.66.100|GET|/api/heartbeat|200|a
2024-03-15 08:01:29|10.66.66.2|POST|/api/data|200|d
2024-03-15 08:01:40|10.66.66.3|GET|/api/status|200|o
2024-03-15 08:01:51|10.66.66.100|GET|/api/config|200|w
2024-03-15 08:02:02|10.66.66.2|POST|/api/metrics|201|_
2024-03-15 08:02:13|10.66.66.100|GET|/api/heartbeat|200|d
2024-03-15 08:02:24|10.66.66.3|GET|/api/health|200|e
2024-03-15 08:02:35|10.66.66.100|POST|/api/report|201|b
2024-03-15 08:02:46|10.66.66.2|GET|/api/nodes|200|u
2024-03-15 08:02:57|10.66.66.3|GET|/api/status|200|g
2024-03-15 08:03:08|10.66.66.100|GET|/api/heartbeat|200|g
2024-03-15 08:03:19|10.66.66.2|POST|/api/data|201|e
2024-03-15 08:03:30|10.66.66.3|GET|/api/config|200|r
2024-03-15 08:03:41|10.66.66.100|GET|/api/status|200|}
```

#### `/home/operator/diagnostics/check_logs.js` (readable+executable by user)

Buggy script with 2 bugs:

```javascript
const logs = cat('diagnostics/access.log');
const lines = logs.split('\n');
const result = [];
for (let i = 0; i <= lines.length; i++) {
  const parts = lines[i].split(',');
  if (parts.length >= 6) {
    result.push(parts[5]);
  }
}
echo(result.join(''));
```

**Bug 1**: `i <= lines.length` — accesses `lines[lines.length]` which is `undefined` → TypeError crash
**Bug 2**: `.split(",")` — log uses `|` delimiter, not `,` → fields.length is always 1, no output

**Debugging flow**:

1. `node("diagnostics/check_logs.js")` → `TypeError: Cannot read properties of undefined (reading 'split')`
2. Player uses `nano` to fix `<=` to `<`
3. Runs again → empty output (split on wrong delimiter)
4. Player reads `access.log`, sees pipe delimiters, fixes `","` to `"|"`
5. Runs again → `FLAG{shadow_debugger}`

#### FTP directory: `/srv/ftp/` (shadow has FTP on port 21)

Player FTPs in as guest/demo from darknet before SSH-ing. FTP provides recon files.

`/srv/ftp/exports/system_report.txt` (readable by guest):

```
SHADOW MONITORING — SYSTEM REPORT
===================================
Date: 2024-03-15

Active users:
  operator  — primary diagnostics account (password: c0ntr0l_pl4n3)
  guest     — read-only FTP access

Diagnostics status: FAILING
  Script /home/operator/diagnostics/check_logs.js has errors.
  Operator has been unable to fix it. See diagnostics/ for details.

Network notes:
  void.hidden (10.66.66.2) has a maintenance service on port 9999.
  Useful for previewing database recovery status.
```

`/srv/ftp/exports/network_status.txt` (readable by guest — noise):

```
NETWORK STATUS — 10.66.66.0/24
================================
shadow  (10.66.66.1)  — ONLINE  — monitoring/control
void    (10.66.66.2)  — ONLINE  — database server
abyss   (10.66.66.3)  — ONLINE  — secure vault
darknet (10.66.66.100) — ONLINE — gateway
```

**FTP recon flow**:

1. `ftp("10.66.66.1")` → login as guest/demo
2. `cd("/srv/ftp/exports")` → `ls()` → see system_report.txt, network_status.txt
3. `get("system_report.txt")` → download
4. `quit()` → `cat("system_report.txt")` → operator password + void hint
5. `ssh("operator", "10.66.66.1")` → c0ntr0l_pl4n3 → solve Flag 14

#### Other shadow files

- `/var/log/auth.log` — readable by guest, leaks operator password (backup credential path):
  ```
  [2024-03-15 08:23:11] pam_unix: session opened for user operator
  [2024-03-15 08:23:11] pam_auth: operator authenticated - password 'c0ntr0l_pl4n3'
  [2024-03-15 09:15:42] sshd: accepted connection from 10.66.66.100
  [2024-03-15 12:00:01] cron: running /etc/cron.daily/monitor
  ```
- `/home/operator/.bash_history` — noise:
  ```
  node diagnostics/check_logs.js
  cat diagnostics/access.log
  nano diagnostics/check_logs.js
  ping 10.66.66.2
  ssh dbadmin@10.66.66.2
  ```
- `/var/log/syslog` — noise monitoring logs

---

### FLAG 15: `FLAG{void_data_miner}` — Script-Based Discovery

**Machine**: void (10.66.66.2) | **User**: dbadmin | **Difficulty**: Advanced

**Theme**: Void is a database server. A master key was fragmented across 5 database table dumps for security. Each table has 20 data rows; only row 13 in each table's `hash` column contains a fragment. A manifest file explains the extraction pattern. Too tedious to do by hand — player writes a script.

**Files to create**:

#### `/home/dbadmin/recovery/manifest.txt` (readable by user+guest)

```
DATABASE RECOVERY MANIFEST
===========================

The master key was fragmented across 5 database table dumps
for security. Each table's "hash" column (4th field) at data
row 13 contains one fragment.

Tables (in order): table_01.csv through table_05.csv
Format: pipe-delimited, header row + 20 data rows
Target: row 13, column 4 ("hash")

Concatenate all 5 fragments in table order to reconstruct the key.

Hint: Writing a script is faster than doing this by hand.
      node() has access to cat() for reading files.
```

#### `/home/dbadmin/recovery/table_01.csv` through `table_05.csv`

Each file: header + 20 data rows, pipe-delimited: `id|name|status|hash|timestamp`

Row 13's `hash` field in each table:

- `table_01.csv` → `FLAG{`
- `table_02.csv` → `void_`
- `table_03.csv` → `data_`
- `table_04.csv` → `mine`
- `table_05.csv` → `r}`

All other rows have realistic-looking hex hash noise (e.g., `a3f8c2e1`, `9d4b7f20`).

**Expected player solution**:

```javascript
const tables = ['table_01.csv', 'table_02.csv', 'table_03.csv', 'table_04.csv', 'table_05.csv'];
const fragments = tables.map((t) => {
  const rows = cat('recovery/' + t).split('\n');
  return rows[13].split('|')[3];
});
echo(fragments.join(''));
// Output: FLAG{void_data_miner}
```

#### NC service: port 9999 "maintenance" (void has NC backdoor)

Player NCs in from darknet as dbadmin (read-only shell). Provides preview of challenge + abyss credentials.

Port config in `initialNetwork.ts`:

```
{ port: 9999, service: 'maintenance', open: true, owner: { username: 'dbadmin', userType: 'user', homePath: '/home/dbadmin' } }
```

**NC recon flow**:

1. `nc("10.66.66.2", 9999)` → connects as dbadmin
2. `ls("recovery")` → see manifest.txt, table_01.csv ... table_05.csv
3. `cat("recovery/manifest.txt")` → preview the challenge (need nano+node to solve)
4. `cat("/var/log/auth.log")` → dbadmin password (for SSH later)
5. `ls("/home/dbadmin", "-a")` → find `.abyss_notes`
6. `cat("/home/dbadmin/.abyss_notes")` → phantom credentials for abyss
7. `exit()` → back to darknet

`/home/dbadmin/.abyss_notes` (readable by user — visible via NC as dbadmin):

```
ABYSS ACCESS
=============
Vault server at abyss.hidden (10.66.66.3).
SSH only — no other services exposed.

Guest access: guest / demo
Vault operator: phantom / sp3ctr4l

The vault contains an encrypted payload that needs
a custom decryption script to decode.
```

#### Other void files

- `/var/log/auth.log` — readable by guest, leaks dbadmin password:
  ```
  [2024-03-16 10:15:22] pam_auth: dbadmin authenticated - password 'dr0p_t4bl3s'
  [2024-03-16 10:15:22] pam_unix: session opened for user dbadmin
  [2024-03-16 14:30:00] mysqld: backup completed to /home/dbadmin/recovery/
  ```
- `/home/dbadmin/.bash_history` — noise:
  ```
  mysqldump --all-databases > recovery/full_dump.sql
  ls recovery/
  cat recovery/manifest.txt
  ssh phantom@10.66.66.3
  ```
- `/var/lib/mysql/my.cnf` — noise database config
- `/var/log/mysql.log` — noise database logs

---

### FLAG 16: `FLAG{abyss_decryptor}` — Exploit Script (XOR Cipher)

**Machine**: abyss (10.66.66.3) | **User**: phantom | **Difficulty**: Expert

**Theme**: Abyss holds a vault with an encoded payload. The encoding is XOR with a repeating key, then hex-encoded. Player must write a full decoder script. The key is in a separate file.

**Files to create**:

#### `/home/phantom/vault/README.txt` (readable by user+guest)

```
THE VAULT
=========

This vault contains an encrypted payload that was intercepted
from the network. The encoding scheme is documented in cipher.txt.
The key is stored separately in key.txt.

You'll need to write a decryption script to recover the plaintext.
Use nano() to create your script and node() to execute it.
```

#### `/home/phantom/vault/cipher.txt` (readable by user+guest)

```
CIPHER SPECIFICATION
====================

Algorithm: XOR with repeating key
Encoding: each XOR'd byte is hex-encoded (2 hex chars per byte)
Format: space-separated hex pairs

Decryption steps:
  1. Read the hex pairs from encoded_payload.txt
  2. Read the key from key.txt
  3. For each hex pair: convert to integer, XOR with key byte
     (key repeats cyclically)
  4. Convert resulting bytes to characters

Note: XOR is its own inverse — same operation encrypts and decrypts.
```

#### `/home/phantom/vault/key.txt` (readable by user)

```
ABYSS
```

#### `/home/phantom/vault/encoded_payload.txt` (readable by user)

Pre-computed XOR of `FLAG{abyss_decryptor}` with repeating key `ABYSS`:

```
07 0e 18 14 28 20 20 20 20 20 1e 26 3c 30 21 38 32 2d 3c 21 3c
```

Computation detail (for verification during implementation):

```
F(46)^A(41)=07  L(4c)^B(42)=0e  A(41)^Y(59)=18  G(47)^S(53)=14
{(7b)^S(53)=28  a(61)^A(41)=20  b(62)^B(42)=20  y(79)^Y(59)=20
s(73)^S(53)=20  s(73)^S(53)=20  _(5f)^A(41)=1e  d(64)^B(42)=26
e(65)^Y(59)=3c  c(63)^S(53)=30  r(72)^S(53)=21  y(79)^A(41)=38
p(70)^B(42)=32  t(74)^Y(59)=2d  o(6f)^S(53)=3c  r(72)^S(53)=21
}(7d)^A(41)=3c
```

Fun pattern: bytes 5-9 are all `20` (space) because `abyss` XOR `ABYSS` = lowercase XOR uppercase = 0x20 for each. A keen player might notice this and deduce the key!

**Expected player solution**:

```javascript
const hex = cat('vault/encoded_payload.txt').trim();
const key = cat('vault/key.txt').trim();
const bytes = hex.split(' ');
const decoded = bytes
  .map((b, i) => String.fromCharCode(parseInt(b, 16) ^ key.charCodeAt(i % key.length)))
  .join('');
echo(decoded);
// Output: FLAG{abyss_decryptor}
```

#### Other abyss files

- `/var/log/auth.log` — readable by guest (noise only, no password leak — creds come from void):
  ```
  [2024-03-17 14:32:45] pam_unix: session opened for user phantom
  [2024-03-17 14:33:01] sshd: connection from 10.66.66.100
  [2024-03-17 15:00:00] cron: running /etc/cron.daily/backup
  ```
- `/home/phantom/.bash_history` — noise:
  ```
  ls vault/
  cat vault/cipher.txt
  cat vault/encoded_payload.txt
  nano decode.js
  ```
- `/var/log/syslog` — noise system logs

**Credential path**: Phantom's password (`sp3ctr4l`) is NOT leaked on abyss itself.
Player must discover it from void's `/home/dbadmin/.abyss_notes` via NC recon.
This forces the FTP→NC→SSH chain rather than allowing players to skip ahead.

---

### Cross-Cutting: Darknet Hint File

Add to darknet filesystem (readable by root or ghost):

#### `/root/.hidden_network` on darknet

```
HIDDEN NETWORK ACCESS
=====================

Internal network: 10.66.66.0/24 (via eth1)

Machines:
  shadow.hidden  (10.66.66.1)  — monitoring/control
    Services: FTP (port 21), SSH (port 22)
    FTP access: guest / demo

  void.hidden    (10.66.66.2)  — database server
    Services: SSH (port 22), maintenance (port 9999)
    Maintenance port may have useful access.

  abyss.hidden   (10.66.66.3)  — secure vault
    Services: SSH (port 22) only
    High security. Credentials unknown.

Start with shadow — FTP exports contain useful intel.
```

---

### Implementation Checklist

#### Flag 14 — Shadow (FTP + SSH) ✅

- [x] Update `src/network/initialNetwork.ts`:
  - Add FTP port 21 to `shadowMachine` ports
- [x] Expand `src/filesystem/machines/shadow.ts` with full filesystem content
  - `/srv/ftp/exports/` — system_report.txt (operator creds + void hint), network_status.txt (noise)
  - `/home/operator/diagnostics/` — README.txt, access.log, check_logs.js
  - Auth log with operator password leak (backup credential path)
  - Noise files (.bash_history, syslog)
  - Guest home (empty or minimal)
- [x] Set correct permissions:
  - FTP exports readable by guest (for FTP browsing)
  - Diagnostics files readable+executable by user
  - Auth.log readable by guest
- [x] Add tests in `src/filesystem/machines/shadow.test.ts`
  - Verify access.log tag characters spell `FLAG{shadow_debugger}`
  - Verify check_logs.js contains the 2 bugs
  - Verify FTP exports contain operator password and void hint
- [x] Update darknet.ts: add `/root/.hidden_network` hint file (lists services per machine)
- [x] Build + test pass

#### Flag 15 — Void (NC + SSH) ✅

- [x] Update `src/network/initialNetwork.ts`:
  - Add maintenance port 9999 to `voidMachine` ports with owner: `{ username: 'dbadmin', userType: 'user', homePath: '/home/dbadmin' }`
- [x] Expand `src/filesystem/machines/void.ts` with full filesystem content
  - `/home/dbadmin/recovery/` — manifest.txt, 5 CSV table files
  - `/home/dbadmin/.abyss_notes` — phantom credentials for abyss (visible via NC as dbadmin)
  - Auth log with dbadmin password leak
  - Noise files (.bash_history, mysql config/logs)
- [x] Generate 5 CSV tables with 20 data rows each, fragment at row 13 col 4
- [x] Set correct permissions:
  - Recovery files readable by user+guest
  - .abyss_notes readable by user only (so NC as dbadmin can read, but guest SSH cannot)
- [x] Add tests in `src/filesystem/machines/void.test.ts`
  - Verify fragments at row 13, column 4 concatenate to `FLAG{void_data_miner}`
  - Verify manifest describes the correct extraction pattern
  - Verify .abyss_notes contains phantom credentials
- [x] Build + test pass

#### Flag 16 — Abyss (SSH only) ✅

- [x] Expand `src/filesystem/machines/abyss.ts` with full filesystem content
  - `/home/phantom/vault/` — README.txt, cipher.txt, key.txt, encoded_payload.txt
  - Auth log (noise only — NO phantom password leak; creds from void)
  - Noise files (.bash_history, syslog)
- [x] Verify XOR computation: hex pairs decode correctly with key `ABYSS`
- [x] Set correct permissions
- [x] Add tests in `src/filesystem/machines/abyss.test.ts`
  - Verify XOR decode of encoded_payload.txt with key.txt produces `FLAG{abyss_decryptor}`
  - Verify cipher.txt documents the algorithm
  - Verify auth.log does NOT contain phantom password
- [x] Build + test pass

#### Final

- [ ] Update docs: CLAUDE.md (project structure if needed), README.md (test count), CTF_DESIGN.md
- [ ] Update WIP.md: move to completed, update test count
- [ ] Playtest the full hidden network chain: darknet → FTP shadow → NC void → SSH abyss

---

## Deferred: Victory Tracking (Step 13)

Flag detection, progress display, `flags()` command, victory celebration. Deferred until hidden network flags are complete. See PLAN.md Step 13 for full spec.

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

- 806 unit tests across 54 colocated test files
- 1 Playwright E2E test (full 16-flag CTF playthrough + WiFi gate, ~42s in Chromium)
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
