/**
 * Filesystem factory helpers for tests.
 *
 * Building `Directory` objects with `ReadonlyMap` directly is verbose.
 * These helpers let tests describe a tree with plain object literals.
 */

import type { UserType } from '../../core/types';
import {
  type Directory,
  type FileEntry,
  type FileNode,
  type FilePermissions,
} from '../../core/filesystem/types';

const ALL_TIERS: readonly UserType[] = ['root', 'user', 'guest'];

/** Default file perms — root rw, owner-tier rw, everyone else nothing. */
const defaultFilePerms = (ownerTier: UserType): FilePermissions => ({
  read: dedupeTiers(['root', ownerTier]),
  write: dedupeTiers(['root', ownerTier]),
  execute: ['root'],
});

/** Default directory perms — world-traversable, world-readable, owner-tier writes. */
const defaultDirPerms = (ownerTier: UserType): FilePermissions => ({
  read: ALL_TIERS,
  write: dedupeTiers(['root', ownerTier]),
  execute: ALL_TIERS,
});

const dedupeTiers = (tiers: readonly UserType[]): readonly UserType[] => [...new Set(tiers)];

/** Map a username to its tier — used to pick default permissions when
 *  the test only specifies the owner string. */
export const ownerTier = (owner: string): UserType => {
  if (owner === 'root') return 'root';
  if (owner === 'nobody' || owner === 'www-data') return 'guest';
  return 'user';
};

type BuildOpts = {
  readonly owner?: string;
  readonly perms?: Partial<FilePermissions>;
};

/** Build a file entry. */
export const buildFile = (content: string, opts: BuildOpts = {}): FileEntry => {
  const owner = opts.owner ?? 'root';
  const defaults = defaultFilePerms(ownerTier(owner));
  return {
    kind: 'file',
    content,
    owner,
    perms: { ...defaults, ...opts.perms },
  };
};

/** Build a directory from a plain object of children. */
export const buildDirectory = (
  children: Readonly<Record<string, FileNode>> = {},
  opts: BuildOpts = {},
): Directory => {
  const owner = opts.owner ?? 'root';
  const defaults = defaultDirPerms(ownerTier(owner));
  return {
    kind: 'directory',
    owner,
    perms: { ...defaults, ...opts.perms },
    entries: new Map(Object.entries(children)),
  };
};

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
          { owner: 'root' },
        ),
      }),
      home: buildDirectory({
        [username]: buildDirectory(
          {
            'notes.txt': buildFile('hello world\nfrom alice', { owner: username }),
          },
          { owner: username },
        ),
      }),
    },
    { owner: 'root' },
  );
