# Commands

All terminal commands live here. Each command implements the `Command` type and is registered in `src/hooks/useCommands.ts` (general/filesystem) or `src/hooks/useNetworkCommands.ts` (network).

Commands use a factory pattern with context injection: `createXCommand(context) => Command`.

## Input syntax

Interactive input uses a **shell-style parser** (`src/shell/`) that tokenizes commands, arguments, flags, single/double quotes, backslash escapes, pipes (`|`), and output redirect (`>`). Players type `nmap 10.10.10.10 -sV`, `cat /etc/passwd | grep root > out.txt` — matching real Linux muscle memory.

**Scripts** (`.js` files executed via `node`) keep their JavaScript calling convention: `nmap('10.10.10.10', '-sV')`. The tables below show the **shell form** in the Usage column. Scripts call the same command as a function with quoted string arguments.

## Access Control (`availability.ts`)

Commands use a unified filesystem-based access model. All commands are visible to all users — execution is gated by binary file permissions.

- **Shell builtins** (cd, exit, clear, echo, pwd, help, whoami, bash) — always available, no binary needed
- **Game commands** (missions, accept, abort, mail, author, theme, reset, xterm) — always available
- **Script-only helpers** (`writeFile`) — live in `src/scripting/` and are injected into `executionContext` only; never dispatched by the shell parser. Interactive equivalents: `>` for file writes, `await` for unwrapping async commands.
- **System utilities** in `/bin/` — always present on all machines; most are world-executable
- **Apt-installable tools** in `/usr/bin/` — must be installed via `apt install <tool>` as root (requires network); only WiFi tools (airmon, airdump, aircrack), node, and gpg are pre-installed on localhost
- **Admin utilities** in `/usr/sbin/` — root-only daemon management (`sshd`, `vsftpd`, `systemctl`); write PID files to `/var/run/` for dynamic port opening
- **Restricted binaries** — `reboot`, `gpg`, `sshd`, `vsftpd`, and `systemctl` have `execute: ['root']`; all others are world-executable

At execution time, `wrapWithAccessCheck` checks binary existence and execute permissions:

- Binary missing → `"bash: name: command not found"` (with apt install hint for apt-installable tools)
- Binary exists but no execute permission → `"bash: name: Permission denied"`

| Category         | Location     | Availability                                                             |
| ---------------- | ------------ | ------------------------------------------------------------------------ |
| Shell builtins   | N/A          | Always (cd, exit, clear, echo, pwd, help, whoami, bash)                  |
| System utilities | `/bin/`      | Always (ls, cat, rm, chmod, scp, su, man, nano, strings, ssh, etc.)      |
| Admin utilities  | `/usr/sbin/` | Always present, root-only (sshd, vsftpd, systemctl)                      |
| Apt-installable  | `/usr/bin/`  | After `apt install` (WiFi tools + node + gpg pre-installed on localhost) |
| Game-specific    | N/A          | Always (missions, accept, abort, mail, author, theme, reset, xterm)      |

FTP and NC modes have their own separate command sets and are not restricted.

## Adding New Commands

1. Create file in `src/commands/` exporting a `Command` object (see `src/components/Terminal/types.ts` for type)
2. Register in `src/hooks/useCommands.ts` via `commands.set('name', myCommand)`
3. If it needs a binary, add to `SYSTEM_UTILITY_NAMES` (for `/bin/`) or `APT_TOOL_NAMES` (for `/usr/bin/`) in `src/commands/availability.ts`
4. If it should be root-only, add to `RESTRICTED_EXECUTE` in `availability.ts`

## Wordlist System

Tools like hydra and gobuster use filesystem-based wordlists installed via `apt install`. Wordlists live at `/usr/share/wordlists/` and are also resolved from cwd (for SCP'd tools). Content is generated from encoded secrets at runtime (`src/commands/wordlists.ts`).

- **`passwords.txt`** (installed with hydra) — Contains `GUEST_PASSWORDS` + `WORDLIST_PASSWORDS`, one per line. Hydra reads this file and uses it as the **sole gate**: if a password is in the wordlist it will be cracked, if not it won't. Same wordlist + same target = same deterministic outcome. Root passwords (from `MISSION_PASSWORDS`) are never in the wordlist.
- **`dirlist.txt`** (installed with gobuster) — Contains ~50 common web directory/file names. Gobuster only reveals entries whose top-level path segment matches the dirlist (e.g., `/admin/config.json` shown only if `admin` is in the dirlist).
- **Resolution**: `resolveWordlist(filename, getNode, cwd)` in `src/utils/wordlist.ts` checks cwd first, then `/usr/share/wordlists/`.

## Node Execution

`node <path>` executes JavaScript files with access to all terminal commands. Two execution modes:

- **Sync mode** (default): Uses `new Function()`. Expression-first, falls back to statement mode. Echo calls are buffered and joined.
- **Async mode** (when script contains `await`): Uses `AsyncFunction` constructor. Returns `AsyncOutput` to Terminal for streaming. Commands returning `AsyncOutput` (hydra, nmap, etc.) are auto-wrapped so `await hydra(...)` resolves to `string[]`. Provides `console.log()`, `sleep(ms)`, and cancellation via Ctrl+C.

**Programmatic auth in scripts**: Interactive commands accept optional credentials for scripting: `su('root', 'pw')` (sync inline auth), `await ssh('user@ip', 'pw')`, `await scp(src, dst, 'pw')`, `await ftp('ip', 'user', 'pw')`. `su` is synchronous so subsequent lines run as the new user. SSH/SCP/FTP embed credentials in their async follow-up data.

**Script-only helpers** (`src/scripting/`): `writeFile(path, content)` writes content to a file with the current user's permissions. Arrays of strings are joined with `\n` so `const lines = await hydra(...); writeFile('/tmp/out.log', lines)` works without a `.join()`. Helpers live in `executionContext` only — they never appear in the shell command registry. Interactive redirect `>` replaces file-write scripting needs at the prompt; `await` replaces the old `resolve()` for unwrapping async commands.

**Circular dependency**: `node <path>` needs the execution context which includes `node` itself. Resolved via a lazy getter pattern: mutable `let resolvedExecutionContext` in `useCommands.ts` is set after building the full command map, and node's factory captures a getter that's only called at execution time.

## General

| Command | File        | Usage                 | Description                                                              |
| ------- | ----------- | --------------------- | ------------------------------------------------------------------------ |
| help    | `help.ts`   | `help`                | List all available commands                                              |
| man     | `man.ts`    | `man <cmd>`           | Display detailed manual for a command                                    |
| echo    | `echo.ts`   | `echo <value>`        | Output a value                                                           |
| author  | `author.ts` | `author`              | Display author profile card                                              |
| clear   | `clear.ts`  | `clear`               | Clear the terminal screen                                                |
| exit    | `exit.ts`   | `exit`                | Return to previous session (SSH connection or user via su)               |
| reset   | `reset.ts`  | `reset [confirm]`     | Reset game to factory defaults (clears all saved progress)               |
| theme   | `theme.ts`  | `theme [name]`        | List or switch terminal color themes (persists)                          |
| apt     | `apt.ts`    | `apt <sub> [pkg]`     | Package manager — install tools, upgrade/pin services (requires network) |
| xterm   | `xterm.ts`  | `xterm`               | Open a new terminal session in a separate browser tab                    |
| bash    | `bash.ts`   | `bash <path> [args…]` | Execute binary by filesystem path (shell builtin)                        |

### apt Subcommands

The `apt` command has three subcommands: `list`, `install`, and `upgrade`.

**`apt list` / `apt list -i`** — list available or installed packages.

**`apt install <pkg>`** — install a binary tool (nmap, hydra, etc.) into `/usr/bin/`. Requires root and network connectivity.

**`apt install <pkg>=<version>`** — pin a specific version of a service or router firmware. Uses scp-style syntax for the package name (e.g., `apt install http=Apache/2.4.49`, `apt install 'firmware=MikroTik RouterOS 7.14.3'`). Validates the version exists in the procedural timeline or hand-authored CVE table. Requires root.

**`apt upgrade`** — upgrade all vulnerable services on the current machine to the latest safe version. Reads and writes `/var/lib/dpkg/status`. Requires root. Requires WiFi when running on localhost.

**`apt upgrade <service>`** — upgrade only the named service (e.g., `apt upgrade http`).

**`apt upgrade firmware`** — upgrade router firmware to the latest safe version (router machines only).

Upgrade targets are computed via `getLatestSafeVersion()` from the procedural timeline — the newest version whose CVE (if any) has `publishedAt > currentGameTime`.

## Daemon

Admin utilities that write PID files to `/var/run/` — `NetworkContext` reads these to dynamically open ports.

| Command   | File           | Usage                      | Description                                                        |
| --------- | -------------- | -------------------------- | ------------------------------------------------------------------ |
| sshd      | `sshd.ts`      | `sshd [port]`              | Start SSH daemon (root-only, writes `/var/run/sshd.pid`)           |
| vsftpd    | `vsftpd.ts`    | `vsftpd [port]`            | Start FTP daemon (root-only, writes `/var/run/vsftpd.pid`)         |
| systemctl | `systemctl.ts` | `systemctl <action> <svc>` | Control services: start, stop, status (root-only)                  |
| nc -l     | `nc.ts`        | `nc -l <port>`             | Open backdoor listener (any user, writes `/var/run/nc-<port>.pid`) |

## Mission

| Command  | File          | Usage                        | Description                                               |
| -------- | ------------- | ---------------------------- | --------------------------------------------------------- |
| missions | `missions.ts` | `missions`                   | Browse available hacker-for-hire contracts on the darknet |
| accept   | `accept.ts`   | `accept <seed>`              | Accept a mission contract and generate the target network |
| abort    | `abort.ts`    | `abort`                      | Abort the current mission and return to localhost         |
| mail     | `mail.ts`     | `mail <recipient> <content>` | Send proof to a darknet client to complete a mission      |

## File System

| Command | File         | Usage                          | Description                                                     |
| ------- | ------------ | ------------------------------ | --------------------------------------------------------------- |
| pwd     | `pwd.ts`     | `pwd`                          | Print current working directory                                 |
| ls      | `ls.ts`      | `ls [path] [-a] [-l]`          | List directory contents (`-a` hidden, `-l` long format)         |
| cd      | `cd.ts`      | `cd [path]`                    | Change current directory                                        |
| cat     | `cat.ts`     | `cat <path>`                   | Display file contents                                           |
| find    | `find.ts`    | `find <path> <pattern> [user]` | Recursively search for files/directories by glob pattern        |
| grep    | `grep.ts`    | `grep <pattern> <path> [-l]`   | Search file contents for a pattern (case-insensitive)           |
| rm      | `rm.ts`      | `rm [-r] [-f] <path>…`         | Remove files or directories (-r recursive, -f force)            |
| whoami  | `whoami.ts`  | `whoami`                       | Display current username                                        |
| gpg     | `gpg.ts`     | `gpg <file> <key>`             | Decrypt file using AES-256 (async, root-only)                   |
| strings | `strings.ts` | `strings <file> [min]`         | Extract printable strings from binary files                     |
| nano    | `nano.ts`    | `nano <path>`                  | Open file in nano-style text editor overlay                     |
| node    | `node.ts`    | `node <path>`                  | Execute a JavaScript file — supports `await` for async commands |
| john    | `john.ts`    | `john <file>`                  | Crack password hashes using dictionary attack (async)           |
| chmod   | `chmod.ts`   | `chmod <mode> <path>`          | Change file permissions (symbolic: `o+x`, `u-w`, etc.)          |
| reboot  | `reboot.ts`  | `reboot`                       | Reboot current machine; bricks if boot files missing            |
| ps      | `ps.ts`      | `ps`                           | Report running processes (reads PID files from `/var/run/`)     |
| kill    | `kill.ts`    | `kill <pid>`                   | Terminate a process by PID (deletes PID file)                   |

Redirect `>` is the interactive way to capture command output to a file. Scripts use the `writeFile(path, content)` helper (see `src/scripting/`).

## User Management

| Command | File    | Usage              | Description                                                                     |
| ------- | ------- | ------------------ | ------------------------------------------------------------------------------- |
| su      | `su.ts` | `su <user> [pass]` | Switch user (prompts or inline auth with password); logs to `/var/log/auth.log` |

## Network

| Command    | File            | Usage                                    | Description                                                                                                                                                                                                                                             |
| ---------- | --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ifconfig   | `ifconfig.ts`   | `ifconfig [iface]`                       | Display network interface configuration                                                                                                                                                                                                                 |
| ping       | `ping.ts`       | `ping <host> [count]`                    | Send ICMP echo request to network host (async)                                                                                                                                                                                                          |
| nmap       | `nmap.ts`       | `nmap <target> [-sV] [-sU] [--tree]`     | Port scanning; -sV version detection, -sU UDP scan, --tree network topology tree (async)                                                                                                                                                                |
| nslookup   | `nslookup.ts`   | `nslookup <domain>`                      | Query DNS to resolve domain to IP address (async)                                                                                                                                                                                                       |
| dig        | `dig.ts`        | `dig <domain>` or `dig <server> axfr`    | DNS lookup or AXFR zone transfer from DNS server (async)                                                                                                                                                                                                |
| ssh        | `ssh.ts`        | `ssh <user@host> [port] [pw]`            | Connect to remote machine via SSH (async, optional inline auth); logs to target's `/var/log/auth.log`                                                                                                                                                   |
| scp        | `scp.ts`        | `scp <src> <dest> [port] [pw]`           | Copy file to remote machine (async, optional inline auth); logs to target's `/var/log/auth.log`                                                                                                                                                         |
| curl       | `curl.ts`       | `curl [flags] <url>`                     | HTTP client for GET/POST requests (async, `-i` for headers, `-X POST`); logs to target's `/var/log/access.log`                                                                                                                                          |
| ftp        | `ftp.ts`        | `ftp <host> [user] [pw]`                 | Connect to remote machine via FTP (async, optional inline auth); logs to target's `/var/log/vsftpd.log`                                                                                                                                                 |
| nc         | `nc.ts`         | `nc <host> <port>` or `nc -l <port>`     | Netcat - connect to port or open backdoor listener with -l (async/sync)                                                                                                                                                                                 |
| msfconsole | `msfconsole.ts` | `msfconsole <host> <port> [arg]`         | Exploit a vulnerable service — effect depends on CVE kind (async); see below                                                                                                                                                                            |
| hydra      | `hydra.ts`      | `hydra <host> [service] [user]`          | Brute-force SSH/FTP logins, SNMP community strings, or MySQL credentials (async). Reads `/usr/share/wordlists/passwords.txt` — wordlist is the sole gate (deterministic). For FTP, uses virtual user creds when `/etc/vsftpd/virtual_users.conf` exists |
| gobuster   | `gobuster.ts`   | `gobuster dir <url>`                     | Enumerate directories/files on web servers (async). Reads `/usr/share/wordlists/dirlist.txt` — only shows entries whose top-level path segment matches the wordlist                                                                                     |
| snmpwalk   | `snmpwalk.ts`   | `snmpwalk <host> [community]`            | Walk SNMP MIB tree; public=basic info, RW=full data with creds (async)                                                                                                                                                                                  |
| snmpset    | `snmpset.ts`    | `snmpset <host> <community> <oid=value>` | Set writable SNMP OID (firewall rules); requires RW community (async)                                                                                                                                                                                   |
| mysql      | `mysql.ts`      | `mysql <host> <user> [pw]`               | Connect to MySQL database; enters `mysql>` prompt with SQL commands (async)                                                                                                                                                                             |
| rediscli   | `rediscli.ts`   | `rediscli <host> [pw]`                   | Connect to Redis server; enters `redis>` prompt with key-value commands (async)                                                                                                                                                                         |

### msfconsole Exploit Effects

`msfconsole` dispatches on `vulnerability.effect.kind` (a `VulnerabilityEffect` discriminated union in `src/network/types.ts`) to determine what a successful exploit does. An optional 3rd argument provides effect-specific input.

| Effect Kind          | 3rd Argument               | Behavior                                                                                       |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `shell_limited`      | none                       | Drops into restricted nc-style shell at the effect's tier                                      |
| `shell_full`         | none                       | Opens a full SSH-style session as the effect's tier; returns `ExploitShellData` follow-up      |
| `file_read`          | target file path           | Reads a file on the target: `msfconsole <host> <port> /etc/passwd`                             |
| `dir_list`           | target directory path      | Lists a directory on the target: `msfconsole <host> <port> /home`                              |
| `file_write`         | `local:remote` (scp-style) | Uploads a local file to the target: `msfconsole <host> <port> /local/file:/remote/path`        |
| `password_reset`     | none                       | Mutates `/etc/passwd` on the target, prints the new password                                   |
| `backdoor_port_open` | none                       | Plants a backdoor listener on the target (writes nc PID file via `createNcPidContent` from nc) |
| `script_exec`        | attacker-local script path | Executes a script on the target: `msfconsole <host> <port> /root/payloads/pwn.js`              |

**`MsfconsoleContext`** provides optional helpers for effects that interact with remote filesystems:

- `readRemoteFile(machineId, path)` — read a file on the target machine
- `readLocalFile(path)` — read a file on the attacker's machine
- `writeRemoteFile(machineId, path, content)` — write a file on the target machine
- `listRemoteDir(machineId, path)` — list a directory on the target machine
- `runScriptOnTarget(machineId, scriptBody, tier)` — execute a script body on the target as a given tier

**`ExploitShellData`** (`src/components/Terminal/types.ts`) is the follow-up type returned by `shell_full` effects. It carries `targetIP`, `targetPort`, `service`, `username`, `userType`, `homePath`, and `tier`, triggering a full SSH-style session in the terminal.

**`VulnerabilityEffect`** (`src/network/types.ts`) is a discriminated union with 8 effect kinds: `shell_limited`, `shell_full`, `file_read`, `dir_list`, `file_write`, `password_reset`, `backdoor_port_open`, `script_exec`. Each vulnerability in the `Vulnerability` type carries an `effect` field of this type, which determines how `msfconsole` handles a successful exploit.

## WiFi

WiFi commands manage the wireless connection gate on localhost. Registered in `src/hooks/useWifiCommands.ts`.

| Command  | File          | Usage                               | Description                                           |
| -------- | ------------- | ----------------------------------- | ----------------------------------------------------- |
| airmon   | `airmon.ts`   | `airmon <start\|stop> <iface>`      | Enable/disable monitor mode on wireless interface     |
| airdump  | `airdump.ts`  | `airdump`                           | Scan and display nearby WiFi networks (async)         |
| aircrack | `aircrack.ts` | `aircrack <bssid>`                  | Crack WiFi password by BSSID (async)                  |
| nmcli    | `nmcli.ts`    | `nmcli <action> [essid] [password]` | Manage WiFi connections (connect, disconnect, status) |

## FTP Mode (`ftp/`)

Available only when connected via FTP. Registered in `src/hooks/useFtpCommands.ts`. Uses the same shell parser as normal mode with an FTP-specific command set. Tab path completion resolves against the FTP remote machine's filesystem (local-facing commands like `lcd` / `lls` / `put` share the remote filesystem for completion — full mode-specific local completion is a future refinement).

| Command | File          | Usage               | Description                        |
| ------- | ------------- | ------------------- | ---------------------------------- |
| pwd     | `ftp/pwd.ts`  | `pwd`               | Print remote working directory     |
| lpwd    | `ftp/lpwd.ts` | `lpwd`              | Print local working directory      |
| cd      | `ftp/cd.ts`   | `cd <path>`         | Change remote directory            |
| lcd     | `ftp/lcd.ts`  | `lcd <path>`        | Change local directory             |
| ls      | `ftp/ls.ts`   | `ls [path]`         | List remote directory contents     |
| lls     | `ftp/lls.ts`  | `lls [path]`        | List local directory contents      |
| get     | `ftp/get.ts`  | `get <file> [dest]` | Download file from remote to local |
| put     | `ftp/put.ts`  | `put <file> [dest]` | Upload file from local to remote   |
| quit    | `ftp/quit.ts` | `quit` / `bye`      | Close FTP connection               |

## NC Mode (`nc/`)

Available when connected to interactive services via nc. Registered in `src/hooks/useNcCommands.ts`. Uses the same shell parser as normal mode with an NC-specific command set. Tab path completion resolves against the NC target machine's filesystem. Like a real netcat shell, there is no PATH — admin binaries (sshd, vsftpd, systemctl) must be run via `bash /usr/sbin/sshd`.

| Command | File           | Usage        | Description                |
| ------- | -------------- | ------------ | -------------------------- |
| pwd     | `nc/pwd.ts`    | `pwd`        | Print working directory    |
| cd      | `nc/cd.ts`     | `cd <path>`  | Change directory           |
| ls      | `nc/ls.ts`     | `ls [path]`  | List directory contents    |
| cat     | `nc/cat.ts`    | `cat <path>` | Display file contents      |
| whoami  | `nc/whoami.ts` | `whoami`     | Display current user       |
| help    | (inline)       | `help`       | List available nc commands |
| exit    | (inline)       | `exit`       | Close connection           |
