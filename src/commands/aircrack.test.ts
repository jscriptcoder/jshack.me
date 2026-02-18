import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AsyncOutput } from '../components/Terminal/types';
import { secrets } from '../secrets/secrets';
import { createAircrackCommand } from './aircrack';

type AircrackContextConfig = {
  readonly isOnLocalhost?: boolean;
  readonly isMonitorMode?: boolean;
};

const createMockContext = (config: AircrackContextConfig = {}) => {
  const { isOnLocalhost = true, isMonitorMode = true } = config;

  return {
    isOnLocalhost: () => isOnLocalhost,
    isMonitorMode: () => isMonitorMode,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

describe('aircrack command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw when not on localhost', () => {
      const context = createMockContext({ isOnLocalhost: false });
      const aircrack = createAircrackCommand(context);

      expect(() => aircrack.fn('A4:CF:12:D3:8B:7A')).toThrow('not available on this machine');
    });

    it('should throw when monitor mode is not enabled', () => {
      const context = createMockContext({ isMonitorMode: false });
      const aircrack = createAircrackCommand(context);

      expect(() => aircrack.fn('A4:CF:12:D3:8B:7A')).toThrow('monitor mode not enabled');
    });

    it('should throw when missing BSSID', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);

      expect(() => aircrack.fn()).toThrow('missing BSSID');
    });

    it('should throw for unknown BSSID', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);

      expect(() => aircrack.fn('FF:FF:FF:FF:FF:FF')).toThrow('not found');
    });
  });

  describe('crackable network', () => {
    it('should return AsyncOutput', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);

      const result = aircrack.fn('A4:CF:12:D3:8B:7A');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should find key for crackable network', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);
      const result = aircrack.fn('A4:CF:12:D3:8B:7A');

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

      vi.advanceTimersByTime(10000);

      expect(completed).toBe(true);
      expect(lines.some((l) => l.includes('KEY FOUND!'))).toBe(true);
      expect(lines.some((l) => l.includes(secrets.WIFI_PASSWORD))).toBe(true);
    });
  });

  describe('non-crackable networks', () => {
    it('should fail for WPA3 network', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);
      const result = aircrack.fn('8E:1F:64:A7:22:9C');

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

      vi.advanceTimersByTime(5000);

      expect(completed).toBe(true);
      expect(lines.some((l) => l.includes('WPA3'))).toBe(true);
    });

    it('should fail for weak signal network', () => {
      const context = createMockContext();
      const aircrack = createAircrackCommand(context);
      const result = aircrack.fn('D2:F0:B8:4E:91:C5');

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

      vi.advanceTimersByTime(5000);

      expect(completed).toBe(true);
      expect(lines.some((l) => l.includes('Signal too weak'))).toBe(true);
    });
  });
});
