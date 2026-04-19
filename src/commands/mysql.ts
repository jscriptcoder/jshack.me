import type { Command, AsyncOutput, MysqlPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type MysqlContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly findMachineByIp: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const MYSQL_CONNECT_DELAY_MS = 600;
const MYSQL_HANDSHAKE_DELAY_MS = 400;

export const createMysqlCommand = (context: MysqlContext): Command => ({
  name: 'mysql',
  category: 'network',
  description: 'MySQL client for database access',
  manual: {
    synopsis: 'mysql <host> <username> [password]',
    description:
      'Connect to a MySQL database server on a remote machine. Without a password, you will be prompted interactively. ' +
      'With a password, authentication happens automatically after the connection animation — useful in scripts via node. ' +
      'Once connected, you can use SQL commands: SHOW TABLES, DESCRIBE, SELECT, UPDATE, DELETE, DROP TABLE.',
    arguments: [
      {
        name: 'host',
        description: 'IP address or hostname of the remote machine',
        required: true,
      },
      { name: 'username', description: 'MySQL user to authenticate as', required: true },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      { command: 'mysql 10.0.0.5 root', description: 'Connect to database as root' },
      { command: 'mysql db.local admin', description: 'Connect using hostname' },
      {
        command: 'mysql 10.0.0.5 admin secret',
        description: 'Connect with password (scripting)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, findMachineByIp, getLocalIP, resolveDomain } = context;

    const host = args[0] as string | undefined;
    const username = args[1] as string | undefined;
    const password = args[2] as string | undefined;

    if (!host || !username) {
      throw new Error('mysql: missing arguments\nUsage: mysql <host> <username>');
    }

    // Resolve localhost/127.0.0.1 to the current machine's IP
    let targetIP = host;
    if (host === '127.0.0.1' || host === 'localhost') {
      targetIP = getLocalIP();
    } else if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`ERROR 2005 (HY000): Unknown MySQL server host '${host}'`);
      }
      targetIP = record.ip;
    }

    // getMachine only returns machines visible from the current subnet.
    // Fall back to findMachineByIp for local connections (the current machine
    // doesn't appear in its own network view).
    const machine = getMachine(targetIP) ?? findMachineByIp(targetIP);
    if (!machine) {
      throw new Error(
        `ERROR 2003 (HY000): Can't connect to MySQL server on '${targetIP}:3306' (Connection refused)`,
      );
    }

    const mysqlPort = machine.ports.find((p) => p.port === 3306 && p.service === 'mysql');
    if (!mysqlPort || !mysqlPort.open) {
      throw new Error(
        `ERROR 2003 (HY000): Can't connect to MySQL server on '${targetIP}:3306' (Connection refused)`,
      );
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to ${targetIP}:3306...`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          onLine(`MySQL ${machine.hostname} connected.`);

          token.schedule(() => {
            if (token.isCancelled()) return;

            const mysqlPrompt: MysqlPromptData = {
              __type: 'mysql_prompt',
              targetIP,
              username,
              ...(password !== undefined && { password }),
            };

            onComplete(mysqlPrompt);
          }, jitter(MYSQL_HANDSHAKE_DELAY_MS));
        }, jitter(MYSQL_CONNECT_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
