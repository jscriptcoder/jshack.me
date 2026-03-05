import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createNcCdCommand } from './cd';

// --- Factory Functions ---

const createMockDirectory = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
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

const createMockFile = (name: string): FileNode => ({
  name,
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'test content',
});

type NcCdContextConfig = {
  readonly machine?: MachineId;
  readonly cwd?: string;
  readonly userType?: UserType;
  readonly nodes?: Record<string, FileNode | null>;
};

const createMockNcCdContext = (config: NcCdContextConfig = {}) => {
  const {
    machine = '203.0.113.42' as MachineId,
    cwd = '/home/ghost',
    userType = 'user',
    nodes = {},
  } = config;

  const resolvePath = (path: string, currentCwd: string): string => {
    if (path.startsWith('/')) return path;
    if (path.startsWith('../')) {
      const cwdParts = currentCwd.split('/').filter(Boolean);
      cwdParts.pop();
      const remaining = path.slice(3);
      const parentDir = '/' + cwdParts.join('/');
      return remaining
        ? parentDir === '/'
          ? `/${remaining}`
          : `${parentDir}/${remaining}`
        : parentDir || '/';
    }
    if (path === '..') {
      const parts = currentCwd.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/') || '/';
    }
    return currentCwd === '/' ? `/${path}` : `${currentCwd}/${path}`;
  };

  const setCwd = vi.fn();

  return {
    getMachine: () => machine,
    getCwd: () => cwd,
    getUserType: () => userType,
    setCwd,
    resolvePath,
    getNodeFromMachine: (_machineId: MachineId, path: string, _cwd: string) => nodes[path] ?? null,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('nc cd command', () => {
  describe('changing directory', () => {
    it('should change to root when no argument given', () => {
      const rootDir = createMockDirectory('/');

      const context = createMockNcCdContext({
        cwd: '/home/ghost',
        nodes: { '/': rootDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn();

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/');
    });

    it('should change to absolute path', () => {
      const varDir = createMockDirectory('var');

      const context = createMockNcCdContext({
        cwd: '/home/ghost',
        nodes: { '/var': varDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('/var');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/var');
    });

    it('should change to relative path', () => {
      const subdir = createMockDirectory('subdir');

      const context = createMockNcCdContext({
        cwd: '/home/ghost',
        nodes: { '/home/ghost/subdir': subdir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('subdir');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/home/ghost/subdir');
    });

    it('should change to parent directory with ..', () => {
      const homeDir = createMockDirectory('home');

      const context = createMockNcCdContext({
        cwd: '/home/ghost',
        nodes: { '/home': homeDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('..');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/home');
    });

    it('should handle ../subdir paths', () => {
      const otherDir = createMockDirectory('other');

      const context = createMockNcCdContext({
        cwd: '/home/ghost/subdir',
        nodes: { '/home/ghost/other': otherDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('../other');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/home/ghost/other');
    });

    it('should handle going to root from nested directory', () => {
      const rootDir = createMockDirectory('/');

      const context = createMockNcCdContext({
        cwd: '/home/ghost/deep/nested',
        nodes: { '/': rootDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('/');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent directory', () => {
      const context = createMockNcCdContext({
        nodes: {},
      });

      const cd = createNcCdCommand(context);

      expect(() => cd.fn('nonexistent')).toThrow('cd: nonexistent: No such file or directory');
      expect(context.setCwd).not.toHaveBeenCalled();
    });

    it('should throw error when path is a file', () => {
      const file = createMockFile('readme.txt');

      const context = createMockNcCdContext({
        nodes: { '/home/ghost/readme.txt': file },
      });

      const cd = createNcCdCommand(context);

      expect(() => cd.fn('readme.txt')).toThrow('cd: readme.txt: Not a directory');
      expect(context.setCwd).not.toHaveBeenCalled();
    });

    it('should throw error when permission denied', () => {
      const restrictedDir = createMockDirectory('secret', {
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockNcCdContext({
        userType: 'guest',
        nodes: { '/root/secret': restrictedDir },
      });

      const cd = createNcCdCommand(context);

      expect(() => cd.fn('/root/secret')).toThrow('cd: /root/secret: Permission denied');
      expect(context.setCwd).not.toHaveBeenCalled();
    });
  });

  describe('permissions', () => {
    it('should allow root to access any directory', () => {
      const restrictedDir = createMockDirectory('secret', {
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockNcCdContext({
        userType: 'root',
        nodes: { '/root/secret': restrictedDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('/root/secret');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/root/secret');
    });

    it('should allow user to access directories with user permission', () => {
      const userDir = createMockDirectory('shared', {
        permissions: {
          read: ['root', 'user'],
          write: ['root'],
          execute: ['root', 'user'],
        },
      });

      const context = createMockNcCdContext({
        userType: 'user',
        nodes: { '/shared': userDir },
      });

      const cd = createNcCdCommand(context);
      const result = cd.fn('/shared');

      expect(result).toBe('');
      expect(context.setCwd).toHaveBeenCalledWith('/shared');
    });
  });
});
