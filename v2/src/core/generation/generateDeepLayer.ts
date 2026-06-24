/**
 * generateDeepLayer — the deeper-layer counterpart of `generateHomeLan`. Behind an
 * inner gateway hangs a hidden `10.x.y.0/24` segment carrying one reachable NPC
 * machine; the player exposes it by forwarding a port on the gateway.
 *
 * Pure + deterministic from `(pubkey, essid, frontingGateway)`, so the same world
 * re-rolls identically every reload. The `10.x` addressing is deliberately
 * disjoint from the home `192.168.x` LAN (and varies per fronting gateway), so a deep
 * host's address can never be confused with a Layer-1 one — the dual-homed inner
 * gateway sits at `.1` of this subnet (the downstream interface a later pivot
 * scans).
 *
 * A router-fronted layer hangs a CHILD GATEWAY (the door to the next layer down)
 * UNLESS the layer is terminal (`hangsChild: false`) — the bound that keeps a chain
 * finite. The NPC is drawn from the same PRNG stream regardless, so flipping a layer
 * terminal never re-rolls its reachable host.
 *
 * The deep host is a `buildRemoteHostFs` NPC with one guarantee the probabilistic
 * service roll doesn't give: `sshd` is always up on :22, so a deep layer is a
 * RELIABLE target to reach through a forward (the same "reachable by design" stance
 * the inner gateway takes with `hasSsh: true`).
 */

import { createPrng } from './prng';
import { buildRemoteHostFs } from './remoteHostFs';
import { ROUTER_HOSTNAMES } from './routerFs';
import { DEVICE_TYPES } from '../network/homeNetwork';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Directory, FilePermissions } from '../filesystem/types';
import type { LanHost, LanHostKind } from './generateHomeLan';

/** The gateway that FRONTS a deep layer — the seed for that layer's `/24`. Its
 *  `machineId` keys the layer (so every gateway in a chain fronts a distinct
 *  segment), and its `kind` decides whether the layer hangs a child gateway: a
 *  router forwards to a deeper layer, a switch forwards nothing so fronts none. */
export type FrontingGateway = {
  readonly machineId: string;
  readonly kind: LanHostKind;
};

/** A generated deeper layer: its `/24` prefix, the one NPC machine on it, and —
 *  when fronted by a router — the CHILD GATEWAY that fronts the next layer down (the
 *  chain door). The fronting gateway's downstream interface is `${subnet}.1` by
 *  convention (consumed by the pivot, not here), so it is derived rather than stored. */
export type DeepLayer = {
  /** The `10.x.y` prefix the deep hosts sit on. */
  readonly subnet: string;
  /** The single reachable NPC on the deep layer (`kind: 'machine'`). */
  readonly host: LanHost;
  /** The gateway fronting the NEXT layer down, or null when the chain stops here
   *  (the fronting gateway is a switch, which forwards nothing). */
  readonly childGateway: LanHost | null;
};

/** How a fronting gateway extends the chain. `hangsChild: false` makes the layer
 *  TERMINAL — no child gateway even behind a router — the bound that caps depth (a
 *  deep gateway fronts a terminal layer). Defaults to hanging a child, the shipped
 *  behavior for a layer fronted directly by an inner gateway. */
type DeepLayerOptions = {
  readonly hangsChild: boolean;
};

/** How many deep layers hang behind a home's inner gateway, seeded deterministically
 *  from the owner key AND essid (the `network-depth-` namespace, reload-stable). Every
 *  home gets at least one deep layer (so no player is playground-less); the 1–3 range
 *  gives variety — some chains are a single terminal layer, some run three gateways
 *  deep. A gateway at chain position P fronts a child-bearing layer iff P < depth, so
 *  the inner gateway (position 1) hangs a child only when depth ≥ 2. */
export const seedNetworkDepth = (ownerKeyHex: string, essid: string): number =>
  createPrng(`network-depth-${ownerKeyHex}:${essid}`).nextInt(1, 3);

export const generateDeepLayer = (
  seedPubkeyHex: string,
  essid: string,
  frontingGateway: FrontingGateway,
  options: DeepLayerOptions = { hangsChild: true },
): DeepLayer => {
  const prng = createPrng(`deep-layer-${seedPubkeyHex}-${essid}-${frontingGateway.machineId}`);
  const subnet = `10.${prng.nextInt(0, 255)}.${prng.nextInt(0, 255)}`;
  // .1 is the fronting gateway's downstream interface; the hosts avoid it (and
  // .0/.255). A single `pickN` keeps the NPC and child-gateway octets distinct, and
  // is drawn unconditionally so a terminal layer's NPC stays byte-stable.
  const usableOctets = Array.from({ length: 253 }, (_unused, index) => index + 2);
  const [hostOctet, childOctet] = prng.pickN(usableOctets, 2);
  const host: LanHost = {
    ip: `${subnet}.${hostOctet}`,
    hostname: `${prng.pick(DEVICE_TYPES)}-${hostOctet}`,
    kind: 'machine',
  };
  // A router fronts a deeper layer, so a child gateway hangs here — dual-homed at the
  // next layer's `.1` — unless the layer is terminal (the chain's depth bound). A
  // switch forwards nothing, so it never hangs a child.
  const childGateway: LanHost | null =
    frontingGateway.kind === 'router' && options.hangsChild
      ? {
          ip: `${subnet}.${childOctet}`,
          hostname: `${prng.pick(ROUTER_HOSTNAMES)}-${childOctet}`,
          kind: 'router',
        }
      : null;
  return { subnet, host, childGateway };
};

/** A pidfile under `/var/run`: world-readable (so a scan sees the port),
 *  root-written (the daemon runs as root). */
const PIDFILE_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** Force `sshd:22` onto the generated NPC tree: a deep host is a reachable target
 *  by design, not by the catalog's probabilistic placement roll. */
const FORCE_SSHD_PATCH: Patch = {
  path: '/var/run/sshd.pid',
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  owner: SERVICE_CATALOG.ssh.runUser,
  permissions: PIDFILE_PERMISSIONS,
};

/** The deep host's full operable filesystem — the shared NPC box skeleton
 *  (`buildRemoteHostFs`: `/etc/passwd`, toolchain, `/boot`) with `sshd:22`
 *  guaranteed up, so it is always reachable through a forward (and, later,
 *  loggable into via its own `/etc/passwd`). */
export const buildDeepHostFs = (
  seedPubkeyHex: string,
  essid: string,
  host: LanHost,
): Directory => applyPatches(buildRemoteHostFs(seedPubkeyHex, essid, host), [FORCE_SSHD_PATCH]);
