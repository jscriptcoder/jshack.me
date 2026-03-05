import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createCatCommand } from './cat';

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

describe('cat command', () => {
  describe('displaying file contents', () => {
    it('should display file content', () => {
      const file = getMockFile({
        name: 'readme.txt',
        content: 'Hello, World!',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/readme.txt': file },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/readme.txt');

      expect(result).toBe('Hello, World!');
    });

    it('should return empty string for file with no content', () => {
      const file = getMockFile({
        name: 'empty.txt',
        content: undefined,
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/empty.txt': file },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/empty.txt');

      expect(result).toBe('');
    });

    it('should resolve relative paths', () => {
      const file = getMockFile({
        name: 'file.txt',
        content: 'relative content',
      });

      const context = createMockFileSystemContext({
        currentPath: '/home',
        fileSystem: { '/home/file.txt': file },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('file.txt');

      expect(result).toBe('relative content');
    });

    it('should preserve multiline content', () => {
      const file = getMockFile({
        name: 'multiline.txt',
        content: 'line 1\nline 2\nline 3',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/multiline.txt': file },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/multiline.txt');

      expect(result).toBe('line 1\nline 2\nline 3');
    });
  });

  describe('error handling', () => {
    it('should throw error when no path given', () => {
      const context = createMockFileSystemContext({
        fileSystem: {},
      });

      const cat = createCatCommand(context);

      expect(() => cat.fn()).toThrow('cat: missing file operand');
    });

    it('should throw error for non-existent file', () => {
      const context = createMockFileSystemContext({
        fileSystem: {},
      });

      const cat = createCatCommand(context);

      expect(() => cat.fn('/nonexistent.txt')).toThrow(
        'cat: /nonexistent.txt: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = getMockDirectory('mydir', {});

      const context = createMockFileSystemContext({
        fileSystem: { '/mydir': dir },
      });

      const cat = createCatCommand(context);

      expect(() => cat.fn('/mydir')).toThrow('cat: /mydir: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = getMockFile({
        name: 'secret.txt',
        content: 'top secret',
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockFileSystemContext({
        userType: 'guest',
        fileSystem: { '/secret.txt': restrictedFile },
      });

      const cat = createCatCommand(context);

      expect(() => cat.fn('/secret.txt')).toThrow('cat: /secret.txt: Permission denied');
    });

    it('should allow root to read any file', () => {
      const restrictedFile = getMockFile({
        name: 'secret.txt',
        content: 'top secret data',
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockFileSystemContext({
        userType: 'root',
        fileSystem: { '/secret.txt': restrictedFile },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/secret.txt');

      expect(result).toBe('top secret data');
    });
  });

  describe('binary file output', () => {
    it('should output raw content for file with null bytes', () => {
      const binaryFile = getMockFile({
        name: 'program.bin',
        content: '\x7fELF\x00\x00\x00binary data',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/program.bin': binaryFile },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/program.bin');

      expect(result).toBe('\x7fELF\x00\x00\x00binary data');
    });

    it('should output raw content for file with control characters', () => {
      const binaryFile = getMockFile({
        name: 'data.bin',
        content: '\x01\x02\x03control chars',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/data.bin': binaryFile },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/data.bin');

      expect(result).toBe('\x01\x02\x03control chars');
    });

    it('should allow files with normal newlines and tabs', () => {
      const textFile = getMockFile({
        name: 'script.sh',
        content: '#!/bin/bash\n\techo "hello"\n',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/script.sh': textFile },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/script.sh');

      expect(result).toBe('#!/bin/bash\n\techo "hello"\n');
    });

    it('should allow files with carriage returns', () => {
      const windowsFile = getMockFile({
        name: 'windows.txt',
        content: 'line1\r\nline2\r\n',
      });

      const context = createMockFileSystemContext({
        fileSystem: { '/windows.txt': windowsFile },
      });

      const cat = createCatCommand(context);
      const result = cat.fn('/windows.txt');

      expect(result).toBe('line1\r\nline2\r\n');
    });
  });
});
