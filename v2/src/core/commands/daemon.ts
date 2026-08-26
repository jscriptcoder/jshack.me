/**
 * Starting a daemon — `sshd`, `vsftpd`, `mysqld`, and THE web server under
 * either of its two names. One implementation, five front doors.
 *
 * Every daemon opens its port the same way: it writes `/var/run/<name>.pid`
 * (`sshd:port=22`), which IS the source of truth for "the service is up / the
 * port is open" — a later `nmap`/`ssh`/`ftp` reads that file. The format lives in
 * `core/services/pidfile`, so these writers and the world generator stay
 * byte-identical.
 *
 * Gates, in order (mirrors `apt`'s "root first"):
 *   - ROOT only: a real `/usr/sbin/sshd` is world-executable, but binding the
 *     port and writing the pidfile need root, so a non-root caller is refused
 *     BEFORE any write — modelling that runtime failure as a clean up-front
 *     check.
 *   - PORT: the optional `[port]` arg must be a 1–65535 integer, defaulting to
 *     the daemon's catalog port.
 *   - ALREADY RUNNING: if the pidfile exists the daemon is up; starting again is
 *     refused (you cannot bind a port twice), reporting the running port.
 *
 * The gates are SHARED rather than merely alike: a second door that refused
 * differently from the first would be a second set of rules to learn for no gain.
 * Real Unix reserves ports below 1024 for root, which is tempting to model here,
 * but the root gate fires before a port is ever parsed, so the rule would be an
 * unreachable branch — a high port is refused for the same reason as a low one:
 * you are not root.
 *
 * The already-running check reads the pidfile via `fs.stat` (the raw node,
 * bypassing the caller's read perms) — a daemon checks its own pidfile regardless
 * of who invoked it.
 *
 * Bringing a daemon up STREAMS (see `streaming.ts`): the start is announced
 * before the write that opens the port, so the player watches it come up rather
 * than being told afterwards. The gates refuse instantly and never reach the
 * daemon, so they stay sync.
 *
 * `nginx` and `apache2` are two names for ONE capability: both bind the `http`
 * row's pidfile, so whichever starts first owns the port and the other is
 * refused. See `alreadyRunning` for why that refusal names the conflict rather
 * than the program.
 */

import {
  PATCH_ERROR_REASON,
  type AvailabilityRule,
  type Command,
  type CommandEnv,
  type CommandExample,
  type CommandResult,
  type TerminalLine,
} from './types';
import { SERVICE_CATALOG, type ServiceSpec } from '../services/serviceCatalog';
import {
  formatPidfileContent,
  parsePidfilePort,
  pidfilePath,
  PIDFILE_PERMISSIONS,
} from '../services/pidfile';
import { errorLine, streamedResult, text } from './streaming';

const PORT_MIN = 1;
const PORT_MAX = 65535;

/** Beat between the start announcement and the port coming up, so the daemon
 *  visibly takes a moment even when the write returns instantly. */
const STARTUP_DELAY_MS = 400;

/** All that differs between the front doors: which service they bring up, and the
 *  words they bring it up in. The gates, the pidfile write and the streamed shape
 *  are the same for every one. */
export type Daemon = {
  /** The command name, and the prefix on every message, so a refusal is
   *  attributed to the program the player actually ran. */
  readonly name: string;
  /** The catalog row this daemon binds — its pidfile, its default port, and the
   *  service label a later scan shows. */
  readonly spec: ServiceSpec;
  /** How the program announces itself while starting: `Starting <banner>...`. */
  readonly banner: string;
  /** The refusal between `<name>: ` and ` on port <N>` when the port is already
   *  bound. The web server says "web server already running" because two names
   *  share one pidfile: "apache2 is already running" would be false when it was
   *  nginx that came up. */
  readonly alreadyRunning: string;
  readonly description: string;
  readonly availability: AvailabilityRule;
  /** The manual's DESCRIPTION prose. The synopsis and the `[port]` argument are
   *  derived instead — every daemon takes the same argument, defaulting to its
   *  own catalog port. */
  readonly manualDescription: string;
  readonly examples: readonly CommandExample[];
};

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(content)],
  exitCode: 1,
});

/** The optional `[port]` arg as a valid 1–65535 integer, the daemon's catalog
 *  default when absent, or null when it isn't a valid port. */
const parsePort = (raw: string | undefined, spec: ServiceSpec): number | null => {
  if (raw === undefined) return spec.defaultPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return port;
};

/**
 * The port this service is listening on (read from its pidfile through the
 * current machine's FS), or null when it isn't running. A malformed pidfile
 * falls back to the service's default port, and a DIRECTORY wearing a pidfile's
 * name is not a running daemon — `mkdir /var/run/sshd.pid` is something a root
 * player can really do, and reading it as one would let anybody fake a serving
 * box, or bar the door, with a single command.
 *
 * Shared with `systemctl`, which asks the same question for `status`, `stop` and
 * `restart`: one answer to "is this up, and where", so a daemon's own gate and
 * the tool that reports on it can never disagree.
 */
export const runningPort = (env: CommandEnv, spec: ServiceSpec): number | null => {
  const node = env.fs.stat(pidfilePath(spec));
  if (node === null || node.kind !== 'file') return null;
  return parsePidfilePort(node.content) ?? spec.defaultPort;
};

/**
 * Bring a daemon up: announce, then write the pidfile that opens the port.
 *
 * Deliberately gate-FREE — the caller owns the decision that starting is
 * allowed. `daemonCommand` gates first and then calls this; `systemctl restart`
 * calls it having just removed the pidfile itself. That second caller cannot go
 * through the front door: `env.fs` is a point-in-time snapshot taken when the
 * command env was built, so a gate re-reading it after a stop in the same
 * command still sees the file it just deleted and refuses a restart that should
 * succeed.
 */
export async function* bringUp(
  env: CommandEnv,
  daemon: Daemon,
  port: number,
): AsyncGenerator<TerminalLine, number> {
  yield text(`Starting ${daemon.banner}...`);
  await env.sleep(STARTUP_DELAY_MS);

  // Permissions are NAMED rather than defaulted: a write that omits them takes
  // the caller's own tier defaults, and a daemon is root-only, so the pidfile
  // would come out root-readable — invisible to anyone who later hops onto this
  // box, since the server prunes what it hands them to their tier.
  const result = await env.patches.write(
    pidfilePath(daemon.spec),
    formatPidfileContent(daemon.spec, port),
    { isNew: true, permissions: PIDFILE_PERMISSIONS },
  );
  if (!result.ok) {
    yield errorLine(`${daemon.name}: ${PATCH_ERROR_REASON[result.error]}`);
    return 1;
  }

  yield text(`Server listening on 0.0.0.0 port ${port}.`);
  return 0;
}

const daemonCommand = (daemon: Daemon): Command => ({
  name: daemon.name,
  description: daemon.description,
  category: 'network',
  tier: 'root',
  availability: daemon.availability,
  manual: {
    synopsis: `${daemon.name} [port]`,
    description: daemon.manualDescription,
    arguments: [
      {
        name: 'port',
        description: `Port to listen on (default: ${daemon.spec.defaultPort})`,
        required: false,
      },
    ],
    examples: daemon.examples,
  },
  execute: async (env, args) => {
    if (env.session.userType !== 'root') {
      return errorResult(`${daemon.name}: must be run as root`);
    }

    const port = parsePort(args[0], daemon.spec);
    if (port === null) {
      return errorResult(`${daemon.name}: invalid port: ${args[0]}`);
    }

    const already = runningPort(env, daemon.spec);
    if (already !== null) {
      return errorResult(`${daemon.name}: ${daemon.alreadyRunning} on port ${already}`);
    }

    return streamedResult(bringUp(env, daemon, port));
  },
});

const SSHD: Daemon = {
  name: 'sshd',
  spec: SERVICE_CATALOG.ssh,
  banner: 'OpenSSH server',
  alreadyRunning: 'already running',
  description: 'OpenSSH server daemon',
  // The OpenSSH daemon binary ships on every machine (like the `ssh` client), so
  // the command is meaningful anywhere — on the workstation now, on machines you
  // enter later. (Today's gate is the binary's FS presence; this field is
  // declarative until remote sessions consume it.)
  availability: { kind: 'any-machine' },
  manualDescription:
    'Start the OpenSSH server daemon, opening the SSH port (default 22) on this machine so it accepts incoming connections. Must be run as root (run "su" first). Refuses to start if sshd is already running.',
  examples: [
    { command: 'sshd', description: 'Start the SSH server on the default port 22' },
    { command: 'sshd 2222', description: 'Start the SSH server on port 2222' },
  ],
};

const VSFTPD: Daemon = {
  name: 'vsftpd',
  spec: SERVICE_CATALOG.ftp,
  banner: 'FTP server',
  alreadyRunning: 'already running',
  description: 'FTP server daemon',
  // The daemon binary ships in `/usr/sbin` on every machine, as `sshd` does, so the
  // command is meaningful anywhere. The ftp CLIENT is apt-gated instead — the real
  // asymmetry the world already models, since `scp` arrives with openssh and `ftp`
  // does not.
  availability: { kind: 'any-machine' },
  manualDescription:
    'Start the FTP server daemon, opening the FTP port (default 21) on this machine so it accepts incoming connections. Must be run as root (run "su" first). Refuses to start if vsftpd is already running.',
  examples: [
    { command: 'vsftpd', description: 'Start the FTP server on the default port 21' },
    { command: 'vsftpd 2121', description: 'Start the FTP server on port 2121' },
  ],
};

/** Both web-server programs write the `http` row's pidfile, so only one of them
 *  can be up. Unlike `sshd`, neither ships pre-installed: `apt install nginx` (or
 *  `apache2`) puts the binary in `/usr/sbin` beside the daemons that do, and the
 *  existing binary-presence gate turns its absence into `command not found` with
 *  the install hint. */
const webServerDaemon = ({
  name,
  banner,
  description,
}: Pick<Daemon, 'name' | 'banner' | 'description'>): Daemon => ({
  name,
  spec: SERVICE_CATALOG.http,
  banner,
  alreadyRunning: 'web server already running',
  description,
  availability: { kind: 'installed-package', packageName: name },
  manualDescription:
    `Start the ${banner} web server, opening the HTTP port (default 80) on this machine and publishing /var/www/html to anyone who can reach it. ` +
    'Must be run as root (run "su" first). Only one web server can run at a time — nginx and apache2 compete for the same port.',
  examples: [
    { command: name, description: 'Serve /var/www/html on the default port 80' },
    { command: `${name} 8080`, description: 'Serve it on port 8080 instead' },
  ],
});

const NGINX = webServerDaemon({ name: 'nginx', banner: 'nginx', description: 'Nginx web server' });

const APACHE2 = webServerDaemon({
  name: 'apache2',
  banner: 'Apache httpd',
  description: 'Apache HTTP server',
});

/** The database daemon, and the first door whose credential is not the box's own
 *  — what a player runs to become the thing `mysql <host>` opens. Bought rather
 *  than shipped, like the web servers: `apt install mysql` brings the client and
 *  this together, so the choice to serve one is a choice with a consequence. */
const MYSQLD: Daemon = {
  name: 'mysqld',
  spec: SERVICE_CATALOG.mysql,
  banner: 'MySQL server',
  alreadyRunning: 'already running',
  description: 'MySQL database server daemon',
  availability: { kind: 'installed-package', packageName: 'mysql' },
  manualDescription:
    'Start the MySQL database server, opening the database port (default 3306) on this machine ' +
    "so it accepts incoming connections. The accounts it answers to are the DATABASE's own, not " +
    "this machine's — a login here grants no shell and no files. Must be run as root " +
    '(run "su" first). Refuses to start if a database is already running.',
  examples: [
    { command: 'mysqld', description: 'Start the database on the default port 3306' },
    { command: 'mysqld 3307', description: 'Start it on port 3307 instead' },
  ],
};

/** The store daemon, and the second door a player has to BUY. No `d` on the end:
 *  a command name becomes a formal PARAMETER of the function a script runs, so
 *  `redis-server` would be a syntax error that takes every script in the game down.
 *  The package name IS the daemon name here, exactly as `nginx` and `apache2` are.
 *
 *  Its secret belongs to the SERVICE rather than to a person — one lock, no accounts —
 *  which is the whole difference between this door and the database beside it. On a
 *  player's own box that lock is the box's root password, so starting this is opening a
 *  second way at a secret they already hold. */
const REDIS: Daemon = {
  name: 'redis',
  spec: SERVICE_CATALOG.redis,
  banner: 'Redis server',
  alreadyRunning: 'already running',
  description: 'Redis key-value store daemon',
  availability: { kind: 'installed-package', packageName: 'redis' },
  manualDescription:
    'Start the Redis key-value store, opening the store port (default 6379) on this machine so ' +
    'it accepts incoming connections. There are no accounts: the store answers to a single ' +
    "password, which on your own box is this machine's root password. Must be run as root " +
    '(run "su" first). Refuses to start if a store is already running.',
  examples: [
    { command: 'redis', description: 'Start the store on the default port 6379' },
    { command: 'redis 6380', description: 'Start it on port 6380 instead' },
  ],
};

export const sshd = daemonCommand(SSHD);
export const vsftpd = daemonCommand(VSFTPD);
export const nginx = daemonCommand(NGINX);
export const apache2 = daemonCommand(APACHE2);
export const mysqld = daemonCommand(MYSQLD);
export const redis = daemonCommand(REDIS);

/** Each daemon keyed by the command name that starts it. `systemctl` reads this
 *  to bring a unit up through `bringUp` once it has established the port is
 *  free — `nginx` and `apache2` keep separate entries so a start still announces
 *  the program the player actually asked for. */
export const DAEMONS: Readonly<Record<string, Daemon>> = {
  sshd: SSHD,
  vsftpd: VSFTPD,
  nginx: NGINX,
  apache2: APACHE2,
  mysqld: MYSQLD,
  redis: REDIS,
};
