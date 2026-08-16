/**
 * ps — what this machine is running.
 *
 * The survey instrument on the box you are standing on. One row per running
 * service, read from the same `/var/run/*.pid` files that decide whether a port
 * is open at all, through the same reader a scan uses — so a box cannot look
 * one way from outside and another from within.
 *
 * It reads `env.fs`, which follows the shell, so `ps` on a box the player only
 * rooted surveys THAT box. That is the whole recon half: what a stranger's
 * machine is running, seen from inside it rather than guessed from a port list.
 *
 * ANY TIER, and deliberately through the raw tree rather than a permissioned
 * read: the pidfiles are root-owned, so `cat /var/run/sshd.pid` is refused, but
 * real `ps` asks the kernel rather than reading a file — and here the pidfile IS
 * the kernel. A guest seeing what runs costs the defender nothing they control;
 * closing a door is what `systemctl` gates on root.
 *
 * There is no PID column, because there are no processes — the SERVICE is the
 * unit this world manages. The columns are what a player can act on: who it
 * runs as, what to name it to `systemctl`, and the port it is holding.
 */

import type { Command, CommandResult } from './types';
import { daemonName, readRunningServices, type RunningService } from '../services/pidfile';
import { text } from './streaming';

const USER_COL = 10;
const COMMAND_COL = 12;

/** Printed even when nothing is running: a bare header IS the answer "nothing
 *  is up", where printing nothing at all is indistinguishable from a command
 *  that failed to run. */
const HEADER = `${'USER'.padEnd(USER_COL)}${'COMMAND'.padEnd(COMMAND_COL)}PORT`;

const formatRow = ({ spec, port }: RunningService): string =>
  `${spec.runUser.padEnd(USER_COL)}${daemonName(spec).padEnd(COMMAND_COL)}${port}`;

export const ps: Command = {
  name: 'ps',
  description: 'List the services running on this machine',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'ps',
    description:
      'List the services running on this machine — the account each runs as, the daemon name, ' +
      'and the port it is listening on. Reports the machine you are currently on, so running it ' +
      'after an ssh tells you what the far box is serving. Anyone may run it; use "systemctl" to ' +
      'start or stop what it lists.',
    examples: [{ command: 'ps', description: 'Show what this machine is running' }],
  },
  execute: async (env): Promise<CommandResult> => ({
    kind: 'sync',
    lines: [
      text(HEADER),
      ...readRunningServices(env.fs.root()).map((running) => text(formatRow(running))),
    ],
    exitCode: 0,
  }),
};
