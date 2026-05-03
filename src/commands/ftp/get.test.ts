import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFtpGetCommand } from './get';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/types';
import type { MachineId } from '../../filesystem/machineFileSystems';
import type { AsyncOutput } from '../../components/Terminal/types';

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

  const readFileFromMachine = ({ path }: { readonly path: string }): string | null => {
    return fileContents[path] ?? null;
  };

  const createFileOnMachine = vi.fn(({ path }: { readonly path: string }): PermissionResult => {
    return createResults[path] ?? { allowed: true };
  });

  const writeFileToMachine = vi.fn(({ path }: { readonly path: string }): PermissionResult => {
    return writeResults[path] ?? { allowed: true };
  });

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

// Runs an AsyncOutput to completion with fake timers, collecting output lines
const runAsync = (output: AsyncOutput): readonly string[] => {
  const lines: string[] = [];
  output.start(
    (line) => lines.push(line),
    () => {},
  );
  vi.runAllTimers();
  return lines;
};

// --- Tests ---

describe('FTP get command', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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

      const result = get.fn('secret.txt') as AsyncOutput;
      const lines = runAsync(result);

      expect(lines.some((l) => l.includes('226 Transfer complete'))).toBe(true);
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

      const result = get.fn('data.txt', '/tmp/downloaded.txt') as AsyncOutput;
      const lines = runAsync(result);

      expect(lines.some((l) => l.includes('226 Transfer complete'))).toBe(true);
      expect(lines.some((l) => l.includes('12 bytes received'))).toBe(true);
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

      const result = get.fn('/srv/ftp/pub/file.txt') as AsyncOutput;
      const lines = runAsync(result);

      expect(lines.some((l) => l.includes('226 Transfer complete'))).toBe(true);
      expect(lines.some((l) => l.includes('7 bytes received'))).toBe(true);
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

      const result = get.fn('update.txt') as AsyncOutput;
      const lines = runAsync(result);

      expect(lines.some((l) => l.includes('226 Transfer complete'))).toBe(true);
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

    it('should show error when cannot create local file', () => {
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

      const result = get.fn('file.txt') as AsyncOutput;
      const lines = runAsync(result);

      expect(lines.some((l) => l.includes('Permission denied'))).toBe(true);
    });
  });
});
