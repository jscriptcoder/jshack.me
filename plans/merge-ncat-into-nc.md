# Plan: Merge ncat into nc with `-l` flag

**Branch**: feat/nc-lateral-movement
**Status**: Active

## Goal

Replace the separate `ncat` command with `nc('-l', port)` listen mode, and rename the apt package from `nc` to `netcat`.

## Acceptance Criteria

- [ ] `nc('-l', port)` and `nc(port, '-l')` open a backdoor listener (same as old `ncat(port)`)
- [ ] `nc(host, port)` still connects to remote machines (unchanged behavior)
- [ ] `apt('install', 'netcat')` installs the `nc` binary (single binary, no `ncat`)
- [ ] PID file format uses `nc:` prefix instead of `ncat:`
- [ ] `ps` shows `/usr/bin/nc -lvnp <port>` for listeners
- [ ] `ncat` command no longer exists
- [ ] All tests pass, lint/format clean

## Steps

### Step 1: Add listen mode to nc pure function and update PID format

**Test**: Write tests for `nc('-l', port)` and `nc(port, '-l')` in nc.test.ts — port validation, privileged port check, PID file writing with `nc:` prefix format.
**Implementation**:

- Extract listen logic from ncat.ts into nc.ts (reuse `NcatAdapter` → `NcListenAdapter` types)
- Parse args: if either arg is `'-l'`, enter listen mode with the other arg as port
- PID content format changes from `ncat:port=...` to `nc:port=...`
- Update `ncatStateParser.ts` regex from `/^ncat:/` to `/^nc:/` (rename file to `ncStateParser.ts`)
- Update parser tests for new `nc:` prefix
  **Done when**: nc listen mode tests pass, parser tests pass with `nc:` prefix

### Step 2: Remove ncat command, rename apt package, update registrations

**Test**: Update apt.test.ts for `netcat` package name. Verify ncat command no longer exists.
**Implementation**:

- Delete `ncat.ts` and `ncat.test.ts`
- In `availability.ts`: rename package `nc` → `netcat`, binaries `['nc', 'ncat']` → `['nc']`, remove `ncat` from `APT_TOOL_NAMES`
- In `APT_INSTALLABLE`: `'nc'` → `'netcat'`
- In `useCommands.ts`: remove ncat registration, update nc registration to include listen adapter
- Update `ps.ts`: PID file prefix `ncat-` stays (or changes to `nc-`), display changes to `/usr/bin/nc -lvnp`
- Update `NetworkContext.tsx` imports for renamed parser
  **Done when**: All tests pass, `ncat` fully removed

### Step 3: Update documentation

**Implementation**: Update CLAUDE.md, commands README, network README, architecture docs
**Done when**: All docs accurate, `npm run format` clean

## Pre-PR Quality Gate

Before PR:

1. `npm run build` passes
2. `npm run test:run` — all tests pass
3. `npm run lint` — clean
4. `npm run format` — clean

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
