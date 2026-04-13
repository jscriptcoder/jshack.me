import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput, NcPromptData } from '../components/Terminal/types';
import { createNcCommand, startNcListener, createNcPidContent, type NcListenAdapter } from './nc';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
  users: [{ username: 'ftpuser', passwordHash: 'abc123', userType: 'user' }],
  ...overrides,
});

type NcContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
  readonly onNcConnect?: (info: {
    readonly targetIp: string;
    readonly port: number;
    readonly service?: string;
    readonly success: boolean;
  }) => void;
};

const createMockNcContext = (config: NcContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100', dnsRecords = [], onNcConnect } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    getListenAdapter: () => ({
      isPortOpen: () => false,
      pidFileExists: () => false,
      writePidFile: vi.fn(),
      username: 'user',
      userType: 'user' as const,
    }),
    onNcConnect,
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
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: false }],
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
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
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

      // Advance past max jitter range (NC_CONNECT_DELAY_MS = 400)
      vi.advanceTimersByTime(600);

      expect(lines).toContain('Connected to 192.168.1.50.');
    });

    it('should show FTP banner for FTP service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
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

      // Fast-forward both delays (400 + 300 = 700ms, ×1.5 for jitter)
      vi.advanceTimersByTime(1050);

      expect(lines).toContain('220 FTP server ready.');
      expect(lines).toContain('Connection closed.');
    });

    it('should show SSH banner for SSH service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
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

      vi.advanceTimersByTime(1050);

      expect(lines.some((l) => l.includes('SSH-2.0-OpenSSH'))).toBe(true);
    });

    it('should show HTTP banner for HTTP service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
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

      vi.advanceTimersByTime(1050);

      expect(lines.some((l) => l.includes('HTTP/1.1 400 Bad Request'))).toBe(true);
    });

    it('should show default banner for unknown service', () => {
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 9999, service: 'custom', serviceVersion: 'latest', open: true }],
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

      vi.advanceTimersByTime(1050);

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
                serviceVersion: 'latest',
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

      vi.advanceTimersByTime(1050);

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
                serviceVersion: 'latest',
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

      vi.advanceTimersByTime(1050);

      expect(lines).toContain('# 31337 #');
    });
  });

  describe('onNcConnect callback', () => {
    it('calls onNcConnect with success=true on successful connection', () => {
      const onNcConnect = vi.fn();
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
        onNcConnect,
      });
      const nc = createNcCommand(context);
      nc.fn('192.168.1.50', 21);

      expect(onNcConnect).toHaveBeenCalledTimes(1);
      expect(onNcConnect).toHaveBeenCalledWith({
        targetIp: '192.168.1.50',
        port: 21,
        service: 'ftp',
        success: true,
      });
    });

    it('calls onNcConnect with success=false when port is closed', () => {
      const onNcConnect = vi.fn();
      const context = createMockNcContext({
        machines: [
          getMockRemoteMachine({
            ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: false }],
          }),
        ],
        onNcConnect,
      });
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 21)).toThrow('Connection refused');
      expect(onNcConnect).toHaveBeenCalledTimes(1);
      expect(onNcConnect).toHaveBeenCalledWith({
        targetIp: '192.168.1.50',
        port: 21,
        service: 'ftp',
        success: false,
      });
    });

    it('calls onNcConnect with success=false when port does not exist', () => {
      const onNcConnect = vi.fn();
      const context = createMockNcContext({
        machines: [getMockRemoteMachine()],
        onNcConnect,
      });
      const nc = createNcCommand(context);

      expect(() => nc.fn('192.168.1.50', 9999)).toThrow('Connection refused');
      expect(onNcConnect).toHaveBeenCalledTimes(1);
      expect(onNcConnect).toHaveBeenCalledWith({
        targetIp: '192.168.1.50',
        port: 9999,
        success: false,
      });
    });

    it('does NOT call onNcConnect on argument validation errors', () => {
      const onNcConnect = vi.fn();
      const context = createMockNcContext({ onNcConnect });
      const nc = createNcCommand(context);

      expect(() => nc.fn()).toThrow('missing host');
      expect(() => nc.fn('192.168.1.50')).toThrow('missing or invalid port');
      expect(onNcConnect).not.toHaveBeenCalled();
    });

    it('does NOT call onNcConnect when the target machine does not exist', () => {
      const onNcConnect = vi.fn();
      const context = createMockNcContext({ machines: [], onNcConnect });
      const nc = createNcCommand(context);

      expect(() => nc.fn('10.99.99.99', 21)).toThrow('Connection timed out');
      expect(onNcConnect).not.toHaveBeenCalled();
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
        vi.advanceTimersByTime(1050);
      }

      // Should only have the initial "Connecting" message
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Connecting to 192.168.1.50:21...');
    });
  });
});

// --- Listen mode (nc -l) ---

const createListenAdapter = (overrides: Partial<NcListenAdapter> = {}): NcListenAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  pidFileExists: overrides.pidFileExists ?? (() => false),
  writePidFile: overrides.writePidFile ?? vi.fn(),
  username: overrides.username ?? 'webadmin',
  userType: overrides.userType ?? 'user',
});

describe('startNcListener', () => {
  it('starts listener on valid high port for non-root user', () => {
    const writePidFile = vi.fn();
    const adapter = createListenAdapter({ writePidFile });

    const result = startNcListener(adapter, ['-l', 4444]);

    expect(result).toContain('Listening on 0.0.0.0 4444');
    expect(writePidFile).toHaveBeenCalledWith(
      4444,
      'nc:port=4444,user=webadmin,userType=user,home=/home/webadmin',
    );
  });

  it('accepts -l flag after port number', () => {
    const writePidFile = vi.fn();
    const adapter = createListenAdapter({ writePidFile });

    const result = startNcListener(adapter, [4444, '-l']);

    expect(result).toContain('Listening on 0.0.0.0 4444');
    expect(writePidFile).toHaveBeenCalledWith(
      4444,
      'nc:port=4444,user=webadmin,userType=user,home=/home/webadmin',
    );
  });

  it('starts listener on privileged port for root', () => {
    const writePidFile = vi.fn();
    const adapter = createListenAdapter({ writePidFile, username: 'root', userType: 'root' });

    const result = startNcListener(adapter, ['-l', 443]);

    expect(result).toContain('Listening on 0.0.0.0 443');
    expect(writePidFile).toHaveBeenCalledWith(
      443,
      'nc:port=443,user=root,userType=root,home=/root',
    );
  });

  it('rejects privileged port for non-root user', () => {
    const adapter = createListenAdapter({ userType: 'user' });

    expect(() => startNcListener(adapter, ['-l', 80])).toThrow('permission denied');
  });

  it('rejects privileged port for guest user', () => {
    const adapter = createListenAdapter({ username: 'ftpuser', userType: 'guest' });

    expect(() => startNcListener(adapter, ['-l', 443])).toThrow('permission denied');
  });

  it('allows high port for guest user', () => {
    const writePidFile = vi.fn();
    const adapter = createListenAdapter({
      writePidFile,
      username: 'ftpuser',
      userType: 'guest',
    });

    const result = startNcListener(adapter, ['-l', 8888]);

    expect(result).toContain('Listening on 0.0.0.0 8888');
    expect(writePidFile).toHaveBeenCalled();
  });

  it('rejects port already open on machine', () => {
    const adapter = createListenAdapter({ isPortOpen: (port) => port === 4444 });

    expect(() => startNcListener(adapter, ['-l', 4444])).toThrow('already in use');
  });

  it('rejects port with existing pid file', () => {
    const adapter = createListenAdapter({ pidFileExists: (port) => port === 4444 });

    expect(() => startNcListener(adapter, ['-l', 4444])).toThrow('already listening');
  });

  it('rejects missing -l flag', () => {
    const adapter = createListenAdapter();

    expect(() => startNcListener(adapter, [4444])).toThrow('usage');
  });

  it('rejects missing port argument', () => {
    const adapter = createListenAdapter();

    expect(() => startNcListener(adapter, ['-l'])).toThrow('usage');
  });

  it('rejects non-numeric port', () => {
    const adapter = createListenAdapter();

    expect(() => startNcListener(adapter, ['-l', 'abc'])).toThrow('invalid port');
  });

  it('rejects port out of range', () => {
    const adapter = createListenAdapter({ userType: 'root' });

    expect(() => startNcListener(adapter, ['-l', 0])).toThrow('invalid port');
    expect(() => startNcListener(adapter, ['-l', 70000])).toThrow('invalid port');
  });
});

describe('createNcPidContent', () => {
  it('creates pid content with nc: prefix for regular user', () => {
    expect(createNcPidContent(4444, 'webadmin', 'user')).toBe(
      'nc:port=4444,user=webadmin,userType=user,home=/home/webadmin',
    );
  });

  it('creates pid content with /root home for root user', () => {
    expect(createNcPidContent(443, 'root', 'root')).toBe(
      'nc:port=443,user=root,userType=root,home=/root',
    );
  });
});
