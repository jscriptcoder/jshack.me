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
import { buildApGatewayBaseFs } from '../generation/routerFs';
import { isPublicIp } from '../generation/ip';
import { parseScanTarget, hostsInScanTarget } from '../network/scanTarget';
import { mergeLanOccupants } from '../network/mergeLanOccupants';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { scanResult } from '../scan/scanResult';
import { resolveDeepScanHosts } from '../scan/deepScanHosts';
import {
  isInnerGateway,
  pivotVantageForMachineId,
  type PivotVantage,
} from '../generation/lanHostIdentity';

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

/** An inner gateway is scanned from its UPSTREAM side, so its ports — its own
 *  service PLUS any live NAT forward to the deeper layer behind it — resolve
 *  SERVER-side at the `external` vantage: the forward lives on the gateway's journal,
 *  not the client's static world, so (unlike the edge `.1` or a sibling) it can't be
 *  read locally. Mirrors `scanPublic` (the round-trip IS the latency), but renders the
 *  host's known name + IP. */
async function* scanInnerGateway(
  env: CommandEnv,
  essid: string,
  host: LanHost,
): AsyncIterable<TerminalLine> {
  yield text(`Starting Nmap scan — ${host.ip}`);
  yield text('');
  const { found, ports } = await env.scan.resolveInnerGateway(essid, host.ip);
  if (!found) {
    yield text('Host seems down.');
    yield text('');
    yield text('Nmap done — 0 hosts up');
    return;
  }
  yield text(`Nmap scan report for ${host.hostname} (${host.ip})`);
  yield text('Host is up.');
  yield* portTableLines(ports);
  yield text('');
  yield text('Nmap done — 1 host up');
}

/** Scan the deep `/24` BEHIND the gateway the active shell is standing on — the
 *  reachability pivot. Returns the scan when the target falls inside the deep subnet,
 *  or null when it doesn't (a home/foreign target falls through to the home path, so
 *  the upstream segment stays visible from the gateway too). The deep hosts + their
 *  post-ACL ports resolve CLIENT-side through the SHARED `resolveDeepScanHosts` — the
 *  same resolution the server trace uses, so the scan display and its kern.log trace
 *  can never drift. A fire-and-forget `recordDeep` leaves that trace on each touched
 *  deep host. */
const resolveDeepPivotScan = (
  env: CommandEnv,
  essid: string,
  rawTarget: string,
  vantage: PivotVantage,
): CommandResult | null => {
  const resolution = resolveDeepScanHosts(
    env.identity.publicKeyHex,
    essid,
    vantage,
    env.fs.root(),
  );
  const parsed = parseScanTarget(rawTarget, resolution.subnet);
  if (!parsed.ok) {
    return null;
  }
  // Leave a deep-layer trace: record the pivot scan server-side (the server resolves
  // the touched deep hosts and writes each one's kern.log itself). Fire-and-forget so
  // the round-trip never delays the client-resolved scan, and a failure — or an
  // unwired seam — never breaks it.
  try {
    void env.scan
      .recordDeep({ essid, target: rawTarget, vantageMachineId: vantage.machineId })
      .catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the scan.
  }
  // Ports come straight off the shared resolution (keyed by IP), so the rendered ports
  // match the kern.log trace the server writes from the same resolver. The `?? []` is
  // unreachable — `scanSingle` only asks for a host it was handed, and every such host
  // is in the map — it just satisfies the total resolver type (a host-down scan renders
  // without ever reading ports).
  const deepLan = { subnet: resolution.subnet, hosts: resolution.hosts.map((entry) => entry.host) };
  const hosts = hostsInScanTarget(deepLan, parsed.target);
  const portsByIp = new Map(resolution.hosts.map((entry) => [entry.host.ip, entry.ports]));
  const resolveHostPorts = (host: LanHost): readonly OpenPort[] => portsByIp.get(host.ip) ?? [];
  const lines =
    parsed.target.kind === 'range'
      ? scanRange(env, rawTarget, hosts)
      : scanSingle(env, rawTarget, hosts[0], resolveHostPorts);
  return { kind: 'async', lines, exitCode: async () => 0 };
};

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

  // Reachability pivot: when the active shell sits on a gateway that fronts a deep
  // layer — an inner gateway on the home LAN, or a deep child gateway one hop down —
  // that gateway's downstream deep `/24` is directly scannable from here. A deep-subnet
  // target routes to the pivot scan; anything else falls through to the home path below
  // — so the upstream segment stays visible from the gateway too.
  const pivotVantage = pivotVantageForMachineId(
    env.identity.publicKeyHex,
    essid,
    env.session.machineId,
  );
  if (pivotVantage !== null) {
    const pivotScan = resolveDeepPivotScan(env, essid, rawTarget, pivotVantage);
    if (pivotScan !== null) {
      return pivotScan;
    }
  }

  const baseLan = generateHomeLan(env.identity.publicKeyHex, essid);
  const parsed = parseScanTarget(rawTarget, baseLan.subnet);
  if (!parsed.ok) {
    return error(parsed.reason === 'usage' ? USAGE : outOfRange(rawTarget, baseLan.subnet));
  }

  // Merge the ESSID's other live occupants over the generated NPC siblings, so a real
  // player on this LAN shows up as a host. The server already excludes the caller and
  // gates on the caller's own occupancy; the seam degrades to [] (server down / not an
  // occupant), leaving the own-LAN view untouched. On an octet collision the occupant
  // wins.
  const occupants = await env.scan.resolveOccupants(essid);
  const lan = mergeLanOccupants(baseLan, occupants);
  const occupantIps = new Set(occupants.map((occupant) => occupant.localIp));
  const hosts = hostsInScanTarget(lan, parsed.target);

  // Leave a trace: record the scan server-side (the server resolves the touched
  // hosts and writes each one's /var/log/kern.log itself). Fire-and-forget so the
  // real round-trip runs alongside the streamed display rather than delaying it,
  // and so a logging failure — or an unwired seam — never breaks the scan.
  try {
    void env.scan.record({ essid, target: rawTarget, sourceIp: wlan0.ipv4 }).catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the scan.
  }

  // A single-IP scan of an inner gateway resolves SERVER-side at the external
  // vantage — its journal-held NAT forward to the deeper layer can't be read from the
  // client's static world. Only a single IP routes here; a range still just lists the
  // host (no port table), and the edge `.1`/siblings stay the client-side path below.
  const single = parsed.target.kind === 'single' ? hosts[0] : undefined;
  if (single !== undefined && isInnerGateway(single)) {
    return { kind: 'async', lines: scanInnerGateway(env, essid, single), exitCode: async () => 0 };
  }

  // Per-host open ports. The `.1` gateway is the ACCESS POINT's gateway — a distinct
  // journal-backed box shared by every occupant; its ports come from the single
  // `scanResult` total function at the `sameLAN` vantage (the gateway's own services
  // only, never the NAT forward table), the same function the public-IP scan uses at
  // `external`. Every other
  // host reads its filesystem directly: the live env.fs for the player's own host
  // (so a runtime `sshd` shows up), the deterministic generated FS for a sibling.
  const selfIp = wlan0.ipv4;
  const resolveHostPorts = (host: LanHost): readonly OpenPort[] => {
    if (host.kind === 'router') {
      return scanResult({
        vantage: 'sameLAN',
        routerFs: buildApGatewayBaseFs(essid),
        resolveTargetPorts: () => [],
      });
    }
    // A real occupant's services live on THEIR box and can't be derived from our seed —
    // `buildRemoteHostFs` keys on the host IP alone, so letting an occupant fall through
    // would FABRICATE the NPC ports that octet would have rolled. Report the host up with
    // no ports; real LAN-port resolution is deferred to the same-LAN connect path.
    if (occupantIps.has(host.ip)) {
      return [];
    }
    const hostFs =
      host.ip === selfIp
        ? env.fs.root()
        : buildRemoteHostFs(env.identity.publicKeyHex, essid, host);
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
