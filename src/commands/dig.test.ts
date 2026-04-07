import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createDigCommand } from './dig';

// --- Factory Functions ---

const mkZoneFile = (
  records: readonly { readonly hostname: string; readonly ip: string }[],
): string =>
  [
    '; Zone file for mission domain',
    '$ORIGIN mission.',
    '$TTL 3600',
    '',
    '@  IN SOA dns01.mission. hostmaster.mission. (',
    '     2024030101 ; serial',
    '     3600       ; refresh',
    '     1800       ; retry',
    '     604800     ; expire',
    '     86400      ; minimum',
    ')',
    '@  IN NS  dns01.mission.',
    '',
    '; A records',
    ...records.map((r) => `${r.hostname.padEnd(15)} 3600  IN  A  ${r.ip}`),
  ].join('\n');

const mkNamedConf = (allowAxfr: boolean): string =>
  [
    '// BIND named.conf',
    '// Generated configuration',
    '',
    'options {',
    '  directory "/var/cache/bind";',
    '  listen-on port 53 { any; };',
    '  recursion yes;',
    '  allow-query { any; };',
    '};',
    '',
    'zone "mission" {',
    '  type master;',
    '  file "/etc/bind/zones/db.mission";',
    `  allow-transfer { ${allowAxfr ? 'any' : 'none'}; };`,
    '};',
  ].join('\n');

const mkFileNode = (name: string, content: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  content,
});

const getMockDnsMachine = (): RemoteMachine => ({
  ip: '10.0.1.5',
  hostname: 'dns01',
  ports: [
    { port: 22, service: 'ssh', open: true },
    { port: 53, service: 'dns', open: true, protocol: 'udp' },
    { port: 953, service: 'rndc', open: false },
  ],
  users: [{ username: 'bind', passwordHash: 'abc123', userType: 'user' }],
});

const getMockWebMachine = (): RemoteMachine => ({
  ip: '10.0.1.50',
  hostname: 'web01',
  ports: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
  ],
  users: [{ username: 'www-data', passwordHash: 'abc123', userType: 'user' }],
});

const defaultZoneRecords = [
  { hostname: 'dns01', ip: '10.0.1.5' },
  { hostname: 'web01', ip: '10.0.1.50' },
  { hostname: 'gateway-sw', ip: '10.0.1.1' },
  { hostname: 'db-prod', ip: '10.0.2.15' },
];

const defaultDnsRecords: readonly DnsRecord[] = [
  { domain: 'web01.mission', ip: '10.0.1.50', type: 'A' },
  { domain: 'dns01.mission', ip: '10.0.1.5', type: 'A' },
];

type DigContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
  readonly zoneFile?: string | null;
  readonly namedConf?: string | null;
  readonly gateway?: string;
};

const createMockDigContext = (config: DigContextConfig = {}) => {
  const {
    machines = [getMockDnsMachine(), getMockWebMachine()],
    localIP = '192.168.1.100',
    dnsRecords = defaultDnsRecords,
    zoneFile = mkZoneFile(defaultZoneRecords),
    namedConf = mkNamedConf(true),
    gateway = '10.0.1.1',
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    getGateway: () => gateway,
    getNodeFromMachine: (_machineIp: string, path: string) => {
      if (path === '/etc/bind/zones/db.mission' && zoneFile !== null)
        return mkFileNode('db.mission', zoneFile);
      if (path === '/etc/bind/named.conf' && namedConf !== null)
        return mkFileNode('named.conf', namedConf);
      return null;
    },
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const collectLines = (result: AsyncOutput): string[] => {
  const lines: string[] = [];
  result.start(
    (line) => lines.push(line),
    () => {},
  );
  vi.advanceTimersByTime(5000);
  return lines;
};

// --- Tests ---

describe('dig command', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('basic lookup — dig(domain)', () => {
    it('resolves a known domain', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('web01.mission');
      expect(isAsyncOutput(result)).toBe(true);

      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');
      expect(output).toContain('DiG 9.16.0');
      expect(output).toContain('web01.mission');
      expect(output).toContain('ANSWER SECTION');
      expect(output).toContain('10.0.1.50');
      expect(output).toContain('SERVER:');
    });

    it('returns NXDOMAIN for unknown domain', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('nonexistent.mission');
      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');
      expect(output).toContain('NXDOMAIN');
    });
  });

  describe('zone transfer — dig(ip, "axfr")', () => {
    it('returns all zone records when AXFR is enabled', () => {
      const ctx = createMockDigContext({ namedConf: mkNamedConf(true) });
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('10.0.1.5', 'axfr');
      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');

      expect(output).toContain('dns01.mission.');
      expect(output).toContain('10.0.1.5');
      expect(output).toContain('web01.mission.');
      expect(output).toContain('10.0.1.50');
      expect(output).toContain('db-prod.mission.');
      expect(output).toContain('10.0.2.15');
      expect(output).toContain('XFR size: 4 records');
    });

    it('returns Transfer failed when AXFR is disabled', () => {
      const ctx = createMockDigContext({ namedConf: mkNamedConf(false) });
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('10.0.1.5', 'axfr');
      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');
      expect(output).toContain('Transfer failed.');
      expect(output).not.toContain('web01.mission.');
    });

    it('accepts args in any order', () => {
      const ctx = createMockDigContext({ namedConf: mkNamedConf(true) });
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('axfr', '10.0.1.5');
      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');
      expect(output).toContain('web01.mission.');
      expect(output).toContain('XFR size: 4 records');
    });

    it('accepts @ prefix on server IP', () => {
      const ctx = createMockDigContext({ namedConf: mkNamedConf(true) });
      const cmd = createDigCommand(ctx);
      const result = cmd.fn('@10.0.1.5', 'axfr');
      const lines = collectLines(result as AsyncOutput);
      const output = lines.join('\n');
      expect(output).toContain('web01.mission.');
      expect(output).toContain('XFR size: 4 records');
      expect(output).toContain('AXFR @10.0.1.5');
    });

    it('throws when target has no DNS port', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      expect(() => cmd.fn('10.0.1.50', 'axfr')).toThrow('no DNS service');
    });

    it('throws when target machine does not exist', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      expect(() => cmd.fn('10.99.99.99', 'axfr')).toThrow();
    });
  });

  describe('error handling', () => {
    it('throws with no arguments', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      expect(() => cmd.fn()).toThrow('Usage');
    });

    it('throws when axfr is used without a server IP', () => {
      const ctx = createMockDigContext();
      const cmd = createDigCommand(ctx);
      expect(() => cmd.fn('axfr')).toThrow();
    });
  });
});
