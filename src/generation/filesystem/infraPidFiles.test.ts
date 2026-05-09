import { describe, it, expect } from 'vitest';
import { buildNcBackdoorPidFiles } from './infraPidFiles';
import type { Port } from '../../network/types';

// PR 5 of plans/cross-player-base-fs-replication.md — NPC backdoors
// need a generation-time `/var/run/nc-<port>.pid` so cross-player
// nc-connect can read it server-side.

const ELITE_PORT = (overrides: Partial<Port> = {}): Port => ({
  port: 4444,
  service: 'elite',
  serviceVersion: '1.10',
  open: true,
  owner: { username: 'admin', userType: 'user', homePath: '/home/admin' },
  ...overrides,
});

describe('buildNcBackdoorPidFiles', () => {
  it('emits one pidfile per elite port with an owner', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ port: 4444 })]);
    expect(Object.keys(result)).toEqual(['nc-4444.pid']);
    expect(result['nc-4444.pid']?.content).toBe(
      'nc:port=4444,user=admin,userType=user,home=/home/admin',
    );
  });

  it('skips elite ports without an owner', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ owner: undefined })]);
    expect(result).toEqual({});
  });

  it('skips closed ports', () => {
    const result = buildNcBackdoorPidFiles([ELITE_PORT({ open: false })]);
    expect(result).toEqual({});
  });

  it('skips non-elite ports', () => {
    const result = buildNcBackdoorPidFiles([
      {
        port: 22,
        service: 'ssh',
        serviceVersion: '8.9',
        open: true,
        owner: { username: 'admin', userType: 'user', homePath: '/home/admin' },
      },
    ]);
    expect(result).toEqual({});
  });

  it('emits multiple pidfiles for multiple backdoor ports', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({ port: 4444 }),
      ELITE_PORT({
        port: 31337,
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      }),
    ]);
    expect(Object.keys(result).sort()).toEqual(['nc-31337.pid', 'nc-4444.pid']);
  });

  it('preserves the ServiceOwner.userType in the pidfile content', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      }),
    ]);
    expect(result['nc-4444.pid']?.content).toBe('nc:port=4444,user=root,userType=root,home=/root');
  });

  it('sets the FileNode owner to the listener userType', () => {
    const result = buildNcBackdoorPidFiles([
      ELITE_PORT({
        owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
      }),
    ]);
    expect(result['nc-4444.pid']?.owner).toBe('guest');
  });
});
