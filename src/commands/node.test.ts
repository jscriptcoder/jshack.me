import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import { createNodeCommand } from './node';

// --- Async Helpers ---

// Collects all lines from an AsyncOutput and resolves when complete
const collectOutput = (asyncOutput: AsyncOutput): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    asyncOutput.start(
      (line) => {
        lines[lines.length] = line;
      },
      () => resolve(lines),
    );
  });

// Creates a mock command that returns AsyncOutput (like hydra, nmap, etc.)
const createMockAsyncCommand = (lines: readonly string[]) =>
  vi.fn(
    (): AsyncOutput => ({
      __type: 'async',
      start: (onLine, onComplete) => {
        lines.forEach((line) => onLine(line));
        onComplete();
      },
    }),
  );

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
    canTraverse: () => ({ allowed: true }),
  };
};

type NodeContextOverrides = {
  readonly getNode?: (path: string) => FileNode | null;
  readonly getUserType?: () => UserType;
  readonly resolvePath?: (path: string) => string;
  readonly getExecutionContext?: () => Record<string, (...args: unknown[]) => unknown>;
  readonly getDecodeFn?: () => ((value: unknown) => string) | undefined;
};

const createNodeContext = (overrides: NodeContextOverrides = {}) => ({
  resolvePath:
    overrides.resolvePath ?? ((path: string) => (path.startsWith('/') ? path : `/${path}`)),
  getNode: overrides.getNode ?? (() => null),
  getUserType: overrides.getUserType ?? (() => 'user' as UserType),
  getExecutionContext: overrides.getExecutionContext ?? (() => ({})),
  getDecodeFn: overrides.getDecodeFn,
  canTraverse: () => ({ allowed: true }),
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

  describe('_decode() injection', () => {
    it('injects _decode into execution context when getDecodeFn returns a function', () => {
      const decodeFn = vi.fn((value: unknown) =>
        String(value) === 'correct' ? 'ACCESS-1234-5678-9ABC' : 'ERROR: checksum mismatch',
      );
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo(_decode("correct"))',
      });
      const context = createNodeContext({
        getNode: () => file,
        getExecutionContext: () => ({ echo: mockEcho }),
        getDecodeFn: () => decodeFn,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(decodeFn).toHaveBeenCalledWith('correct');
      expect(mockEcho).toHaveBeenCalledWith('ACCESS-1234-5678-9ABC');
      expect(result).toBe('ACCESS-1234-5678-9ABC');
    });

    it('returns error string when checksum does not match', () => {
      const decodeFn = vi.fn((value: unknown) =>
        String(value) === 'correct' ? 'ACCESS-1234-5678-9ABC' : 'ERROR: checksum mismatch',
      );
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'echo(_decode("wrong"))',
      });
      const context = createNodeContext({
        getNode: () => file,
        getExecutionContext: () => ({ echo: mockEcho }),
        getDecodeFn: () => decodeFn,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(decodeFn).toHaveBeenCalledWith('wrong');
      expect(result).toBe('ERROR: checksum mismatch');
    });

    it('does not inject _decode when getDecodeFn returns undefined', () => {
      const file = getMockFile({
        content: 'typeof _decode',
      });
      const context = createNodeContext({
        getNode: () => file,
        getDecodeFn: () => undefined,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toBe('undefined');
    });

    it('does not inject _decode when getDecodeFn is not provided', () => {
      const file = getMockFile({
        content: 'typeof _decode',
      });
      const context = createNodeContext({
        getNode: () => file,
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toBe('undefined');
    });
  });

  describe('process.argv', () => {
    it('exposes extra arguments as process.argv in sync scripts', () => {
      const file = getMockFile({ content: 'process.argv' });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js', '192.168.1.1', 'ssh');

      expect(result).toEqual(['192.168.1.1', 'ssh']);
    });

    it('exposes argv as empty array when no extra arguments given', () => {
      const file = getMockFile({ content: 'process.argv' });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      expect(result).toEqual([]);
    });

    it('process.argv is accessible in async scripts', async () => {
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\nconsole.log("host: " + process.argv[0]);',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js', '10.0.0.5') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('host: 10.0.0.5');
    });

    it('argv is usable with destructuring in scripts', () => {
      const mockEcho = vi.fn((val: unknown) => String(val));
      const file = getMockFile({
        content: 'const [host, svc] = process.argv;\necho(host + ":" + svc);',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { echo: mockEcho },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js', '192.168.1.50', 'ftp');

      expect(result).toBe('192.168.1.50:ftp');
    });
  });

  describe('async execution', () => {
    it('returns AsyncOutput when script contains await', () => {
      const mockCmd = createMockAsyncCommand(['line 1', 'line 2']);
      const file = getMockFile({
        content: 'const result = await mockCmd();\nconsole.log("done");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      expect(result).toHaveProperty('__type', 'async');
      expect(typeof result.start).toBe('function');
    });

    it('collects async command output into string array via await', async () => {
      const mockCmd = createMockAsyncCommand(['result 1', 'result 2']);
      const file = getMockFile({
        content: [
          'const output = await mockCmd();',
          'console.log("got " + output.length + " lines");',
        ].join('\n'),
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      // Lines from mockCmd are forwarded, plus the console.log
      expect(lines).toContain('result 1');
      expect(lines).toContain('result 2');
      expect(lines).toContain('got 2 lines');
    });

    it('forwards async command lines to terminal in real time', async () => {
      const mockCmd = createMockAsyncCommand(['scanning...', 'found: admin']);
      const file = getMockFile({
        content: 'await mockCmd();',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('scanning...');
      expect(lines).toContain('found: admin');
    });

    it('console.log prints to terminal output', async () => {
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\nconsole.log("hello from script");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('hello from script');
    });

    it('console.log joins multiple arguments with spaces', async () => {
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\nconsole.log("count:", 3, "items");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('count: 3 items');
    });

    it('echo forwards to terminal in async mode instead of buffering', async () => {
      const mockEcho = vi.fn((val: unknown) => String(val));
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\necho("echoed line");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd, echo: mockEcho },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('echoed line');
    });

    it('sleep pauses execution for specified duration', async () => {
      vi.useFakeTimers();
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: [
          'await mockCmd();',
          'console.log("before");',
          'await sleep(500);',
          'console.log("after");',
        ].join('\n'),
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      const lines: string[] = [];
      let completed = false;
      result.start(
        (line) => {
          lines[lines.length] = line;
        },
        () => {
          completed = true;
        },
      );

      // "before" should appear, but "after" is waiting for sleep
      await vi.advanceTimersByTimeAsync(0);
      expect(lines).toContain('before');
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(500);
      expect(lines).toContain('after');
      expect(completed).toBe(true);

      vi.useRealTimers();
    });

    it('does not use async path for scripts without await', () => {
      const file = getMockFile({ content: '1 + 2' });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js');

      // Sync path — returns value directly, not AsyncOutput
      expect(result).toBe(3);
    });

    it('reports script errors via terminal output', async () => {
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\nthrow new Error("script failed");',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines.some((l) => l.includes('script failed'))).toBe(true);
    });

    it('cancel function is provided on async output', () => {
      const mockCmd = createMockAsyncCommand(['line']);
      const file = getMockFile({ content: 'await mockCmd();' });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      expect(typeof result.cancel).toBe('function');
    });

    it('cancelling stops subsequent async commands from running', async () => {
      let callCount = 0;
      const slowCmd = vi.fn(
        (): AsyncOutput => ({
          __type: 'async',
          start: (onLine, onComplete) => {
            callCount++;
            onLine(`call ${callCount}`);
            // Simulate async delay
            setTimeout(() => onComplete(), 10);
          },
        }),
      );
      const file = getMockFile({
        content: ['await slowCmd();', 'await slowCmd();', 'await slowCmd();'].join('\n'),
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { slowCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      const lines: string[] = [];
      let completed = false;
      result.start(
        (line) => {
          lines[lines.length] = line;
          // Cancel after first command completes
          if (lines.length === 1) {
            result.cancel?.();
          }
        },
        () => {
          completed = true;
        },
      );

      // Wait for everything to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have completed (via cancellation error caught internally)
      expect(completed).toBe(true);
      // Only the first command should have run
      expect(callCount).toBe(1);
    });

    it('cancelling sleep resolves the script', async () => {
      vi.useFakeTimers();
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: [
          'await mockCmd();',
          'console.log("before sleep");',
          'await sleep(999999);',
          'console.log("after sleep");',
        ].join('\n'),
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      const lines: string[] = [];
      let completed = false;
      result.start(
        (line) => {
          lines[lines.length] = line;
        },
        () => {
          completed = true;
        },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(lines).toContain('before sleep');
      expect(completed).toBe(false);

      // Cancel during sleep
      result.cancel?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(completed).toBe(true);
      // "after sleep" should NOT appear
      expect(lines).not.toContain('after sleep');

      vi.useRealTimers();
    });

    it('cancellation errors are not displayed as script errors', async () => {
      const mockCmd = createMockAsyncCommand(['data']);
      const file = getMockFile({
        content: 'await mockCmd();\nawait mockCmd();',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;

      const lines: string[] = [];
      result.start(
        (line) => {
          lines[lines.length] = line;
          // Cancel after first line from first command
          if (line === 'data') {
            result.cancel?.();
          }
        },
        () => {},
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // No "Error:" lines should appear from cancellation
      expect(lines.some((l) => l.startsWith('Error:'))).toBe(false);
    });

    it('passes through sync command results unchanged in async scripts', async () => {
      const mockSync = vi.fn(() => 'sync result');
      const mockCmd = createMockAsyncCommand([]);
      const file = getMockFile({
        content: 'await mockCmd();\nconst val = mockSync();\nconsole.log(val);',
      });
      const context = createMockContext({
        fileSystem: { '/script.js': file },
        executionContext: { mockCmd, mockSync },
      });

      const node = createNodeCommand(context);
      const result = node.fn('/script.js') as AsyncOutput;
      const lines = await collectOutput(result);

      expect(lines).toContain('sync result');
    });
  });
});
