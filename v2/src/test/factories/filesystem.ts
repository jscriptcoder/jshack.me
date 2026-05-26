/**
 * Filesystem factory helpers for tests.
 *
 * Building `Directory` objects with `ReadonlyMap` directly is verbose.
 * These helpers let tests describe a tree with plain object literals.
 */

import {
  type Directory,
  type FileEntry,
  type FileNode,
  type FilePermissions,
} from '../../core/filesystem/types';

const DEFAULT_PERMS: FilePermissions = { owner: 'root', group: 'root', mode: 0o755 };

/** Build a file entry. */
export const buildFile = (
  content: string,
  perms: Partial<FilePermissions> = {},
): FileEntry => ({
  kind: 'file',
  content,
  perms: { ...DEFAULT_PERMS, mode: 0o644, ...perms },
});

/** Build a directory from a plain object of children. */
export const buildDirectory = (
  children: Readonly<Record<string, FileNode>> = {},
  perms: Partial<FilePermissions> = {},
): Directory => ({
  kind: 'directory',
  perms: { ...DEFAULT_PERMS, ...perms },
  entries: new Map(Object.entries(children)),
});

/** Convenience: build a typical home directory structure for tests.
 *
 *  /etc/passwd carries password hashes inline (jshack has no /etc/shadow —
 *  sabotage-via-garble is a real attack vector by design; see the
 *  blueprint's §6.3 + §4.6). */
export const buildHomeFs = (username = 'alice'): Directory =>
  buildDirectory(
    {
      etc: buildDirectory({
        passwd: buildFile(
          `root:$1$abc$rootHashHere:0:0:root:/root:/bin/bash\n${username}:$1$abc$userHashHere:1000:1000::/home/${username}:/bin/bash\n`,
          { owner: 'root', mode: 0o644 },
        ),
      }),
      home: buildDirectory({
        [username]: buildDirectory(
          {
            'notes.txt': buildFile('hello world\nfrom alice', { owner: username, mode: 0o600 }),
          },
          { owner: username, group: username, mode: 0o755 },
        ),
      }),
    },
    { owner: 'root', mode: 0o755 },
  );
