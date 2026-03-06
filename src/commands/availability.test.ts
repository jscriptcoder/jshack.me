import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { isCommandInstalled, wrapWithInstallCheck } from './availability';

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
  (installedTools: readonly string[] = [], extraFiles: MockFs = {}) =>
  (_machineId: string, path: string, _cwd: string): FileNode | null => {
    if (extraFiles[path]) return extraFiles[path];
    const name = path.replace('/usr/bin/', '');
    return installedTools.includes(name) ? mkBinaryNode(name) : null;
  };

describe('isCommandInstalled', () => {
  it('returns true for builtins on any machine', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandInstalled('cd', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('echo', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('pwd', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns true for game commands on any machine', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandInstalled('missions', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('accept', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('mail', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns true for everything on localhost', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandInstalled('nmap', 'localhost', getNode)).toBe(true);
    expect(isCommandInstalled('john', 'localhost', getNode)).toBe(true);
    expect(isCommandInstalled('nc', 'localhost', getNode)).toBe(true);
  });

  it('returns true for system utilities on any machine', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandInstalled('ls', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('cat', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('ssh', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns false for apt-installable tools on remote without binary', () => {
    const getNode = createMockGetNode([]);
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode)).toBe(false);
    expect(isCommandInstalled('john', '10.0.0.1', getNode)).toBe(false);
    expect(isCommandInstalled('ftp', '10.0.0.1', getNode)).toBe(false);
  });

  it('returns true for apt-installable tools on remote with binary', () => {
    const getNode = createMockGetNode(['nmap', 'john']);
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode)).toBe(true);
    expect(isCommandInstalled('john', '10.0.0.1', getNode)).toBe(true);
  });

  it('returns true for apt-installable tool found in current directory with execute permission', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap', ['root', 'user', 'guest']),
    };
    const getNode = createMockGetNode([], extraFiles);
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toBe(true);
  });

  it('returns false for apt-installable tool in current directory without execute permission', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap', ['root']),
    };
    const getNode = createMockGetNode([], extraFiles);
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toBe(false);
  });

  it('checks current directory before /usr/bin/', () => {
    const extraFiles: MockFs = {
      '/home/guest/nmap': mkBinaryNode('nmap', ['root', 'guest']),
    };
    // nmap also exists in /usr/bin/ via installedTools
    const getNode = createMockGetNode(['nmap'], extraFiles);
    // Should find it in current directory (which has guest execute)
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toBe(true);
  });

  it('falls back to /usr/bin/ when not in current directory', () => {
    const getNode = createMockGetNode(['nmap']);
    expect(isCommandInstalled('nmap', '10.0.0.1', getNode, '/home/guest', 'guest')).toBe(true);
  });

  it('does not check current directory for builtins or system utilities', () => {
    const getNode = createMockGetNode([]);
    // ls is a system utility — always available regardless of cwd
    expect(isCommandInstalled('ls', '10.0.0.1', getNode, '/home/guest', 'guest')).toBe(true);
  });
});

describe('wrapWithInstallCheck', () => {
  const baseCommand = {
    name: 'nmap',
    description: 'Network scanner',
    fn: (..._args: unknown[]) => 'scan result' as unknown,
  };

  it('throws correct error when not installed', () => {
    const wrapped = wrapWithInstallCheck(baseCommand, 'nmap', () => true);
    expect(() => wrapped.fn()).toThrow(
      "bash: nmap: command not found. Install with: apt('install', 'nmap')",
    );
  });

  it('passes through when installed', () => {
    const wrapped = wrapWithInstallCheck(baseCommand, 'nmap', () => false);
    expect(wrapped.fn()).toBe('scan result');
  });

  it('preserves command metadata', () => {
    const wrapped = wrapWithInstallCheck(baseCommand, 'nmap', () => false);
    expect(wrapped.name).toBe('nmap');
    expect(wrapped.description).toBe('Network scanner');
  });

  it('evaluates isInstallRequired at execution time', () => {
    let required = true;
    const wrapped = wrapWithInstallCheck(baseCommand, 'nmap', () => required);

    expect(() => wrapped.fn()).toThrow();

    required = false;
    expect(wrapped.fn()).toBe('scan result');
  });
});
