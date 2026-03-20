import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AsyncOutput } from '../components/Terminal/types';
import { WIFI_NETWORKS } from '../network/wifiNetworks';
import { createAirdumpCommand } from './airdump';

type AirdumpContextConfig = {
  readonly isOnLocalhost?: boolean;
  readonly isMonitorMode?: boolean;
};

const createMockContext = (config: AirdumpContextConfig = {}) => {
  const { isOnLocalhost = true, isMonitorMode = true } = config;

  return {
    isOnLocalhost: () => isOnLocalhost,
    isMonitorMode: () => isMonitorMode,
    getWifiNetworks: () => WIFI_NETWORKS,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

describe('airdump command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw when not on localhost', () => {
      const context = createMockContext({ isOnLocalhost: false });
      const airdump = createAirdumpCommand(context);

      expect(() => airdump.fn()).toThrow('not available on this machine');
    });

    it('should throw when monitor mode is not enabled', () => {
      const context = createMockContext({ isMonitorMode: false });
      const airdump = createAirdumpCommand(context);

      expect(() => airdump.fn()).toThrow('monitor mode not enabled');
    });
  });

  describe('async output', () => {
    it('should return AsyncOutput', () => {
      const context = createMockContext();
      const airdump = createAirdumpCommand(context);

      const result = airdump.fn();

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should output header immediately', () => {
      const context = createMockContext();
      const airdump = createAirdumpCommand(context);
      const result = airdump.fn();

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines.some((l) => l.includes('scanning'))).toBe(true);
    });

    it('should output network rows with BSSID info', () => {
      const context = createMockContext();
      const airdump = createAirdumpCommand(context);
      const result = airdump.fn();

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('A4:CF:12:D3:8B:7A'))).toBe(true);
      expect(lines.some((l) => l.includes('JSHACK-CORP'))).toBe(true);
      expect(lines.some((l) => l.includes('FBI_Van_7'))).toBe(true);
    });

    it('should complete with scan summary', () => {
      const context = createMockContext();
      const airdump = createAirdumpCommand(context);
      const result = airdump.fn();

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
      expect(lines.some((l) => l.includes('4 networks found'))).toBe(true);
    });
  });
});
