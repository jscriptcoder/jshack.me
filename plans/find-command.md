# Plan: `find` Command

**Branch**: feat/find-command
**Status**: Active

## Goal

Add a `find` command that recursively searches the virtual filesystem by name pattern and/or owner, respecting permissions.

## API

`find(path, pattern, [user])`

```js
find('.', '*.key'); // pattern from cwd
find('/', '*.key'); // pattern from root
find('/home', 'config*', 'root'); // pattern + owner filter
find('.', 'root'); // find entries named "root" from cwd
find('/var/log', '*.log'); // search specific directory
```

- **path** (required) — where to search (use `.` for cwd)
- **pattern** (required) — glob pattern to match filenames (`*` any chars, `?` single char)
- **user** (optional) — filter results by file owner
- Searches files and directories
- Directories shown with trailing `/` in output
- Respects filesystem permissions (traversal checks, read permissions on directories)
- System utility in `/bin/` (always available, no apt install needed)

## Acceptance Criteria

- [ ] `find(".", "*.key")` returns all matching files/dirs recursively from cwd
- [ ] `find("/", "*.key", "root")` filters by both pattern and owner
- [ ] Glob supports `*` (any chars) and `?` (single char)
- [ ] Exact name match works: `find(".", "secret.txt")`
- [ ] Directories shown with trailing `/`
- [ ] Permission-denied directories are silently skipped (real `find` behavior)
- [ ] Traversal checks enforced (can't descend into dirs without execute permission)
- [ ] Error on missing path or missing pattern
- [ ] Registered in useFileSystemCommands, listed in SYSTEM_UTILITY_NAMES
- [ ] Manual page with synopsis, description, examples

## Steps

### Step 1: Parse positional args and return matching files by glob pattern

**Test**: `find("/", "*.txt")` on a tree with nested `.txt` files returns their full paths. Directories get trailing `/`.
**Implementation**: Create `src/commands/find.ts` with `createFindCommand`. Parse args positionally: `(path, pattern, [user])`. Recursively walk the tree, match filenames against glob pattern.
**Done when**: Pattern-based search returns correct paths with trailing `/` on directories.

### Step 2: Add optional user filter (3rd arg)

**Test**: `find("/", "*.key", "root")` returns only root-owned matches. `find("/", "*", "guest")` returns all guest-owned entries.
**Implementation**: When 3rd arg provided, filter results by `node.owner`.
**Done when**: Owner filter works alone and combined with pattern.

### Step 3: Validate inputs and handle edge cases

**Test**: `find()` with no args throws error. Missing pattern throws error. Non-existent path throws error. Empty results return empty string.
**Implementation**: Add input validation with descriptive error messages.
**Done when**: All edge cases handled with proper error messages.

### Step 4: Respect permissions — skip unreadable/untraversable directories

**Test**: As `guest`, `find("/", "secret.txt")` skips `/root/` (no traverse permission) silently. Entries inside restricted dirs are not returned.
**Implementation**: Check `canTraverse` before descending, check read permission on directories before listing children. Skip silently (matching real `find` behavior).
**Done when**: Permission-restricted paths are silently excluded from results.

### Step 5: Register command and add to SYSTEM_UTILITY_NAMES

**Test**: Existing availability/help tests continue passing. `find` appears in help output.
**Implementation**: Add `'find'` to `SYSTEM_UTILITY_NAMES` in `availability.ts`. Import and register `createFindCommand` in `useFileSystemCommands.ts`. Add manual page.
**Done when**: `find` is a fully wired system utility with man page.

## Pre-PR Quality Gate

Before PR:

1. All tests pass (`npm run test:run`)
2. Build passes (`npm run build`)
3. Lint passes (`npm run lint`)
4. Format passes (`npm run format`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
