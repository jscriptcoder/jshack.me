# Plan: Dynamic Connection Logging

**Branch**: feat/dynamic-connection-logging
**Status**: Active

## Goal

Connections (SSH, su, SCP, FTP, curl, gobuster) write real-time log entries to the target machine's log files, just like a real Linux system.

## Log Mapping

| Connection    | Log file              | On which machine        |
| ------------- | --------------------- | ----------------------- |
| SSH / su      | `/var/log/auth.log`   | Machine being accessed  |
| SCP           | `/var/log/auth.log`   | Machine being accessed  |
| FTP           | `/var/log/vsftpd.log` | Machine running ftpd    |
| curl/gobuster | `/var/log/access.log` | Machine hosting the web |
| netcat        | (none)                | Intentionally stealthy  |

## Key Design Decisions

- **Append to existing logs**: Static/generated log content stays as "history"; new entries append below it.
- **Timestamps**: Use browser time (matches what curl already does for HTTP Date headers). No game clock needed.
- **Write as root**: Log writes are system-level — bypass normal user permissions by writing as `'root'` via `writeFileToMachine`.
- **Skip syslog**: Too broad, too many patches with IndexedDB per-machine. Revisit with centralized DB.
- **Log on both success and failure**: Failed auth attempts are logged too (realistic and useful for gameplay).

## Filesystem Write Mechanism

No native append — the utility will:

1. Read existing file content via `readFileFromMachine`
2. Append new log line(s)
3. Write back via `writeFileToMachine` (as root)
4. If file doesn't exist, create it via `createFileOnMachine`

## Acceptance Criteria

- [x] SSH login (success/fail) appends to `/var/log/auth.log` on target machine
- [x] SCP auth (success/fail) appends to `/var/log/auth.log` on target machine
- [x] su (success/fail) appends to `/var/log/auth.log` on current machine
- [x] FTP login (success/fail) appends to `/var/log/vsftpd.log` on target machine
- [x] curl request appends to `/var/log/access.log` on target machine
- [x] gobuster scan appends to `/var/log/access.log` on target machine
- [x] Existing static log content is preserved (new entries appended after)
- [x] Logs persist across page reloads (IndexedDB patches)
- [x] Logs sync across tabs (BroadcastChannel)
- [x] netcat connections leave no log trace

## PR Strategy — 3 Small PRs

### PR 1: Core logging infrastructure + auth.log (SSH, su, SCP)

Most impactful slice. Builds the shared infrastructure and covers the most common connections.

### PR 2: FTP logging (vsftpd.log)

Small, focused — hooks into FTP auth paths in `useAuthentication`.

### PR 3: HTTP access logging (access.log)

Hooks into curl and gobuster commands.

---

## Steps (PR 1: Core + auth.log)

### Step 1: Create auth.log line formatters

**Test**: Unit tests verifying `formatAuthLogEntry()` produces correct syslog-format lines for SSH accepted/failed, su success/fail, SCP accepted/failed.
**Implementation**: Pure function in new `src/logging/formatters.ts`. Format: `MMM DD HH:MM:SS hostname service[pid]: message`.
**Done when**: All formatter tests pass with correct Linux-realistic output.

### Step 2: Create `appendToMachineLog` utility

**Test**: Unit test verifying it reads existing content, appends new line, and writes back. Also test the create-if-missing path.
**Implementation**: Utility function that takes `readFileFromMachine`, `writeFileToMachine`, `createFileOnMachine` as deps (pure DI). Handles both "file exists" (read+append+write) and "file missing" (create) cases.
**Done when**: Tests pass for both append and create paths.

### Step 3: Integrate auth logging for `su`

**Test**: Test that `su` (both inline and interactive) triggers a log write to `/var/log/auth.log` on the current machine for both success and failure.
**Implementation**: Add logging calls in `su.ts` (inline path) and `useAuthentication.ts` (interactive path, `handlePasswordSubmit` su branch). The current machine is localhost or whatever SSH session the player is in.
**Done when**: su success writes "Successful su for {user}" and failure writes "FAILED su for {user}" to auth.log.

### Step 4: Integrate auth logging for SSH

**Test**: Test that SSH auth (inline and interactive) triggers a log write to `/var/log/auth.log` on the **target** machine.
**Implementation**: Add logging calls in `useAuthentication.ts` at `authenticateSshInline()` success/fail points and `handlePasswordSubmit()` SSH branch. Also handle saved-key authentication.
**Done when**: SSH login writes "Accepted password for {user} from {ip}" or "Failed password for {user} from {ip}" to target's auth.log.

### Step 5: Integrate auth logging for SCP

**Test**: Test that SCP auth triggers a log write to `/var/log/auth.log` on the target machine.
**Implementation**: Add logging calls in `useAuthentication.ts` at `authenticateScpInline()` and `handlePasswordSubmit()` SCP branch. SCP uses SSH auth, so log format matches SSH.
**Done when**: SCP auth writes SSH-style entries to target's auth.log.

---

## Steps (PR 2: FTP logging)

### Step 6: Create vsftpd.log line formatter

**Test**: Unit tests for FTP log format.
**Implementation**: Add `formatFtpLogEntry()` to formatters. Format: `Day MMM DD HH:MM:SS YYYY [pid N] [user] STATUS: message`.
**Done when**: Formatter produces realistic vsftpd log lines.

### Step 7: Integrate FTP logging

**Test**: Test that FTP auth (inline and interactive) triggers a log write to `/var/log/vsftpd.log` on the target machine.
**Implementation**: Add logging calls in `useAuthentication.ts` at `authenticateFtpInline()` and `handlePasswordSubmit()` FTP branch.
**Done when**: FTP login writes connect/login/fail entries to target's vsftpd.log.

---

## Steps (PR 3: HTTP access logging)

### Step 8: Create access.log line formatter

**Test**: Unit tests for Apache Combined Log Format.
**Implementation**: Add `formatAccessLogEntry()` to formatters. Format: `ip - - [DD/MMM/YYYY:HH:MM:SS +0000] "GET /path HTTP/1.1" status size`.
**Done when**: Formatter produces realistic Apache access log lines.

### Step 9: Integrate curl access logging

**Test**: Test that curl requests append to `/var/log/access.log` on the target machine.
**Implementation**: Add logging call in curl command after successful file read. Include requested path, status code (200/404), and response size.
**Done when**: Each curl request generates an access log entry on the target.

### Step 10: Integrate gobuster access logging

**Test**: Test that gobuster scans append to `/var/log/access.log` on the target machine.
**Implementation**: Add logging call in gobuster after enumeration. Each probed path generates a log entry (200 for found, 404 for not found).
**Done when**: Gobuster scan generates multiple access log entries on the target.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing -- run `mutation-testing` skill
2. Refactoring assessment -- run `refactoring` skill
3. `npm run build` passes
4. `npm run lint` passes
5. `npm run test:run` passes

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
