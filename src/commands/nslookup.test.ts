import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createNslookupCommand } from './nslookup';

// --- Factory Functions ---

const getMockDnsRecord = (overrides?: Partial<DnsRecord>): DnsRecord => ({
  domain: 'gateway.local',
  ip: '192.168.1.1',
  type: 'A',
  ...overrides,
});

type NslookupContextConfig = {
  readonly dnsRecords?: readonly DnsRecord[];
  readonly gateway?: string;
};

const createMockNslookupContext = (config: NslookupContextConfig = {}) => {
  const { dnsRecords = [getMockDnsRecord()], gateway = '192.168.1.1' } = config;

  return {
    resolveDomain: (domain: string) =>
      dnsRecords.find((r) => r.domain.toLowerCase() === domain.toLowerCase()),
    getGateway: () => gateway,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

// --- Tests ---

describe('nslookup command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no domain given', () => {
      const context = createMockNslookupContext();
      const nslookup = createNslookupCommand(context);

      expect(() => nslookup.fn()).toThrow('nslookup: missing domain argument');
    });

    it('should throw error when domain is not a string', () => {
      const context = createMockNslookupContext();
      const nslookup = createNslookupCommand(context);

      expect(() => nslookup.fn(123)).toThrow('nslookup: domain must be a string');
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const context = createMockNslookupContext();
      const nslookup = createNslookupCommand(context);

      const result = nslookup.fn('gateway.local');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start and cancel functions', () => {
      const context = createMockNslookupContext();
      const nslookup = createNslookupCommand(context);

      const result = nslookup.fn('gateway.local');

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('dns lookup execution', () => {
    it('should show DNS server info immediately', () => {
      const context = createMockNslookupContext({ gateway: '192.168.1.1' });
      const nslookup = createNslookupCommand(context);
      const result = nslookup.fn('gateway.local');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Server:  192.168.1.1');
      expect(lines[1]).toBe('Address: 192.168.1.1#53');
    });

    it('should resolve domain to IP after delay', () => {
      const context = createMockNslookupContext({
        dnsRecords: [getMockDnsRecord({ domain: 'fileserver.local', ip: '192.168.1.50' })],
      });
      const nslookup = createNslookupCommand(context);
      const result = nslookup.fn('fileserver.local');

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

      // Advance past max jitter range (DNS lookup delay)
      vi.advanceTimersByTime(900);

      expect(lines.some((l) => l.includes('Non-authoritative answer'))).toBe(true);
      expect(lines.some((l) => l.includes('Name:    fileserver.local'))).toBe(true);
      expect(lines.some((l) => l.includes('Address: 192.168.1.50'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('should show NXDOMAIN for unknown domain', () => {
      const context = createMockNslookupContext({
        dnsRecords: [],
      });
      const nslookup = createNslookupCommand(context);
      const result = nslookup.fn('unknown.domain');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(900);

      expect(lines.some((l) => l.includes("can't find unknown.domain: NXDOMAIN"))).toBe(true);
    });

    it('should be case-insensitive for domain lookup', () => {
      const context = createMockNslookupContext({
        dnsRecords: [getMockDnsRecord({ domain: 'Gateway.Local', ip: '192.168.1.1' })],
      });
      const nslookup = createNslookupCommand(context);
      const result = nslookup.fn('gateway.local');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(900);

      expect(lines.some((l) => l.includes('Address: 192.168.1.1'))).toBe(true);
    });

    it('should cancel pending lookup', () => {
      const context = createMockNslookupContext();
      const nslookup = createNslookupCommand(context);
      const result = nslookup.fn('gateway.local');

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );

        // Cancel before lookup completes
        vi.advanceTimersByTime(300);
        result.cancel?.();
        vi.advanceTimersByTime(900);
      }

      // Should only have server info, no answer
      expect(lines.some((l) => l.includes('Non-authoritative'))).toBe(false);
      expect(completed).toBe(false);
    });
  });
});
