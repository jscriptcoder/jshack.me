/**
 * `scanResult` — the ONE total function that decides what ports a router exposes
 * from a given vantage (Story 5.1). It feeds BOTH scan paths so they can never
 * drift: the public-IP scan (`vantage: 'external'`) and the inside-the-LAN scan
 * of the router's `.1` (`vantage: 'sameLAN'`). It is NOT a merged view — each
 * vantage is its own answer (the dual-homed router scar lives in exactly one
 * place: the `vantage` branch below).
 *
 * The router's `/etc/iptables/rules.v4` is the single source of truth for NAT
 * forwards: `scanResult` parses it off the live router FS, never a separate
 * table. A forward is only shown when its target host is actually serving the
 * internal port — `resolveTargetPorts` is injected so `core/` stays free of any
 * machine-materialization wiring (the server supplies the real lookup; tests
 * supply a stub).
 *
 * BOTH vantages are somebody else's box seen from the network, so both read the
 * box's OWN ports through `portsOpenToNetwork` rather than the pidfiles. A scan
 * that still listed a filtered port would leave "filtered" as the one dark state
 * a stranger could pick out — an address bearing no network, a bricked box, a
 * stopped daemon and a denied port have to read alike, or the defence points at
 * the port worth attacking. The owner's own view is elsewhere and unaffected: it
 * reads the pidfiles directly, which is what makes a filter beat `systemctl stop`.
 *
 * The filter is applied to the box's OWN ports and NOT to the forwards below.
 * An INPUT rule governs traffic the box terminates, never traffic it passes
 * through, so closing the gateway's own door cannot close one an occupant opened
 * onto their workstation — the same line the cross-player reach draws.
 */

import type { Directory } from '../filesystem/types';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { portsOpenToNetwork } from '../network/portsOpenToNetwork';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules';

/** Where the scan is performed FROM. `sameLAN` = a host on the router's own LAN
 *  scanning its `.1` interface (own services only); `external` = the public IP
 *  (own services PLUS live forwards). Never a union of the two. */
export type ScanVantage = 'sameLAN' | 'external';

export type ScanResultArgs = {
  readonly vantage: ScanVantage;
  readonly routerFs: Directory;
  /** The open ports of the host an internal forward targets — used to keep a
   *  forward only while its target port is actually up. */
  readonly resolveTargetPorts: (internalIp: string) => readonly OpenPort[];
  /** The day the scan stands on, when the caller wants vulnerabilities reported.
   *  Absent for callers asking only what is open. */
  readonly gameDay?: number | undefined;
};

/** Drop later entries that repeat an already-seen port (own ports win). */
const dedupeByPort = (ports: readonly OpenPort[]): readonly OpenPort[] =>
  ports.reduce<readonly OpenPort[]>(
    (kept, port) => (kept.some((seen) => seen.port === port.port) ? kept : [...kept, port]),
    [],
  );

export const scanResult = ({
  vantage,
  routerFs,
  resolveTargetPorts,
  gameDay,
}: ScanResultArgs): readonly OpenPort[] => {
  const own = portsOpenToNetwork(routerFs, { gameDay });
  if (vantage === 'sameLAN') return own;

  // What the box RUNS, not what it answers — the two differ under a filter, and only
  // the first decides precedence. A port the router serves is the router's whether or
  // not its own filter lets it reply, so a forward mapped there stays shadowed and the
  // port goes dark rather than re-opening through somebody else's rule.
  const serving = readOpenPorts(routerFs);
  const forwarded = parseForwardRules(readRulesV4(routerFs)).flatMap((forward) => {
    if (serving.some((openPort) => openPort.port === forward.publicPort)) return [];
    const live = resolveTargetPorts(forward.internalIp).find(
      (openPort) => openPort.port === forward.internalPort,
    );
    // The TARGET's port, re-addressed — everything the box behind the forward says
    // about itself (its service, and the version a CVE would be keyed on), reached at
    // the public port instead of its internal one. A forward is a door onto somebody
    // else's software, so describing it with the router's own facts would name a box
    // the traffic never arrives at.
    return live === undefined ? [] : [{ ...live, port: forward.publicPort }];
  });

  return dedupeByPort([...own, ...forwarded]);
};
