/**
 * Virtual filesystem types.
 *
 * `FileNode` is a discriminated union over file vs directory. Permissions
 * are tier-based allowlists (`read`/`write`/`execute` per UserType),
 * matching the 3-tier privilege model the game actually uses. The walker
 * (../walker.ts) is the single source of truth for read/write decisions —
 * both client and server import it.
 *
 * Limitation by design: tier-based perms don't isolate two `'user'`-tier
 * accounts on the same machine — they'd see each other's files. Acceptable
 * because the game's model is one user-tier account per machine.
 */

import type { EpochMs, UserType } from '../types';

/** Tier-based permission allowlist. A user passes if their tier appears
 *  in the relevant array. */
export type FilePermissions = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};

export type FileMetadata = {
  readonly mtime?: EpochMs;
  readonly isExecutable?: boolean;
  /** For /bin/* commands — which /lib/* libraries they dynamically link.
   *  Used by the library-CVE chain (msfconsole --local, ldd). */
  readonly libraryLinks?: readonly string[];
};

export type FileEntry = {
  readonly kind: 'file';
  readonly content: string;
  /** Username of the owner — displayed in ls -l. The walker doesn't read
   *  this; permissions are tier-based via `perms`. */
  readonly owner: string;
  readonly perms: FilePermissions;
  readonly metadata?: FileMetadata;
};

export type Directory = {
  readonly kind: 'directory';
  readonly entries: ReadonlyMap<string, FileNode>;
  readonly owner: string;
  readonly perms: FilePermissions;
};

export type FileNode = FileEntry | Directory;
