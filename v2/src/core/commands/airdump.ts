/**
 * airdump — scan for nearby wireless networks (monitor mode required).
 *
 * Ported from legacy `airdump`, adapted to v2's streaming `CommandResult` and
 * the abort-aware `env.sleep` pacing seam. With `wlan0` in monitor mode it
 * streams the in-range APs as an airodump-ng-style table, one row at a time, so
 * the scan feels live. It reads the seeded AP list off `env.network`.
 *
 * Two hard rules: it runs only on the player's own workstation, and it NEVER
 * prints a password — even though crackable APs carry one in the runtime model.
 * Revealing a key is `aircrack`'s job alone.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import type { WifiNetwork } from '../network/wifi';
import { isOwnWorkstation } from '../identity/workstation';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const padRight = (value: string, length: number): string =>
  value.length >= length ? value : value + ' '.repeat(length - value.length);

const padLeft = (value: string, length: number): string =>
  value.length >= length ? value : ' '.repeat(length - value.length) + value;

const BSSID_WIDTH = 20;
const PWR_WIDTH = 4;
const CH_WIDTH = 4;
const ENC_WIDTH = 6;

const HEADER = [
  padRight('BSSID', BSSID_WIDTH),
  padLeft('PWR', PWR_WIDTH),
  padLeft('CH', CH_WIDTH),
  padRight('ENC', ENC_WIDTH),
  'ESSID',
].join('  ');

/** One table row. Deliberately reads only the public columns — never `password`. */
const formatRow = (network: WifiNetwork): string =>
  [
    padRight(network.bssid, BSSID_WIDTH),
    padLeft(String(network.power), PWR_WIDTH),
    padLeft(String(network.channel), CH_WIDTH),
    padRight(network.encryption, ENC_WIDTH),
    network.essid,
  ].join('  ');

/** Per-row pause so the table populates live rather than all at once. */
const SCAN_DELAY_MS = 250;

async function* scan(env: CommandEnv, networks: readonly WifiNetwork[]): AsyncIterable<TerminalLine> {
  yield text(' CH  0 ][ Elapsed: 0 s ][ scanning...');
  yield text('');
  yield text(HEADER);
  yield text('');
  for (const network of networks) {
    await env.sleep(SCAN_DELAY_MS);
    yield text(formatRow(network));
  }
  yield text('');
  yield text(`Scan complete — ${networks.length} networks found`);
}

const execute: Command['execute'] = async (env) => {
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return error('airdump: command not available on this machine');
  }

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless' || !wlan0.monitorMode) {
    return error('airdump: monitor mode not enabled — run airmon start wlan0 first');
  }

  const networks = env.network.wifiNetworks();
  return { kind: 'async', lines: scan(env, networks), exitCode: async () => 0 };
};

export const airdump: Command = {
  name: 'airdump',
  description: 'Scan for nearby wireless networks',
  category: 'wifi',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'airdump',
    description:
      'Capture and display nearby wireless access points with signal strength, channel, and encryption. Requires monitor mode — run "airmon start wlan0" first.',
    examples: [{ command: 'airdump', description: 'Scan for WiFi networks' }],
  },
  execute,
};
