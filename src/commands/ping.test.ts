import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createPingCommand } from './ping';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [{ username: 'root', passwordHash: 'abc123', userType: 'root' }],
  ...overrides,
});

type PingContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
};

const createMockPingContext = (config: PingContextConfig = {}) => {
  const { machines = [getMockRemoteMachine()], localIP = '192.168.1.100' } = config;

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

describe('ping command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no host given', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      expect(() => ping.fn()).toThrow('ping: missing host operand');
    });

    it('should throw error when count is less than 1', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      expect(() => ping.fn('192.168.1.1', 0)).toThrow('ping: count must be between 1 and 10');
    });

    it('should throw error when count is greater than 10', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      expect(() => ping.fn('192.168.1.1', 11)).toThrow('ping: count must be between 1 and 10');
    });

    it('should throw error for unknown hostname', () => {
      const context = createMockPingContext({
        machines: [],
      });
      const ping = createPingCommand(context);

      expect(() => ping.fn('unknownhost')).toThrow('ping: unknownhost: Name or service not known');
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      const result = ping.fn('192.168.1.50');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      const result = ping.fn('192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);

      const result = ping.fn('192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('ping execution', () => {
    it('should output header immediately', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);
      const result = ping.fn('192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('PING 192.168.1.50 (192.168.1.50): 56 data bytes');
    });

    it('should resolve hostname to IP in header', () => {
      const context = createMockPingContext({
        machines: [getMockRemoteMachine({ ip: '192.168.1.50', hostname: 'fileserver' })],
      });
      const ping = createPingCommand(context);
      const result = ping.fn('fileserver');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('PING fileserver (192.168.1.50): 56 data bytes');
    });

    it('should output ping responses after delay', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);
      const result = ping.fn('192.168.1.50', 2);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Advance past max jitter range (first ping delay)
      vi.advanceTimersByTime(1200);
      expect(lines.some((l) => l.includes('icmp_seq=1'))).toBe(true);

      // Fast-forward second ping delay (×1.5 for jitter)
      vi.advanceTimersByTime(1200);
      expect(lines.some((l) => l.includes('icmp_seq=2'))).toBe(true);
    });

    it('should output statistics after all pings', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);
      const result = ping.fn('192.168.1.50', 1);

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

      // Fast-forward through ping and stats delay (×1.5 for jitter)
      vi.advanceTimersByTime(1500);

      expect(lines.some((l) => l.includes('ping statistics'))).toBe(true);
      expect(lines.some((l) => l.includes('packets transmitted'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('should ping localhost successfully', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);
      const result = ping.fn('localhost', 1);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toContain('PING localhost (127.0.0.1)');

      vi.advanceTimersByTime(1500);
      expect(lines.some((l) => l.includes('icmp_seq=1'))).toBe(true);
    });

    it('should ping local IP successfully', () => {
      const context = createMockPingContext({ localIP: '192.168.1.100' });
      const ping = createPingCommand(context);
      const result = ping.fn('192.168.1.100', 1);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(1500);
      expect(lines.some((l) => l.includes('1 packets transmitted, 1 received'))).toBe(true);
    });

    it('should cancel pending pings', () => {
      const context = createMockPingContext();
      const ping = createPingCommand(context);
      const result = ping.fn('192.168.1.50', 4);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );

        // Cancel after first ping (×1.5 for jitter)
        vi.advanceTimersByTime(1200);
        result.cancel?.();
        vi.advanceTimersByTime(4500);
      }

      // Should only have header and first ping, no more
      const pingResponses = lines.filter((l) => l.includes('icmp_seq'));
      expect(pingResponses.length).toBe(1);
    });

    it('should show 100% packet loss for unreachable IP', () => {
      const context = createMockPingContext({
        machines: [getMockRemoteMachine({ ip: '192.168.1.50' })],
      });
      const ping = createPingCommand(context);
      // Use an IP that doesn't exist in our game
      const result = ping.fn('8.8.8.8', 2);

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

      // Fast-forward through all pings and stats
      vi.advanceTimersByTime(3000);

      expect(completed).toBe(true);
      expect(
        lines.some((l) => l.includes('2 packets transmitted, 0 received, 100% packet loss')),
      ).toBe(true);
      // Should not have any successful ping responses
      expect(lines.some((l) => l.includes('icmp_seq'))).toBe(false);
    });

    it('should show 100% packet loss for unknown IP in local subnet', () => {
      const context = createMockPingContext({
        machines: [getMockRemoteMachine({ ip: '192.168.1.50' })],
      });
      const ping = createPingCommand(context);
      // Use an IP in local subnet that doesn't exist
      const result = ping.fn('192.168.1.99', 2);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('100% packet loss'))).toBe(true);
    });
  });
});
