/**
 * generateDeepLayer — the deeper-layer counterpart of `generateHomeLan`. Behind an
 * inner gateway hangs a hidden `10.x.y.0/24` segment carrying one reachable NPC
 * machine; the player exposes it by forwarding a port on the gateway.
 *
 * Pure + deterministic from `(pubkey, essid, layerIndex)`, so the same world
 * re-rolls identically every reload. The `10.x` addressing is deliberately
 * disjoint from the home `192.168.x` LAN (and varies per layer index), so a deep
 * host's address can never be confused with a Layer-1 one — the dual-homed inner
 * gateway sits at `.1` of this subnet (the downstream interface a later pivot
 * scans).
 *
 * The deep host is a `buildRemoteHostFs` NPC with one guarantee the probabilistic
 * service roll doesn't give: `sshd` is always up on :22, so a deep layer is a
 * RELIABLE target to reach through a forward (the same "reachable by design" stance
 * the inner gateway takes with `hasSsh: true`).
 */

import { createPrng } from './prng';
import { buildRemoteHostFs } from './remoteHostFs';
import { DEVICE_TYPES } from '../network/homeNetwork';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Directory, FilePermissions } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';

/** A generated deeper layer: its `/24` prefix and the one NPC machine on it. The
 *  gateway's downstream interface is `${subnet}.1` by convention (consumed by the
 *  pivot, not here), so it is derived rather than stored. */
export type DeepLayer = {
  /** The `10.x.y` prefix the deep host sits on. */
  readonly subnet: string;
  /** The single reachable NPC on the deep layer (`kind: 'machine'`). */
  readonly host: LanHost;
};

export const generateDeepLayer = (
  seedPubkeyHex: string,
  essid: string,
  layerIndex: number,
): DeepLayer => {
  const prng = createPrng(`deep-layer-${seedPubkeyHex}-${essid}-${layerIndex}`);
  const subnet = `10.${prng.nextInt(0, 255)}.${prng.nextInt(0, 255)}`;
  // .1 is the inner gateway's downstream interface; the host avoids it (and .0/.255).
  const hostOctet = prng.nextInt(2, 254);
  const host: LanHost = {
    ip: `${subnet}.${hostOctet}`,
    hostname: `${prng.pick(DEVICE_TYPES)}-${hostOctet}`,
    kind: 'machine',
  };
  return { subnet, host };
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
