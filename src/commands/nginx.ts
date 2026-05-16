import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';
import type { RemoteMachine } from '../network/types';

export type NginxAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly readPidFile: () => string | undefined;
  readonly writePidFile: (content: string) => void;
  readonly indexHtmlExists: () => boolean;
  readonly writeIndexHtml: (content: string) => void;
  readonly username: string;
  readonly userType: UserType;
};

export type NginxContext = {
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

export const NGINX_PID_FILE_PATH = '/var/run/nginx.pid';
export const NGINX_PID_FILE_NAME = 'nginx.pid';
export const NGINX_INDEX_HTML_PATH = '/var/www/html/index.html';
export const NGINX_BINARY = '/usr/sbin/nginx';

// Decorative starter page seeded on first daemon start. Mirrors the real
// nginx "Welcome to nginx!" default page so players reading curl output
// recognize the cue.
export const NGINX_STARTER_INDEX_HTML = `<!DOCTYPE html>
<html>
  <head><title>Welcome to nginx!</title></head>
  <body>
    <h1>Welcome to nginx!</h1>
    <p>If you see this page, the nginx web server is successfully installed and working.</p>
  </body>
</html>
`;

const DEFAULT_PORT = 80;
const PRIVILEGED_PORT_LIMIT = 1024;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) return DEFAULT_PORT;
  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('nginx: invalid port number');
  }
  return port;
};

const homePathFor = (username: string, userType: UserType): string =>
  userType === 'root' ? '/root' : `/home/${username}`;

// Player nginx writes the extended infra-parser form. Themed-network
// generators still ship the short `${binary}:port=N` shape via
// buildInfrastructurePidFiles; both shapes parse cleanly through
// parseInfraDaemonState.
const buildPidContent = (port: number, username: string, userType: UserType): string =>
  `${NGINX_BINARY}:port=${port},user=${username},userType=${userType},home=${homePathFor(username, userType)}`;

export const startNginx = (adapter: NginxAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  if (port < PRIVILEGED_PORT_LIMIT && adapter.userType !== 'root') {
    throw new Error(`nginx: permission denied: port ${port} requires root`);
  }

  const pidContent = adapter.readPidFile();
  if (pidContent) {
    // Match the first valid line of either short or extended form. Multi-
    // line content (themed networks running nginx on 80+443) reports the
    // first running port — honest "already running" signal regardless of
    // which port the player asked for.
    const match = pidContent.match(/\/usr\/sbin\/nginx:port=(\d+)/);
    const runningPort = match ? Number(match[1]) : port;
    return `nginx is already running on port ${runningPort}`;
  }

  if (adapter.isPortOpen(port)) {
    return `nginx is already running on port ${port}`;
  }

  if (!adapter.indexHtmlExists()) {
    adapter.writeIndexHtml(NGINX_STARTER_INDEX_HTML);
  }

  adapter.writePidFile(buildPidContent(port, adapter.username, adapter.userType));

  return [
    `Starting nginx web server...`,
    `nginx is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};

export const createNginxCommand = (context: NginxContext): Command => ({
  name: 'nginx',
  category: 'network',
  description: 'nginx web server daemon',
  manual: {
    synopsis: 'nginx [port]',
    description:
      'Start the nginx web server daemon. ' +
      'Listens for HTTP/HTTPS connections on the specified port (default 80). ' +
      'Ports below 1024 require root privileges. ' +
      'Seeds /var/www/html/index.html with a default welcome page on first start.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 80)', required: false }],
    examples: [
      { command: 'nginx', description: 'Start nginx on default port 80 (requires root)' },
      { command: 'nginx 8080', description: 'Start nginx on port 8080' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);
    const user = context.getUser();

    const adapter: NginxAdapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some(
          (p) =>
            p.port === port &&
            (p.service === 'http' || p.service === 'https' || p.service === 'http-alt') &&
            p.open,
        ) ?? false,
      readPidFile: () => {
        const node = context.getNodeFromMachine(machine, NGINX_PID_FILE_PATH, '/');
        return node?.type === 'file' ? (node.content ?? undefined) : undefined;
      },
      writePidFile: (content) =>
        context.createFileOnMachine(NGINX_PID_FILE_PATH, content, user.userType),
      indexHtmlExists: () => {
        const node = context.getNodeFromMachine(machine, NGINX_INDEX_HTML_PATH, '/');
        return node?.type === 'file';
      },
      writeIndexHtml: (content) =>
        context.createFileOnMachine(NGINX_INDEX_HTML_PATH, content, user.userType),
      username: user.username,
      userType: user.userType,
    };

    return startNginx(adapter, args);
  },
});
