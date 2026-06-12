/**
 * nmap — host discovery on the connected LAN (generator epic, Story 2).
 *
 * Online on a home network, `nmap <target>` scans the player's LAN. The target
 * matches the legacy interface (`feedback_v2_match_legacy_command_interface`):
 * either a single IP (`x.y.z.w`) or a host range (`x.y.z.A-B`). A range streams
 * the discovery table for the hosts whose last octet falls inside it; a single
 * IP reports whether that one host is up. Offline it errors and lists nothing.
 * The tool itself is NOT preinstalled: the registry's binary gate reports
 * `command not found` with an `apt install nmap` hint until `/usr/bin/nmap` exists.
 *
 * Only the player's own subnet is scannable — a target on a different subnet is
 * out of range (foreign-subnet scanning is deferred to the multi-layer story).
 *
 * The streamed-row pacing reuses the abort-aware `env.sleep` seam (airdump
 * family) so the scan feels live and cancels on Ctrl-C.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import type { Directory } from '../filesystem/types';
import { generateHomeLan, type HomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts, type OpenPort } from '../services/pidfile';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

/** Shown whenever there is no connected LAN to scan — offline, or online with
 *  no associated wlan0 (no ESSID ⇒ no subnet to derive). */
const UNREACHABLE = 'nmap: network is unreachable — connect to a network first';

const USAGE = 'nmap: usage: nmap <target> (e.g. 192.168.1.5 or 192.168.1.1-254)';

/** A target on a subnet other than the player's own LAN. */
const outOfRange = (target: string, subnet: string): string =>
  `nmap: ${target}: out of range — you can only scan your own network (${subnet}.0/24)`;

/** Highest scannable host octet (.255 is the broadcast address). */
const MAX_OCTET = 254;

type ScanTarget =
  | { readonly kind: 'single'; readonly octet: number }
  | { readonly kind: 'range'; readonly start: number; readonly end: number };

type ParseResult =
  | { readonly ok: true; readonly target: ScanTarget }
  | { readonly ok: false; readonly reason: 'usage' | 'foreign' };

const RANGE_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/;
const SINGLE_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/;

const parseTarget = (target: string, subnet: string): ParseResult => {
  const rangeMatch = target.match(RANGE_PATTERN);
  if (rangeMatch) {
    const [, base, startStr, endStr] = rangeMatch;
    const start = Number(startStr);
    const end = Number(endStr);
    // A start above MAX_OCTET needs no separate check: it always implies either
    // end > MAX_OCTET (when end >= start) or an inverted range (start > end).
    if (end > MAX_OCTET || start > end) {
      return { ok: false, reason: 'usage' };
    }
    if (base !== subnet) {
      return { ok: false, reason: 'foreign' };
    }
    return { ok: true, target: { kind: 'range', start, end } };
  }

  const singleMatch = target.match(SINGLE_PATTERN);
  if (singleMatch) {
    const [, base, octetStr] = singleMatch;
    const octet = Number(octetStr);
    if (octet > MAX_OCTET) {
      return { ok: false, reason: 'usage' };
    }
    if (base !== subnet) {
      return { ok: false, reason: 'foreign' };
    }
    return { ok: true, target: { kind: 'single', octet } };
  }

  return { ok: false, reason: 'usage' };
};

const padRight = (value: string, length: number): string =>
  value.length >= length ? value : value + ' '.repeat(length - value.length);

const IP_WIDTH = 17;
const HOSTNAME_WIDTH = 18;

const HEADER = [padRight('IP', IP_WIDTH), padRight('HOSTNAME', HOSTNAME_WIDTH), 'KIND'].join('');

const formatRow = (host: HomeLan['hosts'][number]): string =>
  [padRight(host.ip, IP_WIDTH), padRight(host.hostname, HOSTNAME_WIDTH), host.kind].join('');

const lastOctet = (host: HomeLan['hosts'][number]): number => Number(host.ip.split('.')[3]);

/** Per-row pause so the host list populates live rather than all at once. */
const SCAN_DELAY_MS = 200;

const PORT_COL = 9;
const STATE_COL = 6;
const PORT_HEADER = [padRight('PORT', PORT_COL), padRight('STATE', STATE_COL), 'SERVICE'].join('');

const formatPortLine = (entry: OpenPort): string =>
  [padRight(`${entry.port}/tcp`, PORT_COL), padRight('open', STATE_COL), entry.service].join('');

async function* scanRange(
  env: CommandEnv,
  lan: HomeLan,
  rawTarget: string,
  start: number,
  end: number,
): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${rawTarget}`);
  yield text('');
  yield text(HEADER);
  const hosts = lan.hosts.filter((host) => lastOctet(host) >= start && lastOctet(host) <= end);
  for (const host of hosts) {
    await env.sleep(SCAN_DELAY_MS);
    yield text(formatRow(host));
  }
  yield text('');
  yield text(`Nmap done — ${hosts.length} hosts up`);
}

async function* scanSingle(
  env: CommandEnv,
  lan: HomeLan,
  rawTarget: string,
  octet: number,
  resolveHostFs: (host: HomeLan['hosts'][number]) => Directory,
): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${rawTarget}`);
  yield text('');
  await env.sleep(SCAN_DELAY_MS);
  const host = lan.hosts.find((candidate) => lastOctet(candidate) === octet);
  if (host === undefined) {
    yield text('Host seems down.');
    yield text('');
    yield text('Nmap done — 0 hosts up');
    return;
  }
  yield text(`Nmap scan report for ${host.hostname} (${host.ip})`);
  yield text('Host is up.');
  // Ports come from the host's filesystem: the live env.fs for the player's own
  // host, the deterministic generated FS for any other host.
  const ports = readOpenPorts(resolveHostFs(host));
  if (ports.length > 0) {
    yield text('');
    yield text(PORT_HEADER);
    for (const port of ports) yield text(formatPortLine(port));
  }
  yield text('');
  yield text('Nmap done — 1 host up');
}

const execute: Command['execute'] = async (env, args) => {
  const rawTarget = args[0];
  if (rawTarget === undefined) {
    return error(USAGE);
  }
  if (!env.network.isOnline()) {
    return error(UNREACHABLE);
  }

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless' || wlan0.association === null) {
    return error(UNREACHABLE);
  }

  const essid = wlan0.association.essid;
  const lan = generateHomeLan(env.identity.publicKeyHex, essid);
  const parsed = parseTarget(rawTarget, lan.subnet);
  if (!parsed.ok) {
    return error(parsed.reason === 'usage' ? USAGE : outOfRange(rawTarget, lan.subnet));
  }

  // The player's own host reads its LIVE filesystem (so a runtime `sshd` shows
  // up); every other host reads its deterministic generated FS.
  const selfIp = wlan0.ipv4;
  const resolveHostFs = (host: HomeLan['hosts'][number]): Directory =>
    host.ip === selfIp
      ? env.fs.root()
      : buildRemoteHostFs(env.identity.publicKeyHex, essid, host);

  const lines =
    parsed.target.kind === 'range'
      ? scanRange(env, lan, rawTarget, parsed.target.start, parsed.target.end)
      : scanSingle(env, lan, rawTarget, parsed.target.octet, resolveHostFs);
  return { kind: 'async', lines, exitCode: async () => 0 };
};

export const nmap: Command = {
  name: 'nmap',
  description: 'Discover hosts on a network',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'nmap' },
  manual: {
    synopsis: 'nmap <target>',
    description:
      'Network exploration tool. Discovers hosts on your network, listing the ones that are up with their IP, hostname, and kind. Scan a single host (e.g. "192.168.1.5") or a range of hosts (e.g. "192.168.1.1-254"). Only your own network is reachable. Requires a network connection; install with "apt install nmap".',
    arguments: [
      {
        name: 'target',
        description: 'An IP address or range to scan, e.g. 192.168.1.5 or 192.168.1.1-254',
        required: true,
      },
    ],
    examples: [
      { command: 'nmap 192.168.1.5', description: 'Scan a single host' },
      { command: 'nmap 192.168.1.1-254', description: 'Discover hosts in an IP range' },
    ],
  },
  execute,
};
