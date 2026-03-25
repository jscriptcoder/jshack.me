import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { PermissionResult } from '../filesystem/types';
import { createGrepCommand } from './grep';

// --- Factory Functions ---

const mkFile = (name: string, content: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root'],
  },
  content,
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

type GrepContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly rootNode: FileNode;
};

const createMockContext = (config: GrepContextConfig) => {
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

describe('grep command', () => {
  describe('single file search', () => {
    const rootNode = mkDir('/', {
      etc: mkDir('etc', {
        passwd: mkFile(
          'passwd',
          'root:x:0:0:root:/root:/bin/bash\nguest:x:1000:1000:guest:/home/guest:/bin/bash\nadmin:x:1001:1001:admin:/home/admin:/bin/bash',
        ),
      }),
    });

    it('should return lines matching the pattern', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/etc/passwd') as string;

      expect(result).toContain('root:x:0:0:root:/root:/bin/bash');
    });

    it('should return multiple matching lines', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('guest', '/etc/passwd') as string;

      expect(result).toBe('guest:x:1000:1000:guest:/home/guest:/bin/bash');
    });

    it('should be case-insensitive', () => {
      const root = mkDir('/', {
        'config.txt': mkFile('config.txt', 'Password=secret\npassword=other\nPASSWORD=third'),
      });
      const context = createMockContext({ rootNode: root });
      const grep = createGrepCommand(context);
      const result = grep.fn('password', '/config.txt') as string;
      const lines = result.split('\n');

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('Password=secret');
      expect(lines[1]).toBe('password=other');
      expect(lines[2]).toBe('PASSWORD=third');
    });

    it('should return empty string when no lines match', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('nonexistent', '/etc/passwd');

      expect(result).toBe('');
    });

    it('should handle file with no content', () => {
      const root = mkDir('/', {
        'empty.txt': mkFile('empty.txt', ''),
      });
      const context = createMockContext({ rootNode: root });
      const grep = createGrepCommand(context);
      const result = grep.fn('something', '/empty.txt');

      expect(result).toBe('');
    });
  });

  describe('recursive directory search', () => {
    const rootNode = mkDir('/', {
      etc: mkDir('etc', {
        passwd: mkFile('passwd', 'root:x:0:0:root:/root\nguest:x:1000:1000:guest:/home/guest'),
        hosts: mkFile('hosts', '127.0.0.1 localhost\n192.168.1.1 router'),
      }),
      home: mkDir('home', {
        user: mkDir('user', {
          'notes.txt': mkFile('notes.txt', 'the root password is secret123'),
          'readme.txt': mkFile('readme.txt', 'nothing interesting here'),
        }),
      }),
    });

    it('should search all files recursively with filepath prefix', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/') as string;

      expect(result).toContain('/etc/passwd:root:x:0:0:root:/root');
      expect(result).toContain('/home/user/notes.txt:the root password is secret123');
    });

    it('should not include non-matching files', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/') as string;

      expect(result).not.toContain('hosts');
      expect(result).not.toContain('readme.txt');
    });

    it('should search from a subdirectory', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('guest', '/etc') as string;

      expect(result).toBe('/etc/passwd:guest:x:1000:1000:guest:/home/guest');
    });

    it('should resolve "." to cwd', () => {
      const context = createMockContext({ rootNode, currentPath: '/home/user' });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '.') as string;

      expect(result).toBe('/home/user/notes.txt:the root password is secret123');
    });

    it('should return empty string when no files match in directory', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('zzzzz', '/');

      expect(result).toBe('');
    });

    it('should sort results by filepath', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/') as string;
      const lines = result.split('\n');

      // /etc/passwd comes before /home/user/notes.txt alphabetically
      expect(lines[0]).toContain('/etc/passwd:');
      expect(lines[1]).toContain('/home/user/notes.txt:');
    });
  });

  describe('-l flag (filenames only)', () => {
    const rootNode = mkDir('/', {
      etc: mkDir('etc', {
        passwd: mkFile('passwd', 'root:x:0:0\nguest:x:1000:1000'),
        hosts: mkFile('hosts', '127.0.0.1 localhost'),
      }),
      home: mkDir('home', {
        'notes.txt': mkFile('notes.txt', 'root password is secret'),
      }),
    });

    it('should return only filenames when -l flag is used on directory', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/', '-l') as string;
      const lines = result.split('\n');

      expect(lines).toContain('/etc/passwd');
      expect(lines).toContain('/home/notes.txt');
      expect(result).not.toContain(':root');
      expect(result).not.toContain(':x:');
    });

    it('should deduplicate filenames when file has multiple matches', () => {
      const root = mkDir('/', {
        'multi.txt': mkFile('multi.txt', 'line one match\nno match\nline two match'),
      });
      const context = createMockContext({ rootNode: root });
      const grep = createGrepCommand(context);
      const result = grep.fn('match', '/', '-l') as string;

      expect(result).toBe('/multi.txt');
    });

    it('should return filename for single file with -l', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('root', '/etc/passwd', '-l') as string;

      expect(result).toBe('/etc/passwd');
    });

    it('should return empty string with -l when no matches', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('zzzzz', '/', '-l');

      expect(result).toBe('');
    });
  });

  describe('binary files and permissions', () => {
    const ELF_STUB =
      '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00>\x00\x01\x00\x00\x00';

    it('should skip binary files (ELF stub)', () => {
      const rootNode = mkDir('/', {
        binary: mkFile('binary', ELF_STUB + 'password=secret'),
        'text.txt': mkFile('text.txt', 'password=visible'),
      });
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('password', '/') as string;

      expect(result).toContain('/text.txt:');
      expect(result).not.toContain('binary');
    });

    it('should skip binary files in single-file mode too', () => {
      const rootNode = mkDir('/', {
        binary: mkFile('binary', ELF_STUB + 'password=secret'),
      });
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);
      const result = grep.fn('password', '/binary');

      expect(result).toBe('');
    });

    it('should silently skip untraversable directories', () => {
      const rootNode = mkDir('/', {
        public: mkDir('public', {
          'file.txt': mkFile('file.txt', 'secret data here'),
        }),
        restricted: mkDir(
          'restricted',
          {
            'hidden.txt': mkFile('hidden.txt', 'secret hidden data'),
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

      const grep = createGrepCommand(context);
      const result = grep.fn('secret', '/') as string;

      expect(result).toContain('/public/file.txt:');
      expect(result).not.toContain('hidden');
    });

    it('should skip unreadable directories', () => {
      const rootNode = mkDir('/', {
        readable: mkDir('readable', {
          'file.txt': mkFile('file.txt', 'find me'),
        }),
        unreadable: mkDir(
          'unreadable',
          {
            'hidden.txt': mkFile('hidden.txt', 'find me too'),
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
      const grep = createGrepCommand(context);
      const result = grep.fn('find', '/') as string;

      expect(result).toContain('/readable/file.txt:');
      expect(result).not.toContain('hidden');
    });

    it('should allow root to read any file', () => {
      const rootNode = mkDir('/', {
        'private.txt': mkFile('private.txt', 'secret data', {
          permissions: {
            read: ['root'],
            write: ['root'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockContext({ rootNode, userType: 'root' });
      const grep = createGrepCommand(context);
      const result = grep.fn('secret', '/') as string;

      expect(result).toContain('/private.txt:secret data');
    });

    it('should skip unreadable files', () => {
      const rootNode = mkDir('/', {
        'public.txt': mkFile('public.txt', 'secret in public'),
        'private.txt': mkFile('private.txt', 'secret in private', {
          permissions: {
            read: ['root'],
            write: ['root'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockContext({ rootNode, userType: 'guest' });
      const grep = createGrepCommand(context);
      const result = grep.fn('secret', '/') as string;

      expect(result).toContain('/public.txt:');
      expect(result).not.toContain('private');
    });
  });

  describe('input validation', () => {
    const rootNode = mkDir('/', {});

    it('should throw error when no arguments provided', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);

      expect(() => grep.fn()).toThrow('grep: usage: grep(pattern, path, ["-l"])');
    });

    it('should throw error when only pattern provided', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);

      expect(() => grep.fn('pattern')).toThrow('grep: usage: grep(pattern, path, ["-l"])');
    });

    it('should throw error for non-existent path', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);

      expect(() => grep.fn('pattern', '/nonexistent')).toThrow(
        "grep: '/nonexistent': No such file or directory",
      );
    });

    it('should ignore non-string arguments', () => {
      const context = createMockContext({ rootNode });
      const grep = createGrepCommand(context);

      expect(() => grep.fn(123, true)).toThrow('grep: usage: grep(pattern, path, ["-l"])');
    });
  });
});
