/**
 * ps — what this machine is running.
 *
 * The survey instrument on the box you are standing on. One row per running
 * thing — the services its owner started and the listeners somebody left behind
 * — read from the same `/var/run/*.pid` files that decide whether a port is open
 * at all, through the same reader a scan uses, so a box cannot look one way from
 * outside and another from within.
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
 * The PID column is filled for exactly one kind of row. A SERVICE is a unit the
 * box manages, addressed by name through `systemctl`, so it shows the same dash
 * a real survey uses for "not applicable". A LISTENER is a process somebody left
 * behind, addressed by number through `kill` — and it is the only row here that
 * is evidence rather than configuration, so the number that takes it away is
 * what the column is for.
 */

import type { Command, CommandResult } from './types';
import type { MachineId } from '../types';
import {
  daemonName,
  listenerPid,
  readRunningProcesses,
  LISTENER_COMMAND,
  type RunningProcess,
} from '../services/pidfile';
import { text } from './streaming';

const PID_COL = 8;
const USER_COL = 10;
const COMMAND_COL = 12;

/** Printed even when nothing is running: a bare header IS the answer "nothing
 *  is up", where printing nothing at all is indistinguishable from a command
 *  that failed to run. */
const HEADER =
  `${'PID'.padEnd(PID_COL)}${'USER'.padEnd(USER_COL)}` +
  `${'COMMAND'.padEnd(COMMAND_COL)}PORT`;

/** What a service has instead of a PID. */
const NO_PID = '-';

type Row = {
  readonly pid: string;
  readonly user: string;
  readonly command: string;
  readonly port: number;
};

/** The two kinds of running thing, each answering the same four questions in its
 *  own way. Derived per kind and formatted once, rather than one formatter
 *  branching mid-column: the columns are shared, the answers are not. */
const rowOf = (running: RunningProcess, machineId: MachineId): Row =>
  running.kind === 'service'
    ? {
        pid: NO_PID,
        user: running.spec.runUser,
        command: daemonName(running.spec),
        port: running.port,
      }
    : {
        pid: String(listenerPid(machineId, running.port)),
        user: running.user,
        command: LISTENER_COMMAND,
        port: running.port,
      };

const formatRow = ({ pid, user, command, port }: Row): string =>
  `${pid.padEnd(PID_COL)}${user.padEnd(USER_COL)}${command.padEnd(COMMAND_COL)}${port}`;

export const ps: Command = {
  name: 'ps',
  description: 'List the services running on this machine',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'ps',
    description:
      'List what is running on this machine — the PID where there is one, the account it runs ' +
      'as, the program, and the port it is holding. Reports the machine you are currently on, ' +
      'so running it after an ssh tells you what the far box is serving. Anyone may run it; use ' +
      '"systemctl" to start or stop a service, and "kill" to take away a listener.',
    examples: [{ command: 'ps', description: 'Show what this machine is running' }],
  },
  execute: async (env): Promise<CommandResult> => ({
    kind: 'sync',
    lines: [
      text(HEADER),
      ...readRunningProcesses(env.fs.root()).map((running) =>
        text(formatRow(rowOf(running, env.session.machineId))),
      ),
    ],
    exitCode: 0,
  }),
};
