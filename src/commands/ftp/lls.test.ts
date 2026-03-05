import { describe, it, expect } from 'vitest';
import { createFtpLlsCommand } from './lls';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

// --- Factory Functions ---

const createMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test',
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

type MockContextConfig = {
  readonly originMachine?: MachineId;
  readonly originCwd?: string;
  readonly originUserType?: UserType;
  readonly nodes?: Readonly<Record<string, FileNode | null>>;
  readonly directoryEntries?: Readonly<Record<string, string[]>>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    originMachine = 'localhost',
    originCwd = '/home/jshacker',
    originUserType = 'user',
    nodes = {},
    directoryEntries = {},
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

  const getNodeFromMachine = (
    _machineId: MachineId,
    path: string,
    _cwd: string,
  ): FileNode | null => {
    return nodes[path] ?? null;
  };

  const listDirectoryFromMachine = (
    _machineId: MachineId,
    path: string,
    _cwd: string,
    _userType: UserType,
  ): string[] | null => {
    return directoryEntries[path] ?? null;
  };

  return {
    getOriginMachine: () => originMachine,
    getOriginCwd: () => originCwd,
    getOriginUserType: () => originUserType,
    resolvePathForMachine,
    getNodeFromMachine,
    listDirectoryFromMachine,
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
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
        directoryEntries: {
          '/home/jshacker': ['notes.txt', 'downloads'],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('notes.txt  downloads');
    });

    it('should list specified directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/tmp': createMockFileNode({ name: 'tmp' }),
        },
        directoryEntries: {
          '/tmp': ['cache', 'session.dat'],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('/tmp');

      expect(result).toBe('cache  session.dat');
    });

    it('should list relative path', () => {
      const context = createMockContext({
        originCwd: '/home',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
        directoryEntries: {
          '/home/jshacker': ['file.txt'],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('jshacker');

      expect(result).toBe('file.txt');
    });

    it('should return empty directory message', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
        directoryEntries: {
          '/home/jshacker': [],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('(empty directory)');
    });

    it('should add trailing slash to directories', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
          '/home/jshacker/docs': createMockFileNode({ name: 'docs', type: 'directory' }),
          '/home/jshacker/notes.txt': createMockFileNode({
            name: 'notes.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/home/jshacker': ['docs', 'notes.txt'],
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
          '/home/jshacker/notes.txt': createMockFileNode({
            name: 'notes.txt',
            type: 'file',
            content: 'my notes',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
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

      expect(() => lls.fn('/nonexistent')).toThrow('lls: /nonexistent: No such file or directory');
    });

    it('should throw error when permission denied', () => {
      const context = createMockContext({
        originCwd: '/',
        originUserType: 'guest',
        nodes: {
          '/root': createMockFileNode({
            name: 'root',
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const lls = createFtpLlsCommand(context);

      expect(() => lls.fn('/root')).toThrow('lls: /root: Permission denied');
    });

    it('should throw error when listDirectory returns null', () => {
      const context = createMockContext({
        originCwd: '/home',
        nodes: {
          '/home/private': createMockFileNode({ name: 'private' }),
        },
        directoryEntries: {},
      });
      const lls = createFtpLlsCommand(context);

      expect(() => lls.fn('private')).toThrow('lls: private: Permission denied');
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
          '/home/jshacker/.mission': createMockFileNode({
            name: '.mission',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
          '/home/jshacker/README.txt': createMockFileNode({
            name: 'README.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/home/jshacker': ['.mission', 'README.txt'],
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
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
          '/home/jshacker/.mission': createMockFileNode({
            name: '.mission',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
          '/home/jshacker/README.txt': createMockFileNode({
            name: 'README.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/home/jshacker': ['.mission', 'README.txt'],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn('-a');

      expect(result).toContain('.mission');
      expect(result).toContain('README.txt');
    });

    it('should show empty directory when only dotfiles exist', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
        directoryEntries: {
          '/home/jshacker': ['.hidden_only'],
        },
      });
      const lls = createFtpLlsCommand(context);

      const result = lls.fn();

      expect(result).toBe('(empty directory)');
    });
  });
});
