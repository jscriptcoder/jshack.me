/**
 * kill — take away a process somebody left behind.
 *
 * The defender's answer to a backdoor, and the only verb here that acts on
 * EVIDENCE rather than on configuration. Everything else `ps` lists was started
 * on purpose by whoever owns the box; a listener was not.
 *
 * Services are units, listeners are processes — which is the whole of why this
 * command exists beside `systemctl` rather than inside it. A unit is addressed
 * by name and stopped by the tool that manages it, and `ps` gives it no PID to
 * aim at; a listener has no name, so the number is the only handle it has. A
 * player who types a unit name here is pointed at the verb that can stop one,
 * because "that is not a process ID" would be true and useless.
 *
 * The pid is DERIVED from the box and the port rather than stored, so this
 * resolves one by matching that derivation over what is running. Nothing is read
 * out of the pidfile: the number a planter's client could author is not a number
 * a defender should have to trust. It also means a pid names a process on a BOX
 * — an intruder who plants one port across a LAN does not hand every defender a
 * single number that clears all of it.
 *
 * Removing the pidfile shuts the port for everyone at once, through the same
 * journal path `systemctl stop` travels: the owner's own scan, a neighbour's and
 * a stranger's all read what is left. Silent when it works, as the real thing
 * is — the observable is that `ps` no longer lists it.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
} from './types';
import { listenerPid, listenerPidfilePath, readRunningProcesses } from '../services/pidfile';
import { isUnitName } from './systemctl';
import { errorLine } from './streaming';

const USAGE = 'kill: usage: kill <pid>';

/** Root, forced rather than chosen: removing the pidfile goes through the walker
 *  and `/var/run` is root-writable, so a non-root kill would be refused there
 *  anyway. Refusing up front says WHY, in the words the other doors already use. */
const MUST_BE_ROOT = 'kill: must be run as root';

/** The lowest number that could name a process. */
const LOWEST_PID = 1;

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

/** The argument as a number a process could really answer to, or null for
 *  anything else — a word, a fraction, or a zero. */
const parsePid = (raw: string): number | null => {
  const pid = Number(raw);
  return Number.isInteger(pid) && pid >= LOWEST_PID ? pid : null;
};

/** The port the listener with this pid is holding on the current machine, or
 *  null when no listener here answers to that number. */
const portHeldBy = (env: CommandEnv, pid: number): number | null => {
  const target = readRunningProcesses(env.fs.root()).find(
    (running) =>
      running.kind === 'listener' && listenerPid(env.session.machineId, running.port) === pid,
  );
  return target === undefined ? null : target.port;
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) return error(USAGE);
  if (isUnitName(target)) return error(`kill: ${target}: use "systemctl stop ${target}"`);

  const pid = parsePid(target);
  if (pid === null) return error(`kill: ${target}: arguments must be process IDs`);
  if (env.session.userType !== 'root') return error(MUST_BE_ROOT);

  const port = portHeldBy(env, pid);
  if (port === null) return error(`kill: (${pid}): No such process`);

  const removed = await env.patches.remove(listenerPidfilePath(port));
  if (!removed.ok) return error(`kill: ${PATCH_ERROR_REASON[removed.error]}`);

  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const kill: Command = {
  name: 'kill',
  description: 'Terminate a process by PID',
  category: 'network',
  // Declarative only. The root rule lives at runtime, where the refusal can name
  // the reason — and where a player can still read the manual to learn it.
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'kill <pid>',
    description:
      'Terminate a process on this machine by its PID, closing the port it was holding to ' +
      'everyone — a scan of this host no longer shows it, and it stays gone across a reboot. ' +
      'Use "ps" to find the PID. Services have no PID of their own: stop those with ' +
      '"systemctl stop <unit>". Requires root (run "su" first).',
    arguments: [{ name: 'pid', description: 'Process ID to terminate', required: true }],
    examples: [
      { command: 'ps', description: 'Find the PID of whatever is listening' },
      { command: 'kill 4821', description: 'Take that process away, and its port with it' },
    ],
  },
  execute,
};
