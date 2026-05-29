import { describe, expect, it } from 'vitest';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
  defaultPermissionsForNode,
} from './defaultPermissions';

describe('defaultFilePermissions', () => {
  it('grants read+write to root and the owner tier, execute to root only', () => {
    expect(defaultFilePermissions('user')).toEqual({
      read: ['root', 'user'],
      write: ['root', 'user'],
      execute: ['root'],
    });
  });

  it('grants the guest owner tier its own read+write', () => {
    expect(defaultFilePermissions('guest')).toEqual({
      read: ['root', 'guest'],
      write: ['root', 'guest'],
      execute: ['root'],
    });
  });

  it('collapses a root owner to a single root entry (no duplicate)', () => {
    expect(defaultFilePermissions('root')).toEqual({
      read: ['root'],
      write: ['root'],
      execute: ['root'],
    });
  });
});

describe('defaultDirectoryPermissions', () => {
  it('is world-readable and world-traversable, owner-writable', () => {
    expect(defaultDirectoryPermissions('user')).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root', 'user'],
      execute: ['root', 'user', 'guest'],
    });
  });

  it('writes track the owner tier', () => {
    expect(defaultDirectoryPermissions('guest').write).toEqual(['root', 'guest']);
  });

  it('collapses a root owner to a single root write entry', () => {
    expect(defaultDirectoryPermissions('root').write).toEqual(['root']);
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
