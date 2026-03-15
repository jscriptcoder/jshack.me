# Commands

All terminal commands live here. Each command implements the `Command` type and is registered in `src/hooks/useCommands.ts` (general/filesystem) or `src/hooks/useNetworkCommands.ts` (network).

Commands use a factory pattern with context injection: `createXCommand(context) => Command`.

## Access Control (`availability.ts`)

Commands use a unified filesystem-based access model. All commands are visible to all users — execution is gated by binary file permissions.

- **Shell builtins** (cd, exit, clear, echo, pwd, help, whoami) — always available, no binary needed
- **Game commands** (missions, accept, abort, mail, output, resolve, author, theme, reset, xterm) — always available
- **System utilities** in `/bin/` — always present on all machines; most are world-executable
- **Apt-installable tools** in `/usr/bin/` — must be installed via `apt('install', '<tool>')` as root; pre-installed on localhost only
- **Restricted binaries** — `reboot` and `gpg` have `execute: ['root']`; all others are world-executable

At execution time, `wrapWithAccessCheck` checks binary existence and execute permissions:

- Binary missing → `"bash: name: command not found"` (with apt install hint for apt-installable tools)
- Binary exists but no execute permission → `"bash: name: Permission denied"`

| Category         | Location    | Availability                                                        |
| ---------------- | ----------- | ------------------------------------------------------------------- |
| Shell builtins   | N/A         | Always (cd, exit, clear, echo, pwd, help, whoami)                   |
| System utilities | `/bin/`     | Always (ls, cat, rm, chmod, scp, su, man, nano, strings, ssh, etc.) |
| Apt-installable  | `/usr/bin/` | After `apt install` (pre-installed on localhost only)               |
| Game-specific    | N/A         | Always (missions, accept, abort, mail, output, etc.)                |

FTP and NC modes have their own separate command sets and are not restricted.

## General

| Command | File         | Signature            | Description                                                |
| ------- | ------------ | -------------------- | ---------------------------------------------------------- |
| help    | `help.ts`    | `help()`             | List all available commands                                |
| man     | `man.ts`     | `man(cmd)`           | Display detailed manual for a command                      |
| echo    | `echo.ts`    | `echo(value)`        | Output a stringified value                                 |
| author  | `author.ts`  | `author()`           | Display author profile card                                |
| clear   | `clear.ts`   | `clear()`            | Clear the terminal screen                                  |
| exit    | `exit.ts`    | `exit()`             | Close SSH/nc connection and return to previous machine     |
| resolve | `resolve.ts` | `resolve(promise)`   | Unwrap a Promise and display its resolved value            |
| reset   | `reset.ts`   | `reset(["confirm"])` | Reset game to factory defaults (clears all saved progress) |
| theme   | `theme.ts`   | `theme([name])`      | List or switch terminal color themes (persists)            |
| apt     | `apt.ts`     | `apt(sub, [pkg])`    | Package manager — install tools on remote machines         |
| xterm   | `xterm.ts`   | `xterm()`            | Open a new terminal session in a separate browser tab      |

## Mission

| Command  | File          | Signature                  | Description                                               |
| -------- | ------------- | -------------------------- | --------------------------------------------------------- |
| missions | `missions.ts` | `missions()`               | Browse available hacker-for-hire contracts on the darknet |
| accept   | `accept.ts`   | `accept(seed)`             | Accept a mission contract and generate the target network |
| abort    | `abort.ts`    | `abort()`                  | Abort the current mission and return to localhost         |
| mail     | `mail.ts`     | `mail(recipient, content)` | Send proof to a darknet client to complete a mission      |

## File System

| Command | File         | Signature                | Description                                                     |
| ------- | ------------ | ------------------------ | --------------------------------------------------------------- |
| pwd     | `pwd.ts`     | `pwd()`                  | Print current working directory                                 |
| ls      | `ls.ts`      | `ls([path], [flags])`    | List directory contents (`-a` hidden, `-l` long format)         |
| cd      | `cd.ts`      | `cd([path])`             | Change current directory                                        |
| cat     | `cat.ts`     | `cat(path)`              | Display file contents                                           |
| rm      | `rm.ts`      | `rm([flags], path, ...)` | Remove files or directories (-r recursive, -f force)            |
| whoami  | `whoami.ts`  | `whoami()`               | Display current username                                        |
| gpg     | `gpg.ts`     | `gpg(file, key)`         | Decrypt file using AES-256 (async, root-only)                   |
| output  | `output.ts`  | `output(cmd, [file])`    | Capture command output to variable or file                      |
| strings | `strings.ts` | `strings(file, [min])`   | Extract printable strings from binary files                     |
| nano    | `nano.ts`    | `nano(path)`             | Open file in nano-style text editor overlay                     |
| node    | `node.ts`    | `node(path)`             | Execute a JavaScript file — supports `await` for async commands |
| john    | `john.ts`    | `john(file)`             | Crack password hashes using dictionary attack (async)           |
| chmod   | `chmod.ts`   | `chmod(mode, path)`      | Change file permissions (symbolic: `o+x`, `u-w`, etc.)          |
| reboot  | `reboot.ts`  | `reboot()`               | Reboot current machine; bricks if boot files missing            |

## User Management

| Command | File    | Signature  | Description                        |
| ------- | ------- | ---------- | ---------------------------------- |
| su      | `su.ts` | `su(user)` | Switch user (prompts for password) |

## Network

| Command  | File          | Signature                        | Description                                                                   |
| -------- | ------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| ifconfig | `ifconfig.ts` | `ifconfig([iface])`              | Display network interface configuration                                       |
| ping     | `ping.ts`     | `ping(host, [count])`            | Send ICMP echo request to network host (async)                                |
| nmap     | `nmap.ts`     | `nmap(target[, "-sV"][, "-sU"])` | Port scanning; -sV version detection, -sU UDP scan (async)                    |
| nslookup | `nslookup.ts` | `nslookup(domain)`               | Query DNS to resolve domain to IP address (async)                             |
| ssh      | `ssh.ts`      | `ssh("user@host"[, port])`       | Connect to remote machine via SSH, optional port (async)                      |
| scp      | `scp.ts`      | `scp(source, dest[, port])`      | Copy file to remote machine preserving permissions, optional SSH port         |
| curl     | `curl.ts`     | `curl(url, [flags])`             | HTTP client for GET/POST requests (async, `-i` for headers, `-X POST`)        |
| ftp      | `ftp.ts`      | `ftp(host)`                      | Connect to remote machine via FTP (async)                                     |
| nc       | `nc.ts`       | `nc(host, port)`                 | Netcat - connect to arbitrary port (async, interactive for special services)  |
| exploit  | `exploit.ts`  | `exploit(host, port)`            | Exploit a vulnerable service for RCE (async, drops into restricted shell)     |
| hydra    | `hydra.ts`    | `hydra(host[, svc[, user]])`     | Brute-force SSH/FTP login credentials (async, probability-based)              |
| gobuster | `gobuster.ts` | `gobuster("dir", url)`           | Enumerate directories/files on web servers (async, walks /var/www/html/ tree) |
| snmpwalk | `snmpwalk.ts` | `snmpwalk(host[, community])`    | Walk SNMP MIB tree; public=basic info, RW=full data with creds (async)        |
| snmpset  | `snmpset.ts`  | `snmpset(host, comm, "k=v")`     | Set writable SNMP OID (firewall rules); requires RW community (async)         |

## WiFi

WiFi commands manage the wireless connection gate on localhost. Registered in `src/hooks/useWifiCommands.ts`.

| Command  | File          | Signature                            | Description                                           |
| -------- | ------------- | ------------------------------------ | ----------------------------------------------------- |
| airmon   | `airmon.ts`   | `airmon(action, iface)`              | Enable/disable monitor mode on wireless interface     |
| airdump  | `airdump.ts`  | `airdump()`                          | Scan and display nearby WiFi networks (async)         |
| aircrack | `aircrack.ts` | `aircrack(bssid)`                    | Crack WiFi password by BSSID (async)                  |
| nmcli    | `nmcli.ts`    | `nmcli(action, [essid], [password])` | Manage WiFi connections (connect, disconnect, status) |

## FTP Mode (`ftp/`)

Available only when connected via FTP. Registered in `src/hooks/useFtpCommands.ts`.

| Command | File          | Signature           | Description                        |
| ------- | ------------- | ------------------- | ---------------------------------- |
| pwd     | `ftp/pwd.ts`  | `pwd()`             | Print remote working directory     |
| lpwd    | `ftp/lpwd.ts` | `lpwd()`            | Print local working directory      |
| cd      | `ftp/cd.ts`   | `cd(path)`          | Change remote directory            |
| lcd     | `ftp/lcd.ts`  | `lcd(path)`         | Change local directory             |
| ls      | `ftp/ls.ts`   | `ls([path])`        | List remote directory contents     |
| lls     | `ftp/lls.ts`  | `lls([path])`       | List local directory contents      |
| get     | `ftp/get.ts`  | `get(file, [dest])` | Download file from remote to local |
| put     | `ftp/put.ts`  | `put(file, [dest])` | Upload file from local to remote   |
| quit    | `ftp/quit.ts` | `quit()` / `bye()`  | Close FTP connection               |

## NC Mode (`nc/`)

Available when connected to interactive services via nc. Registered in `src/hooks/useNcCommands.ts`.

| Command | File           | Signature    | Description                |
| ------- | -------------- | ------------ | -------------------------- |
| pwd     | `nc/pwd.ts`    | `pwd()`      | Print working directory    |
| cd      | `nc/cd.ts`     | `cd(path)`   | Change directory           |
| ls      | `nc/ls.ts`     | `ls([path])` | List directory contents    |
| cat     | `nc/cat.ts`    | `cat(path)`  | Display file contents      |
| whoami  | `nc/whoami.ts` | `whoami()`   | Display current user       |
| help    | (inline)       | `help()`     | List available nc commands |
| exit    | (inline)       | `exit()`     | Close connection           |
