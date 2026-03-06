# Learnings: Tool-Based Progression System

## Decisions Made

### Permission model mapping (u/g/o → root/user/guest)

- **Options considered**: (A) u=owner, g=user, o=guest; (B) Unix-faithful with simulated groups; (C) Simplified +x/-x only
- **Decision**: Option A — u maps to file's owner, g maps to 'user' type, o maps to 'guest' type, a maps to all
- **Rationale**: Clean mapping to existing UserType system. Root always has full access (enforced at check time). No need for group simulation.
- **Trade-offs**: Not 100% Unix-faithful (no real groups), but sufficient for gameplay.

### Default file permissions — no execute for created files

- **Options considered**: (A) Keep current behavior (owner gets execute); (B) No execute by default (Unix umask style)
- **Decision**: Option B — new files get `execute: ['root']` only
- **Rationale**: Makes chmod meaningful for tool-based progression. Matches real Unix behavior (umask 022 → 644 for files). Edited files preserve original permissions.
- **Trade-offs**: May break some existing tests. Needs careful handling in nano (preserve permissions of existing files).

### Command resolution — optional params for backward compatibility

- **Context**: `isCommandInstalled` gained `currentPath` and `userType` params for cwd resolution
- **Decision**: Made both params optional with existing callers unchanged
- **Rationale**: Existing call sites without cwd/userType skip cwd check entirely — backward compatible. Only apt-installable commands check cwd (builtins and system utilities short-circuit before that code path).

### scp permission preservation

- **Options considered**: (A) Destination gets owner-based defaults; (B) Source permissions preserved
- **Decision**: Option B — scp preserves source file permissions
- **Rationale**: Makes the chmod→transfer→execute flow work. Player must chmod before transferring to make tools executable by guest.
- **Trade-offs**: Slightly more complex implementation (must include permissions in patch).
