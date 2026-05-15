import { INFRA_PID_CONFIGS } from '../generation/filesystem/infraPidFiles';

// Port-state override emitted by parseInfraDaemonState. Mirrors the shape
// of SshdPortOverride / FtpdPortOverride (port + service + open=true) so
// applyDaemonOverrides treats it polymorphically. Step 3 widens
// DaemonOverride to include this variant.
export type InfraPortOverride = {
  readonly port: number;
  readonly service: string;
  readonly open: true;
};

// Canonical port → service for the 15-service working set discovered by
// infraPidFiles.test.ts. When a generator opens a port that maps to one
// of these services, the pid file's content carries that port number;
// the parser uses this table to recover the service.
const PORT_TO_SERVICE: Readonly<Record<number, string>> = {
  25: 'smtp',
  53: 'dns',
  80: 'http',
  110: 'pop3',
  143: 'imap',
  161: 'snmp',
  443: 'https',
  445: 'smb',
  993: 'imaps',
  1194: 'openvpn',
  1883: 'mqtt',
  3306: 'mysql',
  5432: 'postgresql',
  5900: 'vnc',
  6379: 'redis',
  8080: 'http-alt',
  8443: 'https',
  27017: 'mongodb',
};

// Reverse-derived from INFRA_PID_CONFIGS: pidFile → set of services that
// share this pid file. nginx.pid serves {http, https, http-alt};
// dovecot.pid serves {imap, imaps, pop3}; mysqld.pid serves {mysql}; etc.
// Adding a new service to INFRA_PID_CONFIGS auto-propagates here.
const SERVICES_BY_PID_FILE: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const [service, config] of Object.entries(INFRA_PID_CONFIGS)) {
    const existing = map.get(config.pidFile);
    if (existing) existing.add(service);
    else map.set(config.pidFile, new Set([service]));
  }
  return map;
})();

// pidFile → expected binary (e.g. nginx.pid → /usr/sbin/nginx). Lines
// whose binary prefix doesn't match are treated as malformed and skipped.
const BINARY_BY_PID_FILE: ReadonlyMap<string, string> = new Map(
  Object.values(INFRA_PID_CONFIGS).map((config) => [config.pidFile, config.binary]),
);

// Escape regex metacharacters so a binary path like /usr/sbin/redis-server
// can be embedded literally in a pattern. Hyphen is intentionally NOT
// escaped — it's only special inside character classes.
const escapeRegex = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Parses an infrastructure pid file. Pid file format is one or more lines
// of `${binary}:port=${N}` (e.g. `/usr/sbin/nginx:port=80`). Multi-line
// content emits one override per valid line; malformed or out-of-domain
// lines are silently skipped. Returns [] for unknown pid file names,
// empty content, or no valid lines.
export const parseInfraDaemonState = (
  pidFileName: string,
  content: string | undefined,
): readonly InfraPortOverride[] => {
  if (!content) return [];

  const servedServices = SERVICES_BY_PID_FILE.get(pidFileName);
  const expectedBinary = BINARY_BY_PID_FILE.get(pidFileName);
  if (!servedServices || !expectedBinary) return [];

  const linePattern = new RegExp(`^${escapeRegex(expectedBinary)}:port=(\\d+)$`);

  return content
    .split('\n')
    .map((line) => line.trim())
    .map((line): InfraPortOverride | null => {
      const match = line.match(linePattern);
      if (!match) return null;
      // Regex \d+ guarantees an integer; PORT_TO_SERVICE is the sole
      // validity filter — out-of-range or unknown ports return undefined
      // here and the line is dropped.
      const port = Number(match[1]);
      const service = PORT_TO_SERVICE[port];
      if (!service || !servedServices.has(service)) return null;
      return { port, service, open: true };
    })
    .filter((override): override is InfraPortOverride => override !== null);
};
