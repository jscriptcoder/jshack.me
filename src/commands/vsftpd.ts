import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';

export type VsftpdAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly readPidFile: () => string | undefined;
  readonly writePidFile: (content: string) => void;
};

export type VsftpdContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    path: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
};

const DEFAULT_PORT = 21;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) return DEFAULT_PORT;

  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('vsftpd: invalid port number');
  }
  return port;
};

export const startVsftpd = (adapter: VsftpdAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  // Check if vsftpd is already running via pid file
  const pidContent = adapter.readPidFile();
  if (pidContent) {
    const match = pidContent.match(/^vsftpd:port=(\d+)$/);
    const runningPort = match ? Number(match[1]) : port;
    return `vsftpd is already running on port ${runningPort}`;
  }

  if (adapter.isPortOpen(port)) {
    return `vsftpd is already running on port ${port}`;
  }

  adapter.writePidFile(`vsftpd:port=${port}`);
  return [
    `Starting FTP server...`,
    `vsftpd is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};

export const FTP_PID_FILE_PATH = '/var/run/vsftpd.pid';
export const FTP_PID_FILE_NAME = 'vsftpd.pid';

export const createVsftpdPidFileContent = (port: number = 21): string => `vsftpd:port=${port}`;

// FileNode for a pre-existing vsftpd.pid on machines where FTP is already running
export const createVsftpdPidFileNode = (port: number = 21): FileNode => ({
  name: FTP_PID_FILE_NAME,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content: createVsftpdPidFileContent(port),
});

export const createVsftpdCommand = (context: VsftpdContext): Command => ({
  name: 'vsftpd',
  category: 'network',
  description: 'vsftpd FTP server daemon',
  manual: {
    synopsis: 'vsftpd [port]',
    description:
      'Start the vsftpd FTP server daemon. ' +
      'Listens for FTP connections on the specified port (default 21). ' +
      'Must be run as root.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 21)', required: false }],
    examples: [
      { command: 'vsftpd', description: 'Start FTP server on default port 21' },
      { command: 'vsftpd 2121', description: 'Start FTP server on port 2121' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: VsftpdAdapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some((p) => p.port === port && p.service === 'ftp' && p.open) ?? false,
      readPidFile: () => {
        const node = context.getNodeFromMachine(machine, FTP_PID_FILE_PATH, '/');
        return node?.type === 'file' ? (node.content ?? undefined) : undefined;
      },
      writePidFile: (content) => context.createFileOnMachine(FTP_PID_FILE_PATH, content, 'root'),
    };

    return startVsftpd(adapter, args);
  },
});
