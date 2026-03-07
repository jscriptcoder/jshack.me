import { describe, it, expect } from 'vitest';
import { createFtpLsCommand } from './ls';
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
  readonly remoteMachine?: MachineId;
  readonly remoteCwd?: string;
  readonly remoteUserType?: UserType;
  readonly nodes?: Readonly<Record<string, FileNode | null>>;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    remoteMachine = '192.168.1.50',
    remoteCwd = '/srv/ftp',
    remoteUserType = 'user',
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
    getRemoteMachine: () => remoteMachine,
    getRemoteCwd: () => remoteCwd,
    getRemoteUserType: () => remoteUserType,
    resolvePathForMachine,
    getNodeFromMachine: (_machineId: MachineId, path: string, _cwd: string): FileNode | null =>
      nodes[path] ?? null,
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
          '/srv/ftp': createMockDirectory('ftp', {
            'file1.txt': createMockFile('file1.txt'),
            'file2.txt': createMockFile('file2.txt'),
          }),
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
          '/srv/ftp': createMockDirectory('ftp', {
            incoming: createMockDirectory('incoming'),
            pub: createMockDirectory('pub'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('/srv/ftp');

      expect(result).toBe('incoming/  pub/');
    });

    it('should list relative path', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
            'data.zip': createMockFile('data.zip'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('ftp');

      expect(result).toBe('data.zip');
    });

    it('should return empty string for empty directory', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp'),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('');
    });

    it('should add trailing slash to directories', () => {
      const context = createMockContext({
        remoteCwd: '/srv',
        nodes: {
          '/srv': createMockDirectory('srv', {
            'data.txt': createMockFile('data.txt'),
            ftp: createMockDirectory('ftp'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('data.txt  ftp/');
    });

    it('should sort entries alphabetically', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
            'zebra.txt': createMockFile('zebra.txt'),
            'alpha.txt': createMockFile('alpha.txt'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('alpha.txt  zebra.txt');
    });
  });

  describe('listing files', () => {
    it('should return file name when path is a file', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp/readme.txt': createMockFile('readme.txt'),
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

      expect(() => ls.fn('/nonexistent')).toThrow(
        "ls: cannot access '/nonexistent': No such file or directory",
      );
    });

    it('should throw error when permission denied on directory', () => {
      const context = createMockContext({
        remoteCwd: '/',
        remoteUserType: 'guest',
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
      const ls = createFtpLsCommand(context);

      expect(() => ls.fn('/root')).toThrow("ls: cannot open directory '/root': Permission denied");
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
            '.hidden': createMockFile('.hidden'),
            'visible.txt': createMockFile('visible.txt'),
          }),
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
          '/srv/ftp': createMockDirectory('ftp', {
            '.hidden': createMockFile('.hidden'),
            'visible.txt': createMockFile('visible.txt'),
          }),
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
          '/uploads': createMockDirectory('uploads', {
            '.backup': createMockFile('.backup'),
            'readme.txt': createMockFile('readme.txt'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('/uploads', '-a');

      expect(result).toContain('.backup');
      expect(result).toContain('readme.txt');
    });

    it('should return empty string when only dotfiles exist', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
            '.hidden_only': createMockFile('.hidden_only'),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn();

      expect(result).toBe('');
    });
  });

  describe('long listing (-l flag)', () => {
    it('should show permission string, owner, and name', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
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
      const ls = createFtpLsCommand(context);

      const result = ls.fn('-l');

      expect(result).toBe('-rw-rw----  user   notes.txt');
    });

    it('should combine -l and -a flags', () => {
      const context = createMockContext({
        remoteCwd: '/srv/ftp',
        nodes: {
          '/srv/ftp': createMockDirectory('ftp', {
            '.bashrc': createMockFile('.bashrc', { owner: 'user' }),
            'visible.txt': createMockFile('visible.txt', { owner: 'user' }),
          }),
        },
      });
      const ls = createFtpLsCommand(context);

      const result = ls.fn('-la') as string;
      const lines = result.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('.bashrc');
      expect(lines[1]).toContain('visible.txt');
    });
  });
});
