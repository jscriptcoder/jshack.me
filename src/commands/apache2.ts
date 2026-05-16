import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';
import type { RemoteMachine } from '../network/types';

export type Apache2Adapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly readPidFile: () => string | undefined;
  readonly writePidFile: (content: string) => void;
  readonly indexHtmlExists: () => boolean;
  readonly writeIndexHtml: (content: string) => void;
  readonly username: string;
  readonly userType: UserType;
};

export type Apache2Context = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    path: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
  readonly getUser: () => { readonly username: string; readonly userType: UserType };
};

export const APACHE2_PID_FILE_PATH = '/var/run/apache2.pid';
export const APACHE2_PID_FILE_NAME = 'apache2.pid';
export const APACHE2_INDEX_HTML_PATH = '/var/www/html/index.html';

// Decorative starter page seeded on first daemon start. Mirrors the
// real Apache "It works!" default page so players reading curl output
// recognize the cue.
export const APACHE2_STARTER_INDEX_HTML = `<!DOCTYPE html>
<html>
  <head><title>Apache2 Default Page</title></head>
  <body>
    <h1>It works!</h1>
    <p>This is the default welcome page used to test the Apache HTTP Server.</p>
  </body>
</html>
`;

const DEFAULT_PORT = 80;
const PRIVILEGED_PORT_LIMIT = 1024;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) return DEFAULT_PORT;
  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('apache2: invalid port number');
  }
  return port;
};

const homePathFor = (username: string, userType: UserType): string =>
  userType === 'root' ? '/root' : `/home/${username}`;

const buildPidContent = (port: number, username: string, userType: UserType): string =>
  `apache2:port=${port},user=${username},userType=${userType},home=${homePathFor(username, userType)}`;

export const startApache2 = (adapter: Apache2Adapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  if (port < PRIVILEGED_PORT_LIMIT && adapter.userType !== 'root') {
    throw new Error(`apache2: permission denied: port ${port} requires root`);
  }

  const pidContent = adapter.readPidFile();
  if (pidContent) {
    const match = pidContent.match(/^apache2:port=(\d+)/);
    const runningPort = match ? Number(match[1]) : port;
    return `apache2 is already running on port ${runningPort}`;
  }

  if (adapter.isPortOpen(port)) {
    return `apache2 is already running on port ${port}`;
  }

  if (!adapter.indexHtmlExists()) {
    adapter.writeIndexHtml(APACHE2_STARTER_INDEX_HTML);
  }

  adapter.writePidFile(buildPidContent(port, adapter.username, adapter.userType));

  return [
    `Starting Apache HTTP Server...`,
    `apache2 is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};

export const createApache2Command = (context: Apache2Context): Command => ({
  name: 'apache2',
  category: 'network',
  description: 'Apache HTTP Server daemon',
  manual: {
    synopsis: 'apache2 [port]',
    description:
      'Start the Apache HTTP Server daemon. ' +
      'Listens for HTTP/HTTPS connections on the specified port (default 80). ' +
      'Ports below 1024 require root privileges. ' +
      'Seeds /var/www/html/index.html with a default welcome page on first start.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 80)', required: false }],
    examples: [
      { command: 'apache2', description: 'Start Apache on default port 80 (requires root)' },
      { command: 'apache2 8080', description: 'Start Apache on port 8080' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);
    const user = context.getUser();

    const adapter: Apache2Adapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some(
          (p) =>
            p.port === port &&
            (p.service === 'http' || p.service === 'https' || p.service === 'http-alt') &&
            p.open,
        ) ?? false,
      readPidFile: () => {
        const node = context.getNodeFromMachine(machine, APACHE2_PID_FILE_PATH, '/');
        return node?.type === 'file' ? (node.content ?? undefined) : undefined;
      },
      writePidFile: (content) =>
        context.createFileOnMachine(APACHE2_PID_FILE_PATH, content, user.userType),
      indexHtmlExists: () => {
        const node = context.getNodeFromMachine(machine, APACHE2_INDEX_HTML_PATH, '/');
        return node?.type === 'file';
      },
      writeIndexHtml: (content) =>
        context.createFileOnMachine(APACHE2_INDEX_HTML_PATH, content, user.userType),
      username: user.username,
      userType: user.userType,
    };

    return startApache2(adapter, args);
  },
});
