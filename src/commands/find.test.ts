import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { PermissionResult } from '../filesystem/types';
import { createFindCommand } from './find';

// --- Factory Functions ---

const mkFile = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root'],
  },
  content: 'test content',
  ...overrides,
});

const mkDir = (
  name: string,
  children: Record<string, FileNode>,
  overrides?: Partial<FileNode>,
): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
  ...overrides,
});

type FindContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly rootNode: FileNode;
};

const createMockContext = (config: FindContextConfig) => {
  const { currentPath = '/', userType = 'root', rootNode } = config;

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return path;
    if (path === '.') return currentPath;
    if (path === '..') {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/');
    }
    return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
  };

  const getNode = (path: string): FileNode | null => {
    if (path === '/') return rootNode;
    const parts = path.split('/').filter(Boolean);
    let current: FileNode = rootNode;
    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) return null;
      const next = current.children[part];
      if (!next) return null;
      current = next;
    }
    return current;
  };

  return {
    getCurrentPath: () => currentPath,
    resolvePath,
    getNode,
    getUserType: () => userType as UserType,
    canTraverse: () => ({ allowed: true }) as PermissionResult,
  };
};

// --- Tests ---

describe('find command', () => {
  describe('pattern matching with glob', () => {
    const rootNode = mkDir('/', {
      home: mkDir('home', {
        user: mkDir('user', {
          'notes.txt': mkFile('notes.txt'),
          'readme.txt': mkFile('readme.txt'),
          'script.sh': mkFile('script.sh'),
        }),
      }),
      etc: mkDir('etc', {
        'hosts.txt': mkFile('hosts.txt'),
        passwd: mkFile('passwd'),
      }),
    });

    it('should find files matching a glob pattern recursively', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.txt') as string;

      expect(result).toContain('/home/user/notes.txt');
      expect(result).toContain('/home/user/readme.txt');
      expect(result).toContain('/etc/hosts.txt');
      expect(result).not.toContain('script.sh');
      expect(result).not.toContain('passwd');
    });

    it('should find files by exact name', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', 'passwd') as string;

      expect(result).toBe('/etc/passwd');
    });

    it('should support ? wildcard for single character', () => {
      const root = mkDir('/', {
        'a1.log': mkFile('a1.log'),
        'a2.log': mkFile('a2.log'),
        'ab.log': mkFile('ab.log'),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);
      const result = find.fn('/', 'a?.log') as string;

      expect(result).toContain('/a1.log');
      expect(result).toContain('/a2.log');
      expect(result).toContain('/ab.log');
    });

    it('should show directories with trailing /', () => {
      const root = mkDir('/', {
        home: mkDir('home', {
          docs: mkDir('docs', {}),
        }),
        'docs.txt': mkFile('docs.txt'),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);
      const result = find.fn('/', 'docs*') as string;

      expect(result).toContain('/home/docs/');
      expect(result).toContain('/docs.txt');
    });

    it('should search from a subdirectory', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/home', '*.txt') as string;

      expect(result).toContain('/home/user/notes.txt');
      expect(result).toContain('/home/user/readme.txt');
      expect(result).not.toContain('/etc/hosts.txt');
    });

    it('should use cwd when path is "."', () => {
      const context = createMockContext({ rootNode, currentPath: '/home/user' });
      const find = createFindCommand(context);
      const result = find.fn('.', '*.sh') as string;

      expect(result).toBe('/home/user/script.sh');
    });

    it('should return empty string when no matches found', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.xyz');

      expect(result).toBe('');
    });

    it('should sort results alphabetically', () => {
      const root = mkDir('/', {
        'zebra.txt': mkFile('zebra.txt'),
        'alpha.txt': mkFile('alpha.txt'),
        'middle.txt': mkFile('middle.txt'),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.txt') as string;
      const lines = result.split('\n');

      expect(lines[0]).toBe('/alpha.txt');
      expect(lines[1]).toBe('/middle.txt');
      expect(lines[2]).toBe('/zebra.txt');
    });

    it('should match hidden files', () => {
      const root = mkDir('/', {
        '.bashrc': mkFile('.bashrc'),
        '.profile': mkFile('.profile'),
        'visible.txt': mkFile('visible.txt'),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);
      const result = find.fn('/', '.*') as string;

      expect(result).toContain('/.bashrc');
      expect(result).toContain('/.profile');
      expect(result).not.toContain('visible.txt');
    });
  });

  describe('user filter (3rd arg)', () => {
    const rootNode = mkDir('/', {
      home: mkDir('home', {
        'root-file.key': mkFile('root-file.key', { owner: 'root' }),
        'user-file.key': mkFile('user-file.key', { owner: 'user' }),
        'guest-file.key': mkFile('guest-file.key', { owner: 'guest' }),
        'root-doc.txt': mkFile('root-doc.txt', { owner: 'root' }),
      }),
    });

    it('should filter results by owner when user arg is provided', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.key', 'root') as string;

      expect(result).toContain('/home/root-file.key');
      expect(result).not.toContain('user-file.key');
      expect(result).not.toContain('guest-file.key');
    });

    it('should combine pattern and user filter', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*', 'root') as string;

      expect(result).toContain('/home/root-file.key');
      expect(result).toContain('/home/root-doc.txt');
      expect(result).not.toContain('user-file.key');
      expect(result).not.toContain('guest-file.key');
    });

    it('should return empty when no files match user filter', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.key', 'guest') as string;

      expect(result).toBe('/home/guest-file.key');
    });

    it('should work without user filter (all owners)', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.key') as string;

      expect(result).toContain('/home/root-file.key');
      expect(result).toContain('/home/user-file.key');
      expect(result).toContain('/home/guest-file.key');
    });

    it('should filter directories by owner too', () => {
      const root = mkDir('/', {
        'user-dir': mkDir('user-dir', {}, { owner: 'user' }),
        'root-dir': mkDir('root-dir', {}, { owner: 'root' }),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);
      const result = find.fn('/', '*-dir', 'user') as string;

      expect(result).toBe('/user-dir/');
      expect(result).not.toContain('root-dir');
    });
  });

  describe('input validation', () => {
    const rootNode = mkDir('/', {
      home: mkDir('home', {}),
    });

    it('should throw error when no arguments provided', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);

      expect(() => find.fn()).toThrow(/find:.*usage/i);
    });

    it('should throw error when only path provided (missing pattern)', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);

      expect(() => find.fn('/')).toThrow(/find:.*usage/i);
    });

    it('should throw error for non-existent path', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);

      expect(() => find.fn('/nonexistent', '*.txt')).toThrow(
        "find: '/nonexistent': No such file or directory",
      );
    });

    it('should throw error when path is a file', () => {
      const root = mkDir('/', {
        'file.txt': mkFile('file.txt'),
      });
      const context = createMockContext({ rootNode: root });
      const find = createFindCommand(context);

      expect(() => find.fn('/file.txt', '*.txt')).toThrow("find: '/file.txt': Not a directory");
    });

    it('should ignore non-string arguments', () => {
      const context = createMockContext({ rootNode });
      const find = createFindCommand(context);

      expect(() => find.fn(123, true)).toThrow(/find:.*usage/i);
    });
  });

  describe('permissions', () => {
    it('should silently skip directories without traverse permission', () => {
      const rootNode = mkDir('/', {
        public: mkDir('public', {
          'visible.txt': mkFile('visible.txt'),
        }),
        restricted: mkDir(
          'restricted',
          {
            'secret.txt': mkFile('secret.txt'),
          },
          {
            owner: 'root',
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          },
        ),
      });

      const canTraverse = (path: string) => ({
        allowed: !path.startsWith('/restricted'),
      });

      const context = {
        getCurrentPath: () => '/',
        resolvePath: (p: string) => p,
        getNode: (path: string): FileNode | null => {
          if (path === '/') return rootNode;
          const parts = path.split('/').filter(Boolean);
          let current: FileNode = rootNode;
          for (const part of parts) {
            if (current.type !== 'directory' || !current.children) return null;
            const next = current.children[part];
            if (!next) return null;
            current = next;
          }
          return current;
        },
        getUserType: () => 'guest' as UserType,
        canTraverse,
      };

      const find = createFindCommand(context);
      const result = find.fn('/', '*.txt') as string;

      expect(result).toContain('/public/visible.txt');
      expect(result).not.toContain('secret.txt');
    });

    it('should skip directories without read permission', () => {
      const rootNode = mkDir('/', {
        readable: mkDir('readable', {
          'found.txt': mkFile('found.txt'),
        }),
        unreadable: mkDir(
          'unreadable',
          {
            'hidden.txt': mkFile('hidden.txt'),
          },
          {
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root', 'user', 'guest'],
            },
          },
        ),
      });

      const context = createMockContext({ rootNode, userType: 'guest' });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.txt') as string;

      expect(result).toContain('/readable/found.txt');
      expect(result).not.toContain('hidden.txt');
    });

    it('should allow root to search any directory', () => {
      const rootNode = mkDir('/', {
        restricted: mkDir(
          'restricted',
          {
            'secret.txt': mkFile('secret.txt'),
          },
          {
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          },
        ),
      });

      const context = createMockContext({ rootNode, userType: 'root' });
      const find = createFindCommand(context);
      const result = find.fn('/', '*.txt') as string;

      expect(result).toBe('/restricted/secret.txt');
    });
  });
});
