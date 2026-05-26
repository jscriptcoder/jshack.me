/**
 * Virtual filesystem types.
 *
 * `FileNode` is a discriminated union over file vs directory. Permissions
 * follow the Unix `owner / group / other` mode-bit layout (0o755, 0o644,
 * etc.). The walker (../walker.ts) is the single source of truth for
 * read/write permission decisions — both client and server import it.
 */

import type { EpochMs } from '../types';

/** Unix-style permissions. Mode follows octal layout:
 *
 *    0o400 owner read   0o040 group read   0o004 other read
 *    0o200 owner write  0o020 group write  0o002 other write
 *    0o100 owner exec   0o010 group exec   0o001 other exec
 */
export type FilePermissions = {
  readonly owner: string;
  readonly group: string;
  readonly mode: number;
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
  readonly perms: FilePermissions;
  readonly metadata?: FileMetadata;
};

export type Directory = {
  readonly kind: 'directory';
  readonly entries: ReadonlyMap<string, FileNode>;
  readonly perms: FilePermissions;
};

export type FileNode = FileEntry | Directory;
