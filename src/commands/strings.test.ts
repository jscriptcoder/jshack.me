import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/types';
import { createStringsCommand } from './strings';

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

type StringsContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly files?: Record<string, FileNode | null>;
};

const createMockStringsContext = (config: StringsContextConfig = {}) => {
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

// --- Tests ---

describe('strings command', () => {
  describe('argument validation', () => {
    it('should throw error when no file path given', () => {
      const context = createMockStringsContext();
      const strings = createStringsCommand(context);

      expect(() => strings.fn()).toThrow('strings: missing file operand');
    });

    it('should throw error when minLength is less than 1', () => {
      const file = createMockFile('test.bin', 'content');
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      expect(() => strings.fn('test.bin', 0)).toThrow(
        'strings: minimum length must be between 1 and 100',
      );
    });

    it('should throw error when minLength is greater than 100', () => {
      const file = createMockFile('test.bin', 'content');
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      expect(() => strings.fn('test.bin', 101)).toThrow(
        'strings: minimum length must be between 1 and 100',
      );
    });
  });

  describe('file validation', () => {
    it('should throw error when file does not exist', () => {
      const context = createMockStringsContext({
        files: {},
      });
      const strings = createStringsCommand(context);

      expect(() => strings.fn('nonexistent.bin')).toThrow(
        'strings: nonexistent.bin: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = createMockDirectory('mydir');
      const context = createMockStringsContext({
        files: { '/mydir': dir },
      });
      const strings = createStringsCommand(context);

      expect(() => strings.fn('/mydir')).toThrow('strings: /mydir: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = createMockFile('secret.bin', 'content', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockStringsContext({
        userType: 'guest',
        files: { '/secret.bin': restrictedFile },
      });
      const strings = createStringsCommand(context);

      expect(() => strings.fn('/secret.bin')).toThrow('strings: /secret.bin: Permission denied');
    });

    it('should allow root to read any file', () => {
      const restrictedFile = createMockFile('secret.bin', 'hello world', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockStringsContext({
        userType: 'root',
        files: { '/secret.bin': restrictedFile },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('/secret.bin');

      expect(result).toBe('hello world');
    });
  });

  describe('string extraction', () => {
    it('should extract printable strings from binary content', () => {
      const binaryContent = '\x7fELF\x00\x00\x00HELLO\x00\x00\x00WORLD\x00\x00';
      const file = createMockFile('test.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('test.bin');

      expect(result).toContain('HELLO');
      expect(result).toContain('WORLD');
    });

    it('should ignore strings shorter than minLength', () => {
      const binaryContent = '\x00hi\x00LONG_STRING\x00ok\x00ANOTHER_ONE\x00';
      const file = createMockFile('test.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('test.bin', 4) as string;
      const lines = result.split('\n');

      expect(lines).toContain('LONG_STRING');
      expect(lines).toContain('ANOTHER_ONE');
      expect(lines).not.toContain('hi');
      expect(lines).not.toContain('ok');
    });

    it('should respect custom minLength parameter', () => {
      const binaryContent = '\x00ABCDEF\x00AB\x00';
      const file = createMockFile('test.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('test.bin', 2);

      expect(result).toContain('ABCDEF');
      expect(result).toContain('AB');
    });

    it('should extract FLAG from binary', () => {
      const binaryContent = '\x7fELF\x00\x00FLAG{hidden_in_binary}\x00\x00\x89\xe5';
      const file = createMockFile('backdoor.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/backdoor.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('backdoor.bin');

      expect(result).toContain('FLAG{hidden_in_binary}');
    });

    it('should return empty string for empty file', () => {
      const file = createMockFile('empty.bin', '');
      const context = createMockStringsContext({
        files: { '/empty.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('empty.bin');

      expect(result).toBe('');
    });

    it('should return empty string for file with only binary content', () => {
      const binaryContent = '\x00\x01\x02\x03\x04\x05';
      const file = createMockFile('pure.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/pure.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('pure.bin');

      expect(result).toBe('');
    });

    it('should handle content ending with printable string', () => {
      const binaryContent = '\x00\x00ENDING';
      const file = createMockFile('test.bin', binaryContent);
      const context = createMockStringsContext({
        files: { '/test.bin': file },
      });
      const strings = createStringsCommand(context);

      const result = strings.fn('test.bin');

      expect(result).toBe('ENDING');
    });
  });
});
