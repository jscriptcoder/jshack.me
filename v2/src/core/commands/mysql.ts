/**
 * mysql — open a database on a generated LAN host.
 *
 * The fourth door, and the first whose credential is not the box's own. `ssh` and
 * `ftp` both ask `/etc/passwd` who you are on the machine; this asks the database
 * who you are TO IT, which is a question `/etc/passwd` genuinely cannot answer.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { connectedWlan0 } from '../network/interfaces';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

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

/** The one refusal a credential can earn, naming the account TYPED and the address
 *  the daemon saw it arrive from — the client half of the line the target's
 *  `/var/log/mysql.log` records for the same attempt.
 *
 *  An unknown account and a wrong password produce this same sentence, which is why
 *  the seam brings back no reason to render: an error that told them apart would let
 *  a player enumerate the database's accounts by typing names at it. */
const accessDenied = (username: string, fromIp: string): CommandResult =>
  errorResult(
    `ERROR 1045 (28000): Access denied for user '${username}'@'${fromIp}' (using password: YES)`,
  );

/** The client line, then the server's own -- ftp's shape. Deliberately VERSION-FREE:
 *  the real monitor's greeting leads with one, and a version string is the single
 *  thing the service catalog bans, which is also why this door's `nc` banner is the
 *  bad-handshake error rather than a banner. No connection id either: the box's
 *  listener pid is per-BOX, so it would read the same two logins apart, and with no
 *  session row there is nothing else to count connections with. */
const greeting = (hostname: string): readonly TerminalLine[] => [
  { kind: 'text', content: `Connected to ${hostname}.` },
  { kind: 'text', content: 'Welcome to the MySQL monitor. Commands end with ;' },
];

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
  {
    target,
    port,
    essid,
    sourceIp,
    named,
  }: {
    readonly target: string;
    readonly port: number;
    readonly essid: string;
    readonly sourceIp: string;
    readonly named: string | undefined;
  },
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

  const opened = await env.mysql.connect({
    essid,
    targetIp: target,
    username: credential.username,
    password: credential.password,
    sourceIp,
  });
  if (!opened.ok) return accessDenied(credential.username, sourceIp);

  // What is held is exactly what was sent. There is no session row to name, so every
  // statement re-sends the whole credential -- which is what makes this door reach no
  // filesystem structurally rather than by a rule somebody has to keep.
  const connection = {
    essid,
    targetIp: target,
    username: credential.username,
    password: credential.password,
    sourceIp,
  };
  env.mysql.enter(connection);

  return { kind: 'sync', lines: greeting(host.hostname), exitCode: 0 };
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) return errorResult(USAGE);

  const port = SERVICE_CATALOG.mysql.defaultPort;
  // One question, four ways to answer no — and the address comes back with it, so
  // the refusal below can name what the daemon would have seen without a fallback
  // for an address that cannot be missing by the time we are here.
  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return unreachable(target, port, 'Network is unreachable');

  return lanConnect(env, {
    target,
    port,
    essid: wlan0.association.essid,
    sourceIp: wlan0.ipv4,
    named: args[1],
  });
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
  manual: {
    synopsis: 'mysql [-p port] <host> [user]',
    description:
      'Open a database on a remote host running a MySQL server. The account is the ' +
      "DATABASE's own, not the machine's — a box's shell users mean nothing here, and " +
      'a login grants no access to its files. Prompts for the password and, on success, ' +
      'leaves you at a "mysql>" prompt where every line you type is SQL. Your shell ' +
      'stays exactly where it was — "quit" hands it straight back.',
    arguments: [
      { name: 'host', description: 'The host IP to connect to, e.g. 192.168.1.5', required: true },
      {
        name: 'user',
        description: 'The database account to log in as. Omitted, you are asked for it.',
        required: false,
      },
      {
        name: '-p',
        description: 'The PORT to connect on, not the password. Defaults to 3306.',
        required: false,
      },
    ],
    examples: [
      { command: 'mysql 192.168.1.5', description: 'Connect to the database on 192.168.1.5' },
      { command: 'mysql 192.168.1.5 readonly', description: 'Connect as the readonly account' },
    ],
  },
  execute,
};
