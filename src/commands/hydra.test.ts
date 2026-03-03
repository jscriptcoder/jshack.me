import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createHydraCommand } from './hydra';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
  ],
  users: [
    { username: 'root', passwordHash: 'ca8f678fec022c9892f0ffee16eb0aa3', userType: 'root' },
    { username: 'ftpuser', passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99', userType: 'user' },
    { username: 'guest', passwordHash: '084e0343a0486ff05530df6c705c8bb4', userType: 'guest' },
  ],
  ...overrides,
});

type HydraContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
};

const createMockContext = (config: HydraContextConfig = {}) => {
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

const collectAsyncLines = (output: AsyncOutput): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    output.start(
      (line) => lines.push(line),
      () => resolve(lines),
    );
    vi.runAllTimers();
  });

// --- Tests ---

describe('hydra command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command metadata', () => {
    it('should have correct name and description', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(hydra.name).toBe('hydra');
      expect(hydra.description).toBe('Network login brute-force tool');
    });

    it('should have a manual page', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(hydra.manual).toBeDefined();
      expect(hydra.manual?.synopsis).toContain('hydra');
      expect(hydra.manual?.arguments?.length).toBeGreaterThan(0);
      expect(hydra.manual?.examples?.length).toBeGreaterThan(0);
    });
  });

  describe('argument validation', () => {
    it('should throw when no host given', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn()).toThrow('hydra: missing host');
    });

    it('should throw for invalid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'telnet')).toThrow(
        'hydra: unsupported service "telnet"',
      );
    });

    it('should accept "ssh" as valid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Should not throw for service validation — will proceed to async output
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should accept "ftp" as valid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ftp');
      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('host resolution', () => {
    it('should resolve IP addresses directly', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should resolve domain names via DNS', () => {
      const machine = getMockRemoteMachine();
      const dnsRecords: readonly DnsRecord[] = [
        { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
      ];
      const hydra = createHydraCommand(createMockContext({ machines: [machine], dnsRecords }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('fileserver.local');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should throw for unresolvable domain', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('unknown.host')).toThrow(
        'hydra: unknown.host: Name or service not known',
      );
    });

    it('should reject localhost by IP', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('192.168.1.100')).toThrow('hydra: cannot attack localhost');
    });

    it('should reject localhost by name', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('localhost')).toThrow('hydra: cannot attack localhost');
    });

    it('should reject 127.0.0.1', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('127.0.0.1')).toThrow('hydra: cannot attack localhost');
    });

    it('should throw for unreachable machine', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('10.0.0.1')).toThrow(
        'hydra: connect to 10.0.0.1: Connection timed out',
      );
    });
  });

  describe('service validation', () => {
    it('should throw when no SSH/FTP services are open', () => {
      const machine = getMockRemoteMachine({
        ports: [{ port: 80, service: 'http', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50')).toThrow('no open SSH/FTP services on 192.168.1.50');
    });

    it('should throw when requested service is not open', () => {
      const machine = getMockRemoteMachine({
        ports: [{ port: 22, service: 'ssh', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'ftp')).toThrow('no open ftp service on 192.168.1.50');
    });

    it('should skip closed ports', () => {
      const machine = getMockRemoteMachine({
        ports: [
          { port: 21, service: 'ftp', open: false },
          { port: 22, service: 'ssh', open: true },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Filtering to ftp only should fail since it's closed
      expect(() => hydra.fn('192.168.1.50', 'ftp')).toThrow('no open ftp service');
    });
  });

  describe('user filtering', () => {
    it('should attack all users when no user filter given', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Make all crack attempts succeed
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      // Should reference all 3 users in summary
      expect(lines.some((l) => l.includes('3 target users'))).toBe(true);
    });

    it('should filter to specific user', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh', 'guest');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('1 target user '))).toBe(true);
    });

    it('should throw for unknown user', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'ssh', 'nobody')).toThrow(
        'hydra: user "nobody" not found on 192.168.1.50',
      );
    });
  });

  describe('cracking mechanic', () => {
    it('should always crack guest users (probability 1.0)', async () => {
      const machine = getMockRemoteMachine({
        users: [
          {
            username: 'guest',
            passwordHash: '084e0343a0486ff05530df6c705c8bb4',
            userType: 'guest',
          },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Math.random returns 0.99 — still below 1.0 threshold
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: guest'))).toBe(true);
      expect(lines.some((l) => l.includes('1 of 1'))).toBe(true);
    });

    it('should crack user when random < 0.18', async () => {
      const machine = getMockRemoteMachine({
        users: [
          {
            username: 'ftpuser',
            passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99',
            userType: 'user',
          },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(true);
    });

    it('should not crack user when random >= 0.18', async () => {
      const machine = getMockRemoteMachine({
        users: [
          {
            username: 'ftpuser',
            passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99',
            userType: 'user',
          },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
    });

    it('should crack root when random < 0.025', async () => {
      const machine = getMockRemoteMachine({
        users: [
          { username: 'root', passwordHash: 'ca8f678fec022c9892f0ffee16eb0aa3', userType: 'root' },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: root'))).toBe(true);
    });

    it('should not crack root when random >= 0.025', async () => {
      const machine = getMockRemoteMachine({
        users: [
          { username: 'root', passwordHash: 'ca8f678fec022c9892f0ffee16eb0aa3', userType: 'root' },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: root'))).toBe(false);
    });

    it('should not produce a result line when password hash is not in wordlist', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'guest', passwordHash: 'not_a_real_hash', userType: 'guest' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login:'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
    });
  });

  describe('output format', () => {
    it('should show header', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines[0]).toBe('Hydra v9.4 — Network Login Cracker');
    });

    it('should show DATA line with service info', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('[DATA] attacking ssh://192.168.1.50:22'))).toBe(true);
    });

    it('should show STATUS progress lines', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      const statusLines = lines.filter((l) => l.includes('[STATUS]'));
      expect(statusLines.length).toBe(4);
    });

    it('should show success lines with port, service, host, login, password', async () => {
      const machine = getMockRemoteMachine({
        users: [
          {
            username: 'guest',
            passwordHash: '084e0343a0486ff05530df6c705c8bb4',
            userType: 'guest',
          },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      const successLine = lines.find((l) => l.includes('[22][ssh]'));
      expect(successLine).toBeDefined();
      expect(successLine).toContain('host: 192.168.1.50');
      expect(successLine).toContain('login: guest');
      expect(successLine).toContain('password: ');
    });

    it('should show summary line', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('of 3 target users successfully cracked'))).toBe(true);
    });

    it('should attack both services when no filter given', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('attacking ftp://'))).toBe(true);
      expect(lines.some((l) => l.includes('attacking ssh://'))).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('should support cancel', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      expect(result.cancel).toBeDefined();
    });
  });
});
