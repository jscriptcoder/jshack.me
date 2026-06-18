import { describe, expect, it } from 'vitest';
import { asMachineId, asPlayerKeyHex } from '../types';
import { computeWorkstationId } from '../identity/workstation';
import {
  buildColdStartConnectivity,
  type ConnectivityState,
  type WirelessInterface,
} from '../network/interfaces';
import type { WifiNetwork } from '../network/wifi';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockSession,
} from '../../test/factories/commandEnv';
import type { CommandEnv, CommandResult } from './types';
import { commandRegistry } from './registry';
import { aircrack } from './aircrack';

/**
 * `aircrack` is the payoff of the WiFi arc: target a BSSID and either recover
 * the key (`KEY FOUND!`) for a crackable AP or learn exactly why a noise AP
 * resists — WPA3, weak signal, or a hidden ESSID. It streams a dramatic crack
 * paced by `env.sleep`, and Ctrl-C (a rejecting sleep) stops it mid-flight
 * before the key is revealed. Like airdump it requires the player's own
 * workstation + monitor mode.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const OWN_MACHINE = asMachineId(computeWorkstationId('workstation', 'a'.repeat(64)));

const CRACKABLE: WifiNetwork = {
  bssid: 'AA:AA:AA:AA:AA:AA',
  essid: 'ACME-CORP',
  power: -48,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: 'cr4ck3d_w1f1',
};
const WPA3: WifiNetwork = {
  bssid: 'BB:BB:BB:BB:BB:BB',
  essid: 'NetGear-5G',
  power: -60,
  channel: 1,
  encryption: 'WPA3',
  crackable: false,
};
const WEAK: WifiNetwork = {
  bssid: 'CC:CC:CC:CC:CC:CC',
  essid: 'FBI_Van_7',
  power: -88,
  channel: 3,
  encryption: 'WPA2',
  crackable: false,
};
const HIDDEN: WifiNetwork = {
  bssid: 'DD:DD:DD:DD:DD:DD',
  essid: '<hidden>',
  power: -60,
  channel: 11,
  encryption: 'WPA2',
  crackable: false,
};
const WIFI: readonly WifiNetwork[] = [CRACKABLE, WPA3, WEAK, HIDDEN];

const wlan0Of = (state: ConnectivityState): WirelessInterface => {
  const iface = state.interfaces.get('wlan0');
  if (iface === undefined || iface.kind !== 'wireless') throw new Error('unreachable');
  return iface;
};

const monitoring = (base: ConnectivityState): ConnectivityState => ({
  interfaces: new Map(base.interfaces).set('wlan0', { ...wlan0Of(base), monitorMode: true }),
});

const aircrackEnv = (
  state: ConnectivityState,
  options: {
    readonly machineId?: ReturnType<typeof asMachineId>;
    readonly sleep?: () => Promise<void>;
    readonly networks?: readonly WifiNetwork[];
  } = {},
): CommandEnv =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({ machineId: options.machineId ?? OWN_MACHINE, playerKey: PUBKEY }),
    network: mockNetworkView({
      interfaces: () => [...state.interfaces.values()],
      wifiNetworks: () => options.networks ?? WIFI,
    }),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });

/** A monitoring env on the player's own box, optionally with a bespoke AP set. */
const monitoringEnv = (networks?: readonly WifiNetwork[]): CommandEnv =>
  aircrackEnv(monitoring(buildColdStartConnectivity(PUBKEY)), networks ? { networks } : {});

const onMachine = (machineId?: ReturnType<typeof asMachineId>) =>
  aircrackEnv(monitoring(buildColdStartConnectivity(PUBKEY)), machineId ? { machineId } : {});

const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly string[]; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

/** Collect lines until the stream rejects (e.g. an aborting sleep), reporting
 *  what was emitted before it stopped. */
const drainUntilReject = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly string[]; readonly rejected: boolean }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: string[] = [];
  try {
    for await (const line of result.lines) lines.push(line.content);
    return { lines, rejected: false };
  } catch {
    return { lines, rejected: true };
  }
};

const syncOf = (result: CommandResult): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('aircrack', () => {
  it('refuses to run off the player’s own workstation', async () => {
    const result = await aircrack.execute(
      onMachine(asMachineId('203.0.113.42')),
      ['AA:AA:AA:AA:AA:AA'],
      NO_FLAGS,
    );
    expect(syncOf(result)).toEqual({
      text: 'aircrack: command not available on this machine',
      exitCode: 1,
    });
    if (result.kind !== 'sync') throw new Error('sync expected');
    expect(result.lines[0]!.kind).toBe('error');
  });

  it('requires monitor mode to be enabled first', async () => {
    const env = aircrackEnv(buildColdStartConnectivity(PUBKEY));
    expect(syncOf(await aircrack.execute(env, ['AA:AA:AA:AA:AA:AA'], NO_FLAGS))).toEqual({
      text: 'aircrack: monitor mode not enabled — run airmon start wlan0 first',
      exitCode: 1,
    });
  });

  it('reports a missing BSSID argument', async () => {
    expect(syncOf(await aircrack.execute(onMachine(), [], NO_FLAGS))).toEqual({
      text: 'aircrack: missing BSSID — usage: aircrack <bssid>',
      exitCode: 1,
    });
  });

  it('reports an unknown BSSID', async () => {
    expect(syncOf(await aircrack.execute(onMachine(), ['99:99:99:99:99:99'], NO_FLAGS))).toEqual({
      text: 'aircrack: BSSID 99:99:99:99:99:99 not found — run airdump to scan for networks',
      exitCode: 1,
    });
  });

  it('cracks a WPA2 AP and reveals its password', async () => {
    const { lines, exitCode } = await drain(
      await aircrack.execute(onMachine(), [CRACKABLE.bssid], NO_FLAGS),
    );
    const joined = lines.join('\n');
    expect(exitCode).toBe(0);
    expect(joined).toContain(`KEY FOUND! [ ${CRACKABLE.password} ]`);
  });

  it('streams the exact crack animation for a crackable AP', async () => {
    // Golden — pins the capture preamble, every wordlist progress line (tested
    // count, elapsed clock, k/s), the blank separator, and the KEY FOUND reveal.
    const { lines } = await drain(await aircrack.execute(onMachine(), [CRACKABLE.bssid], NO_FLAGS));
    expect(lines).toEqual([
      'Opening capture file for ACME-CORP (AA:AA:AA:AA:AA:AA)...',
      'Reading packets from capture file...',
      '[00:00:02] 2390/14344 keys tested (1142 k/s)',
      '[00:00:04] 4780/14344 keys tested (1142 k/s)',
      '[00:00:06] 7170/14344 keys tested (1142 k/s)',
      '[00:00:08] 9560/14344 keys tested (1142 k/s)',
      '[00:00:10] 11950/14344 keys tested (1142 k/s)',
      '[00:00:12] 14340/14344 keys tested (1142 k/s)',
      '',
      '                 KEY FOUND! [ cr4ck3d_w1f1 ]',
    ]);
  });

  it('fails on a WPA3 AP — handshake capture unsupported (exact output)', async () => {
    // Golden — pins the reason line plus the blank separator and the quit line,
    // and proves the crack animation never runs.
    const { lines } = await drain(await aircrack.execute(onMachine(), [WPA3.bssid], NO_FLAGS));
    expect(lines).toEqual([
      `Opening capture file for ${WPA3.essid} (${WPA3.bssid})...`,
      'Reading packets from capture file...',
      `${WPA3.essid} uses WPA3 — handshake capture not supported`,
      '',
      'Quitting aircrack...',
    ]);
  });

  it('emits every crack line as plain text (renderer dispatches on kind)', async () => {
    const result = await aircrack.execute(onMachine(), [CRACKABLE.bssid], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('async expected');
    for await (const line of result.lines) {
      expect(line.kind).toBe('text');
    }
  });

  it('treats exactly -80 dBm as crackable, not weak (boundary)', async () => {
    // The weak gate is `power < -80`, so -80 itself must still crack.
    const boundary: WifiNetwork = { ...CRACKABLE, bssid: 'EE:EE:EE:EE:EE:EE', power: -80 };
    const { lines } = await drain(
      await aircrack.execute(monitoringEnv([boundary]), [boundary.bssid], NO_FLAGS),
    );
    expect(lines.join('\n')).toContain(`KEY FOUND! [ ${boundary.password} ]`);
  });

  it('never fabricates a key for a non-crackable AP that passes every gate', async () => {
    // A WPA2 / strong / visible AP that is nonetheless not crackable runs the
    // full animation but must NOT reveal a key (no password to reveal).
    const stubborn: WifiNetwork = {
      bssid: 'FF:FF:FF:FF:FF:FF',
      essid: 'VISIBLE-NOISE',
      power: -50,
      channel: 9,
      encryption: 'WPA2',
      crackable: false,
    };
    const { lines } = await drain(
      await aircrack.execute(monitoringEnv([stubborn]), [stubborn.bssid], NO_FLAGS),
    );
    expect(lines.join('\n')).not.toContain('KEY FOUND');
  });

  it('fails on a weak-signal AP — no handshake captured', async () => {
    const { lines } = await drain(await aircrack.execute(onMachine(), [WEAK.bssid], NO_FLAGS));
    const joined = lines.join('\n');
    expect(joined).toContain(`Signal too weak (${WEAK.power} dBm) — no handshake captured`);
    expect(joined).not.toContain('KEY FOUND');
  });

  it('fails on a hidden-ESSID AP — no probing clients seen', async () => {
    const { lines } = await drain(await aircrack.execute(onMachine(), [HIDDEN.bssid], NO_FLAGS));
    const joined = lines.join('\n');
    expect(joined).toContain(
      `ESSID hidden for ${HIDDEN.bssid} — no probing clients seen, cannot derive key`,
    );
    expect(joined).not.toContain('KEY FOUND');
  });

  it('stops mid-crack — never revealing the key — when the sleep aborts', async () => {
    let calls = 0;
    const env = aircrackEnv(monitoring(buildColdStartConnectivity(PUBKEY)), {
      sleep: () => {
        calls += 1;
        // Simulate Ctrl-C: the second pace rejects (the signal fired).
        return calls >= 2
          ? Promise.reject(new DOMException('aborted', 'AbortError'))
          : Promise.resolve();
      },
    });
    const { lines, rejected } = await drainUntilReject(
      await aircrack.execute(env, [CRACKABLE.bssid], NO_FLAGS),
    );
    expect(rejected).toBe(true);
    expect(lines.join('\n')).not.toContain('KEY FOUND');
  });

  it('resolves by name through the shell pipeline, past the /usr/bin binary gate', async () => {
    const tree = buildDirectory({
      usr: buildDirectory({
        bin: buildDirectory({
          aircrack: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
        }),
      }),
    });
    const state = monitoring(buildColdStartConnectivity(PUBKEY));
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: PUBKEY }),
      session: mockSession({ machineId: OWN_MACHINE, playerKey: PUBKEY }),
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
      network: mockNetworkView({
        interfaces: () => [...state.interfaces.values()],
        wifiNetworks: () => WIFI,
      }),
    });
    const { runCommandLine } = await import('../shell/runLine');

    const { lines } = await drain(
      await runCommandLine(env, `aircrack ${CRACKABLE.bssid}`, commandRegistry),
    );
    expect(lines.join('\n')).toContain('KEY FOUND!');
  });
});
