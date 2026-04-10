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
  readonly localHostname?: string;
};

const createMockNmapContext = (config: NmapContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100', localHostname = 'localhost' } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    findMachineByIp: (ip: string) => machines.find((m) => m.ip === ip),
    getMachines: () => machines,
    getLocalIPs: () => new Set([localIP, '127.0.0.1']),
    getLocalHostname: () => localHostname,
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

    it('should use workstation name for local machine in range', () => {
      const context = createMockNmapContext({
        localIP: '192.168.1.100',
        localHostname: 'myworkstation',
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.99-101');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(500);

      expect(lines.some((l) => l.includes('192.168.1.100 (myworkstation)'))).toBe(true);
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
                serviceVersion: 'Apache/2.4.49',
                open: true,
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

    it('should show service version in port line', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
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
                serviceVersion: 'Apache/2.4.49',
                open: true,
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

    it('should not render "undefined" in the version column when a port has no serviceVersion', () => {
      // Regression guard: prior to the dynamic lookup refactor, removing the
      // nullish coalescing could surface the literal string "undefined" in the
      // -sV version column for safe ports. Players shouldn't see that.
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

      expect(lines.some((l) => l.includes('undefined'))).toBe(false);
    });

    it('should show the service version for an open port even when no CVE matches', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 22,
                service: 'ssh',
                serviceVersion: 'OpenSSH 9.6',
                open: true,
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

      expect(lines.some((l) => l.includes('OpenSSH 9.6'))).toBe(true);
      expect(lines.some((l) => l.includes('VULNERABILITIES:'))).toBe(false);
    });

    it('should include serviceVersion in range-scan summary line with -sV', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'server',
            ports: [
              {
                port: 22,
                service: 'ssh',
                serviceVersion: 'OpenSSH 9.6',
                open: true,
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sV', '192.168.1.50-51');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('ssh OpenSSH 9.6'))).toBe(true);
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
                serviceVersion: 'Apache/2.4.49',
                open: true,
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

  describe('-sU UDP scan', () => {
    it('should show only UDP ports when -sU flag is used', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 80, service: 'http', open: true },
              { port: 161, service: 'snmp', open: true, protocol: 'udp' },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sU', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('161/udp'))).toBe(true);
      expect(lines.some((l) => l.includes('22/tcp'))).toBe(false);
      expect(lines.some((l) => l.includes('80/tcp'))).toBe(false);
      expect(lines.some((l) => l.includes('UDP scan'))).toBe(true);
    });

    it('should parse -sU as second arg', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 161, service: 'snmp', open: true, protocol: 'udp' },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.50', '-sU');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('161/udp'))).toBe(true);
      expect(lines.some((l) => l.includes('22/tcp'))).toBe(false);
    });

    it('should hide UDP ports from default TCP scan', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 161, service: 'snmp', open: true, protocol: 'udp' },
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
      expect(lines.some((l) => l.includes('161/udp'))).toBe(false);
    });

    it('should support combined -sU and -sV flags', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 161, service: 'snmp', open: true, protocol: 'udp' },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('-sU', '-sV', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('161/udp'))).toBe(true);
      expect(lines.some((l) => l.includes('VERSION'))).toBe(true);
      expect(lines.some((l) => l.includes('22/tcp'))).toBe(false);
    });

    it('should show "no open UDP ports" when machine has no UDP ports', () => {
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
      const result = nmap.fn('-sU', '192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('All scanned ports are closed'))).toBe(true);
    });
  });

  describe('single IP port scan', () => {
    it('should use workstation name for local machine scan', () => {
      const context = createMockNmapContext({
        localIP: '192.168.1.100',
        localHostname: 'myworkstation',
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.100');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(650);

      expect(lines.some((l) => l.includes('myworkstation (192.168.1.100)'))).toBe(true);
    });

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

      // jitter(500) can produce up to 625ms (500 * 1.25)
      vi.advanceTimersByTime(650);

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

    it('should show both open and closed ports', () => {
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

      expect(lines.some((l) => l.includes('22/tcp') && l.includes('open'))).toBe(true);
      expect(lines.some((l) => l.includes('23/tcp') && l.includes('closed'))).toBe(true);
    });

    it('should show closed ports in table when no open ports', () => {
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

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('22/tcp') && l.includes('closed'))).toBe(true);
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

  describe('--tree topology view', () => {
    it('should throw when --tree is used with single IP', () => {
      const context = createMockNmapContext({
        machines: [getMockRemoteMachine()],
      });
      const nmap = createNmapCommand(context);

      expect(() => nmap.fn('192.168.1.50', '--tree')).toThrow(
        'nmap: --tree requires an IP range target',
      );
    });

    it('should still throw missing target when only --tree is passed', () => {
      const context = createMockNmapContext();
      const nmap = createNmapCommand(context);

      expect(() => nmap.fn('--tree')).toThrow('nmap: missing target specification');
    });

    it('should show router as root when gateway is in range', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 80, service: 'http', open: true },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-20', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      // Router is root (no connector prefix)
      expect(lines.some((l) => l === 'router (192.168.1.1) [:22]')).toBe(true);
      // Single child uses └──
      expect(lines.some((l) => l === '\u2514\u2500\u2500 webserver (192.168.1.10) [:22 :80]')).toBe(
        true,
      );
    });

    it('should use correct connectors for multiple children', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [{ port: 80, service: 'http', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.20',
            hostname: 'dbserver',
            ports: [{ port: 3306, service: 'mysql', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-30', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(10000);

      // Non-last child uses ├──
      expect(lines.some((l) => l === '\u251C\u2500\u2500 webserver (192.168.1.10) [:80]')).toBe(
        true,
      );
      // Last child uses └──
      expect(lines.some((l) => l === '\u2514\u2500\u2500 dbserver (192.168.1.20) [:3306]')).toBe(
        true,
      );
    });

    it('should show flat list when no router in scan range', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [{ port: 80, service: 'http', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.20',
            hostname: 'dbserver',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.10-25', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l === 'webserver (192.168.1.10) [:80]')).toBe(true);
      expect(lines.some((l) => l === 'dbserver (192.168.1.20) [:22]')).toBe(true);
      // No tree connectors
      expect(
        lines.some((l) => l.includes('\u251C\u2500\u2500') || l.includes('\u2514\u2500\u2500')),
      ).toBe(false);
    });

    it('should use workstation name in tree', () => {
      const context = createMockNmapContext({
        localIP: '192.168.1.5',
        localHostname: 'hackerbox',
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-10', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('hackerbox (192.168.1.5)') && !l.includes('['))).toBe(
        true,
      );
    });

    it('should show localhost without ports in tree', () => {
      const context = createMockNmapContext({
        localIP: '192.168.1.5',
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-10', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      // Localhost has no port brackets
      expect(lines.some((l) => l.includes('localhost (192.168.1.5)') && !l.includes('['))).toBe(
        true,
      );
    });

    it('should show CVEs with -sV and --tree', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-20', '--tree', '-sV');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      expect(
        lines.some(
          (l) => l.includes('\u26A0') && l.includes('CVE-2021-41773') && l.includes('http:80'),
        ),
      ).toBe(true);
    });

    it('should not show CVEs without -sV', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-20', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('CVE'))).toBe(false);
    });

    it('should filter ports by protocol with --tree and -sU', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 161, service: 'snmp', open: true, protocol: 'udp' },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-5', '--tree', '-sU');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      const routerLine = lines.find((l) => l.includes('router (192.168.1.1)'));
      expect(routerLine).toContain(':161');
      expect(routerLine).not.toContain(':22');
    });

    it('should show no hosts message with --tree when range is empty', () => {
      const context = createMockNmapContext({ machines: [] });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.200-202', '--tree');

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

    it('should still show Nmap done footer with --tree', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-5', '--tree');

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

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l.includes('Nmap done:'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('should show only gateway when no other hosts found', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 80, service: 'http', open: true },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-5', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l === 'router (192.168.1.1) [:22 :80]')).toBe(true);
      // No tree connectors since no children
      expect(
        lines.some((l) => l.includes('\u251C\u2500\u2500') || l.includes('\u2514\u2500\u2500')),
      ).toBe(false);
    });

    it('should show CVE with correct indentation under non-last child', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
              },
            ],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.20',
            hostname: 'dbserver',
            ports: [{ port: 3306, service: 'mysql', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-25', '--tree', '-sV');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(10000);

      // CVE under non-last child should use │   └── prefix
      expect(
        lines.some(
          (l) => l.startsWith('\u2502   \u2514\u2500\u2500') && l.includes('CVE-2021-41773'),
        ),
      ).toBe(true);
    });

    it('should show CVE with correct indentation under last child', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'webserver',
            ports: [
              {
                port: 80,
                service: 'http',
                serviceVersion: 'Apache/2.4.49',
                open: true,
              },
            ],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.1-15', '--tree', '-sV');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(5000);

      // CVE under last child should use spaces + └── prefix
      expect(
        lines.some((l) => l.startsWith('    \u2514\u2500\u2500') && l.includes('CVE-2021-41773')),
      ).toBe(true);
    });

    it('should parse --tree in any argument position', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.1',
            hostname: 'router',
            ports: [{ port: 22, service: 'ssh', open: true }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('--tree', '192.168.1.1-5');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      expect(lines.some((l) => l === 'router (192.168.1.1) [:22]')).toBe(true);
    });

    it('should omit port brackets for machine with no open ports', () => {
      const context = createMockNmapContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.10',
            hostname: 'closedserver',
            ports: [{ port: 22, service: 'ssh', open: false }],
          }),
        ],
      });
      const nmap = createNmapCommand(context);
      const result = nmap.fn('192.168.1.10-15', '--tree');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(2000);

      // Tree output line (not the "Host discovered:" line)
      expect(lines.some((l) => l === 'closedserver (192.168.1.10)')).toBe(true);
    });
  });
});
