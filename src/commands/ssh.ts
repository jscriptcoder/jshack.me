import type { Command, AsyncOutput, SshPromptData } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type SshContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
};

const SSH_CONNECT_DELAY_MS = 800;
const SSH_HANDSHAKE_DELAY_MS = 600;

export const createSshCommand = (context: SshContext): Command => ({
  name: 'ssh',
  description: 'Secure shell connection to remote host',
  manual: {
    synopsis: 'ssh(user, host)',
    description:
      'Connect to a remote machine via SSH. You will be prompted for the password. The connection will only succeed if the remote machine has SSH (port 22) open and the credentials are valid.',
    arguments: [
      { name: 'user', description: 'Username to authenticate as', required: true },
      { name: 'host', description: 'IP address of the remote machine', required: true },
    ],
    examples: [
      { command: 'ssh("admin", "192.168.1.1")', description: 'Connect to gateway as admin' },
      { command: 'ssh("root", "10.0.0.5")', description: 'Connect to a remote host as root' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP } = context;

    const user = args[0] as string | undefined;
    const host = args[1] as string | undefined;

    if (!user) {
      throw new Error('ssh: missing username\nUsage: ssh("user", "host")');
    }

    if (!host) {
      throw new Error('ssh: missing host\nUsage: ssh("user", "host")');
    }

    const localIP = getLocalIP();
    if (host === localIP || host === '127.0.0.1' || host === 'localhost') {
      throw new Error('ssh: cannot connect to localhost via SSH');
    }

    const machine = getMachine(host);
    if (!machine) {
      throw new Error(`ssh: connect to host ${host} port 22: Connection refused`);
    }

    const sshPort = machine.ports.find((p) => p.port === 22 && p.service === 'ssh');
    if (!sshPort || !sshPort.open) {
      throw new Error(`ssh: connect to host ${host} port 22: Connection refused`);
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
            };

            onComplete(sshPrompt);
          }, jitter(SSH_HANDSHAKE_DELAY_MS));
        }, jitter(SSH_CONNECT_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
