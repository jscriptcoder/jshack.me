import type { Command } from '../components/Terminal/types';
import type { FileNode, MachineDeleteOp, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';
import { startSshd, SSH_PID_FILE_PATH, type SshdAdapter } from './sshd';
import { startVsftpd, FTP_PID_FILE_PATH, type VsftpdAdapter } from './vsftpd';

type ServiceConfig = {
  readonly name: string;
  readonly pidFilePath: string;
  readonly defaultPort: number;
  readonly portService: string;
  readonly displayName: string;
  readonly start: (adapter: SshdAdapter | VsftpdAdapter, args: readonly unknown[]) => string;
  readonly pidPrefix: string;
};

const SERVICES: Readonly<Record<string, ServiceConfig>> = {
  sshd: {
    name: 'sshd',
    pidFilePath: SSH_PID_FILE_PATH,
    defaultPort: 22,
    portService: 'ssh',
    displayName: 'OpenSSH server',
    start: startSshd,
    pidPrefix: 'sshd',
  },
  vsftpd: {
    name: 'vsftpd',
    pidFilePath: FTP_PID_FILE_PATH,
    defaultPort: 21,
    portService: 'ftp',
    displayName: 'vsftpd FTP server',
    start: startVsftpd,
    pidPrefix: 'vsftpd',
  },
};

const KNOWN_SERVICE_NAMES = Object.keys(SERVICES);

export type SystemctlContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    path: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
  readonly deleteFileOnMachine: (op: MachineDeleteOp) => PermissionResult;
};

const readPidFile = (
  context: SystemctlContext,
  machine: string,
  pidFilePath: string,
): string | undefined => {
  const node = context.getNodeFromMachine(machine, pidFilePath, '/');
  return node?.type === 'file' ? (node.content ?? undefined) : undefined;
};

const getRunningPort = (pidContent: string, config: ServiceConfig): number => {
  const match = pidContent.match(new RegExp(`^${config.pidPrefix}:port=(\\d+)$`));
  return match ? Number(match[1]) : config.defaultPort;
};

const handleStart = (context: SystemctlContext, service: ServiceConfig): string => {
  const machine = context.getMachine();
  const machineInfo = context.getMachineInfo(machine);

  const adapter: SshdAdapter | VsftpdAdapter = {
    isPortOpen: (port) =>
      machineInfo?.ports.some(
        (p) => p.port === port && p.service === service.portService && p.open,
      ) ?? false,
    readPidFile: () => readPidFile(context, machine, service.pidFilePath),
    writePidFile: (content) => context.createFileOnMachine(service.pidFilePath, content, 'root'),
  };

  return service.start(adapter, []);
};

const handleStop = (context: SystemctlContext, service: ServiceConfig): string => {
  const machine = context.getMachine();
  const pidContent = readPidFile(context, machine, service.pidFilePath);

  if (!pidContent) {
    return `${service.name} is not running`;
  }

  const port = getRunningPort(pidContent, service);
  context.deleteFileOnMachine({
    machineId: machine,
    path: service.pidFilePath,
    cwd: '/',
    userType: 'root',
  });

  return [
    `Stopping ${service.displayName}...`,
    `${service.name} stopped (was running on port ${port})`,
  ].join('\n');
};

const handleStatus = (context: SystemctlContext, service: ServiceConfig): string => {
  const machine = context.getMachine();
  const pidContent = readPidFile(context, machine, service.pidFilePath);

  if (!pidContent) {
    return `● ${service.name}.service - ${service.displayName}\n   Active: inactive (dead)`;
  }

  const port = getRunningPort(pidContent, service);
  return [
    `● ${service.name}.service - ${service.displayName}`,
    `   Active: active (running)`,
    `   Main PID: ${service.pidFilePath}`,
    `   Listening: 0.0.0.0:${port}`,
  ].join('\n');
};

type Action = 'start' | 'stop' | 'status';
const VALID_ACTIONS = new Set<Action>(['start', 'stop', 'status']);

export const executeSystemctl = (context: SystemctlContext, args: readonly unknown[]): string => {
  if (args.length === 0) {
    return 'Usage: systemctl(action, service)\nActions: start, stop, status\nServices: sshd, vsftpd';
  }

  const action = String(args[0]);
  if (!VALID_ACTIONS.has(action as Action)) {
    return `systemctl: unknown action '${action}'\nValid actions: start, stop, status`;
  }

  if (args.length < 2) {
    return `systemctl: missing service name\nAvailable services: ${KNOWN_SERVICE_NAMES.join(', ')}`;
  }

  const serviceName = String(args[1]);
  const service = SERVICES[serviceName];
  if (!service) {
    return `systemctl: unknown service '${serviceName}'\nAvailable services: ${KNOWN_SERVICE_NAMES.join(', ')}`;
  }

  switch (action as Action) {
    case 'start':
      return handleStart(context, service);
    case 'stop':
      return handleStop(context, service);
    case 'status':
      return handleStatus(context, service);
  }
};

export const createSystemctlCommand = (context: SystemctlContext): Command => ({
  name: 'systemctl',
  category: 'network',
  description: 'Control system services',
  manual: {
    synopsis: "systemctl('action', 'service')",
    description:
      'Control system services (start, stop, status). ' +
      'Available services: sshd (OpenSSH server), vsftpd (FTP server). ' +
      'Must be run as root.',
    arguments: [
      {
        name: 'action',
        description: "Action to perform: 'start', 'stop', or 'status'",
        required: true,
      },
      {
        name: 'service',
        description: "Service name: 'sshd' or 'vsftpd'",
        required: true,
      },
    ],
    examples: [
      { command: "systemctl('start', 'sshd')", description: 'Start the SSH server' },
      { command: "systemctl('stop', 'vsftpd')", description: 'Stop the FTP server' },
      { command: "systemctl('status', 'sshd')", description: 'Check SSH server status' },
    ],
  },
  fn: (...args: unknown[]): string => executeSystemctl(context, args),
});
