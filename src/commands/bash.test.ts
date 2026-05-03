import { describe, it, expect, vi } from 'vitest';
import { executeBash, type BashAdapter } from './bash';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/types';

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

const makeDirectory = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
});

const createAdapter = (overrides: Partial<BashAdapter> = {}): BashAdapter => ({
  getNode: () => null,
  getUserType: () => 'root',
  findCommand: () => undefined,
  ...overrides,
});

describe('executeBash', () => {
  it('throws when path does not exist', () => {
    const adapter = createAdapter();
    expect(() => executeBash(adapter, '/usr/sbin/sshd', [])).toThrow('No such file or directory');
  });

  it('throws when path is a directory', () => {
    const adapter = createAdapter({
      getNode: () => makeDirectory('sbin'),
    });
    expect(() => executeBash(adapter, '/usr/sbin', [])).toThrow('Is a directory');
  });

  it('throws permission denied for non-root user without execute permission', () => {
    const adapter = createAdapter({
      getNode: () => makeExecutable('sshd', ['root']),
      getUserType: () => 'guest',
    });
    expect(() => executeBash(adapter, '/usr/sbin/sshd', [])).toThrow('Permission denied');
  });

  it('allows root to execute root-only binaries', () => {
    const fn = vi.fn(() => 'started');
    const adapter = createAdapter({
      getNode: () => makeExecutable('sshd', ['root']),
      getUserType: () => 'root',
      findCommand: (name) => (name === 'sshd' ? fn : undefined),
    });

    const result = executeBash(adapter, '/usr/sbin/sshd', []);
    expect(result).toBe('started');
    expect(fn).toHaveBeenCalled();
  });

  it('allows user to execute world-executable binaries', () => {
    const fn = vi.fn(() => 'output');
    const adapter = createAdapter({
      getNode: () => makeExecutable('ls'),
      getUserType: () => 'user',
      findCommand: (name) => (name === 'ls' ? fn : undefined),
    });

    const result = executeBash(adapter, '/bin/ls', []);
    expect(result).toBe('output');
  });

  it('forwards arguments to the resolved command', () => {
    const fn = vi.fn((...args: unknown[]) => `port ${args[0]}`);
    const adapter = createAdapter({
      getNode: () => makeExecutable('sshd', ['root']),
      findCommand: (name) => (name === 'sshd' ? fn : undefined),
    });

    const result = executeBash(adapter, '/usr/sbin/sshd', [2222]);
    expect(result).toBe('port 2222');
    expect(fn).toHaveBeenCalledWith(2222);
  });

  it('throws when binary exists but has no corresponding command', () => {
    const adapter = createAdapter({
      getNode: () => makeExecutable('unknown'),
    });
    expect(() => executeBash(adapter, '/bin/unknown', [])).toThrow('cannot execute binary file');
  });

  it('extracts binary name from path', () => {
    const fn = vi.fn(() => 'ok');
    const findCommand = vi.fn((name: string) => (name === 'sshd' ? fn : undefined));
    const adapter = createAdapter({
      getNode: () => makeExecutable('sshd', ['root']),
      findCommand,
    });

    executeBash(adapter, '/usr/sbin/sshd', []);
    expect(findCommand).toHaveBeenCalledWith('sshd');
  });
});
