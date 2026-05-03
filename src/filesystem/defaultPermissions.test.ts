import { describe, it, expect } from 'vitest';
import {
  defaultFilePermissions,
  defaultDirectoryPermissions,
  defaultPermissionsForNode,
} from './defaultPermissions';

describe('defaultFilePermissions', () => {
  it('grants root + owner read and write, only root execute (root owner case)', () => {
    expect(defaultFilePermissions('root')).toEqual({
      read: ['root', 'root'],
      write: ['root', 'root'],
      execute: ['root'],
    });
  });

  it('grants root + user read and write for user-owned files; only root execute', () => {
    expect(defaultFilePermissions('user')).toEqual({
      read: ['root', 'user'],
      write: ['root', 'user'],
      execute: ['root'],
    });
  });

  it('grants root + guest read and write for guest-owned files; only root execute', () => {
    expect(defaultFilePermissions('guest')).toEqual({
      read: ['root', 'guest'],
      write: ['root', 'guest'],
      execute: ['root'],
    });
  });

  it('never grants execute outside root (umask-style — chmod needed for executability)', () => {
    // Pinned: a mutant that opened execute to the owner would let a
    // newly-created file run binaries silently — defense-in-depth
    // against client-side mistakes.
    for (const owner of ['root', 'user', 'guest'] as const) {
      expect(defaultFilePermissions(owner).execute).toEqual(['root']);
    }
  });
});

describe('defaultDirectoryPermissions', () => {
  it('grants every user-type read + execute (world-traversable)', () => {
    // Dirs default to world-readable + world-traversable so cd/ls
    // work for everyone — only writes (creating entries) are gated.
    expect(defaultDirectoryPermissions('user')).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root', 'user'],
      execute: ['root', 'user', 'guest'],
    });
  });

  it('grants only root + owner write (entry creation is owner-scoped)', () => {
    expect(defaultDirectoryPermissions('guest').write).toEqual(['root', 'guest']);
    expect(defaultDirectoryPermissions('user').write).toEqual(['root', 'user']);
    expect(defaultDirectoryPermissions('root').write).toEqual(['root', 'root']);
  });
});

describe('defaultPermissionsForNode', () => {
  it("dispatches to defaultFilePermissions for nodeType 'file'", () => {
    expect(defaultPermissionsForNode('user', 'file')).toEqual(defaultFilePermissions('user'));
  });

  it("dispatches to defaultDirectoryPermissions for nodeType 'directory'", () => {
    expect(defaultPermissionsForNode('guest', 'directory')).toEqual(
      defaultDirectoryPermissions('guest'),
    );
  });
});
