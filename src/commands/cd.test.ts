import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createCdCommand } from './cd';

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

describe('cd command', () => {
  describe('basic navigation', () => {
    it('should change to specified directory', () => {
      const etcDir = getMockDirectory('etc', {});

      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/etc': etcDir },
      });

      const cd = createCdCommand(context);
      cd.fn('/etc');

      expect(context.setCurrentPath).toHaveBeenCalledWith('/etc');
    });

    it('should change to home directory when no path given', () => {
      const homeDir = getMockDirectory('jshacker', {});

      const context = createMockFileSystemContext({
        currentPath: '/etc',
        homePath: '/home/jshacker',
        fileSystem: { '/home/jshacker': homeDir },
      });

      const cd = createCdCommand(context);
      cd.fn();

      expect(context.setCurrentPath).toHaveBeenCalledWith('/home/jshacker');
    });

    it('should return undefined (no output)', () => {
      const homeDir = getMockDirectory('home', {});

      const context = createMockFileSystemContext({
        fileSystem: { '/home': homeDir },
      });

      const cd = createCdCommand(context);
      const result = cd.fn('/home');

      expect(result).toBeUndefined();
    });

    it('should resolve relative paths', () => {
      const subDir = getMockDirectory('subdir', {});

      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/home/subdir': subDir },
      });

      const cd = createCdCommand(context);
      cd.fn('subdir');

      expect(context.setCurrentPath).toHaveBeenCalledWith('/home/subdir');
    });

    it('should resolve parent directory with ..', () => {
      const homeDir = getMockDirectory('home', {});

      const context = createMockFileSystemContext({
        currentPath: '/home/jshacker',
        fileSystem: { '/home': homeDir },
      });

      const cd = createCdCommand(context);
      cd.fn('..');

      expect(context.setCurrentPath).toHaveBeenCalledWith('/home');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent path', () => {
      const context = createMockFileSystemContext({
        fileSystem: {},
      });

      const cd = createCdCommand(context);

      expect(() => cd.fn('/nonexistent')).toThrow('cd: /nonexistent: No such file or directory');
    });

    it('should throw error when path is a file', () => {
      const file = getMockFile({ name: 'file.txt' });

      const context = createMockFileSystemContext({
        fileSystem: { '/file.txt': file },
      });

      const cd = createCdCommand(context);

      expect(() => cd.fn('/file.txt')).toThrow('cd: /file.txt: Not a directory');
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

      const cd = createCdCommand(context);

      expect(() => cd.fn('/root')).toThrow('cd: /root: Permission denied');
    });

    it('should allow root to access any directory', () => {
      const restrictedDir = getMockDirectory(
        'secret',
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
        userType: 'root',
        fileSystem: { '/secret': restrictedDir },
      });

      const cd = createCdCommand(context);
      cd.fn('/secret');

      expect(context.setCurrentPath).toHaveBeenCalledWith('/secret');
    });

    it('should not change directory on error', () => {
      const context = createMockFileSystemContext({
        fileSystem: {},
      });

      const cd = createCdCommand(context);

      expect(() => cd.fn('/nonexistent')).toThrow();
      expect(context.setCurrentPath).not.toHaveBeenCalled();
    });
  });
});
