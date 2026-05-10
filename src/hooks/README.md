# Hooks

Custom React hooks that wire together commands, context, and terminal features. These are the glue between the UI (Terminal component) and the domain logic (commands, filesystem, network, session).

## Files

| File                       | Description                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCommands.ts`           | Master command registry — combines all command sources into a single execution context and command name list                                                                                                               |
| `useFileSystemCommands.ts` | Creates filesystem commands (pwd, ls, cd, cat, whoami, gpg, output, strings, nano) with context from `useFileSystem` and `useSession`                                                                                      |
| `useNetworkCommands.ts`    | Creates network commands (ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc, msfconsole, gobuster) with context from `useNetwork` and `useFileSystem`. Applies version overlays and wires game time into network commands |
| `useFtpCommands.ts`        | Creates FTP-mode commands (pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye) — returns `null` when not in FTP mode                                                                                                          |
| `useNcCommands.ts`         | Creates NC-mode commands (pwd, cd, ls, cat, whoami, help, exit) — read-only recon shell, returns `null` when not in NC mode                                                                                                |
| `useWifiCommands.ts`       | Creates WiFi commands (airmon, airdump, aircrack, nmcli) — generates WiFi networks from game seed, manages monitor mode state via `useRef`                                                                                 |
| `useCommandHistory.ts`     | Up/down arrow navigation through previous commands                                                                                                                                                                         |
| `useMysqlCommands.ts`      | Creates MySQL-mode commands (SQL parsing + execution) — returns `null` when not in MySQL mode                                                                                                                              |
| `useRedisCommands.ts`      | Creates Redis-mode commands (KEYS, GET, SET, DEL, DBSIZE, AUTH, QUIT) — returns `null` when not in Redis mode                                                                                                              |
| `useAuthentication.ts`     | Password/SSH/FTP/su authentication state and logic — manages password prompts, credential validation, and session transitions on successful login                                                                          |

Tab completion lives in `src/shell/complete.ts` (tokenizer-aware, classifies cursor as command / path / flag / redirect-target). Terminal.tsx wires the adapter using filesystem helpers and the command registry.

## How Commands Are Assembled

`useCommands` is the top-level hook consumed by `Terminal.tsx`. It merges commands from multiple sources:

```
useCommands()
├── Static commands (echo, author, clear, exit, resolve)
├── theme (uses setTheme from session context — unrestricted, guest-accessible)
├── node (lazy getter for execution context — needs access to all commands including itself)
├── Mission commands (missions, accept, abort, mail — uses useMission() context)
├── apt (package manager — install tools on remote machines)
├── useFileSystemCommands() → pwd, ls, cd, cat, whoami, gpg, output, strings, nano, john
├── useNetworkCommands()    → ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc, msfconsole, gobuster
├── useWifiCommands()       → airmon, airdump, aircrack, nmcli
├── su (depends on current machine's user list)
├── sshd, vsftpd, systemctl (daemon commands — root-only, write/delete PID files for dynamic port opening)
├── bash (execute binary by path — lazy getter for execution context, same as node)
└── help, man (created last, with access to all commands above)
```

After assembly, all non-builtin/non-game commands are wrapped with a unified access check (from `availability.ts`):

- `wrapWithAccessCheck` checks binary existence + execute permissions at execution time
- Binary missing → `"command not found"` (with apt install hint for apt-installable tools)
- Binary exists but no execute permission → `"Permission denied"`
- All commands are visible to all users — no user-type filtering for tab autocomplete or `help`
- `man` receives all commands regardless

Returns `{ executionContext, commandNames }` where:

- `executionContext` — `Record<string, Function>` injected into `new Function()` for evaluation (with restrictions applied)
- `commandNames` — list of accessible names for tab autocompletion

## Mode-Specific Hooks

`useFtpCommands` and `useNcCommands` return `Map<string, Command> | null`. When active (non-null), `Terminal.tsx` swaps out the normal command set for the mode-specific one.

## Input Hooks

| Hook                | Used By        | Description                                                                                               |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `useCommandHistory` | `Terminal.tsx` | Tracks command history array and current index; `navigateUp()`/`navigateDown()` return the command string |

Shell input parsing (tokenize / parse / execute) and tab completion live in `src/shell/`. See `src/shell/README.md` (if present) or the shell module exports.

## Authentication Hook

| Hook                | Used By        | Description                                                                                                    |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `useAuthentication` | `Terminal.tsx` | Manages password prompt state (su/SSH/FTP), credential validation, and session transitions on successful login |

`useAuthentication` encapsulates four authentication flows:

- **su** — validates password against `/etc/passwd` hashes on the current machine, switches user type; triggers `onSuAuth` callback
- **SSH** — validates against remote machine user list, pushes session stack, resolves NAT, switches to remote machine. Saves SSH key on success; auto-authenticates on subsequent connections. Triggers `onSshAuth` callback
- **SCP** — validates against remote machine user list, triggers file transfer. Saves SSH key on success; auto-authenticates on subsequent connections. Triggers `onSshAuth` callback (SCP uses SSH auth)
- **FTP** — two-stage login (username → password), validates against remote machine, enters FTP mode session; triggers `onFtpAuth` callback

**Logging integration:** All four flows call auth callbacks (`onSuAuth`, `onSshAuth`, `onFtpAuth`) on both success and failure. These callbacks are defined in Terminal.tsx and write log entries to target machine log files via `src/logging/`. See `src/logging/README.md` for log formats and details.

**SSH key persistence**: After first successful SSH/SCP password auth, saves a fingerprint-signed entry (`user@ip:md5(user:ip:passwordHash)`) to `~/.ssh_keys` on the source machine. On subsequent connections, `hasAuthorizedKey()` recomputes the fingerprint from the remote user's password hash and verifies it — manually crafted entries are rejected. The `connectSsh()` helper extracts the shared session setup logic used by both auto-auth and password-auth paths.

Returns `startPasswordPrompt()`, `startSshPrompt()`, `startFtpPrompt()`, `startScpPrompt()` for triggering prompts, and `handlePasswordSubmit()`, `handleFtpUsernameSubmit()` for processing input. `startSshPrompt` and `startScpPrompt` check for saved keys and auto-authenticate when found. Terminal.tsx passes the current `input` and a `clearInput` callback to the submit handlers.

## Version Overlays

`useNetworkCommands` applies version overlays transparently to all machine reads via `applyVersionOverlay(machine, readFileFromMachine)`. When a machine has service version files in `/var/lib/apt/service_versions/<service>`, the overlay replaces the port's `serviceVersion` in the returned `RemoteMachine` object. Commands (nmap, msfconsole, etc.) receive overlay-aware views without needing to know the overlay exists.

Three overlay-aware accessors replace direct `getMachine`/`findMachineByIp`/`getMachines` calls for commands that need current service versions:

- `getEffectiveMachine(ip)` — single machine lookup with overlay
- `findEffectiveMachineByIp(ip)` — IP-based lookup with overlay
- `getEffectiveMachines()` — all machines with overlays applied

## Game Time Integration

`getGameTime` from `src/session/gameTime.ts` is wired into multiple command contexts so that time-sensitive mechanics (CVE discovery dates, vulnerability availability) work correctly:

- **`useNetworkCommands`** — passes `getGameTime` into:
  - **nmap** context — filters displayed CVEs by game time
  - **msfconsole** context — filters exploitable vulnerabilities by game time
  - **`onExploitAttempt`** callback — uses `getGameTime()` when looking up vulnerabilities via `findVulnForService`
- **`useCommands`** — passes `getGameTime` into the **apt** command context for `apt upgrade`'s time-based CVE filtering (patching a service only removes CVEs discoverable at the current game time)

## Msfconsole Filesystem Helpers

The msfconsole command context receives helper functions to support typed vulnerability effects that need to read/write files on target and attacker machines:

| Helper                                             | Description                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readRemoteFile(machineId, path, tier?)`           | Synchronous local read. Used by `--local` dpkg parsing and `password_reset`'s pre-write `/etc/passwd` read.                                                                                                                                                                                            |
| `readLocalFile(path)`                              | Reads a file from the attacker's current machine as current user                                                                                                                                                                                                                                       |
| `writeRemoteFile(machineId, path, content, tier?)` | Writes a file to the target. Wraps in `withTransientSession` (kind `effect_one_shot`) so L1 sees a session row at fire time. Returns `{ allowed, error? }`.                                                                                                                                            |
| `listRemoteDir(machineId, path, tier?)`            | Synchronous local directory listing.                                                                                                                                                                                                                                                                   |
| `exploitFileRead(machineId, path, tier)`           | Async cross-player-aware read for the `file_read` CVE effect (PR 7 of cross-player-base-fs-replication). On cross-player workstation targets, dispatches to `/api/patches` action `exploitRead` inside a `withTransientSession`; on NPC and own-workstation targets, falls back to local read at tier. |
| `exploitDirList(machineId, path, tier)`            | Same dispatch shape as `exploitFileRead` for the `dir_list` CVE effect.                                                                                                                                                                                                                                |
| `runScriptOnTarget(machineId, script, tier)`       | Blind script injection — executes script on target with full command context (sshd, vsftpd, systemctl, ps, nc, cat, ls, echo) at given tier. Returns `{ error }`, no output.                                                                                                                           |

The sync helpers delegate to `readFileFromMachine`, `writeFileToMachine`, and `listDirectoryFromMachine` from `useFileSystem`. The async `exploit*` helpers dispatch via `parseWorkstationId(canonical) !== undefined && !isOwnWorkstation(...)`: cross-player workstation → `exploitRead` server endpoint; else → local read. Cross-player base FS replication for own-workstation reads is covered by PR 6's `getBaseFs` (eager-fetched on session establish).
