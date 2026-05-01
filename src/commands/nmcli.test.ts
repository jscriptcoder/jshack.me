import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secrets } from '../secrets/secrets';
import { WIFI_NETWORKS } from '../network/wifiNetworks';
import type { AsyncOutput } from '../components/Terminal/types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import { createNmcliCommand } from './nmcli';

type MockContextConfig = {
  readonly isOnLocalhost?: boolean;
  readonly isWifiConnected?: boolean;
  readonly connectedEssid?: string | null;
  readonly ensureJoined?: (essid: string) => Promise<HomeNetwork>;
};

const stubHomeNetwork = (overrides: Partial<HomeNetwork> = {}): HomeNetwork =>
  ({
    essid: 'JSHACK-CORP',
    localhostIp: '10.0.0.187',
    hostname: 'skylab-9k3',
    machines: [],
    layers: [],
    networkConfig: { machineConfigs: {} },
    fileSystems: {},
    router: { publicIp: '203.0.113.42', hostname: 'router', internalIp: '10.0.0.1' },
    routerMachine: {} as HomeNetwork['routerMachine'],
    entryPoint: '10.0.0.2',
    entryVariant: 'ssh',
    difficulty: 'easy',
    ...overrides,
  }) as HomeNetwork;

const createMockContext = (config: MockContextConfig = {}) => {
  const { isOnLocalhost = true, isWifiConnected = false, connectedEssid = null } = config;

  return {
    isOnLocalhost: () => isOnLocalhost,
    isWifiConnected: () => isWifiConnected,
    connectedEssid: () => connectedEssid,
    setWifiConnected: vi.fn(),
    disconnectWifi: vi.fn(),
    getWifiNetworks: () => WIFI_NETWORKS,
    ensureJoined: config.ensureJoined ?? vi.fn().mockResolvedValue(stubHomeNetwork()),
    getActiveHomeNetwork: () => null,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

// Async lines now drain a real Promise from ensureJoined — flush the
// microtask queue with vi.runAllTimersAsync() so resolved promises and
// scheduled callbacks both complete before assertion.
const collectAsyncLines = async (result: unknown): Promise<readonly string[]> => {
  const lines: string[] = [];
  if (isAsyncOutput(result)) {
    result.start(
      (line) => lines.push(line),
      () => {},
    );
  }
  await vi.runAllTimersAsync();
  return lines;
};

describe('nmcli command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('no args', () => {
    it('should throw when called with no arguments', () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      expect(() => nmcli.fn()).toThrow('nmcli: missing subcommand');
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

    it('should auto-disconnect when switching to different network', async () => {
      const context = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'OLD-NETWORK',
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      const lines = await collectAsyncLines(result);

      expect(lines.join('\n')).toContain('Disconnected from OLD-NETWORK');
      expect(lines.join('\n')).toContain('Connected to JSHACK-CORP');
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

    it('should connect with correct credentials', async () => {
      const context = createMockContext();
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      const lines = await collectAsyncLines(result);

      expect(lines.join('\n')).toContain('Connecting to JSHACK-CORP...');
      expect(lines.join('\n')).toContain('Connected to JSHACK-CORP');
      expect(context.setWifiConnected).toHaveBeenCalledWith({
        essid: 'JSHACK-CORP',
        bssid: 'A4:CF:12:D3:8B:7A',
      });
    });

    it('should display the assigned hostname and lan IP from the join response', async () => {
      const context = createMockContext({
        ensureJoined: vi
          .fn()
          .mockResolvedValue(
            stubHomeNetwork({ hostname: 'skylab-9k3', localhostIp: '10.0.0.187' }),
          ),
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      const lines = await collectAsyncLines(result);

      expect(lines.join('\n')).toContain(
        'Connected to JSHACK-CORP — assigned skylab-9k3 (10.0.0.187)',
      );
    });

    it('should fall back to lan IP only when no hostname is assigned (single-player path)', async () => {
      const context = createMockContext({
        ensureJoined: vi
          .fn()
          .mockResolvedValue(stubHomeNetwork({ hostname: undefined, localhostIp: '10.0.0.100' })),
      });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      const lines = await collectAsyncLines(result);

      expect(lines.join('\n')).toContain('Connected to JSHACK-CORP — assigned 10.0.0.100');
    });

    it('should not set wifi connected until ensureJoined resolves', async () => {
      let resolveJoin!: (network: HomeNetwork) => void;
      const ensureJoined = vi.fn<(essid: string) => Promise<HomeNetwork>>().mockImplementation(
        () =>
          new Promise<HomeNetwork>((res) => {
            resolveJoin = res;
          }),
      );
      const context = createMockContext({ ensureJoined });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {},
        );
      }

      // While ensureJoined is in flight, setWifiConnected should not have fired.
      await Promise.resolve();
      expect(context.setWifiConnected).not.toHaveBeenCalled();

      // After ensureJoined resolves, setWifiConnected fires.
      resolveJoin(stubHomeNetwork());
      await vi.runAllTimersAsync();
      expect(context.setWifiConnected).toHaveBeenCalledWith({
        essid: 'JSHACK-CORP',
        bssid: 'A4:CF:12:D3:8B:7A',
      });
    });

    it('should surface a usable error when ensureJoined fails', async () => {
      const ensureJoined = vi
        .fn<(essid: string) => Promise<HomeNetwork>>()
        .mockRejectedValue(new Error('rate_limited'));
      const context = createMockContext({ ensureJoined });
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('connect', 'JSHACK-CORP', secrets.WIFI_PASSWORD);
      const lines = await collectAsyncLines(result);

      expect(lines.join('\n')).toContain('failed to join JSHACK-CORP');
      expect(lines.join('\n')).toContain('rate_limited');
      expect(context.setWifiConnected).not.toHaveBeenCalled();
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

    it('should include the assigned LAN IP from the active home network', () => {
      const baseContext = createMockContext({
        isWifiConnected: true,
        connectedEssid: 'JSHACK-CORP',
      });
      const context = {
        ...baseContext,
        getActiveHomeNetwork: () => stubHomeNetwork({ localhostIp: '10.0.0.187' }),
      };
      const nmcli = createNmcliCommand(context);

      const result = nmcli.fn('status') as string;

      expect(result).toContain('10.0.0.187/24');
      expect(result).not.toContain('192.168.1.100');
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
