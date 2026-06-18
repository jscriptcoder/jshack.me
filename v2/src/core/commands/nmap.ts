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
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { buildRouterBaseFs } from '../generation/routerFs';
import { isPublicIp } from '../generation/ip';
import { parseScanTarget, hostsInScanTarget } from '../network/scanTarget';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { scanResult } from '../scan/scanResult';

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

const padRight = (value: string, length: number): string =>
  value.length >= length ? value : value + ' '.repeat(length - value.length);

const IP_WIDTH = 17;
const HOSTNAME_WIDTH = 18;

const HEADER = [padRight('IP', IP_WIDTH), padRight('HOSTNAME', HOSTNAME_WIDTH), 'KIND'].join('');

const formatRow = (host: LanHost): string =>
  [padRight(host.ip, IP_WIDTH), padRight(host.hostname, HOSTNAME_WIDTH), host.kind].join('');

/** Per-row pause so the host list populates live rather than all at once. */
const SCAN_DELAY_MS = 200;

const PORT_COL = 9;
const STATE_COL = 6;
const PORT_HEADER = [padRight('PORT', PORT_COL), padRight('STATE', STATE_COL), 'SERVICE'].join('');

const formatPortLine = (entry: OpenPort): string =>
  [padRight(`${entry.port}/tcp`, PORT_COL), padRight('open', STATE_COL), entry.service].join('');

/** The PORT/STATE/SERVICE table for a host's open ports, preceded by a blank line —
 *  or nothing at all when the host runs no services. Shared by every host report
 *  (the own-LAN single scan and the cross-player public-IP scan) so the two render
 *  identically and can never drift. */
function* portTableLines(ports: readonly OpenPort[]): Iterable<TerminalLine> {
  if (ports.length === 0) return;
  yield text('');
  yield text(PORT_HEADER);
  for (const port of ports) yield text(formatPortLine(port));
}

async function* scanRange(
  env: CommandEnv,
  rawTarget: string,
  hosts: readonly LanHost[],
): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${rawTarget}`);
  yield text('');
  yield text(HEADER);
  for (const host of hosts) {
    await env.sleep(SCAN_DELAY_MS);
    yield text(formatRow(host));
  }
  yield text('');
  yield text(`Nmap done — ${hosts.length} hosts up`);
}

async function* scanSingle(
  env: CommandEnv,
  rawTarget: string,
  host: LanHost | undefined,
  resolveHostPorts: (host: LanHost) => readonly OpenPort[],
): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${rawTarget}`);
  yield text('');
  await env.sleep(SCAN_DELAY_MS);
  if (host === undefined) {
    yield text('Host seems down.');
    yield text('');
    yield text('Nmap done — 0 hosts up');
    return;
  }
  yield text(`Nmap scan report for ${host.hostname} (${host.ip})`);
  yield text('Host is up.');
  yield* portTableLines(resolveHostPorts(host));
  yield text('');
  yield text('Nmap done — 1 host up');
}

/** A public-IP scan is a CROSS-PLAYER target: it resolves server-side against the
 *  public-IP registry rather than the player's own LAN. The round-trip itself is
 *  the latency, so there is no per-row `env.sleep` pacing here. */
async function* scanPublic(env: CommandEnv, target: string): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${target}`);
  yield text('');
  const { found, ports } = await env.scan.resolvePublic(target);
  if (!found) {
    yield text('Host seems down.');
    yield text('');
    yield text('Nmap done — 0 hosts up');
    return;
  }
  yield text(`Nmap scan report for ${target}`);
  yield text('Host is up.');
  // The resolved ports are the OWNER's real running services (read server-side from
  // their /var/run record) — rendered with the same table as an own-LAN scan.
  yield* portTableLines(ports);
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

  // A public IP is another player's network — resolve it server-side against the
  // public-IP registry instead of scanning our own LAN. Only a single public IP
  // routes here; a range or a private/own-subnet address falls through to the LAN
  // path below (which scans it or reports it out of range).
  if (isPublicIp(rawTarget)) {
    return { kind: 'async', lines: scanPublic(env, rawTarget), exitCode: async () => 0 };
  }

  const essid = wlan0.association.essid;
  const lan = generateHomeLan(env.identity.publicKeyHex, essid);
  const parsed = parseScanTarget(rawTarget, lan.subnet);
  if (!parsed.ok) {
    return error(parsed.reason === 'usage' ? USAGE : outOfRange(rawTarget, lan.subnet));
  }
  const hosts = hostsInScanTarget(lan, parsed.target);

  // Leave a trace: record the scan server-side (the server resolves the touched
  // hosts and writes each one's /var/log/kern.log itself). Fire-and-forget so the
  // real round-trip runs alongside the streamed display rather than delaying it,
  // and so a logging failure — or an unwired seam — never breaks the scan.
  try {
    void env.scan
      .record({ essid, target: rawTarget, sourceIp: wlan0.ipv4 })
      .catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the scan.
  }

  // Per-host open ports. The `.1` gateway is the player's OWN ROUTER — a distinct
  // journal-backed box; its ports come from the single `scanResult` total function
  // at the `sameLAN` vantage (the router's own services only, never the NAT forward
  // table), the same function the public-IP scan uses at `external`. Every other
  // host reads its filesystem directly: the live env.fs for the player's own host
  // (so a runtime `sshd` shows up), the deterministic generated FS for a sibling.
  const selfIp = wlan0.ipv4;
  const resolveHostPorts = (host: LanHost): readonly OpenPort[] => {
    if (host.kind === 'router') {
      return scanResult({
        vantage: 'sameLAN',
        routerFs: buildRouterBaseFs(env.identity.publicKeyHex),
        resolveTargetPorts: () => [],
      });
    }
    const hostFs =
      host.ip === selfIp ? env.fs.root() : buildRemoteHostFs(env.identity.publicKeyHex, essid, host);
    return readOpenPorts(hostFs);
  };

  const lines =
    parsed.target.kind === 'range'
      ? scanRange(env, rawTarget, hosts)
      : scanSingle(env, rawTarget, hosts[0], resolveHostPorts);
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
