# Plan: Programmatic Authentication for Interactive Commands

**Branch**: feat/programmatic-auth
**Status**: Active

## Goal

Allow su, ssh, scp, and ftp to accept optional credential arguments that bypass interactive prompts, enabling scripting via `node()`.

## New Signatures

```
su('root', 'password')              — inline auth, no prompt
ssh('root@ip', 'password')          — password with default port
ssh('root@ip', 22, 'password')      — password with explicit port
scp(src, dst, 'password')           — password with auto-detect port
scp(src, dst, 22, 'password')       — password with explicit port
ftp('ip', 'user', 'password')       — username + password, no prompts
```

## Design

**su** is different from the others: it must authenticate synchronously within `fn()` so that subsequent lines in a sync `node()` script run as the new user. This means `su` needs auth logic in its own context (validation + user switch).

**ssh, scp, ftp** already return `AsyncOutput` and require `await` in scripts. Credentials are embedded as optional fields in their follow-up prompt data (`SshPromptData`, `ScpPromptData`, `FtpPromptData`). `useAuthentication` gains new inline-auth methods that Terminal.tsx calls when credentials are present, skipping the interactive prompt.

## Acceptance Criteria

- [ ] `su('root', pw)` switches user inline; wrong password throws
- [ ] `su('root')` still shows interactive prompt (backward compat)
- [ ] `ssh('user@ip', pw)` auto-authenticates after animation
- [ ] `ssh('user@ip', port, pw)` works with explicit port
- [ ] `ssh('user@ip')` still shows interactive prompt
- [ ] `scp(src, dst, pw)` auto-authenticates after animation
- [ ] `scp(src, dst, port, pw)` works with explicit port
- [ ] `scp(src, dst)` still shows interactive prompt
- [ ] `ftp('ip', user, pw)` auto-authenticates after animation
- [ ] `ftp('ip')` still shows interactive prompt
- [ ] SSH keys saved on programmatic ssh/scp auth (same as interactive)
- [ ] Invalid credentials produce appropriate error messages
- [ ] Manual pages updated with new signatures/examples
- [ ] All existing tests still pass

## Steps

### Step 1: su programmatic authentication

**Test**: su with correct password returns success string (not PasswordPromptData); su with wrong password throws "Authentication failure"; su without password still returns PasswordPromptData.
**Implementation**:

- Expand `SuContext` with `readFile`, `findMachineUsers`, `getMachine`, `setUsername`, `setCurrentPath` (all available in useCommands)
- In `su.ts`: when 2nd arg is a string, validate password against `/etc/passwd` MD5 hash, switch user inline, return success string. When no 2nd arg, return PasswordPromptData as before.
- In `useCommands.ts`: pass the new context functions to `createSuCommand`
- Update manual synopsis/examples
  **Done when**: su tests pass for both interactive and programmatic paths

### Step 2: ssh programmatic authentication

**Test**: ssh with password includes `password` field in SshPromptData follow-up; ssh without password has no password field; ssh with string 2nd arg (no port) uses default port 22 and passes password through.
**Implementation**:

- Add optional `password` to `SshPromptData` in `types.ts`
- In `ssh.ts`: detect if 2nd arg is string (password, port=22) or number (port, check 3rd for password). Pass password through to SshPromptData in onComplete.
- In `useAuthentication.ts`: add `authenticateSshInline(user, ip, port, password)` that validates, saves key, and connects (reuses `connectSsh` + `saveAuthorizedKey`). Returns success/failure boolean.
- In `Terminal.tsx`: in onComplete handler, if `followUp.password` exists, call inline auth instead of `startSshPrompt`
- Update manual synopsis/examples
  **Done when**: ssh tests pass for both paths; inline auth validates and connects

### Step 3: scp programmatic authentication

**Test**: scp with password includes `password` field in ScpPromptData follow-up and triggers transfer without prompt; scp without password still prompts.
**Implementation**:

- Add optional `password` to `ScpPromptData` in `types.ts`
- In `scp.ts`: detect password arg (3rd string = password with auto-port; 4th string = password with explicit port). Pass through to ScpPromptData.
- In `useAuthentication.ts`: add `authenticateScpInline(user, ip, port, password, performTransfer)` that validates, saves key, and returns the transfer AsyncOutput (or throws).
- In `Terminal.tsx`: in onComplete handler, if `followUp.password` exists, call inline auth + start transfer animation
- Update manual synopsis/examples
  **Done when**: scp tests pass for both paths; inline auth triggers file transfer

### Step 4: ftp programmatic authentication

**Test**: ftp with username+password includes both fields in FtpPromptData follow-up and enters FTP mode without prompts; ftp without credentials still prompts.
**Implementation**:

- Add optional `username` and `password` to `FtpPromptData` in `types.ts`
- In `ftp.ts`: if 2nd and 3rd args provided, pass them through to FtpPromptData.
- In `useAuthentication.ts`: add `authenticateFtpInline(ip, username, password)` that validates both credentials and enters FTP mode (reuses existing FTP session setup from handlePasswordSubmit).
- In `Terminal.tsx`: in onComplete handler, if `followUp.username && followUp.password` exists, call inline auth instead of `startFtpPrompt`
- Update manual synopsis/examples
  **Done when**: ftp tests pass for both paths; inline auth enters FTP mode

### Step 5: Documentation update

**Test**: N/A (docs only)
**Implementation**: Update CLAUDE.md architecture notes, command READMEs, and any relevant docs to describe programmatic auth capability.
**Done when**: `npm run format` passes on all updated docs

## Pre-PR Quality Gate

Before PR:

1. All tests pass (`npm run test:run`)
2. Build succeeds (`npm run build`)
3. Lint passes (`npm run lint`)
4. Format passes (`npm run format:check`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
