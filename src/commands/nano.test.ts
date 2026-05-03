import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/types';
import { createNanoCommand } from './nano';

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

const getMockDirectory = (name: string, overrides?: Partial<FileNode>): FileNode =>
  getMockFileNode({
    name,
    type: 'directory',
    children: {},
    ...overrides,
  });

type MockContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly fileSystem?: Record<string, FileNode | null>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const { currentPath = '/', userType = 'user', fileSystem = {} } = config;

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return path;
    return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
  };

  return {
    resolvePath,
    getNode: (path: string) => fileSystem[path] ?? null,
    getUserType: () => userType,
    canTraverse: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('nano command', () => {
  describe('opening existing files', () => {
    it('should return nano_open for an existing file', () => {
      const file = getMockFile({ name: 'readme.txt' });
      const context = createMockContext({
        fileSystem: { '/readme.txt': file },
      });

      const nano = createNanoCommand(context);
      const result = nano.fn('/readme.txt');

      expect(result).toEqual({ __type: 'nano_open', filePath: '/readme.txt' });
    });

    it('should resolve relative paths', () => {
      const file = getMockFile({ name: 'file.js' });
      const context = createMockContext({
        currentPath: '/home/user',
        fileSystem: { '/home/user/file.js': file },
      });

      const nano = createNanoCommand(context);
      const result = nano.fn('file.js');

      expect(result).toEqual({ __type: 'nano_open', filePath: '/home/user/file.js' });
    });

    it('should allow root to open any file', () => {
      const restrictedFile = getMockFile({
        name: 'secret.txt',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockContext({
        userType: 'root',
        fileSystem: { '/secret.txt': restrictedFile },
      });

      const nano = createNanoCommand(context);
      const result = nano.fn('/secret.txt');

      expect(result).toEqual({ __type: 'nano_open', filePath: '/secret.txt' });
    });
  });

  describe('opening new files', () => {
    it('should return nano_open for a non-existent file in writable directory', () => {
      const parentDir = getMockDirectory('tmp', {
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root', 'user', 'guest'],
          execute: ['root', 'user', 'guest'],
        },
      });
      const context = createMockContext({
        fileSystem: { '/tmp': parentDir },
      });

      const nano = createNanoCommand(context);
      const result = nano.fn('/tmp/newfile.txt');

      expect(result).toEqual({ __type: 'nano_open', filePath: '/tmp/newfile.txt' });
    });

    it('should throw permission denied for new file in unwritable directory', () => {
      const parentDir = getMockDirectory('etc', {
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root'],
          execute: ['root', 'user', 'guest'],
        },
      });
      const context = createMockContext({
        userType: 'user',
        fileSystem: { '/etc': parentDir },
      });

      const nano = createNanoCommand(context);

      expect(() => nano.fn('/etc/newfile.conf')).toThrow(
        'nano: /etc/newfile.conf: Permission denied',
      );
    });

    it('should throw error for new file in nonexistent directory', () => {
      const context = createMockContext({
        fileSystem: {},
      });

      const nano = createNanoCommand(context);

      expect(() => nano.fn('/nonexistent/file.txt')).toThrow(
        'nano: /nonexistent/file.txt: No such directory',
      );
    });
  });

  describe('error handling', () => {
    it('should throw error when no path given', () => {
      const context = createMockContext();
      const nano = createNanoCommand(context);

      expect(() => nano.fn()).toThrow('nano: missing file operand');
    });

    it('should throw error when path is a directory', () => {
      const dir = getMockDirectory('mydir');
      const context = createMockContext({
        fileSystem: { '/mydir': dir },
      });

      const nano = createNanoCommand(context);

      expect(() => nano.fn('/mydir')).toThrow('nano: /mydir: Is a directory');
    });

    it('should throw permission denied for unreadable file', () => {
      const restrictedFile = getMockFile({
        name: 'secret.txt',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockContext({
        userType: 'guest',
        fileSystem: { '/secret.txt': restrictedFile },
      });

      const nano = createNanoCommand(context);

      expect(() => nano.fn('/secret.txt')).toThrow('nano: /secret.txt: Permission denied');
    });
  });
});
