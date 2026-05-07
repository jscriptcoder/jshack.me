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
});
