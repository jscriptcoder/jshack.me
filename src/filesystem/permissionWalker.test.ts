import { describe, it, expect } from 'vitest';
import { checkPermission, canRead, canWrite, canExecute } from './permissionWalker';
import type { FilePermissions } from './types';
import type { UserType } from '../session/types';

const allOpen: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
};

const rootOnly: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: ['root'],
};

const userPermsOnly = (mode: 'read' | 'write' | 'execute'): FilePermissions => ({
  read: mode === 'read' ? ['root', 'user'] : ['root'],
  write: mode === 'write' ? ['root', 'user'] : ['root'],
  execute: mode === 'execute' ? ['root', 'user'] : ['root'],
});

const guestPermsOnly = (mode: 'read' | 'write' | 'execute'): FilePermissions => ({
  read: mode === 'read' ? ['root', 'user', 'guest'] : ['root'],
  write: mode === 'write' ? ['root', 'user', 'guest'] : ['root'],
  execute: mode === 'execute' ? ['root', 'user', 'guest'] : ['root'],
});

describe('checkPermission — root bypass', () => {
  it.each(['read', 'write', 'execute'] as const)(
    'allows root regardless of target perms (mode=%s)',
    (mode) => {
      expect(
        checkPermission({
          userType: 'root',
          mode,
          target: rootOnly,
          parentChain: [rootOnly],
        }),
      ).toEqual({ allowed: true });
    },
  );

  it('allows root through a parent chain that denies execute to others', () => {
    // Even if every parent dir is root-only, root traverses freely.
    expect(
      checkPermission({
        userType: 'root',
        mode: 'read',
        target: rootOnly,
        parentChain: [rootOnly, rootOnly, rootOnly],
      }).allowed,
    ).toBe(true);
  });

  it('allows root even when root is NOT in the target allowlist (the actual bypass)', () => {
    // Pinned: this is the only test that fails if the userType==='root'
    // bypass is removed. The other root tests use target=rootOnly where
    // 'root' is in the list anyway, so they pass without the bypass.
    // Synthetic but load-bearing — defensive against malformed FS data
    // where a node accidentally omits root from its allowlists.
    const empty: FilePermissions = {
      read: [],
      write: [],
      execute: [],
    };
    expect(
      checkPermission({
        userType: 'root',
        mode: 'read',
        target: empty,
        parentChain: [empty, empty],
      }).allowed,
    ).toBe(true);
  });

  it('allows root for write to an empty allowlist target', () => {
    const empty: FilePermissions = { read: [], write: [], execute: [] };
    expect(
      checkPermission({
        userType: 'root',
        mode: 'write',
        target: empty,
        parentChain: [],
      }).allowed,
    ).toBe(true);
  });

  it('allows root for execute to an empty allowlist target', () => {
    const empty: FilePermissions = { read: [], write: [], execute: [] };
    expect(
      checkPermission({
        userType: 'root',
        mode: 'execute',
        target: empty,
        parentChain: [],
      }).allowed,
    ).toBe(true);
  });
});

describe('checkPermission — target list dispatch', () => {
  it.each([
    ['user' as UserType, 'read' as const],
    ['user' as UserType, 'write' as const],
    ['user' as UserType, 'execute' as const],
    ['guest' as UserType, 'read' as const],
    ['guest' as UserType, 'write' as const],
    ['guest' as UserType, 'execute' as const],
  ])('allows %s when target.%s contains %s (no parents)', (userType, mode) => {
    const target: FilePermissions = {
      read: [userType],
      write: [userType],
      execute: [userType],
    };
    expect(
      checkPermission({
        userType,
        mode,
        target,
        parentChain: [],
      }).allowed,
    ).toBe(true);
  });

  it.each([
    ['user' as UserType, 'read' as const],
    ['user' as UserType, 'write' as const],
    ['user' as UserType, 'execute' as const],
    ['guest' as UserType, 'read' as const],
    ['guest' as UserType, 'write' as const],
    ['guest' as UserType, 'execute' as const],
  ])('denies %s when target.%s does NOT contain %s', (userType, mode) => {
    const result = checkPermission({
      userType,
      mode,
      target: rootOnly,
      parentChain: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('checks target.read for mode=read (not target.write)', () => {
    // Pinned: a mutant that reads target.write when mode=read would
    // allow user here (write contains user but read does not).
    const target: FilePermissions = {
      read: ['root'],
      write: ['root', 'user'],
      execute: ['root'],
    };
    expect(
      checkPermission({
        userType: 'user',
        mode: 'read',
        target,
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('checks target.write for mode=write (not target.read)', () => {
    const target: FilePermissions = {
      read: ['root', 'user'],
      write: ['root'],
      execute: ['root'],
    };
    expect(
      checkPermission({
        userType: 'user',
        mode: 'write',
        target,
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('checks target.execute for mode=execute (not target.read)', () => {
    const target: FilePermissions = {
      read: ['root', 'user'],
      write: ['root'],
      execute: ['root'],
    };
    expect(
      checkPermission({
        userType: 'user',
        mode: 'execute',
        target,
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });
});

describe('checkPermission — parent chain traversal', () => {
  it('allows access through empty parent chain', () => {
    // Filesystem-root targets have no ancestors to check.
    expect(
      checkPermission({
        userType: 'user',
        mode: 'read',
        target: userPermsOnly('read'),
        parentChain: [],
      }).allowed,
    ).toBe(true);
  });

  it('allows access when every parent grants execute', () => {
    expect(
      checkPermission({
        userType: 'user',
        mode: 'read',
        target: userPermsOnly('read'),
        parentChain: [userPermsOnly('execute'), userPermsOnly('execute')],
      }).allowed,
    ).toBe(true);
  });

  it('denies access when ANY parent lacks execute, even if target permits the mode', () => {
    // Pinned: this is the load-bearing parent-chain check. A mutant that
    // skipped the loop or only checked the immediate parent would let
    // a guest read /root/secret/file.txt as long as /root/secret/file.txt
    // itself granted read — which is the whole point of L2.
    const result = checkPermission({
      userType: 'user',
      mode: 'read',
      target: userPermsOnly('read'),
      parentChain: [
        userPermsOnly('execute'), // root grants execute
        rootOnly, // immediate parent denies → access denied
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('denies even when only the deepest parent lacks execute', () => {
    expect(
      checkPermission({
        userType: 'guest',
        mode: 'read',
        target: allOpen,
        parentChain: [allOpen, allOpen, rootOnly],
      }).allowed,
    ).toBe(false);
  });

  it('denies even when only the topmost parent lacks execute', () => {
    // Pinned: catches a mutant that walked the chain in reverse and
    // short-circuited on the immediate parent.
    expect(
      checkPermission({
        userType: 'user',
        mode: 'read',
        target: allOpen,
        parentChain: [rootOnly, allOpen, allOpen],
      }).allowed,
    ).toBe(false);
  });

  it('checks parent.execute regardless of the requested mode', () => {
    // A mutant that consulted parent.read or parent.write for traversal
    // would allow a user to traverse a parent that grants read but not
    // execute.
    const parentReadButNotExecute: FilePermissions = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    };
    const result = checkPermission({
      userType: 'user',
      mode: 'read',
      target: allOpen,
      parentChain: [parentReadButNotExecute],
    });
    expect(result.allowed).toBe(false);
  });
});

describe('checkPermission — guest semantics', () => {
  it('denies guest when target permits user but not guest', () => {
    const target: FilePermissions = {
      read: ['root', 'user'],
      write: ['root'],
      execute: ['root'],
    };
    expect(
      checkPermission({
        userType: 'guest',
        mode: 'read',
        target,
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('denies guest when a parent grants execute to user only', () => {
    const parentUserOnly: FilePermissions = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user'],
    };
    expect(
      checkPermission({
        userType: 'guest',
        mode: 'read',
        target: guestPermsOnly('read'),
        parentChain: [parentUserOnly],
      }).allowed,
    ).toBe(false);
  });
});

describe('canRead / canWrite / canExecute (mode wrappers)', () => {
  it('canRead defers to checkPermission with mode=read', () => {
    expect(
      canRead({
        userType: 'user',
        target: userPermsOnly('read'),
        parentChain: [],
      }).allowed,
    ).toBe(true);
    expect(
      canRead({
        userType: 'user',
        target: rootOnly,
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('canWrite defers to checkPermission with mode=write', () => {
    expect(
      canWrite({
        userType: 'user',
        target: userPermsOnly('write'),
        parentChain: [],
      }).allowed,
    ).toBe(true);
    expect(
      canWrite({
        userType: 'user',
        target: userPermsOnly('read'), // user is in read but not write
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('canExecute defers to checkPermission with mode=execute', () => {
    expect(
      canExecute({
        userType: 'user',
        target: userPermsOnly('execute'),
        parentChain: [],
      }).allowed,
    ).toBe(true);
    expect(
      canExecute({
        userType: 'user',
        target: userPermsOnly('read'),
        parentChain: [],
      }).allowed,
    ).toBe(false);
  });

  it('all three wrappers honor the parent chain', () => {
    const denyChain = [rootOnly];
    expect(canRead({ userType: 'user', target: allOpen, parentChain: denyChain }).allowed).toBe(
      false,
    );
    expect(canWrite({ userType: 'user', target: allOpen, parentChain: denyChain }).allowed).toBe(
      false,
    );
    expect(canExecute({ userType: 'user', target: allOpen, parentChain: denyChain }).allowed).toBe(
      false,
    );
  });
});

describe('checkPermission — error message shape', () => {
  it("includes 'Permission denied' on parent-chain denial", () => {
    const result = checkPermission({
      userType: 'guest',
      mode: 'read',
      target: allOpen,
      parentChain: [rootOnly],
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it("includes 'Permission denied' on target denial", () => {
    const result = checkPermission({
      userType: 'guest',
      mode: 'read',
      target: rootOnly,
      parentChain: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('omits error field on allow', () => {
    const result = checkPermission({
      userType: 'root',
      mode: 'read',
      target: rootOnly,
      parentChain: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
