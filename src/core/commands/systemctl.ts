/**
 * systemctl — start, stop, restart and query the services on the current machine.
 *
 * The defender's half of every door. A `stop` removes the `/var/run/*.pid` file
 * that IS the source of truth for "this service is up", so the port shuts for
 * everyone at once — the owner's own scan, a neighbour's, and a stranger's
 * across the network, because the server materializes the same journal and runs
 * the same `readOpenPorts` over it. Nothing new had to be built for that reach:
 * removing a generated file leaves a tombstone the replayed tree no longer
 * carries, exactly as the brick does to `/boot/vmlinuz`.
 *
 * A stop therefore SURVIVES A REBOOT. The pidfile is a patch row and `reboot`
 * never touches the journal, so a door closed today is still closed tomorrow.
 *
 * `nginx` and `apache2` are two units, as on a real box, though they bind one
 * port. Each answers for its own program's pidfile only, so asking after or
 * stopping the one that is not up never claims it ran, and never touches the one
 * that is. Starting either while the other holds the port is refused by the
 * daemon's own gate, which a start (and a restart of a stopped unit) routes into.
 *
 * `start` does NOT write the pidfile here. It routes into the daemon command
 * that owns it, so there is ONE writer behind one gate ladder rather than a
 * second copy free to drift. That also keeps `apt` honest: resolving a unit
 * requires its binary to be present, without which `systemctl start nginx`
 * would open port 80 on a box that never installed a web server.
 *
 * A stop does not EVICT. Sessions already inside outlive the closed door and can
 * re-open it behind the defender — only new logins are refused. The `auth.log`
 * line that let the intruder in is the attribution; there is no separate
 * service-state log.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type TerminalLine,
} from './types.js';
import { SERVICE_CATALOG, type ServiceSpec } from '../services/serviceCatalog.js';
import { programPidfilePath } from '../services/pidfile.js';
import { UNIT_DESCRIPTIONS } from '../generation/pools/logLines.js';
import { errorLine, streamedResult, text } from './streaming.js';
import { binaryExists } from './availability.js';
import {
  apache2,
  bringUp,
  DAEMONS,
  mysqld,
  nginx,
  programPort,
  redisServer,
  snmpd,
  named,
  sshd,
  vsftpd,
  type Daemon,
} from './daemon.js';

/** Beat between the stop announcement and the port closing, mirroring the start
 *  side so a door visibly takes as long to shut as it does to open. */
const STOP_DELAY_MS = 400;

const USAGE = 'Usage: systemctl {start|stop|status|restart} <unit>';

/** No flags reach the daemon a `start` routes into — `systemctl`'s own arguments
 *  are positional, and the daemon takes only an optional port it is not given. */
const NO_FLAGS: ReadonlyMap<string, string | true> = new Map();

type Unit = {
  /** The `.service` name, which is also the program: its pidfile is
   *  `/var/run/<name>.pid`. */
  readonly name: string;
  readonly title: string;
  readonly spec: ServiceSpec;
  /** The front door a `start` routes into — the command the player would have
   *  typed, so the start banner names the program they actually asked for, and
   *  its gate ladder runs exactly once. */
  readonly start: Command;
  /** The same daemon without the front door, for `restart` to bring up after its
   *  own stop. It cannot reuse `start`: `env.fs` is a snapshot taken before the
   *  stop, so that gate would still see the pidfile restart just deleted. */
  readonly daemon: Daemon;
};

/** Every name that resolves to a unit. The two web units share a service, and so a
 *  port, but each is its own program with its own pidfile. */
const UNITS: Readonly<Record<string, Unit>> = {
  sshd: {
    name: 'sshd',
    title: 'OpenSSH server',
    spec: SERVICE_CATALOG.ssh,
    start: sshd,
    daemon: DAEMONS.sshd,
  },
  vsftpd: {
    name: 'vsftpd',
    title: 'FTP server',
    spec: SERVICE_CATALOG.ftp,
    start: vsftpd,
    daemon: DAEMONS.vsftpd,
  },
  nginx: {
    name: 'nginx',
    title: UNIT_DESCRIPTIONS.nginx,
    spec: SERVICE_CATALOG.http,
    start: nginx,
    daemon: DAEMONS.nginx,
  },
  apache2: {
    name: 'apache2',
    title: UNIT_DESCRIPTIONS.apache2,
    spec: SERVICE_CATALOG.http,
    start: apache2,
    daemon: DAEMONS.apache2,
  },
  mysqld: {
    name: 'mysqld',
    title: 'MySQL server',
    spec: SERVICE_CATALOG.mysql,
    start: mysqld,
    daemon: DAEMONS.mysqld,
  },
  'redis-server': {
    name: 'redis-server',
    title: 'Redis server',
    spec: SERVICE_CATALOG.redis,
    start: redisServer,
    daemon: DAEMONS['redis-server'],
  },
  snmpd: {
    name: 'snmpd',
    title: 'SNMP agent',
    spec: SERVICE_CATALOG.snmp,
    start: snmpd,
    daemon: DAEMONS.snmpd,
  },
  named: {
    name: 'named',
    title: 'name server',
    spec: SERVICE_CATALOG.dns,
    start: named,
    daemon: DAEMONS.named,
  },
};

/** True for a name that resolves to a unit ANYWHERE in the world — what `kill`
 *  asks before deciding a word is not a PID, so a player aiming at a service is
 *  sent to the verb that can stop one. Name-only, unlike `unitFor`: whether the
 *  program is installed on THIS box is a question `systemctl` answers, and
 *  answering it here would answer it in another command's voice.
 *
 *  `Object.hasOwn`, not `in` or a bare lookup: both walk the prototype chain, so
 *  `toString` would come back a unit. */
export const isUnitName = (name: string): boolean => Object.hasOwn(UNITS, name);

const VERBS = ['start', 'stop', 'status', 'restart'] as const;

type Verb = (typeof VERBS)[number];

const isVerb = (candidate: string): candidate is Verb =>
  VERBS.some((verb) => verb === candidate);

/** The unit a name refers to on THIS machine, or undefined when the name is not
 *  a unit or its program is not installed here. The two collapse deliberately:
 *  told apart, they would let a guest enumerate a box's packages by probing. */
const unitFor = (env: CommandEnv, name: string): Unit | undefined => {
  const unit = UNITS[name];
  if (unit === undefined) return undefined;
  return binaryExists(env, name) ? unit : undefined;
};

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(content)],
  exitCode: 1,
});

const noticeResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [text(content)],
  exitCode: 0,
});

/** The port this unit's own program holds, or null when it is not up. */
const unitPort = (env: CommandEnv, unit: Unit): number | null =>
  programPort(env, unit.name, unit.spec);

const status = (env: CommandEnv, unit: Unit): CommandResult => {
  const port = unitPort(env, unit);
  const marker = port === null ? '○' : '●';
  const active =
    port === null ? 'inactive (dead)' : `active (running) on port ${port}`;
  return {
    kind: 'sync',
    lines: [text(`${marker} ${unit.name}.service - ${unit.title}`), text(`     Active: ${active}`)],
    exitCode: 0,
  };
};

async function* stopSteps(env: CommandEnv, unit: Unit): AsyncGenerator<TerminalLine, number> {
  yield text(`Stopping ${unit.title}...`);
  await env.sleep(STOP_DELAY_MS);

  const result = await env.patches.remove(programPidfilePath(unit.name));
  if (!result.ok) {
    yield errorLine(`systemctl: ${PATCH_ERROR_REASON[result.error]}`);
    return 1;
  }

  yield text(`${unit.name} stopped.`);
  return 0;
}

/** Stop a running unit and bring it back on the port it held — read BEFORE the
 *  stop, so a service an admin put on a non-default port comes back where they put
 *  it rather than silently moving to the default, where every scan looking for it
 *  would find it again. */
async function* restartSteps(
  env: CommandEnv,
  unit: Unit,
  port: number,
): AsyncGenerator<TerminalLine, number> {
  const stopped = yield* stopSteps(env, unit);
  if (stopped !== 0) return stopped;
  return yield* bringUp(env, unit.daemon, port);
}

const execute: Command['execute'] = async (env, args) => {
  const [verb, named] = args;
  if (verb === undefined) return errorResult(USAGE);
  if (!isVerb(verb)) return errorResult(`systemctl: Unknown operation ${verb}.`);
  if (named === undefined) return errorResult(USAGE);

  const unit = unitFor(env, named);
  if (unit === undefined) return errorResult(`Unit ${named}.service could not be found.`);

  // Asking what runs is free; changing what runs is root's. A defender's box
  // must not be closable by whoever talked their way into a guest shell.
  if (verb === 'status') return status(env, unit);
  if (env.session.userType !== 'root') return errorResult('systemctl: must be run as root');

  if (verb === 'start') return unit.start.execute(env, [], NO_FLAGS);

  const port = unitPort(env, unit);
  if (verb === 'restart') {
    // Real `systemctl restart` starts a unit that was not running, and a start goes
    // through the front door: its gate refuses while the other web server holds the
    // port, where bringing it up directly would leave the box running both.
    return port === null
      ? unit.start.execute(env, [], NO_FLAGS)
      : streamedResult(restartSteps(env, unit, port));
  }

  return port === null
    ? noticeResult(`${unit.name} is not running.`)
    : streamedResult(stopSteps(env, unit));
};

export const systemctl: Command = {
  name: 'systemctl',
  description: 'Control system services',
  category: 'network',
  // Declarative only. `status` answers any tier; the write verbs gate on root at
  // runtime, which is where the real rule lives.
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'systemctl {start|stop|status|restart} <unit>',
    description:
      'Start, stop, restart or query a service on this machine. Stopping a service closes its ' +
      'port to everyone — a scan of this host no longer shows it, and nobody new can log in ' +
      'through it — and it stays closed across a reboot until someone starts it again. ' +
      'Anyone may ask for status; starting and stopping require root (run "su" first). ' +
      'Existing sessions are not disconnected by a stop.',
    arguments: [
      {
        name: 'operation',
        description: 'What to do with the unit',
        required: true,
        values: [...VERBS],
      },
      {
        name: 'unit',
        description: 'Service to act on (sshd, vsftpd, nginx, mysqld)',
        required: true,
      },
    ],
    examples: [
      { command: 'systemctl status sshd', description: 'Ask whether SSH is running, and on what port' },
      { command: 'systemctl stop sshd', description: 'Close the SSH port to everyone' },
      { command: 'systemctl start sshd', description: 'Open it again' },
      { command: 'systemctl restart vsftpd', description: 'Bounce the FTP server' },
    ],
  },
  execute,
};
