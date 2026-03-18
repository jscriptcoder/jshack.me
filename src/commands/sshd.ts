import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';

export type SshdAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly pidFileExists: () => boolean;
  readonly writePidFile: (content: string) => void;
};

export type SshdContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    path: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
};

const DEFAULT_PORT = 22;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) return DEFAULT_PORT;

  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('sshd: invalid port number');
  }
  return port;
};

export const startSshd = (adapter: SshdAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  if (adapter.isPortOpen(port) || adapter.pidFileExists()) {
    return `sshd is already running on port ${port}`;
  }

  adapter.writePidFile(`sshd:port=${port}`);
  return [
    `Starting OpenSSH server...`,
    `sshd is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};

export const PID_FILE_PATH = '/var/run/sshd.pid';
export const PID_FILE_NAME = 'sshd.pid';

export const createPidFileContent = (port: number = 22): string => `sshd:port=${port}`;

// FileNode for a pre-existing sshd.pid on machines where SSH is already running
export const createSshdPidFileNode = (port: number = 22): FileNode => ({
  name: PID_FILE_NAME,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content: createPidFileContent(port),
});

export const createSshdCommand = (context: SshdContext): Command => ({
  name: 'sshd',
  category: 'network',
  description: 'OpenSSH server daemon',
  manual: {
    synopsis: 'sshd(port?)',
    description:
      'Start the OpenSSH server daemon. ' +
      'Listens for SSH connections on the specified port (default 22). ' +
      'Must be run as root.',
    arguments: [
      { name: 'port', description: 'Port to listen on (default: 22)', required: false },
    ],
    examples: [
      { command: 'sshd()', description: 'Start SSH server on default port 22' },
      { command: 'sshd(2222)', description: 'Start SSH server on port 2222' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: SshdAdapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some((p) => p.port === port && p.service === 'ssh' && p.open) ?? false,
      pidFileExists: () =>
        context.getNodeFromMachine(machine, PID_FILE_PATH, '/') !== null,
      writePidFile: (content) =>
        context.createFileOnMachine(PID_FILE_PATH, content, 'root'),
    };

    return startSshd(adapter, args);
  },
});
