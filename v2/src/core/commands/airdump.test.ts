import { describe, expect, it, vi } from 'vitest';
import { asMachineId, asPlayerKeyHex } from '../types';
import { computeWorkstationId } from '../identity/workstation';
import {
  buildColdStartConnectivity,
  isOnline,
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
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import type { CommandEnv, CommandResult } from './types';
import { commandRegistry } from './registry';
import { airdump } from './airdump';

/**
 * `airdump` is the player's WiFi scan: with monitor mode on, it streams the
 * access points in range as an airodump-style table. Two non-negotiables — it
 * requires the player's own workstation + monitor mode, and it NEVER prints a
 * password (even though the runtime AP objects carry one for crackable APs).
 * `aircrack` is the only command that reveals a key.
 *
 * Tests inject the env's instant `sleep`, so the streamed output collects with
 * no real waiting.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const OWN_MACHINE = asMachineId(computeWorkstationId('workstation', 'a'.repeat(64)));
// A FIXED scan list — airdump's job is to RENDER whatever APs are in range, so the
// table golden pins the rendering (columns, padding, ordering, password redaction)
// independent of the generator's seeding. Includes both crackable APs (carrying a
// password that must never be printed), a hidden AP, and a WPA3 noise AP.
const WIFI: readonly WifiNetwork[] = [
  {
    bssid: '4F:4E:1F:ED:04:0B',
    essid: 'STARK-WIFI',
    power: -42,
    channel: 6,
    encryption: 'WPA2',
    crackable: true,
    password: 'sunshine2024',
  },
  {
    bssid: '7E:0B:70:69:91:BE',
    essid: '<hidden>',
    power: -71,
    channel: 1,
    encryption: 'WPA2',
    crackable: false,
  },
  {
    bssid: '63:58:F4:ED:85:EA',
    essid: 'ATT-WIFI-9F2A',
    power: -66,
    channel: 11,
    encryption: 'WPA3',
    crackable: false,
  },
  {
    bssid: 'AE:89:6D:78:E7:DB',
    essid: 'BEAN-THERE-WIFI',
    power: -54,
    channel: 3,
    encryption: 'WPA2',
    crackable: true,
    password: 'hunter2pass',
  },
];

const wlan0Of = (state: ConnectivityState): WirelessInterface => {
  const iface = state.interfaces.get('wlan0');
  if (iface === undefined || iface.kind !== 'wireless') throw new Error('unreachable');
  return iface;
};

const monitoring = (base: ConnectivityState): ConnectivityState => ({
  interfaces: new Map(base.interfaces).set('wlan0', { ...wlan0Of(base), monitorMode: true }),
});

const airdumpEnv = (
  state: ConnectivityState,
  options: {
    readonly machineId?: ReturnType<typeof asMachineId>;
    readonly sleep?: () => Promise<void>;
  } = {},
): CommandEnv =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({ machineId: options.machineId ?? OWN_MACHINE, playerKey: PUBKEY }),
    network: mockNetworkView({
      interfaces: () => [...state.interfaces.values()],
      isOnline: () => isOnline(state),
      // airdump re-rolls the scan each run; the fixed list stands in for the roll.
      rescanWifi: () => WIFI,
    }),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });

const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly string[]; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

const syncOf = (result: CommandResult): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('airdump', () => {
  it('refuses to run off the player’s own workstation', async () => {
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)), {
      machineId: asMachineId('203.0.113.42'),
    });
    const result = await airdump.execute(env, [], NO_FLAGS);
    expect(syncOf(result)).toEqual({
      text: 'airdump: command not available on this machine',
      exitCode: 1,
    });
    if (result.kind !== 'sync') throw new Error('sync expected');
    expect(result.lines[0]!.kind).toBe('error');
  });

  it('requires monitor mode to be enabled first', async () => {
    const env = airdumpEnv(buildColdStartConnectivity(PUBKEY));
    const result = await airdump.execute(env, [], NO_FLAGS);
    expect(syncOf(result)).toEqual({
      text: 'airdump: monitor mode not enabled — run airmon start wlan0 first',
      exitCode: 1,
    });
  });

  it('fetches the currently-occupied ESSIDs and re-rolls the scan with them', async () => {
    // The organic-discovery wiring: airdump asks the server which ESSIDs are
    // occupied (name-only) and feeds them into a fresh roll, so a live network can
    // surface in the scan. aircrack/nmcli then read that same refreshed list.
    const occupied = ['STARK-WIFI', 'NAKATOMI-PLAZA'];
    const resolveOccupiedEssids = vi.fn(async () => occupied);
    const rescanWifi = vi.fn(() => WIFI);
    const state = monitoring(buildColdStartConnectivity(PUBKEY));
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: PUBKEY }),
      session: mockSession({ machineId: OWN_MACHINE, playerKey: PUBKEY }),
      network: mockNetworkView({
        interfaces: () => [...state.interfaces.values()],
        isOnline: () => isOnline(state),
        rescanWifi,
      }),
      scan: mockScanApi({ resolveOccupiedEssids }),
    });

    await drain(await airdump.execute(env, [], NO_FLAGS));

    expect(resolveOccupiedEssids).toHaveBeenCalled();
    expect(rescanWifi).toHaveBeenCalledWith(occupied);
  });

  it('streams every access point as a row with BSSID, power, channel, encryption and ESSID', async () => {
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)));
    const { lines, exitCode } = await drain(await airdump.execute(env, [], NO_FLAGS));
    const joined = lines.join('\n');

    expect(exitCode).toBe(0);
    for (const network of WIFI) {
      const row = lines.find((line) => line.includes(network.bssid));
      expect(row).toBeDefined();
      expect(row).toContain(String(network.power));
      expect(row).toContain(String(network.channel));
      expect(row).toContain(network.encryption);
      expect(row).toContain(network.essid);
    }
    expect(joined).toContain(`Scan complete — ${WIFI.length} networks found`);
  });

  it('streams the exact airodump-style table for a scan', async () => {
    // Golden snapshot for the fixed WIFI list — pins the scan banner, the column
    // header, the per-row padding/spacing, the blank separators, and the summary
    // tail. Independent of the generator: airdump renders whatever is in range.
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)));
    const { lines } = await drain(await airdump.execute(env, [], NO_FLAGS));
    expect(lines).toEqual([
      ' CH  0 ][ Elapsed: 0 s ][ scanning...',
      '',
      'BSSID                  PWR    CH  ENC     ESSID',
      '',
      '4F:4E:1F:ED:04:0B      -42     6  WPA2    STARK-WIFI',
      '7E:0B:70:69:91:BE      -71     1  WPA2    <hidden>',
      '63:58:F4:ED:85:EA      -66    11  WPA3    ATT-WIFI-9F2A',
      'AE:89:6D:78:E7:DB      -54     3  WPA2    BEAN-THERE-WIFI',
      '',
      'Scan complete — 4 networks found',
    ]);
  });

  it('prints a header row labelling the columns', async () => {
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)));
    const { lines } = await drain(await airdump.execute(env, [], NO_FLAGS));
    const header = lines.find((line) => line.includes('BSSID') && line.includes('ESSID'));
    expect(header).toBeDefined();
    expect(header).toContain('PWR');
    expect(header).toContain('CH');
    expect(header).toContain('ENC');
  });

  it('emits every scan line as plain text (renderer dispatches on kind)', async () => {
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)));
    const result = await airdump.execute(env, [], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('async expected');
    for await (const line of result.lines) {
      expect(line.kind).toBe('text');
    }
  });

  it('never prints a crackable AP’s password', async () => {
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)));
    const { lines } = await drain(await airdump.execute(env, [], NO_FLAGS));
    const joined = lines.join('\n');

    const crackablePasswords = WIFI.filter((network) => network.crackable).map(
      (network) => network.password,
    );
    expect(crackablePasswords.length).toBeGreaterThan(0);
    for (const password of crackablePasswords) {
      expect(joined).not.toContain(password);
    }
  });

  it('paces the scan through the env.sleep seam', async () => {
    let sleeps = 0;
    const env = airdumpEnv(monitoring(buildColdStartConnectivity(PUBKEY)), {
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    });
    await drain(await airdump.execute(env, [], NO_FLAGS));
    // One pause per access-point row.
    expect(sleeps).toBe(WIFI.length);
  });

  it('resolves by name through the shell pipeline, past the /usr/bin binary gate', async () => {
    const tree = buildDirectory({
      usr: buildDirectory({
        bin: buildDirectory({
          airdump: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
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
        rescanWifi: () => WIFI,
      }),
    });
    const { runCommandLine } = await import('../shell/runLine');

    const { lines } = await drain(await runCommandLine(env, 'airdump', commandRegistry));
    expect(lines.join('\n')).toContain('Scan complete');
  });
});
