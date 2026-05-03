import { describe, it, expect, vi } from 'vitest';
import { createFtpLcdCommand } from './lcd';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/types';
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
};

const createMockContext = (config: MockContextConfig = {}) => {
  const {
    originMachine = 'localhost',
    originCwd = '/home/jshacker',
    originUserType = 'user',
    nodes = {},
  } = config;

  const setOriginCwd = vi.fn();

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
    getOriginMachine: () => originMachine,
    getOriginCwd: () => originCwd,
    getOriginUserType: () => originUserType,
    setOriginCwd,
    resolvePathForMachine,
    getNodeFromMachine,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('FTP lcd command', () => {
  describe('successful directory change', () => {
    it('should change to absolute path', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/tmp': createMockFileNode({ name: 'tmp' }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('/tmp');

      expect(result).toBe('Local directory changed to /tmp');
      expect(context.setOriginCwd).toHaveBeenCalledWith('/tmp');
    });

    it('should change to relative path', () => {
      const context = createMockContext({
        originCwd: '/home',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('jshacker');

      expect(result).toBe('Local directory changed to /home/jshacker');
      expect(context.setOriginCwd).toHaveBeenCalledWith('/home/jshacker');
    });

    it('should change to parent directory with ..', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home': createMockFileNode({ name: 'home' }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('..');

      expect(result).toBe('Local directory changed to /home');
      expect(context.setOriginCwd).toHaveBeenCalledWith('/home');
    });

    it('should change to root directory', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/': createMockFileNode({ name: '/' }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('/');

      expect(result).toBe('Local directory changed to /');
      expect(context.setOriginCwd).toHaveBeenCalledWith('/');
    });

    it('should stay in current directory when no path given', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {
          '/home/jshacker': createMockFileNode({ name: 'jshacker' }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn();

      expect(result).toBe('Local directory changed to /home/jshacker');
      expect(context.setOriginCwd).toHaveBeenCalledWith('/home/jshacker');
    });
  });

  describe('error handling', () => {
    it('should throw error when path does not exist', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {},
      });
      const lcd = createFtpLcdCommand(context);

      expect(() => lcd.fn('/nonexistent')).toThrow('lcd: /nonexistent: No such file or directory');
    });

    it('should throw error when path is a file', () => {
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
      const lcd = createFtpLcdCommand(context);

      expect(() => lcd.fn('notes.txt')).toThrow('lcd: notes.txt: Not a directory');
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
      const lcd = createFtpLcdCommand(context);

      expect(() => lcd.fn('/root')).toThrow('lcd: /root: Permission denied');
    });

    it('should throw error for relative path that does not exist', () => {
      const context = createMockContext({
        originCwd: '/home/jshacker',
        nodes: {},
      });
      const lcd = createFtpLcdCommand(context);

      expect(() => lcd.fn('downloads')).toThrow('lcd: downloads: No such file or directory');
    });
  });

  describe('permission checks', () => {
    it('should allow root to access any directory', () => {
      const context = createMockContext({
        originCwd: '/',
        originUserType: 'root',
        nodes: {
          '/secret': createMockFileNode({
            name: 'secret',
            permissions: {
              read: ['root'],
              write: ['root'],
              execute: ['root'],
            },
          }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('/secret');

      expect(result).toBe('Local directory changed to /secret');
    });

    it('should allow user with read permission', () => {
      const context = createMockContext({
        originCwd: '/',
        originUserType: 'user',
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
      const lcd = createFtpLcdCommand(context);

      const result = lcd.fn('shared');

      expect(result).toBe('Local directory changed to /shared');
    });

    it('should deny guest without read permission', () => {
      const context = createMockContext({
        originCwd: '/',
        originUserType: 'guest',
        nodes: {
          '/private': createMockFileNode({
            name: 'private',
            permissions: {
              read: ['root', 'user'],
              write: ['root'],
              execute: ['root', 'user'],
            },
          }),
        },
      });
      const lcd = createFtpLcdCommand(context);

      expect(() => lcd.fn('private')).toThrow('lcd: private: Permission denied');
    });
  });
});
