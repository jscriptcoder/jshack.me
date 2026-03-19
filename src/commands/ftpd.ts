import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';

export type FtpdAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly readPidFile: () => string | undefined;
  readonly writePidFile: (content: string) => void;
};

export type FtpdContext = {
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
    throw new Error('ftpd: invalid port number');
  }
  return port;
};

export const startFtpd = (adapter: FtpdAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  // Check if ftpd is already running via pid file
  const pidContent = adapter.readPidFile();
  if (pidContent) {
    const match = pidContent.match(/^ftpd:port=(\d+)$/);
    const runningPort = match ? Number(match[1]) : port;
    return `ftpd is already running on port ${runningPort}`;
  }

  if (adapter.isPortOpen(port)) {
    return `ftpd is already running on port ${port}`;
  }

  adapter.writePidFile(`ftpd:port=${port}`);
  return [
    `Starting FTP server...`,
    `ftpd is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};

export const FTP_PID_FILE_PATH = '/var/run/ftpd.pid';
export const FTP_PID_FILE_NAME = 'ftpd.pid';

export const createFtpPidFileContent = (port: number = 21): string => `ftpd:port=${port}`;

// FileNode for a pre-existing ftpd.pid on machines where FTP is already running
export const createFtpdPidFileNode = (port: number = 21): FileNode => ({
  name: FTP_PID_FILE_NAME,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content: createFtpPidFileContent(port),
});

export const createFtpdCommand = (context: FtpdContext): Command => ({
  name: 'ftpd',
  category: 'network',
  description: 'FTP server daemon',
  manual: {
    synopsis: 'ftpd(port?)',
    description:
      'Start the FTP server daemon. ' +
      'Listens for FTP connections on the specified port (default 21). ' +
      'Must be run as root.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 21)', required: false }],
    examples: [
      { command: 'ftpd()', description: 'Start FTP server on default port 21' },
      { command: 'ftpd(2121)', description: 'Start FTP server on port 2121' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: FtpdAdapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some((p) => p.port === port && p.service === 'ftp' && p.open) ?? false,
      readPidFile: () => {
        const node = context.getNodeFromMachine(machine, FTP_PID_FILE_PATH, '/');
        return node?.type === 'file' ? (node.content ?? undefined) : undefined;
      },
      writePidFile: (content) => context.createFileOnMachine(FTP_PID_FILE_PATH, content, 'root'),
    };

    return startFtpd(adapter, args);
  },
});
