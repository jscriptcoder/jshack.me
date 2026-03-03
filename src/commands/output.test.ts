import { describe, it, expect, vi } from 'vitest';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { AsyncOutput } from '../components/Terminal/types';
import { createOutputCommand } from './output';

// --- Factory Functions ---

const createMockFile = (
  name: string,
  content: string,
  overrides?: Partial<FileNode>,
): FileNode => ({
  name,
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content,
  ...overrides,
});

type OutputContextConfig = {
  readonly userType?: UserType;
  readonly files?: Record<string, FileNode | null>;
  readonly createFileResult?: PermissionResult;
  readonly writeFileResult?: PermissionResult;
};

const createMockOutputContext = (config: OutputContextConfig = {}) => {
  const {
    userType = 'user',
    files = {},
    createFileResult = { allowed: true },
    writeFileResult = { allowed: true },
  } = config;

  const createFile = vi.fn().mockReturnValue(createFileResult);
  const writeFile = vi.fn().mockReturnValue(writeFileResult);

  return {
    context: {
      resolvePath: (path: string) => (path.startsWith('/') ? path : `/${path}`),
      getNode: (path: string) => files[path] ?? null,
      getUserType: () => userType,
      createFile,
      writeFile,
    },
    mocks: { createFile, writeFile },
  };
};

const createMockAsyncOutput = (lines: readonly string[]): AsyncOutput => ({
  __type: 'async',
  start: (onLine, onComplete) => {
    lines.forEach((line) => onLine(line));
    onComplete();
  },
  cancel: () => {},
});

// --- Tests ---

describe('output command', () => {
  describe('sync output capture', () => {
    it('should return string value directly', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn('hello world');

      expect(result).toBe('hello world');
    });

    it('should stringify numbers', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn(42);

      expect(result).toBe('42');
    });

    it('should stringify objects as JSON', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn({ key: 'value' });

      expect(result).toBe('{\n  "key": "value"\n}');
    });

    it('should handle null', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn(null);

      expect(result).toBe('null');
    });

    it('should handle undefined', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn(undefined);

      expect(result).toBe('undefined');
    });
  });

  describe('async output capture', () => {
    it('should return Promise for AsyncOutput', async () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);
      const asyncOutput = createMockAsyncOutput(['line 1', 'line 2', 'line 3']);

      const result = output.fn(asyncOutput);

      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBe('line 1\nline 2\nline 3');
    });

    it('should collect all lines from async output', async () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);
      const asyncOutput = createMockAsyncOutput([
        'PING 192.168.1.1',
        '64 bytes from 192.168.1.1',
        '64 bytes from 192.168.1.1',
      ]);

      const result = await output.fn(asyncOutput);

      expect(result).toContain('PING 192.168.1.1');
      expect(result).toContain('64 bytes from 192.168.1.1');
    });
  });

  describe('file writing', () => {
    it('should create new file when path does not exist', () => {
      const { context, mocks } = createMockOutputContext();
      const output = createOutputCommand(context);

      output.fn('content', '/tmp/new-file.txt');

      expect(mocks.createFile).toHaveBeenCalledWith('/tmp/new-file.txt', 'content', 'user');
    });

    it('should write to existing file', () => {
      const existingFile = createMockFile('existing.txt', 'old content');
      const { context, mocks } = createMockOutputContext({
        files: { '/tmp/existing.txt': existingFile },
      });
      const output = createOutputCommand(context);

      output.fn('new content', '/tmp/existing.txt');

      expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/existing.txt', 'new content', 'user');
    });

    it('should throw on permission denied for create', () => {
      const { context } = createMockOutputContext({
        createFileResult: { allowed: false, error: 'Permission denied: /root/file.txt' },
      });
      const output = createOutputCommand(context);

      expect(() => output.fn('content', '/root/file.txt')).toThrow(
        'output: Permission denied: /root/file.txt',
      );
    });

    it('should throw on permission denied for write', () => {
      const existingFile = createMockFile('protected.txt', 'content');
      const { context } = createMockOutputContext({
        files: { '/protected.txt': existingFile },
        writeFileResult: { allowed: false, error: 'Permission denied: /protected.txt' },
      });
      const output = createOutputCommand(context);

      expect(() => output.fn('new content', '/protected.txt')).toThrow(
        'output: Permission denied: /protected.txt',
      );
    });

    it('should write async output to file', async () => {
      const { context, mocks } = createMockOutputContext();
      const output = createOutputCommand(context);
      const asyncOutput = createMockAsyncOutput(['line 1', 'line 2']);

      await output.fn(asyncOutput, '/tmp/async-output.txt');

      expect(mocks.createFile).toHaveBeenCalledWith(
        '/tmp/async-output.txt',
        'line 1\nline 2',
        'user',
      );
    });

    it('should return content when writing to file', () => {
      const { context } = createMockOutputContext();
      const output = createOutputCommand(context);

      const result = output.fn('hello', '/tmp/file.txt');

      expect(result).toBe('hello');
    });
  });
});
