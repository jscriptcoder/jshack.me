import { describe, it, expect, vi } from 'vitest';
import { createFtpPutCommand } from './put';
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

describe('FTP put command', () => {
  describe('successful upload', () => {
    it('should upload file to current remote directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp/uploads',
        nodes: {
          '/home/jshacker/payload.sh': createMockFileNode({ name: 'payload.sh' }),
        },
        fileContents: {
          '/home/jshacker/payload.sh': 'echo pwned',
        },
      });
      const put = createFtpPutCommand(context);

      const result = put.fn('payload.sh');

      expect(result).toBe('Uploaded payload.sh (10 bytes) to /srv/ftp/uploads/payload.sh');
      expect(context.createFileOnMachine).toHaveBeenCalled();
    });

    it('should upload file to specified remote path', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp',
        nodes: {
          '/home/jshacker/data.txt': createMockFileNode({ name: 'data.txt' }),
        },
        fileContents: {
          '/home/jshacker/data.txt': 'important data',
        },
      });
      const put = createFtpPutCommand(context);

      const result = put.fn('data.txt', '/srv/ftp/incoming/backup.txt');

      expect(result).toBe('Uploaded data.txt (14 bytes) to /srv/ftp/incoming/backup.txt');
    });

    it('should upload file from absolute local path', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp',
        nodes: {
          '/tmp/cache.dat': createMockFileNode({ name: 'cache.dat' }),
        },
        fileContents: {
          '/tmp/cache.dat': 'cached',
        },
      });
      const put = createFtpPutCommand(context);

      const result = put.fn('/tmp/cache.dat');

      expect(result).toBe('Uploaded cache.dat (6 bytes) to /srv/ftp/cache.dat');
    });

    it('should overwrite existing remote file', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp',
        nodes: {
          '/home/jshacker/update.txt': createMockFileNode({ name: 'update.txt' }),
          '/srv/ftp/update.txt': createMockFileNode({ name: 'update.txt' }),
        },
        fileContents: {
          '/home/jshacker/update.txt': 'updated content',
        },
      });
      const put = createFtpPutCommand(context);

      const result = put.fn('update.txt');

      expect(result).toBe('Uploaded update.txt (15 bytes) to /srv/ftp/update.txt');
      expect(context.writeFileToMachine).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when no local file given', () => {
      const context = createMockContext();
      const put = createFtpPutCommand(context);

      expect(() => put.fn()).toThrow('put: missing local file argument');
    });

    it('should throw error when local file does not exist', () => {
      const context = createMockContext({
        nodes: {},
      });
      const put = createFtpPutCommand(context);

      expect(() => put.fn('missing.txt')).toThrow('put: missing.txt: No such file or directory');
    });

    it('should throw error when local path is a directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker/docs': createMockFileNode({
            name: 'docs',
            type: 'directory',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user'],
              execute: ['root', 'user', 'guest'],
            },
          }),
        },
      });
      const put = createFtpPutCommand(context);

      expect(() => put.fn('docs')).toThrow('put: docs: Is a directory');
    });

    it('should throw error when cannot read local file', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker/private.txt': createMockFileNode({ name: 'private.txt' }),
        },
        fileContents: {
          '/home/jshacker/private.txt': null,
        },
      });
      const put = createFtpPutCommand(context);

      expect(() => put.fn('private.txt')).toThrow('put: private.txt: Permission denied');
    });

    it('should throw error when remote destination is a directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp',
        nodes: {
          '/home/jshacker/file.txt': createMockFileNode({ name: 'file.txt' }),
          '/srv/ftp/file.txt': createMockFileNode({
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
          '/home/jshacker/file.txt': 'content',
        },
      });
      const put = createFtpPutCommand(context);

      expect(() => put.fn('file.txt')).toThrow('Is a directory');
    });

    it('should throw error when cannot create remote file', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        remoteCwd: '/srv/ftp',
        remoteUserType: 'guest',
        nodes: {
          '/home/jshacker/file.txt': createMockFileNode({ name: 'file.txt' }),
        },
        fileContents: {
          '/home/jshacker/file.txt': 'content',
        },
        createResults: {
          '/srv/ftp/file.txt': { allowed: false, error: 'Permission denied' },
        },
      });
      const put = createFtpPutCommand(context);

      expect(() => put.fn('file.txt')).toThrow('Permission denied');
    });
  });
});
