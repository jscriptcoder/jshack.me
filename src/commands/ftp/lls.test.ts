import { describe, it, expect } from 'vitest';
import { createFtpLlsCommand } from './lls';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

// --- Factory Functions ---

const createMockFile = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  content: 'test content',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root'],
  },
  ...overrides,
});

const createMockDirectory = (
  name: string,
  children: Record<string, FileNode> = {},
  overrides?: Partial<FileNode>,
): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
  ...overrides,
});

type MockContextConfig = {
  readonly originMachine?: MachineId;
  readonly originCwd?: string;
  readonly originUserType?: UserType;
  readonly nodes?: Readonly<Record<string, FileNode | null>>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    originMachine = 'localhost',
    originCwd = '/home/jshacker',
    originUserType = 'user',
    nodes = {},
  } = config;

  const resolvePathForMachine = (path: string, cwd: string): string => {
    if (path.startsWith('/')) return path;
    if (path === '..') {
      const parts = cwd.split('/').filter(Boolean);
      return '/' + parts.slice(0, -1).join('/') || '/';
    }
    if (path === '.') return cwd;
    return cwd === '/' ? `/${path}` : `${cwd}/${path}`;
  };

  return {
    getOriginMachine: () => originMachine,
    getOriginCwd: () => originCwd,
    getOriginUserType: () => originUserType,
    resolvePathForMachine,
    getNodeFromMachine: (_machineId: MachineId, path: string, _cwd: string): FileNode | null =>
      nodes[path] ?? null,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('FTP lls command', () => {
  describe('listing directories', () => {
    it('should list current directory when no path given', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            downloads: createMockDirectory('downloads'),
            'notes.txt': createMockFile('notes.txt'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('downloads/  notes.txt');
    });

    it('should list specified directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/tmp': createMockDirectory('tmp', {
            cache: createMockDirectory('cache'),
            'session.dat': createMockFile('session.dat'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('/tmp');

      expect(result).toBe('cache/  session.dat');
    });

    it('should list relative path', () => {
      const context = createMockContext({
        originCwd: '/home',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            'file.txt': createMockFile('file.txt'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('jshacker');

      expect(result).toBe('file.txt');
    });

    it('should return empty string for empty directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker'),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('');
    });

    it('should add trailing slash to directories', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            docs: createMockDirectory('docs'),
            'notes.txt': createMockFile('notes.txt'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('docs/  notes.txt');
    });
  });

  describe('listing files', () => {
    it('should return file name when path is a file', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker/notes.txt': createMockFile('notes.txt'),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('notes.txt');

      expect(result).toBe('notes.txt');
    });
  });

  describe('error handling', () => {
    it('should throw error when path does not exist', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {},
      });
      const lls = createFtpLlsCommand(context);

      expect(() => lls.fn('/nonexistent')).toThrow(
        "lls: cannot access '/nonexistent': No such file or directory",
      );
    });

    it('should throw error when permission denied', () => {
      const context = createMockContext({
        originCwd: '/',
        originUserType: 'guest',
        nodes: {
          '/root': createMockDirectory(
            'root',
            {},
            {
              permissions: {
                read: ['root'],
                write: ['root'],
                execute: ['root'],
              },
            },
          ),
        },
      });
      const lls = createFtpLlsCommand(context);

      expect(() => lls.fn('/root')).toThrow(
        "lls: cannot open directory '/root': Permission denied",
      );
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            '.mission': createMockFile('.mission'),
            'README.txt': createMockFile('README.txt'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('README.txt');
      expect(result).not.toContain('.mission');
    });

    it('should show dotfiles with -a flag', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            '.mission': createMockFile('.mission'),
            'README.txt': createMockFile('README.txt'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('-a');

      expect(result).toContain('.mission');
      expect(result).toContain('README.txt');
    });

    it('should return empty string when only dotfiles exist', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            '.hidden_only': createMockFile('.hidden_only'),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('');
    });
  });

  describe('long listing (-l flag)', () => {
    it('should show permission string, owner, and name', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockDirectory('jshacker', {
            'notes.txt': createMockFile('notes.txt', {
              owner: 'user',
              permissions: {
                read: ['root', 'user'],
                write: ['root', 'user'],
                execute: ['root'],
              },
            }),
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('-l');

      expect(result).toBe('-rw-rw----  user   notes.txt');
    });
  });
});
