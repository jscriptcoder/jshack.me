import { describe, it, expect, vi } from 'vitest';
import { createFtpGetCommand } from './get';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

// --- Factory Functions ---

const createMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test',
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'file content',
  ...overrides,
});

type MockContextConfig = {
  readonly remoteMachine?: MachineId;
  readonly remoteCwd?: string;
  readonly remoteUserType?: UserType;
  readonly originMachine?: MachineId;
  readonly originCwd?: string;
  readonly originUserType?: UserType;
  readonly nodes?: Readonly<Record<string, FileNode | null>>;
  readonly fileContents?: Readonly<Record<string, string | null>>;
  readonly createResults?: Readonly<Record<string, PermissionResult>>;
  readonly writeResults?: Readonly<Record<string, PermissionResult>>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    remoteMachine = '192.168.1.50',
    remoteCwd = '/srv/ftp',
    remoteUserType = 'user',
    originMachine = 'localhost',
    originCwd = '/home/jshacker',
    originUserType = 'user',
    nodes = {},
    fileContents = {},
    createResults = {},
    writeResults = {},
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

  const readFileFromMachine = (
    _machineId: MachineId,
    path: string,
    _cwd: string,
    _userType: UserType,
  ): string | null => {
    return fileContents[path] ?? null;
  };

  const createFileOnMachine = vi.fn(
    (
      _machineId: MachineId,
      path: string,
      _cwd: string,
      _content: string,
      _userType: UserType,
    ): PermissionResult => {
      return createResults[path] ?? { allowed: true };
    },
  );

  const writeFileToMachine = vi.fn(
    (
      _machineId: MachineId,
      path: string,
      _cwd: string,
      _content: string,
      _userType: UserType,
    ): PermissionResult => {
      return writeResults[path] ?? { allowed: true };
    },
  );

  return {
    getRemoteMachine: () => remoteMachine,
    getRemoteCwd: () => remoteCwd,
    getRemoteUserType: () => remoteUserType,
    getOriginMachine: () => originMachine,
    getOriginCwd: () => originCwd,
    getOriginUserType: () => originUserType,
    resolvePathForMachine,
    getNodeFromMachine,
    readFileFromMachine,
    createFileOnMachine,
    writeFileToMachine,
  };
};

// --- Tests ---

describe('FTP get command', () => {
  describe('successful download', () => {
    it('should download file to current local directory', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        originCwd: '/home/jshacker',
        nodes: {
          '/srv/ftp/secret.txt': createMockFileNode({ name: 'secret.txt' }),
        },
        fileContents: {
          '/srv/ftp/secret.txt': 'secret data',
        },
      });
      const get = createFtpGetCommand(context);

      const result = get.fn('secret.txt');

      expect(result).toBe('Downloaded secret.txt (11 bytes) to /home/jshacker/secret.txt');
      expect(context.createFileOnMachine).toHaveBeenCalled();
    });

    it('should download file to specified local path', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        originCwd: '/home/jshacker',
        nodes: {
          '/srv/ftp/data.txt': createMockFileNode({ name: 'data.txt' }),
        },
        fileContents: {
          '/srv/ftp/data.txt': 'data content',
        },
      });
      const get = createFtpGetCommand(context);

      const result = get.fn('data.txt', '/tmp/downloaded.txt');

      expect(result).toBe('Downloaded data.txt (12 bytes) to /tmp/downloaded.txt');
    });

    it('should download file from absolute remote path', () => {
      const context = createMockContext({
        remoteCwd: '/home/ftpuser',
        originCwd: '/home/jshacker',
        nodes: {
          '/srv/ftp/pub/file.txt': createMockFileNode({ name: 'file.txt' }),
        },
        fileContents: {
          '/srv/ftp/pub/file.txt': 'content',
        },
      });
      const get = createFtpGetCommand(context);

      const result = get.fn('/srv/ftp/pub/file.txt');

      expect(result).toBe('Downloaded file.txt (7 bytes) to /home/jshacker/file.txt');
    });

    it('should overwrite existing local file', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        originCwd: '/home/jshacker',
        nodes: {
          '/srv/ftp/update.txt': createMockFileNode({ name: 'update.txt' }),
          '/home/jshacker/update.txt': createMockFileNode({ name: 'update.txt' }),
        },
        fileContents: {
          '/srv/ftp/update.txt': 'new content',
        },
      });
      const get = createFtpGetCommand(context);

      const result = get.fn('update.txt');

      expect(result).toBe('Downloaded update.txt (11 bytes) to /home/jshacker/update.txt');
      expect(context.writeFileToMachine).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when no remote file given', () => {
      const context = createMockContext();
      const get = createFtpGetCommand(context);

      expect(() => get.fn()).toThrow('get: missing remote file argument');
    });

    it('should throw error when remote file does not exist', () => {
      const context = createMockContext({
        nodes: {},
      });
      const get = createFtpGetCommand(context);

      expect(() => get.fn('missing.txt')).toThrow('get: missing.txt: No such file or directory');
    });

    it('should throw error when remote path is a directory', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp/subdir': createMockFileNode({
            name: 'subdir',
            type: 'directory',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user'],
              execute: ['root', 'user', 'guest'],
            },
          }),
        },
      });
      const get = createFtpGetCommand(context);

      expect(() => get.fn('subdir')).toThrow('get: subdir: Is a directory');
    });

    it('should throw error when cannot read remote file', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp/protected.txt': createMockFileNode({ name: 'protected.txt' }),
        },
        fileContents: {
          '/srv/ftp/protected.txt': null,
        },
      });
      const get = createFtpGetCommand(context);

      expect(() => get.fn('protected.txt')).toThrow('get: protected.txt: Permission denied');
    });

    it('should throw error when local destination is a directory', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        originCwd: '/home/jshacker',
        nodes: {
          '/srv/ftp/file.txt': createMockFileNode({ name: 'file.txt' }),
          '/home/jshacker/file.txt': createMockFileNode({
            name: 'file.txt',
            type: 'directory',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user'],
              execute: ['root', 'user', 'guest'],
            },
          }),
        },
        fileContents: {
          '/srv/ftp/file.txt': 'content',
        },
      });
      const get = createFtpGetCommand(context);

      expect(() => get.fn('file.txt')).toThrow('Is a directory');
    });

    it('should throw error when cannot create local file', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        originCwd: '/root',
        originUserType: 'guest',
        nodes: {
          '/srv/ftp/file.txt': createMockFileNode({ name: 'file.txt' }),
        },
        fileContents: {
          '/srv/ftp/file.txt': 'content',
        },
        createResults: {
          '/root/file.txt': { allowed: false, error: 'Permission denied' },
        },
      });
      const get = createFtpGetCommand(context);

      expect(() => get.fn('file.txt')).toThrow('Permission denied');
    });
  });
});
