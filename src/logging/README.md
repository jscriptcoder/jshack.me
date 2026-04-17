# Logging

Dynamic connection logging — records SSH, FTP, SCP, su, MySQL, Redis, and HTTP authentication events to target machine log files in realistic Linux formats.

## Files

| File                    | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `appendToMachineLog.ts` | Core utility — appends log lines to any machine's filesystem, creates if missing |
| `formatters.ts`         | Log line formatters (syslog, vsftpd, Apache Combined)                            |
| `utils.ts`              | Helpers — `generatePid()`, `resolveHostname()`, `resolveLogSourceIP()`           |
| `exploitAttempt.ts`     | Dispatch exploit-attempt log lines to the right log file per attack pattern      |
| `handlers/`             | Per-event handler factories (see below)                                          |

## Handlers

The `handlers/` subdirectory holds one factory per log event. Each factory
takes its dependencies (session machine, NAT resolver, log filesystem, etc.)
and returns a handler the UI layer wires into commands.

| Handler                       | Triggered by   | Log file              |
| ----------------------------- | -------------- | --------------------- |
| `createExploitAttemptHandler` | msfconsole     | per attack pattern    |
| `createNcConnectHandler`      | nc connect     | `/var/log/syslog`     |
| `createHttpRequestHandler`    | curl, gobuster | `/var/log/access.log` |
| `createSshAuthHandler`        | ssh, scp       | `/var/log/auth.log`   |
| `createFtpAuthHandler`        | ftp            | `/var/log/vsftpd.log` |
| `createMysqlAuthHandler`      | mysql          | `/var/log/mysql.log`  |

### NAT-aware log destination

Each handler resolves NAT (`resolveNat(targetIp, port)`) before writing.
When a public port is forwarded through a router to a backend (e.g.,
`router:2222 → backend:22`), the log lands on the backend where the
daemon actually runs — matching real Linux logging. Router-native
services are unaffected (their ports don't appear in the router's
DNAT rules, so `resolveNat` is a no-op).

## Log Formats

| Format          | Log File              | Used By      | Example                                                                                             |
| --------------- | --------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Syslog          | `/var/log/auth.log`   | SSH, SCP, su | `Mar 21 14:30:00 webserver sshd[1234]: Accepted password for admin from 10.0.1.100 port 45000 ssh2` |
| vsftpd          | `/var/log/vsftpd.log` | FTP          | `[2026-03-21 14:30:00] OK LOGIN: Client "10.0.1.100", user "ftpuser"`                               |
| MySQL general   | `/var/log/mysql.log`  | MySQL        | `2026-03-21T14:30:00.000000Z\t42 Connect\tadmin@10.0.1.100 on webapp_db using TCP/IP`               |
| Redis           | `/var/log/redis.log`  | Redis        | `1234:M 21 Mar 2026 14:30:00.000 * Client connected from 10.0.1.100`                                |
| Apache Combined | `/var/log/access.log` | curl         | `10.0.1.100 - - [21/Mar/2026:14:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234`                   |

## Events Logged

| Event             | Formatter                 | Target Log File       | Where Logged    |
| ----------------- | ------------------------- | --------------------- | --------------- |
| SSH login success | `formatSshAccepted`       | `/var/log/auth.log`   | Target machine  |
| SSH key auth      | `formatSshAcceptedKey`    | `/var/log/auth.log`   | Target machine  |
| SSH login failure | `formatSshFailed`         | `/var/log/auth.log`   | Target machine  |
| SCP auth success  | `formatScpAccepted`       | `/var/log/auth.log`   | Target machine  |
| SCP auth failure  | `formatScpFailed`         | `/var/log/auth.log`   | Target machine  |
| su success        | `formatSuSuccess`         | `/var/log/auth.log`   | Current machine |
| su failure        | `formatSuFailed`          | `/var/log/auth.log`   | Current machine |
| FTP connect       | `formatFtpConnect`        | `/var/log/vsftpd.log` | Target machine  |
| FTP login success | `formatFtpLoginOk`        | `/var/log/vsftpd.log` | Target machine  |
| FTP login failure | `formatFtpLoginFailed`    | `/var/log/vsftpd.log` | Target machine  |
| MySQL connect     | `formatMysqlConnect`      | `/var/log/mysql.log`  | Target machine  |
| MySQL auth fail   | `formatMysqlAccessDenied` | `/var/log/mysql.log`  | Target machine  |
| Redis connect     | `formatRedisConnect`      | `/var/log/redis.log`  | Target machine  |
| Redis auth fail   | `formatRedisAuthFailed`   | `/var/log/redis.log`  | Target machine  |
| HTTP request      | `formatAccessLog`         | `/var/log/access.log` | Target machine  |

## Source IP Resolution

`resolveLogSourceIP()` determines the correct source IP for log entries:

- **From a remote machine** (not localhost) — uses the machine's IP directly (already correct)
- **From localhost → same /24 subnet** (home network machine) — uses the LAN IP (e.g., `10.45.12.100`)
- **From localhost → different network** (mission machine) — uses the home router's public IP (e.g., `203.45.67.89`), since traffic is NAT'd through the gateway
- **Fallback** (no home network) — uses the LAN IP

`NetworkContext.getPublicIP()` provides the home router's public IP for cross-network resolution.

## How It Works

1. **Terminal.tsx** and **useNetworkCommands.ts** instantiate the handler factories from `handlers/` with their dependencies
2. Commands trigger the handlers on auth / exploit / connect / HTTP events
3. Each handler resolves NAT and source IP, builds a formatted log line, and calls `appendToMachineLog`
4. `appendToMachineLog` reads the existing log file (as root), appends the new line, and writes back
5. If the log file doesn't exist, it's created with world-readable permissions

## Persistence

Log entries are filesystem writes — they persist via the same IndexedDB patch system as all other file changes. Logs sync across tabs via BroadcastChannel (same as any filesystem patch).

## Log File Permissions

All dynamically created log files use world-readable permissions (`read: ['root', 'user', 'guest']`), matching real Linux `/var/log/` behavior. Players can read logs to investigate connection history as part of gameplay.
