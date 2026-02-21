import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createNmapCommand } from './nmap';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [{ username: 'root', passwordHash: 'abc123', userType: 'root' }],
  ...overrides,
});

type NmapContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
};

const createMockNmapContext = (config: NmapContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100' } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getMachines: () => machines,
    getLocalIP: () => localIP,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

// --- Tests ---

describe('nmap command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no target given', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      expect(() => nmap.fn()).toThrow('nmap: missing target specification');
    });

    it('should throw error for invalid IP', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      expect(() => nmap.fn('not-an-ip')).toThrow('nmap: invalid target: not-an-ip');
    });

    it('should throw error for unknown IP outside subnet when start is called', () => {
      const context = createMockNmapContext({ machines: [] });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('10.0.0.1');

      if (isAsyncOutput(result)) {
        expect(() =>
          result.start(
            () => {},
            () => {},
          ),
        ).toThrow('nmap: failed to resolve "10.0.0.1"');
      }
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput for single IP', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      const result = nmap.fn('192.168.1.50');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should return AsyncOutput for IP range', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      const result = nmap.fn('192.168.1.1-5');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start and cancel functions', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      const result = nmap.fn('192.168.1.1');

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('range scan', () => {
    it('should show header with target and total IPs', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-10');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Starting Nmap scan on 192.168.1.1-10');
      expect(lines[1]).toBe('Scanning 10 hosts...');
    });

    it('should discover localhost in range', () => {
      const context = createMockNmapContext({ localIP: '192.168.1.100' });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.99-101');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward through all scans (3 IPs * 150ms)
      vi.advanceTimersByTime(500);

      expect(lines.some((l) => l.includes('192.168.1.100 (localhost)'))).toBe(true);
    });

    it('should discover known machines in range', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.49-51');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(500);

      expect(lines.some((l) => l.includes('192.168.1.50 (fileserver)'))).toBe(true);
    });

    it('should show summary after scan completes', () => {
      const context = createMockNmapContext({
        localIP: '192.168.1.100',
        machines: [getMockRemoteMachine({ ip: '192.168.1.1', hostname: 'gateway' })],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-3');

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

      // Fast-forward through scans + summary delay
      vi.advanceTimersByTime(1000);

      expect(lines.some((l) => l.includes('Scan complete. Summary:'))).toBe(true);
      expect(lines.some((l) => l.includes('3 IP addresses scanned, 1 hosts up'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('should show no hosts found when range is empty', () => {
      const context = createMockNmapContext({ machines: [] });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.200-202');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(1000);

      expect(lines.some((l) => l.includes('No hosts found in range.'))).toBe(true);
    });

    it('should cancel range scan', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({ ip: '192.168.1.1', hostname: 'host1' }),
          getMockRemoteMachine({ ip: '192.168.1.5', hostname: 'host5' }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-10');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );

        // Cancel after first host
        vi.advanceTimersByTime(200);
        result.cancel?.();
        vi.advanceTimersByTime(2000);
      }

      // Should not have summary
      expect(lines.some((l) => l.includes('Scan complete'))).toBe(false);
    });
  });

  describe('-sV version detection', () => {
    it('should parse -sV as first arg and use second arg as target', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);

      const result = nmap.fn('-sV', '192.168.1.50');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should parse -sV as second arg and use first arg as target', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 80,
                service: 'http',
                open: true,
                vulnerability: {
                  cve: 'CVE-2021-41773',
                  description: 'Apache path traversal',
                  serviceVersion: 'Apache/2.4.49',
                },
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50', '-sV');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('VERSION'))).toBe(true);
      expect(lines.some((l) => l.includes('Apache/2.4.49'))).toBe(true);
      expect(lines.some((l) => l.includes('VULNERABILITIES:'))).toBe(true);
    });

    it('should show VERSION column header when -sV is used', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sV', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('VERSION'))).toBe(true);
    });

    it('should show vulnerability service version in port line', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 80,
                service: 'http',
                open: true,
                vulnerability: {
                  cve: 'CVE-2021-41773',
                  description: 'Apache path traversal',
                  serviceVersion: 'Apache/2.4.49',
                },
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sV', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('Apache/2.4.49'))).toBe(true);
    });

    it('should show VULNERABILITIES section for ports with vulnerabilities', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 80,
                service: 'http',
                open: true,
                vulnerability: {
                  cve: 'CVE-2021-41773',
                  description: 'Apache 2.4.49 path traversal / RCE',
                  serviceVersion: 'Apache/2.4.49',
                },
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sV', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('VULNERABILITIES:'))).toBe(true);
      expect(lines.some((l) => l.includes('CVE-2021-41773'))).toBe(true);
      expect(lines.some((l) => l.includes('CRITICAL'))).toBe(true);
    });

    it('should not show VULNERABILITIES section for ports without vulnerabilities', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sV', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('VULNERABILITIES:'))).toBe(false);
    });

    it('should not show VERSION column without -sV flag', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
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
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l === 'PORT      STATE  SERVICE')).toBe(true);
      expect(lines.some((l) => l.includes('VERSION'))).toBe(false);
      expect(lines.some((l) => l.includes('VULNERABILITIES:'))).toBe(false);
    });
  });

  describe('single IP port scan', () => {
    it('should show localhost ports as closed', () => {
      const context = createMockNmapContext({ localIP: '192.168.1.100' });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.100');

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

      vi.advanceTimersByTime(600);

      expect(lines.some((l) => l.includes('All scanned ports are closed'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('should show host down for unknown IP in subnet', () => {
      const context = createMockNmapContext({ machines: [] });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.99');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(1000);

      expect(lines.some((l) => l.includes('Host seems down'))).toBe(true);
    });

    it('should show port table for known machine', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'fileserver',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 80, service: 'http', open: true },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward through header and port scans
      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('fileserver (192.168.1.50)'))).toBe(true);
      expect(lines.some((l) => l.includes('PORT      STATE  SERVICE'))).toBe(true);
      expect(
        lines.some((l) => l.includes('22/tcp') && l.includes('open') && l.includes('ssh')),
      ).toBe(true);
      expect(
        lines.some((l) => l.includes('80/tcp') && l.includes('open') && l.includes('http')),
      ).toBe(true);
    });

    it('should only show open ports', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 23, service: 'telnet', open: false },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('22/tcp'))).toBe(true);
      expect(lines.some((l) => l.includes('23/tcp'))).toBe(false);
    });

    it('should show all ports closed when no open ports', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [{ port: 22, service: 'ssh', open: false }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(1000);

      expect(lines.some((l) => l.includes('All scanned ports are closed'))).toBe(true);
    });

    it('should cancel port scan', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 80, service: 'http', open: true },
              { port: 443, service: 'https', open: true },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50');

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );

        // Cancel before all ports scanned
        vi.advanceTimersByTime(600);
        result.cancel?.();
        vi.advanceTimersByTime(2000);
      }

      expect(completed).toBe(false);
    });
  });
});
