import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { FileNode } from '../filesystem/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type DigContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getGateway: () => string;
  readonly getNodeFromMachine: (machineIp: string, path: string, cwd: string) => FileNode | null;
};

const DNS_QUERY_DELAY_MS = 500;
const IP_REGEX = /^\d+\.\d+\.\d+\.\d+$/;

// Formats a UTC timestamp like real dig: "Mon Apr 07 10:30:00 UTC 2026"
const formatDigTimestamp = (): string => {
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC ${now.getUTCFullYear()}`;
};

// Compares two IPs numerically by each octet
const compareIps = (a: string, b: string): number => {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// Parses zone file content into A record entries, sorted by IP
const parseZoneRecords = (
  content: string,
): readonly { readonly hostname: string; readonly ip: string }[] =>
  content
    .split('\n')
    .filter((line) => line.includes('IN  A'))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const hostname = parts[0] ?? '';
      const ip = parts[parts.length - 1] ?? '';
      return { hostname, ip };
    })
    .sort((a, b) => compareIps(a.ip, b.ip));

// Checks named.conf for allow-transfer { any; }
const isAxfrAllowed = (namedConfContent: string): boolean =>
  namedConfContent.includes('allow-transfer { any; }');

// Formats a single A record in dig output style
const formatARecord = (hostname: string, ip: string): string =>
  `${`${hostname}.mission.`.padEnd(23)} 3600  IN    A     ${ip}`;

export const createDigCommand = (context: DigContext): Command => ({
  name: 'dig',
  category: 'network',
  description: 'DNS lookup and zone transfer tool',
  manual: {
    synopsis: 'dig(domain) | dig(serverIp, "axfr")',
    description:
      'Query DNS records. With one argument, resolves a domain name (like nslookup). ' +
      'With a server IP and "axfr", performs a zone transfer to dump all DNS records ' +
      'from the target DNS server. Arguments can be in any order.',
    arguments: [
      { name: 'domain', description: 'Domain name to look up (e.g., "web01.mission")' },
      { name: 'serverIp', description: 'IP address of the DNS server to query' },
      { name: '"axfr"', description: 'Request a zone transfer (requires serverIp)' },
    ],
    examples: [
      { command: 'dig("web01.mission")', description: 'Look up a domain name' },
      { command: 'dig("10.0.1.5", "axfr")', description: 'Zone transfer from DNS server' },
      { command: 'dig("axfr", "10.0.1.5")', description: 'Same — argument order is flexible' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain, getGateway, getNodeFromMachine } = context;

    const strArgs = args.filter((a) => typeof a === 'string') as string[];

    if (strArgs.length === 0) {
      throw new Error('dig: missing arguments\nUsage: dig("domain") or dig("serverIp", "axfr")');
    }

    // Classify arguments by value
    let serverIp: string | undefined;
    let isAxfr = false;
    let domain: string | undefined;

    for (const rawArg of strArgs) {
      // Strip optional @ prefix (real dig convention: @server)
      const arg = rawArg.startsWith('@') ? rawArg.slice(1) : rawArg;
      if (arg.toLowerCase() === 'axfr') {
        isAxfr = true;
      } else if (IP_REGEX.test(arg)) {
        serverIp = arg;
      } else {
        domain = rawArg;
      }
    }

    // AXFR mode: requires a server IP
    if (isAxfr) {
      if (!serverIp) {
        throw new Error('dig: AXFR requires a server IP\nUsage: dig("serverIp", "axfr")');
      }

      const localIP = getLocalIP();
      if (serverIp === 'localhost' || serverIp === '127.0.0.1') {
        throw new Error('dig: cannot query localhost');
      }
      if (serverIp === localIP) {
        throw new Error('dig: cannot query localhost');
      }

      const machine = getMachine(serverIp);
      if (!machine) {
        throw new Error(`dig: connection to ${serverIp} timed out`);
      }

      const dnsPort = machine.ports.find((p) => p.service === 'dns' && p.open);
      if (!dnsPort) {
        throw new Error(`dig: ${serverIp}: no DNS service on target`);
      }

      // Read named.conf to check allow-transfer
      const namedConfNode = getNodeFromMachine(serverIp, '/etc/bind/named.conf', '/');
      if (!namedConfNode || namedConfNode.type !== 'file' || !namedConfNode.content) {
        throw new Error(`dig: ${serverIp}: DNS server not responding`);
      }

      const allowAxfr = isAxfrAllowed(namedConfNode.content);

      // Read zone file
      const zoneNode = getNodeFromMachine(serverIp, '/etc/bind/zones/db.mission', '/');
      const zoneRecords =
        allowAxfr && zoneNode?.type === 'file' && zoneNode.content
          ? parseZoneRecords(zoneNode.content)
          : [];

      const token = createCancellationToken();

      return {
        __type: 'async',
        start: (onLine, onComplete) => {
          onLine(`; <<>> DiG 9.16.0 <<>> AXFR @${serverIp}`);
          onLine(';; global options: +short');
          onLine('');

          token.schedule(() => {
            if (token.isCancelled()) return;

            if (!allowAxfr) {
              onLine('; Transfer failed.');
            } else {
              onLine(';; ANSWER SECTION:');
              zoneRecords.forEach((r) => {
                onLine(formatARecord(r.hostname, r.ip));
              });
              onLine('');
              onLine(`;; XFR size: ${zoneRecords.length} records`);
              onLine(`;; Query time: ${Math.floor(Math.random() * 12) + 4} msec`);
            }

            onLine(`;; SERVER: ${serverIp}#53`);
            onLine(`;; WHEN: ${formatDigTimestamp()}`);
            onComplete();
          }, jitter(DNS_QUERY_DELAY_MS));
        },
        cancel: token.cancel,
      };
    }

    // Basic lookup mode: resolve domain via resolveDomain
    if (!domain) {
      throw new Error('dig: missing domain argument\nUsage: dig("domain")');
    }

    const dnsServer = getGateway();
    const record = resolveDomain(domain);
    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`; <<>> DiG 9.16.0 <<>> ${domain}`);
        onLine(';; global options: +short');
        onLine('');

        token.schedule(() => {
          if (token.isCancelled()) return;

          if (!record) {
            onLine(';; status: NXDOMAIN');
          } else {
            onLine(';; ANSWER SECTION:');
            onLine(formatARecord(record.domain.replace('.mission', ''), record.ip));
          }

          onLine('');
          onLine(`;; Query time: ${Math.floor(Math.random() * 8) + 1} msec`);
          onLine(`;; SERVER: ${dnsServer}#53`);
          onLine(`;; WHEN: ${formatDigTimestamp()}`);
          onComplete();
        }, jitter(DNS_QUERY_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
