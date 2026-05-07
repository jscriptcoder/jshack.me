import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, RemoteUser, DnsRecord } from '../network/types';
import type { MysqlCredential } from './mysql/types';
import { parseMysqlDatabase } from './mysql/types';
import type { FileNode } from '../filesystem/types';
import { passwords, guestPasswords, snmpRwCommunities } from '../generation/pools';
import { md5 } from '../utils/md5';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { resolveWordlist } from '../utils/wordlist';
import { parseVirtualUsersConf } from '../generation/ftpCredentials';

export type HydraService = 'ssh' | 'ftp' | 'mysql' | 'redis' | 'snmp';

export type HydraSuccess = {
  readonly username?: string;
  readonly password?: string;
  readonly community?: string;
};

export type HydraBruteForceInfo = {
  readonly targetIp: string;
  readonly port: number;
  readonly service: HydraService;
  readonly attempts: number;
  readonly successes: readonly HydraSuccess[];
};

type HydraContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly findMachineUsers: (ip: string) => readonly RemoteUser[];
  readonly getNodeFromMachine: (machineIp: string, path: string, cwd: string) => FileNode | null;
  readonly getLocalNode: (path: string) => FileNode | null;
  readonly getCurrentPath: () => string;
  readonly onBruteForceAggregate?: (info: HydraBruteForceInfo) => void;
};

type CrackResult = {
  readonly port: number;
  readonly service: string;
  readonly username: string;
  readonly password: string;
};

const STATUS_DELAY_MS = 400;
// Services attacked during auto-discovery (no filter). SNMP requires explicit filter.
const LOGIN_SERVICES = new Set(['ssh', 'ftp']);
const VALID_SERVICES = new Set(['ssh', 'ftp', 'snmp', 'mysql', 'redis']);
const ATTEMPTS_PER_USER = 128;

// Build a hash set from the filesystem wordlist for SSH/FTP gate checking.
const buildWordlistHashSet = (wordlistLines: readonly string[]): ReadonlySet<string> =>
  new Set(wordlistLines.map((pw) => md5(pw)));

// Build a hash→password map from the filesystem wordlist for revealing cracked passwords.
const buildWordlistHashMap = (wordlistLines: readonly string[]): ReadonlyMap<string, string> =>
  new Map(wordlistLines.map((pw) => [md5(pw), pw]));

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
    .filter((p) => p.open && LOGIN_SERVICES.has(p.service))
    .map((p) => ({ port: p.port, service: p.service }));

  if (!serviceFilter) return openServices;

  return openServices.filter((s) => s.service === serviceFilter);
};

// Parse rwcommunity from snmpd.conf content
const parseRwCommunity = (content: string): string => {
  const match = content
    .split('\n')
    .map((line) => line.trim())
    .find((trimmed) => trimmed.startsWith('rwcommunity '));
  return match ? match.slice('rwcommunity '.length) : '';
};

// SNMP community string brute-force — tries all known community strings
const createSnmpAttack = (
  targetIP: string,
  machine: RemoteMachine,
  getNodeFromMachine: HydraContext['getNodeFromMachine'],
  onBruteForceAggregate: HydraContext['onBruteForceAggregate'],
): AsyncOutput => {
  const snmpPort = machine.ports.find(
    (p) => p.service === 'snmp' && p.open && p.protocol === 'udp',
  );
  if (!snmpPort) {
    throw new Error(`hydra: no open snmp service on ${targetIP}`);
  }

  const confNode = getNodeFromMachine(targetIP, '/etc/snmp/snmpd.conf', '/');
  if (!confNode || confNode.type !== 'file' || !confNode.content) {
    throw new Error(`hydra: ${targetIP}: no SNMP agent responding`);
  }

  const rwCommunity = parseRwCommunity(confNode.content);

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      onLine('Hydra v9.4 — Network Login Cracker');
      onLine('');

      let delay = 0;
      let found = '';

      // DATA line
      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine(`[DATA] attacking snmp://${targetIP}:${snmpPort.port}`);
      }, delay);

      // STATUS progress lines (4 evenly spaced)
      const total = snmpRwCommunities.length;
      const statusSteps = 4;
      for (let i = 1; i <= statusSteps; i++) {
        const completed = Math.floor((total / statusSteps) * i);
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`[STATUS] ${completed}/${total} community strings tested`);
        }, delay);
      }

      // Try each community string
      snmpRwCommunities.forEach((cs) => {
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          if (cs === rwCommunity) {
            found = cs;
            onLine(
              `[${snmpPort.port}][snmp] host: ${targetIP}   community: ${cs}   access: read-write`,
            );
          }
        }, delay);
      });

      // Summary + aggregate log callback
      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine('');
        onLine(`${found ? 1 : 0} valid community string${found ? '' : 's'} found`);
        onBruteForceAggregate?.({
          targetIp: targetIP,
          port: snmpPort.port,
          service: 'snmp',
          attempts: total,
          successes: found ? [{ community: found }] : [],
        });
        onComplete();
      }, delay);
    },
    cancel: token.cancel,
  };
};

// Redis password brute-force — tries passwords from pool against requirepass in redis.conf
const createRedisAttack = (
  targetIP: string,
  machine: RemoteMachine,
  getNodeFromMachine: HydraContext['getNodeFromMachine'],
  onBruteForceAggregate: HydraContext['onBruteForceAggregate'],
): AsyncOutput => {
  const redisPort = machine.ports.find((p) => p.service === 'redis' && p.open);
  if (!redisPort) {
    throw new Error(`hydra: no open redis service on ${targetIP}`);
  }

  const confNode = getNodeFromMachine(targetIP, '/etc/redis/redis.conf', '/');
  if (!confNode || confNode.type !== 'file' || !confNode.content) {
    throw new Error(`hydra: ${targetIP}: no Redis server responding`);
  }

  const requirepass =
    confNode.content
      .split('\n')
      .find((l) => l.trim().startsWith('requirepass '))
      ?.trim()
      .slice('requirepass '.length) ?? null;

  if (!requirepass) {
    throw new Error(`hydra: ${targetIP}: Redis server has no password set (open access)`);
  }

  const allPasswords = [...passwords, ...guestPasswords];
  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      onLine('Hydra v9.4 — Network Login Cracker');
      onLine('');

      let delay = 0;
      let found = '';

      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine(`[DATA] attacking redis://${targetIP}:${redisPort.port}`);
      }, delay);

      const total = allPasswords.length;
      const statusSteps = 4;
      for (let i = 1; i <= statusSteps; i++) {
        const completed = Math.floor((total / statusSteps) * i);
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`[STATUS] ${completed}/${total} passwords tested`);
        }, delay);
      }

      // Try each password
      allPasswords.forEach((pw) => {
        delay += jitter(10);
        token.schedule(() => {
          if (token.isCancelled()) return;
          if (pw === requirepass && !found) {
            found = pw;
            onLine(`[${redisPort.port}][redis] host: ${targetIP}   password: ${pw}`);
          }
        }, delay);
      });

      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine('');
        onLine(`${found ? 1 : 0} valid password${found ? '' : 's'} found`);
        onBruteForceAggregate?.({
          targetIp: targetIP,
          port: redisPort.port,
          service: 'redis',
          attempts: total,
          successes: found ? [{ password: found }] : [],
        });
        onComplete();
      }, delay);
    },
    cancel: token.cancel,
  };
};

// MySQL credential brute-force — reads database credentials from data.json
const createMysqlAttack = (
  targetIP: string,
  machine: RemoteMachine,
  getNodeFromMachine: HydraContext['getNodeFromMachine'],
  resolveNat: HydraContext['resolveNat'],
  userFilter: string | undefined,
  wordlistHashes: ReadonlySet<string>,
  wordlistHashToPassword: ReadonlyMap<string, string>,
  onBruteForceAggregate: HydraContext['onBruteForceAggregate'],
): AsyncOutput => {
  const mysqlPort = machine.ports.find((p) => p.service === 'mysql' && p.open);
  if (!mysqlPort) {
    throw new Error(`hydra: no open mysql service on ${targetIP}`);
  }

  const resolvedIp = resolveNat(targetIP, mysqlPort.port).ip;
  const dbNode = getNodeFromMachine(resolvedIp, '/var/lib/mysql/data.json', '/');
  if (!dbNode || dbNode.type !== 'file' || !dbNode.content) {
    throw new Error(`hydra: ${targetIP}: no MySQL server responding`);
  }

  const db = parseMysqlDatabase(dbNode.content);
  if (!db) {
    throw new Error(`hydra: ${targetIP}: no MySQL server responding`);
  }
  const allUsers: readonly MysqlCredential[] = db.credentials ?? [];
  const mysqlUsers = userFilter ? allUsers.filter((u) => u.username === userFilter) : allUsers;

  if (userFilter && mysqlUsers.length === 0) {
    throw new Error(`hydra: user "${userFilter}" not found on ${targetIP}`);
  }

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      onLine('Hydra v9.4 — Network Login Cracker');
      onLine('');

      let delay = 0;
      const results: CrackResult[] = [];

      // DATA line
      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine(`[DATA] attacking mysql://${targetIP}:${mysqlPort.port}`);
      }, delay);

      // STATUS progress lines (4 evenly spaced)
      const totalAttempts = mysqlUsers.length * ATTEMPTS_PER_USER;
      const statusSteps = 4;
      for (let i = 1; i <= statusSteps; i++) {
        const completed = Math.floor((totalAttempts / statusSteps) * i);
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`[STATUS] ${completed}/${totalAttempts} attempts completed`);
        }, delay);
      }

      // Per-user crack attempts — wordlist-gated, deterministic. Password
      // hash must appear in the filesystem wordlist for the credential to
      // crack. No probability roll — same wordlist + same target = same
      // outcome across runs.
      mysqlUsers.forEach((user) => {
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;

          if (!wordlistHashes.has(user.passwordHash)) return;
          const password = wordlistHashToPassword.get(user.passwordHash);
          if (!password) return;

          results.push({
            port: mysqlPort.port,
            service: 'mysql',
            username: user.username,
            password,
          });
          onLine(
            `[${mysqlPort.port}][mysql] host: ${targetIP}   login: ${user.username}   password: ${password}`,
          );
        }, delay);
      });

      // Summary + aggregate log callback
      delay += jitter(STATUS_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine('');
        onLine(
          `${results.length} of ${mysqlUsers.length} target user${mysqlUsers.length === 1 ? '' : 's'} successfully cracked`,
        );
        onBruteForceAggregate?.({
          targetIp: targetIP,
          port: mysqlPort.port,
          service: 'mysql',
          attempts: totalAttempts,
          successes: results.map((r) => ({ username: r.username, password: r.password })),
        });
        onComplete();
      }, delay);
    },
    cancel: token.cancel,
  };
};

export const createHydraCommand = (context: HydraContext): Command => ({
  name: 'hydra',
  category: 'network',
  description: 'Network login brute-force tool',
  manual: {
    synopsis: 'hydra <host> [service] [user]',
    description:
      'Perform a dictionary attack against network login services on a remote host. ' +
      'Attacks SSH and FTP services by default. Optionally specify a service ' +
      '("ssh", "ftp", "snmp", "mysql", or "redis") and/or a specific username to target. ' +
      'For SNMP, brute-forces community strings. For MySQL, brute-forces database credentials.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the target machine', required: true },
      {
        name: 'service',
        description:
          'Service to attack: "ssh", "ftp", "snmp", "mysql", or "redis" (default: ssh+ftp)',
      },
      { name: 'user', description: 'Specific username to target (default: all users)' },
    ],
    examples: [
      {
        command: 'hydra 192.168.1.50',
        description: 'Attack all SSH/FTP services on the target',
      },
      {
        command: 'hydra 192.168.1.50 ssh',
        description: 'Attack only the SSH service',
      },
      {
        command: 'hydra 192.168.1.50 ssh ftpuser',
        description: 'Attack a specific user on SSH',
      },
      {
        command: 'hydra 10.0.0.1 snmp',
        description: 'Brute-force SNMP community strings',
      },
      {
        command: 'hydra 10.0.0.5 mysql',
        description: 'Brute-force MySQL database credentials',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const {
      getMachine,
      getLocalIP,
      resolveDomain,
      resolveNat,
      findMachineUsers,
      getNodeFromMachine,
      getLocalNode,
      getCurrentPath,
    } = context;

    const host = args[0] as string | undefined;
    const serviceFilter = args[1] as string | undefined;
    const userFilter = args[2] as string | undefined;

    if (!host) {
      throw new Error('hydra: missing host\nUsage: hydra <host> [service] [user]');
    }

    if (serviceFilter !== undefined && !VALID_SERVICES.has(serviceFilter)) {
      throw new Error(
        `hydra: unsupported service "${serviceFilter}" — use "ssh", "ftp", "snmp", "mysql", or "redis"`,
      );
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

    // SNMP mode — separate flow, no users involved
    if (serviceFilter === 'snmp') {
      return createSnmpAttack(targetIP, machine, getNodeFromMachine, context.onBruteForceAggregate);
    }

    // Redis mode — brute-force requirepass (uses its own deterministic pool)
    if (serviceFilter === 'redis') {
      return createRedisAttack(
        targetIP,
        machine,
        getNodeFromMachine,
        context.onBruteForceAggregate,
      );
    }

    // Resolve the filesystem wordlist — shared by SSH/FTP/MySQL paths.
    // The wordlist is the sole gate: if the user's password hash appears in
    // the wordlist, the credential cracks; otherwise it never does.
    const { lines: wordlistLines } = resolveWordlist(
      'passwords.txt',
      getLocalNode,
      getCurrentPath(),
    );
    const wordlistHashes = buildWordlistHashSet(wordlistLines);
    const wordlistHashToPassword = buildWordlistHashMap(wordlistLines);

    // MySQL mode — reads DB credentials from data.json, gates against wordlist
    if (serviceFilter === 'mysql') {
      return createMysqlAttack(
        targetIP,
        machine,
        getNodeFromMachine,
        resolveNat,
        userFilter,
        wordlistHashes,
        wordlistHashToPassword,
        context.onBruteForceAggregate,
      );
    }

    const services = getTargetServices(machine, serviceFilter);
    if (services.length === 0) {
      const detail = serviceFilter
        ? `no open ${serviceFilter} service on ${targetIP}`
        : `no open SSH/FTP/SNMP services on ${targetIP}`;
      throw new Error(`hydra: ${detail}`);
    }

    // Resolve NAT per service port to get the actual target machine's users.
    // Each port may forward to a different internal machine.
    //
    // /etc/passwd is the canonical source for the hash to brute-force —
    // no fallback to the static users[].passwordHash cache. Consequences:
    //   - password_reset rolls take effect (cache holds the stale hash)
    //   - garbling /etc/passwd is a real sabotage vector (no candidates)
    //   - users absent from /etc/passwd are filtered out (no attempts)
    //
    // For FTP, virtual_users.conf overlays on top of /etc/passwd — the
    // real vsftpd model where virtual users override system credentials.
    const serviceUsers = services.map((svc) => {
      const resolvedIp = resolveNat(targetIP, svc.port).ip;
      const resolved = findMachineUsers(resolvedIp);
      // Cache still supplies the username + userType list. Hashes come
      // from /etc/passwd. (Removing the cache user list entirely is step 6.)
      const cachedUsers = resolved.length > 0 ? resolved : machine.users;

      const liveHashes = new Map<string, string>();
      const passwdNode = getNodeFromMachine(resolvedIp, '/etc/passwd', '/');
      if (passwdNode?.type === 'file' && passwdNode.content) {
        passwdNode.content.split('\n').forEach((line) => {
          const [username, hash] = line.split(':');
          if (username && hash) liveHashes.set(username, hash);
        });
      }
      if (svc.service === 'ftp') {
        const virtualConf = getNodeFromMachine(resolvedIp, '/etc/vsftpd/virtual_users.conf', '/');
        if (virtualConf?.type === 'file' && virtualConf.content) {
          parseVirtualUsersConf(virtualConf.content).forEach((v) => {
            liveHashes.set(v.username, v.passwordHash);
          });
        }
      }

      const users = cachedUsers.flatMap((u) => {
        const hash = liveHashes.get(u.username);
        return hash !== undefined ? [{ ...u, passwordHash: hash }] : [];
      });

      const filtered = userFilter ? users.filter((u) => u.username === userFilter) : users;
      return { svc, users: filtered };
    });

    if (userFilter && serviceUsers.every((su) => su.users.length === 0)) {
      throw new Error(`hydra: user "${userFilter}" not found on ${targetIP}`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine('Hydra v9.4 — Network Login Cracker');
        onLine('');

        let delay = 0;

        serviceUsers.forEach(({ svc, users }) => {
          const totalAttempts = users.length * ATTEMPTS_PER_USER;
          const svcResults: CrackResult[] = [];

          // DATA line
          delay += jitter(STATUS_DELAY_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(`[DATA] attacking ${svc.service}://${targetIP}:${svc.port}`);
          }, delay);

          // STATUS progress lines (4 evenly spaced)
          const statusSteps = 4;
          for (let i = 1; i <= statusSteps; i++) {
            const completed = Math.floor((totalAttempts / statusSteps) * i);
            delay += jitter(STATUS_DELAY_MS);
            token.schedule(() => {
              if (token.isCancelled()) return;
              onLine(`[STATUS] ${completed}/${totalAttempts} attempts completed`);
            }, delay);
          }

          // Per-user crack attempts — wordlist is the sole gate.
          // If the password hash matches an entry in the wordlist, it cracks.
          // Otherwise it never cracks. Deterministic: same wordlist + same
          // target = same outcome. Running hydra in a loop cannot find
          // passwords not in the wordlist.
          users.forEach((user) => {
            delay += jitter(STATUS_DELAY_MS);
            token.schedule(() => {
              if (token.isCancelled()) return;

              if (!wordlistHashes.has(user.passwordHash)) return;
              const password = wordlistHashToPassword.get(user.passwordHash);
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
            }, delay);
          });

          // Service summary + aggregate log callback. One line per attacked
          // service, fired once the sweep is complete. Successes carry the
          // cracked credentials so the handler can emit one normal
          // auth-success line per hit (indistinguishable from a legitimate
          // login).
          delay += jitter(STATUS_DELAY_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(
              `${svcResults.length} of ${users.length} target user${users.length === 1 ? '' : 's'} successfully cracked`,
            );
            context.onBruteForceAggregate?.({
              targetIp: targetIP,
              port: svc.port,
              service: svc.service as HydraService,
              attempts: totalAttempts,
              successes: svcResults.map((r) => ({
                username: r.username,
                password: r.password,
              })),
            });
          }, delay);
        });

        // Final completion
        delay += jitter(STATUS_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
