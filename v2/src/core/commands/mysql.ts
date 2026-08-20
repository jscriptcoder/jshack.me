/**
 * mysql — open a database on a generated LAN host.
 *
 * The fourth door, and the first whose credential is not the box's own. `ssh` and
 * `ftp` both ask `/etc/passwd` who you are on the machine; this asks the database
 * who you are TO IT, which is a question `/etc/passwd` genuinely cannot answer.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Command, CommandEnv, CommandResult } from './types';

const USAGE = 'usage: mysql [-p port] <host> [user]';

/** Every failure to reach a daemon is one error code with a different parenthetical,
 *  as the real client's are — the code says "no connection", the reason says why. */
const unreachable = (target: string, port: number, reason: string): CommandResult =>
  errorResult(`ERROR 2003 (HY000): Can't connect to MySQL server on '${target}:${port}' (${reason})`);

const errorResult = (content: string, exitCode = 1): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/** Ctrl-C at either prompt: nothing was sent, nothing is held. */
const ABORTED: CommandResult = { kind: 'sync', lines: [], exitCode: 130 };

type Credential = { readonly username: string; readonly password: string };

/** An account named on the command line skips the first prompt; the password is
 *  never an argument. `null` for an abort at either. */
const askCredential = async (
  env: CommandEnv,
  named: string | undefined,
): Promise<Credential | null> => {
  try {
    const username = named ?? (await env.prompt({ message: 'Enter user: ', masked: false }));
    const password = await env.prompt({ message: 'Enter password: ', masked: true });
    return { username, password };
  } catch {
    return null;
  }
};

/** A host on the player's OWN generated LAN. Reachability is deterministic there, so
 *  it is settled from the pidfiles — the same source `nmap` reads, so a door the
 *  player was shown is a door that opens — BEFORE anything is typed. */
const lanConnect = async (
  env: CommandEnv,
  target: string,
  port: number,
  essid: string,
  named: string | undefined,
): Promise<CommandResult> => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined) return unreachable(target, port, 'No route to host');

  const { baseFs } = resolveLanHostIdentity(host, essid);
  const listening = readOpenPorts(baseFs).some(
    (open) => open.service === SERVICE_CATALOG.mysql.service,
  );
  if (!listening) return unreachable(target, port, 'Connection refused');

  const credential = await askCredential(env, named);
  if (credential === null) return ABORTED;

  return errorResult('not implemented');
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) return errorResult(USAGE);

  const port = SERVICE_CATALOG.mysql.defaultPort;
  const essid = env.network.interfaces().find((iface) => iface.kind === 'wireless')?.association
    ?.essid;
  if (essid === undefined || !env.network.isOnline()) {
    return unreachable(target, port, 'Network is unreachable');
  }

  return lanConnect(env, target, port, essid, args[1]);
};

export const mysql: Command = {
  name: 'mysql',
  description: 'Open a database on a remote machine',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // Prompts for an account and a masked password before its sub-shell ever opens.
  withoutTty: 'mysql: must be run from a terminal',
  flags: { '-p': 'string' },
  execute,
};
