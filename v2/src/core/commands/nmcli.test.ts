import { describe, expect, it } from 'vitest';
import { asMachineId, asPlayerKeyHex } from '../types';
import { computeWorkstationId } from '../identity/workstation';
import {
  buildColdStartConnectivity,
  isOnline,
  type ConnectivityState,
  type WirelessInterface,
} from '../network/interfaces';
import type { WifiNetwork } from '../network/wifi';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockHomeNetwork,
  mockIdentity,
  mockNetworkView,
  mockSession,
} from '../../test/factories/commandEnv';
import { nmcli } from './nmcli';

/**
 * `nmcli` is the arc's finish line: connect to a cracked AP and go ONLINE.
 * Connect awaits the (deterministic) home-network join, assigns `wlan0`, and
 * streams its progress; disconnect/status read and clear that state. The tests
 * drive a live mutable connectivity so a connect is observable on the next read,
 * and capture the join calls so the "no-op / failure ⇒ never joined" invariants
 * are provable.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const OWN_MACHINE = asMachineId(computeWorkstationId('workstation', 'a'.repeat(64)));

const crackableNet = (overrides: Partial<WifiNetwork> = {}): WifiNetwork => ({
  bssid: 'AA:BB:CC:DD:EE:01',
  essid: 'BEAN-THERE-WIFI',
  power: -45,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: 'sunshine2024',
  ...overrides,
});

const noiseNet = (): WifiNetwork => ({
  bssid: 'AA:BB:CC:DD:EE:02',
  essid: 'NeighborNet',
  power: -90,
  channel: 1,
  encryption: 'WPA2',
  crackable: false,
});

const wlan0Of = (state: ConnectivityState): WirelessInterface => {
  const iface = state.interfaces.get('wlan0');
  if (iface === undefined || iface.kind !== 'wireless') throw new Error('unreachable');
  return iface;
};

const monitoring = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', { ...wlan0Of(cold), monitorMode: true }),
  };
};

const connectedTo = (essid: string, bssid: string, ipv4: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', {
      ...wlan0Of(cold),
      association: { essid, bssid },
      ipv4,
    }),
  };
};

type EnvOpts = {
  readonly wifiNetworks?: readonly WifiNetwork[];
  readonly assignment?: { readonly localIp: string; readonly hostname: string };
  readonly machineId?: ReturnType<typeof asMachineId>;
};

/** An env whose `interfaces()` reads — and whose `setInterface` writes — the
 *  SAME mutable connectivity, plus a join spy so a connect's effects (state
 *  mutation + the join call) are observable. */
const nmcliEnv = (initial: ConnectivityState, opts: EnvOpts = {}) => {
  let current = initial;
  const joinCalls: string[] = [];
  const env = mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({ machineId: opts.machineId ?? OWN_MACHINE, playerKey: PUBKEY }),
    network: mockNetworkView({
      interfaces: () => [...current.interfaces.values()],
      isOnline: () => isOnline(current),
      wifiNetworks: () => opts.wifiNetworks ?? [],
    }),
    setInterface: (name, iface) => {
      current = { interfaces: new Map(current.interfaces).set(name, iface) };
    },
    homeNetwork: mockHomeNetwork({
      join: async (essid) => {
        joinCalls.push(essid);
        return opts.assignment ?? { localIp: '192.168.5.20', hostname: 'host-20' };
      },
    }),
  });
  return { env, get: () => current, joinCalls };
};

const drainAsync = async (
  result: CommandResult,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const contents: string[] = [];
  for await (const line of result.lines) contents.push(line.content);
  return { text: contents.join('\n'), exitCode: await result.exitCode() };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('nmcli', () => {
  describe('connect', () => {
    it('joins a cracked AP, assigns wlan0 an IP, and goes online', async () => {
      const { env, get, joinCalls } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [crackableNet()],
        assignment: { localIp: '192.168.5.20', hostname: 'host-20' },
      });

      const { text, exitCode } = await drainAsync(
        await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI', 'sunshine2024'], NO_FLAGS),
      );

      const wlan0 = wlan0Of(get());
      expect(wlan0.association).toEqual({ essid: 'BEAN-THERE-WIFI', bssid: 'AA:BB:CC:DD:EE:01' });
      expect(wlan0.ipv4).toBe('192.168.5.20');
      expect(isOnline(get())).toBe(true);
      // The join seam is the only network step, called with the ESSID.
      expect(joinCalls).toEqual(['BEAN-THERE-WIFI']);
      expect(text).toContain('Connecting to BEAN-THERE-WIFI...');
      expect(text).toContain('Connected to BEAN-THERE-WIFI — assigned 192.168.5.20');
      expect(exitCode).toBe(0);
    });

    it('shows usage (not a bogus "already connected") when given no ESSID while offline', async () => {
      const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [crackableNet()],
      });

      const { text, exitCode } = syncResult(await nmcli.execute(env, ['connect'], NO_FLAGS));

      expect(text).toContain('nmcli: usage: nmcli connect <ESSID> <password>');
      // Guard against the `association?.essid === undefined` trap: an absent
      // ESSID must not read as "already connected to undefined".
      expect(text).not.toContain('Already connected');
      expect(exitCode).toBe(1);
    });

    it('rejects a wrong password without joining or changing state', async () => {
      const { env, get, joinCalls } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [crackableNet()],
      });

      const { text, exitCode } = syncResult(
        await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI', 'wrongpw'], NO_FLAGS),
      );

      expect(text).toContain('nmcli: authentication failed for "BEAN-THERE-WIFI"');
      expect(exitCode).toBe(1);
      expect(wlan0Of(get()).association).toBeNull();
      expect(joinCalls).toEqual([]);
    });

    it('cannot authenticate to a non-crackable AP (no password exists)', async () => {
      const { env, joinCalls } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [noiseNet()],
      });

      const { text, exitCode } = syncResult(
        await nmcli.execute(env, ['connect', 'NeighborNet', 'sunshine2024'], NO_FLAGS),
      );

      expect(text).toContain('nmcli: authentication failed for "NeighborNet"');
      expect(exitCode).toBe(1);
      expect(joinCalls).toEqual([]);
    });

    it('shows usage when the password is missing', async () => {
      const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [crackableNet()],
      });

      const { text, exitCode } = syncResult(
        await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI'], NO_FLAGS),
      );

      expect(text).toContain('nmcli: usage: nmcli connect <ESSID> <password>');
      expect(exitCode).toBe(1);
    });

    it('reports an unknown ESSID as not found', async () => {
      const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
        wifiNetworks: [crackableNet()],
      });

      const { text, exitCode } = syncResult(
        await nmcli.execute(env, ['connect', 'Nope', 'whatever'], NO_FLAGS),
      );

      expect(text).toContain('nmcli: network "Nope" not found');
      expect(exitCode).toBe(1);
    });

    it('refuses to connect while wlan0 is in monitor mode', async () => {
      const { env, joinCalls } = nmcliEnv(monitoring(), { wifiNetworks: [crackableNet()] });

      const { text, exitCode } = syncResult(
        await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI', 'sunshine2024'], NO_FLAGS),
      );

      expect(text).toContain("nmcli: wlan0 is in monitor mode — run 'airmon stop wlan0' first");
      expect(exitCode).toBe(1);
      expect(joinCalls).toEqual([]);
    });

    it('is a no-op when already connected to the same ESSID', async () => {
      const { env, get, joinCalls } = nmcliEnv(
        connectedTo('BEAN-THERE-WIFI', 'AA:BB:CC:DD:EE:01', '192.168.5.20'),
        { wifiNetworks: [crackableNet()] },
      );

      const { text } = syncResult(
        await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI', 'sunshine2024'], NO_FLAGS),
      );

      expect(text).toBe('Already connected to BEAN-THERE-WIFI');
      // No re-join, and the IP it already holds is untouched.
      expect(joinCalls).toEqual([]);
      expect(wlan0Of(get()).ipv4).toBe('192.168.5.20');
    });
  });

  describe('disconnect', () => {
    it('clears the association and goes offline', async () => {
      const { env, get } = nmcliEnv(connectedTo('BEAN-THERE-WIFI', 'AA:BB:CC:DD:EE:01', '192.168.5.20'));

      const { text, exitCode } = syncResult(await nmcli.execute(env, ['disconnect'], NO_FLAGS));

      expect(text).toBe('Disconnected from BEAN-THERE-WIFI');
      expect(exitCode).toBe(0);
      const wlan0 = wlan0Of(get());
      expect(wlan0.association).toBeNull();
      expect(wlan0.ipv4).toBeNull();
      expect(isOnline(get())).toBe(false);
    });

    it('errors when not connected to anything', async () => {
      const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY));

      const { text, exitCode } = syncResult(await nmcli.execute(env, ['disconnect'], NO_FLAGS));

      expect(text).toContain('nmcli: not connected to any network');
      expect(exitCode).toBe(1);
    });
  });

  describe('status', () => {
    it('reports the connected ESSID and assigned IP', async () => {
      const { env } = nmcliEnv(connectedTo('BEAN-THERE-WIFI', 'AA:BB:CC:DD:EE:01', '192.168.5.20'));

      const { text } = syncResult(await nmcli.execute(env, ['status'], NO_FLAGS));

      expect(text).toBe('wlan0: connected to BEAN-THERE-WIFI (192.168.5.20/24)');
    });

    it('reports disconnected when there is no association', async () => {
      const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY));

      const { text } = syncResult(await nmcli.execute(env, ['status'], NO_FLAGS));

      expect(text).toBe('wlan0: disconnected');
    });
  });

  it('refuses to run off the player’s own workstation', async () => {
    const { env, joinCalls } = nmcliEnv(buildColdStartConnectivity(PUBKEY), {
      wifiNetworks: [crackableNet()],
      machineId: asMachineId('203.0.113.42'),
    });

    const { text, exitCode } = syncResult(
      await nmcli.execute(env, ['connect', 'BEAN-THERE-WIFI', 'sunshine2024'], NO_FLAGS),
    );

    expect(text).toContain('nmcli: command not available on this machine');
    expect(exitCode).toBe(1);
    expect(joinCalls).toEqual([]);
  });

  it('shows the full usage for a missing subcommand', async () => {
    const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY));

    const { text, exitCode } = syncResult(await nmcli.execute(env, [], NO_FLAGS));

    // The usage block lists every subcommand...
    expect(text).toContain('nmcli connect <ESSID> <password>');
    expect(text).toContain('nmcli disconnect');
    expect(text).toContain('nmcli status');
    // ...and a missing subcommand is NOT the same as an unknown one.
    expect(text).not.toContain('unknown subcommand');
    expect(exitCode).toBe(1);
  });

  it('rejects an unknown subcommand', async () => {
    const { env } = nmcliEnv(buildColdStartConnectivity(PUBKEY));

    const { text, exitCode } = syncResult(await nmcli.execute(env, ['frobnicate'], NO_FLAGS));

    expect(text).toContain("nmcli: unknown subcommand 'frobnicate'");
    expect(exitCode).toBe(1);
  });
});
