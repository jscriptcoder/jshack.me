import { describe, it, expect, vi } from 'vitest';
import { secrets } from '../secrets/secrets';
import { WIFI_NETWORKS } from '../network/wifiNetworks';
import { createNmcliCommand } from './nmcli';

type MockContextConfig = {
  readonly isOnLocalhost?: boolean;
  readonly isWifiConnected?: boolean;
  readonly connectedEssid?: string | null;
};

const createMockContext = (config: MockContextConfig = {}) => {
  const { isOnLocalhost = true, isWifiConnected = false, connectedEssid = null } = config;

  return {
    isOnLocalhost: () => isOnLocalhost,
    isWifiConnected: () => isWifiConnected,
    connectedEssid: () => connectedEssid,
    setWifiConnected: vi.fn(),
    disconnectWifi: vi.fn(),
    getWifiNetworks: () => WIFI_NETWORKS,
  };
};

describe('nmcli command', () => {
  describe('no args', () => {
    it('should show usage when called with no arguments', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn();

      expect(result).toContain('Usage:');
      expect(result).toContain('connect');
      expect(result).toContain('disconnect');
      expect(result).toContain('status');
    });
  });

  describe('unknown subcommand', () => {
    it('should throw for unknown subcommand', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('bogus')).toThrow('unknown subcommand');
    });
  });

  describe('connect', () => {
    it('should throw when not on localhost', () => {
      const context = createMockContext({ isOnLocalhost: false });
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD)).toThrow(
        'only available on localhost',
      );
    });

    it('should return no-op when connecting to same network', () => {
      const context = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'JSHACK-CORP',
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD) as string;

      expect(result).toContain('Already connected');
      expect(context.setWifiConnected).not.toHaveBeenCalled();
    });

    it('should auto-disconnect when switching to different network', () => {
      const context = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'OLD-NETWORK',
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD) as string;

      expect(result).toContain('Disconnected from OLD-NETWORK');
      expect(result).toContain('Connected to JSHACK-CORP');
      expect(context.setWifiConnected).toHaveBeenCalledWith({
        essid: 'JSHACK-CORP',
        bssid: 'A4:CF:12:D3:8B:7A',
      });
    });

    it('should throw when ESSID is missing', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('connect')).toThrow('usage:');
    });

    it('should throw when password is missing', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('connect', 'JSHACK-CORP')).toThrow('usage:');
    });

    it('should throw for unknown ESSID', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('connect', 'UnknownNetwork', 'pass')).toThrow('not found');
    });

    it('should throw for wrong password', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('connect', 'JSHACK-CORP', 'wrong_password')).toThrow(
        'authentication failed',
      );
    });

    it('should connect with correct credentials', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD) as string;

      expect(result).toContain('Connected to JSHACK-CORP');
      expect(context.setWifiConnected).toHaveBeenCalledWith({
        essid: 'JSHACK-CORP',
        bssid: 'A4:CF:12:D3:8B:7A',
      });
    });
  });

  describe('disconnect', () => {
    it('should throw when not connected', () => {
      const context = createMockContext({ isWifiConnected: false });
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn('disconnect')).toThrow('not connected');
    });

    it('should disconnect when on localhost', () => {
      const context = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'JSHACK-CORP',
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('disconnect') as string;

      expect(result).toContain('Disconnected from JSHACK-CORP');
      expect(context.setWifiConnected).toHaveBeenCalledWith(null);
      expect(context.disconnectWifi).not.toHaveBeenCalled();
    });

    it('should call disconnectWifi when on remote machine', () => {
      const context = createMockContext({ isOnLocalhost: false, isWifiConnected: true });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('disconnect') as string;

      expect(result).toContain('network connection lost');
      expect(result).toContain('Returned to localhost');
      expect(context.disconnectWifi).toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('should show connected status with network name', () => {
      const context = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'JSHACK-CORP',
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('status') as string;

      expect(result).toContain('connected to JSHACK-CORP');
    });

    it('should show disconnected status', () => {
      const context = createMockContext({ isWifiConnected: false });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('status') as string;

      expect(result).toContain('disconnected');
    });

    it('should show not available on remote machine', () => {
      const context = createMockContext({ isOnLocalhost: false });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('status') as string;

      expect(result).toContain('not available on this machine');
    });
  });
});
