import { describe, it, expect, vi } from 'vitest';
import { createKillCommand, type KillContext } from './kill';
import type { FileNode } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import type { UserType } from '../session/SessionContext';

// Helper to create a PID file node
const pidFileNode = (name: string, content: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content,
});

// Helper to build a /var/run directory with PID files
const makeVarRunDir = (entries: Readonly<Record<string, FileNode>>): FileNode => ({
  name: 'run',
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: entries,
});

// Helper: getNodeFromMachine that returns /var/run content
const withVarRun =
  (pidFiles: Readonly<Record<string, string>>) =>
  (_machineId: string, path: string, _cwd: string): FileNode | null => {
    if (path === '/var/run') {
      return makeVarRunDir(
        Object.fromEntries(
          Object.entries(pidFiles).map(([name, content]) => [name, pidFileNode(name, content)]),
        ),
      );
    }
    return null;
  };

const makeMachine = (ports: RemoteMachine['ports'] = []): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'test',
  ports,
  users: [],
});

const createContext = (overrides: Partial<KillContext> = {}): KillContext => ({
  getMachine: () => '10.0.0.1',
  getMachineInfo: () => undefined,
  getNodeFromMachine: () => null,
  deleteNodeFromMachine: () => ({ allowed: true }),
  getUserType: () => 'root' as UserType,
  getUsername: () => 'root',
  ...overrides,
});

describe('kill command', () => {
  describe('argument parsing', () => {
    it('throws usage error with no arguments', () => {
      const cmd = createKillCommand(createContext());
      expect(() => cmd.fn()).toThrow('kill: usage: kill(pid)');
    });

    it('throws error for non-numeric PID', () => {
      const cmd = createKillCommand(createContext());
      expect(() => cmd.fn('abc')).toThrow('kill: abc: arguments must be process IDs');
    });

    it('throws error for zero PID', () => {
      const cmd = createKillCommand(createContext());
      expect(() => cmd.fn(0)).toThrow('kill: 0: arguments must be process IDs');
    });
  });

  describe('process lookup', () => {
    it('throws "No such process" for PID not in process list', () => {
      const cmd = createKillCommand(createContext());
      expect(() => cmd.fn(999)).toThrow('kill: (999): No such process');
    });

    it('throws "Operation not permitted" for PID 1 (init)', () => {
      const cmd = createKillCommand(createContext());
      expect(() => cmd.fn(1)).toThrow('kill: (1): Operation not permitted');
    });
  });

  describe('killing processes with PID files', () => {
    it('kills sshd by deleting its PID file', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({ 'sshd.pid': 'sshd:port=22' }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      // sshd gets PID 100 (first after init)
      const result = cmd.fn(100);
      expect(result).toBe('');
      expect(deleteFn).toHaveBeenCalledWith(expect.objectContaining({ path: '/var/run/sshd.pid' }));
    });

    it('kills vsftpd by deleting its PID file', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({ 'vsftpd.pid': 'vsftpd:port=21' }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      const result = cmd.fn(100);
      expect(result).toBe('');
      expect(deleteFn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/var/run/vsftpd.pid' }),
      );
    });

    it('kills nc listener by deleting its PID file', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({
            'nc-4444.pid': 'nc:port=4444,user=webadmin,userType=user,home=/home/webadmin',
          }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      const result = cmd.fn(100);
      expect(result).toBe('');
      expect(deleteFn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/var/run/nc-4444.pid' }),
      );
    });

    it('kills infrastructure daemon by deleting its PID file', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({ 'nginx.pid': '/usr/sbin/nginx:port=80' }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      const result = cmd.fn(100);
      expect(result).toBe('');
      expect(deleteFn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/var/run/nginx.pid' }),
      );
    });

    it('kills correct process when multiple PID files exist', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({
            'sshd.pid': 'sshd:port=22',
            'nginx.pid': '/usr/sbin/nginx:port=80',
            'mysqld.pid': '/usr/sbin/mysqld:port=3306',
          }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      // sshd=100, nginx=101, mysqld=102
      cmd.fn(101);
      expect(deleteFn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/var/run/nginx.pid' }),
      );
    });

    it('accepts string PID argument', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getNodeFromMachine: withVarRun({ 'sshd.pid': 'sshd:port=22' }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      cmd.fn('100');
      expect(deleteFn).toHaveBeenCalled();
    });
  });

  describe('permission checks', () => {
    it('root can kill any process', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getUserType: () => 'root',
          getNodeFromMachine: withVarRun({ 'nginx.pid': '/usr/sbin/nginx:port=80' }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      cmd.fn(100);
      expect(deleteFn).toHaveBeenCalled();
    });

    it('non-root cannot kill root-owned process', () => {
      const cmd = createKillCommand(
        createContext({
          getUserType: () => 'user',
          getUsername: () => 'alice',
          getNodeFromMachine: withVarRun({ 'sshd.pid': 'sshd:port=22' }),
        }),
      );

      // sshd is owned by root
      expect(() => cmd.fn(100)).toThrow('kill: (100): Operation not permitted');
    });

    it('non-root can kill their own nc listener', () => {
      const deleteFn = vi.fn(() => ({ allowed: true as const }));
      const cmd = createKillCommand(
        createContext({
          getUserType: () => 'user',
          getUsername: () => 'alice',
          getNodeFromMachine: withVarRun({
            'nc-8080.pid': 'nc:port=8080,user=alice,userType=user,home=/home/alice',
          }),
          deleteNodeFromMachine: deleteFn,
        }),
      );

      cmd.fn(100);
      expect(deleteFn).toHaveBeenCalled();
    });

    it('non-root cannot kill another users nc listener', () => {
      const cmd = createKillCommand(
        createContext({
          getUserType: () => 'user',
          getUsername: () => 'alice',
          getNodeFromMachine: withVarRun({
            'nc-8080.pid': 'nc:port=8080,user=bob,userType=user,home=/home/bob',
          }),
        }),
      );

      expect(() => cmd.fn(100)).toThrow('kill: (100): Operation not permitted');
    });
  });

  describe('processes without PID files (from machineInfo)', () => {
    it('throws "Operation not permitted" for backdoor nc from machineInfo only', () => {
      const cmd = createKillCommand(
        createContext({
          getMachineInfo: () =>
            makeMachine([
              {
                port: 4444,
                service: 'elite',
                serviceVersion: 'latest',
                open: true,
                owner: {
                  username: 'webadmin',
                  userType: 'user',
                  homePath: '/home/webadmin',
                },
              },
            ]),
        }),
      );

      // Backdoor nc from machineInfo gets PID 100
      expect(() => cmd.fn(100)).toThrow('kill: (100): Operation not permitted');
    });
  });

  describe('metadata', () => {
    it('has correct name and category', () => {
      const cmd = createKillCommand(createContext());
      expect(cmd.name).toBe('kill');
      expect(cmd.category).toBe('general');
    });
  });
});
