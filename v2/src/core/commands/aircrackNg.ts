/**
 * aircrack-ng — recover a WPA2 key by wordlist attack (monitor mode required).
 *
 * Ported from legacy `aircrack-ng`, adapted to v2's streaming `CommandResult` and
 * the abort-aware `env.sleep` pacing seam. Preconditions (own workstation,
 * monitor mode, a known BSSID) fail fast as sync errors. Once a target resolves
 * it streams a dramatic crack: opening the capture, reading packets, then one
 * of four outcomes derived from the AP's observable state —
 *   - WPA3            → handshake capture unsupported
 *   - power < -80 dBm → signal too weak, no handshake
 *   - hidden ESSID    → no probing clients, can't derive the PSK
 *   - otherwise       → the wordlist animation ending in `KEY FOUND!`
 *
 * The `crackable: true` union variant guarantees a `password`, so the success
 * path reads it with no defensive guard. Pacing is via `env.sleep`, which
 * rejects when the run's signal aborts (Ctrl-C) — the rejection propagates out
 * of the stream and `runInput` stops it, so the key is never reached.
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

const WEAK_SIGNAL_DBM = -80;
const TOTAL_KEYS = 14344;
const KEYS_PER_SECOND = 1142;
const CRACK_STEPS = 6;
const STEP_DELAY_MS = 200;

/** The three failure reasons, derived from observable AP state. Returns the
 *  diagnostic line, or null when the AP is actually crackable. */
const failureReason = (network: WifiNetwork): string | null => {
  if (network.encryption === 'WPA3') {
    return `${network.essid} uses WPA3 — handshake capture not supported`;
  }
  if (network.power < WEAK_SIGNAL_DBM) {
    return `Signal too weak (${network.power} dBm) — no handshake captured`;
  }
  if (network.essid === '<hidden>') {
    return `ESSID hidden for ${network.bssid} — no probing clients seen, cannot derive key`;
  }
  return null;
};

async function* crack(env: CommandEnv, network: WifiNetwork): AsyncIterable<TerminalLine> {
  yield text(`Opening capture file for ${network.essid} (${network.bssid})...`);
  await env.sleep(STEP_DELAY_MS);
  yield text('Reading packets from capture file...');
  await env.sleep(STEP_DELAY_MS);

  const reason = failureReason(network);
  if (reason !== null) {
    yield text(reason);
    yield text('');
    yield text('Quitting aircrack-ng...');
    return;
  }

  const keysPerStep = Math.floor(TOTAL_KEYS / CRACK_STEPS);
  for (let step = 1; step <= CRACK_STEPS; step++) {
    await env.sleep(STEP_DELAY_MS);
    const tested = Math.min(step * keysPerStep, TOTAL_KEYS);
    const elapsed = String(step * 2).padStart(2, '0');
    yield text(`[00:00:${elapsed}] ${tested}/${TOTAL_KEYS} keys tested (${KEYS_PER_SECOND} k/s)`);
  }

  await env.sleep(STEP_DELAY_MS);
  yield text('');
  // `crackable: true` ⟹ `password` (union invariant) — safe to read directly.
  if (network.crackable) {
    yield text(`                 KEY FOUND! [ ${network.password} ]`);
  }
}

const execute: Command['execute'] = async (env, args) => {
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return error('aircrack-ng: command not available on this machine');
  }

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless' || !wlan0.monitorMode) {
    return error('aircrack-ng: monitor mode not enabled — run airmon-ng start wlan0 first');
  }

  const [bssid] = args;
  if (bssid === undefined) {
    return error('aircrack-ng: missing BSSID — usage: aircrack-ng <bssid>');
  }

  const network = env.network.wifiNetworks().find((candidate) => candidate.bssid === bssid);
  if (network === undefined) {
    return error(`aircrack-ng: BSSID ${bssid} not found — run airodump-ng to scan for networks`);
  }

  return { kind: 'async', lines: crack(env, network), exitCode: async () => 0 };
};

export const aircrackNg: Command = {
  name: 'aircrack-ng',
  description: 'Crack WPA/WPA2 wireless network keys',
  category: 'wifi',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'aircrack-ng <bssid>',
    description:
      'Attempt to recover the WPA/WPA2 key for a target network with a wordlist attack. Find the BSSID with airodump-ng. Requires monitor mode — run "airmon-ng start wlan0" first.',
    arguments: [
      { name: 'bssid', description: 'Target network BSSID (from airodump-ng)', required: true },
    ],
    examples: [{ command: 'aircrack-ng AA:BB:CC:DD:EE:FF', description: 'Crack the target network' }],
  },
  execute,
};
