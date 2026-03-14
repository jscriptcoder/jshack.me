import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createLsCommand } from './ls';

// --- Factory Functions ---

const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test',
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  ...overrides,
});

const getMockFile = (overrides?: Partial<FileNode>): FileNode =>
  getMockFileNode({
    name: 'file.txt',
    type: 'file',
    content: 'test content',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    },
    ...overrides,
  });

const getMockDirectory = (
  name: string,
  children: Record<string, FileNode>,
  overrides?: Partial<FileNode>,
): FileNode =>
  getMockFileNode({
    name,
    type: 'directory',
    children,
    ...overrides,
  });

type FileSystemContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly homePath?: string;
  readonly fileSystem?: Record<string, FileNode | null>;
};

const createMockFileSystemContext = (config: FileSystemContextConfig = {}) => {
  const {
    currentPath = '/',
    userType = 'user',
    homePath = '/home/jshacker',
    fileSystem = {},
  } = config;

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

  return {
    getCurrentPath: () => currentPath,
    resolvePath,
    getNode: (path: string) => fileSystem[path] ?? null,
    getUserType: () => userType,
    getHomePath: () => homePath,
    setCurrentPath: vi.fn(),
    canTraverse: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('ls command', () => {
  describe('basic listing', () => {
    it('should list current directory when no path given', () => {
      const homeDir = getMockDirectory('home', {
        'file1.txt': getMockFile({ name: 'file1.txt' }),
        'file2.txt': getMockFile({ name: 'file2.txt' }),
      });

      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/home': homeDir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('file1.txt  file2.txt');
    });

    it('should list specified path', () => {
      const etcDir = getMockDirectory('etc', {
        passwd: getMockFile({ name: 'passwd' }),
        hosts: getMockFile({ name: 'hosts' }),
      });

      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/etc': etcDir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/etc');

      expect(result).toBe('hosts  passwd');
    });

    it('should mark directories with trailing slash', () => {
      const homeDir = getMockDirectory('home', {
        documents: getMockDirectory('documents', {}),
        'file.txt': getMockFile({ name: 'file.txt' }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/home': homeDir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home');

      expect(result).toBe('documents/  file.txt');
    });

    it('should sort entries alphabetically', () => {
      const dir = getMockDirectory('test', {
        'zebra.txt': getMockFile({ name: 'zebra.txt' }),
        'alpha.txt': getMockFile({ name: 'alpha.txt' }),
        'middle.txt': getMockFile({ name: 'middle.txt' }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/test': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/test');

      expect(result).toBe('alpha.txt  middle.txt  zebra.txt');
    });

    it('should return empty string for empty directory', () => {
      const emptyDir = getMockDirectory('empty', {});

      const context = createMockFileSystemContext({
        fileSystem: { '/empty': emptyDir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/empty');

      expect(result).toBe('');
    });

    it('should return filename when path is a file', () => {
      const file = getMockFile({ name: 'myfile.txt' });

      const context = createMockFileSystemContext({
        fileSystem: { '/myfile.txt': file },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/myfile.txt');

      expect(result).toBe('myfile.txt');
    });
  });

  describe('hidden files', () => {
    const dirWithHidden = getMockDirectory('home', {
      '.bashrc': getMockFile({ name: '.bashrc' }),
      '.profile': getMockFile({ name: '.profile' }),
      'visible.txt': getMockFile({ name: 'visible.txt' }),
    });

    it('should hide files starting with dot by default', () => {
      const context = createMockFileSystemContext({
        fileSystem: { '/home': dirWithHidden },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home');

      expect(result).toBe('visible.txt');
      expect(result).not.toContain('.bashrc');
      expect(result).not.toContain('.profile');
    });

    it('should show hidden files with -a option', () => {
      const context = createMockFileSystemContext({
        fileSystem: { '/home': dirWithHidden },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home', '-a');

      expect(result).toContain('.bashrc');
      expect(result).toContain('.profile');
      expect(result).toContain('visible.txt');
    });

    it('should accept -a option before path', () => {
      const context = createMockFileSystemContext({
        fileSystem: { '/home': dirWithHidden },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('-a', '/home');

      expect(result).toContain('.bashrc');
    });

    it('should accept -a option without path', () => {
      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/home': dirWithHidden },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('-a');

      expect(result).toContain('.bashrc');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent path', () => {
      const context = createMockFileSystemContext({
        fileSystem: {},
      });

      const ls = createLsCommand(context);

      expect(() => ls.fn('/nonexistent')).toThrow(
        "ls: cannot access '/nonexistent': No such file or directory",
      );
    });

    it('should throw error when permission denied', () => {
      const restrictedDir = getMockDirectory(
        'root',
        {},
        {
          permissions: {
            read: ['root'],
            write: ['root'],
            execute: ['root'],
          },
        },
      );

      const context = createMockFileSystemContext({
        userType: 'guest',
        fileSystem: { '/root': restrictedDir },
      });

      const ls = createLsCommand(context);

      expect(() => ls.fn('/root')).toThrow("ls: cannot open directory '/root': Permission denied");
    });

    it('should allow root to list any directory', () => {
      const restrictedDir = getMockDirectory(
        'secret',
        {
          'secret.txt': getMockFile({ name: 'secret.txt' }),
        },
        {
          permissions: {
            read: ['root'],
            write: ['root'],
            execute: ['root'],
          },
        },
      );

      const context = createMockFileSystemContext({
        userType: 'root',
        fileSystem: { '/secret': restrictedDir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/secret');

      expect(result).toBe('secret.txt');
    });
  });

  describe('long listing (-l flag)', () => {
    it('should show permission string, owner, and name for each entry', () => {
      const dir = getMockDirectory('home', {
        'notes.txt': getMockFile({
          name: 'notes.txt',
          owner: 'user',
          permissions: {
            read: ['root', 'user'],
            write: ['root', 'user'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/home': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home', '-l');

      expect(result).toBe('-rw-rw----  user   notes.txt');
    });

    it('should show directory type character and trailing slash', () => {
      const dir = getMockDirectory('root', {
        documents: getMockDirectory(
          'documents',
          {},
          {
            owner: 'user',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user'],
              execute: ['root', 'user', 'guest'],
            },
          },
        ),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/root': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/root', '-l');

      expect(result).toBe('drwxrwxr-x  user   documents/');
    });

    it('should show rwx for root-owned files (root always has full access)', () => {
      const dir = getMockDirectory('etc', {
        passwd: getMockFile({
          name: 'passwd',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/etc': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/etc', '-l');

      expect(result).toBe('-rwxr--r--  root   passwd');
    });

    it('should list multiple entries sorted alphabetically', () => {
      const dir = getMockDirectory('home', {
        'zebra.txt': getMockFile({
          name: 'zebra.txt',
          owner: 'user',
          permissions: {
            read: ['root', 'user'],
            write: ['root', 'user'],
            execute: ['root'],
          },
        }),
        bin: getMockDirectory(
          'bin',
          {},
          {
            owner: 'root',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root', 'user', 'guest'],
            },
          },
        ),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/home': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home', '-l') as string;

      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('drwxr-xr-x  root   bin/');
      expect(lines[1]).toBe('-rw-rw----  user   zebra.txt');
    });

    it('should combine -l and -a flags', () => {
      const dir = getMockDirectory('home', {
        '.bashrc': getMockFile({
          name: '.bashrc',
          owner: 'user',
          permissions: {
            read: ['root', 'user'],
            write: ['root', 'user'],
            execute: ['root'],
          },
        }),
        'visible.txt': getMockFile({
          name: 'visible.txt',
          owner: 'user',
          permissions: {
            read: ['root', 'user'],
            write: ['root', 'user'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/home': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home', '-la') as string;

      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('.bashrc');
      expect(lines[1]).toContain('visible.txt');
    });

    it('should handle -l with -a as separate arguments', () => {
      const dir = getMockDirectory('home', {
        '.hidden': getMockFile({ name: '.hidden', owner: 'user' }),
        'visible.txt': getMockFile({ name: 'visible.txt', owner: 'user' }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/home': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/home', '-l', '-a');

      expect(result).toContain('.hidden');
      expect(result).toContain('visible.txt');
    });

    it('should show guest-owned file permissions correctly', () => {
      const dir = getMockDirectory('tmp', {
        'upload.txt': getMockFile({
          name: 'upload.txt',
          owner: 'guest',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root', 'guest'],
            execute: ['root'],
          },
        }),
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/tmp': dir },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('/tmp', '-l');

      expect(result).toBe('-rw-r--rw-  guest  upload.txt');
    });

    it('should show long format for a single file path', () => {
      const file = getMockFile({
        name: 'myfile.txt',
        owner: 'user',
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root', 'user'],
          execute: ['root'],
        },
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/myfile.txt': file },
      });

      const ls = createLsCommand(context);
      const result = ls.fn('-l', '/myfile.txt');

      expect(result).toBe('-rw-rw-r--  user   myfile.txt');
    });
  });
});
