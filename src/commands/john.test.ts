import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { AsyncOutput } from '../components/Terminal/types';
import { md5 } from '../utils/md5';
import { createJohnCommand } from './john';

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

type JohnContextConfig = {
  readonly currentPath?: string;
  readonly userType?: UserType;
  readonly files?: Record<string, FileNode | null>;
};

const createMockJohnContext = (config: JohnContextConfig = {}) => {
  const { currentPath = '/', userType = 'user', files = {} } = config;

  return {
    resolvePath: (path: string) => {
      if (path.startsWith('/')) return path;
      return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
    },
    getNode: (path: string) => files[path] ?? null,
    getUserType: () => userType,
  };
};

// Helper to collect async output lines
const collectAsyncOutput = (asyncOutput: AsyncOutput): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    asyncOutput.start(
      (line) => lines.push(line),
      () => resolve(lines),
    );
  });

// --- Tests ---

describe('john command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('argument validation', () => {
    it('should throw error when no file path given', () => {
      const context = createMockJohnContext();
      const john = createJohnCommand(context);

      expect(() => john.fn()).toThrow('john: missing file operand');
    });
  });

  describe('file validation', () => {
    it('should throw error when file does not exist', () => {
      const context = createMockJohnContext({ files: {} });
      const john = createJohnCommand(context);

      expect(() => john.fn('nonexistent')).toThrow('john: nonexistent: No such file or directory');
    });

    it('should throw error when path is a directory', () => {
      const dir = createMockDirectory('etc');
      const context = createMockJohnContext({ files: { '/etc': dir } });
      const john = createJohnCommand(context);

      expect(() => john.fn('/etc')).toThrow('john: /etc: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const restrictedFile = createMockFile('passwd', 'root:hash:0:0:', {
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      });
      const context = createMockJohnContext({
        userType: 'guest',
        files: { '/etc/passwd': restrictedFile },
      });
      const john = createJohnCommand(context);

      expect(() => john.fn('/etc/passwd')).toThrow('john: /etc/passwd: Permission denied');
    });

    it('should allow root to read any file', () => {
      const hash = md5('s3cur3!');
      const restrictedFile = createMockFile('passwd', `admin:${hash}:1000:1000::/home/admin`, {
        permissions: { read: ['user'], write: ['root'], execute: ['root'] },
      });
      const context = createMockJohnContext({
        userType: 'root',
        files: { '/etc/passwd': restrictedFile },
      });
      const john = createJohnCommand(context);

      // Should not throw — returns async output
      const result = john.fn('/etc/passwd');
      expect(result).toHaveProperty('__type', 'async');
    });

    it('should throw error when no password hashes found', () => {
      const file = createMockFile('passwd', '# just comments\n\n');
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      expect(() => john.fn('/etc/passwd')).toThrow('john: /etc/passwd: No password hashes found');
    });

    it('should skip entries with placeholder hashes', () => {
      const file = createMockFile('passwd', 'root:x:0:0:root:/root\nnobody:*:65534:65534:');
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      expect(() => john.fn('/etc/passwd')).toThrow('john: /etc/passwd: No password hashes found');
    });
  });

  describe('hash cracking', () => {
    it('should crack known password hashes from the wordlist', async () => {
      const password = 's3cur3!';
      const hash = md5(password);
      const content = `admin:${hash}:1000:1000:Admin:/home/admin`;
      const file = createMockFile('passwd', content);
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      const result = john.fn('/etc/passwd') as AsyncOutput;
      const outputPromise = collectAsyncOutput(result);

      await vi.runAllTimersAsync();
      const lines = await outputPromise;

      expect(lines).toContain(`admin:${password}`);
      expect(lines).toContain('1/1 password hash cracked');
    });

    it('should crack guest passwords', async () => {
      const password = 'guest123';
      const hash = md5(password);
      const content = `visitor:${hash}:1001:1001:Visitor:/home/visitor`;
      const file = createMockFile('passwd', content);
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      const result = john.fn('/etc/passwd') as AsyncOutput;
      const outputPromise = collectAsyncOutput(result);

      await vi.runAllTimersAsync();
      const lines = await outputPromise;

      expect(lines).toContain(`visitor:${password}`);
      expect(lines).toContain('1/1 password hash cracked');
    });

    it('should report 0 cracked for unknown hashes', async () => {
      const content = 'user:deadbeefdeadbeefdeadbeefdeadbeef:1000:1000:User:/home/user';
      const file = createMockFile('passwd', content);
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      const result = john.fn('/etc/passwd') as AsyncOutput;
      const outputPromise = collectAsyncOutput(result);

      await vi.runAllTimersAsync();
      const lines = await outputPromise;

      expect(lines).toContain('0/1 password hash cracked');
    });

    it('should crack multiple hashes', async () => {
      const pw1 = 'p4ssw0rd';
      const pw2 = 'h4ck3r';
      const content = [
        `admin:${md5(pw1)}:1000:1000:Admin:/home/admin`,
        `hacker:${md5(pw2)}:1001:1001:Hacker:/home/hacker`,
      ].join('\n');
      const file = createMockFile('passwd', content);
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      const result = john.fn('/etc/passwd') as AsyncOutput;
      const outputPromise = collectAsyncOutput(result);

      await vi.runAllTimersAsync();
      const lines = await outputPromise;

      expect(lines).toContain(`admin:${pw1}`);
      expect(lines).toContain(`hacker:${pw2}`);
      expect(lines).toContain('2/2 password hashes cracked');
    });

    it('should skip comment lines and empty lines', async () => {
      const password = 'l3tm3in';
      const hash = md5(password);
      const content = ['# /etc/passwd', '', `user:${hash}:1000:1000:User:/home/user`, ''].join(
        '\n',
      );
      const file = createMockFile('passwd', content);
      const context = createMockJohnContext({ files: { '/etc/passwd': file } });
      const john = createJohnCommand(context);

      const result = john.fn('/etc/passwd') as AsyncOutput;
      const outputPromise = collectAsyncOutput(result);

      await vi.runAllTimersAsync();
      const lines = await outputPromise;

      expect(lines).toContain(`user:${password}`);
      expect(lines).toContain('1/1 password hash cracked');
    });
  });

  describe('command metadata', () => {
    it('should have correct name', () => {
      const context = createMockJohnContext();
      const john = createJohnCommand(context);

      expect(john.name).toBe('john');
    });

    it('should have description', () => {
      const context = createMockJohnContext();
      const john = createJohnCommand(context);

      expect(john.description).toBe('Crack password hashes using dictionary attack');
    });

    it('should have manual with examples', () => {
      const context = createMockJohnContext();
      const john = createJohnCommand(context);

      expect(john.manual).toBeDefined();
      expect(john.manual?.examples?.length).toBeGreaterThan(0);
    });
  });
});
