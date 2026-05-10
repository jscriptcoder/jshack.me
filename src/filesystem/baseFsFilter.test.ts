import { describe, it, expect } from 'vitest';
import { filterFileNodeForRead } from './baseFsFilter';
import type { FileNode, FilePermissions } from './types';

// PR 6 of plans/cross-player-base-fs-replication.md — server-side
// filter pass on the regen+overlay base FS, applied at the caller's
// session userType. Mirrors the read-path filter (PR #119) that
// already gates listPatchesForMachines, but operates on a tree
// (regen output) instead of flat patch rows.
//
// Two rules combine:
//   - Files: drop if userType not in target.read.
//   - Directories: drop the entire subtree if userType not in
//     target.execute (Unix-style "can't traverse → can't see contents").
//   - Root userType bypasses everything (canRead handles the bypass).
//
// "Drop" means returning null to the caller; the caller omits the
// node from the parent's children. Empty directories survive (the
// directory itself is traversable; it's just that filtering removed
// every child).

const PERM = (
  read: ReadonlyArray<'root' | 'user' | 'guest'>,
  write: ReadonlyArray<'root' | 'user' | 'guest'>,
  execute: ReadonlyArray<'root' | 'user' | 'guest'>,
): FilePermissions => ({ read, write, execute });

const FILE = (
  name: string,
  owner: 'root' | 'user' | 'guest',
  perms: FilePermissions,
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: perms,
  content: `content-of-${name}`,
});

const DIR = (
  name: string,
  perms: FilePermissions,
  children: Readonly<Record<string, FileNode>> = {},
): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: perms,
  children,
});

describe('filterFileNodeForRead', () => {
  it('returns the tree unchanged for userType=root (root bypass)', () => {
    const tree = DIR('/', PERM(['root'], ['root'], ['root']), {
      root: DIR('root', PERM(['root'], ['root'], ['root']), {
        '.note': FILE('.note', 'root', PERM(['root'], ['root'], ['root'])),
      }),
    });
    const result = filterFileNodeForRead(tree, 'root');
    expect(result).toEqual(tree);
  });

  it('drops a file the userType cannot read', () => {
    const tree = DIR('/', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
      secret: FILE('secret', 'root', PERM(['root'], ['root'], ['root'])),
    });
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.secret).toBeUndefined();
  });

  it('keeps a file the userType CAN read', () => {
    const tree = DIR('/', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
      public: FILE('public', 'user', PERM(['root', 'user'], ['root', 'user'], ['root'])),
    });
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.public.content).toBe('content-of-public');
  });

  it('drops the entire subtree when a directory cannot be traversed', () => {
    const tree = DIR('/', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
      root: DIR('root', PERM(['root'], ['root'], ['root']), {
        '.note': FILE('.note', 'root', PERM(['root', 'user'], ['root'], ['root'])),
      }),
    });
    // /root has execute: ['root'] so user can't traverse — even though
    // /root/.note has read perms for user, user can't get past the dir.
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.root).toBeUndefined();
  });

  it('preserves traversable directory; filters its children at file level', () => {
    const tree = DIR('/', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
      etc: DIR('etc', PERM(['root', 'user'], ['root'], ['root', 'user', 'guest']), {
        passwd: FILE('passwd', 'root', PERM(['root', 'user'], ['root'], ['root'])),
        shadow: FILE('shadow', 'root', PERM(['root'], ['root'], ['root'])),
      }),
    });
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.etc.children?.passwd.content).toBe('content-of-passwd');
    expect(result?.children?.etc.children?.shadow).toBeUndefined();
  });

  it('returns the directory with empty children when every child is filtered', () => {
    const tree = DIR('/', PERM(['root', 'user'], ['root'], ['root', 'user']), {
      secrets: DIR('secrets', PERM(['root', 'user'], ['root'], ['root', 'user']), {
        a: FILE('a', 'root', PERM(['root'], ['root'], ['root'])),
        b: FILE('b', 'root', PERM(['root'], ['root'], ['root'])),
      }),
    });
    const result = filterFileNodeForRead(tree, 'user');
    // Directory survives (traversable); children are gone.
    expect(result?.children?.secrets.type).toBe('directory');
    expect(result?.children?.secrets.children).toEqual({});
  });

  it('returns null when the root node itself is unreadable to the userType', () => {
    const tree = FILE('only-file', 'root', PERM(['root'], ['root'], ['root']));
    expect(filterFileNodeForRead(tree, 'guest')).toBeNull();
  });

  it('returns null when the root directory is non-traversable for the userType', () => {
    const tree = DIR('/', PERM(['root'], ['root'], ['root']), {
      'README.txt': FILE('README.txt', 'root', PERM(['root', 'user', 'guest'], ['root'], ['root'])),
    });
    expect(filterFileNodeForRead(tree, 'guest')).toBeNull();
  });

  it('handles multi-level nesting with mixed permissions', () => {
    const tree = DIR('/', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
      home: DIR('home', PERM(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']), {
        alice: DIR('alice', PERM(['root', 'user'], ['root', 'user'], ['root', 'user']), {
          'README.txt': FILE(
            'README.txt',
            'user',
            PERM(['root', 'user'], ['root', 'user'], ['root']),
          ),
          '.bash_history': FILE(
            '.bash_history',
            'user',
            PERM(['root', 'user'], ['root', 'user'], ['root']),
          ),
        }),
      }),
      root: DIR('root', PERM(['root'], ['root'], ['root']), {
        '.note': FILE('.note', 'root', PERM(['root'], ['root'], ['root'])),
      }),
    });
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.home.children?.alice.children?.['README.txt']).toBeDefined();
    expect(result?.children?.root).toBeUndefined();
  });

  it('drops a file even when user IS in execute but NOT in read', () => {
    // execute is for traverse on directories; on files it's a separate
    // axis. canRead checks target.read, so a file with execute=user but
    // read=root only must still be dropped.
    const tree = DIR('/', PERM(['root', 'user'], ['root'], ['root', 'user']), {
      binary: FILE('binary', 'root', PERM(['root'], ['root'], ['root', 'user'])),
    });
    const result = filterFileNodeForRead(tree, 'user');
    expect(result?.children?.binary).toBeUndefined();
  });
});
