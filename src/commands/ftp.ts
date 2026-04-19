import type { Command, AsyncOutput, FtpPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type FtpContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const FTP_CONNECT_DELAY_MS = 600;
const FTP_BANNER_DELAY_MS = 400;

export const createFtpCommand = (context: FtpContext): Command => ({
  name: 'ftp',
  category: 'network',
  description: 'File Transfer Protocol connection to remote host',
  manual: {
    synopsis: 'ftp <host> [username] [password]',
    description:
      'Connect to a remote machine via FTP. Without credentials, you will be prompted for username and password. ' +
      'With credentials, authentication happens automatically after the connection animation — useful in scripts via node. ' +
      'Once connected, you can use FTP commands: ls, cd, pwd, lpwd, lcd, get, put, quit.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the remote machine', required: true },
      {
        name: 'username',
        description: 'Optional username for programmatic authentication',
        required: false,
      },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      { command: 'ftp 10.0.0.5', description: 'Connect to a remote host via FTP' },
      { command: 'ftp target.local', description: 'Connect using hostname' },
      {
        command: 'ftp 10.0.0.5 admin secret',
        description: 'Connect with credentials (scripting)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain } = context;

    const host = args[0] as string | undefined;
    const usernameArg = args[1] as string | undefined;
    const passwordArg = args[2] as string | undefined;

    if (!host) {
      throw new Error('ftp: missing host\nUsage: ftp <host>');
    }

    let targetIP = host;
    if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`ftp: ${host}: Name or service not known`);
      }
      targetIP = record.ip;
    }

    const localIP = getLocalIP();
    if (targetIP === localIP || targetIP === '127.0.0.1' || host === 'localhost') {
      throw new Error('ftp: cannot connect to localhost via FTP');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`ftp: connect to ${targetIP} port 21: Connection refused`);
    }

    const ftpPort = machine.ports.find((p) => p.port === 21 && p.service === 'ftp');
    if (!ftpPort || !ftpPort.open) {
      throw new Error(`ftp: connect to ${targetIP} port 21: Connection refused`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to ${targetIP}...`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          onLine(`Connected to ${targetIP}.`);

          token.schedule(() => {
            if (token.isCancelled()) return;

            onLine(`220 Welcome to ${machine.hostname} FTP server.`);

            const ftpPrompt: FtpPromptData = {
              __type: 'ftp_prompt',
              targetIP,
              ...(usernameArg !== undefined && { username: usernameArg }),
              ...(passwordArg !== undefined && { password: passwordArg }),
            };

            onComplete(ftpPrompt);
          }, jitter(FTP_BANNER_DELAY_MS));
        }, jitter(FTP_CONNECT_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
