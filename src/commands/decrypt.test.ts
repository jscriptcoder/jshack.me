import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { AsyncOutput } from '../components/Terminal/types';
import { createDecryptCommand } from './decrypt';

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

type DecryptContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly files?: Record<string, FileNode | null>;
};

const createMockDecryptContext = (config: DecryptContextConfig = {}) => {
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

describe('decrypt command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument validation', () => {
    it('should throw error when no file path given', () => {
      const context = createMockDecryptContext();
      const decrypt = createDecryptCommand(context);

      expect(() => decrypt.fn()).toThrow('decrypt: missing file path');
    });

    it('should throw error when no key given', () => {
      const context = createMockDecryptContext();
      const decrypt = createDecryptCommand(context);

      expect(() => decrypt.fn('secret.enc')).toThrow('decrypt: missing key');
    });

    it('should throw error when key is too short', () => {
      const context = createMockDecryptContext();
      const decrypt = createDecryptCommand(context);

      expect(() => decrypt.fn('secret.enc', 'abc123')).toThrow('decrypt: invalid key format');
    });

    it('should throw error when key contains non-hex characters', () => {
      const context = createMockDecryptContext();
      const decrypt = createDecryptCommand(context);

      const invalidKey = 'g'.repeat(64); // 'g' is not valid hex

      expect(() => decrypt.fn('secret.enc', invalidKey)).toThrow('decrypt: invalid key format');
    });

    it('should accept valid 64-character hex key', () => {
      const validKey = 'a'.repeat(64);
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockDecryptContext({
        files: { '/secret.enc': file },
      });
      const decrypt = createDecryptCommand(context);

      const result = decrypt.fn('secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('file validation', () => {
    it('should throw error when file does not exist', () => {
      const context = createMockDecryptContext({
        files: {},
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => decrypt.fn('nonexistent.enc', validKey)).toThrow(
        'decrypt: nonexistent.enc: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = createMockDirectory('secrets');

      const context = createMockDecryptContext({
        files: { '/secrets': dir },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => decrypt.fn('/secrets', validKey)).toThrow('decrypt: /secrets: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = createMockFile('secret.enc', 'encrypted', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });

      const context = createMockDecryptContext({
        userType: 'guest',
        files: { '/secret.enc': restrictedFile },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => decrypt.fn('/secret.enc', validKey)).toThrow(
        'decrypt: /secret.enc: Permission denied',
      );
    });

    it('should throw error when file is empty', () => {
      const emptyFile = createMockFile('empty.enc', '');

      const context = createMockDecryptContext({
        files: { '/empty.enc': emptyFile },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      expect(() => decrypt.fn('/empty.enc', validKey)).toThrow(
        'decrypt: /empty.enc: File is empty',
      );
    });

    it('should allow root to read any file', () => {
      const restrictedFile = createMockFile('secret.enc', 'encrypted', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });

      const context = createMockDecryptContext({
        userType: 'root',
        files: { '/secret.enc': restrictedFile },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      const result = decrypt.fn('/secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockDecryptContext({
        files: { '/secret.enc': file },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      const result = decrypt.fn('secret.enc', validKey);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockDecryptContext({
        files: { '/secret.enc': file },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      const result = decrypt.fn('secret.enc', validKey);

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockDecryptContext({
        files: { '/secret.enc': file },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      const result = decrypt.fn('secret.enc', validKey);

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });

    it('should output decrypting message immediately', () => {
      const file = createMockFile('secret.enc', 'encrypted content');

      const context = createMockDecryptContext({
        files: { '/secret.enc': file },
      });
      const decrypt = createDecryptCommand(context);
      const validKey = 'a'.repeat(64);

      const result = decrypt.fn('secret.enc', validKey);

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
