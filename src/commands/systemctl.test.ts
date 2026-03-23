import { describe, it, expect, vi } from 'vitest';
import { executeSystemctl, type SystemctlContext } from './systemctl';
import type { FileNode } from '../filesystem/types';

const createContext = (overrides: Partial<SystemctlContext> = {}): SystemctlContext => ({
  getMachine: overrides.getMachine ?? (() => '10.0.0.1'),
  getMachineInfo: overrides.getMachineInfo ?? (() => undefined),
  getNodeFromMachine: overrides.getNodeFromMachine ?? (() => null),
  createFileOnMachine: overrides.createFileOnMachine ?? (() => ({ allowed: true })),
  deleteFileOnMachine: overrides.deleteFileOnMachine ?? (() => ({ allowed: true })),
});

const makePidFileNode = (name: string, content: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content,
});

describe('executeSystemctl', () => {
  describe('argument validation', () => {
    it('shows usage when called with no args', () => {
      const result = executeSystemctl(createContext(), []);
      expect(result).toContain('Usage');
      expect(result).toContain('start, stop, status');
    });

    it('rejects unknown action', () => {
      const result = executeSystemctl(createContext(), ['restart', 'sshd']);
      expect(result).toContain("unknown action 'restart'");
    });

    it('requires service name', () => {
      const result = executeSystemctl(createContext(), ['start']);
      expect(result).toContain('missing service name');
    });

    it('rejects unknown service', () => {
      const result = executeSystemctl(createContext(), ['start', 'nginx']);
      expect(result).toContain("unknown service 'nginx'");
    });
  });

  describe('start', () => {
    it('starts sshd on default port', () => {
      const createFileOnMachine = vi.fn(() => ({ allowed: true as const }));
      const context = createContext({ createFileOnMachine });
      const result = executeSystemctl(context, ['start', 'sshd']);
      expect(result).toContain('port 22');
      expect(createFileOnMachine).toHaveBeenCalledWith('/var/run/sshd.pid', 'sshd:port=22', 'root');
    });

    it('starts vsftpd on default port', () => {
      const createFileOnMachine = vi.fn(() => ({ allowed: true as const }));
      const context = createContext({ createFileOnMachine });
      const result = executeSystemctl(context, ['start', 'vsftpd']);
      expect(result).toContain('port 21');
      expect(createFileOnMachine).toHaveBeenCalledWith(
        '/var/run/vsftpd.pid',
        'vsftpd:port=21',
        'root',
      );
    });

    it('reports already running when pid file exists for sshd', () => {
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/sshd.pid' ? makePidFileNode('sshd.pid', 'sshd:port=22') : null,
      });
      const result = executeSystemctl(context, ['start', 'sshd']);
      expect(result).toContain('already running');
    });

    it('reports already running when pid file exists for vsftpd', () => {
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/vsftpd.pid' ? makePidFileNode('vsftpd.pid', 'vsftpd:port=21') : null,
      });
      const result = executeSystemctl(context, ['start', 'vsftpd']);
      expect(result).toContain('already running');
    });
  });

  describe('stop', () => {
    it('stops running sshd and deletes pid file', () => {
      const deleteFileOnMachine = vi.fn(() => ({ allowed: true as const }));
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/sshd.pid' ? makePidFileNode('sshd.pid', 'sshd:port=2222') : null,
        deleteFileOnMachine,
      });
      const result = executeSystemctl(context, ['stop', 'sshd']);
      expect(result).toContain('Stopping OpenSSH server');
      expect(result).toContain('port 2222');
      expect(deleteFileOnMachine).toHaveBeenCalledWith({
        machineId: '10.0.0.1',
        path: '/var/run/sshd.pid',
        cwd: '/',
        userType: 'root',
      });
    });

    it('stops running vsftpd and deletes pid file', () => {
      const deleteFileOnMachine = vi.fn(() => ({ allowed: true as const }));
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/vsftpd.pid' ? makePidFileNode('vsftpd.pid', 'vsftpd:port=21') : null,
        deleteFileOnMachine,
      });
      const result = executeSystemctl(context, ['stop', 'vsftpd']);
      expect(result).toContain('Stopping vsftpd FTP server');
      expect(result).toContain('port 21');
      expect(deleteFileOnMachine).toHaveBeenCalledWith({
        machineId: '10.0.0.1',
        path: '/var/run/vsftpd.pid',
        cwd: '/',
        userType: 'root',
      });
    });

    it('reports not running when no pid file exists', () => {
      const result = executeSystemctl(createContext(), ['stop', 'sshd']);
      expect(result).toBe('sshd is not running');
    });
  });

  describe('status', () => {
    it('shows active status when sshd is running', () => {
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/sshd.pid' ? makePidFileNode('sshd.pid', 'sshd:port=22') : null,
      });
      const result = executeSystemctl(context, ['status', 'sshd']);
      expect(result).toContain('sshd.service');
      expect(result).toContain('active (running)');
      expect(result).toContain('0.0.0.0:22');
    });

    it('shows inactive status when sshd is not running', () => {
      const result = executeSystemctl(createContext(), ['status', 'sshd']);
      expect(result).toContain('sshd.service');
      expect(result).toContain('inactive (dead)');
    });

    it('shows active status when vsftpd is running on custom port', () => {
      const context = createContext({
        getNodeFromMachine: (_machine, path) =>
          path === '/var/run/vsftpd.pid' ? makePidFileNode('vsftpd.pid', 'vsftpd:port=2121') : null,
      });
      const result = executeSystemctl(context, ['status', 'vsftpd']);
      expect(result).toContain('vsftpd.service');
      expect(result).toContain('active (running)');
      expect(result).toContain('0.0.0.0:2121');
    });

    it('shows inactive status when vsftpd is not running', () => {
      const result = executeSystemctl(createContext(), ['status', 'vsftpd']);
      expect(result).toContain('vsftpd.service');
      expect(result).toContain('inactive (dead)');
    });
  });
});
