import { describe, it, expect } from 'vitest';
import { createFtpLsCommand } from './ls';
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
  readonly remoteMachine?: MachineId;
  readonly remoteCwd?: string;
  readonly remoteUserType?: UserType;
  readonly nodes?: Readonly<Record<string, FileNode | null>>;
  readonly directoryEntries?: Readonly<Record<string, string[]>>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    remoteMachine = '192.168.1.50',
    remoteCwd = '/srv/ftp',
    remoteUserType = 'user',
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
    getRemoteMachine: () => remoteMachine,
    getRemoteCwd: () => remoteCwd,
    getRemoteUserType: () => remoteUserType,
    resolvePathForMachine,
    getNodeFromMachine,
    listDirectoryFromMachine,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('FTP ls command', () => {
  describe('listing directories', () => {
    it('should list current directory when no path given', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
        directoryEntries: {
          '/srv/ftp': ['file1.txt', 'file2.txt'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('file1.txt  file2.txt');
    });

    it('should list specified directory', () => {
      const context = createMockContext({
        remoteCwd: '/home',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
        directoryEntries: {
          '/srv/ftp': ['pub', 'incoming'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('/srv/ftp');

      expect(result).toBe('pub  incoming');
    });

    it('should list relative path', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
        directoryEntries: {
          '/srv/ftp': ['data.zip'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('ftp');

      expect(result).toBe('data.zip');
    });

    it('should return empty directory message', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
        directoryEntries: {
          '/srv/ftp': [],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('(empty directory)');
    });

    it('should add trailing slash to directories', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {
          '/srv': createMockFileNode({ name: 'srv' }),
          '/srv/ftp': createMockFileNode({ name: 'ftp', type: 'directory' }),
          '/srv/data.txt': createMockFileNode({
            name: 'data.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/srv': ['ftp', 'data.txt'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('ftp/  data.txt');
    });
  });

  describe('listing files', () => {
    it('should return file name when path is a file', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp/readme.txt': createMockFileNode({
            name: 'readme.txt',
            type: 'file',
            content: 'hello',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('readme.txt');

      expect(result).toBe('readme.txt');
    });
  });

  describe('error handling', () => {
    it('should throw error when path does not exist', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {},
      });
      const ls = createFtpLsCommand(context);

      expect(() => ls.fn('/nonexistent')).toThrow('ls: /nonexistent: No such file or directory');
    });

    it('should throw error when permission denied on directory', () => {
      const context = createMockContext({
        remoteCwd: '/',
        remoteUserType: 'guest',
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
      const ls = createFtpLsCommand(context);

      expect(() => ls.fn('/root')).toThrow('ls: /root: Permission denied');
    });

    it('should throw error when listDirectory returns null', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {
          '/srv/restricted': createMockFileNode({ name: 'restricted' }),
        },
        directoryEntries: {},
      });
      const ls = createFtpLsCommand(context);

      expect(() => ls.fn('restricted')).toThrow('ls: restricted: Permission denied');
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
          '/srv/ftp/.hidden': createMockFileNode({
            name: '.hidden',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
          '/srv/ftp/visible.txt': createMockFileNode({
            name: 'visible.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/srv/ftp': ['.hidden', 'visible.txt'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('visible.txt');
      expect(result).not.toContain('.hidden');
    });

    it('should show dotfiles with -a flag', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
          '/srv/ftp/.hidden': createMockFileNode({
            name: '.hidden',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
          '/srv/ftp/visible.txt': createMockFileNode({
            name: 'visible.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/srv/ftp': ['.hidden', 'visible.txt'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('-a');

      expect(result).toContain('.hidden');
      expect(result).toContain('visible.txt');
    });

    it('should show dotfiles with path and -a flag', () => {
      const context = createMockContext({
        remoteCwd: '/',
        nodes: {
          '/uploads': createMockFileNode({ name: 'uploads' }),
          '/uploads/.backup': createMockFileNode({
            name: '.backup',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
          '/uploads/readme.txt': createMockFileNode({
            name: 'readme.txt',
            type: 'file',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
        directoryEntries: {
          '/uploads': ['.backup', 'readme.txt'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('/uploads', '-a');

      expect(result).toContain('.backup');
      expect(result).toContain('readme.txt');
    });

    it('should show empty directory when only dotfiles exist', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
        directoryEntries: {
          '/srv/ftp': ['.hidden_only'],
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('(empty directory)');
    });
  });
});
