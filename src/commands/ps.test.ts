import { describe, it, expect } from 'vitest';
import { listProcesses, type PsAdapter } from './ps';
import type { RemoteMachine } from '../network/types';

const createAdapter = (overrides: Partial<PsAdapter> = {}): PsAdapter => ({
  getMachineInfo: overrides.getMachineInfo ?? (() => undefined),
  readDirectory: overrides.readDirectory ?? (() => undefined),
});

const makeMachine = (ports: RemoteMachine['ports'] = []): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'test',
  ports,
  users: [],
});

// Helper to build a /var/run directory with PID files
const varRun =
  (entries: Readonly<Record<string, string>>) =>
  (path: string): Readonly<Record<string, string>> | undefined =>
    path === '/var/run' ? entries : undefined;

describe('listProcesses', () => {
  it('always includes init as PID 1', () => {
    const processes = listProcesses(createAdapter());
    expect(processes[0]).toEqual({ pid: 1, user: 'root', command: '/sbin/init' });
  });

  it('shows sshd when sshd.pid exists', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'sshd.pid': 'sshd:port=22' }),
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
      readDirectory: varRun({ 'sshd.pid': 'sshd:port=2222' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ command: '/usr/sbin/sshd -p 2222' }),
    );
  });

  it('shows vsftpd when vsftpd.pid exists', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'vsftpd.pid': 'vsftpd:port=21' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'root', command: '/usr/sbin/vsftpd -p 21' }),
    );
  });

  it('shows nginx when nginx.pid exists', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'nginx.pid': '/usr/sbin/nginx:port=80' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'www-data', command: '/usr/sbin/nginx' }),
    );
  });

  it('deduplicates nginx via single PID file even with multiple HTTP ports', () => {
    // nginx.pid is only written once regardless of how many HTTP ports exist
    const adapter = createAdapter({
      readDirectory: varRun({ 'nginx.pid': '/usr/sbin/nginx:port=80' }),
    });
    const processes = listProcesses(adapter);
    const nginxProcesses = processes.filter((p) => p.command.includes('nginx'));
    expect(nginxProcesses).toHaveLength(1);
  });

  it('shows mysqld when mysqld.pid exists', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'mysqld.pid': '/usr/sbin/mysqld:port=3306' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'mysql', command: '/usr/sbin/mysqld' }),
    );
  });

  it('shows postgres when postgres.pid exists', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'postgres.pid': '/usr/sbin/postgres:port=5432' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'postgres', command: '/usr/sbin/postgres' }),
    );
  });

  it('shows nc listener for backdoor port with owner', () => {
    const adapter = createAdapter({
      getMachineInfo: () =>
        makeMachine([
          {
            port: 4444,
            service: 'elite',
            serviceVersion: 'latest',
            open: true,
            owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
          },
        ]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'webadmin',
      command: '/usr/bin/nc -lvnp 4444',
    });
  });

  it('shows nc listener as root when backdoor has no owner', () => {
    const adapter = createAdapter({
      getMachineInfo: () =>
        makeMachine([{ port: 31337, service: 'elite', serviceVersion: 'latest', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'root',
      command: '/usr/bin/nc -lvnp 31337',
    });
  });

  it('shows nc listener from PID file when machineInfo is unavailable', () => {
    const adapter = createAdapter({
      readDirectory: varRun({
        'nc-8888.pid': 'nc:port=8888,user=webadmin,userType=user,home=/home/webadmin',
      }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual({
      pid: 100,
      user: 'webadmin',
      command: '/usr/bin/nc -lvnp 8888',
    });
  });

  it('shows multiple nc listeners from PID files', () => {
    const adapter = createAdapter({
      readDirectory: varRun({
        'nc-4444.pid': 'nc:port=4444,user=root,userType=root,home=/root',
        'nc-8888.pid': 'nc:port=8888,user=ftpuser,userType=guest,home=/home/ftpuser',
        'sshd.pid': 'sshd:port=22',
      }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'root', command: '/usr/bin/nc -lvnp 4444' }),
    );
    expect(processes).toContainEqual(
      expect.objectContaining({ user: 'ftpuser', command: '/usr/bin/nc -lvnp 8888' }),
    );
  });

  it('shows no daemons when /var/run has no PID files', () => {
    const adapter = createAdapter({
      getMachineInfo: () =>
        makeMachine([{ port: 80, service: 'http', serviceVersion: 'latest', open: true }]),
    });
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(1); // only init
  });

  it('skips non-.pid files in /var/run', () => {
    const adapter = createAdapter({
      readDirectory: varRun({ 'sshd.log': 'sshd:port=22', 'status.txt': 'running' }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(1); // only init
  });

  it('shows all processes together from PID files', () => {
    const adapter = createAdapter({
      readDirectory: varRun({
        'sshd.pid': 'sshd:port=22',
        'vsftpd.pid': 'vsftpd:port=21',
        'nginx.pid': '/usr/sbin/nginx:port=80',
        'mysqld.pid': '/usr/sbin/mysqld:port=3306',
      }),
    });
    const processes = listProcesses(adapter);
    expect(processes).toHaveLength(5); // init + sshd + vsftpd + nginx + mysqld
  });
});
