import type { FilePermissions } from './types';
import type { UserType } from '../session/types';

// Default permission shapes for newly-created nodes when the patch
// omits an explicit `permissions` field. Used by:
//
//   - applyPatches (client): renders the file/dir locally with these
//     defaults when patch.permissions is undefined.
//   - handleUpsertPatch (server): fills in patches.permissions BEFORE
//     persisting so machine_filesystems gets the same projection
//     dual-written. Without this, a patch with no permissions skipped
//     the dual-write (machine_filesystems.permissions is NOT NULL)
//     and L2 fell back to the leaf-only "no row → allow" path. A
//     malicious client could exploit that to land files invisibly to
//     L2.
//
// Both sides must agree on the shape, otherwise the L2 walker (server-
// side, reading from machine_filesystems) and the client's local
// permission view diverge. Single source of truth here, both callers
// import from this module.
//
// File default — Unix umask-ish: owner-readable, owner-writable, no
// execute (chmod is required to make a new file executable).
export const defaultFilePermissions = (owner: UserType): FilePermissions => ({
  read: ['root', owner],
  write: ['root', owner],
  execute: ['root'],
});

// Directory default — world-traversable, world-readable, owner-writable.
// Mirrors the look of system dirs created via factory's `mkDir(...,
// worldReadable=true)`: every user can `cd` and `ls` inside, but only
// the owner (or root) can create / delete entries.
export const defaultDirectoryPermissions = (owner: UserType): FilePermissions => ({
  read: ['root', 'user', 'guest'],
  write: ['root', owner],
  execute: ['root', 'user', 'guest'],
});

// Convenience: pick the right default for a given node type. Mirrors
// the branching that applyPatches and the handler do at the call site.
export const defaultPermissionsForNode = (
  owner: UserType,
  nodeType: 'file' | 'directory',
): FilePermissions =>
  nodeType === 'directory' ? defaultDirectoryPermissions(owner) : defaultFilePermissions(owner);
