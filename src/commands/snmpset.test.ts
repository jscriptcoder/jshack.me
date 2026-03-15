import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createSnmpsetCommand } from './snmpset';

// --- Factory Functions ---

const mkSnmpConf = (overrides?: {
  readonly rwCommunity?: string;
  readonly firewallSSH?: string;
}): string =>
  [
    '# SNMP Daemon Configuration',
    'rocommunity public',
    `rwcommunity ${overrides?.rwCommunity ?? 'private'}`,
    '',
    'sysDescr Linux border-gw 5.4.0-generic #1 SMP',
    'sysName border-gw',
    '',
    'ifDescr.1 eth0',
    'ifAddr.1 91.234.56.78',
    '',
    'nsExtendArgs.backup --user netops --pass secret',
    '',
    `firewallSSH ${overrides?.firewallSSH ?? 'deny'}`,
    'firewallHTTP deny',
  ].join('\n');

const getMockRouter = (): RemoteMachine => ({
  ip: '91.234.56.78',
  hostname: 'border-gw',
  ports: [
    { port: 22, service: 'ssh', open: false },
    { port: 161, service: 'snmp', open: true, protocol: 'udp' },
  ],
  users: [],
});

const mkFileNode = (content: string): FileNode => ({
  name: 'snmpd.conf',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  content,
});

type CreatedFile = {
  readonly machineIp: string;
  readonly path: string;
  readonly content: string;
};

type SnmpsetContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly snmpConf?: string | null;
};

const createMockSnmpsetContext = (config: SnmpsetContextConfig = {}) => {
  const {
    machines = [getMockRouter()],
    localIP = '192.168.1.100',
    snmpConf = mkSnmpConf(),
  } = config;
  const createdFiles: CreatedFile[] = [];

  return {
    context: {
      getMachine: (ip: string) => machines.find((m) => m.ip === ip),
      getLocalIP: () => localIP,
      resolveDomain: () => undefined,
      getNodeFromMachine: (_machineIp: string, path: string) => {
        // Return the latest written version if available
        const written = createdFiles.filter((f) => f.path === path);
        if (written.length > 0) return mkFileNode(written[written.length - 1]!.content);
        if (path === '/etc/snmp/snmpd.conf' && snmpConf !== null) return mkFileNode(snmpConf);
        return null;
      },
      writeFileToMachine: (
        machineIp: string,
        path: string,
        _cwd: string,
        content: string,
        _userType: string,
      ) => {
        createdFiles.push({ machineIp, path, content });
      },
    },
    createdFiles,
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

describe('snmpset command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('throws when no args given', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn()).toThrow('missing host');
    });

    it('throws when community is read-only', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('91.234.56.78', 'public', 'firewallSSH=permit')).toThrow('read-only');
    });

    it('throws when community is wrong', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('91.234.56.78', 'wrong', 'firewallSSH=permit')).toThrow(
        'Authentication failure',
      );
    });

    it('throws when OID is not writable', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('91.234.56.78', 'private', 'sysName=hacked')).toThrow('not writable');
    });

    it('throws when value is invalid', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('91.234.56.78', 'private', 'firewallSSH=banana')).toThrow(
        'invalid value',
      );
    });

    it('throws when assignment format is wrong', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('91.234.56.78', 'private', 'firewallSSH')).toThrow('expected format');
    });

    it('throws when machine not found', () => {
      const { context } = createMockSnmpsetContext({ machines: [] });
      const snmpset = createSnmpsetCommand(context);
      expect(() => snmpset.fn('10.0.0.99', 'private', 'firewallSSH=permit')).toThrow(
        'Connection timed out',
      );
    });
  });

  describe('successful SET operation', () => {
    it('returns async output', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallSSH=permit');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('modifies snmpd.conf with new firewall value', () => {
      const { context, createdFiles } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;

      collectLines(result);

      const written = createdFiles.find((f) => f.path === '/etc/snmp/snmpd.conf');
      expect(written).toBeDefined();
      expect(written?.content).toContain('firewallSSH permit');
      expect(written?.content).not.toContain('firewallSSH deny');
      // Other firewall OIDs should be unchanged
      expect(written?.content).toContain('firewallHTTP deny');
    });

    it('shows old and new value in output', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;

      const lines = collectLines(result);

      expect(lines.some((l) => l.includes('deny') && l.includes('permit'))).toBe(true);
      expect(lines.some((l) => l.includes('updated successfully'))).toBe(true);
    });

    it('can set firewallHTTP as well', () => {
      const { context, createdFiles } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallHTTP=permit');
      if (!isAsyncOutput(result)) return;

      collectLines(result);

      const written = createdFiles.find((f) => f.path === '/etc/snmp/snmpd.conf');
      expect(written?.content).toContain('firewallHTTP permit');
    });

    it('can set value back to deny', () => {
      const { context, createdFiles } = createMockSnmpsetContext({
        snmpConf: mkSnmpConf({ firewallSSH: 'permit' }),
      });
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallSSH=deny');
      if (!isAsyncOutput(result)) return;

      collectLines(result);

      const written = createdFiles.find((f) => f.path === '/etc/snmp/snmpd.conf');
      expect(written?.content).toContain('firewallSSH deny');
    });
  });

  describe('cancellation', () => {
    it('can be cancelled', () => {
      const { context } = createMockSnmpsetContext();
      const snmpset = createSnmpsetCommand(context);
      const result = snmpset.fn('91.234.56.78', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );

      vi.advanceTimersByTime(100);
      result.cancel?.();
      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('updated successfully'))).toBe(false);
    });
  });
});
