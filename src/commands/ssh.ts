import type { Command, AsyncOutput, SshPromptData } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type SshContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
};

const SSH_CONNECT_DELAY_MS = 800;
const SSH_HANDSHAKE_DELAY_MS = 600;

// Parses "user@host" into components
const parseTarget = (target: string): { readonly user: string; readonly host: string } | null => {
  const atIndex = target.indexOf('@');
  if (atIndex < 1) return null;
  const user = target.slice(0, atIndex);
  const host = target.slice(atIndex + 1);
  if (!host) return null;
  return { user, host };
};

// Parses -p PORT from remaining args after the target string.
// Returns the port number or 22 as default.
const parsePortFlag = (args: readonly unknown[]): number => {
  const pIndex = args.indexOf('-p');
  if (pIndex === -1) return 22;

  const portArg = args[pIndex + 1];
  if (portArg === undefined) {
    throw new Error('ssh: option requires an argument -- p\nUsage: ssh("user@host", "-p", "PORT")');
  }

  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ssh: invalid port '${String(portArg)}'`);
  }

  return port;
};

export const createSshCommand = (context: SshContext): Command => ({
  name: 'ssh',
  description: 'Secure shell connection to remote host',
  manual: {
    synopsis: 'ssh("user@host") or ssh("user@host", "-p", "PORT")',
    description:
      'Connect to a remote machine via SSH. You will be prompted for the password. The connection will only succeed if the remote machine has the specified port open and the credentials are valid. Default port is 22.',
    arguments: [
      {
        name: 'target',
        description: 'Connection string in user@host format',
        required: true,
      },
      {
        name: '-p PORT',
        description: 'Port to connect on (default: 22)',
        required: false,
      },
    ],
    examples: [
      { command: 'ssh("admin@192.168.1.1")', description: 'Connect to gateway as admin' },
      {
        command: 'ssh("root@10.0.0.5", "-p", "2222")',
        description: 'Connect on port 2222',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP } = context;

    const arg = args[0];
    if (typeof arg !== 'string' || !arg) {
      throw new Error('ssh: missing destination\nUsage: ssh("user@host")');
    }

    const parsed = parseTarget(arg);
    if (!parsed) {
      throw new Error(`ssh: invalid destination: '${arg}'\nUsage: ssh("user@host")`);
    }

    const { user, host } = parsed;
    const port = parsePortFlag(args.slice(1));

    const localIP = getLocalIP();
    if (host === localIP || host === '127.0.0.1' || host === 'localhost') {
      throw new Error('ssh: cannot connect to localhost via SSH');
    }

    const machine = getMachine(host);
    if (!machine) {
      throw new Error(`ssh: connect to host ${host} port ${port}: Connection refused`);
    }

    const targetPort = machine.ports.find((p) => p.port === port);
    if (!targetPort || !targetPort.open) {
      throw new Error(`ssh: connect to host ${host} port ${port}: Connection refused`);
    }

    const remoteUser = machine.users.find((u) => u.username === user);
    if (!remoteUser) {
      throw new Error(`ssh: ${user}@${host}: Permission denied (publickey,password)`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to ${host}...`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          onLine(`SSH-2.0-OpenSSH_8.9`);

          token.schedule(() => {
            if (token.isCancelled()) return;

            onLine(`Authenticating as ${user}...`);

            const sshPrompt: SshPromptData = {
              __type: 'ssh_prompt',
              targetUser: user,
              targetIP: host,
              targetPort: port,
            };

            onComplete(sshPrompt);
          }, jitter(SSH_HANDSHAKE_DELAY_MS));
        }, jitter(SSH_CONNECT_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
