import { describe, it, expect } from 'vitest';
import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import {
  isCommandVisible,
  checkCommandAccess,
  wrapWithAccessCheck,
  createBinaryEntries,
  SBIN_UTILITY_NAMES,
} from './availability';

const mkBinaryNode = (
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
  content: '\x7fELF',
});

type MockFs = Readonly<Record<string, FileNode>>;

const createMockGetNode =
  (installedTools: readonly string[] = [], extraFiles: MockFs = {}, binaries: MockFs = {}) =>
  (_machineId: string, path: string, _cwd: string): FileNode | null => {
    if (extraFiles[path]) return extraFiles[path];
    if (binaries[path]) return binaries[path];
    const usrBinName = path.replace('/usr/bin/', '');
    if (
      path.startsWith('/usr/bin/') &&
      !path.startsWith('/usr/bin/../') &&
      installedTools.includes(usrBinName)
    ) {
      return mkBinaryNode(usrBinName);
    }
    // Sbin utilities in /usr/sbin/ — root-only execute
    const usrSbinName = path.replace('/usr/sbin/', '');
    if (
      path.startsWith('/usr/sbin/') &&
      (SBIN_UTILITY_NAMES as readonly string[]).includes(usrSbinName)
    ) {
      return mkBinaryNode(usrSbinName, ['root']);
    }
    // System utilities in /bin/ are always present
    const binName = path.replace('/bin/', '');
    if (path.startsWith('/bin/') && !path.includes('/usr/')) {
      const systemUtils = [
        'ls',
        'cat',
        'su',
        'man',
        'nano',
        'strings',
        'ssh',
        'ping',
        'ifconfig',
        'curl',
        'nslookup',
        'nmcli',
        'apt',
        'rm',
        'mkdir',
        'chmod',
        'scp',
        'reboot',
      ];
      if (systemUtils.includes(binName)) {
        // reboot has restricted execute permissions
        const execute: readonly UserType[] =
          binName === 'reboot' ? ['root'] : ['root', 'user', 'guest'];
        return mkBinaryNode(binName, execute);
      }
    }
    return null;
  };

describe('isCommandVisible', () => {
  it('returns true for builtins on any machine', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandVisible('cd', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('echo', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('pwd', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('help', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('whoami', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns true for game commands on any machine', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandVisible('missions', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('accept', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('mail', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('xterm', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns true for system utilities with binaries in /bin/', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandVisible('ls', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('cat', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('ssh', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('reboot', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns false for apt-installable tools on remote without binary', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandVisible('nmap', '10.0.0.1', getNode)).toBe(false);
    expect(isCommandVisible('john', '10.0.0.1', getNode)).toBe(false);
    expect(isCommandVisible('ftp', '10.0.0.1', getNode)).toBe(false);
  });

  it('returns true for apt-installable tools on remote with binary', () => {
    const getNode = createMockGetNode(['nmap', 'john']);
    expect(isCommandVisible('nmap', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandVisible('john', '10.0.0.1', getNode)).toBe(true);
  });

  it('finds binary in current directory', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap'),
    };
    const getNode = createMockGetNode([], extraFiles);
    expect(isCommandVisible('nmap', '10.0.0.1', getNode, '/home/guest')).toBe(true);
  });

  it('returns true for sbin utilities with binaries in /usr/sbin/', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandVisible('sshd', '10.0.0.1', getNode)).toBe(true);
  });
});

describe('checkCommandAccess', () => {
  it('always permits builtins and game commands', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('cd', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
    expect(checkCommandAccess('missions', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
    expect(checkCommandAccess('xterm', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('returns not-found for missing apt-installable commands', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/', 'user')).toEqual({
      found: false,
      permitted: false,
    });
  });

  it('permits world-executable binaries for all users', () => {
    const getNode = createMockGetNode(['nmap']);
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/', 'user')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('denies root-only binaries to non-root users', () => {
    const getNode = createMockGetNode([]);
    // reboot is in /bin/ with execute: ['root']
    expect(checkCommandAccess('reboot', '10.0.0.1', getNode, '/', 'user')).toEqual({
      found: true,
      permitted: false,
    });
    expect(checkCommandAccess('reboot', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: false,
    });
  });

  it('permits root-only binaries for root', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('reboot', '10.0.0.1', getNode, '/', 'root')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('checks current directory before /bin/ and /usr/bin/', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap', ['root', 'guest']),
    };
    const getNode = createMockGetNode(['nmap'], extraFiles);
    // Should find it in current directory (which has guest execute)
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('denies execute when cwd binary lacks user permission', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap', ['root']),
    };
    // nmap NOT in /usr/bin/, only in cwd with root-only execute
    const getNode = createMockGetNode([], extraFiles);
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toEqual({
      found: true,
      permitted: false,
    });
  });

  it('falls back to /usr/bin/ when not in current directory', () => {
    const getNode = createMockGetNode(['nmap']);
    expect(checkCommandAccess('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('permits system utilities for all user types', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('ls', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
    expect(checkCommandAccess('cat', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
    expect(checkCommandAccess('ssh', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: true,
    });
  });

  it('finds sshd in /usr/sbin/ and denies non-root users', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('sshd', '10.0.0.1', getNode, '/', 'user')).toEqual({
      found: true,
      permitted: false,
    });
    expect(checkCommandAccess('sshd', '10.0.0.1', getNode, '/', 'guest')).toEqual({
      found: true,
      permitted: false,
    });
  });

  it('permits sshd for root', () => {
    const getNode = createMockGetNode([]);
    expect(checkCommandAccess('sshd', '10.0.0.1', getNode, '/', 'root')).toEqual({
      found: true,
      permitted: true,
    });
  });
});

describe('wrapWithAccessCheck', () => {
  const baseCommand: Command = {
    name: 'nmap',
    category: 'network',
    description: 'Network scanner',
    fn: (..._args: unknown[]) => 'scan result' as unknown,
  };

  it('throws command-not-found for apt-installable when not installed', () => {
    const wrapped = wrapWithAccessCheck(baseCommand, 'nmap', () => ({
      found: false,
      permitted: false,
    }));
    expect(() => wrapped.fn()).toThrow(
      "bash: nmap: command not found. Install with: apt('install', 'nmap')",
    );
  });

  it('throws generic not-found for non-apt commands when binary missing', () => {
    const wrapped = wrapWithAccessCheck(baseCommand, 'unknown', () => ({
      found: false,
      permitted: false,
    }));
    expect(() => wrapped.fn()).toThrow('bash: unknown: command not found');
  });

  it('throws Permission denied when binary exists but not executable', () => {
    const wrapped = wrapWithAccessCheck(baseCommand, 'reboot', () => ({
      found: true,
      permitted: false,
    }));
    expect(() => wrapped.fn()).toThrow('bash: reboot: Permission denied');
  });

  it('passes through when found and permitted', () => {
    const wrapped = wrapWithAccessCheck(baseCommand, 'nmap', () => ({
      found: true,
      permitted: true,
    }));
    expect(wrapped.fn()).toBe('scan result');
  });

  it('preserves command metadata', () => {
    const wrapped = wrapWithAccessCheck(baseCommand, 'nmap', () => ({
      found: true,
      permitted: true,
    }));
    expect(wrapped.name).toBe('nmap');
    expect(wrapped.description).toBe('Network scanner');
  });

  it('evaluates access at execution time', () => {
    let permitted = false;
    const wrapped = wrapWithAccessCheck(baseCommand, 'nmap', () => ({
      found: true,
      permitted,
    }));

    expect(() => wrapped.fn()).toThrow('Permission denied');

    permitted = true;
    expect(wrapped.fn()).toBe('scan result');
  });
});

describe('createBinaryEntries', () => {
  it('creates world-executable binaries by default', () => {
    const entries = createBinaryEntries(['nmap', 'john']);
    expect(entries['nmap']?.permissions.execute).toEqual(['root', 'user', 'guest']);
    expect(entries['john']?.permissions.execute).toEqual(['root', 'user', 'guest']);
  });

  it('creates root-only execute for restricted binaries', () => {
    const entries = createBinaryEntries(['reboot', 'gpg']);
    expect(entries['reboot']?.permissions.execute).toEqual(['root']);
    expect(entries['gpg']?.permissions.execute).toEqual(['root']);
  });

  it('sets all binaries as root-owned with world-readable', () => {
    const entries = createBinaryEntries(['ls', 'reboot']);
    expect(entries['ls']?.owner).toBe('root');
    expect(entries['ls']?.permissions.read).toEqual(['root', 'user', 'guest']);
    expect(entries['ls']?.permissions.write).toEqual(['root']);
  });

  it('creates root-only execute for sshd', () => {
    const entries = createBinaryEntries(['sshd']);
    expect(entries['sshd']?.permissions.execute).toEqual(['root']);
  });
});
