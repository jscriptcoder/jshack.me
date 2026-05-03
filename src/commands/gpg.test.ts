import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createGpgCommand } from './gpg';

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

const createMockDirectory = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
});

type GpgContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly files?: Record<string, FileNode | null>;
};

const createMockGpgContext = (config: GpgContextConfig = {}) => {
  const { currentPath = '/', userType = 'user', files = {} } = config;

  return {
    resolvePath: (path: string) => {
      if (path.startsWith('/')) return path;
      return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
    },
    getNode: (path: string) => files[path] ?? null,
    getUserType: () => userType,
    canTraverse: () => ({ allowed: true }),
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

// --- Tests ---

describe('gpg command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument validation', () => {
    it('should throw error when no file path given', () => {
      const context = createMockGpgContext();
      const gpg = createGpgCommand(context);

      expect(() => gpg.fn()).toThrow('gpg: missing file path');
    });

    it('should throw error when no key given', () => {
      const context = createMockGpgContext();
      const gpg = createGpgCommand(context);

      expect(() => gpg.fn('secret.enc')).toThrow('gpg: missing key');
    });

    it('should throw error when key is too short', () => {
      const context = createMockGpgContext();
      const gpg = createGpgCommand(context);

      expect(() => gpg.fn('secret.enc', 'abc123')).toThrow('gpg: invalid key format');
    });

    it('should throw error when key contains non-hex characters', () => {
      const context = createMockGpgContext();
      const gpg = createGpgCommand(context);

      const invalidKey = 'g'.repeat(64); // 'g' is not valid hex

      expect(() => gpg.fn('secret.enc', invalidKey)).toThrow('gpg: invalid key format');
    });

    it('should accept valid 64-character hex key', () => {
      const validKey = 'a'.repeat(64);
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockGpgContext({
        files: { '/secret.enc': file },
      });
      const gpg = createGpgCommand(context);

      const result = gpg.fn('secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('file validation', () => {
    it('should throw error when file does not exist', () => {
      const context = createMockGpgContext({
        files: {},
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => gpg.fn('nonexistent.enc', validKey)).toThrow(
        'gpg: nonexistent.enc: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = createMockDirectory('secrets');

      const context = createMockGpgContext({
        files: { '/secrets': dir },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => gpg.fn('/secrets', validKey)).toThrow('gpg: /secrets: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = createMockFile('secret.enc', 'encrypted', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });

      const context = createMockGpgContext({
        userType: 'guest',
        files: { '/secret.enc': restrictedFile },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => gpg.fn('/secret.enc', validKey)).toThrow('gpg: /secret.enc: Permission denied');
    });

    it('should throw error when file is empty', () => {
      const emptyFile = createMockFile('empty.enc', '');

      const context = createMockGpgContext({
        files: { '/empty.enc': emptyFile },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => gpg.fn('/empty.enc', validKey)).toThrow('gpg: /empty.enc: File is empty');
    });

    it('should allow root to read any file', () => {
      const restrictedFile = createMockFile('secret.enc', 'encrypted', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });

      const context = createMockGpgContext({
        userType: 'root',
        files: { '/secret.enc': restrictedFile },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      const result = gpg.fn('/secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockGpgContext({
        files: { '/secret.enc': file },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      const result = gpg.fn('secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockGpgContext({
        files: { '/secret.enc': file },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      const result = gpg.fn('secret.enc', validKey);

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockGpgContext({
        files: { '/secret.enc': file },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      const result = gpg.fn('secret.enc', validKey);

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });

    it('should output decrypting message immediately', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockGpgContext({
        files: { '/secret.enc': file },
      });
      const gpg = createGpgCommand(context);
      const validKey = 'a'.repeat(64);

      const result = gpg.fn('secret.enc', validKey);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Decrypting...');
    });
  });
});
