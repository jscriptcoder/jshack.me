import { describe, it, expect } from 'vitest';
import { listProcesses, type PsAdapter } from './ps';
import type { RemoteMachine } from '../network/types';

const createAdapter = (overrides: Partial<PsAdapter> = {}): PsAdapter => ({
  getMachineInfo: overrides.getMachineInfo ?? (() => undefined),
  readPidFile: overrides.readPidFile ?? (() => undefined),
});

const makeMachine = (ports: RemoteMachine['ports'] = []): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'test',
  ports,
  users: [],
});

describe('listProcesses', () => {
  it('always includes init as PID 1', () => {
    const processes = listProcesses(createAdapter());
    expect(processes[0]).toEqual({ pid: 1, user: 'root', command: '/sbin/init' });
  });

  it('shows sshd when sshd.pid exists', () => {
    const adapter = createAdapter({
      readPidFile: (path) => (path === '/var/run/sshd.pid' ? 'sshd:port=22' : undefined),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'root',
      command: '/usr/sbin/sshd -p 22',
    });
  });

  it('shows sshd with custom port', () => {
    const adapter = createAdapter({
      readPidFile: (path) => (path === '/var/run/sshd.pid' ? 'sshd:port=2222' : undefined),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ command: '/usr/sbin/sshd -p 2222' }),
    );
  });

  it('shows ftpd when ftpd.pid exists', () => {
    const adapter = createAdapter({
      readPidFile: (path) => (path === '/var/run/ftpd.pid' ? 'ftpd:port=21' : undefined),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'root', command: '/usr/sbin/ftpd -p 21' }),
    );
  });

  it('shows nginx for open HTTP port', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 80, service: 'http', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'www-data', command: '/usr/sbin/nginx' }),
    );
  });

  it('deduplicates nginx for multiple HTTP ports', () => {
    const adapter = createAdapter({
      getMachineInfo: () =>
        makeMachine([
          { port: 80, service: 'http', open: true },
          { port: 443, service: 'https', open: true },
          { port: 8080, service: 'http-alt', open: true },
        ]),
    });
    const processes = listProcesses(adapter);
    const nginxProcesses = processes.filter((p) => p.command.includes('nginx'));
    expect(nginxProcesses).toHaveLength(1);
  });

  it('shows mysqld for open MySQL port', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 3306, service: 'mysql', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'mysql', command: '/usr/sbin/mysqld' }),
    );
  });

  it('shows postgres for open PostgreSQL port', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 5432, service: 'postgresql', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'postgres', command: '/usr/sbin/postgres' }),
    );
  });

  it('shows ncat listener for backdoor port with owner', () => {
    const adapter = createAdapter({
      getMachineInfo: () =>
        makeMachine([
          {
            port: 4444,
            service: 'elite',
            open: true,
            owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
          },
        ]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'webadmin',
      command: '/usr/bin/ncat -lvnp 4444',
    });
  });

  it('shows ncat listener as root when backdoor has no owner', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 31337, service: 'elite', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'root',
      command: '/usr/bin/ncat -lvnp 31337',
    });
  });

  it('skips closed ports', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 80, service: 'http', open: false }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(1); // only init
  });

  it('skips unknown services', () => {
    const adapter = createAdapter({
      getMachineInfo: () => makeMachine([{ port: 22, service: 'ssh', open: true }]),
    });
    // ssh is handled via PID file, not port mapping
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(1); // only init
  });

  it('shows all processes together', () => {
    const adapter = createAdapter({
      readPidFile: (path) => {
        if (path === '/var/run/sshd.pid') return 'sshd:port=22';
        if (path === '/var/run/ftpd.pid') return 'ftpd:port=21';
        return undefined;
      },
      getMachineInfo: () =>
        makeMachine([
          { port: 80, service: 'http', open: true },
          { port: 3306, service: 'mysql', open: true },
        ]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(5); // init + sshd + ftpd + nginx + mysqld
  });
});
