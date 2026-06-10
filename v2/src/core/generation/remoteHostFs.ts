/**
 * buildRemoteHostFs — the pure per-host filesystem generator for the LAN's NPC
 * machines (ssh epic, Slice 2). Deterministic from the identity pubkey + ESSID +
 * the host, so the same world re-rolls identically every scan.
 *
 * It plants `/var/run/<pidfile>` for the services a host runs — the SAME
 * byte-shape the `sshd` command writes (via `formatPidfileContent`), so every
 * reader (`nmap` now; `ssh`/`ps` later) parses one format regardless of who
 * produced the file. Which services a host runs, and on what port, is decided by
 * the service catalog's generation knobs (`placement` / `altPorts` /
 * `altPortChance`) — one declarative table, tweaked in one place.
 *
 * Slice 2 emits ONLY `/var/run` (the minimum nmap reads). The rest of the base
 * skeleton (`/etc/passwd` users, `/home`, …) lands in Slice 3, when ssh's
 * browse + auth consume it — this builder grows there, callers unchanged.
 */

import { createPrng } from './prng';
import { SERVICE_CATALOG, type ServiceSpec } from '../services/serviceCatalog';
import { formatPidfileContent } from '../services/pidfile';
import type { Directory, FileEntry, FileNode, FilePermissions } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';

/** `/var` and `/var/run`: world-readable + traversable, root-writable — so every
 *  tier can scan the ports while only root (a daemon) writes a pidfile. */
const VAR_DIR_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
/** A pidfile: world-readable, root-writable, never executed. */
const PIDFILE_PERMS: FilePermissions = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const dir = (entries: Readonly<Record<string, FileNode>>): Directory => ({
  kind: 'directory',
  owner: 'root',
  perms: VAR_DIR_PERMS,
  entries: new Map(Object.entries(entries)),
});

const pidfile = (content: string, owner: string): FileEntry => ({
  kind: 'file',
  content,
  owner,
  perms: PIDFILE_PERMS,
});

export type HostService = { readonly spec: ServiceSpec; readonly port: number };

/**
 * The services a host runs, with their listen ports — deterministic per
 * `(service, pubkey, ESSID, host)`. Each service rolls independently against its
 * `placement`; a running service takes `defaultPort` unless a further roll under
 * `altPortChance` picks an `altPorts` entry.
 */
export const hostServices = (
  seedPubkeyHex: string,
  essid: string,
  host: LanHost,
): readonly HostService[] =>
  Object.values(SERVICE_CATALOG).flatMap((spec) => {
    const prng = createPrng(`svc-${spec.service}-${seedPubkeyHex}-${essid}-${host.ip}`);
    if (prng.next() >= spec.placement) return [];
    const port =
      spec.altPorts.length > 0 && prng.next() < spec.altPortChance
        ? prng.pick(spec.altPorts)
        : spec.defaultPort;
    return [{ spec, port }];
  });

/**
 * The generated base filesystem for `host` — a `Directory` whose `/var/run`
 * holds one pidfile per running service. A host running nothing still gets an
 * empty `/var/run` (where a pidfile would land, and what nmap reads).
 */
export const buildRemoteHostFs = (
  seedPubkeyHex: string,
  essid: string,
  host: LanHost,
): Directory => {
  const pidfiles = Object.fromEntries(
    hostServices(seedPubkeyHex, essid, host).map(
      ({ spec, port }) => [spec.pidfile, pidfile(formatPidfileContent(spec, port), spec.runUser)] as const,
    ),
  );
  return dir({ var: dir({ run: dir(pidfiles) }) });
};
