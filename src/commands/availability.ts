import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';

// Shell builtins — always available, no binary needed
const SHELL_BUILTINS = new Set(['cd', 'exit', 'clear', 'echo', 'pwd', 'help', 'whoami', 'bash']);

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

// Tools pre-installed on localhost — WiFi cracking tools (needed before
// network access), node (scripting runtime), and gpg (ships with most distros).
// All other apt tools must be installed via `apt install` after connecting to WiFi.
export const LOCALHOST_PREINSTALLED_TOOLS = [
  'airmon',
  'airdump',
  'aircrack',
  'node',
  'gpg',
] as const;

// Commands that require `apt install` before use.
// On localhost, only LOCALHOST_PREINSTALLED_TOOLS are pre-installed.
export const APT_INSTALLABLE = new Set([
  'nmap',
  'john',
  'netcat',
  'ftp',
  'metasploit',
  'aircrack',
  'gpg',
  'node',
  'hydra',
  'gobuster',
  'snmp',
  'mysql',
  'redis-tools',
]);

export type AptPackageInfo = {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly binaries?: readonly string[]; // defaults to [name] if omitted
};

export const APT_PACKAGES: readonly AptPackageInfo[] = [
  { name: 'nmap', description: 'Network exploration and port scanner', version: '7.93' },
  { name: 'john', description: 'John the Ripper password cracker', version: '1.9.0' },
  {
    name: 'netcat',
    description: 'Netcat — TCP/UDP connection utility',
    version: '1.10',
    binaries: ['nc'],
  },
  { name: 'ftp', description: 'FTP client for file transfers', version: '0.17' },
  {
    name: 'metasploit',
    description: 'Metasploit Framework — vulnerability exploitation',
    version: '6.3.0',
    binaries: ['msfconsole'],
  },
  {
    name: 'aircrack',
    description: 'Wireless security auditing tools',
    version: '1.7',
    binaries: ['airmon', 'airdump', 'aircrack'],
  },
  {
    name: 'gpg',
    description: 'GNU Privacy Guard — file encryption and decryption',
    version: '2.4.4',
  },
  { name: 'node', description: 'Node.js JavaScript runtime', version: '20.11.0' },
  { name: 'hydra', description: 'Network login brute-force tool', version: '9.4' },
  { name: 'gobuster', description: 'Directory/file enumeration tool', version: '3.6' },
  {
    name: 'snmp',
    description: 'SNMP tools for network management',
    version: '5.9.1',
    binaries: ['snmpwalk', 'snmpset'],
  },
  { name: 'mysql', description: 'MySQL client for database access', version: '8.0.36' },
  {
    name: 'redis-tools',
    description: 'Redis CLI client for key-value store access',
    version: '7.0.15',
    binaries: ['rediscli'],
  },
];

// Binary stub content — looks like an ELF binary header
export const BINARY_STUB =
  '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00>\x00\x01\x00\x00\x00';

// System utilities always present in /bin/ on all machines
export const SYSTEM_UTILITY_NAMES = [
  'ls',
  'cat',
  'find',
  'grep',
  'su',
  'man',
  'nano',
  'strings',
  'ssh',
  'ping',
  'ifconfig',
  'curl',
  'nslookup',
  'dig',
  'nmcli',
  'apt',
  'rm',
  'chmod',
  'scp',
  'reboot',
  'ps',
  'kill',
] as const;

// Apt-installable tool names for /usr/bin/
export const APT_TOOL_NAMES = [
  'nmap',
  'john',
  'nc',
  'ftp',
  'msfconsole',
  'airmon',
  'airdump',
  'aircrack',
  'gpg',
  'node',
  'hydra',
  'gobuster',
  'snmpwalk',
  'snmpset',
  'mysql',
  'rediscli',
] as const;

// System admin utilities in /usr/sbin/ — root-only services
export const SBIN_UTILITY_NAMES = ['sshd', 'vsftpd', 'systemctl'] as const;

// Binaries with restricted execute permissions (root-only).
// All other binaries default to world-executable ['root', 'user', 'guest'].
export const RESTRICTED_EXECUTE: Readonly<Record<string, readonly UserType[]>> = {
  reboot: ['root'],
  gpg: ['root'],
  sshd: ['root'],
  vsftpd: ['root'],
  systemctl: ['root'],
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
  const usrBinBinary = getNode(machine, `/usr/bin/${name}`, '/');
  if (usrBinBinary) return usrBinBinary;
  return getNode(machine, `/usr/sbin/${name}`, '/');
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

// Maps binary names to their apt package name for install hints.
// Derived from APT_PACKAGES: packages with explicit binaries map each binary
// to the package name; packages without binaries use the package name itself.
const binaryToPackage = new Map<string, string>(
  APT_PACKAGES.flatMap((pkg) =>
    (pkg.binaries ?? [pkg.name]).map((bin) => [bin, pkg.name] as const),
  ),
);

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
      const packageName = binaryToPackage.get(name);
      if (packageName) {
        throw new Error(
          `bash: ${name}: command not found. Install with: apt('install', '${packageName}')`,
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
