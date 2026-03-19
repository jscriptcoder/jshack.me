import { describe, it, expect, vi } from 'vitest';
import { createNcBashCommand } from './bash';
import type { MachineId } from '../../filesystem/machineFileSystems';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';

const makeExecutable = (
  name: string,
  execute: readonly UserType[] = ['root', 'user', 'guest'],
): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute,
  },
  content: 'ELF binary stub',
});

const createContext = (overrides: Record<string, unknown> = {}) => ({
  getMachine: () => '10.0.0.5' as MachineId,
  getUserType: () => (overrides.userType as 'root' | 'user' | 'guest') ?? 'root',
  getNodeFromMachine: (overrides.getNodeFromMachine as () => FileNode | null) ?? (() => null),
  findCommand:
    (overrides.findCommand as (name: string) => ((...args: unknown[]) => unknown) | undefined) ??
    (() => undefined),
});

describe('createNcBashCommand', () => {
  it('throws when no path argument is provided', () => {
    const cmd = createNcBashCommand(createContext());
    expect(() => cmd.fn()).toThrow('missing binary path');
  });

  it('throws when path does not exist on remote machine', () => {
    const cmd = createNcBashCommand(createContext());
    expect(() => cmd.fn('/usr/sbin/sshd')).toThrow('No such file or directory');
  });

  it('throws permission denied for guest on root-only binary', () => {
    const cmd = createNcBashCommand(
      createContext({
        userType: 'guest',
        getNodeFromMachine: () => makeExecutable('sshd', ['root']),
      }),
    );
    expect(() => cmd.fn('/usr/sbin/sshd')).toThrow('Permission denied');
  });

  it('executes sshd via path as root', () => {
    const sshdFn = vi.fn(() => 'sshd is running on port 22');
    const cmd = createNcBashCommand(
      createContext({
        getNodeFromMachine: () => makeExecutable('sshd', ['root']),
        findCommand: (name: string) => (name === 'sshd' ? sshdFn : undefined),
      }),
    );

    const result = cmd.fn('/usr/sbin/sshd');
    expect(result).toBe('sshd is running on port 22');
    expect(sshdFn).toHaveBeenCalled();
  });

  it('forwards arguments to the resolved command', () => {
    const sshdFn = vi.fn(() => 'sshd is running on port 2222');
    const cmd = createNcBashCommand(
      createContext({
        getNodeFromMachine: () => makeExecutable('sshd', ['root']),
        findCommand: (name: string) => (name === 'sshd' ? sshdFn : undefined),
      }),
    );

    const result = cmd.fn('/usr/sbin/sshd', 2222);
    expect(result).toBe('sshd is running on port 2222');
    expect(sshdFn).toHaveBeenCalledWith(2222);
  });

  it('resolves path on the correct remote machine', () => {
    const getNodeFromMachine = vi.fn(() => makeExecutable('sshd', ['root']));
    const cmd = createNcBashCommand(
      createContext({
        getNodeFromMachine,
        findCommand: () => vi.fn(() => 'ok'),
      }),
    );

    cmd.fn('/usr/sbin/sshd');
    expect(getNodeFromMachine).toHaveBeenCalledWith('10.0.0.5', '/usr/sbin/sshd', '/');
  });
});
