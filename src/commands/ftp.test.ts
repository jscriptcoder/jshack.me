import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput, FtpPromptData } from '../components/Terminal/types';
import { createFtpCommand } from './ftp';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
  users: [{ username: 'root', userType: 'root' }],
  ...overrides,
});

const getMockDnsRecord = (overrides?: Partial<DnsRecord>): DnsRecord => ({
  domain: 'gateway.local',
  ip: '192.168.1.1',
  type: 'A',
  ...overrides,
});

type FtpContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
};

const createMockFtpContext = (config: FtpContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100', dnsRecords = [] } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) =>
      dnsRecords.find((r) => r.domain.toLowerCase() === domain.toLowerCase()),
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const isFtpPrompt = (value: unknown): value is FtpPromptData =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as FtpPromptData).__type === 'ftp_prompt';

// --- Tests ---

describe('ftp command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no host given', () => {
      const context = createMockFtpContext();
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn()).toThrow('ftp: missing host');
    });

    it('should throw error for unknown hostname', () => {
      const context = createMockFtpContext({ dnsRecords: [] });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('unknown.host')).toThrow('ftp: unknown.host: Name or service not known');
    });

    it('should throw error when connecting to localhost IP', () => {
      const context = createMockFtpContext({ localIP: '192.168.1.100' });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('192.168.1.100')).toThrow('ftp: cannot connect to localhost via FTP');
    });

    it('should throw error when connecting to 127.0.0.1', () => {
      const context = createMockFtpContext();
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('127.0.0.1')).toThrow('ftp: cannot connect to localhost via FTP');
    });

    it('should throw error when connecting to localhost hostname', () => {
      // When 'localhost' is passed, it's treated as a hostname that needs DNS resolution
      // Since there's no DNS record for 'localhost', it fails with name resolution error
      const context = createMockFtpContext();
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('localhost')).toThrow('ftp: localhost: Name or service not known');
    });

    it('should throw error when machine does not exist', () => {
      const context = createMockFtpContext({ machines: [] });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('10.0.0.1')).toThrow(
        'ftp: connect to 10.0.0.1 port 21: Connection refused',
      );
    });

    it('should throw error when FTP port is not open', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('192.168.1.50')).toThrow(
        'ftp: connect to 192.168.1.50 port 21: Connection refused',
      );
    });

    it('should throw error when FTP port exists but is closed', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: false }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('192.168.1.50')).toThrow(
        'ftp: connect to 192.168.1.50 port 21: Connection refused',
      );
    });
  });

  describe('hostname resolution', () => {
    it('should resolve hostname to IP address', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
        dnsRecords: [getMockDnsRecord({ domain: 'fileserver.local', ip: '192.168.1.50' })],
      });
      const ftp = createFtpCommand(context);

      const result = ftp.fn('fileserver.local');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should use resolved IP for connection message', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
        dnsRecords: [getMockDnsRecord({ domain: 'fileserver.local', ip: '192.168.1.50' })],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('fileserver.local');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Connecting to 192.168.1.50...');
    });

    it('should be case-insensitive for hostname lookup', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
        dnsRecords: [getMockDnsRecord({ domain: 'FileServer.Local', ip: '192.168.1.50' })],
      });
      const ftp = createFtpCommand(context);

      const result = ftp.fn('fileserver.local');

      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);

      const result = ftp.fn('192.168.1.50');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);

      const result = ftp.fn('192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);

      const result = ftp.fn('192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('connection execution', () => {
    it('should output connecting message immediately', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Connecting to 192.168.1.50...');
    });

    it('should output connected message after first delay', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Advance past max jitter range (FTP_CONNECT_DELAY_MS = 600)
      vi.advanceTimersByTime(900);

      expect(lines.some((l) => l === 'Connected to 192.168.1.50.')).toBe(true);
    });

    it('should output FTP banner with hostname after banner delay', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward both delays (600 + 400 = 1000ms, ×1.5 for jitter)
      vi.advanceTimersByTime(1500);

      expect(lines.some((l) => l.includes('220 Welcome to fileserver FTP server'))).toBe(true);
    });

    it('should complete with FTP prompt data', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      // Fast-forward to completion (×1.5 for jitter)
      vi.advanceTimersByTime(1500);

      expect(isFtpPrompt(followUp)).toBe(true);
      if (isFtpPrompt(followUp)) {
        expect(followUp.targetIP).toBe('192.168.1.50');
      }
    });

    it('should include resolved IP in FTP prompt data', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
        dnsRecords: [getMockDnsRecord({ domain: 'fileserver.local', ip: '192.168.1.50' })],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('fileserver.local');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(1000);

      if (isFtpPrompt(followUp)) {
        expect(followUp.targetIP).toBe('192.168.1.50');
      }
    });
  });

  describe('cancellation', () => {
    it('should cancel before connected message', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );

        // Cancel before first delay completes
        vi.advanceTimersByTime(300);
        result.cancel?.();
        vi.advanceTimersByTime(3000);
      }

      // Should only have connecting message
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Connecting to 192.168.1.50...');
    });

    it('should cancel before FTP banner', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );

        // Advance past first delay max jitter (600 × 1.25 = 750), then cancel before banner
        vi.advanceTimersByTime(751);
        result.cancel?.();
        vi.advanceTimersByTime(3000);
      }

      // Should have connecting and connected, but not banner
      expect(lines.some((l) => l.includes('220 Welcome'))).toBe(false);
      expect(completed).toBe(false);
    });
  });

  describe('programmatic authentication (with username and password)', () => {
    it('should include username and password in FtpPromptData', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50', 'admin', 'secret');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(1500);

      expect(isFtpPrompt(followUp)).toBe(true);
      if (isFtpPrompt(followUp)) {
        expect(followUp.targetIP).toBe('192.168.1.50');
        expect((followUp as FtpPromptData & { readonly username?: string }).username).toBe('admin');
        expect((followUp as FtpPromptData & { readonly password?: string }).password).toBe(
          'secret',
        );
      }
    });

    it('should not include credentials when no username/password given', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('192.168.1.50');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(1500);

      expect(isFtpPrompt(followUp)).toBe(true);
      if (isFtpPrompt(followUp)) {
        expect(
          (followUp as FtpPromptData & { readonly username?: string }).username,
        ).toBeUndefined();
        expect(
          (followUp as FtpPromptData & { readonly password?: string }).password,
        ).toBeUndefined();
      }
    });

    it('should work with hostname resolution and credentials', () => {
      const context = createMockFtpContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
          }),
        ],
        dnsRecords: [getMockDnsRecord({ domain: 'fileserver.local', ip: '192.168.1.50' })],
      });
      const ftp = createFtpCommand(context);
      const result = ftp.fn('fileserver.local', 'admin', 'secret');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(1500);

      expect(isFtpPrompt(followUp)).toBe(true);
      if (isFtpPrompt(followUp)) {
        expect(followUp.targetIP).toBe('192.168.1.50');
        expect((followUp as FtpPromptData & { readonly username?: string }).username).toBe('admin');
      }
    });
  });

  describe('cross-LAN async pre-resolve', () => {
    // Mirrors ssh.ts's findMachineByIpAsync fallback. When the player
    // types `ftp <foreign public IP>` and the sync getMachine doesn't
    // know the target (its HomeNetwork hasn't been seeded yet), the
    // command awaits findMachineByIpAsync to materialize the foreign
    // network via the cross-LAN seed-regen resolver, then proceeds
    // with the normal connect animation. Sync hits short-circuit the
    // async path so existing legacy callers + tests are unaffected.

    it('falls back to findMachineByIpAsync when sync getMachine misses', async () => {
      const foreignMachine = getMockRemoteMachine({
        ip: '203.0.113.42',
        hostname: 'foreign-router',
        ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
      });
      const findMachineByIpAsync = vi.fn(async (ip: string) =>
        ip === '203.0.113.42' ? foreignMachine : undefined,
      );
      const context = {
        getMachine: vi.fn(() => undefined),
        getLocalIP: () => '192.168.1.100',
        resolveDomain: vi.fn(() => undefined),
        findMachineByIpAsync,
      };
      const ftp = createFtpCommand(context);

      const result = ftp.fn('203.0.113.42');
      expect(isAsyncOutput(result)).toBe(true);

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      // Drain the async resolver's microtask + ftp's scheduled delays.
      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.42');
      expect(isFtpPrompt(followUp)).toBe(true);
      if (isFtpPrompt(followUp)) {
        expect(followUp.targetIP).toBe('203.0.113.42');
      }
    });

    it('emits Connection refused via onLine when async resolver also returns undefined', async () => {
      // The "no machine anywhere" case shifts from sync throw to async
      // onLine emission once the resolver is wired. Same end-user UX
      // (the error appears in the terminal) but the throw can't be
      // sync because the resolver round-trip is async.
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const context = {
        getMachine: vi.fn(() => undefined),
        getLocalIP: () => '192.168.1.100',
        resolveDomain: vi.fn(() => undefined),
        findMachineByIpAsync,
      };
      const ftp = createFtpCommand(context);

      const result = ftp.fn('203.0.113.99');
      expect(isAsyncOutput(result)).toBe(true);

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }

      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.99');
      expect(
        lines.some((l) => l.includes('Connection refused') && l.includes('203.0.113.99')),
      ).toBe(true);
      expect(completed).toBe(true);
    });

    it('does NOT call findMachineByIpAsync when sync getMachine hits', () => {
      // Precedence: sync hits short-circuit. Avoids a needless server
      // round-trip for own-LAN / mission / world targets the client
      // already knows about.
      const localMachine = getMockRemoteMachine({
        ip: '192.168.1.50',
        ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
      });
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const context = {
        getMachine: vi.fn(() => localMachine),
        getLocalIP: () => '192.168.1.100',
        resolveDomain: vi.fn(() => undefined),
        findMachineByIpAsync,
      };
      const ftp = createFtpCommand(context);

      ftp.fn('192.168.1.50');

      expect(findMachineByIpAsync).not.toHaveBeenCalled();
    });

    it('throws synchronously on sync miss when findMachineByIpAsync is omitted (legacy)', () => {
      // Backward-compatible: a context that doesn't supply the async
      // resolver keeps the pre-extension throw contract.
      const context = createMockFtpContext({ machines: [] });
      const ftp = createFtpCommand(context);

      expect(() => ftp.fn('10.0.0.1')).toThrow(
        'ftp: connect to 10.0.0.1 port 21: Connection refused',
      );
    });

    it('emits Connection refused via onLine when foreign machine has no open FTP port', async () => {
      // Machine known + present but FTP port absent — sync throw becomes
      // async onLine emission. Same shape as the connection-refused branch.
      const foreignMachine = getMockRemoteMachine({
        ip: '203.0.113.42',
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
      });
      const findMachineByIpAsync = vi.fn(async () => foreignMachine);
      const context = {
        getMachine: vi.fn(() => undefined),
        getLocalIP: () => '192.168.1.100',
        resolveDomain: vi.fn(() => undefined),
        findMachineByIpAsync,
      };
      const ftp = createFtpCommand(context);

      const result = ftp.fn('203.0.113.42');
      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }

      await vi.runAllTimersAsync();

      expect(
        lines.some((l) => l.includes('Connection refused') && l.includes('203.0.113.42')),
      ).toBe(true);
      expect(completed).toBe(true);
    });
  });
});
