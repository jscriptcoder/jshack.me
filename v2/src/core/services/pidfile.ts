/**
 * The canonical pidfile FORMAT — the one source of truth for what a machine is
 * running, and on what port.
 *
 * `/var/run` holds two kinds of thing, and the difference decides the shape of
 * every line here:
 *
 *   - A SERVICE is a unit. The world knows its name, its account and its default
 *     port before anyone starts it, so `/var/run/<name>.pid` need only say where
 *     it landed: `sshd:port=22`. It is addressed by name, through `systemctl`.
 *   - A LISTENER is a process somebody left behind. The world knows nothing about
 *     it until it exists, so `/var/run/nc-<port>.pid` has to carry who planted it
 *     and at what tier: `nc:port=4444,user=mallory,userType=root`. It is
 *     addressed by PID, through `kill`.
 *
 * Presence of the file means the port is open; absence means closed. Every
 * PRODUCER (the daemon commands, `nc -l`, and all three world generators) writes
 * through the formatters here, and every READER (`nmap`, `ps`, `ssh`) parses
 * through `readRunningProcesses`, so a box cannot tell two stories about itself
 * depending on which tool asked.
 */

import { createPrng } from '../generation/prng';
import { asAbsPath, type AbsPath, type MachineId, type UserType } from '../types';
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

/** The `/var/run` name prefix marking a planted listener. The port is in the NAME
 *  as well as the line so a defender can name the file they want gone without
 *  reading every pidfile on the box first. */
const LISTENER_PREFIX = 'nc-';

/** The program a listener is, as `ps` names it in its COMMAND column. */
export const LISTENER_COMMAND = 'nc';

/** What a port scan calls a port the catalog has no row for. An open port nobody
 *  can name is the honest answer and the whole reason connect mode exists — a
 *  scanner that guessed would be answering a question only the port can. */
export const UNKNOWN_SERVICE = 'unknown';

/** The PID range a listener's number is drawn from. Above the handful a real
 *  system reserves for init and its kin, below the 16-bit ceiling `/proc` wraps
 *  at — so the number reads as one a box handed out rather than an index. */
const LOWEST_PID = 100;
const HIGHEST_PID = 32767;

/** A listener's PID: a function of the box and the port, never stored and never
 *  assigned while walking a directory.
 *
 *  It is the handle a defender types into `kill`, so it has to be the same number
 *  between the look and the shot. Legacy renumbered on every read, which meant
 *  the row you saw and the process you killed could be two different things.
 *  Seeded on the machine as well as the port, so an intruder who plants 4444
 *  across a LAN does not hand every defender one number that clears all of it. */
export const listenerPid = (machineId: MachineId, port: number): number =>
  createPrng(`${machineId}:nc:${port}`).nextInt(LOWEST_PID, HIGHEST_PID);

/** Where a listener on `port` is planted, e.g. `/var/run/nc-4444.pid`. */
export const listenerPidfilePath = (port: number): AbsPath =>
  asAbsPath(`${VAR_RUN}/${LISTENER_PREFIX}${port}.pid`);

/** Who is behind a planted listener, and what a visitor coming through it is
 *  worth. Recorded because nothing else in the world knows: a service's account
 *  and tier come from its catalog row, a listener's only from whoever planted it. */
export type Listener = {
  readonly port: number;
  readonly user: string;
  readonly userType: UserType;
};

export const formatListenerContent = ({ port, user, userType }: Listener): string =>
  `${LISTENER_COMMAND}:port=${port},user=${user},userType=${userType}`;

const LISTENER_LINE = /^nc:port=(\d+),user=([^,]+),userType=([^,]+)$/;

const USER_TYPES: readonly UserType[] = ['root', 'user', 'guest'];

/** The tier named in a pidfile line, or null for anything that is not one of the
 *  three the world has. Validated rather than trusted: the line is a file on a
 *  box a player holds root on, so `userType=wizard` is something they can really
 *  write, and a door that believed it would be a tier nobody granted. */
const parseUserType = (raw: string): UserType | null =>
  USER_TYPES.find((tier) => tier === raw) ?? null;

const parseListenerContent = (content: string): Listener | null => {
  const match = content.match(LISTENER_LINE);
  if (match === null) return null;
  const [, rawPort, user, rawUserType] = match;
  const userType = parseUserType(rawUserType);
  return userType === null ? null : { port: Number(rawPort), user, userType };
};

export type OpenPort = { readonly port: number; readonly service: string };

/** One thing found running on a machine — everything a reader can learn from
 *  `/var/run`. A union rather than one row with fields that are blank half the
 *  time, because the two kinds are addressed by different verbs: a service is
 *  stopped by name, a listener is killed by number. */
export type RunningProcess =
  | { readonly kind: 'service'; readonly spec: ServiceSpec; readonly port: number }
  | ({ readonly kind: 'listener' } & Listener);

/** Resolve ONE pidfile (its `/var/run` basename + content) to what it advertises,
 *  or null when it advertises nothing the world recognises. The single mapping
 *  every reader shares, so the port a scan SHOWS can never drift from what a
 *  producer wrote.
 *
 *  A malformed SERVICE line still names a running daemon — the catalog knows
 *  where it listens by default, and hiding it would tell a defender a door is
 *  shut when it is open. A malformed LISTENER line names nobody: there is no
 *  default to fall back to, because everything about it lives in the line. */
const runningFromPidfile = (pidfileName: string, content: string): RunningProcess | null => {
  if (pidfileName.startsWith(LISTENER_PREFIX)) {
    const listener = parseListenerContent(content);
    return listener === null ? null : { kind: 'listener', ...listener };
  }
  const spec = serviceByPidfileName(pidfileName);
  if (spec === undefined) return null;
  return { kind: 'service', spec, port: parsePidfilePort(content) ?? spec.defaultPort };
};

/** Everything a machine is running, read from its `/var/run/*.pid` files (the
 *  source of truth for what is up). The tree is the live `env.fs` for the
 *  player's own host or a deterministic generated FS for a remote host — this
 *  reader doesn't care which. Unknown or non-file `/var/run` entries are skipped:
 *  a DIRECTORY wearing a pidfile's name is not a running process, and `mkdir
 *  /var/run/sshd.pid` is something a root player can really do.
 *
 *  ONE policy for what counts as running, so a scan of a box and a survey run on
 *  it can never disagree — including about the backdoor, which is the one row
 *  somebody has a reason to want the two tools to disagree about. */
export const readRunningProcesses = (root: Directory): readonly RunningProcess[] => {
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

/** The open ports a machine advertises, as a port scan sees them. Shared by every
 *  reader (the `nmap` display + the server scan action) so the ports a scan SHOWS
 *  and the ports it LOGS can never drift. A listener projects as `unknown` — open,
 *  and unaccounted for. */
export const readOpenPorts = (root: Directory): readonly OpenPort[] =>
  readRunningProcesses(root).map((running) => ({
    port: running.port,
    service: running.kind === 'service' ? running.spec.service : UNKNOWN_SERVICE,
  }));
