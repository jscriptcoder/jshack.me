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
import { runRedisLine } from './redisShell';
import { forwardsIntoDeepLayer, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { connectOwnStore, storeListening } from './redisOwnBox';
import { ownBoxSource } from '../network/interfaces';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

const USAGE = 'usage: rediscli [-p port] <host> [password]';

const PORT = SERVICE_CATALOG.redis.defaultPort;

/** `-p <port>` — the port to reach the store ON. Absent means the daemon's own 6379;
 *  `null` means the player typed something that is no port, including a bare `-p` that
 *  named nothing.
 *
 *  Refused rather than defaulted, the same way `mysql` refuses it and DELIBERATELY
 *  unlike `hydra`, which falls back to the default door. There the port only selects
 *  between doors on one box; here it IS the address of the store, because a box on a
 *  deep layer has no address of its own and the forward is the whole of its name.
 *  Substituting a number the player did not type would open a different store and
 *  never say so. */
const parsePort = (raw: string | true | undefined): number | null => {
  if (raw === undefined) return PORT;
  if (raw === true) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : null;
};

const errorResult = (content: string, exitCode = 1): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/** Every failure to reach a daemon is one sentence with a different tail, as the real
 *  client's is — and legacy's was the same sentence with the tail hardcoded. */
const unreachable = (target: string, port: number, reason: string): CommandResult =>
  errorResult(`Could not connect to Redis at ${target}:${port}: ${reason}`);

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
const greetingLines = (
  target: string,
  port: number,
  hostname: string,
): readonly TerminalLine[] => [
  { kind: 'text', content: `Connecting to ${target}:${port}...` },
  { kind: 'text', content: `Connected to Redis ${hostname}.` },
];



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
    readonly port: number;
    readonly essid: string;
    readonly ownSource: string | null;
  },
): Promise<CommandResult | null> => {
  if (target.ownSource !== null) {
    return storeListening(env.fs.root(), target.port)
      ? null
      : unreachable(target.typed, target.port, REACH_REASON.refused);
  }

  // A PUBLIC address is somebody else's access point. A port on an INNER GATEWAY other
  // than its own sshd addresses the hidden layer behind it, and which box sits behind
  // which forward lives in that gateway's server-side journal — the same rule
  // `ssh -p <fwd> <inner>`, `hydra -p <fwd> <inner>` and `mysql -p <fwd> <inner>` route
  // by, so all four tools reach the same box. Neither can be settled here: pre-flighting
  // a deep target against this LAN would refuse every one of them, because a deep box
  // has no LAN address to be found at.
  if (
    isPublicIp(target.typed) ||
    forwardsIntoDeepLayer({ essid: target.essid, target: target.typed, port: target.port })
  ) {
    return null;
  }

  const occupants = await env.scan.resolveOccupants(target.essid);
  if (occupants.some((occupant) => occupant.localIp === target.typed)) return null;

  const host = generateHomeLan(target.essid).hosts.find(
    (candidate) => candidate.ip === target.typed,
  );
  if (host === undefined) return unreachable(target.typed, target.port, REACH_REASON.refused);

  // BOTH halves, because either alone is a door that opens on the wrong thing: a port
  // with no daemon behind it, or an open port belonging to somebody else's — and a box
  // that serves a store commonly serves http and ssh as well.
  const { baseFs } = resolveLanHostIdentity(host, target.essid);
  return storeListening(baseFs, target.port)
    ? null
    : unreachable(target.typed, target.port, REACH_REASON.refused);
};

const execute: Command['execute'] = async (env, args, flags) => {
  const [target, password] = args;
  if (target === undefined) return errorResult(USAGE);

  const port = parsePort(flags.get('-p'));
  if (port === null) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return unreachable(target, port, 'Network is unreachable');
  const essid = wlan0.association.essid;

  const ownSource = ownBoxSource({ target, ownIp: wlan0.ipv4 });
  const refusal = await preflightRefusal(env, { typed: target, port, essid, ownSource });
  if (refusal !== null) return refusal;

  // What is held is exactly what is sent. There is no session row to name, so every
  // statement re-sends the whole connection — which is what makes this door reach no
  // filesystem structurally rather than by a rule somebody has to keep.
  const connection = {
    essid,
    // Their own box is held under the address it was LEASED, whichever of its three
    // names they reached it by, so every statement after this re-resolves one machine.
    targetIp: ownSource === null ? target : wlan0.ipv4,
    port,
    sourceIp: ownSource ?? wlan0.ipv4,
  };
  // Your own box is answered HERE. The server's same-LAN vantage excludes the caller,
  // so a self-addressed reach that went out would fall through to the generated world and
  // open whichever seeded box stands at the address this player was leased.
  const opened =
    ownSource === null ? await env.redis.connect(connection) : await connectOwnStore(env, connection);
  if (!opened.ok) return unreachable(target, port, REACH_REASON[opened.reason]);

  env.redis.enter(connection);

  // A password given here is spent as an ORDINARY statement once the store is open, rather than carried in the
  // handshake: the connection judges nothing, and one that could be refused on the
  // strength of a secret would tell a scanner which stores hold one. It goes through
  // the prompt's own line runner, so a password this store accepts is held by exactly
  // the rule that holds one typed at `redis> ` — and a box that died between the two
  // is discovered rather than believed in.
  //
  // Its answer is PRINTED, where the real client is silent on success: a silent one
  // here is indistinguishable from a client that ignored the argument it was handed.
  const authed =
    password === undefined ? null : await runRedisLine(env, `AUTH ${password}`, connection);
  return {
    kind: 'sync',
    lines: [...greetingLines(target, port, opened.hostname), ...(authed?.lines ?? [])],
    exitCode: authed?.exitCode ?? 0,
  };
};

export const rediscli: Command = {
  name: 'rediscli',
  description: 'Open a key-value store on a remote machine',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // What it opens is a prompt, so there has to be a terminal for the prompt to be in.
  withoutTty: 'rediscli: must be run from a terminal',
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'rediscli [-p port] <host> [password]',
    description:
      'Open the key-value store on a remote host running a Redis server. There is no ' +
      'account and no login: a store answers to a single password or to nobody at all, ' +
      'and many answer to nobody. On success you are left at a "redis>" prompt where ' +
      'every line you type goes to the store. Your shell stays exactly where it was — ' +
      '"quit" hands it straight back. A store that does hold a password answers ' +
      '"NOAUTH Authentication required." until you give it one — pass it here, or type ' +
      '"AUTH <password>" at the prompt. Recover a store password with "hydra <host> ' +
      'redis". A store you can read is a store you can change: "SET <key> <value>" ' +
      'writes one, quoting a value that contains a space, and "DEL <key>" removes one. ' +
      'Both are recorded in the target\'s own /var/log/redis.log; reading is not.',
    arguments: [
      { name: 'host', description: 'The host IP to connect to, e.g. 192.168.1.5', required: true },
      { name: 'password', description: "The store's password, sent as an AUTH on connect" },
      {
        name: '-p',
        description:
          'The PORT to reach the store on. Defaults to 6379. A port forwarded by one ' +
          'of your own inner gateways reaches the store on the machine behind it.',
      },
    ],
    examples: [
      { command: 'rediscli 192.168.1.5', description: 'Open the store on 192.168.1.5' },
      {
        command: 'rediscli 192.168.1.5 sunshine',
        description: 'Open a locked store and unlock it in one go',
      },
      {
        command: 'rediscli -p 36379 192.168.1.1',
        description: 'Open the store on a machine hidden behind a gateway forward',
      },
    ],
  },
  execute,
};
