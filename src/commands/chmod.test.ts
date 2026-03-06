import { describe, it, expect, vi } from 'vitest';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createChmodCommand } from './chmod';

const makeMockNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'test',
  ...overrides,
});

const createMockContext = (config: {
  readonly userType?: UserType;
  readonly fileSystem?: Record<string, FileNode | null>;
  readonly currentPath?: string;
}) => {
  const { userType = 'root', fileSystem = {}, currentPath = '/' } = config;
  const lastPermissions = { path: '', permissions: null as FilePermissions | null };

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return path;
    return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
  };

  return {
    context: {
      resolvePath,
      getNode: (path: string) => fileSystem[path] ?? null,
      getUserType: () => userType,
      updatePermissions: vi.fn((path: string, permissions: FilePermissions) => {
        lastPermissions.path = path;
        lastPermissions.permissions = permissions;
        return { allowed: true };
      }),
      canTraverse: () => ({ allowed: true }),
    },
    lastPermissions,
  };
};

describe('chmod command', () => {
  describe('adding permissions', () => {
    it('should add execute for guest with o+x', () => {
      const node = makeMockNode();
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('o+x', '/test.txt');

      expect(lastPermissions.permissions?.execute).toContain('guest');
    });

    it('should add read and execute for all with a+rx', () => {
      const node = makeMockNode({
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('a+rx', '/test.txt');

      expect(lastPermissions.permissions?.read).toEqual(
        expect.arrayContaining(['root', 'user', 'guest']),
      );
      expect(lastPermissions.permissions?.execute).toEqual(
        expect.arrayContaining(['root', 'user', 'guest']),
      );
    });

    it('should add write for owner with u+w', () => {
      const node = makeMockNode({
        owner: 'user',
        permissions: {
          read: ['root', 'user'],
          write: ['root'],
          execute: ['root'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('u+w', '/test.txt');

      expect(lastPermissions.permissions?.write).toContain('user');
    });

    it('should handle combined who characters like go+r', () => {
      const node = makeMockNode({
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('go+r', '/test.txt');

      expect(lastPermissions.permissions?.read).toContain('user');
      expect(lastPermissions.permissions?.read).toContain('guest');
    });
  });

  describe('removing permissions', () => {
    it('should remove write for owner with u-w', () => {
      const node = makeMockNode({
        owner: 'user',
        permissions: {
          read: ['root', 'user'],
          write: ['root', 'user'],
          execute: ['root'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('u-w', '/test.txt');

      expect(lastPermissions.permissions?.write).not.toContain('user');
      expect(lastPermissions.permissions?.write).toContain('root');
    });

    it('should never remove root from any permission', () => {
      const node = makeMockNode({
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root', 'user'],
          execute: ['root', 'user', 'guest'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('a-rwx', '/test.txt');

      expect(lastPermissions.permissions?.read).toContain('root');
      expect(lastPermissions.permissions?.write).toContain('root');
      expect(lastPermissions.permissions?.execute).toContain('root');
      expect(lastPermissions.permissions?.read).not.toContain('user');
      expect(lastPermissions.permissions?.read).not.toContain('guest');
    });
  });

  describe('permission checks', () => {
    it('should allow root to chmod any file', () => {
      const node = makeMockNode({ owner: 'guest' });
      const { context } = createMockContext({
        userType: 'root',
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      expect(() => chmod.fn('o+x', '/test.txt')).not.toThrow();
    });

    it('should allow owner to chmod their own file', () => {
      const node = makeMockNode({ owner: 'user' });
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      expect(() => chmod.fn('o+x', '/test.txt')).not.toThrow();
    });

    it('should reject non-owner non-root chmod', () => {
      const node = makeMockNode({ owner: 'user' });
      const { context } = createMockContext({
        userType: 'guest',
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      expect(() => chmod.fn('o+x', '/test.txt')).toThrow('Operation not permitted');
    });
  });

  describe('error handling', () => {
    it('should throw on missing arguments', () => {
      const { context } = createMockContext({});
      const chmod = createChmodCommand(context);

      expect(() => chmod.fn()).toThrow('missing operand');
      expect(() => chmod.fn('o+x')).toThrow('missing operand');
    });

    it('should throw on non-existent file', () => {
      const { context } = createMockContext({ fileSystem: {} });
      const chmod = createChmodCommand(context);

      expect(() => chmod.fn('o+x', '/nonexistent')).toThrow('No such file or directory');
    });

    it('should throw on invalid mode string', () => {
      const node = makeMockNode();
      const { context } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      expect(() => chmod.fn('755', '/test.txt')).toThrow('invalid mode');
      expect(() => chmod.fn('z+x', '/test.txt')).toThrow('invalid mode');
      expect(() => chmod.fn('+', '/test.txt')).toThrow('invalid mode');
    });

    it('should throw on traversal denied', () => {
      const node = makeMockNode();
      const { context } = createMockContext({
        fileSystem: { '/secret/test.txt': node },
      });
      context.canTraverse = () => ({ allowed: false, error: 'Permission denied' });

      const chmod = createChmodCommand(context);
      expect(() => chmod.fn('o+x', '/secret/test.txt')).toThrow('Permission denied');
    });
  });

  describe('implicit who defaults to all', () => {
    it('should treat bare +x as a+x', () => {
      const node = makeMockNode({
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });
      const { context, lastPermissions } = createMockContext({
        fileSystem: { '/test.txt': node },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('+x', '/test.txt');

      expect(lastPermissions.permissions?.execute).toEqual(
        expect.arrayContaining(['root', 'user', 'guest']),
      );
    });
  });
});
