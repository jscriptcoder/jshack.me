/**
 * Default permission shapes for newly-created nodes when a patch omits an
 * explicit `permissions` field. Used by BOTH:
 *
 *   - `applyPatches` (client): renders the file/dir locally with these
 *     defaults when a patch row carries no permissions.
 *   - the `mkdir`/write commands: stamp the permissions onto the patch they
 *     send so the server persists the same shape the client renders.
 *
 * Both sides must agree, otherwise the walker's allow/deny (shared client +
 * server) diverges. Single source of truth here.
 *
 * File default — owner-readable + owner-writable, execute root-only (chmod is
 * required to make a new file executable). Directory default — world-readable
 * and world-traversable, owner-writable: every tier can `cd`/`ls` inside, but
 * only the owner tier (or root) can create/delete entries.
 */

import type { UserType } from '../types';
import type { FilePermissions } from './types';

const dedupeTiers = (tiers: readonly UserType[]): readonly UserType[] => [...new Set(tiers)];

export const defaultFilePermissions = (owner: UserType): FilePermissions => ({
  read: dedupeTiers(['root', owner]),
  write: dedupeTiers(['root', owner]),
  execute: ['root'],
});

export const defaultDirectoryPermissions = (owner: UserType): FilePermissions => ({
  read: ['root', 'user', 'guest'],
  write: dedupeTiers(['root', owner]),
  execute: ['root', 'user', 'guest'],
});

export const defaultPermissionsForNode = (
  owner: UserType,
  nodeType: 'file' | 'directory',
): FilePermissions =>
  nodeType === 'directory' ? defaultDirectoryPermissions(owner) : defaultFilePermissions(owner);
