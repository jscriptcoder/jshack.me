import { describe, it, expect } from 'vitest';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createNcCatCommand } from './cat';

// --- Factory Functions ---

const createMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test',
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'test content',
  ...overrides,
});

const createMockDirectory = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
});

type NcCatContextConfig = {
  readonly machine?: MachineId;
  readonly cwd?: string;
  readonly userType?: UserType;
  readonly nodes?: Record<string, FileNode | null>;
  readonly fileContents?: Record<string, string | null>;
};

const createMockNcCatContext = (config: NcCatContextConfig = {}) => {
  const {
    machine = '203.0.113.42' as MachineId,
    cwd = '/home/ghost',
    userType = 'user',
    nodes = {},
    fileContents = {},
  } = config;

  const resolvePath = (path: string, currentCwd: string): string => {
    if (path.startsWith('/')) return path;
    if (path.startsWith('../')) {
      const cwdParts = currentCwd.split('/').filter(Boolean);
      cwdParts.pop();
      const remaining = path.slice(3);
      const parentDir = '/' + cwdParts.join('/');
      return parentDir === '/' ? `/${remaining}` : `${parentDir}/${remaining}`;
    }
    if (path === '..') {
      const parts = currentCwd.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/');
    }
    return currentCwd === '/' ? `/${path}` : `${currentCwd}/${path}`;
  };

  return {
    getMachine: () => machine,
    getCwd: () => cwd,
    getUserType: () => userType,
    resolvePath,
    getNodeFromMachine: (_machineId: MachineId, path: string, _cwd: string) => nodes[path] ?? null,
    readFileFromMachine: (_machineId: MachineId, path: string, _cwd: string, _userType: UserType) =>
      fileContents[path] ?? null,
  };
};

// --- Tests ---

describe('nc cat command', () => {
  describe('displaying file contents', () => {
    it('should display file content', () => {
      const file = createMockFileNode({
        name: 'notes.txt',
        content: 'secret notes',
      });

      const context = createMockNcCatContext({
        nodes: { '/home/ghost/notes.txt': file },
        fileContents: { '/home/ghost/notes.txt': 'secret notes' },
      });

      const cat = createNcCatCommand(context);
      const result = cat.fn('notes.txt');

      expect(result).toBe('secret notes');
    });

    it('should handle absolute paths', () => {
      const file = createMockFileNode({
        name: 'flag.txt',
        content: 'FLAG{found_it}',
      });

      const context = createMockNcCatContext({
        cwd: '/tmp',
        nodes: { '/home/ghost/flag.txt': file },
        fileContents: { '/home/ghost/flag.txt': 'FLAG{found_it}' },
      });

      const cat = createNcCatCommand(context);
      const result = cat.fn('/home/ghost/flag.txt');

      expect(result).toBe('FLAG{found_it}');
    });

    it('should handle relative paths with parent directory', () => {
      const file = createMockFileNode({
        name: 'config',
        content: 'settings',
      });

      const context = createMockNcCatContext({
        cwd: '/home/ghost/subdir',
        nodes: { '/home/ghost/config': file },
        fileContents: { '/home/ghost/config': 'settings' },
      });

      const cat = createNcCatCommand(context);
      const result = cat.fn('../config');

      expect(result).toBe('settings');
    });

    it('should preserve multiline content', () => {
      const file = createMockFileNode({
        name: 'log.txt',
        content: 'line 1\nline 2\nline 3',
      });

      const context = createMockNcCatContext({
        nodes: { '/var/log/log.txt': file },
        fileContents: { '/var/log/log.txt': 'line 1\nline 2\nline 3' },
      });

      const cat = createNcCatCommand(context);
      const result = cat.fn('/var/log/log.txt');

      expect(result).toBe('line 1\nline 2\nline 3');
    });

    it('should return empty string for empty file', () => {
      const file = createMockFileNode({
        name: 'empty.txt',
        content: '',
      });

      const context = createMockNcCatContext({
        nodes: { '/home/ghost/empty.txt': file },
        fileContents: { '/home/ghost/empty.txt': '' },
      });

      const cat = createNcCatCommand(context);
      const result = cat.fn('empty.txt');

      expect(result).toBe('');
    });
  });

  describe('error handling', () => {
    it('should throw error when no filename given', () => {
      const context = createMockNcCatContext();
      const cat = createNcCatCommand(context);

      expect(() => cat.fn()).toThrow('cat: missing filename');
    });

    it('should throw error for non-existent file', () => {
      const context = createMockNcCatContext({
        nodes: {},
      });

      const cat = createNcCatCommand(context);

      expect(() => cat.fn('nonexistent.txt')).toThrow(
        'cat: nonexistent.txt: No such file or directory',
      );
    });

    it('should throw error when path is a directory', () => {
      const dir = createMockDirectory('subdir');

      const context = createMockNcCatContext({
        nodes: { '/home/ghost/subdir': dir },
      });

      const cat = createNcCatCommand(context);

      expect(() => cat.fn('subdir')).toThrow('cat: subdir: Is a directory');
    });

    it('should throw error when permission denied', () => {
      const file = createMockFileNode({
        name: 'secret.txt',
      });

      const context = createMockNcCatContext({
        userType: 'guest',
        nodes: { '/root/secret.txt': file },
        fileContents: { '/root/secret.txt': null },
      });

      const cat = createNcCatCommand(context);

      expect(() => cat.fn('/root/secret.txt')).toThrow('cat: /root/secret.txt: Permission denied');
    });
  });
});
