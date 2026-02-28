import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { createNodeCommand } from './node';

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
    name: 'file.js',
    type: 'file',
    content: '',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    },
    ...overrides,
  });

const getMockDirectory = (name: string): FileNode =>
  getMockFileNode({
    name,
    type: 'directory',
    children: {},
  });

type MockContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly fileSystem?: Record<string, FileNode | null>;
  readonly executionContext?: Record<string, (...args: unknown[]) => unknown>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const { currentPath = '/', userType = 'user', fileSystem = {}, executionContext = {} } = config;

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return path;
    return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
  };

  return {
    resolvePath,
    getNode: (path: string) => fileSystem[path] ?? null,
    getUserType: () => userType,
    getExecutionContext: () => executionContext,
  };
};

type NodeContextOverrides = {
  readonly getNode?: (path: string) => FileNode | null;
  readonly getUserType?: () => UserType;
  readonly resolvePath?: (path: string) => string;
  readonly getExecutionContext?: () => Record<string, (...args: unknown[]) => unknown>;
  readonly getSubmitFn?: () => (() => string) | undefined;
};

const createNodeContext = (overrides: NodeContextOverrides = {}) => ({
  resolvePath:
    overrides.resolvePath ?? ((path: string) => (path.startsWith('/') ? path : `/${path}`)),
  getNode: overrides.getNode ?? (() => null),
  getUserType: overrides.getUserType ?? (() => 'user' as UserType),
  getExecutionContext: overrides.getExecutionContext ?? (() => ({})),
  getSubmitFn: overrides.getSubmitFn,
});

// --- Tests ---

describe('node command', () => {
  describe('executing files', () => {
    it('should execute a simple expression and return result', () => {
      const file = getMockFile({ content: '1 + 2' });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toBe(3);
    });

    it('should execute statements', () => {
      const file = getMockFile({
        content: 'const x = 5;\nconst y = 10;\nx + y;',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
      });

      const node = createNodeCommand(context);
      // Statement execution — last line is not automatically returned
      // This falls through to statement mode
      const result = node.fn('/script.js');

      expect(result).toBeUndefined();
    });

    it('should have access to commands in execution context', () => {
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo("hello from script")',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { echo: mockEcho },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(mockEcho).toHaveBeenCalledWith('hello from script');
      expect(result).toBe('hello from script');
    });

    it('should collect multiple echo calls into combined output', () => {
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo("line 1");\necho("line 2");\necho("line 3");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { echo: mockEcho },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(mockEcho).toHaveBeenCalledTimes(3);
      expect(result).toBe('line 1\nline 2\nline 3');
    });

    it('should not duplicate echo output in expression mode', () => {
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo("info")',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { echo: mockEcho },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      // echo("info") in expression mode: buffer captures it, result is just buffer output
      expect(result).toBe('info');
    });

    it('should return undefined for empty file', () => {
      const file = getMockFile({ content: '' });
      const context = createMockContext({
        fileSystem: { '/empty.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/empty.js');

      expect(result).toBeUndefined();
    });

    it('should return undefined for whitespace-only file', () => {
      const file = getMockFile({ content: '   \n  \n  ' });
      const context = createMockContext({
        fileSystem: { '/blank.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/blank.js');

      expect(result).toBeUndefined();
    });

    it('should resolve relative paths', () => {
      const file = getMockFile({ content: '42' });
      const context = createMockContext({
        currentPath: '/home/user',
        fileSystem: { '/home/user/script.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('script.js');

      expect(result).toBe(42);
    });
  });

  describe('error handling', () => {
    it('should throw error when no path given', () => {
      const context = createMockContext();
      const node = createNodeCommand(context);

      expect(() => node.fn()).toThrow('node: missing file operand');
    });

    it('should throw error for non-existent file', () => {
      const context = createMockContext();
      const node = createNodeCommand(context);

      expect(() => node.fn('/nonexistent.js')).toThrow(
        'node: /nonexistent.js: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = getMockDirectory('mydir');
      const context = createMockContext({
        fileSystem: { '/mydir': dir },
      });

      const node = createNodeCommand(context);

      expect(() => node.fn('/mydir')).toThrow('node: /mydir: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = getMockFile({
        name: 'secret.js',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockContext({
        userType: 'guest',
        fileSystem: { '/secret.js': restrictedFile },
      });

      const node = createNodeCommand(context);

      expect(() => node.fn('/secret.js')).toThrow('node: /secret.js: Permission denied');
    });

    it('throws permission denied for readable but not executable file', () => {
      const context = createNodeContext({
        getNode: () => ({
          name: 'data.txt',
          type: 'file',
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
          content: '"hello"',
        }),
        getUserType: () => 'user',
      });
      const command = createNodeCommand(context);
      expect(() => command.fn('data.txt')).toThrow('node: data.txt: Permission denied');
    });

    it('executes file with both read and execute permission', () => {
      const context = createNodeContext({
        getNode: () => ({
          name: 'script.js',
          type: 'file',
          owner: 'user',
          permissions: {
            read: ['root', 'user'],
            write: ['root', 'user'],
            execute: ['root', 'user'],
          },
          content: '2 + 2',
        }),
        getUserType: () => 'user',
      });
      const command = createNodeCommand(context);
      expect(command.fn('script.js')).toBe(4);
    });

    it('should throw error for syntax errors in file content', () => {
      const file = getMockFile({ content: 'function(' });
      const context = createMockContext({
        fileSystem: { '/bad.js': file },
      });

      const node = createNodeCommand(context);

      expect(() => node.fn('/bad.js')).toThrow();
    });

    it('should allow root to execute any file', () => {
      const restrictedFile = getMockFile({
        content: '"secret result"',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockContext({
        userType: 'root',
        fileSystem: { '/secret.js': restrictedFile },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/secret.js');

      expect(result).toBe('secret result');
    });
  });

  describe('_submit() injection', () => {
    it('injects _submit into execution context when getSubmitFn returns a function', () => {
      const submitFn = vi.fn(() => 'MISSION COMPLETE');
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo(_submit())',
      });
      const context = createNodeContext({
        getNode: () => file,
        getExecutionContext: () => ({ echo: mockEcho }),
        getSubmitFn: () => submitFn,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(submitFn).toHaveBeenCalled();
      expect(mockEcho).toHaveBeenCalledWith('MISSION COMPLETE');
      expect(result).toBe('MISSION COMPLETE');
    });

    it('does not inject _submit when getSubmitFn returns undefined', () => {
      const file = getMockFile({
        content: 'typeof _submit',
      });
      const context = createNodeContext({
        getNode: () => file,
        getSubmitFn: () => undefined,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toBe('undefined');
    });

    it('does not inject _submit when getSubmitFn is not provided', () => {
      const file = getMockFile({
        content: 'typeof _submit',
      });
      const context = createNodeContext({
        getNode: () => file,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toBe('undefined');
    });
  });
});
