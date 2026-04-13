import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncFollowUp, AsyncOutput, NcPromptData } from '../components/Terminal/types';
import { createMsfconsoleCommand } from './msfconsole';
import { buildTimeline, buildGeneratedVuln, CVE_TIMING_CONFIG } from '../generation/timeline';

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
    { username: 'root', passwordHash: 'abc', userType: 'root' },
    { username: 'guest', passwordHash: 'def', userType: 'guest' },
  ],
  ...overrides,
});

type MsfconsoleContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
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
  readonly writeRemoteFile?: (machineId: string, path: string, content: string) => void;
  readonly listRemoteDir?: (machineId: string, path: string) => readonly string[] | null;
  readonly runScriptOnTarget?: (
    machineId: string,
    scriptBody: string,
    tier: 'guest' | 'user' | 'root',
  ) => readonly string[];
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
    runScriptOnTarget,
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    onExploitAttempt,
    getGameTime: gameTime !== undefined ? () => gameTime : undefined,
    readRemoteFile,
    readLocalFile,
    writeRemoteFile,
    listRemoteDir,
    runScriptOnTarget,
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
      expect(lines.some((l) => l.includes('CVE-2021-41773'))).toBe(true);
      expect(lines.some((l) => l.includes('Sending exploit payload'))).toBe(true);
      expect(lines.some((l) => l.includes('Exploit successful'))).toBe(true);
      expect(lines.some((l) => l.includes('Got shell as guest@10.50.100.10'))).toBe(true);
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
        expect(followUp.username).toBe('guest');
        expect(followUp.userType).toBe('guest');
        expect(followUp.homePath).toBe('/home/guest');
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

      expect(lines.some((l) => l.includes('CVE-2021-41773'))).toBe(true);
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

      expect(lines.some((l) => l.includes('CVE-2017-7679'))).toBe(true);
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

    it('file_read prints target file content with no follow-up', () => {
      const { entry, machine } = mkMachineWithCve('file_read', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readRemoteFile: () => 'root:x:0:0:root:/root:/bin/bash',
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
      vi.advanceTimersByTime(5000);
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

    it('dir_list prints directory listing with no follow-up', () => {
      const { entry, machine } = mkMachineWithCve('dir_list', 'ftp', 21);
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        listRemoteDir: () => ['file1.txt', 'file2.txt', 'subdir'],
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
      vi.advanceTimersByTime(5000);
      expect(lines.some((l) => l.includes('file1.txt'))).toBe(true);
      expect(followUp).toBeUndefined();
    });

    it('file_write uploads local content to target', () => {
      const { entry, machine } = mkMachineWithCve('file_write', 'ftp', 21);
      const written: Array<{ path: string; content: string }> = [];
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readLocalFile: () => 'payload-content',
        writeRemoteFile: (_id, path, content) => {
          written.push({ path, content });
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
      vi.advanceTimersByTime(5000);
      expect(written).toHaveLength(1);
      expect(written[0]?.path).toBe('/var/www/p.txt');
      expect(followUp).toBeUndefined();
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

    it('password_reset mutates /etc/passwd and prints new password', () => {
      const { entry, machine } = mkMachineWithCve('password_reset', 'mysql', 3306);
      let written = '';
      const context = createMockMsfconsoleContext({
        machines: [machine],
        gameTime: entry.publishedAt,
        readRemoteFile: () => 'root:oldHash:0:0:root:/root:/bin/bash',
        writeRemoteFile: (_id, _path, content) => {
          written = content;
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
      vi.advanceTimersByTime(5000);
      expect(lines.some((l) => /password.*reset/i.test(l) || /new password/i.test(l))).toBe(true);
      expect(written.length).toBeGreaterThan(0);
      expect(followUp).toBeUndefined();
    });
  });

  describe('effect dispatch — backdoor_port_open', () => {
    it('writes a nc pid file on the target and returns no follow-up', () => {
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
        writeRemoteFile: (machineId, path, content) => {
          written.push({ machineId, path, content });
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
      vi.advanceTimersByTime(5000);

      expect(written).toHaveLength(1);
      expect(written[0]?.path).toMatch(/\/var\/run\/nc-\d+\.pid/);
      expect(written[0]?.content).toContain('nc:port=');
      expect(lines.some((l) => /backdoor.*port/i.test(l))).toBe(true);
      expect(followUp).toBeUndefined();
    });
  });

  describe('effect dispatch — script_exec', () => {
    it('reads the local script, runs it on target, and prints output', () => {
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
        readLocalFile: () => 'cat("/etc/passwd")',
        runScriptOnTarget: () => ['root:x:0:0:root:/root:/bin/bash'],
      });
      const msfconsole = createMsfconsoleCommand(context);
      const result = msfconsole.fn('10.50.100.10', 6379, '/root/payloads/dump.js');

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
      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('root:x:0:0'))).toBe(true);
      expect(followUp).toBeUndefined();
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
});
