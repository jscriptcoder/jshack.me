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
});
