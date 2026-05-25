import type { Command, AsyncOutput, RedisPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type RediscliContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly findMachineByIp: (ip: string) => RemoteMachine | undefined;
  // Async sibling of getMachine. Triggers the cross-LAN seed-regen
  // resolver when the target IP is a publicly-addressable IPv4 that
  // the sync view doesn't know yet. Optional for legacy callers /
  // single-player tests; when omitted, the command keeps the pre-
  // extension synchronous-throw contract on a sync miss.
  readonly findMachineByIpAsync?: (ip: string) => Promise<RemoteMachine | undefined>;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const REDIS_CONNECT_DELAY_MS = 500;
const REDIS_HANDSHAKE_DELAY_MS = 300;

export const createRediscliCommand = (context: RediscliContext): Command => ({
  name: 'rediscli',
  category: 'network',
  description: 'Redis CLI client for key-value store access',
  manual: {
    synopsis: 'rediscli <host> [password]',
    description:
      'Connect to a Redis server on the specified host. If the server requires authentication, ' +
      'provide the password as the second argument or use the AUTH command after connecting.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the Redis server', required: true },
      { name: 'password', description: 'Optional password for AUTH' },
    ],
    examples: [
      { command: 'rediscli 10.0.1.20', description: 'Connect to Redis server' },
      {
        command: 'rediscli 10.0.1.20 secret',
        description: 'Connect with authentication',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, findMachineByIp, findMachineByIpAsync, getLocalIP, resolveDomain } =
      context;

    const host = args[0] as string | undefined;
    const password = args[1] as string | undefined;

    if (!host) {
      throw new Error('rediscli: missing host argument\nUsage: rediscli <host> [password]');
    }

    let targetIP = host;
    if (host === '127.0.0.1' || host === 'localhost') {
      targetIP = getLocalIP();
    } else if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`Could not resolve hostname '${host}'`);
      }
      targetIP = record.ip;
    }

    const token = createCancellationToken();

    const validateAndBuildPrompt = (
      machine: RemoteMachine | undefined,
    ): { readonly prompt: RedisPromptData; readonly machineHostname: string } => {
      if (!machine) {
        throw new Error(`Could not connect to Redis at ${targetIP}:6379: Connection refused`);
      }
      const redisPort = machine.ports.find((p) => p.port === 6379 && p.service === 'redis');
      if (!redisPort || !redisPort.open) {
        throw new Error(`Could not connect to Redis at ${targetIP}:6379: Connection refused`);
      }
      return {
        prompt: {
          __type: 'redis_prompt',
          targetIP,
          ...(password !== undefined && { password }),
        },
        machineHostname: machine.hostname,
      };
    };

    const runConnectAnim = (
      onLine: (line: string) => void,
      onComplete: (followUp?: RedisPromptData) => void,
      machineHostname: string,
      redisPrompt: RedisPromptData,
    ) => {
      onLine(`Connecting to ${targetIP}:6379...`);

      token.schedule(() => {
        if (token.isCancelled()) return;

        onLine(`Connected to Redis ${machineHostname}.`);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onComplete(redisPrompt);
        }, jitter(REDIS_HANDSHAKE_DELAY_MS));
      }, jitter(REDIS_CONNECT_DELAY_MS));
    };

    const syncMachine = getMachine(targetIP) ?? findMachineByIp(targetIP);
    if (syncMachine || !findMachineByIpAsync) {
      const { prompt, machineHostname } = validateAndBuildPrompt(syncMachine);
      return {
        __type: 'async',
        start: (onLine, onComplete) => runConnectAnim(onLine, onComplete, machineHostname, prompt),
        cancel: token.cancel,
      };
    }

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        void findMachineByIpAsync(targetIP).then((asyncMachine) => {
          if (token.isCancelled()) return;
          try {
            const { prompt, machineHostname } = validateAndBuildPrompt(asyncMachine);
            runConnectAnim(onLine, onComplete, machineHostname, prompt);
          } catch (error) {
            onLine(error instanceof Error ? error.message : String(error));
            onComplete();
          }
        });
      },
      cancel: token.cancel,
    };
  },
});
