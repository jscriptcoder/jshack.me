/**
 * deepHostFs — the filesystem a deep layer's reachable NPC carries.
 *
 * Split from `generateDeepLayer`, which answers what a layer IS (its subnet, its
 * host, whether it hangs a child) rather than what any box on it holds. Keeping the
 * tree builder here leaves that module free of every filesystem import, so anything
 * that needs the SHAPE of the network — the zone a name server is authoritative for,
 * say — can walk the chain without pulling a filesystem generator in behind it and
 * closing an import cycle back onto `buildRemoteHostFs`.
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { formatPidfileContent, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildRemoteHostFs } from './remoteHostFs';
import type { Directory } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';

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
 *  loggable into via its own `/etc/passwd`).
 *
 *  Keyed by `(essid, deep ip)` like the skeleton it builds on — which is also what
 *  keys this host's machine_id (`hostMachineId`). The tree and the id agree on what
 *  identifies the box; while the tree was seeded per viewer they did not, and a
 *  journal could be replayed over a different machine than the one it was written
 *  on. Nothing about the box is private to a viewer any more: the chain it hangs off
 *  descends from gateways the access point owns, so two occupants who reach it are
 *  standing on the same machine. */
export const buildDeepHostFs = (essid: string, host: LanHost): Directory =>
  applyPatches(buildRemoteHostFs(essid, host), [FORCE_SSHD_PATCH]);
