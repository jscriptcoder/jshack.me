/**
 * rediscli — open a key-value store on a generated LAN host.
 *
 * The fifth door, and the only one that asks the player for nothing. `ssh` and `ftp`
 * ask `/etc/passwd` who you are on the machine; `mysql` asks the database who you are
 * to it; this asks nobody anything, because a store has no accounts. It answers to one
 * secret or to none, and four stores in ten have none at all — which is what makes the
 * FIND the whole play here rather than the first half of one.
 *
 * A LOCKED store still opens. The lock lands on the first question asked through the
 * door rather than on the door itself, exactly as the real client finds it — and a
 * connection refused on the strength of a secret would tell a scanner which stores hold
 * one without their ever sending a statement.
 *
 * The name is `rediscli` and can never become `redis-cli`. `node`'s sandbox is
 * `new Function(...contextKeys, content)`, so every command name in the game is a
 * formal PARAMETER of one function and a single hyphen is a `SyntaxError` that takes
 * every script down, not just the one that typed it.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { connectedWlan0 } from '../network/interfaces';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { ownBoxSource } from './mysqlOwnBox';
import type { Command, CommandEnv, CommandResult } from './types';

const USAGE = 'usage: rediscli <host>';

const PORT = SERVICE_CATALOG.redis.defaultPort;

const errorResult = (content: string, exitCode = 1): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/** Every failure to reach a daemon is one sentence with a different tail, as the real
 *  client's is — and legacy's was the same sentence with the tail hardcoded. */
const unreachable = (target: string, reason: string): CommandResult =>
  errorResult(`Could not connect to Redis at ${target}:${PORT}: ${reason}`);

/** What the box's absence is called. A box that is not there and a box with no daemon
 *  are DELIBERATELY the same words: a scan already tells anyone who asks which is
 *  which, so spelling it out here buys the player nothing and costs the fiction. */
const REACH_REASON: Readonly<Record<'unreachable' | 'refused', string>> = {
  unreachable: 'No route to host',
  refused: 'Connection refused',
};

/** The client line, then the server's own — the shape `ftp` and `mysql` both use. The
 *  hostname is what ANSWERED rather than what this client looked up: through a forward
 *  there is nothing to look up, because a deep box's address is absent from the LAN.
 *  It is also what keeps the bare `redis> ` prompt honest about its target. */
const greeting = (target: string, hostname: string): CommandResult => ({
  kind: 'sync',
  lines: [
    { kind: 'text', content: `Connecting to ${target}:${PORT}...` },
    { kind: 'text', content: `Connected to Redis ${hostname}.` },
  ],
  exitCode: 0,
});

/** Whether the daemon is holding the port on a tree this client can see for itself.
 *  The pidfiles are the same source `nmap` reads, so a door the player was shown is a
 *  door that opens — and `systemctl stop redis` shuts this one too. */
const storeListening = (fs: Parameters<typeof readOpenPorts>[0]): boolean =>
  readOpenPorts(fs).some(
    (open) => open.port === PORT && open.service === SERVICE_CATALOG.redis.service,
  );

/** Whether this client can settle reachability BEFORE spending a round-trip, and the
 *  refusal when it settles it as "no".
 *
 *  It can only do that for the world it holds itself: their own box, whose filesystem
 *  is real and in front of us, and the generated LAN, which it regenerates. A PUBLIC
 *  address and a FELLOW OCCUPANT are the server's to answer — pre-flighting a
 *  neighbour against the generated world would refuse a real player on behalf of the
 *  seeded box their lease displaced. */
const preflightRefusal = async (
  env: CommandEnv,
  target: {
    readonly typed: string;
    readonly essid: string;
    readonly ownSource: string | null;
  },
): Promise<CommandResult | null> => {
  if (target.ownSource !== null) {
    return storeListening(env.fs.root())
      ? null
      : unreachable(target.typed, REACH_REASON.refused);
  }

  if (isPublicIp(target.typed)) return null;

  const occupants = await env.scan.resolveOccupants(target.essid);
  if (occupants.some((occupant) => occupant.localIp === target.typed)) return null;

  const host = generateHomeLan(target.essid).hosts.find(
    (candidate) => candidate.ip === target.typed,
  );
  if (host === undefined) return unreachable(target.typed, REACH_REASON.refused);

  // BOTH halves, because either alone is a door that opens on the wrong thing: a port
  // with no daemon behind it, or an open port belonging to somebody else's — and a box
  // that serves a store commonly serves http and ssh as well.
  const { baseFs } = resolveLanHostIdentity(host, target.essid);
  return storeListening(baseFs) ? null : unreachable(target.typed, REACH_REASON.refused);
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return unreachable(target, 'Network is unreachable');
  const essid = wlan0.association.essid;

  const ownSource = ownBoxSource({ target, ownIp: wlan0.ipv4 });
  const refusal = await preflightRefusal(env, { typed: target, essid, ownSource });
  if (refusal !== null) return refusal;

  // What is held is exactly what is sent. There is no session row to name, so every
  // statement re-sends the whole connection — which is what makes this door reach no
  // filesystem structurally rather than by a rule somebody has to keep.
  const connection = {
    essid,
    // Their own box is held under the address it was LEASED, whichever of its three
    // names they reached it by, so every statement after this re-resolves one machine.
    targetIp: ownSource === null ? target : wlan0.ipv4,
    port: PORT,
    sourceIp: ownSource ?? wlan0.ipv4,
  };
  const opened = await env.redis.connect(connection);
  if (!opened.ok) return unreachable(target, REACH_REASON[opened.reason]);

  env.redis.enter(connection);
  return greeting(target, opened.hostname);
};

export const rediscli: Command = {
  name: 'rediscli',
  description: 'Open a key-value store on a remote machine',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // What it opens is a prompt, so there has to be a terminal for the prompt to be in.
  withoutTty: 'rediscli: must be run from a terminal',
  manual: {
    synopsis: 'rediscli <host>',
    description:
      'Open the key-value store on a remote host running a Redis server. There is no ' +
      'account and no login: a store answers to a single password or to nobody at all, ' +
      'and many answer to nobody. On success you are left at a "redis>" prompt where ' +
      'every line you type goes to the store. Your shell stays exactly where it was — ' +
      '"quit" hands it straight back. A store that does hold a password answers ' +
      '"NOAUTH Authentication required." to everything you ask it.',
    arguments: [
      { name: 'host', description: 'The host IP to connect to, e.g. 192.168.1.5', required: true },
    ],
    examples: [
      { command: 'rediscli 192.168.1.5', description: 'Open the store on 192.168.1.5' },
    ],
  },
  execute,
};
