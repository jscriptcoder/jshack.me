/**
 * The canonical service-pidfile FORMAT — the one source of truth for "is this
 * service running, and on what port".
 *
 * A running daemon is recorded by a `/var/run/<name>.pid` file whose content is
 * a single `<daemon>:port=<N>` line (legacy-faithful: `sshd:port=22`). Presence
 * of the file means the service is up / the port is open; its absence means
 * closed. Both PRODUCERS — the `sshd` command and (Slice 2) the world generator —
 * write through `formatPidfileContent`, and every READER (`nmap` now; `ssh`/`ps`
 * later) parses through `parsePidfilePort`, so the two can never drift.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';
import { SERVICE_CATALOG, type ServiceSpec } from './serviceCatalog';

/** The directory holding every running service's pidfile. */
export const VAR_RUN = '/var/run';

/**
 * A pidfile's permissions: world-readable, root-written, never executed.
 *
 * World-readable is load-bearing rather than incidental. A cross-player hop is
 * server-served, and the server prunes the box it hands back to what the
 * visitor's tier may read — so a root-only pidfile is dropped in transit and
 * `ps` reports a bare header on a box that is plainly serving. What a machine is
 * RUNNING is public; changing it is root's, which the write tier keeps.
 *
 * Shared by every producer — the daemons, and all three world generators — for
 * the same reason the FORMAT is: a pidfile the world planted and one an owner
 * started must look identical to whoever walks in, or the box tells two stories
 * about itself depending on who opened the door.
 */
export const PIDFILE_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** The daemon name written into the pidfile line — the pidfile's basename
 *  (`sshd.pid` → `sshd`), matching legacy's `sshd:port=22` content. Also the
 *  name `ps` prints in its COMMAND column: a survey that called the process
 *  something other than what its own pidfile line calls it would be two names
 *  for one daemon. */
export const daemonName = (spec: ServiceSpec): string => spec.pidfile.replace(/\.pid$/, '');

/** Where a service's pidfile lives, e.g. `/var/run/sshd.pid`. */
export const pidfilePath = (spec: ServiceSpec): AbsPath => asAbsPath(`${VAR_RUN}/${spec.pidfile}`);

/** The canonical pidfile content for a service running on `port`:
 *  `<daemon>:port=<N>`. Producers MUST agree byte-for-byte; readers parse the
 *  same shape. */
export const formatPidfileContent = (spec: ServiceSpec, port: number): string =>
  `${daemonName(spec)}:port=${port}`;

/** Extract the listening port from a pidfile line, or null when the content is
 *  not the canonical `<daemon>:port=<N>` shape. */
export const parsePidfilePort = (content: string): number | null => {
  const match = content.match(/^[\w-]+:port=(\d+)$/);
  return match === null ? null : Number(match[1]);
};

/** The service whose pidfile is named `name` (`sshd.pid` → the ssh spec), or
 *  undefined for an unrecognised pidfile — lets a reader label a `/var/run`
 *  entry without re-deriving the mapping. */
export const serviceByPidfileName = (name: string): ServiceSpec | undefined =>
  Object.values(SERVICE_CATALOG).find((spec) => spec.pidfile === name);

export type OpenPort = { readonly port: number; readonly service: string };

/** One service found running on a machine: the catalog row it belongs to, and
 *  the port its pidfile says it holds. Everything a reader can know from
 *  `/var/run` — a port scan wants only two of these fields, `ps` wants the
 *  account and the daemon name as well. */
export type RunningService = { readonly spec: ServiceSpec; readonly port: number };

/** Resolve ONE pidfile (its `/var/run` basename + content) to the service it
 *  advertises, or null for an unrecognised pidfile name. The single mapping every
 *  reader shares, so the port a scan SHOWS can never drift from what a producer
 *  wrote. Malformed content falls back to the default port. */
const runningFromPidfile = (pidfileName: string, content: string): RunningService | null => {
  const spec = serviceByPidfileName(pidfileName);
  if (spec === undefined) return null;
  return { spec, port: parsePidfilePort(content) ?? spec.defaultPort };
};

/** Everything a machine is running, read from its `/var/run/*.pid` files (the
 *  source of truth for running services). The tree is the live `env.fs` for the
 *  player's own host or a deterministic generated FS for a remote host — this
 *  reader doesn't care which. Unknown or non-file `/var/run` entries are skipped:
 *  a DIRECTORY wearing a pidfile's name is not a running daemon, and `mkdir
 *  /var/run/sshd.pid` is something a root player can really do.
 *
 *  ONE policy for what counts as a service, so a scan of a box and a survey run
 *  on it can never disagree about what is up. */
export const readRunningServices = (root: Directory): readonly RunningService[] => {
  const varDir = root.entries.get('var');
  if (varDir === undefined || varDir.kind !== 'directory') return [];
  const runDir = varDir.entries.get('run');
  if (runDir === undefined || runDir.kind !== 'directory') return [];
  return [...runDir.entries].flatMap(([name, node]) => {
    if (node.kind !== 'file') return [];
    const running = runningFromPidfile(name, node.content);
    return running === null ? [] : [running];
  });
};

/** The open ports a machine advertises — the running services, as a port scan
 *  sees them. Shared by every reader (the `nmap` display + the server scan
 *  action) so the ports a scan SHOWS and the ports it LOGS can never drift. */
export const readOpenPorts = (root: Directory): readonly OpenPort[] =>
  readRunningServices(root).map(({ spec, port }) => ({ port, service: spec.service }));
