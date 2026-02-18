# Commands

All terminal commands live here. Each command implements the `Command` type and is registered in `src/hooks/useCommands.ts` (general/filesystem) or `src/hooks/useNetworkCommands.ts` (network).

Commands use a factory pattern with context injection: `createXCommand(context) => Command`.

## Command Restrictions (`permissions.ts`)

Commands are tiered by user type. Restricted commands show `permission denied: 'name' requires TYPE privileges` and are hidden from `help()` and tab autocomplete. `man()` can still look up any command.

| Tier     | User Type | Available Commands                                                                                         |
| -------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| Basic    | `guest`   | help, man, echo, whoami, pwd, ls, cd, cat, su, clear, author                                               |
| Standard | `user`    | All basic + ifconfig, ping, nmap, nslookup, ssh, ftp, nc, curl, strings, output, resolve, exit, nano, node, airmon, airdump, aircrack, nmcli |
| Full     | `root`    | All standard + decrypt                                                                                     |

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

## File System

| Command | File         | Signature              | Description                                             |
| ------- | ------------ | ---------------------- | ------------------------------------------------------- |
| pwd     | `pwd.ts`     | `pwd()`                | Print current working directory                         |
| ls      | `ls.ts`      | `ls([path], [flags])`  | List directory contents (`-a` for hidden files)         |
| cd      | `cd.ts`      | `cd([path])`           | Change current directory                                |
| cat     | `cat.ts`     | `cat(path)`            | Display file contents                                   |
| whoami  | `whoami.ts`  | `whoami()`             | Display current username                                |
| decrypt | `decrypt.ts` | `decrypt(file, key)`   | Decrypt file using AES-256-GCM (async)                  |
| output  | `output.ts`  | `output(cmd, [file])`  | Capture command output to variable or file              |
| strings | `strings.ts` | `strings(file, [min])` | Extract printable strings from binary files             |
| nano    | `nano.ts`    | `nano(path)`           | Open file in nano-style text editor overlay             |
| node    | `node.ts`    | `node(path)`           | Execute a JavaScript file (requires execute permission) |

## User Management

| Command | File    | Signature  | Description                        |
| ------- | ------- | ---------- | ---------------------------------- |
| su      | `su.ts` | `su(user)` | Switch user (prompts for password) |

## Network

| Command  | File          | Signature             | Description                                                                  |
| -------- | ------------- | --------------------- | ---------------------------------------------------------------------------- |
| ifconfig | `ifconfig.ts` | `ifconfig([iface])`   | Display network interface configuration                                      |
| ping     | `ping.ts`     | `ping(host, [count])` | Send ICMP echo request to network host (async)                               |
| nmap     | `nmap.ts`     | `nmap(target)`        | Network exploration and port scanning (async)                                |
| nslookup | `nslookup.ts` | `nslookup(domain)`    | Query DNS to resolve domain to IP address (async)                            |
| ssh      | `ssh.ts`      | `ssh(user, host)`     | Connect to remote machine via SSH (async)                                    |
| curl     | `curl.ts`     | `curl(url, [flags])`  | HTTP client for GET/POST requests (async, `-i` for headers, `-X POST`)       |
| ftp      | `ftp.ts`      | `ftp(host)`           | Connect to remote machine via FTP (async)                                    |
| nc       | `nc.ts`       | `nc(host, port)`      | Netcat - connect to arbitrary port (async, interactive for special services) |

## WiFi

WiFi commands manage the wireless connection gate on localhost. Registered in `src/hooks/useWifiCommands.ts`.

| Command  | File           | Signature                            | Description                                                    |
| -------- | -------------- | ------------------------------------ | -------------------------------------------------------------- |
| airmon   | `airmon.ts`    | `airmon(action, iface)`              | Enable/disable monitor mode on wireless interface              |
| airdump  | `airdump.ts`   | `airdump()`                          | Scan and display nearby WiFi networks (async)                  |
| aircrack | `aircrack.ts`  | `aircrack(bssid)`                    | Crack WiFi password by BSSID (async)                           |
| nmcli    | `nmcli.ts`     | `nmcli(action, [essid], [password])` | Manage WiFi connections (connect, disconnect, status)          |

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
