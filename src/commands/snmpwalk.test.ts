import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createSnmpwalkCommand } from './snmpwalk';

// --- Factory Functions ---

const mkSnmpConf = (overrides?: {
  readonly rwCommunity?: string;
  readonly creds?: string;
}): string =>
  [
    '# SNMP Daemon Configuration',
    '# net-snmp 5.9.1',
    '',
    '# Community strings',
    'rocommunity public',
    `rwcommunity ${overrides?.rwCommunity ?? 'private'}`,
    '',
    '# System information',
    'sysDescr Linux border-gw 5.4.0-generic #1 SMP',
    'sysName border-gw',
    'sysContact netops@corp.local',
    '',
    '# Interfaces',
    'ifDescr.1 eth0',
    'ifDescr.2 eth1',
    'ifAddr.1 91.234.56.78',
    '',
    '# Extend scripts',
    overrides?.creds ?? 'nsExtendArgs.backup --user netops --pass N3t0ps_2024!',
    '',
    '# Firewall OIDs',
    'firewallSSH deny',
    'firewallHTTP deny',
  ].join('\n');

const getMockRouter = (): RemoteMachine => ({
  ip: '91.234.56.78',
  hostname: 'border-gw',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: false },
    { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
  ],
  users: [{ username: 'netops', userType: 'user' }],
});

const mkFileNode = (content: string): FileNode => ({
  name: 'snmpd.conf',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  content,
});

type SnmpwalkContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly snmpConf?: string | null;
};

const createMockSnmpwalkContext = (config: SnmpwalkContextConfig = {}) => {
  const {
    machines = [getMockRouter()],
    localIP = '192.168.1.100',
    snmpConf = mkSnmpConf(),
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: () => undefined,
    getNodeFromMachine: (_machineIp: string, path: string) => {
      if (path === '/etc/snmp/snmpd.conf' && snmpConf !== null) return mkFileNode(snmpConf);
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

describe('snmpwalk command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('throws when no host given', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn()).toThrow('missing host');
    });

    it('throws when targeting localhost', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn('localhost')).toThrow('cannot query localhost');
    });

    it('throws when machine not found', () => {
      const context = createMockSnmpwalkContext({ machines: [] });
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn('10.0.0.99')).toThrow('Connection timed out');
    });

    it('throws when machine has no SNMP port', () => {
      const noSnmpMachine: RemoteMachine = {
        ip: '10.0.0.1',
        hostname: 'web01',
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
        users: [],
      };
      const context = createMockSnmpwalkContext({ machines: [noSnmpMachine] });
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn('10.0.0.1')).toThrow('no SNMP service');
    });

    it('throws when no snmpd.conf found on machine', () => {
      const context = createMockSnmpwalkContext({ snmpConf: null });
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn('91.234.56.78')).toThrow('Timeout');
    });
  });

  describe('public community (read-only)', () => {
    it('returns async output', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('shows system OIDs but not extend scripts or firewall OIDs', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78');
      if (!isAsyncOutput(result)) return;

      const lines = collectLines(result);

      expect(lines.some((l) => l.includes('READ-ONLY'))).toBe(true);
      expect(lines.some((l) => l.includes('sysName'))).toBe(true);
      expect(lines.some((l) => l.includes('border-gw'))).toBe(true);
      expect(lines.some((l) => l.includes('ifAddr'))).toBe(true);
      // Should NOT show sensitive data
      expect(lines.some((l) => l.includes('nsExtendArgs'))).toBe(false);
      expect(lines.some((l) => l.includes('N3t0ps_2024!'))).toBe(false);
      expect(lines.some((l) => l.includes('firewallSSH'))).toBe(false);
      expect(lines.some((l) => l.includes('rwcommunity'))).toBe(false);
    });

    it('defaults to "public" when no community given', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78');
      if (!isAsyncOutput(result)) return;

      const lines = collectLines(result);

      expect(lines.some((l) => l.includes('public'))).toBe(true);
      expect(lines.some((l) => l.includes('READ-ONLY'))).toBe(true);
    });
  });

  describe('read-write community', () => {
    it('shows full data including credentials and firewall OIDs', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78', 'private');
      if (!isAsyncOutput(result)) return;

      const lines = collectLines(result);

      expect(lines.some((l) => l.includes('READ-WRITE'))).toBe(true);
      expect(lines.some((l) => l.includes('sysName'))).toBe(true);
      expect(lines.some((l) => l.includes('nsExtendArgs'))).toBe(true);
      expect(lines.some((l) => l.includes('N3t0ps_2024!'))).toBe(true);
      expect(lines.some((l) => l.includes('firewallSSH'))).toBe(true);
      expect(lines.some((l) => l.includes('deny'))).toBe(true);
    });

    it('rejects wrong community string', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      expect(() => snmpwalk.fn('91.234.56.78', 'wrongpass')).toThrow('Authentication failure');
    });

    it('works with non-default RW community', () => {
      const context = createMockSnmpwalkContext({
        snmpConf: mkSnmpConf({ rwCommunity: 'C1sc0' }),
      });
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78', 'C1sc0');
      if (!isAsyncOutput(result)) return;

      const lines = collectLines(result);

      expect(lines.some((l) => l.includes('READ-WRITE'))).toBe(true);
      expect(lines.some((l) => l.includes('firewallSSH'))).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('can be cancelled', () => {
      const context = createMockSnmpwalkContext();
      const snmpwalk = createSnmpwalkCommand(context);
      const result = snmpwalk.fn('91.234.56.78');
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );

      vi.advanceTimersByTime(200);
      result.cancel?.();
      vi.advanceTimersByTime(5000);

      // Should not have completed — no final summary
      expect(lines.some((l) => l.includes('OIDs returned'))).toBe(false);
    });
  });
});
