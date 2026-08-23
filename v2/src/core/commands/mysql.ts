/**
 * mysql — open a database on a generated LAN host.
 *
 * The fourth door, and the first whose credential is not the box's own. `ssh` and
 * `ftp` both ask `/etc/passwd` who you are on the machine; this asks the database
 * who you are TO IT, which is a question `/etc/passwd` genuinely cannot answer.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { connectedWlan0 } from '../network/interfaces';
import { forwardsIntoDeepLayer, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { connectOwnDatabase, ownBoxSource, ownDaemonListening } from './mysqlOwnBox';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

const USAGE = 'usage: mysql [-p port] <host> [user]';

/** `-p <port>` — the port to connect ON, which is not what the real client reads it
 *  as. Absent means the daemon's own 3306; `null` means the player typed something
 *  that is no port, including a bare `-p` that named nothing.
 *
 *  Refused rather than defaulted, DELIBERATELY unlike the same flag on `hydra`, which
 *  falls back to the default door. There the port only ever selects between doors on
 *  one box; here it IS the address of the daemon, so quietly substituting a number
 *  the player did not type would connect them somewhere they did not ask for and
 *  never mention it. */
const parsePort = (raw: string | true | undefined): number | null => {
  if (raw === undefined) return SERVICE_CATALOG.mysql.defaultPort;
  if (raw === true) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : null;
};

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

/** What the daemon's absence is called, for the two refusals that are not about a
 *  credential at all. The same words this command already uses when it can see for
 *  itself that nothing is listening. */
const REACH_REASON: Readonly<Record<'unreachable' | 'refused', string>> = {
  unreachable: 'No route to host',
  refused: 'Connection refused',
};

/** The client line, then the server's own -- ftp's shape. Deliberately VERSION-FREE:
 *  the real monitor's greeting leads with one, and a version string is the single
 *  thing the service catalog bans, which is also why this door's `nc` banner is the
 *  bad-handshake error rather than a banner. No connection id either: the box's
 *  listener pid is per-BOX, so it would read the same two logins apart, and with no
 *  session row there is nothing else to count connections with. It also drops the
 *  real monitor's `Commands end with ;`: this door's parser strips a trailing
 *  semicolon and is equally happy without one, so printing that would be the greeting
 *  inventing a rule nothing enforces — and a player who believes it types one every
 *  time. `help` lists what the door actually accepts. */
const greeting = (hostname: string): readonly TerminalLine[] => [
  { kind: 'text', content: `Connected to ${hostname}.` },
  { kind: 'text', content: 'Welcome to the MySQL monitor. Type help for commands.' },
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
/** Ask for the credential, send it, and hand over the prompt. Shared by both
 *  vantages: what differs is only whether this client could see the box for itself
 *  BEFORE prompting, and everything after the prompt is the same conversation. */
const openDatabase = async (
  env: CommandEnv,
  {
    typed,
    address,
    port,
    essid,
    sourceIp,
    named,
    own,
  }: {
    /** The host AS THE PLAYER WROTE IT — what a refusal names them back. */
    readonly typed: string;
    /** The address the connection is held under, which for the player's own box is
     *  the one it was leased rather than the name they reached it by. */
    readonly address: string;
    readonly port: number;
    readonly essid: string;
    readonly sourceIp: string;
    readonly named: string | undefined;
    /** Their own box, whose whole conversation stays on this client. */
    readonly own: boolean;
  },
): Promise<CommandResult> => {
  const credential = await askCredential(env, named);
  if (credential === null) return ABORTED;

  // What is held is exactly what was sent. There is no session row to name, so every
  // statement re-sends the whole credential -- which is what makes this door reach no
  // filesystem structurally rather than by a rule somebody has to keep. The PORT rides
  // along with it, so each statement re-resolves the same forward the login came
  // through, and a forward pulled out from under the player drops them on the next one.
  const connection = {
    essid,
    targetIp: address,
    port,
    username: credential.username,
    password: credential.password,
    sourceIp,
  };
  // ONE line of difference between the two vantages, and it is only about where the
  // answer is worked out. Everything around it -- the prompts, the greeting, the
  // refusal, the prompt handed over -- is one conversation either way.
  const opened = own
    ? await connectOwnDatabase(env, connection)
    : await env.mysql.connect(connection);
  if (!opened.ok) {
    // The address in the refusal is the daemon's own answer, not this client's guess:
    // behind a forward the box never saw the player's address at all.
    return opened.reason === 'denied'
      ? accessDenied(credential.username, opened.fromIp)
      : unreachable(typed, port, REACH_REASON[opened.reason]);
  }

  env.mysql.enter(connection);

  // Greeted with what ANSWERED, rather than with what this client looked up. Through a
  // forward there is nothing to look up: the box's address is absent from the LAN.
  return { kind: 'sync', lines: greeting(opened.hostname), exitCode: 0 };
};

/** The caller's own LAN, where this client can see for itself whether the box is
 *  there and whether mysqld holds the port — so an unreachable target costs the player
 *  no typing. Nothing behind a forward can be checked this way: that table lives in the
 *  gateway's journal, which only the server replays. */
const lanReach = (
  essid: string,
  target: string,
  port: number,
): CommandResult | null => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined) return unreachable(target, port, 'No route to host');

  // BOTH halves, because either alone is a door that opens on the wrong thing: a
  // port with no daemon behind it, or an open port belonging to somebody else's —
  // and a database box is commonly listening on ssh and ftp as well.
  const { baseFs } = resolveLanHostIdentity(host, essid);
  const listening = readOpenPorts(baseFs).some(
    (open) => open.port === port && open.service === SERVICE_CATALOG.mysql.service,
  );
  return listening ? null : unreachable(target, port, 'Connection refused');
};

/** Whether this client can settle reachability BEFORE asking the player for a
 *  credential, and the refusal when it can settle it as "no".
 *
 *  It can only do that for the world it holds itself. Their own box it reads off the
 *  real filesystem in front of them; the generated LAN it regenerates. Everything else
 *  is the server's to answer: a public address, a port that addresses the layer behind
 *  an inner gateway, and a FELLOW OCCUPANT, whose box is a real machine the generator
 *  knows nothing about. Pre-flighting a neighbour against the generated world would
 *  refuse every player on the WiFi before the password prompt — or, worse, refuse them
 *  on behalf of the seeded box their lease displaced. */
const preflightRefusal = async (
  env: CommandEnv,
  target: {
    readonly typed: string;
    readonly port: number;
    readonly essid: string;
    readonly ownSource: string | null;
  },
): Promise<CommandResult | null> => {
  // Their own box first, because it is the one address on the LAN the generator does
  // not describe: it has a real filesystem rather than a seeded one, and the pidfile
  // that says whether the door is open is sitting in it.
  if (target.ownSource !== null) {
    return ownDaemonListening(env.fs.root(), target.port)
      ? null
      : unreachable(target.typed, target.port, REACH_REASON.refused);
  }

  // A PUBLIC address is somebody else's access point, and which box sits behind which
  // forward lives in that gateway's server-side journal. A port on an inner gateway
  // other than its own sshd addresses the hidden layer BEHIND it — the same rule
  // `ssh -p <fwd> <inner>` and `hydra -p <fwd> <inner>` route by, so all three tools
  // reach the same box. Neither can be checked here, so the player is asked for a
  // credential first and told afterwards, exactly as a real client refused at the
  // socket would be.
  if (isPublicIp(target.typed) || forwardsIntoDeepLayer({ essid: target.essid, target: target.typed, port: target.port })) {
    return null;
  }

  // A fellow occupant of this ESSID is reached DIRECTLY over the shared LAN. Asked
  // after the two vantages above because those need no lookup at all, and the answer
  // is the server's either way: what is behind a neighbour's address is theirs.
  const occupants = await env.scan.resolveOccupants(target.essid);
  if (occupants.some((occupant) => occupant.localIp === target.typed)) return null;

  return lanReach(target.essid, target.typed, target.port);
};

const execute: Command['execute'] = async (env, args, flags) => {
  const target = args[0];
  if (target === undefined) return errorResult(USAGE);

  const port = parsePort(flags.get('-p'));
  if (port === null) return errorResult(USAGE);

  // One question, four ways to answer no — and the address comes back with it, so
  // the refusal below can name what the daemon would have seen without a fallback
  // for an address that cannot be missing by the time we are here.
  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return unreachable(target, port, 'Network is unreachable');
  const essid = wlan0.association.essid;

  const ownSource = ownBoxSource({ target, ownIp: wlan0.ipv4 });
  const refusal = await preflightRefusal(env, { typed: target, port, essid, ownSource });
  if (refusal !== null) return refusal;

  return openDatabase(env, {
    typed: target,
    // Their own box is held under the address it was LEASED, whichever of its three
    // names they reached it by, so every statement after this re-resolves one machine.
    address: ownSource === null ? target : wlan0.ipv4,
    port,
    essid,
    sourceIp: ownSource ?? wlan0.ipv4,
    named: args[1],
    own: ownSource !== null,
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
