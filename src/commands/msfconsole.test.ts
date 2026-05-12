import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncFollowUp, AsyncOutput, NcPromptData } from '../components/Terminal/types';
import { createMsfconsoleCommand } from './msfconsole';
import { buildTimeline, buildGeneratedVuln, CVE_TIMING_CONFIG } from '../generation/timeline';
import { buildTimelineFromTemplate } from '../generation/timeline';
import { systemLibraryTemplates } from '../generation/pools/systemLibraryTemplates';
import { buildInitialDpkgStatus } from '../network/dpkgStatus';
import { formatVersion } from '../generation/pools/serviceTemplates';
import { md5 } from '../utils/md5';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '10.50.100.10',
  hostname: 'web01',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    {
      port: 80,
      service: 'http',
      serviceVersion: 'Apache/2.4.49',
      open: true,
      owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
    },
  ],
  users: [
    { username: 'root', userType: 'root' },
    { username: 'guest', userType: 'guest' },
  ],
  ...overrides,
});

type MsfconsoleContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly currentMachineId?: string;
  readonly dnsRecords?: readonly DnsRecord[];
  readonly gameTime?: number;
  readonly onExploitAttempt?: (info: {
    readonly targetIp: string;
    readonly port: number;
    readonly service?: string;
    readonly serviceVersion?: string;
    readonly success: boolean;
  }) => void;
  readonly readRemoteFile?: (machineId: string, path: string) => string | null;
  readonly readLocalFile?: (path: string) => string | null;
  readonly writeRemoteFile?: (
    machineId: string,
    path: string,
    content: string,
  ) => Promise<{ readonly allowed: boolean; readonly error?: string }>;
  readonly listRemoteDir?: (machineId: string, path: string) => readonly string[] | null;
  readonly exploitFileRead?: (
    machineId: string,
    path: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<string | null>;
  readonly exploitDirList?: (
    machineId: string,
    path: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<readonly string[] | null>;
  readonly runScriptOnTarget?: (
    machineId: string,
    scriptBody: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<{ readonly error: string | null }>;
  readonly resolveNat?: (
    ip: string,
    port: number,
  ) => { readonly ip: string; readonly port: number };
  readonly findMachineByIp?: (ip: string) => RemoteMachine | undefined;
};

const createMockMsfconsoleContext = (config: MsfconsoleContextConfig = {}) => {
  const {
    machines = [],
    localIP = '192.168.1.100',
    dnsRecords = [],
    gameTime,
    onExploitAttempt,
    readRemoteFile,
    readLocalFile,
    writeRemoteFile,
    listRemoteDir,
    exploitFileRead,
    exploitDirList,
    runScriptOnTarget,
    resolveNat,
    findMachineByIp,
  } = config;

  const { currentMachineId } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    getCurrentMachineId: currentMachineId !== undefined ? () => currentMachineId : undefined,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    onExploitAttempt,
    getGameTime: gameTime !== undefined ? () => gameTime : undefined,
    readRemoteFile,
    readLocalFile,
    writeRemoteFile,
    listRemoteDir,
    exploitFileRead,
    exploitDirList,
    runScriptOnTarget,
    resolveNat,
    findMachineByIp,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const isNcPrompt = (value: unknown): value is NcPromptData =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as NcPromptData).__type === 'nc_prompt';

// --- Tests ---

describe('msfconsole command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument validation', () => {
    it('should throw error when no host given', () => {
      const context = createMockMsfconsoleContext();
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn()).toThrow('msfconsole: missing host');
    });

    it('should throw error when no port given', () => {
      const context = createMockMsfconsoleContext();
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10')).toThrow('msfconsole: missing or invalid port');
    });

    it('should throw error when port is not a number', () => {
      const context = createMockMsfconsoleContext();
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 'abc')).toThrow(
        'msfconsole: missing or invalid port',
      );
    });

    it('should throw error when port is out of range', () => {
      const context = createMockMsfconsoleContext();
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 0)).toThrow(
        'msfconsole: port must be between 1 and 65535',
      );
      expect(() => msfconsole.fn('10.50.100.10', 70000)).toThrow(
        'msfconsole: port must be between 1 and 65535',
      );
    });
  });

  describe('DNS resolution', () => {
    it('should resolve hostname to IP', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
        dnsRecords: [{ domain: 'web01.mission', ip: '10.50.100.10', type: 'A' }],
      });
      const msfconsole = createMsfconsoleCommand(context);

      const result = msfconsole.fn('web01.mission', 80);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should throw error when hostname cannot be resolved', () => {
      const context = createMockMsfconsoleContext({ dnsRecords: [] });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('unknown.host', 80)).toThrow(
        'msfconsole: unknown.host: Name or service not known',
      );
    });
  });

  describe('connection validation', () => {
    it('should throw error when targeting localhost', () => {
      const context = createMockMsfconsoleContext({ localIP: '192.168.1.100' });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('192.168.1.100', 80)).toThrow(
        'msfconsole: cannot exploit localhost',
      );
    });

    it('should throw error when targeting 127.0.0.1', () => {
      const context = createMockMsfconsoleContext();
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('127.0.0.1', 80)).toThrow('msfconsole: cannot exploit localhost');
    });

    it('should throw error when machine does not exist', () => {
      const context = createMockMsfconsoleContext({ machines: [] });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.0.0.1', 80)).toThrow(
        'msfconsole: connect to 10.0.0.1: Connection timed out',
      );
    });

    it('should throw error when port is closed', () => {
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: false }],
          }),
        ],
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow(
        'msfconsole: 10.50.100.10:80: Connection refused',
      );
    });

    it('should throw error when port does not exist', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 9999)).toThrow(
        'msfconsole: 10.50.100.10:9999: Connection refused',
      );
    });

    it('should throw error when port has no vulnerability', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);

      // Port 22 (ssh) has no vulnerability
      expect(() => msfconsole.fn('10.50.100.10', 22)).toThrow(
        'msfconsole: no known vulnerability on 10.50.100.10:22',
      );
    });

    it('should throw error when port has vulnerability but no owner', () => {
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
                // No owner
              },
            ],
          }),
        ],
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow(
        'msfconsole: exploit failed — service not exploitable',
      );
    });
  });

  describe('successful exploitation', () => {
    it('should return AsyncOutput', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);

      const result = msfconsole.fn('10.50.100.10', 80);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should output exploitation phases', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward through all phases (4 * 600ms)
      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('Targeting 10.50.100.10:80'))).toBe(true);
      expect(lines.some((l) => l.includes('CVE-2024-9001'))).toBe(true);
      expect(lines.some((l) => l.includes('Sending exploit payload'))).toBe(true);
      expect(lines.some((l) => l.includes('Exploit successful'))).toBe(true);
      // CVE-2024-9001 is shell_limited with tier 'user' — msfconsole uses
      // the effect's tier (not the port owner's) to resolve the shell user.
      // No 'user'-type account in the mock machine → fallback to 'user'.
      expect(lines.some((l) => l.includes('Got shell as user@10.50.100.10'))).toBe(true);
    });

    it('should complete with NcPromptData for restricted shell', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(3000);

      expect(isNcPrompt(followUp)).toBe(true);
      if (isNcPrompt(followUp)) {
        expect(followUp.targetIP).toBe('10.50.100.10');
        expect(followUp.targetPort).toBe(80);
        expect(followUp.service).toBe('http');
        // shell_limited now reflects the CVE's effect.tier (user for
        // CVE-2024-9001), not the port owner's userType.
        expect(followUp.userType).toBe('user');
      }
    });
  });

  describe('dynamic vulnerability lookup', () => {
    it('should exploit a port whose serviceVersion matches a CVE, even without a stored vulnerability field', () => {
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
                owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
              },
            ],
          }),
        ],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('CVE-2024-9001'))).toBe(true);
      expect(lines.some((l) => l.includes('Exploit successful'))).toBe(true);
    });

    it('should reject exploitation when serviceVersion does not match any CVE', () => {
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/999.0.0',
                open: true,
                owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
              },
            ],
          }),
        ],
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow(
        'msfconsole: no known vulnerability on 10.50.100.10:80',
      );
    });

    it('should pick the CVE that matches the specific serviceVersion, not just the service', () => {
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.25',
                open: true,
                owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
              },
            ],
          }),
        ],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('CVE-2024-9002'))).toBe(true);
    });
  });

  describe('onExploitAttempt callback', () => {
    it('calls onExploitAttempt with success=true when exploit succeeds', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
        onExploitAttempt,
      });
      const msfconsole = createMsfconsoleCommand(context);
      msfconsole.fn('10.50.100.10', 80);

      expect(onExploitAttempt).toHaveBeenCalledTimes(1);
      expect(onExploitAttempt).toHaveBeenCalledWith({
        targetIp: '10.50.100.10',
        port: 80,
        service: 'http',
        serviceVersion: 'Apache/2.4.49',
        success: true,
      });
    });

    it('calls onExploitAttempt with success=false when no CVE matches the version', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/999.0.0',
                open: true,
                owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
              },
            ],
          }),
        ],
        onExploitAttempt,
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow('msfconsole: no known vulnerability');
      expect(onExploitAttempt).toHaveBeenCalledTimes(1);
      expect(onExploitAttempt).toHaveBeenCalledWith({
        targetIp: '10.50.100.10',
        port: 80,
        service: 'http',
        serviceVersion: 'Apache/999.0.0',
        success: false,
      });
    });

    it('calls onExploitAttempt with success=false when port is closed', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49', open: false }],
          }),
        ],
        onExploitAttempt,
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow('Connection refused');
      expect(onExploitAttempt).toHaveBeenCalledTimes(1);
      expect(onExploitAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIp: '10.50.100.10',
          port: 80,
          success: false,
        }),
      );
    });

    it('calls onExploitAttempt with success=false when port does not exist', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
        onExploitAttempt,
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 9999)).toThrow('Connection refused');
      expect(onExploitAttempt).toHaveBeenCalledTimes(1);
      expect(onExploitAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIp: '10.50.100.10',
          port: 9999,
          success: false,
        }),
      );
    });

    it('calls onExploitAttempt with success=false when CVE matches but port has no owner', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({
        machines: [
          getMockRemoteMachine({
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
                // no owner
              },
            ],
          }),
        ],
        onExploitAttempt,
      });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.50.100.10', 80)).toThrow('service not exploitable');
      expect(onExploitAttempt).toHaveBeenCalledTimes(1);
      expect(onExploitAttempt).toHaveBeenCalledWith({
        targetIp: '10.50.100.10',
        port: 80,
        service: 'http',
        serviceVersion: 'Apache/2.4.49',
        success: false,
      });
    });

    it('does NOT call onExploitAttempt on argument validation errors', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({ onExploitAttempt });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn()).toThrow('missing host');
      expect(() => msfconsole.fn('10.50.100.10')).toThrow('missing or invalid port');
      expect(() => msfconsole.fn('10.50.100.10', 0)).toThrow('port must be');
      expect(onExploitAttempt).not.toHaveBeenCalled();
    });

    it('does NOT call onExploitAttempt when the target machine does not exist', () => {
      const onExploitAttempt = vi.fn();
      const context = createMockMsfconsoleContext({ machines: [], onExploitAttempt });
      const msfconsole = createMsfconsoleCommand(context);

      expect(() => msfconsole.fn('10.99.99.99', 80)).toThrow('Connection timed out');
      expect(onExploitAttempt).not.toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    it('should not output after cancellation', () => {
      const context = createMockMsfconsoleContext({
        machines: [getMockRemoteMachine()],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );

        // Cancel after first line
        result.cancel?.();
        vi.advanceTimersByTime(3000);
      }

      // Only the initial targeting line (synchronous) should appear
      expect(lines).toHaveLength(1);
      expect(completed).toBe(false);
    });
  });

  const findCveWithEffect = (service: string, effectKind: string) => {
    const timeline = buildTimeline(service, 2000, CVE_TIMING_CONFIG);
    for (const entry of timeline) {
      const vuln = buildGeneratedVuln(service, entry);
      if (vuln.effect.kind === effectKind) return { entry, vuln };
    }
    throw new Error(`no ${effectKind} CVE found for ${service} in first 2000 days`);
  };

  // Variant of findCveWithEffect that also filters by tier. Some tests
  // (notably the cross-player password_reset tests) need a specific
  // (effect, tier) pair because the substitution mechanics differ by
  // which row in /etc/passwd gets pwned. Scans across services because
  // no single service is guaranteed to have all three tiers in its
  // generated timeline.
  const findCveWithEffectAndTier = (effectKind: string, tier: 'guest' | 'user' | 'root') => {
    const services = ['mysql', 'http', 'ssh', 'ftp', 'redis', 'mongodb', 'smtp', 'snmp'];
    for (const service of services) {
      const timeline = buildTimeline(service, 2000, CVE_TIMING_CONFIG);
      for (const entry of timeline) {
        const vuln = buildGeneratedVuln(service, entry);
        if (vuln.effect.kind === effectKind && 'tier' in vuln.effect && vuln.effect.tier === tier) {
          return { entry, vuln, service };
        }
      }
    }
    throw new Error(`no ${effectKind} CVE with tier=${tier} found in any service timeline`);
  };

  describe('effect dispatch — shell_full', () => {
    it('returns an exploit_shell follow-up for a CVE with shell_full effect', () => {
      const { entry, vuln } = findCveWithEffect('http', 'shell_full');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 80,
            service: 'http',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'www-data', userType: 'guest', homePath: '/var/www' },
          },
        ],
      });
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      let followUp: AsyncFollowUp | undefined;
      result.start(
        () => {},
        (fu) => {
          followUp = fu;
        },
      );
      vi.advanceTimersByTime(5000);

      expect(followUp).toBeDefined();
      expect(followUp?.__type).toBe('exploit_shell');
      if (followUp && '__type' in followUp && followUp.__type === 'exploit_shell') {
        const shell = followUp as { __type: 'exploit_shell'; tier: string; targetIP: string };
        expect(['guest', 'user', 'root']).toContain(shell.tier);
        expect(shell.targetIP).toBe('10.50.100.10');
      }
    });

    it('still returns nc_prompt for a CVE with shell_limited effect', () => {
      // Apache/2.4.49 is hand-authored with shell_limited
      const machine = getMockRemoteMachine();
      const context = createMockMsfconsoleContext({ machines: [machine] });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 80);

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      let followUp: AsyncFollowUp | undefined;
      result.start(
        () => {},
        (fu) => {
          followUp = fu;
        },
      );
      vi.advanceTimersByTime(5000);

      expect(followUp).toBeDefined();
      expect(followUp?.__type).toBe('nc_prompt');
    });
  });

  describe('effect dispatch — one-shot effects', () => {
    const mkMachineWithCve = (effectKind: string, service = 'http', portNum = 80) => {
      const { entry, vuln } = findCveWithEffect(service, effectKind);
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: portNum,
            service,
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'www-data', userType: 'guest', homePath: '/var/www' },
          },
        ],
      });
      return { entry, vuln, machine };
    };

    // Tier-specific variant — picks a CVE with a specific (effect, tier)
    // across the full service catalog (no single service is guaranteed
    // to have all three tiers). Port number is derived from the chosen
    // service's first instance — the exact port doesn't matter because
    // the test always invokes msfconsole with that port directly.
    const mkMachineWithCveAtTier = (effectKind: string, tier: 'guest' | 'user' | 'root') => {
      const { entry, vuln, service } = findCveWithEffectAndTier(effectKind, tier);
      // Pick a sensible default port per service.
      const portMap: Record<string, number> = {
        mysql: 3306,
        http: 80,
        ssh: 22,
        ftp: 21,
        redis: 6379,
        mongodb: 27017,
        smtp: 25,
        snmp: 161,
      };
      const port = portMap[service] ?? 80;
      const machine = getMockRemoteMachine({
        ports: [
          {
            port,
            service,
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'www-data', userType: 'guest', homePath: '/var/www' },
          },
        ],
      });
      return { entry, vuln, machine, port, service };
    };

    it('file_read prints target file content with no follow-up', async () => {
      const { entry, machine } = mkMachineWithCve('file_read', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => 'root:x:0:0:root:/root:/bin/bash',
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 21, '/etc/passwd');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      let followUp: AsyncFollowUp | undefined;
      result.start(
        (line) => lines.push(line),
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(lines.some((l) => l.includes('root:x:0:0'))).toBe(true);
      expect(followUp).toBeUndefined();
    });

    it('file_read throws when 3rd arg is missing', () => {
      const { entry, machine } = mkMachineWithCve('file_read', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
      });
      expect(() => createMsfconsoleCommand(context).fn('10.50.100.10', 21)).toThrow(/target path/i);
    });

    it('dir_list prints directory listing with no follow-up', async () => {
      const { entry, machine } = mkMachineWithCve('dir_list', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitDirList: async () => ['file1.txt', 'file2.txt', 'subdir'],
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 21, '/home');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      let followUp: AsyncFollowUp | undefined;
      result.start(
        (line) => lines.push(line),
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(lines.some((l) => l.includes('file1.txt'))).toBe(true);
      expect(followUp).toBeUndefined();
    });

    it('file_write uploads local content to target', async () => {
      const { entry, machine } = mkMachineWithCve('file_write', 'ftp', 21);
      const written: Array<{ path: string; content: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'payload-content',
        writeRemoteFile: async (_id, path, content) => {
          written.push({ path, content });
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn(
        '10.50.100.10',
        21,
        '/root/p.txt:/var/www/p.txt',
      );
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      let followUp: AsyncFollowUp | undefined;
      result.start(
        () => {},
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(written).toHaveLength(1);
      expect(written[0]?.path).toBe('/var/www/p.txt');
      expect(followUp).toBeUndefined();
    });

    it('file_write surfaces failure when the underlying write returns {allowed: false}', async () => {
      // Real bug: msfconsole's file_write case used to print "Exploit
      // successful" unconditionally, even when the remote write failed
      // (e.g., target path's parent dir unwritable). The user only
      // discovered it via the network tab showing no patch.
      const { entry, machine } = mkMachineWithCve('file_write', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'payload-content',
        writeRemoteFile: async () => ({
          allowed: false,
          error: 'Permission denied: /readonly/p.txt',
        }),
      });
      const result = createMsfconsoleCommand(context).fn(
        '10.50.100.10',
        21,
        '/root/p.txt:/readonly/p.txt',
      );
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);
      // Failure must surface — "Exploit failed" with the underlying error.
      expect(lines.some((l) => /exploit failed/i.test(l) && /permission denied/i.test(l))).toBe(
        true,
      );
      // Critical: the success message must NOT print on a failed write.
      expect(lines.some((l) => /exploit successful/i.test(l))).toBe(false);
    });

    it('file_write throws when local:remote syntax is missing', () => {
      const { entry, machine } = mkMachineWithCve('file_write', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
      });
      expect(() => createMsfconsoleCommand(context).fn('10.50.100.10', 21, '/no-colon')).toThrow(
        /local:remote/i,
      );
    });

    // /etc/passwd fixture used by the password_reset tests below. Mirrors
    // the workstation/home shape: root (uid 0) + a user-tier account
    // (uid 1000) + guest. password_reset CVEs in the vulnerability pool
    // are all tier='user', so the fixture MUST include a user-tier line —
    // otherwise findUsernameByUserType returns undefined and the effect
    // bails with "no user user found on target". A separate test covers
    // the empty-hash main-user case (player's own user with passwordHash:'').
    const PASSWD_FIXTURE = [
      'root:oldRootHash:0:0:root:/root:/bin/bash',
      'alice:oldUserHash:1000:1000:alice:/home/alice:/bin/bash',
      'guest:oldGuestHash:1001:1001:guest:/home/guest:/bin/bash',
    ].join('\n');

    it('password_reset mutates /etc/passwd and prints new password', async () => {
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      let written = '';
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => PASSWD_FIXTURE,
        writeRemoteFile: async (_id, _path, content) => {
          written = content;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 3306);
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      let followUp: AsyncFollowUp | undefined;
      result.start(
        (line) => lines.push(line),
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(lines.some((l) => /password.*reset/i.test(l) || /new password/i.test(l))).toBe(true);
      expect(written.length).toBeGreaterThan(0);
      expect(followUp).toBeUndefined();
    });

    it('password_reset writes md5(newPassword) into /etc/passwd, not the plaintext', async () => {
      // /etc/passwd stores md5 hashes everywhere else (per CLAUDE.md
      // "/etc/passwd (not /etc/shadow) for password storage"). password_reset
      // used to substitute the plaintext password directly, which broke
      // subsequent auth: the auth code md5s the player's typed password and
      // compares against /etc/passwd, but the column held plaintext.
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      let written = '';
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => PASSWD_FIXTURE,
        writeRemoteFile: async (_id, _path, content) => {
          written = content;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 3306);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      // The plaintext password is surfaced to the player so they know what
      // to type at the next auth prompt.
      const newPasswordLine = lines.find((l) => /new password:/.test(l));
      const newPassword = newPasswordLine?.match(/new password:\s*(\S+)/)?.[1];
      expect(newPassword).toBeDefined();

      // Critical: /etc/passwd must NOT contain the plaintext.
      expect(written).not.toContain(newPassword!);
      // It MUST contain the md5 hash so auth succeeds when the player
      // types the plaintext (auth code md5s input and compares).
      expect(written).toContain(md5(newPassword!));
    });

    // NAT resolution: when the player runs `msfconsole publicIP forwardedPort`
    // (NAT-forwarded port from outside), the effect must operate on the
    // internal target machine, not on the public-IP router. Without this,
    // password_reset writes /etc/passwd on the router (where the chosen
    // user may not even exist), and ssh against public:22 → internal:22
    // can't authenticate with the rolled credential.
    it('password_reset on a NAT-forwarded public port writes /etc/passwd on the resolved internal target', async () => {
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      // machine.ip is '10.50.100.10' (internal). Player runs against '203.0.113.5' (public).
      // Mirror the runtime: getMachine(publicIP) returns the router with the
      // forwarded port merged in (same port + CVE inheritance from internal).
      const router: RemoteMachine = { ...machine, ip: '203.0.113.5', hostname: 'router' };
      const writes: Array<{ machineId: string; path: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine, router],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => PASSWD_FIXTURE,
        writeRemoteFile: async (machineId, path, _content) => {
          writes.push({ machineId, path });
          return { allowed: true };
        },
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 3306 ? { ip: '10.50.100.10', port: 3306 } : { ip, port },
      });
      const result = createMsfconsoleCommand(context).fn('203.0.113.5', 3306);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      result.start(
        () => {},
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(writes).toHaveLength(1);
      // Critical: write target is the resolved internal IP, not the public IP.
      expect(writes[0]?.machineId).toBe('10.50.100.10');
      expect(writes[0]?.path).toBe('/etc/passwd');
    });

    it('uses findMachineByIp to resolve the post-NAT internal target when getMachine cannot see internal IPs (localhost attacker)', async () => {
      // Real bug: when the player runs msfconsole from localhost against a
      // public IP, getMachine(internalIP) returns undefined because the LAN
      // isn't visible from localhost. Without findMachineByIp, the post-NAT
      // effectiveMachine falls back to the router (machine), tier-matching
      // picks a router user (e.g., snmpadm) that doesn't exist on the actual
      // internal target — the substitution loop finds no matching row and
      // /etc/passwd is written unchanged.
      const { entry, machine: routerWithCve } = mkMachineWithCve('password_reset', 'mysql', 3306);
      const router: RemoteMachine = { ...routerWithCve, ip: '203.0.113.5', hostname: 'router' };
      const findMachineByIp = vi.fn((ip: string) =>
        ip === '10.50.100.10' ? routerWithCve : undefined,
      );
      const context = createMockMsfconsoleContext({
        // getMachine returns ONLY the router — internal LAN not visible
        // (mirrors the localhost-attacker reality where the player's view
        // doesn't include LAN machines).
        machines: [router],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => PASSWD_FIXTURE,
        writeRemoteFile: async () => ({ allowed: true }),
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 3306 ? { ip: '10.50.100.10', port: 3306 } : { ip, port },
        findMachineByIp,
      });
      const result = createMsfconsoleCommand(context).fn('203.0.113.5', 3306);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      result.start(
        () => {},
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      // The wiring asserts the fix: findMachineByIp gets called with the
      // resolved internal IP, so effectiveMachine comes from the
      // whole-mission lookup instead of the limited getMachine view.
      expect(findMachineByIp).toHaveBeenCalledWith('10.50.100.10');
    });

    it('file_write on a NAT-forwarded public port uploads to the resolved internal target', async () => {
      const { entry, machine } = mkMachineWithCve('file_write', 'ftp', 21);
      const router: RemoteMachine = { ...machine, ip: '203.0.113.5', hostname: 'router' };
      const writes: Array<{ machineId: string; path: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine, router],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'payload',
        writeRemoteFile: async (machineId, path, _content) => {
          writes.push({ machineId, path });
          return { allowed: true };
        },
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 21 ? { ip: '10.50.100.10', port: 21 } : { ip, port },
      });
      const result = createMsfconsoleCommand(context).fn(
        '203.0.113.5',
        21,
        '/local.txt:/var/www/uploaded.txt',
      );
      if (!isAsyncOutput(result)) throw new Error('expected async');
      result.start(
        () => {},
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(writes).toHaveLength(1);
      expect(writes[0]?.machineId).toBe('10.50.100.10');
      expect(writes[0]?.path).toBe('/var/www/uploaded.txt');
    });

    it('password_reset sets a password on a main user whose hash field was empty (workstation main-user case)', async () => {
      // The player's own workstation main user ships with passwordHash:''
      // (see generateLocalhost.ts — "they can always exit() back"). On
      // cross-player workstations, that empty-hash line is what A sees
      // when reading B's /etc/passwd via exploitFileRead. The substitution
      // loop must still match the line and write a *non-empty* hash —
      // turning the previously-passwordless main user into one A can
      // authenticate as.
      const { entry, machine, port } = mkMachineWithCveAtTier('password_reset', 'user');
      const emptyHashPasswd = [
        'root:rootHash:0:0:root:/root:/bin/bash',
        'bob::1000:1000:bob:/home/bob:/bin/bash',
      ].join('\n');
      let written = '';
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => emptyHashPasswd,
        writeRemoteFile: async (_id, _path, content) => {
          written = content;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', port);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      const newPasswordLine = lines.find((l) => /new password:/.test(l));
      const newPassword = newPasswordLine?.match(/new password:\s*(\S+)/)?.[1];
      expect(newPassword).toBeDefined();

      // Bob's line must now have a non-empty md5 hash in field [1].
      const bobLine = written.split('\n').find((l) => l.startsWith('bob:'));
      expect(bobLine).toBeDefined();
      const bobHash = bobLine!.split(':')[1];
      expect(bobHash).toBe(md5(newPassword!));

      // Success line names the actual user picked from /etc/passwd.
      expect(lines.some((l) => /Password reset for 'bob'/.test(l))).toBe(true);
    });

    it('password_reset bails cleanly when exploitFileRead returns null (cross-player read failure)', async () => {
      // Cross-player exploitFileRead returns null on server error / 404 /
      // unsupported machine type. The effect must surface a clean failure
      // instead of writing an empty /etc/passwd over the target.
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      let writeCalled = false;
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => null,
        writeRemoteFile: async () => {
          writeCalled = true;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 3306);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(lines.some((l) => /exploit failed/i.test(l) && /\/etc\/passwd/.test(l))).toBe(true);
      expect(lines.some((l) => /exploit successful/i.test(l))).toBe(false);
      expect(writeCalled).toBe(false);
    });

    it('password_reset bails cleanly when no user matches the CVE tier', async () => {
      // /etc/passwd containing only root + guest (no uid-1000 user-tier
      // account) against a tier='user' CVE. Must not silently no-op by
      // writing /etc/passwd unchanged.
      const { entry, machine, port } = mkMachineWithCveAtTier('password_reset', 'user');
      const noUserTierPasswd = [
        'root:rootHash:0:0:root:/root:/bin/bash',
        'guest:guestHash:1001:1001:guest:/home/guest:/bin/bash',
      ].join('\n');
      let writeCalled = false;
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => noUserTierPasswd,
        writeRemoteFile: async () => {
          writeCalled = true;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', port);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(lines.some((l) => /exploit failed/i.test(l) && /no user user/i.test(l))).toBe(true);
      expect(writeCalled).toBe(false);
    });

    it('password_reset picks the target user from /etc/passwd content, not effectiveMachine.users (cross-player)', async () => {
      // Regression: the old code looked at effectiveMachine.users to pick
      // the target username for tier='user'/'guest'. For cross-player
      // workstations A's local view of B's machine has users:[] (or
      // stale names), so the lookup returned the literal string 'user'
      // as a fallback — and the substitution loop, finding no line
      // starting with 'user', wrote /etc/passwd unchanged. The fix
      // derives the username from the *actual* /etc/passwd content
      // (B's regenerated FS, served via exploitFileRead).
      const {
        entry,
        machine: baseMachine,
        port,
      } = mkMachineWithCveAtTier('password_reset', 'user');
      // Strip the local users[] view to mirror the cross-player case.
      const machine: RemoteMachine = { ...baseMachine, users: [] };
      const crossPlayerPasswd = [
        'root:rootHash:0:0:root:/root:/bin/bash',
        'omenuser:omenHash:1000:1000:omenuser:/home/omenuser:/bin/bash',
      ].join('\n');
      let written = '';
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => crossPlayerPasswd,
        writeRemoteFile: async (_id, _path, content) => {
          written = content;
          return { allowed: true };
        },
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', port);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      // Targeted user is the one parsed from passwd, not the literal 'user'.
      expect(lines.some((l) => /Password reset for 'omenuser'/.test(l))).toBe(true);
      const omenLine = written.split('\n').find((l) => l.startsWith('omenuser:'));
      expect(omenLine).toBeDefined();
      // Hash field changed (was 'omenHash', now md5 of the new plaintext).
      expect(omenLine!.split(':')[1]).not.toBe('omenHash');
      expect(omenLine!.split(':')[1]).toMatch(/^[a-f0-9]{32}$/);
    });

    it('password_reset surfaces failure when /etc/passwd write returns {allowed: false}', async () => {
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        exploitFileRead: async () => PASSWD_FIXTURE,
        writeRemoteFile: async () => ({ allowed: false, error: 'Permission denied: /etc/passwd' }),
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 3306);
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(lines.some((l) => /exploit failed/i.test(l) && /permission denied/i.test(l))).toBe(
        true,
      );
      expect(lines.some((l) => /exploit successful/i.test(l))).toBe(false);
    });
  });

  describe('effect dispatch — backdoor_port_open', () => {
    it('writes a nc pid file on the target and returns no follow-up', async () => {
      const { entry, vuln } = findCveWithEffect('ssh', 'backdoor_port_open');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 22,
            service: 'ssh',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'root', userType: 'root', homePath: '/root' },
          },
        ],
      });
      const written: Array<{ machineId: string; path: string; content: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        writeRemoteFile: async (machineId, path, content) => {
          written.push({ machineId, path, content });
          return { allowed: true };
        },
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 22);

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      let followUp: AsyncFollowUp | undefined;
      result.start(
        (line) => lines.push(line),
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(written).toHaveLength(1);
      expect(written[0]?.path).toMatch(/\/var\/run\/nc-\d+\.pid/);
      expect(written[0]?.content).toContain('nc:port=');
      expect(lines.some((l) => /backdoor.*port/i.test(l))).toBe(true);
      expect(followUp).toBeUndefined();
    });

    it('backdoor_port_open on a NAT-forwarded public port plants the pid file on the resolved internal target', async () => {
      const { entry, vuln } = findCveWithEffect('ssh', 'backdoor_port_open');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 22,
            service: 'ssh',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'root', userType: 'root', homePath: '/root' },
          },
        ],
      });
      const router: RemoteMachine = { ...machine, ip: '203.0.113.5', hostname: 'router' };
      const writes: Array<{ machineId: string; path: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine, router],
        gameTime: entry.publishedAt,
        writeRemoteFile: async (machineId, path, _content) => {
          writes.push({ machineId, path });
          return { allowed: true };
        },
        // 203.0.113.5:22 (public) → 10.50.100.10:22 (internal)
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 22 ? { ip: '10.50.100.10', port: 22 } : { ip, port },
      });
      const result = createMsfconsoleCommand(context).fn('203.0.113.5', 22);
      if (!isAsyncOutput(result)) throw new Error('expected async');
      result.start(
        () => {},
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      // pid file lands on the internal target, not the router's public IP.
      expect(writes).toHaveLength(1);
      expect(writes[0]?.machineId).toBe('10.50.100.10');
    });

    it('backdoor_port_open surfaces failure when the nc pid file write returns {allowed: false}', async () => {
      const { entry, vuln } = findCveWithEffect('ssh', 'backdoor_port_open');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 22,
            service: 'ssh',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'root', userType: 'root', homePath: '/root' },
          },
        ],
      });
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        writeRemoteFile: async () => ({ allowed: false, error: 'Permission denied: /var/run' }),
      });
      const result = createMsfconsoleCommand(context).fn('10.50.100.10', 22);
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(lines.some((l) => /exploit failed/i.test(l) && /permission denied/i.test(l))).toBe(
        true,
      );
      expect(lines.some((l) => /exploit successful/i.test(l))).toBe(false);
      // The "Backdoor planted" message must NOT print on a failed write.
      expect(lines.some((l) => /backdoor planted/i.test(l))).toBe(false);
    });
  });

  describe('effect dispatch — script_exec', () => {
    it('reads the local script, runs it blindly, and shows injection success', async () => {
      const { entry, vuln } = findCveWithEffect('redis', 'script_exec');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 6379,
            service: 'redis',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'redis', userType: 'user', homePath: '/var/lib/redis' },
          },
        ],
      });
      const runScriptOnTarget = vi.fn(async () => ({ error: null }));
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'sshd()',
        runScriptOnTarget,
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 6379, '/root/payloads/start_ssh.js');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      let followUp: AsyncFollowUp | undefined;
      result.start(
        (line) => lines.push(line),
        (fu) => {
          followUp = fu;
        },
      );
      await vi.advanceTimersByTimeAsync(5000);

      // Blind injection — no script output, just success message
      expect(lines.some((l) => l.includes('Script injected'))).toBe(true);
      expect(lines.some((l) => l.includes('Exploit successful'))).toBe(true);
      expect(runScriptOnTarget).toHaveBeenCalledWith('10.50.100.10', 'sshd()', vuln.effect.tier);
      expect(followUp).toBeUndefined();
    });

    it('shows injection failure when script errors', async () => {
      const { entry, vuln } = findCveWithEffect('redis', 'script_exec');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 6379,
            service: 'redis',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'redis', userType: 'user', homePath: '/var/lib/redis' },
          },
        ],
      });
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'sshd()',
        runScriptOnTarget: async () => ({ error: 'sshd: permission denied' }),
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 6379, '/root/payloads/start_ssh.js');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(lines.some((l) => l.includes('Script injection failed'))).toBe(true);
      expect(lines.some((l) => l.includes('permission denied'))).toBe(true);
    });

    it('throws when the 3rd arg (script path) is missing', () => {
      const { entry, vuln } = findCveWithEffect('redis', 'script_exec');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 6379,
            service: 'redis',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'redis', userType: 'user', homePath: '/var/lib/redis' },
          },
        ],
      });
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
      });
      const msfconsole = createMsfconsoleCommand(context);
      expect(() => msfconsole.fn('10.50.100.10', 6379)).toThrow(/target path/i);
    });

    it('shows an error when the local script file cannot be read', () => {
      const { entry, vuln } = findCveWithEffect('redis', 'script_exec');
      const machine = getMockRemoteMachine({
        ports: [
          {
            port: 6379,
            service: 'redis',
            serviceVersion: vuln.serviceVersion,
            open: true,
            owner: { username: 'redis', userType: 'user', homePath: '/var/lib/redis' },
          },
        ],
      });
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => null,
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 6379, '/root/missing.js');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => /could not.*open.*script/i.test(l))).toBe(true);
    });
  });

  describe('--local (library CVE exploitation)', () => {
    // Walk the libpam timeline to find entry 0 (the startTuple version).
    // At gameTime = entry.publishedAt, that libpam version has a live CVE,
    // which — since every machine's dpkg status carries startTuple-formatted
    // library versions — is exactly what we need to exploit `su` locally.
    const libpamFirstCveEntry = () => {
      const timeline = buildTimelineFromTemplate(
        systemLibraryTemplates.libpam,
        'library:libpam',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[0]!;
    };

    // Build a dpkg/status content with every library at its startTuple
    // (matches what generateFileSystems seeds per-machine).
    const initialDpkgStatus = () => {
      const libraryVersions: Record<string, string> = {};
      for (const [lib, tpl] of Object.entries(systemLibraryTemplates)) {
        libraryVersions[lib] = formatVersion(tpl, tpl.startTuple);
      }
      return buildInitialDpkgStatus([], undefined, libraryVersions);
    };

    const targetMachine = (): RemoteMachine =>
      getMockRemoteMachine({
        ip: '10.50.100.50',
        hostname: 'breached',
        // Ports don't matter for --local but the machine must be resolvable.
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9', open: true }],
      });

    it('throws "no known vulnerability" when no library CVE is live', () => {
      const machine = targetMachine();
      const context = createMockMsfconsoleContext({
        machines: [machine],
        currentMachineId: machine.ip,
        gameTime: 0, // pre-any-CVE
        readRemoteFile: () => initialDpkgStatus(),
      });
      const msfconsole = createMsfconsoleCommand(context);
      expect(() => msfconsole.fn('--local', 'su')).toThrow(/no known vulnerability/i);
    });

    it('returns an async output when a linked library has a live CVE', () => {
      const entry = libpamFirstCveEntry();
      const machine = targetMachine();
      const context = createMockMsfconsoleContext({
        machines: [machine],
        currentMachineId: machine.ip,
        gameTime: entry.publishedAt,
        readRemoteFile: () => initialDpkgStatus(),
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('--local', 'su');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('announces the underlying library CVE in the exploit output', () => {
      const entry = libpamFirstCveEntry();
      const machine = targetMachine();
      const context = createMockMsfconsoleContext({
        machines: [machine],
        currentMachineId: machine.ip,
        gameTime: entry.publishedAt,
        readRemoteFile: () => initialDpkgStatus(),
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('--local', 'su');
      if (!isAsyncOutput(result)) throw new Error('expected async output');

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      vi.advanceTimersByTime(5000);

      // The exploit output should reference a CVE id (format: CVE-YYYY-NNNNNNN).
      expect(lines.some((l) => /CVE-\d{4}-\d{7}/.test(l))).toBe(true);
    });

    it('is deterministic: same seed + gameTime produces same effect twice', () => {
      const entry = libpamFirstCveEntry();
      const machine = targetMachine();
      const runOnce = (): readonly string[] => {
        const context = createMockMsfconsoleContext({
          machines: [machine],
          currentMachineId: machine.ip,
          gameTime: entry.publishedAt,
          readRemoteFile: () => initialDpkgStatus(),
        });
        const msfconsole = createMsfconsoleCommand(context);
        const result = msfconsole.fn('--local', 'su');
        if (!isAsyncOutput(result)) throw new Error('expected async output');
        const lines: string[] = [];
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
        return lines;
      };
      // We compare a stable slice of the output — specifically the CVE line
      // and the "Exploit successful" line — to verify both the CVE pick and
      // the effect roll are deterministic.
      const a = runOnce();
      const b = runOnce();
      const filterStable = (lines: readonly string[]) => lines.filter((l) => /CVE-|\[\+\]/.test(l));
      expect(filterStable(a)).toEqual(filterStable(b));
    });

    it('throws for a command with no libraryDeps entry', () => {
      const entry = libpamFirstCveEntry();
      const machine = targetMachine();
      const context = createMockMsfconsoleContext({
        machines: [machine],
        currentMachineId: machine.ip,
        gameTime: entry.publishedAt,
        readRemoteFile: () => initialDpkgStatus(),
      });
      const msfconsole = createMsfconsoleCommand(context);
      // `mkdir` is explicitly excluded from libraryDeps (weak thematic fit).
      expect(() => msfconsole.fn('--local', 'mkdir')).toThrow(/no known vulnerability/i);
    });

    it('throws when --local is used without a command argument', () => {
      const context = createMockMsfconsoleContext({ currentMachineId: '10.50.100.50' });
      const msfconsole = createMsfconsoleCommand(context);
      expect(() => msfconsole.fn('--local')).toThrow(/--local.*command|missing.*command/i);
    });

    it('throws when the current machine cannot be resolved', () => {
      const context = createMockMsfconsoleContext({
        machines: [],
        currentMachineId: '10.50.100.99',
        gameTime: 0,
      });
      const msfconsole = createMsfconsoleCommand(context);
      expect(() => msfconsole.fn('--local', 'su')).toThrow();
    });

    it('resolves the current machine via getCurrentMachine for the player workstation (not in remote machines list)', () => {
      // The player's own workstation isn't in the remote-machines list —
      // it's generated separately. getCurrentMachine is the escape hatch
      // for --local. Under the eliminated-localhost model, currentMachineId
      // is the workstation_id (= hostname), not the legacy 'localhost'
      // literal.
      const entry = libpamFirstCveEntry();
      const ownWorkstationId = 'workstation-aabbccdd';
      const ownMachine: RemoteMachine = {
        ip: ownWorkstationId,
        hostname: ownWorkstationId,
        ports: [],
        users: [
          { username: 'root', userType: 'root' },
          { username: 'player', userType: 'user' },
          { username: 'guest', userType: 'guest' },
        ],
      };
      const context = {
        ...createMockMsfconsoleContext({
          machines: [], // no remote machines; the player's workstation is NOT in this list
          currentMachineId: ownWorkstationId,
          gameTime: entry.publishedAt,
          readRemoteFile: () => initialDpkgStatus(),
        }),
        getCurrentMachine: () => ownMachine,
      };
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('--local', 'su');
      expect(isAsyncOutput(result)).toBe(true);
    });
  });
});
