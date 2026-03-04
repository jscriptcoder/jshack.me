import { describe, it, expect, vi } from 'vitest';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createRmCommand } from './rm';

// --- Factory Functions ---

const getMockFile = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'file.txt',
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'test content',
  ...overrides,
});

const getMockDirectory = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
  ...overrides,
});

type MockConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly fileSystem?: Record<string, FileNode | null>;
  readonly deleteResult?: PermissionResult;
};

const createMockContext = (config: MockConfig = {}) => {
  const { currentPath = '/', userType = 'user', fileSystem = {}, deleteResult } = config;

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return path;
    return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
  };

  const deleteNode = vi.fn(
    (_path: string, _userType: UserType, _options?: { readonly recursive?: boolean }) =>
      deleteResult ?? ({ allowed: true } as PermissionResult),
  );

  return {
    resolvePath,
    getNode: (path: string) => fileSystem[path] ?? null,
    getUserType: () => userType,
    deleteNode,
  };
};

// --- Tests ---

describe('rm command', () => {
  describe('basic file removal', () => {
    it('should call deleteNode for a file', () => {
      const file = getMockFile({ name: 'readme.txt' });
      const context = createMockContext({
        fileSystem: { '/readme.txt': file },
      });

      const rm = createRmCommand(context);
      rm.fn('/readme.txt');

      expect(context.deleteNode).toHaveBeenCalledWith('/readme.txt', 'user', {
        recursive: false,
      });
    });

    it('should resolve relative paths', () => {
      const file = getMockFile({ name: 'file.txt' });
      const context = createMockContext({
        currentPath: '/home/jshacker',
        fileSystem: { '/home/jshacker/file.txt': file },
      });

      const rm = createRmCommand(context);
      rm.fn('file.txt');

      expect(context.deleteNode).toHaveBeenCalledWith('file.txt', 'user', { recursive: false });
    });

    it('should return empty string on success', () => {
      const file = getMockFile();
      const context = createMockContext({
        fileSystem: { '/file.txt': file },
      });

      const rm = createRmCommand(context);
      expect(rm.fn('/file.txt')).toBe('');
    });
  });

  describe('directory handling', () => {
    it('should pass recursive: false for directories without -r flag', () => {
      const dir = getMockDirectory('boot');
      const context = createMockContext({
        fileSystem: { '/boot': dir },
        deleteResult: { allowed: false, error: "rm: cannot remove '/boot': Is a directory" },
      });

      const rm = createRmCommand(context);
      expect(() => rm.fn('/boot')).toThrow("rm: cannot remove '/boot': Is a directory");
      expect(context.deleteNode).toHaveBeenCalledWith('/boot', 'user', { recursive: false });
    });

    it('should pass recursive: true with -r flag', () => {
      const dir = getMockDirectory('boot');
      const context = createMockContext({
        fileSystem: { '/boot': dir },
      });

      const rm = createRmCommand(context);
      rm.fn('-r', '/boot');

      expect(context.deleteNode).toHaveBeenCalledWith('/boot', 'user', { recursive: true });
    });
  });

  describe('force flag', () => {
    it('should throw for missing file without -f', () => {
      const context = createMockContext({ fileSystem: {} });

      const rm = createRmCommand(context);
      expect(() => rm.fn('/nonexistent')).toThrow(
        "rm: cannot remove '/nonexistent': No such file or directory",
      );
    });

    it('should silently succeed for missing file with -f', () => {
      const context = createMockContext({ fileSystem: {} });

      const rm = createRmCommand(context);
      expect(rm.fn('-f', '/nonexistent')).toBe('');
      expect(context.deleteNode).not.toHaveBeenCalled();
    });
  });

  describe('combined flags', () => {
    it('should parse -rf as recursive + force', () => {
      const dir = getMockDirectory('boot');
      const context = createMockContext({
        fileSystem: { '/boot': dir },
      });

      const rm = createRmCommand(context);
      rm.fn('-rf', '/boot');

      expect(context.deleteNode).toHaveBeenCalledWith('/boot', 'user', { recursive: true });
    });

    it('should parse -fr as recursive + force', () => {
      const dir = getMockDirectory('boot');
      const context = createMockContext({
        fileSystem: { '/boot': dir },
      });

      const rm = createRmCommand(context);
      rm.fn('-fr', '/boot');

      expect(context.deleteNode).toHaveBeenCalledWith('/boot', 'user', { recursive: true });
    });

    it('should parse separate -r -f flags', () => {
      const dir = getMockDirectory('boot');
      const context = createMockContext({
        fileSystem: { '/boot': dir },
      });

      const rm = createRmCommand(context);
      rm.fn('-r', '-f', '/boot');

      expect(context.deleteNode).toHaveBeenCalledWith('/boot', 'user', { recursive: true });
    });
  });

  describe('error handling', () => {
    it('should throw when no args given', () => {
      const context = createMockContext();
      const rm = createRmCommand(context);

      expect(() => rm.fn()).toThrow('rm: missing operand');
    });

    it('should propagate permission denied from deleteNode', () => {
      const file = getMockFile({ name: 'protected.txt' });
      const context = createMockContext({
        fileSystem: { '/protected.txt': file },
        deleteResult: {
          allowed: false,
          error: "rm: cannot remove '/protected.txt': Permission denied",
        },
      });

      const rm = createRmCommand(context);
      expect(() => rm.fn('/protected.txt')).toThrow(
        "rm: cannot remove '/protected.txt': Permission denied",
      );
    });

    it('should throw for invalid option', () => {
      const context = createMockContext();
      const rm = createRmCommand(context);

      expect(() => rm.fn('-x', '/file.txt')).toThrow("rm: invalid option -- 'x'");
    });
  });

  describe('multiple paths', () => {
    it('should process multiple paths in order', () => {
      const file1 = getMockFile({ name: 'a.txt' });
      const file2 = getMockFile({ name: 'b.txt' });
      const context = createMockContext({
        fileSystem: { '/a.txt': file1, '/b.txt': file2 },
      });

      const rm = createRmCommand(context);
      rm.fn('/a.txt', '/b.txt');

      expect(context.deleteNode).toHaveBeenCalledTimes(2);
      expect(context.deleteNode).toHaveBeenNthCalledWith(1, '/a.txt', 'user', {
        recursive: false,
      });
      expect(context.deleteNode).toHaveBeenNthCalledWith(2, '/b.txt', 'user', {
        recursive: false,
      });
    });

    it('should collect errors from multiple paths', () => {
      const file = getMockFile({ name: 'a.txt' });
      const context = createMockContext({
        fileSystem: { '/a.txt': file },
      });

      const rm = createRmCommand(context);
      expect(() => rm.fn('/a.txt', '/nonexistent')).toThrow(
        "rm: cannot remove '/nonexistent': No such file or directory",
      );
    });

    it('should skip missing files with -f and continue', () => {
      const file = getMockFile({ name: 'exists.txt' });
      const context = createMockContext({
        fileSystem: { '/exists.txt': file },
      });

      const rm = createRmCommand(context);
      rm.fn('-f', '/missing.txt', '/exists.txt');

      expect(context.deleteNode).toHaveBeenCalledTimes(1);
      expect(context.deleteNode).toHaveBeenCalledWith('/exists.txt', 'user', { recursive: false });
    });
  });
});
