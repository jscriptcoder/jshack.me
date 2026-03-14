import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';

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
  'xterm',
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
  'gpg',
  'node',
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
  {
    name: 'gpg',
    description: 'GNU Privacy Guard — file encryption and decryption',
    version: '2.4.4',
  },
  { name: 'node', description: 'Node.js JavaScript runtime', version: '20.11.0' },
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
  'nslookup',
  'nmcli',
  'apt',
  'rm',
  'chmod',
  'scp',
  'reboot',
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
  'gpg',
  'node',
  'hydra',
  'gobuster',
] as const;

// Binaries with restricted execute permissions (root-only).
// All other binaries default to world-executable ['root', 'user', 'guest'].
export const RESTRICTED_EXECUTE: Readonly<Record<string, readonly UserType[]>> = {
  reboot: ['root'],
  gpg: ['root'],
};

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
          execute: (RESTRICTED_EXECUTE[name] ?? ['root', 'user', 'guest']) as readonly UserType[],
        },
        content: BINARY_STUB,
      },
    ]),
  );

// Returns true if a command doesn't need a binary check (builtin or game command)
const isAlwaysAvailable = (name: string): boolean =>
  SHELL_BUILTINS.has(name) || GAME_COMMANDS.has(name);

// Finds a command's binary in the filesystem, checking cwd → /bin/ → /usr/bin/
const findBinary = (
  name: string,
  machine: string,
  getNode: (machineId: string, path: string, cwd: string) => FileNode | null,
  currentPath?: string,
): FileNode | null => {
  if (currentPath) {
    const cwdBinary = getNode(machine, `${currentPath}/${name}`, '/');
    if (cwdBinary) return cwdBinary;
  }
  const binBinary = getNode(machine, `/bin/${name}`, '/');
  if (binBinary) return binBinary;
  return getNode(machine, `/usr/bin/${name}`, '/');
};

// Checks whether a command is visible on the current machine (for help/tab-complete).
// Builtins and game commands are always visible. Other commands need a binary in /bin/ or /usr/bin/.
export const isCommandVisible = (
  name: string,
  machine: string,
  getNode: (machineId: string, path: string, cwd: string) => FileNode | null,
  currentPath?: string,
): boolean => {
  if (isAlwaysAvailable(name)) return true;
  return findBinary(name, machine, getNode, currentPath) !== null;
};

// Checks whether a command can be executed by the current user on this machine.
// Returns { found, permitted } — found=false means binary missing, permitted=false
// means binary exists but user lacks execute permission.
export const checkCommandAccess = (
  name: string,
  machine: string,
  getNode: (machineId: string, path: string, cwd: string) => FileNode | null,
  currentPath: string | undefined,
  userType: UserType,
): { readonly found: boolean; readonly permitted: boolean } => {
  if (isAlwaysAvailable(name)) return { found: true, permitted: true };

  const binary = findBinary(name, machine, getNode, currentPath);
  if (!binary) return { found: false, permitted: false };

  return {
    found: true,
    permitted: userType === 'root' || binary.permissions.execute.includes(userType),
  };
};

// Higher-order function that wraps a command with a unified access check.
// Checks binary existence and execute permissions at execution time.
export const wrapWithAccessCheck = (
  cmd: Command,
  name: string,
  getAccess: () => { readonly found: boolean; readonly permitted: boolean },
): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    const { found, permitted } = getAccess();
    if (!found) {
      if (APT_INSTALLABLE.has(name)) {
        throw new Error(
          `bash: ${name}: command not found. Install with: apt('install', '${name}')`,
        );
      }
      throw new Error(`bash: ${name}: command not found`);
    }
    if (!permitted) {
      throw new Error(`bash: ${name}: Permission denied`);
    }
    return cmd.fn(...args);
  },
});
