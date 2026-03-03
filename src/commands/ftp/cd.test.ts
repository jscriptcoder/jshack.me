import { describe, it, expect, vi } from 'vitest';
import { createFtpCdCommand } from './cd';
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
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    remoteMachine = '192.168.1.50',
    remoteCwd = '/home/ftpuser',
    remoteUserType = 'user',
    nodes = {},
  } = config;

  const setRemoteCwd = vi.fn();

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

  return {
    getRemoteMachine: () => remoteMachine,
    getRemoteCwd: () => remoteCwd,
    getRemoteUserType: () => remoteUserType,
    setRemoteCwd,
    resolvePathForMachine,
    getNodeFromMachine,
  };
};

// --- Tests ---

describe('FTP cd command', () => {
  describe('successful directory change', () => {
    it('should change to absolute path', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {
          '/srv/ftp': createMockFileNode({ name: 'ftp' }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('/srv/ftp');

      expect(result).toBe('Remote directory changed to /srv/ftp');
      expect(context.setRemoteCwd).toHaveBeenCalledWith('/srv/ftp');
    });

    it('should change to relative path', () => {
      const context = createMockContext({
        remoteCwd: '/home',
        nodes: {
          '/home/ftpuser': createMockFileNode({ name: 'ftpuser' }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('ftpuser');

      expect(result).toBe('Remote directory changed to /home/ftpuser');
      expect(context.setRemoteCwd).toHaveBeenCalledWith('/home/ftpuser');
    });

    it('should change to parent directory with ..', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {
          '/home': createMockFileNode({ name: 'home' }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('..');

      expect(result).toBe('Remote directory changed to /home');
      expect(context.setRemoteCwd).toHaveBeenCalledWith('/home');
    });

    it('should change to root directory', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {
          '/': createMockFileNode({ name: '/' }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('/');

      expect(result).toBe('Remote directory changed to /');
      expect(context.setRemoteCwd).toHaveBeenCalledWith('/');
    });

    it('should stay in current directory when no path given', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {
          '/home/ftpuser': createMockFileNode({ name: 'ftpuser' }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn();

      expect(result).toBe('Remote directory changed to /home/ftpuser');
      expect(context.setRemoteCwd).toHaveBeenCalledWith('/home/ftpuser');
    });
  });

  describe('error handling', () => {
    it('should throw error when path does not exist', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {},
      });
      const cd = createFtpCdCommand(context);

      expect(() => cd.fn('/nonexistent')).toThrow('cd: /nonexistent: No such file or directory');
    });

    it('should throw error when path is a file', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        nodes: {
          '/home/ftpuser/file.txt': createMockFileNode({
            name: 'file.txt',
            type: 'file',
            content: 'test content',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const cd = createFtpCdCommand(context);

      expect(() => cd.fn('file.txt')).toThrow('cd: file.txt: Not a directory');
    });

    it('should throw error when permission denied', () => {
      const context = createMockContext({
        remoteCwd: '/home',
        remoteUserType: 'guest',
        nodes: {
          '/home/private': createMockFileNode({
            name: 'private',
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const cd = createFtpCdCommand(context);

      expect(() => cd.fn('private')).toThrow('cd: private: Permission denied');
    });

    it('should throw error for relative path that does not exist', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {},
      });
      const cd = createFtpCdCommand(context);

      expect(() => cd.fn('missing')).toThrow('cd: missing: No such file or directory');
    });
  });

  describe('permission checks', () => {
    it('should allow root to access any directory', () => {
      const context = createMockContext({
        remoteCwd: '/home',
        remoteUserType: 'root',
        nodes: {
          '/home/restricted': createMockFileNode({
            name: 'restricted',
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('restricted');

      expect(result).toBe('Remote directory changed to /home/restricted');
    });

    it('should allow user with read permission', () => {
      const context = createMockContext({
        remoteCwd: '/',
        remoteUserType: 'user',
        nodes: {
          '/shared': createMockFileNode({
            name: 'shared',
            permissions: {
              read: ['root', 'user'],
              write: ['root'],
              execute: ['root', 'user'],
            },
          }),
        },
      });
      const cd = createFtpCdCommand(context);

      const result = cd.fn('shared');

      expect(result).toBe('Remote directory changed to /shared');
    });

    it('should deny guest without read permission', () => {
      const context = createMockContext({
        remoteCwd: '/',
        remoteUserType: 'guest',
        nodes: {
          '/admin': createMockFileNode({
            name: 'admin',
            permissions: {
              read: ['root', 'user'],
              write: ['root'],
              execute: ['root', 'user'],
            },
          }),
        },
      });
      const cd = createFtpCdCommand(context);

      expect(() => cd.fn('admin')).toThrow('cd: admin: Permission denied');
    });
  });
});
