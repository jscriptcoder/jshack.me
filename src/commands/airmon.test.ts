import { describe, it, expect } from 'vitest';
import { createAirmonCommand } from './airmon';

type AirmonContextConfig = {
  readonly isOnLocalhost?: boolean;
  readonly isWifiConnected?: boolean;
  readonly isMonitorMode?: boolean;
};

const createMockContext = (config: AirmonContextConfig = {}) => {
  const { isOnLocalhost = true, isWifiConnected = false, isMonitorMode = false } = config;
  let monitorMode = isMonitorMode;

  return {
    isOnLocalhost: () => isOnLocalhost,
    isWifiConnected: () => isWifiConnected,
    isMonitorMode: () => monitorMode,
    setMonitorMode: (enabled: boolean) => {
      monitorMode = enabled;
    },
    getMonitorMode: () => monitorMode,
  };
};

describe('airmon command', () => {
  describe('error handling', () => {
    it('should throw when not on localhost', () => {
      const context = createMockContext({ isOnLocalhost: false });
      const airmon = createAirmonCommand(context);

      expect(() => airmon.fn('start', 'wlan0')).toThrow('not available on this machine');
    });

    it('should throw when WiFi is already connected', () => {
      const context = createMockContext({ isWifiConnected: true });
      const airmon = createAirmonCommand(context);

      expect(() => airmon.fn('start', 'wlan0')).toThrow('already connected');
    });

    it('should throw when missing arguments', () => {
      const context = createMockContext();
      const airmon = createAirmonCommand(context);

      expect(() => airmon.fn()).toThrow('usage');
    });

    it('should throw for invalid interface', () => {
      const context = createMockContext();
      const airmon = createAirmonCommand(context);

      expect(() => airmon.fn('start', 'eth0')).toThrow("interface 'eth0' not found");
    });

    it('should throw for unknown action', () => {
      const context = createMockContext();
      const airmon = createAirmonCommand(context);

      expect(() => airmon.fn('restart', 'wlan0')).toThrow("unknown action 'restart'");
    });
  });

  describe('start action', () => {
    it('should enable monitor mode', () => {
      const context = createMockContext();
      const airmon = createAirmonCommand(context);

      const result = airmon.fn('start', 'wlan0');

      expect(result).toContain('monitor mode enabled');
      expect(context.getMonitorMode()).toBe(true);
    });

    it('should return message when already in monitor mode', () => {
      const context = createMockContext({ isMonitorMode: true });
      const airmon = createAirmonCommand(context);

      const result = airmon.fn('start', 'wlan0');

      expect(result).toContain('already in monitor mode');
    });
  });

  describe('stop action', () => {
    it('should disable monitor mode', () => {
      const context = createMockContext({ isMonitorMode: true });
      const airmon = createAirmonCommand(context);

      const result = airmon.fn('stop', 'wlan0');

      expect(result).toContain('monitor mode disabled');
      expect(context.getMonitorMode()).toBe(false);
    });

    it('should return message when not in monitor mode', () => {
      const context = createMockContext();
      const airmon = createAirmonCommand(context);

      const result = airmon.fn('stop', 'wlan0');

      expect(result).toContain('not in monitor mode');
    });
  });
});
