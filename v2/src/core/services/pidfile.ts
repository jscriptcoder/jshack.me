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
import { SERVICE_CATALOG, type ServiceSpec } from './serviceCatalog';

/** The directory holding every running service's pidfile. */
export const VAR_RUN = '/var/run';

/** The daemon name written into the pidfile line — the pidfile's basename
 *  (`sshd.pid` → `sshd`), matching legacy's `sshd:port=22` content. */
const daemonOf = (spec: ServiceSpec): string => spec.pidfile.replace(/\.pid$/, '');

/** Where a service's pidfile lives, e.g. `/var/run/sshd.pid`. */
export const pidfilePath = (spec: ServiceSpec): AbsPath => asAbsPath(`${VAR_RUN}/${spec.pidfile}`);

/** The canonical pidfile content for a service running on `port`:
 *  `<daemon>:port=<N>`. Producers MUST agree byte-for-byte; readers parse the
 *  same shape. */
export const formatPidfileContent = (spec: ServiceSpec, port: number): string =>
  `${daemonOf(spec)}:port=${port}`;

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
