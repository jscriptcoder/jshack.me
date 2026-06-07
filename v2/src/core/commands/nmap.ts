/**
 * nmap — host discovery on the connected LAN (generator epic, Story 2).
 *
 * Online on a home network, `nmap <subnet>` streams the hosts on the player's
 * LAN — the gateway at `.1` plus the player's own host (Slice 1; sibling hosts
 * land in Slice 2). Offline it errors and lists nothing. The tool itself is NOT
 * preinstalled: the registry's binary gate reports `command not found` with an
 * `apt install nmap` hint until `/usr/bin/nmap` exists.
 *
 * The streamed-row pacing reuses the abort-aware `env.sleep` seam (airdump
 * family) so the scan feels live and cancels on Ctrl-C.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import { generateHomeLan, type HomeLan } from '../generation/generateHomeLan';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

/** Shown whenever there is no connected LAN to scan — offline, or online with
 *  no associated wlan0 (no ESSID ⇒ no subnet to derive). */
const UNREACHABLE = 'nmap: network is unreachable — connect to a network first';

const padRight = (value: string, length: number): string =>
  value.length >= length ? value : value + ' '.repeat(length - value.length);

const IP_WIDTH = 17;
const HOSTNAME_WIDTH = 18;

const HEADER = [padRight('IP', IP_WIDTH), padRight('HOSTNAME', HOSTNAME_WIDTH), 'KIND'].join('');

const formatRow = (host: HomeLan['hosts'][number]): string =>
  [padRight(host.ip, IP_WIDTH), padRight(host.hostname, HOSTNAME_WIDTH), host.kind].join('');

/** Per-row pause so the host list populates live rather than all at once. */
const SCAN_DELAY_MS = 200;

async function* scan(env: CommandEnv, lan: HomeLan): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${lan.subnet}.0/24`);
  yield text('');
  yield text(HEADER);
  for (const host of lan.hosts) {
    await env.sleep(SCAN_DELAY_MS);
    yield text(formatRow(host));
  }
  yield text('');
  yield text(`Nmap done — ${lan.hosts.length} hosts up`);
}

const execute: Command['execute'] = async (env, args) => {
  if (args.length === 0) {
    return error('nmap: usage: nmap <subnet>');
  }
  if (!env.network.isOnline()) {
    return error(UNREACHABLE);
  }

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless' || wlan0.association === null) {
    return error(UNREACHABLE);
  }

  const lan = generateHomeLan(env.identity.publicKeyHex, wlan0.association.essid);
  return { kind: 'async', lines: scan(env, lan), exitCode: async () => 0 };
};

export const nmap: Command = {
  name: 'nmap',
  description: 'Discover hosts on a network',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'nmap' },
  manual: {
    synopsis: 'nmap <subnet>',
    description:
      'Network exploration tool. Performs host discovery on the given subnet, listing the hosts that are up with their IP, hostname, and kind. Requires a network connection; install with "apt install nmap".',
    arguments: [{ name: 'subnet', description: 'The subnet to scan, e.g. 192.168.1.0/24', required: true }],
    examples: [{ command: 'nmap 192.168.1.0/24', description: 'Discover hosts on the LAN' }],
  },
  execute,
};
