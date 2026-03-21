# Logging

Dynamic connection logging — records SSH, FTP, SCP, su, and HTTP authentication events to target machine log files in realistic Linux formats.

## Files

| File                    | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `appendToMachineLog.ts` | Core utility — appends log lines to any machine's filesystem, creates if missing |
| `formatters.ts`         | Log line formatters (syslog, vsftpd, Apache Combined)                            |
| `utils.ts`              | Helpers — `generatePid()` (random 1000-9999), `resolveHostname()` (IP→hostname)  |

## Log Formats

| Format          | Log File              | Used By      | Example                                                                                             |
| --------------- | --------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Syslog          | `/var/log/auth.log`   | SSH, SCP, su | `Mar 21 14:30:00 webserver sshd[1234]: Accepted password for admin from 10.0.1.100 port 45000 ssh2` |
| vsftpd          | `/var/log/vsftpd.log` | FTP          | `[2026-03-21 14:30:00] OK LOGIN: Client "10.0.1.100", user "ftpuser"`                               |
| Apache Combined | `/var/log/access.log` | curl         | `10.0.1.100 - - [21/Mar/2026:14:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234`                   |

## Events Logged

| Event             | Formatter              | Target Log File       | Where Logged    |
| ----------------- | ---------------------- | --------------------- | --------------- |
| SSH login success | `formatSshAccepted`    | `/var/log/auth.log`   | Target machine  |
| SSH key auth      | `formatSshAcceptedKey` | `/var/log/auth.log`   | Target machine  |
| SSH login failure | `formatSshFailed`      | `/var/log/auth.log`   | Target machine  |
| SCP auth success  | `formatScpAccepted`    | `/var/log/auth.log`   | Target machine  |
| SCP auth failure  | `formatScpFailed`      | `/var/log/auth.log`   | Target machine  |
| su success        | `formatSuSuccess`      | `/var/log/auth.log`   | Current machine |
| su failure        | `formatSuFailed`       | `/var/log/auth.log`   | Current machine |
| FTP connect       | `formatFtpConnect`     | `/var/log/vsftpd.log` | Target machine  |
| FTP login success | `formatFtpLoginOk`     | `/var/log/vsftpd.log` | Target machine  |
| FTP login failure | `formatFtpLoginFailed` | `/var/log/vsftpd.log` | Target machine  |
| HTTP request      | `formatAccessLog`      | `/var/log/access.log` | Target machine  |

## How It Works

1. **Terminal.tsx** defines logging callbacks (`onSuAuth`, `onSshAuth`, `onFtpAuth`) that are passed to `useCommands`
2. Commands trigger callbacks on auth events (su inline, SSH/SCP/FTP via `useAuthentication`)
3. Callbacks use formatters to build log lines, then `appendToMachineLog` to write them
4. `appendToMachineLog` reads the existing log file (as root), appends the new line, and writes back
5. If the log file doesn't exist, it's created with world-readable permissions

## Persistence

Log entries are filesystem writes — they persist via the same IndexedDB patch system as all other file changes. Logs sync across tabs via BroadcastChannel (same as any filesystem patch).

## Log File Permissions

All dynamically created log files use world-readable permissions (`read: ['root', 'user', 'guest']`), matching real Linux `/var/log/` behavior. Players can read logs to investigate connection history as part of gameplay.
