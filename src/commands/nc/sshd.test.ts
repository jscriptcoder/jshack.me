import { describe, it, expect, vi } from 'vitest';
import { createNcSshdCommand } from './sshd';
import type { MachineId } from '../../filesystem/machineFileSystems';
import type { RemoteMachine } from '../../network/types';

const makeMachine = (ports: RemoteMachine['ports'] = []): RemoteMachine => ({
  ip: '10.0.0.5',
  hostname: 'target',
  ports,
  users: [],
});

const createContext = (overrides: Record<string, unknown> = {}) => ({
  getMachine: () => '10.0.0.5' as MachineId,
  getUserType: () => (overrides.userType as 'root' | 'user' | 'guest') ?? 'root',
  getMachineInfo: () => (overrides.machineInfo as RemoteMachine | undefined) ?? makeMachine(),
  getNodeFromMachine: (overrides.getNodeFromMachine as () => null) ?? (() => null),
  createFileOnMachine:
    (overrides.createFileOnMachine as () => { readonly allowed: true }) ??
    vi.fn(() => ({ allowed: true as const })),
});

describe('createNcSshdCommand', () => {
  it('throws permission denied when user is not root', () => {
    const cmd = createNcSshdCommand(createContext({ userType: 'guest' }));
    expect(() => cmd.fn()).toThrow('Permission denied');
  });

  it('throws permission denied for user type', () => {
    const cmd = createNcSshdCommand(createContext({ userType: 'user' }));
    expect(() => cmd.fn()).toThrow('Permission denied');
  });

  it('returns already-running when SSH port is open', () => {
    const machine = makeMachine([{ port: 22, service: 'ssh', open: true }]);
    const cmd = createNcSshdCommand(createContext({ machineInfo: machine }));
    const result = cmd.fn() as string;
    expect(result).toContain('already running');
  });

  it('writes pid file and returns success when SSH is not running', () => {
    const createFileOnMachine = vi.fn(() => ({ allowed: true as const }));
    const cmd = createNcSshdCommand(createContext({ createFileOnMachine }));
    const result = cmd.fn() as string;
    expect(result).toContain('port 22');
    expect(result).toContain('sshd is running');
    expect(createFileOnMachine).toHaveBeenCalledWith(
      '10.0.0.5',
      '/var/run/sshd.pid',
      '/',
      'sshd:port=22',
      'root',
    );
  });

  it('supports custom port', () => {
    const createFileOnMachine = vi.fn(() => ({ allowed: true as const }));
    const cmd = createNcSshdCommand(createContext({ createFileOnMachine }));
    const result = cmd.fn(2222) as string;
    expect(result).toContain('port 2222');
    expect(createFileOnMachine).toHaveBeenCalledWith(
      '10.0.0.5',
      '/var/run/sshd.pid',
      '/',
      'sshd:port=2222',
      'root',
    );
  });
});
