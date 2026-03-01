import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput, NcPromptData } from '../components/Terminal/types';
import { createNcCommand } from './nc';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 21, service: 'ftp', open: true }],
  users: [{ username: 'ftpuser', passwordHash: 'abc123', userType: 'user' }],
  ...overrides,
});

type NcContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
};

const createMockNcContext = (config: NcContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100', dnsRecords = [] } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
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

describe('nc command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument validation', () => {
    it('should throw error when no host given', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn()).toThrow('nc: missing host');
    });

    it('should throw error when no port given', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50')).toThrow('nc: missing or invalid port');
    });

    it('should throw error when port is not a number', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 'abc')).toThrow('nc: missing or invalid port');
    });

    it('should throw error when port is below 1', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 0)).toThrow('nc: port must be between 1 and 65535');
    });

    it('should throw error when port is above 65535', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 65536)).toThrow('nc: port must be between 1 and 65535');
    });
  });

  describe('hostname resolution', () => {
    it('should resolve hostname to IP', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine({ ip: '203.0.113.42' })],
        dnsRecords: [{ domain: 'darknet.ctf', ip: '203.0.113.42', type: 'A' }],
      });
      const nc = createNcCommand(context);

      const result = nc.fn('darknet.ctf', 21);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should throw error when hostname cannot be resolved', () => {
      const context = createMockNcContext({
        dnsRecords: [],
      });
      const nc = createNcCommand(context);

      expect(() => nc.fn('unknown.host', 80)).toThrow(
        'nc: unknown.host: Name or service not known',
      );
    });
  });

  describe('connection validation', () => {
    it('should throw error when connecting to localhost IP', () => {
      const context = createMockNcContext({ localIP: '192.168.1.100' });
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.100', 80)).toThrow(
        'nc: connect to localhost: Connection refused',
      );
    });

    it('should throw error when connecting to 127.0.0.1', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(() => nc.fn('127.0.0.1', 80)).toThrow('nc: connect to localhost: Connection refused');
    });

    it('should throw error when connecting to localhost hostname', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      // localhost hostname fails DNS resolution before reaching localhost check
      expect(() => nc.fn('localhost', 80)).toThrow('nc: localhost: Name or service not known');
    });

    it('should throw error when machine does not exist', () => {
      const context = createMockNcContext({ machines: [] });
      const nc = createNcCommand(context);

      expect(() => nc.fn('10.0.0.1', 80)).toThrow(
        'nc: connect to 10.0.0.1 port 80: Connection timed out',
      );
    });

    it('should throw error when port is not open', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', open: false }],
          }),
        ],
      });
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 21)).toThrow(
        'nc: connect to 192.168.1.50 port 21: Connection refused',
      );
    });

    it('should throw error when port does not exist', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 21, service: 'ftp', open: true }],
          }),
        ],
      });
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 8080)).toThrow(
        'nc: connect to 192.168.1.50 port 8080: Connection refused',
      );
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);

      const result = nc.fn('192.168.1.50', 21);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);

      const result = nc.fn('192.168.1.50', 21);

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);

      const result = nc.fn('192.168.1.50', 21);

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('connection execution', () => {
    it('should output connecting message immediately', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 21);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Connecting to 192.168.1.50:21...');
    });

    it('should output connected message after first delay', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 21);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward first delay (NC_CONNECT_DELAY_MS = 400)
      vi.advanceTimersByTime(400);

      expect(lines).toContain('Connected to 192.168.1.50.');
    });

    it('should show FTP banner for FTP service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 21, service: 'ftp', open: true }],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 21);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward both delays (400 + 300 = 700ms)
      vi.advanceTimersByTime(700);

      expect(lines).toContain('220 FTP server ready.');
      expect(lines).toContain('Connection closed.');
    });

    it('should show SSH banner for SSH service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 22);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(700);

      expect(lines.some((l) => l.includes('SSH-2.0-OpenSSH'))).toBe(true);
    });

    it('should show HTTP banner for HTTP service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 80, service: 'http', open: true }],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 80);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(700);

      expect(lines.some((l) => l.includes('HTTP/1.1 400 Bad Request'))).toBe(true);
    });

    it('should show default banner for unknown service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 9999, service: 'custom', open: true }],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 9999);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(700);

      expect(lines).toContain('Connected to custom service');
    });
  });

  describe('interactive mode (backdoor)', () => {
    it('should return NcPromptData for interactive port', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ip: '203.0.113.42',
            ports: [
              {
                port: 31337,
                service: 'elite',
                open: true,
                owner: { username: 'ghost', userType: 'user', homePath: '/home/ghost' },
              },
            ],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('203.0.113.42', 31337);

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(700);

      expect(isNcPrompt(followUp)).toBe(true);
      if (isNcPrompt(followUp)) {
        expect(followUp.targetIP).toBe('203.0.113.42');
        expect(followUp.targetPort).toBe(31337);
        expect(followUp.service).toBe('elite');
        expect(followUp.username).toBe('ghost');
        expect(followUp.userType).toBe('user');
        expect(followUp.homePath).toBe('/home/ghost');
      }
    });

    it('should show port banner for interactive service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ip: '203.0.113.42',
            ports: [
              {
                port: 31337,
                service: 'elite',
                open: true,
                owner: { username: 'ghost', userType: 'user', homePath: '/home/ghost' },
              },
            ],
          }),
        ],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('203.0.113.42', 31337);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(700);

      expect(lines).toContain('# 31337 #');
    });
  });

  describe('cancellation', () => {
    it('should not output after cancellation', () => {
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
      });
      const nc = createNcCommand(context);
      const result = nc.fn('192.168.1.50', 21);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );

        // Cancel before first delay completes
        result.cancel?.();
        vi.advanceTimersByTime(700);
      }

      // Should only have the initial "Connecting" message
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Connecting to 192.168.1.50:21...');
    });
  });

  describe('command metadata', () => {
    it('should have correct name', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(nc.name).toBe('nc');
    });

    it('should have description', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(nc.description).toBe('Netcat — arbitrary TCP connections');
    });

    it('should have manual', () => {
      const context = createMockNcContext();
      const nc = createNcCommand(context);

      expect(nc.manual).toBeDefined();
      expect(nc.manual?.synopsis).toContain('nc');
    });
  });
});
