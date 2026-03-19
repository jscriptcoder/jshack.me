import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';

export type NcatAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly pidFileExists: (port: number) => boolean;
  readonly writePidFile: (port: number, content: string) => void;
  readonly username: string;
  readonly userType: UserType;
};

export type NcatContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    path: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
  readonly getUser: () => string;
  readonly getUserType: () => UserType;
};

const PRIVILEGED_PORT_LIMIT = 1024;

const pidFilePath = (port: number): string => `/var/run/ncat-${port}.pid`;

const homePath = (username: string, userType: UserType): string =>
  userType === 'root' ? '/root' : `/home/${username}`;

export const createNcatPidContent = (port: number, username: string, userType: UserType): string =>
  `ncat:port=${port},user=${username},userType=${userType},home=${homePath(username, userType)}`;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) {
    throw new Error('ncat: usage: ncat(port)');
  }

  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ncat: invalid port number');
  }
  return port;
};

export const startNcat = (adapter: NcatAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  // Privileged ports (< 1024) require root
  if (port < PRIVILEGED_PORT_LIMIT && adapter.userType !== 'root') {
    throw new Error(`ncat: permission denied: port ${port} requires root`);
  }

  if (adapter.pidFileExists(port)) {
    throw new Error(`ncat: already listening on port ${port}`);
  }

  if (adapter.isPortOpen(port)) {
    throw new Error(`ncat: port ${port} already in use`);
  }

  const content = createNcatPidContent(port, adapter.username, adapter.userType);
  adapter.writePidFile(port, content);

  return [`Ncat: listening on 0.0.0.0:${port}`, `ncat listening on port ${port}`].join('\n');
};

export const createNcatCommand = (context: NcatContext): Command => ({
  name: 'ncat',
  category: 'network',
  description: 'Open a backdoor listener on a port',
  manual: {
    synopsis: 'ncat(port)',
    description:
      'Start a netcat listener on the specified port. ' +
      'Opens a backdoor that other machines can connect to via nc(). ' +
      'Ports below 1024 require root privileges.',
    arguments: [
      {
        name: 'port',
        description: 'Port to listen on (1024-65535, or 1-65535 as root)',
        required: true,
      },
    ],
    examples: [
      { command: 'ncat(4444)', description: 'Open a listener on port 4444' },
      { command: 'ncat(31337)', description: 'Open a listener on port 31337' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: NcatAdapter = {
      isPortOpen: (port) => machineInfo?.ports.some((p) => p.port === port && p.open) ?? false,
      pidFileExists: (port) => {
        const node = context.getNodeFromMachine(machine, pidFilePath(port), '/');
        return node?.type === 'file';
      },
      writePidFile: (port, content) =>
        context.createFileOnMachine(pidFilePath(port), content, 'root'),
      username: context.getUser(),
      userType: context.getUserType(),
    };

    return startNcat(adapter, args);
  },
});
