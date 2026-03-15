import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput, NcPromptData } from '../components/Terminal/types';
import { createMsfconsoleCommand } from './msfconsole';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '10.50.100.10',
  hostname: 'web01',
  ports: [
    { port: 22, service: 'ssh', open: true },
    {
      port: 80,
      service: 'http',
      open: true,
      vulnerability: {
        cve: 'CVE-2021-41773',
        description: 'Apache 2.4.49 path traversal / RCE',
        serviceVersion: 'Apache/2.4.49',
      },
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
};

const createMockMsfconsoleContext = (config: MsfconsoleContextConfig = {}) => {
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
            ports: [{ port: 80, service: 'http', open: false }],
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
                open: true,
                vulnerability: {
                  cve: 'CVE-2021-41773',
                  description: 'test',
                  serviceVersion: 'Apache/2.4.49',
                },
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
});
