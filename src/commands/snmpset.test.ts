import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { AuthMethod } from '../sessionRegistry/types';
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
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: false },
    { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
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
  readonly resolveTargetMachineId?: (targetIp: string) => string;
};

type TransientAuthCall = {
  readonly machine_id: string;
  readonly auth: AuthMethod;
};

const createMockSnmpsetContext = (config: SnmpsetContextConfig = {}) => {
  const {
    machines = [getMockRouter()],
    localIP = '192.168.1.100',
    snmpConf = mkSnmpConf(),
    resolveTargetMachineId = (targetIp: string) => targetIp,
  } = config;
  const createdFiles: CreatedFile[] = [];
  const transientAuthCalls: TransientAuthCall[] = [];

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
      writeFileToMachine: ({
        machineId,
        path,
        content,
      }: {
        readonly machineId: string;
        readonly path: string;
        readonly content: string;
      }) => {
        createdFiles.push({ machineIp: machineId, path, content });
      },
      resolveTargetMachineId,
    },
    createdFiles,
    transientAuthCalls,
  };
};

// Factory for a context that includes the optional withTransientAuthSession
// — needed for tests that verify the auth-session machine_id is canonicalized
// alongside the patch write.
const createMockSnmpsetContextWithAuth = (config: SnmpsetContextConfig = {}) => {
  const base = createMockSnmpsetContext(config);
  return {
    ...base,
    context: {
      ...base.context,
      withTransientAuthSession: (
        params: { readonly machine_id: string; readonly auth: AuthMethod },
        body: () => void,
      ) => {
        base.transientAuthCalls.push({
          machine_id: params.machine_id,
          auth: params.auth,
        });
        body();
        return Promise.resolve({ ok: true as const });
      },
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

  describe('canonicalization of gateway aliases', () => {
    // A gateway's .1 LAN-side alias and its canonical primary IP are two
    // ways to address the same router/switch. Patches must land under
    // a single canonical key so cross-LAN observers (who only know the
    // primary IP) and LAN-side observers (who only know .1) see the
    // same state. snmpset receives a resolver from the wiring layer
    // that performs the alias → canonical translation.

    it('writes the snmpd.conf patch under the canonical machine_id, not the .1 alias the player typed', () => {
      // Player addresses the home router by its LAN-side .1 alias.
      // Without canonicalization, the patch would land at 192.168.1.1,
      // diverging from cross-LAN reads that go to 45.0.0.1.
      const homeRouter: RemoteMachine = {
        ...getMockRouter(),
        ip: '192.168.1.1',
      };
      const { context, createdFiles } = createMockSnmpsetContext({
        machines: [homeRouter],
        resolveTargetMachineId: (targetIp) => (targetIp === '192.168.1.1' ? '45.0.0.1' : targetIp),
      });
      const snmpset = createSnmpsetCommand(context);

      const result = snmpset.fn('192.168.1.1', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;
      collectLines(result);

      const written = createdFiles.find((f) => f.path === '/etc/snmp/snmpd.conf');
      expect(written?.machineIp).toBe('45.0.0.1');
    });

    it('opens the transient auth session under the canonical machine_id, not the .1 alias', () => {
      // The transient SNMP auth session is the L2-enforced credential
      // for the write — it must also be keyed by the canonical ID so
      // findActiveSession finds the same row that the write targets.
      const homeRouter: RemoteMachine = {
        ...getMockRouter(),
        ip: '192.168.1.1',
      };
      const { context, transientAuthCalls } = createMockSnmpsetContextWithAuth({
        machines: [homeRouter],
        resolveTargetMachineId: (targetIp) => (targetIp === '192.168.1.1' ? '45.0.0.1' : targetIp),
      });
      const snmpset = createSnmpsetCommand(context);

      const result = snmpset.fn('192.168.1.1', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;
      collectLines(result);

      expect(transientAuthCalls).toHaveLength(1);
      expect(transientAuthCalls[0]?.machine_id).toBe('45.0.0.1');
    });

    it('passes IPs through unchanged when the resolver is identity (mission machines, world gateways, off-LAN)', () => {
      // The resolver is responsible for deciding what to canonicalize.
      // When the IP is not a gateway alias (e.g., a mission machine IP),
      // the resolver returns it unchanged and snmpset writes to that IP.
      const missionMachine: RemoteMachine = {
        ...getMockRouter(),
        ip: '203.0.113.42',
      };
      const { context, createdFiles } = createMockSnmpsetContext({
        machines: [missionMachine],
        resolveTargetMachineId: (targetIp) => targetIp,
      });
      const snmpset = createSnmpsetCommand(context);

      const result = snmpset.fn('203.0.113.42', 'private', 'firewallSSH=permit');
      if (!isAsyncOutput(result)) return;
      collectLines(result);

      const written = createdFiles.find((f) => f.path === '/etc/snmp/snmpd.conf');
      expect(written?.machineIp).toBe('203.0.113.42');
    });
  });
});
