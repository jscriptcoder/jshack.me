import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { passwords, guestPasswords } from '../generation/pools';
import { md5 } from '../utils/md5';
import { createCancellationToken } from '../utils/asyncCommand';

type HydraContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

type CrackResult = {
  readonly port: number;
  readonly service: string;
  readonly username: string;
  readonly password: string;
};

const STATUS_DELAY_MS = 400;
const VALID_SERVICES = new Set(['ssh', 'ftp']);
const ATTEMPTS_PER_USER = 128;

// Crack probability by user type — guest passwords are weak (always crackable),
// user passwords sometimes appear in wordlists, root passwords almost never.
const CRACK_PROBABILITY: Readonly<Record<string, number>> = {
  guest: 1.0,
  user: 0.18,
  root: 0.025,
};

// Build wordlist hash→password map once (same as john)
const wordlist: readonly string[] = [...passwords, ...guestPasswords];
const hashToPassword: ReadonlyMap<string, string> = new Map(wordlist.map((pw) => [md5(pw), pw]));

const resolveTargetIP = (
  host: string,
  resolveDomain: (domain: string) => DnsRecord | undefined,
): string => {
  if (host.match(/^\d+\.\d+\.\d+\.\d+$/)) return host;
  const record = resolveDomain(host);
  if (!record) throw new Error(`hydra: ${host}: Name or service not known`);
  return record.ip;
};

const getTargetServices = (
  machine: RemoteMachine,
  serviceFilter: string | undefined,
): readonly { readonly port: number; readonly service: string }[] => {
  const openServices = machine.ports
    .filter((p) => p.open && VALID_SERVICES.has(p.service))
    .map((p) => ({ port: p.port, service: p.service }));

  if (!serviceFilter) return openServices;

  return openServices.filter((s) => s.service === serviceFilter);
};

export const createHydraCommand = (context: HydraContext): Command => ({
  name: 'hydra',
  description: 'Network login brute-force tool',
  manual: {
    synopsis: 'hydra(host[, service[, user]])',
    description:
      'Perform a dictionary attack against network login services on a remote host. ' +
      'Attacks SSH and FTP services by default. Optionally specify a service ' +
      '("ssh" or "ftp") and/or a specific username to target.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the target machine', required: true },
      { name: 'service', description: 'Service to attack: "ssh" or "ftp" (default: all)' },
      { name: 'user', description: 'Specific username to target (default: all users)' },
    ],
    examples: [
      {
        command: 'hydra("192.168.1.50")',
        description: 'Attack all SSH/FTP services on the target',
      },
      {
        command: 'hydra("192.168.1.50", "ssh")',
        description: 'Attack only the SSH service',
      },
      {
        command: 'hydra("192.168.1.50", "ssh", "ftpuser")',
        description: 'Attack a specific user on SSH',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain } = context;

    const host = args[0] as string | undefined;
    const serviceFilter = args[1] as string | undefined;
    const userFilter = args[2] as string | undefined;

    if (!host) {
      throw new Error('hydra: missing host\nUsage: hydra("host"[, "service"[, "user"]])');
    }

    if (serviceFilter !== undefined && !VALID_SERVICES.has(serviceFilter)) {
      throw new Error(`hydra: unsupported service "${serviceFilter}" — use "ssh" or "ftp"`);
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      throw new Error('hydra: cannot attack localhost');
    }

    const targetIP = resolveTargetIP(host, resolveDomain);

    const localIP = getLocalIP();
    if (targetIP === localIP || targetIP === '127.0.0.1') {
      throw new Error('hydra: cannot attack localhost');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`hydra: connect to ${targetIP}: Connection timed out`);
    }

    const services = getTargetServices(machine, serviceFilter);
    if (services.length === 0) {
      const detail = serviceFilter
        ? `no open ${serviceFilter} service on ${targetIP}`
        : `no open SSH/FTP services on ${targetIP}`;
      throw new Error(`hydra: ${detail}`);
    }

    const users = userFilter
      ? machine.users.filter((u) => u.username === userFilter)
      : machine.users;

    if (userFilter && users.length === 0) {
      throw new Error(`hydra: user "${userFilter}" not found on ${targetIP}`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine('Hydra v9.4 — Network Login Cracker');
        onLine('');

        let phase = 0;

        services.forEach((svc) => {
          const totalAttempts = users.length * ATTEMPTS_PER_USER;
          const svcResults: CrackResult[] = [];

          // DATA line
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(`[DATA] attacking ${svc.service}://${targetIP}:${svc.port}`);
          }, ++phase * STATUS_DELAY_MS);

          // STATUS progress lines (4 evenly spaced)
          const statusSteps = 4;
          for (let i = 1; i <= statusSteps; i++) {
            const completed = Math.floor((totalAttempts / statusSteps) * i);
            token.schedule(() => {
              if (token.isCancelled()) return;
              onLine(`[STATUS] ${completed}/${totalAttempts} attempts completed`);
            }, ++phase * STATUS_DELAY_MS);
          }

          // Per-user crack attempts — one Math.random() roll per user
          users.forEach((user) => {
            token.schedule(() => {
              if (token.isCancelled()) return;

              const probability = CRACK_PROBABILITY[user.userType] ?? 0;
              const cracked = Math.random() < probability;
              if (!cracked) return;

              const password = hashToPassword.get(user.passwordHash);
              if (!password) return;

              svcResults.push({
                port: svc.port,
                service: svc.service,
                username: user.username,
                password,
              });
              onLine(
                `[${svc.port}][${svc.service}] host: ${targetIP}   login: ${user.username}   password: ${password}`,
              );
            }, ++phase * STATUS_DELAY_MS);
          });

          // Service summary
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(
              `${svcResults.length} of ${users.length} target user${users.length === 1 ? '' : 's'} successfully cracked`,
            );
          }, ++phase * STATUS_DELAY_MS);
        });

        // Final completion
        token.schedule(() => {
          if (token.isCancelled()) return;
          onComplete();
        }, ++phase * STATUS_DELAY_MS);
      },
      cancel: token.cancel,
    };
  },
});
