# Plan: Phase 2 — Unified Access Logging

**Branch**: `plan/phase-2-unified-access-logging` (plan doc)
**Implementation branches**: feature branches off `multiplayer`, one per step
**Base branch for all PRs in this phase**: `multiplayer` (NOT `main`)
**Status**: Active

## Context

This is Phase 2 of the multiplayer-prep defense rework. Phase 1 (`findVulnForService` infrastructure) is complete and merged. Phase 2 establishes the logging substrate that every subsequent feature layers on top of:

- **Tracing gameplay** needs logs to exist and to capture source IPs honestly.
- **Shred mechanics** (Phase 3) need multiple realistic log files to shred, so players can fail to cover their tracks.
- **Typed vulnerability effects** (Phase 4) need a log schema flexible enough to capture file reads, directory listings, password mutations, and whatever else Phase 4 invents.
- **Multiplayer rollout** (Phase 5+) needs logs as the primary trace evidence across player boundaries.

The user has confirmed missions are allowed to break during this phase (same policy as Phase 1). No backward compatibility is required.

## Goal

Every success-or-failure access event against a machine — session-based, credential-based, exploit-based, or reconnaissance — writes a realistic log entry to the appropriate log file on the **target** machine, using the correct format for that log file. The existing hop-through source IP mechanic is retained and extended to every new log write. Log files on freshly generated machines are pre-seeded with modest synthetic history so they feel lived-in rather than empty.

## Non-goals

The following are explicitly out of scope for Phase 2 and deferred to later phases:

- **`nc_prompt → exploit_session` rename** (originally Phase 2) — dropped entirely. In Phase 4, exploits produce multiple outcome types (sessions, file dumps, password changes), so a single "exploit_session" concept doesn't fit.
- **Hydra per-attempt logging** — hydra works with probabilities rather than per-password attempts, so there's no natural place to surface individual logs. Parked until hydra's execution model changes or Phase 4 revisits it.
- **Log rotation, retention limits, and `shred`** — Phase 3 alongside the rest of the defense treadmill.
- **Typed vulnerability effects** (file reads, dir listings, password mutations) — Phase 4. The log schema designed here must be forward-compatible with those effect types, but no Phase 4 effect is implemented in Phase 2.
- **SMTP / IMAP / POP3 interactive logging** — no commands interact with these ports yet (the `mail()` command is a darknet contract delivery mechanism, not an SMTP client). Parked until those commands exist.
- **`/var/log/audit/audit.log` (auditd) syscall-level logging** — Phase 4 territory alongside typed effects.
- **Cross-machine log correlation / `trace` or `forensic` command** — players use raw `cat`/`find`/`grep` through the early phases. Convenience commands can come later if needed.

## What already exists (`src/logging/`)

A surprising amount of infrastructure was already built before this phase:

- **`appendToMachineLog`** — writes log lines to any machine's filesystem as root, creates the file with world-readable permissions if missing, persists via the existing IndexedDB patch system.
- **Realistic per-format formatters** in `formatters.ts`:
  - `formatSyslogLine` — `MMM DD HH:MM:SS hostname service[pid]: message`
  - `formatSshAccepted` / `formatSshAcceptedKey` / `formatSshFailed`
  - `formatScpAccepted` / `formatScpFailed` (alias of SSH formatters)
  - `formatSuSuccess` / `formatSuFailed`
  - `formatFtpConnect` / `formatFtpLoginOk` / `formatFtpLoginFailed`
  - `formatMysqlConnect` / `formatMysqlAccessDenied`
  - `formatRedisAuth` / `formatRedisAuthDenied`
  - `formatAccessLog` (Apache Combined format)
- **`resolveLogSourceIP`** — determines the correct source IP for log entries based on session context. **The hop-through tracing mechanic is already fully implemented here**:
  - From a remote machine (player is SSHed into A and acts on B): logs on B show A's IP
  - From localhost to same /24: logs show LAN IP
  - From localhost to a different network: logs show the home router's public IP (NAT'd)
  - This is the substrate that enables "hop through intermediaries before attacking to cover your tracks"
- **Events already logged dynamically** (the current state on `multiplayer`):
  - SSH login success / failure / key auth → `/var/log/auth.log`
  - SCP auth success / failure → `/var/log/auth.log`
  - su success / failure → `/var/log/auth.log`
  - FTP connect / login success / login failure → `/var/log/vsftpd.log`
  - MySQL connect / auth denied → `/var/log/mysql.log`
  - Redis auth success / failure → `/var/log/redis.log`
  - HTTP request (curl, gobuster) → `/var/log/access.log`

## What's missing for Phase 2

**Four gaps** — all fit the existing architecture cleanly:

1. **`msfconsole` exploit events** (success AND failure) — nothing logs today. Destination: the exploited service's log, rendered as a **realistic attack pattern** for that log file. A CVE-2021-41773 exploit against port 80 (Apache) should look like a suspicious HTTP request in `access.log` (e.g., `GET /?file=../../etc/passwd HTTP/1.1`). A CVE against vsftpd should look like unusual FTP commands in `vsftpd.log`. Each CVE in the pool needs an attack-pattern template keyed off the exploit.
2. **`nc` backdoor connection events** (success AND failure) — nothing logs today. Destination: `/var/log/syslog` with a generic service tag (e.g., `inetd` / `xinetd`), since backdoor ports aren't owned by any real daemon. Both successful connections and connection-refused events are logged (matching the existing ssh/ftp fail-logging policy).
3. **`nmap` scan events** — nothing logs today. Destination: `/var/log/kern.log` with a fake iptables `LOG` target format. **Aggregated**: one entry per scanned IP listing the ports that were probed (not per-port, not per-open-port). Matches how real `iptables LOG` + `netfilter` capture scans in `kern.log`.
4. **Log file seeding rework** — today, **every machine's synthetic seed content all lands in `/var/log/auth.log`**, including SSH lines, kernel lines, systemd lines, postfix lines, UFW block lines, etc. That's unrealistic: real Linux machines split these across `auth.log`, `syslog`, `kern.log`, `mail.log`, etc. Phase 2 splits the seed templates into per-log-file buckets and adds per-role log files so a freshly generated machine has a modest, realistic log layout.

## Log file taxonomy

The authoritative mapping of events → destination files → formats for this phase:

| Event                             | Destination log file                                                            | Format                               | Status     |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ | ---------- |
| SSH login success / fail          | `/var/log/auth.log`                                                             | syslog (sshd[pid])                   | ✅ exists  |
| SCP auth success / fail           | `/var/log/auth.log`                                                             | syslog (sshd[pid])                   | ✅ exists  |
| su success / fail                 | `/var/log/auth.log`                                                             | syslog (su[pid])                     | ✅ exists  |
| FTP connect / login / login-fail  | `/var/log/vsftpd.log`                                                           | vsftpd format                        | ✅ exists  |
| MySQL connect / auth denied       | `/var/log/mysql.log`                                                            | MySQL general log                    | ✅ exists  |
| Redis auth success / fail         | `/var/log/redis.log`                                                            | Redis format                         | ✅ exists  |
| HTTP request (curl, gobuster)     | `/var/log/access.log`                                                           | Apache Combined                      | ✅ exists  |
| **`msfconsole` exploit success**  | The exploited service's log (`access.log` for HTTP, `vsftpd.log` for FTP, etc.) | Realistic attack pattern per service | 🆕 Phase 2 |
| **`msfconsole` exploit failure**  | Same as above                                                                   | Same                                 | 🆕 Phase 2 |
| **`nc` backdoor connect success** | `/var/log/syslog`                                                               | syslog (xinetd or inetd)             | 🆕 Phase 2 |
| **`nc` backdoor connect fail**    | `/var/log/syslog`                                                               | syslog (xinetd)                      | 🆕 Phase 2 |
| **`nmap` aggregated scan**        | `/var/log/kern.log`                                                             | iptables `LOG` kernel format         | 🆕 Phase 2 |

Log files that get **pre-seeded** on a freshly generated machine (role-dependent):

| Log file              | Seeded on                             | Content source                                                                                                                                          |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/var/log/auth.log`   | all machines                          | SSH/sudo/su/login template lines only                                                                                                                   |
| `/var/log/syslog`     | all machines                          | systemd/dhclient/cron/generic template lines                                                                                                            |
| `/var/log/kern.log`   | all machines (but especially routers) | kernel/UFW/iptables template lines. Routers' existing `firewall.log` is either renamed to `kern.log` or kept as-is alongside — decision in plan step 4. |
| `/var/log/access.log` | webserver role only                   | Apache Combined lines with realistic paths                                                                                                              |
| `/var/log/vsftpd.log` | fileserver role only                  | vsftpd connect/login template lines                                                                                                                     |
| `/var/log/mysql.log`  | database role (if MySQL is running)   | MySQL connect template lines                                                                                                                            |
| `/var/log/redis.log`  | database role (if Redis is running)   | Redis connect template lines                                                                                                                            |

Roles with no matching service log (workstation, dns, mailserver, iot, switch) only get `auth.log`, `syslog`, and `kern.log`.

## Acceptance Criteria

Behaviour-driven; observable from the terminal and from filesystem reads:

- [ ] After a successful `msfconsole` exploit against a vulnerable HTTP port, `/var/log/access.log` on the target machine contains a realistic-looking attack-pattern HTTP request line with the attacker's correctly-resolved source IP.
- [ ] After a failed `msfconsole` exploit attempt (wrong port, wrong version, closed port), the target's service log still records the attempt. (Whether failures look exactly like successes or slightly different — see risks — is decided during implementation of PR 2.)
- [ ] After a successful `nc` connection to a backdoor port, `/var/log/syslog` on the target contains a syslog entry naming the source IP and the destination port.
- [ ] After a failed `nc` connection (closed port), `/var/log/syslog` on the target contains a syslog entry with a "connection refused" or equivalent marker.
- [ ] After an `nmap` scan against a target, `/var/log/kern.log` on the target contains **exactly one** aggregated iptables-format line listing the ports that were probed.
- [ ] The source IP in every new log entry is produced by `resolveLogSourceIP` and respects the hop-through mechanic: actions from a remote SSH session land with the remote machine's IP, not the originating player's home IP.
- [ ] A freshly generated home network machine has the pre-seeded log files listed above, each with a modest amount (5–15 lines) of realistic content in the correct format for that file. `auth.log` contains only auth-related lines; `kern.log` contains only kernel-related lines; etc.
- [ ] `npm run build`, `npm run lint`, `npm run format:check`, and `npm run test:run` all pass.
- [ ] Mission test failures (if any) are documented in each PR description, not fixed — deferred to mission rework.

## Steps

Every step follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. Each step ends in a committable state; the branch is green after every step.

### Step 1: Log file seeding rework — split templates by destination

**RED**: Update `src/generation/filesystem/machineConfig.test.ts` (or equivalent) with behaviour tests:

- A freshly generated webserver machine has `/var/log/auth.log`, `/var/log/syslog`, `/var/log/kern.log`, and `/var/log/access.log`, each with non-empty content.
- `/var/log/auth.log` on any machine contains only lines matching the sshd/sudo/su/login pattern (no kernel, no postfix, no systemd service lines).
- `/var/log/kern.log` on any machine contains only lines matching the kernel/UFW/iptables pattern.
- A database-role machine with MySQL running has `/var/log/mysql.log` seeded; a webserver has `/var/log/access.log` seeded; a fileserver has `/var/log/vsftpd.log` seeded. Workstation-role machines do NOT have these role-specific files.

**GREEN**:

- In `src/generation/pools/filesystem.ts`, split `logTemplates` into `authLogTemplates`, `syslogTemplates`, `kernLogTemplates`, `accessLogTemplates`, `vsftpdLogTemplates`, `mysqlLogTemplates`, `redisLogTemplates`. Each array contains only lines appropriate for its destination format.
- In `machineConfig.ts`, extend `generateLogContent` (or refactor to `generateLogsByFile`) to return a `Record<string, string>` — one entry per log file that this machine should get, keyed by the filename (e.g., `auth.log`, `syslog`, `kern.log`, `access.log`, …).
- In the machine-config pipeline, add all returned log files into `/var/log/` with `guest` ownership and world-readable permissions (same as today).
- Role-based inclusion: webserver gets `access.log`, fileserver gets `vsftpd.log`, database gets `mysql.log`/`redis.log` conditional on which DB services are actually running. Router keeps its existing `firewall.log` OR is renamed to `kern.log` — decide during implementation (I lean: rename `firewall.log` → `kern.log` for consistency with real Linux, and merge the existing template set into `kernLogTemplates`).

**MUTATE**: Run mutation testing on the new `generateLogsByFile` function. Expect template-filter mutations, role-selection mutations, and line-count boundary mutations to be killed by the tests.

**KILL MUTANTS**: Address as needed.

**REFACTOR**: If template fill logic duplicates across formatters, extract a helper.

**Done when**: New tests pass, old `generateLogContent` tests pass or are updated, mission test failures (if any) are listed. Log taxonomy is in place for Phase 2's later steps to write into.

### Step 2: `msfconsole` exploit logging (success + failure)

**RED**: Update `src/commands/msfconsole.test.ts` with behaviour tests:

- After a successful exploit against a port whose service logs to `access.log` (e.g., HTTP), the target's `/var/log/access.log` contains a new line with the attacker's source IP, method (GET/POST), and a realistic attack-pattern path (e.g., path traversal for CVE-2021-41773, SSTI payload for other CVEs).
- After a successful exploit against a port whose service logs elsewhere (e.g., FTP → `vsftpd.log`, MySQL → `mysql.log`), the appropriate log file contains a CVE-specific attack-pattern line.
- After a **failed** exploit attempt (wrong version, no CVE match), the target's service log still contains an attempt entry — probably identical to the success case format, because in real life log entries don't always know whether the attack worked.
- The source IP in all of the above is what `resolveLogSourceIP` returns given the current session context (hop-through respected).

**GREEN**:

- Add attack-pattern templates to the CVE data in `src/generation/pools/vulnerabilities.ts`. Each `VulnerabilityTemplate` gains an `attackPattern` field whose shape is discriminated by the destination log file format:
  ```ts
  type AttackPattern =
    | { readonly logFile: '/var/log/access.log'; readonly method: string; readonly path: string }
    | { readonly logFile: '/var/log/vsftpd.log'; readonly command: string }
    | { readonly logFile: '/var/log/mysql.log'; readonly query: string }
    | {
        readonly logFile: '/var/log/syslog';
        readonly serviceTag: string;
        readonly message: string;
      };
  ```
  For each existing CVE, add a realistic attackPattern (this is content work — the test table stays the same, the data grows).
- Add a new formatter per attack-pattern variant (most of the formats already exist; just wire them up to consume an `attackPattern` object).
- In `msfconsole.ts`, after successful AND failed exploit checks (but before the pre-existing owner check or the async session start), call a new `logExploitAttempt` helper that:
  1. Looks up the CVE via `findVulnForService`. If no CVE → no attack pattern → fallback to a generic syslog entry "suspicious packet from X.X.X.X".
  2. Resolves the source IP via `resolveLogSourceIP`.
  3. Appends the formatted line to the correct log file via `appendToMachineLog`.
- Log for BOTH success and failure paths. The entry doesn't need to say "success" or "failure" explicitly — real log lines don't either; that's part of the forensic puzzle.

**MUTATE**: Mutate the log-file-selection logic (swap destinations), mutate the source-IP resolution call (pass localhost instead of session IP), mutate the pattern-field access. Expect all three categories of mutations to be killed by the tests.

**KILL MUTANTS**: Address as needed.

**REFACTOR**: The attack-pattern formatter dispatcher may be a candidate for consolidation.

**Done when**: Exploit events land in realistic per-service logs with correct source IPs, mutation score >90% on the new logging path, all existing tests still pass.

### Step 3: `nc` backdoor connection logging (success + failure)

**RED**: Update `src/commands/nc.test.ts` with behaviour tests:

- After a successful `nc` connection to a backdoor port (the `elite` service) or any other open port, the target's `/var/log/syslog` contains a syslog entry with the source IP, destination port, and a connection-accepted marker.
- After a failed `nc` connection (closed port, nonexistent port), the target's `/var/log/syslog` contains a syslog entry with a connection-refused marker.
- Source IP respects the hop-through mechanic.

**GREEN**:

- Add a formatter in `formatters.ts`: `formatXinetdConnection({ date, hostname, pid, fromIp, port, outcome })` → syslog line with service tag `xinetd[pid]` or `inetd[pid]`.
- In `nc.ts`, wire up the log write on both success and failure paths. Source IP via `resolveLogSourceIP`, written to `/var/log/syslog` via `appendToMachineLog`.
- Decision: does the FTP banner / SSH banner path in `nc` (connecting to a known service like port 21 or 22) log to `vsftpd.log` / `auth.log` instead? **Lean yes** — if someone `nc`s to port 21, vsftpd-the-daemon would log it, not xinetd. But that duplicates the FTP CONNECT log that `ftp` command already writes. Revisit in implementation. For now, xinetd-syslog only for the `elite` backdoor service, and let FTP/SSH/HTTP banners on known service ports flow through their existing per-service logs where applicable.

**MUTATE**: Mutate the success/failure-branch log call, the outcome-marker string, and the destination path. Expect kills.

**KILL MUTANTS**: Address as needed.

**REFACTOR**: If success and failure log writes share a lot of code, extract.

**Done when**: nc backdoor events land in `/var/log/syslog`, source IP correctly resolved, existing tests still pass.

### Step 4: `nmap` aggregated scan logging

**RED**: Update `src/commands/nmap.test.ts` with behaviour tests:

- After `nmap('192.168.1.50')` (single-host scan), the target's `/var/log/kern.log` contains **exactly one** new line listing the ports that were scanned in iptables-`LOG` format, with the attacker's resolved source IP.
- After `nmap('-sV', '192.168.1.50')` (version scan), same expectation — one aggregated entry, the `-sV` flag doesn't change the log shape (nmap is fingerprinting internally but the target still just sees port connections).
- After a range scan `nmap('192.168.1.1-10')`, **each target IP** in the range that had at least one port touched gets its own one-line aggregated entry in its own `kern.log`. Machines that weren't touched don't get a log.
- Source IP respects hop-through.

**GREEN**:

- Add a formatter: `formatNmapScanAggregate({ date, hostname, fromIp, targetIp, probedPorts })` → single iptables-LOG-style line like:
  ```
  Apr 11 14:23:17 web01 kernel: [iptables] Port scan from 10.0.0.5 — probed ports 22, 80, 443, 3306 (4 hits)
  ```
- In `nmap.ts`, at the end of a scan (after all ports are probed but before the command completes), write a single log entry per target machine via `appendToMachineLog`.
- For range scans, one entry per target, each to that target's `/var/log/kern.log`.

**MUTATE**: Mutate the aggregation logic (log per-port instead of aggregated), mutate the range-scan iteration, mutate the port-list format. Expect kills.

**KILL MUTANTS**: Address as needed.

**REFACTOR**: Consider whether the scan-log call belongs at the end of `start()` or as part of the `onComplete` callback chain.

**Done when**: Scans produce exactly one log entry per touched target, source IP correct, existing nmap tests still pass, aggregation works for range scans.

## PR strategy

Each step is a single commit. Suggested PR groupings:

- **Plan PR (this doc)** — self-contained, merges first.
- **PR A**: Step 1 only (seeding rework). Foundation — gives later PRs realistic log files to write into.
- **PR B**: Step 2 (msfconsole exploit logging). Largest of the phase because of the attack-pattern content work.
- **PR C**: Steps 3 + 4 combined (nc backdoor + nmap scan logging). Both small enough to bundle. Can split if either grows unexpectedly.

All PRs target `multiplayer`.

## Pre-PR Quality Gate

Before each PR:

1. **Mutation testing** — `mutation-testing` skill on the files touched.
2. **Refactoring assessment** — `refactoring` skill on the touched files.
3. **Full verification loop** — `npm run build`, `npm run lint`, `npm run format:check`, `npm run test:run`.
4. **Documentation** — update `src/logging/README.md` with the new events, destinations, and formats. Update `src/generation/README.md` if log seeding shape changes.
5. **Mission breakage report** — list any failing mission tests in the PR description; confirm they're expected per the no-backward-compat policy.

## Risks & open questions

- **CVE attack-pattern data volume.** Each of the ~47 existing CVEs in `vulnerabilityTemplates` will need a hand-written `attackPattern`. That's a content-creation task, not a code task, but it's the real cost of "realistic attack patterns." If it balloons, we can start with a generic per-service template (e.g., every HTTP CVE uses `GET /cgi-bin/?cmd=...`) and enrich individual CVEs over time.
- **Nmap logging creates a write-per-target race condition** in range scans. The scan is async (timed); if the player cancels mid-scan, do we still log the ports that were probed up to that point, or nothing? My lean: log whatever was actually probed — the cancel happened after the connection attempts.
- **Success vs failure indistinguishable in attack-pattern logs.** The realism says "a log line is a log line, the forensic analyst has to figure out what happened." But if players can never tell success from failure on their own machines, they don't know when they've been compromised. Mitigation: Phase 4's typed effects will produce ACTUAL side effects (password changed, files modified) that are observable regardless of log ambiguity. For now, accept the ambiguity — it's authentic.
- **`kern.log` / `firewall.log` on routers.** Today routers get `/var/log/firewall.log` with iptables entries. Step 1 should either rename this to `kern.log` (for consistency) or keep both (firewall.log AND kern.log). My lean: rename, and fold the firewall template lines into `kernLogTemplates`.
- **HTTP range-scan curl → access.log** already exists. Make sure the new nmap aggregation doesn't _also_ write to access.log for port-80 scans — nmap scans go to `kern.log` only. Port-specific connection attempts via protocol-aware commands (curl for HTTP, ftp for FTP) remain in their respective service logs.
- **The seed rework in Step 1 changes the shape of `/var/log/auth.log`** on generated machines. Any existing mission tests that grep auth.log expecting mixed content (kernel lines, postfix lines) will break. These are expected breakage per the no-backward-compat policy.

---

_Delete this file when Phase 2 is complete. If `plans/` is empty, delete the directory._
