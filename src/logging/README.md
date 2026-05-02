# Logging

Dynamic connection logging — records SSH, FTP, SCP, su, MySQL, Redis, and HTTP authentication events to target machine log files in realistic Linux formats, plus aggregate-style summaries for scan/brute-force tools (nmap, gobuster, hydra).

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

| Handler                       | Triggered by | Log file                      |
| ----------------------------- | ------------ | ----------------------------- |
| `createExploitAttemptHandler` | msfconsole   | per attack pattern            |
| `createNcConnectHandler`      | nc connect   | `/var/log/syslog`             |
| `createHttpRequestHandler`    | curl         | `/var/log/access.log`         |
| `createSshAuthHandler`        | ssh, scp     | `/var/log/auth.log`           |
| `createFtpAuthHandler`        | ftp          | `/var/log/vsftpd.log`         |
| `createMysqlAuthHandler`      | mysql        | `/var/log/mysql.log`          |
| `createRedisConnectHandler`   | rediscli     | `/var/log/redis.log`          |
| `createRedisAuthHandler`      | rediscli     | `/var/log/redis.log`          |
| `createHydraLogHandler`       | hydra        | per-service (see table below) |

### Scan & brute-force aggregates

Scan and brute-force commands (`nmap`, `gobuster`, `hydra`) do not log one
entry per probe — that would bury the target's log file under a wall of noise
during wordlist/port sweeps. Instead, each sweep fires a single aggregate
callback when it completes, and a handler writes one distinctive summary line
per sweep. This mirrors how real defensive tooling (netfilter LOG,
mod_security, fail2ban) records enumeration bursts.

`hydra` additionally writes one normal auth-success line per cracked
credential (reusing the _same_ formatters as legitimate logins —
`formatSshAccepted`, `formatFtpLoginOk`, `formatMysqlConnect`,
`formatRedisAuth`, or `formatSnmpCommunityDiscovered`). Defenders must
correlate the aggregate with the success line to trace a breach.

| Callback              | Triggered by | Log file              | Format                                                                                  |
| --------------------- | ------------ | --------------------- | --------------------------------------------------------------------------------------- |
| nmap aggregate        | nmap         | `/var/log/kern.log`   | iptables-style: `kernel: [iptables] Port scan from ... probed ports ...`                |
| gobuster aggregate    | gobuster     | `/var/log/access.log` | mod_security-style: `[mod_security] [client ...] Directory enumeration ...`             |
| hydra ssh aggregate   | hydra ssh    | `/var/log/auth.log`   | syslog `sshd[pid]: Brute-force attempt from ... N failures, K accepted`                 |
| hydra ftp aggregate   | hydra ftp    | `/var/log/vsftpd.log` | vsftpd-style `BRUTE FORCE: Client "..." — N login attempts, K successful`               |
| hydra mysql aggregate | hydra mysql  | `/var/log/mysql.log`  | MySQL general-log `Connect: Brute-force attempt from '...' — N attempts, K accepted`    |
| hydra redis aggregate | hydra redis  | `/var/log/redis.log`  | Redis warning `# Client ... brute-force attempt — N password attempts, K authenticated` |
| hydra snmp aggregate  | hydra snmp   | `/var/log/syslog`     | syslog `snmpd[pid]: Brute-force community string attempt from ... N probed, K found`    |

The scan-aggregate inline handlers (nmap, gobuster) live in
`useNetworkCommands.ts`; the hydra handler is the factory
`createHydraLogHandler` in `handlers/hydraLog.ts` (5-service branching made
factory extraction preferable to inlining).

### NAT-aware log destination

Each handler resolves NAT (`resolveNat(targetIp, port)`) before writing.
When a public port is forwarded through a router to a backend (e.g.,
`router:2222 → backend:22`), the log lands on the backend where the
daemon actually runs — matching real Linux logging. Router-native
services are unaffected (their ports don't appear in the router's
DNAT rules, so `resolveNat` is a no-op).

## Log Formats

| Format          | Log File              | Used By      | Example                                                                                                                                           |
| --------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Syslog          | `/var/log/auth.log`   | SSH, SCP, su | `Mar 21 14:30:00 webserver sshd[1234]: Accepted password for admin from 10.0.1.100 port 45000 ssh2`                                               |
| vsftpd          | `/var/log/vsftpd.log` | FTP          | `[2026-03-21 14:30:00] OK LOGIN: Client "10.0.1.100", user "ftpuser"`                                                                             |
| MySQL general   | `/var/log/mysql.log`  | MySQL        | `2026-03-21T14:30:00.000000Z\t42 Connect\tadmin@10.0.1.100 on webapp_db using TCP/IP`                                                             |
| Redis           | `/var/log/redis.log`  | Redis        | `1234:M 21 Mar 2026 14:30:00.000 * Client connected from 10.0.1.100`                                                                              |
| Apache Combined | `/var/log/access.log` | curl         | `10.0.1.100 - - [21/Mar/2026:14:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234`                                                                 |
| iptables LOG    | `/var/log/kern.log`   | nmap         | `Mar 21 14:30:00 webserver kernel: [iptables] Port scan from 10.0.1.100 — probed ports 22,80 (2 hits)`                                            |
| mod_security    | `/var/log/access.log` | gobuster     | `[21/Mar/2026:14:30:00 +0000] [mod_security] [client 10.0.1.100] Directory enumeration detected on port 80 — 50 paths probed, 12 hits (gobuster)` |

## Events Logged

| Event                     | Formatter                       | Target Log File       | Where Logged    |
| ------------------------- | ------------------------------- | --------------------- | --------------- |
| SSH login success         | `formatSshAccepted`             | `/var/log/auth.log`   | Target machine  |
| SSH key auth              | `formatSshAcceptedKey`          | `/var/log/auth.log`   | Target machine  |
| SSH login failure         | `formatSshFailed`               | `/var/log/auth.log`   | Target machine  |
| SCP auth success          | `formatScpAccepted`             | `/var/log/auth.log`   | Target machine  |
| SCP auth failure          | `formatScpFailed`               | `/var/log/auth.log`   | Target machine  |
| su success                | `formatSuSuccess`               | `/var/log/auth.log`   | Current machine |
| su failure                | `formatSuFailed`                | `/var/log/auth.log`   | Current machine |
| FTP connect               | `formatFtpConnect`              | `/var/log/vsftpd.log` | Target machine  |
| FTP login success         | `formatFtpLoginOk`              | `/var/log/vsftpd.log` | Target machine  |
| FTP login failure         | `formatFtpLoginFailed`          | `/var/log/vsftpd.log` | Target machine  |
| MySQL connect             | `formatMysqlConnect`            | `/var/log/mysql.log`  | Target machine  |
| MySQL auth fail           | `formatMysqlAccessDenied`       | `/var/log/mysql.log`  | Target machine  |
| Redis connect             | `formatRedisConnect`            | `/var/log/redis.log`  | Target machine  |
| Redis auth success        | `formatRedisAuth`               | `/var/log/redis.log`  | Target machine  |
| Redis auth fail           | `formatRedisAuthDenied`         | `/var/log/redis.log`  | Target machine  |
| HTTP request              | `formatAccessLog`               | `/var/log/access.log` | Target machine  |
| nmap scan (aggregate)     | `formatNmapScanAggregate`       | `/var/log/kern.log`   | Target machine  |
| gobuster scan (aggregate) | `formatGobusterScanAggregate`   | `/var/log/access.log` | Target machine  |
| hydra ssh brute-force     | `formatHydraBruteForceSsh`      | `/var/log/auth.log`   | Target machine  |
| hydra ftp brute-force     | `formatHydraBruteForceFtp`      | `/var/log/vsftpd.log` | Target machine  |
| hydra mysql brute-force   | `formatHydraBruteForceMysql`    | `/var/log/mysql.log`  | Target machine  |
| hydra redis brute-force   | `formatHydraBruteForceRedis`    | `/var/log/redis.log`  | Target machine  |
| hydra snmp brute-force    | `formatHydraBruteForceSnmp`     | `/var/log/syslog`     | Target machine  |
| hydra snmp discovered     | `formatSnmpCommunityDiscovered` | `/var/log/syslog`     | Target machine  |

## Source IP Resolution

`resolveLogSourceIP()` determines the correct source IP for log entries:

- **From a remote machine** (SSH session) — uses the remote machine's IP directly (already in `sessionMachine`).
- **From the player's own workstation** — always the home router's public IP (e.g., `203.45.67.89`). A single public-IP identity makes player tracking consistent across every log file in the world. Same-/24 LAN IPs are deliberately not used here: LAN ranges aren't unique across players, so the public IP is the only stable identifier.
- **Fallback** (own workstation, no home network connected) — uses the LAN IP since there's no public IP available.

The "own workstation" check is `sessionMachine === ownWorkstationId`, where `ownWorkstationId` is the player's identity-derived hostname (e.g., `skylab-aabbccdd`). Pre-PR-#94 this was the literal string `'localhost'`; the explicit comparison parameter prevents that bug from regressing.

`NetworkContext.getPublicIP()` provides the home router's public IP.

## How It Works

1. **Terminal.tsx** and **useNetworkCommands.ts** instantiate the handler factories from `handlers/` with their dependencies
2. Commands trigger the handlers on auth / exploit / connect / HTTP events
3. Each handler resolves NAT and source IP, builds a formatted log line, and calls `appendToMachineLog`
4. `appendToMachineLog` reads the existing log file (as root), appends the new line(s), and writes back
5. If the log file doesn't exist, it's created with world-readable permissions

`appendToMachineLog` accepts either a single string or `readonly string[]`. **Use the array form whenever a handler needs to emit more than one line in the same React tick** (e.g. `hydraLog.ts` emits an aggregate brute-force line plus per-success login lines). All lines are joined with `\n` and committed as a single read-modify-write so the underlying filesystem patch upserts atomically. Two separate `appendToMachineLog` calls in one tick race: both see the same pre-batch state and the second write clobbers the first via the `(player_key, machine_id, path)` upsert key.

## Persistence

Log entries are filesystem writes — they persist via the same IndexedDB patch system as all other file changes. Logs sync across tabs via BroadcastChannel (same as any filesystem patch).

## Log File Permissions

All dynamically created log files use world-readable permissions (`read: ['root', 'user', 'guest']`), matching real Linux `/var/log/` behavior. Players can read logs to investigate connection history as part of gameplay.
