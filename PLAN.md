# Plan: JSHACK.ME CTF Terminal Game

## Goal

Build a web-based CTF (Capture The Flag) hacking game where players use a JavaScript terminal to explore a virtual file system, escalate privileges, and hack into remote machines to find 16 hidden flags.

## Acceptance Criteria

- [x] Terminal with JavaScript execution and custom commands
- [x] Virtual Unix-like file system with permissions
- [x] User authentication system (su command with password hashing)
- [x] Network simulation with multiple machines
- [x] Network reconnaissance commands (ifconfig, ping, nmap, nslookup)
- [x] Remote machine access (ssh, ftp, nc)
- [x] Per-machine file systems with unique content
- [x] 16 hidden flags with guided progression across 8 machines
- [x] Command restrictions by user type (guest/user/root tiers)
- [x] Additional exploitation commands (curl, strings, decrypt, output, resolve, exit)
- [x] Session and filesystem persistence (IndexedDB)
- [x] Realistic filesystem noise (configs, logs, dotfiles, red herrings)
- [x] WiFi hacking gate — aircrack-ng suite (airmon, airdump, aircrack) as network access prerequisite
- [x] Terminal color theming — `theme()` command with 4 persistent themes (amber, green, cyan, light) via CSS custom properties
- [x] Unit tests (938 tests across 65 files)
- [ ] Mission system — procedurally generated hacker-for-hire contracts (see `.claude/docs/missions-design.md`)

## Steps

### Step 1: Core terminal with JavaScript execution (Done)

Terminal component with input/output, command history, tab autocompletion (commands, variables, and file paths inside string arguments), `new Function()` evaluation.

### Step 2: Virtual file system (Done)

Unix-like directory structure with read/write/execute permissions per user type (root/user/guest). FileNode tree with `createFileSystem()` factory.

### Step 3: File system commands (Done)

pwd, ls, cd, cat commands with permission checking. Dotfile filtering (hidden by default, `-a` to show).

### Step 4: User authentication (Done)

su command with MD5 password hashing, /etc/passwd file per machine.

### Step 5: Network infrastructure (Done)

NetworkContext with interfaces, remote machines (gateway, fileserver, webserver, darknet), DNS records.

### Step 6: Network commands (Done)

ifconfig, ping (async), nmap (async), nslookup (async) — all use AsyncOutput streaming pattern.

### Step 7: Remote access — SSH (Done)

ssh command with async connection, password authentication, session stack (pushSession/popSession). exit command to return.

### Step 8: Place flags in file system (Done)

16 flags across 8 machines with guided progression. Flag files, encrypted files (AES-256-GCM), binary files for strings.

### Step 9: Add hints and breadcrumbs (Done)

Credential chain: log files, config files, web pages leak passwords for next machine. Each flag hints at the next.

### Step 10: Remote machine file systems (Done)

Per-machine filesystems via `machineFileSystems.ts`. FileSystemContext stores ALL machine filesystems in state. Cross-machine methods for FTP/curl.

### Step 11: Additional exploitation commands (Done)

- **ftp** — FTP mode with dedicated command set (pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye)
- **nc** — Netcat with interactive backdoor mode (read-only shell as service owner)
- **curl** — HTTP client with GET/POST, DNS resolution, per-machine server config
- **decrypt** — AES-256-GCM decryption via Web Crypto API (root only)
- **strings** — Extract printable strings from binary files
- **output** — Capture command output to variable or file
- **resolve** — Unwrap Promises and display resolved value
- **exit** — Close SSH/NC connection and return to previous session

### Step 12: Session persistence (Done)

IndexedDB (`jshack-db` database) with pre-load cache pattern. Session state, session stack, FTP/NC sessions persisted. Filesystem patches (user-created/modified files) persisted separately. One-time auto-migration from localStorage.

### Step 12b: WiFi hacking gate (Done)

Network access from localhost gated behind WiFi cracking — a progression gate between flags 3 and 4 (no flag awarded). Player must use aircrack-ng-inspired commands:

- **airmon** — Enable/disable monitor mode on wlan0
- **airdump** — Scan for nearby WiFi networks (async output, 4 networks displayed)
- **aircrack** — Crack WPA2 key (async output with progress; only JSHACK-CORP is crackable)

Implementation: `session.wifiConnected` boolean (persisted), localhost uses `wlan0` (not `eth0`) + `lo` loopback, `NetworkContext` gates interfaces/machines/DNS when disconnected, network commands throw "Network is unreachable" until WiFi connected. Monitor mode is transient (`useRef`). WiFi networks defined in `src/network/wifiNetworks.ts`. Hint file at `~/downloads/wifi_tools.txt`.

### Step 13: Mission System (Next)

Procedurally generated hacker-for-hire contracts with seed-based network generation. The 16 existing flags serve as the introduction/tutorial. Full design: `.claude/docs/missions-design.md`.

**Phases:**

1. ~~Seeded network generator (PRNG, topology, users, filesystems, vulnerabilities)~~ ✅ Done
2. ~~Mission board UI + integration (accept/abort/complete, context providers, persistence)~~ ✅ Done
3. ~~First mission template (E2E proof of concept — 3 bug fixes making missions playable)~~ ✅ Done
4. ~~Vulnerability scanning & exploit system (nmap -sV, exploit command, exploit entry variant, guest password variation)~~ ✅ Done
5. Expand mission types (tamper, plant, chain missions)
6. Polish and social (reputation, seed sharing, history)

## Test Coverage

938 tests across 65 colocated test files:

- All commands with logic are tested (factory pattern with mock context injection)
- FTP subcommands tested (cd, lcd, ls, lls, get, put)
- NC command and subcommands tested (nc, cat, cd, ls)
- WiFi commands tested: airmon (9), airdump (6), aircrack (8)
- curl tested (27 tests: errors, GET, POST, headers, DNS, async)
- decrypt tested (17 tests), output (16), resolve (14), strings (12)
- exploit tested (18 tests: validation, DNS, connection errors, async output, cancellation)
- Permissions module tested (21 tests)
- Async commands tested with fake timers
- React hooks tested (useCommandHistory, useVariables, useAutoComplete, usePathAutoComplete)
- React components tested (TerminalOutput, TerminalInput, NanoEditor)
- IndexedDB persistence tested (storage wrapper: 14, cache/migration: 14)
- Theme system tested (theme command: 7, applyTheme: 5)

## Future Ideas

### User-Generated Content

Allow players to create and share missions via seed codes. Community voting, ratings, weekly challenges.

### Backend Integration

Mission catalog API, player accounts, leaderboards. Options: Supabase, Firebase, or self-hosted.
