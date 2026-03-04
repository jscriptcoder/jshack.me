import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';

// Shell builtins — always available, no binary needed
const SHELL_BUILTINS = new Set(['cd', 'exit', 'clear', 'echo', 'pwd', 'help', 'whoami']);

// Game-specific commands — always available, not real Linux tools
const GAME_COMMANDS = new Set([
  'missions',
  'accept',
  'abort',
  'mail',
  'output',
  'resolve',
  'author',
  'theme',
  'reset',
]);

// Commands that require `apt install` on remote machines.
// On localhost these are pre-installed (/usr/bin/<name> exists).
export const APT_INSTALLABLE = new Set([
  'nmap',
  'john',
  'nc',
  'ftp',
  'exploit',
  'airmon',
  'airdump',
  'aircrack',
  'decrypt',
  'node',
  'nslookup',
  'hydra',
  'gobuster',
]);

export type AptPackageInfo = {
  readonly name: string;
  readonly description: string;
  readonly version: string;
};

export const APT_PACKAGES: readonly AptPackageInfo[] = [
  { name: 'nmap', description: 'Network exploration and port scanner', version: '7.93' },
  { name: 'john', description: 'John the Ripper password cracker', version: '1.9.0' },
  { name: 'nc', description: 'Netcat — TCP/UDP connection utility', version: '1.10' },
  { name: 'ftp', description: 'FTP client for file transfers', version: '0.17' },
  { name: 'exploit', description: 'Vulnerability exploitation framework', version: '2.1.0' },
  { name: 'airmon', description: 'Wireless monitor mode manager', version: '1.7' },
  { name: 'airdump', description: 'Wireless network scanner', version: '1.7' },
  { name: 'aircrack', description: 'Wireless key cracker', version: '1.7' },
  { name: 'decrypt', description: 'File decryption utility', version: '1.0.0' },
  { name: 'node', description: 'Node.js JavaScript runtime', version: '20.11.0' },
  { name: 'nslookup', description: 'DNS lookup utility', version: '9.18.0' },
  { name: 'hydra', description: 'Network login brute-force tool', version: '9.4' },
  { name: 'gobuster', description: 'Directory/file enumeration tool', version: '3.6' },
];

// Binary stub content — looks like an ELF binary header
export const BINARY_STUB =
  '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00>\x00\x01\x00\x00\x00';

// System utilities always present in /bin/ on all machines
export const SYSTEM_UTILITY_NAMES = [
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
  'nmcli',
  'apt',
  'rm',
] as const;

// Apt-installable tool names for /usr/bin/
export const APT_TOOL_NAMES = [
  'nmap',
  'john',
  'nc',
  'ftp',
  'exploit',
  'airmon',
  'airdump',
  'aircrack',
  'decrypt',
  'node',
  'nslookup',
  'hydra',
  'gobuster',
] as const;

// Creates binary stub FileNode entries for populating /bin/ or /usr/bin/
export const createBinaryEntries = (names: readonly string[]): Readonly<Record<string, FileNode>> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      {
        name,
        type: 'file' as const,
        owner: 'root' as const,
        permissions: {
          read: ['root', 'user', 'guest'] as const,
          write: ['root'] as const,
          execute: ['root', 'user', 'guest'] as const,
        },
        content: BINARY_STUB,
      },
    ]),
  );

// Checks whether a command is available on the current machine.
// Builtins, game commands, and anything on localhost are always available.
// Apt-installable commands require /usr/bin/<name> to exist on the machine.
export const isCommandInstalled = (
  name: string,
  machine: string,
  getNode: (machineId: string, path: string, cwd: string) => FileNode | null,
): boolean => {
  if (machine === 'localhost') return true;
  if (SHELL_BUILTINS.has(name) || GAME_COMMANDS.has(name)) return true;
  if (!APT_INSTALLABLE.has(name)) return true;
  return getNode(machine, `/usr/bin/${name}`, '/') !== null;
};

// Higher-order function that wraps a command with an install check.
// The isInstallRequired closure is evaluated at execution time (not wrap time),
// so it always reflects the current filesystem state.
export const wrapWithInstallCheck = (
  cmd: Command,
  name: string,
  isInstallRequired: () => boolean,
): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    if (isInstallRequired()) {
      throw new Error(`bash: ${name}: command not found. Install with: apt('install', '${name}')`);
    }
    return cmd.fn(...args);
  },
});
