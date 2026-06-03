import { describe, expect, it } from 'vitest';
import { asMachineId, asPlayerKeyHex } from '../types';
import { computeWorkstationId } from '../identity/workstation';
import {
  buildColdStartConnectivity,
  type ConnectivityState,
  type WirelessInterface,
} from '../network/interfaces';
import { isOnline } from '../network/interfaces';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockSession,
} from '../../test/factories/commandEnv';
import { commandRegistry } from './registry';
import { airmon } from './airmon';

/**
 * `airmon` is the player's first real WiFi action: put `wlan0` into monitor
 * mode (the airdump/aircrack prerequisite). It gates on being on the player's
 * own workstation, refuses interfaces that aren't a free wireless NIC, and
 * mutates connectivity through the generic `env.setInterface` seam. Tests drive
 * a live mutable connectivity so a start is observable on the next read.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const OWN_MACHINE = asMachineId(computeWorkstationId('workstation', 'a'.repeat(64)));

/** An env whose `interfaces()`/`isOnline()` read — and whose `setInterface`
 *  writes — the SAME mutable connectivity, so a command's mutation is visible
 *  to a follow-up read (idempotency, post-state assertions). */
const airmonEnv = (
  initial: ConnectivityState,
  machineId = OWN_MACHINE,
): { readonly env: ReturnType<typeof mockCommandEnv>; readonly get: () => ConnectivityState } => {
  let current = initial;
  const env = mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({ machineId, playerKey: PUBKEY }),
    network: mockNetworkView({
      interfaces: () => [...current.interfaces.values()],
      isOnline: () => isOnline(current),
    }),
    setInterface: (name, iface) => {
      current = { interfaces: new Map(current.interfaces).set(name, iface) };
    },
  });
  return { env, get: () => current };
};

const wlan0Of = (state: ConnectivityState): WirelessInterface => {
  const iface = state.interfaces.get('wlan0');
  if (iface === undefined || iface.kind !== 'wireless') throw new Error('unreachable');
  return iface;
};

const textOf = async (
  result: Awaited<ReturnType<typeof airmon.execute>>,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('airmon', () => {
  it('enables monitor mode on wlan0 and prints the exact driver banner', async () => {
    const { env, get } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const result = await airmon.execute(env, ['start', 'wlan0'], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');

    expect(wlan0Of(get()).monitorMode).toBe(true);
    expect(result.exitCode).toBe(0);
    // exact banner: pins every line (incl. the blank separator) and the kind
    expect(result.lines).toEqual([
      { kind: 'text', content: 'PHY     Interface       Driver          Chipset' },
      { kind: 'text', content: 'phy0    wlan0           ath9k_htc       Qualcomm Atheros AR9271' },
      { kind: 'text', content: '' },
      { kind: 'text', content: '                (monitor mode enabled on wlan0)' },
    ]);
  });

  it('disables monitor mode on stop', async () => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const monitoring: ConnectivityState = {
      interfaces: new Map(cold.interfaces).set('wlan0', { ...wlan0Of(cold), monitorMode: true }),
    };
    const { env, get } = airmonEnv(monitoring);
    const { text } = await textOf(await airmon.execute(env, ['stop', 'wlan0'], NO_FLAGS));

    expect(wlan0Of(get()).monitorMode).toBe(false);
    expect(text).toContain('(monitor mode disabled on wlan0)');
  });

  it('is idempotent: starting when already monitoring just says so', async () => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const monitoring: ConnectivityState = {
      interfaces: new Map(cold.interfaces).set('wlan0', { ...wlan0Of(cold), monitorMode: true }),
    };
    const { env } = airmonEnv(monitoring);
    const { text, exitCode } = await textOf(await airmon.execute(env, ['start', 'wlan0'], NO_FLAGS));

    expect(text).toBe('wlan0 is already in monitor mode');
    expect(text).not.toContain('AR9271');
    expect(exitCode).toBe(0);
  });

  it('is idempotent: stopping when not monitoring just says so', async () => {
    const { env } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const { text } = await textOf(await airmon.execute(env, ['stop', 'wlan0'], NO_FLAGS));
    expect(text).toBe('wlan0 is not in monitor mode');
  });

  it('refuses to run off the player’s own workstation', async () => {
    const { env, get } = airmonEnv(
      buildColdStartConnectivity(PUBKEY),
      asMachineId('203.0.113.42'),
    );
    const result = await airmon.execute(env, ['start', 'wlan0'], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');

    // an error line (styled distinctly), not plain text
    expect(result.lines).toEqual([
      { kind: 'error', content: 'airmon: command not available on this machine' },
    ]);
    expect(result.exitCode).toBe(1);
    expect(wlan0Of(get()).monitorMode).toBe(false);
  });

  it('rejects an interface that is already connected to a network', async () => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const connected: ConnectivityState = {
      interfaces: new Map(cold.interfaces).set('wlan0', {
        ...wlan0Of(cold),
        association: { essid: 'HomeWiFi', bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: '192.168.1.37',
      }),
    };
    const { env } = airmonEnv(connected);
    const { text, exitCode } = await textOf(await airmon.execute(env, ['start', 'wlan0'], NO_FLAGS));

    expect(text).toContain('airmon: wlan0 is already connected to a network');
    expect(exitCode).toBe(1);
  });

  it('rejects a non-wireless interface', async () => {
    const { env } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const { text, exitCode } = await textOf(await airmon.execute(env, ['start', 'eth0'], NO_FLAGS));
    expect(text).toContain('airmon: eth0 is not a wireless interface');
    expect(exitCode).toBe(1);
  });

  it('reports an unknown interface as not found', async () => {
    const { env } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const { text, exitCode } = await textOf(await airmon.execute(env, ['start', 'wlan9'], NO_FLAGS));
    expect(text).toContain("airmon: interface 'wlan9' not found");
    expect(exitCode).toBe(1);
  });

  it('shows usage when an argument is missing', async () => {
    const { env } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const { text, exitCode } = await textOf(await airmon.execute(env, ['start'], NO_FLAGS));
    expect(text).toContain('airmon: usage: airmon <start|stop> <interface>');
    expect(exitCode).toBe(1);
  });

  it('rejects an unknown action', async () => {
    const { env } = airmonEnv(buildColdStartConnectivity(PUBKEY));
    const { text, exitCode } = await textOf(
      await airmon.execute(env, ['restart', 'wlan0'], NO_FLAGS),
    );
    expect(text).toContain('airmon: unknown action \'restart\' — use "start" or "stop"');
    expect(exitCode).toBe(1);
  });

  it('resolves by name through the shell pipeline, past the /usr/bin binary gate', async () => {
    // Integration seam: airmon lives in /usr/bin (pre-installed), so the
    // registry's binary check must resolve it there before delegating.
    const tree = buildDirectory({
      usr: buildDirectory({
        bin: buildDirectory({
          airmon: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
        }),
      }),
    });
    let current = buildColdStartConnectivity(PUBKEY);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: PUBKEY }),
      session: mockSession({ machineId: OWN_MACHINE, playerKey: PUBKEY }),
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
      network: mockNetworkView({ interfaces: () => [...current.interfaces.values()] }),
      setInterface: (name, iface) => {
        current = { interfaces: new Map(current.interfaces).set(name, iface) };
      },
    });
    const { runCommandLine } = await import('../shell/runLine');

    const result = await runCommandLine(env, 'airmon start wlan0', commandRegistry);

    if (result.kind !== 'sync') throw new Error('sync expected');
    expect(result.lines.map((line) => line.content).join('\n')).toContain(
      '(monitor mode enabled on wlan0)',
    );
    expect(wlan0Of(current).monitorMode).toBe(true);
  });
});
