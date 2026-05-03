import { describe, it, expect, vi } from 'vitest';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../session/types';
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

  describe('recursive mode (-R)', () => {
    const makeDir = (
      name: string,
      owner: UserType,
      children: Record<string, FileNode>,
    ): FileNode => ({
      name,
      type: 'directory',
      owner,
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', owner],
        execute: ['root', 'user', 'guest'],
      },
      children,
    });

    const makeFile = (name: string, owner: UserType): FileNode => ({
      name,
      type: 'file',
      owner,
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', owner],
        execute: ['root', 'user', 'guest'],
      },
      content: '',
    });

    // Tree: /home/jscript/ (user) -> secret.txt (user), docs/ (user) -> report.txt (user)
    const buildUserTree = (): Record<string, FileNode> => {
      const report = makeFile('report.txt', 'user');
      const docs = makeDir('docs', 'user', { 'report.txt': report });
      const secret = makeFile('secret.txt', 'user');
      const home = makeDir('jscript', 'user', { 'secret.txt': secret, docs });
      return {
        '/home/jscript': home,
        '/home/jscript/secret.txt': secret,
        '/home/jscript/docs': docs,
        '/home/jscript/docs/report.txt': report,
      };
    };

    it('applies the mode to every descendant of a directory', () => {
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: buildUserTree(),
      });

      const chmod = createChmodCommand(context);
      const result = chmod.fn('-R', 'go-rwx', '/home/jscript') as string;

      const updates = vi.mocked(context.updatePermissions).mock.calls;
      const updatedPaths = updates.map((call) => call[0]).sort();
      expect(updatedPaths).toEqual(
        [
          '/home/jscript',
          '/home/jscript/docs',
          '/home/jscript/docs/report.txt',
          '/home/jscript/secret.txt',
        ].sort(),
      );

      // Every descendant should have guest + user stripped from rwx
      updates.forEach((call) => {
        const perms = call[1];
        expect(perms.read).not.toContain('guest');
        expect(perms.read).not.toContain('user');
        expect(perms.write).not.toContain('guest');
        expect(perms.write).not.toContain('user');
        expect(perms.execute).not.toContain('guest');
        expect(perms.execute).not.toContain('user');
        // root survives because applyMode never strips root
        expect(perms.read).toContain('root');
      });

      expect(result).toBe('');
    });

    it('is a no-op on children when target is a plain file', () => {
      const file = makeFile('test.txt', 'user');
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: { '/test.txt': file },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('-R', 'o+x', '/test.txt');

      expect(vi.mocked(context.updatePermissions).mock.calls).toHaveLength(1);
      expect(vi.mocked(context.updatePermissions).mock.calls[0][0]).toBe('/test.txt');
    });

    it('accepts -R before the mode argument', () => {
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: buildUserTree(),
      });

      const chmod = createChmodCommand(context);
      chmod.fn('-R', 'go-rwx', '/home/jscript');

      expect(vi.mocked(context.updatePermissions).mock.calls).toHaveLength(4);
    });

    it('accepts -R between the mode and path', () => {
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: buildUserTree(),
      });

      const chmod = createChmodCommand(context);
      chmod.fn('go-rwx', '-R', '/home/jscript');

      expect(vi.mocked(context.updatePermissions).mock.calls).toHaveLength(4);
    });

    it('accepts -R after the path argument', () => {
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: buildUserTree(),
      });

      const chmod = createChmodCommand(context);
      chmod.fn('go-rwx', '/home/jscript', '-R');

      expect(vi.mocked(context.updatePermissions).mock.calls).toHaveLength(4);
    });

    it('skips files the caller does not own but keeps walking', () => {
      // Mixed-ownership tree: /shared (user) contains user-owned file and root-owned file
      const myFile = makeFile('mine.txt', 'user');
      const theirFile = makeFile('theirs.txt', 'root');
      const shared = makeDir('shared', 'user', { 'mine.txt': myFile, 'theirs.txt': theirFile });

      const { context } = createMockContext({
        userType: 'user',
        fileSystem: {
          '/shared': shared,
          '/shared/mine.txt': myFile,
          '/shared/theirs.txt': theirFile,
        },
      });

      const chmod = createChmodCommand(context);
      const result = chmod.fn('-R', 'go-rwx', '/shared') as string;

      const updates = vi.mocked(context.updatePermissions).mock.calls.map((call) => call[0]);
      expect(updates).toContain('/shared');
      expect(updates).toContain('/shared/mine.txt');
      // Root-owned file must NOT have been touched
      expect(updates).not.toContain('/shared/theirs.txt');

      expect(result).toContain("chmod: changing permissions of '/shared/theirs.txt'");
      expect(result).toContain('Operation not permitted');
    });

    it('returns empty string when every application succeeds', () => {
      const { context } = createMockContext({
        userType: 'root',
        fileSystem: buildUserTree(),
      });

      const chmod = createChmodCommand(context);
      const result = chmod.fn('-R', 'go-rwx', '/home/jscript') as string;

      expect(result).toBe('');
    });

    it('joins multiple error lines with newlines', () => {
      const f1 = makeFile('a.txt', 'root');
      const f2 = makeFile('b.txt', 'root');
      const dir = makeDir('locked', 'user', { 'a.txt': f1, 'b.txt': f2 });
      const { context } = createMockContext({
        userType: 'user',
        fileSystem: { '/locked': dir, '/locked/a.txt': f1, '/locked/b.txt': f2 },
      });

      const chmod = createChmodCommand(context);
      const result = chmod.fn('-R', 'go-rwx', '/locked') as string;

      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      lines.forEach((line) => expect(line).toContain('Operation not permitted'));
    });

    it('resolves symbolic u per-node when owners differ', () => {
      const rootFile = makeFile('a.txt', 'root');
      const userFile = makeFile('b.txt', 'user');
      const dir = makeDir('mixed', 'root', { 'a.txt': rootFile, 'b.txt': userFile });
      const { context } = createMockContext({
        userType: 'root',
        fileSystem: { '/mixed': dir, '/mixed/a.txt': rootFile, '/mixed/b.txt': userFile },
      });

      const chmod = createChmodCommand(context);
      chmod.fn('-R', 'u+w', '/mixed');

      // 'u' should resolve to each node's owner
      const calls = vi.mocked(context.updatePermissions).mock.calls;
      const aCall = calls.find((c) => c[0] === '/mixed/a.txt');
      const bCall = calls.find((c) => c[0] === '/mixed/b.txt');
      expect(aCall?.[1].write).toContain('root');
      expect(bCall?.[1].write).toContain('user');
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
