# Plan: Tool-Based Progression System

## Goal

Replace credential-based lateral movement with a tool-based progression system where players transfer and chmod binaries to navigate mission networks.

## Acceptance Criteria

- [ ] `ls` supports `-l` flag showing `drwxrwxrwx owner filename` format
- [ ] `chmod` command supports symbolic notation (`o+x`, `u-w`, `a+rx`)
- [ ] Commands resolve binaries from current directory, then `/bin/`, then `/usr/bin/`
- [ ] Binary resolution includes execute permission check
- [ ] `scp` command copies files between machines preserving permissions
- [ ] Created files default to no execute permission (matching Unix umask)
- [ ] Editing existing files preserves their original permissions
- [ ] All credential-based generation removed (attack chains, hints, Intel, breadcrumbs)
- [ ] All 11 mission board entries removed
- [ ] All tests pass, build succeeds

## Steps

### Step 1: `ls -l` flag — Long listing with permissions display

**Test**: `ls('-l')` returns formatted output with `drwxrwxrwx owner filename` per entry.
**Implementation**: Parse `-l` flag in ls command. Map `FilePermissions` arrays to Unix permission string. Format output with columns.
**Done when**: `ls('-l')` shows permission string, owner, and name for each entry. Existing `ls()` behavior unchanged.

### Step 2: Extend FileSystemPatch to persist permissions

**Test**: A patch with `permissions` field preserves those permissions through `applyPatches`. A patch without permissions uses defaults (no execute for non-root).
**Implementation**: Add optional `permissions` field to `FileSystemPatch` type. Update `applyPatches` to use patch permissions when present, otherwise default to `execute: ['root']` only. Update `writeFile`/`createFile`/`nano` to include original file permissions in patch when editing existing files.
**Done when**: Patches can round-trip permissions. New files have no execute by default. Edited files preserve original permissions.

### Step 3: `chmod` command — Change file permissions

**Test**: `chmod('o+x', '/path/to/file')` adds guest to execute array. `chmod('u-w', '/path')` removes owner from write array. Non-owner non-root gets "Operation not permitted".
**Implementation**: Parse symbolic notation (`[ugoa][+-][rwx]+`). Map u/g/o/a to UserType arrays. Create `updatePermissions` method on FileSystemContext. Guest-tier command (any user can chmod their own files, root can chmod anything).
**Done when**: chmod modifies permissions, persisted via patches. Permission checks enforced. Registered and tested.

### Step 4: Command resolution from current directory with execute check

**Test**: A command binary at `${currentPath}/nmap` that is executable by current user allows running `nmap()`. A binary without execute permission blocks it. Falls back to `/bin/` then `/usr/bin/`.
**Implementation**: Modify `isCommandInstalled` in `availability.ts` to check current directory first (with execute permission check), then `/bin/`, then `/usr/bin/`. Pass current path and user type into the check.
**Done when**: Commands resolve from current directory. Execute permission is verified. Existing `/bin/` and `/usr/bin/` resolution still works.

### Step 5: `scp` command — Secure copy between machines

**Test**: `scp('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap')` transfers file with preserved permissions after password authentication.
**Implementation**: Parse `user@host:path` syntax. AsyncOutput with connection animation + password prompt (same pattern as SSH). Read source file, create on destination preserving source permissions. Guest-tier command, system utility (in `/bin/`).
**Done when**: scp transfers files between machines with permission preservation. Password authentication works. Registered and tested.

### Step 6: Remove credential-based generation and mission board

**Test**: `generateMissionNetwork` produces a network with topology, users, and filesystems but no credential placements or attack chain. Mission board is empty.
**Implementation**: Remove `attackChain.ts` credential placement logic (keep objective building). Remove credential pools from `pools.ts`. Remove credential/hint generation from `filesystem.ts`. Clear all 11 mission board entries. Simplify `generateMission.ts` pipeline. Update/remove affected tests.
**Done when**: No credentials are generated. Mission board is empty. Generation still produces valid topology + users + filesystems + objectives. All tests pass.

## Permission Model Mapping

For `chmod` symbolic notation and `ls -l` display:

| Symbol | Maps to         | Notes                           |
| ------ | --------------- | ------------------------------- |
| u      | file's `owner`  | Whatever UserType owns the file |
| g      | `'user'` type   | Middle privilege tier           |
| o      | `'guest'` type  | Lowest privilege tier           |
| a      | all three types | root + user + guest             |

Root always has full access (enforced at check time, not in permission arrays).

## `ls -l` Display Format

```
drwxr-xr-x  root   bin/
-rw-r-----  user   notes.txt
-rwx------  root   secret.sh
```

- First char: `d` for directory, `-` for file
- Triple 1 (owner): permissions for file's owner (root owner = always rwx)
- Triple 2 (user): permissions for 'user' type
- Triple 3 (guest): permissions for 'guest' type

## Command Resolution Order

1. `${currentPath}/${commandName}` — exists AND executable by current user
2. `/bin/${commandName}` — exists (system utilities, always executable)
3. `/usr/bin/${commandName}` — exists (apt-installed tools)

## New Permission Defaults

| Operation            | Execute Permission           |
| -------------------- | ---------------------------- |
| New file (nano/etc)  | `['root']` only              |
| Edited file          | Preserved from original      |
| scp transferred file | Preserved from source        |
| chmod'd file         | Whatever chmod sets          |
| Generator mkFile     | `['root']` (unchanged)       |
| Generator mkScript   | World-executable (unchanged) |

## Command Tiers

| Command | Tier  | Availability   |
| ------- | ----- | -------------- |
| chmod   | guest | System utility |
| scp     | guest | System utility |
