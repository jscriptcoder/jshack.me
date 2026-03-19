import type { Command, AsyncOutput, NcPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord, Port } from '../network/types';
import type { UserType } from '../session/SessionContext';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

// --- Listen mode (nc -l) ---

export type NcListenAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly pidFileExists: (port: number) => boolean;
  readonly writePidFile: (port: number, content: string) => void;
  readonly username: string;
  readonly userType: UserType;
};

const PRIVILEGED_PORT_LIMIT = 1024;

export const NC_PID_FILE_PREFIX = 'nc-';

export const ncPidFilePath = (port: number): string => `/var/run/${NC_PID_FILE_PREFIX}${port}.pid`;

const homePath = (username: string, userType: UserType): string =>
  userType === 'root' ? '/root' : `/home/${username}`;

export const createNcPidContent = (port: number, username: string, userType: UserType): string =>
  `nc:port=${port},user=${username},userType=${userType},home=${homePath(username, userType)}`;

const parseListenArgs = (
  args: readonly unknown[],
): { readonly hasFlag: boolean; readonly port: number } => {
  const isFlag = (v: unknown): boolean => v === '-l';
  const flagIndex = args.findIndex(isFlag);
  if (flagIndex === -1 || args.length < 2) {
    throw new Error('nc: usage: nc("-l", port) or nc(host, port)');
  }
  const portArg = args[flagIndex === 0 ? 1 : 0];
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('nc: invalid port number');
  }
  return { hasFlag: true, port };
};

export const startNcListener = (adapter: NcListenAdapter, args: readonly unknown[]): string => {
  const { port } = parseListenArgs(args);

  if (port < PRIVILEGED_PORT_LIMIT && adapter.userType !== 'root') {
    throw new Error(`nc: permission denied: port ${port} requires root`);
  }

  if (adapter.pidFileExists(port)) {
    throw new Error(`nc: already listening on port ${port}`);
  }

  if (adapter.isPortOpen(port)) {
    throw new Error(`nc: port ${port} already in use`);
  }

  const content = createNcPidContent(port, adapter.username, adapter.userType);
  adapter.writePidFile(port, content);

  return `Listening on 0.0.0.0 ${port}`;
};

// --- Connect mode (nc host port) ---

type NcConnectContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const NC_CONNECT_DELAY_MS = 400;
const NC_BANNER_DELAY_MS = 300;

// Banners displayed when nc connects to a non-interactive port.
// null means the service has no banner (silent connection — e.g. "elite" port 31337
// is a backdoor that drops straight into an interactive shell instead).
const SERVICE_BANNERS: Readonly<Record<string, string | null>> = {
  ssh: 'SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1',
  http: 'HTTP/1.1 400 Bad Request\r\nConnection: close',
  'http-alt': 'HTTP/1.1 400 Bad Request\r\nConnection: close',
  https: '(binary SSL/TLS data)',
  ftp: '220 FTP server ready.',
  mysql: '(binary MySQL protocol data)',
  elite: null,
};

// Ports with an `owner` field represent backdoor shells — connecting via nc
// drops you into a restricted shell as that user (instead of just showing a banner)
const isInteractivePort = (port: Port): boolean => port.owner !== undefined;

const connectNc = (context: NcConnectContext, args: readonly unknown[]): AsyncOutput => {
  const { getMachine, getLocalIP, resolveDomain } = context;

  const host = args[0] as string | undefined;
  const port = args[1] as number | undefined;

  if (!host) {
    throw new Error('nc: missing host\nUsage: nc("host", port)');
  }

  if (port === undefined || typeof port !== 'number') {
    throw new Error('nc: missing or invalid port\nUsage: nc("host", port)');
  }

  if (port < 1 || port > 65535) {
    throw new Error('nc: port must be between 1 and 65535');
  }

  let targetIP = host;
  if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    const record = resolveDomain(host);
    if (!record) {
      throw new Error(`nc: ${host}: Name or service not known`);
    }
    targetIP = record.ip;
  }

  const localIP = getLocalIP();
  if (targetIP === localIP || targetIP === '127.0.0.1' || host === 'localhost') {
    throw new Error('nc: connect to localhost: Connection refused');
  }

  const machine = getMachine(targetIP);
  if (!machine) {
    throw new Error(`nc: connect to ${targetIP} port ${port}: Connection timed out`);
  }

  const targetPort = machine.ports.find((p) => p.port === port);
  if (!targetPort || !targetPort.open) {
    throw new Error(`nc: connect to ${targetIP} port ${port}: Connection refused`);
  }

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      onLine(`Connecting to ${targetIP}:${port}...`);

      token.schedule(() => {
        if (token.isCancelled()) return;

        onLine(`Connected to ${targetIP}.`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          const service = targetPort.service;

          if (isInteractivePort(targetPort) && targetPort.owner) {
            const { username, userType, homePath: ownerHome } = targetPort.owner;

            onLine('');
            onLine(`# ${port} #`);
            onLine('');

            const ncPrompt: NcPromptData = {
              __type: 'nc_prompt',
              targetIP,
              targetPort: port,
              service,
              username,
              userType,
              homePath: ownerHome,
            };

            onComplete(ncPrompt);
          } else {
            const banner = SERVICE_BANNERS[service] ?? `Connected to ${service} service`;
            onLine(banner);
            onLine('');
            onLine('Connection closed.');
            onComplete();
          }
        }, jitter(NC_BANNER_DELAY_MS));
      }, jitter(NC_CONNECT_DELAY_MS));
    },
    cancel: token.cancel,
  };
};

// --- Command factory ---

export type NcContext = NcConnectContext & {
  readonly getListenAdapter: () => NcListenAdapter;
  // Network guards — applied only in connect mode (listen is local)
  readonly isWifiRequired?: () => boolean;
  readonly isMachineBricked?: (machine: string) => boolean;
};

const hasListenFlag = (args: readonly unknown[]): boolean => args.some((a) => a === '-l');

export const createNcCommand = (context: NcContext): Command => ({
  name: 'nc',
  category: 'network',
  description: 'Netcat — arbitrary TCP connections and listeners',
  manual: {
    synopsis: 'nc(host, port) | nc("-l", port)',
    description:
      'Connect to a remote host on the specified port, or open a backdoor listener with -l. ' +
      'In connect mode, opens a raw TCP connection. ' +
      'In listen mode, starts a backdoor that other machines can connect to via nc(). ' +
      'Ports below 1024 require root privileges.',
    arguments: [
      { name: 'host', description: 'IP address or hostname (connect mode)', required: true },
      { name: 'port', description: 'Port number', required: true },
      { name: '-l', description: 'Listen mode — open a backdoor listener', required: false },
    ],
    examples: [
      { command: 'nc("10.0.0.5", 21)', description: 'Connect to FTP port and see banner' },
      { command: 'nc("10.0.0.5", 31337)', description: 'Connect to backdoor service' },
      { command: 'nc("-l", 4444)', description: 'Open a listener on port 4444' },
      { command: 'nc(8888, "-l")', description: 'Open a listener on port 8888' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput | string => {
    if (hasListenFlag(args)) {
      return startNcListener(context.getListenAdapter(), args);
    }
    // Connect mode — apply network guards
    if (context.isWifiRequired?.()) {
      throw new Error('Network is unreachable — wlan0 is not connected');
    }
    return connectNc(context, args);
  },
});
