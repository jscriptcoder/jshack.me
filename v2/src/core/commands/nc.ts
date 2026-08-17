/**
 * nc — netcat's connect mode: point it at a port and hear what answers.
 *
 * The recon verb that makes an open port answerable. A scan names the ports it
 * recognises and calls the rest `unknown`, which is a question rather than an
 * answer — `nc <host> <port>` is how a player asks it. What comes back is the
 * service's own greeting, straight off the catalog, so a box identifies itself
 * in its own words rather than in the scanner's.
 *
 * Reachability reads the same world every other network command does: the
 * deterministic generated LAN for an NPC neighbour, `env.scan.resolvePublic` for
 * an address on another network, and — for a real occupant of your own ESSID —
 * nothing at all, because their services are theirs to know. So a port `nmap`
 * shows open is exactly a port `nc` can reach, and a box neither tool can account
 * for stays unaccounted for in both: one source of truth for what is running,
 * whichever tool asks.
 *
 * The three refusals are distinct facts, not one error wearing three coats:
 * nothing at the address TIMES OUT, a host with that port shut REFUSES, and your
 * own box refuses whatever is running on it — planting a listener is a local act,
 * connecting to one is not.
 */

import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { isInnerGateway, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { homeDirectory } from '../sessions/homeDirectory';
import { asMachineId, type UserType } from '../types';
import {
  formatListenerContent,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
  readOpenPorts,
  type OpenPort,
} from '../services/pidfile';
import { serviceByName, type ServiceSpec } from '../services/serviceCatalog';
import { connectedWlan0, LOOPBACK_IPV4 } from '../network/interfaces';
import { errorLine, streamedResult, text } from './streaming';
import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type TerminalLine,
} from './types';

const USAGE = 'nc: usage: nc <host> <port> | nc -l <port>';

const UNREACHABLE = 'nc: network is unreachable — connect to a network first';

const PORT_RANGE = 'nc: port must be between 1 and 65535';

/** Your own box refuses under the name it answers to, whichever way you named it —
 *  as the real thing does, having resolved everything that means "here" to the
 *  loopback before it ever opens a socket. */
const OWN_BOX = 'nc: connect to localhost: Connection refused';

/** Planting is forced root, not chosen: `/var/run` is root-writable, so a
 *  user-tier plant would be refused by the walker anyway. Refusing up front says
 *  WHY, in the words every other door on the box already uses. Legacy also
 *  reserved ports below 1024 for root — unreachable behind this gate, so a high
 *  port is refused for the same reason a low one is: you are not root. */
const MUST_BE_ROOT = 'nc: must be run as root';

const LISTEN_FLAG = '-l';

const LOWEST_PORT = 1;
const HIGHEST_PORT = 65535;

/** The handshake's pauses. Long enough that the connection reads as something
 *  happening over a wire rather than a lookup in a table, and abort-aware
 *  (`env.sleep`) so Ctrl-C unwinds before the far side ever speaks. */
const CONNECT_DELAY_MS = 400;
const BANNER_DELAY_MS = 300;

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const connectError = (host: string, port: number, reason: string): CommandResult =>
  error(`nc: connect to ${host} port ${port}: ${reason}`);

/** The port as a number a host could really listen on, or null for anything else —
 *  a word, a fraction, or a number outside the 16 bits a port has. */
const parsePort = (raw: string): number | null => {
  const port = Number(raw);
  return Number.isInteger(port) && port >= LOWEST_PORT && port <= HIGHEST_PORT ? port : null;
};

/** Where a knock at this address has to be sent, and whatever the player's own side
 *  can already say about what is open there. The arms mirror `ssh`'s exactly,
 *  because a backdoor is reachable from precisely the places a login is. */
type Target =
  | { readonly kind: 'nowhere' }
  | { readonly kind: 'public'; readonly ports: readonly OpenPort[] }
  | { readonly kind: 'occupant' }
  | {
      readonly kind: 'lan';
      readonly host: LanHost;
      readonly ports: readonly OpenPort[];
      readonly innerGateway: boolean;
    };

const resolveTarget = async (env: CommandEnv, host: string, essid: string): Promise<Target> => {
  if (isPublicIp(host)) {
    const resolution = await env.scan.resolvePublic(host);
    return resolution.found ? { kind: 'public', ports: resolution.ports } : { kind: 'nowhere' };
  }

  // A fellow occupant's services live on THEIR box and cannot be derived from the
  // shared seed — the generated tree keys on the address alone, so reading it here
  // would answer for a machine that is not ours to describe, in the voice of
  // whichever NPC that octet would have rolled. They are up; what they run is
  // theirs to say, which is why an occupant carries no ports and every knock at
  // one goes to the gate. Checked BEFORE the generated LAN so a real occupant wins
  // an octet collision, the same precedence the scan merge and the ssh login take.
  const occupants = await env.scan.resolveOccupants(essid);
  if (occupants.some((occupant) => occupant.localIp === host)) return { kind: 'occupant' };

  const lanHost = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === host);
  if (lanHost === undefined) return { kind: 'nowhere' };
  return {
    kind: 'lan',
    host: lanHost,
    ports: readOpenPorts(resolveLanHostIdentity(lanHost, essid).baseFs),
    innerGateway: isInnerGateway(lanHost),
  };
};

/** Who opened, or that nobody did. The machine id is part of SUCCESS rather than a
 *  field that might be missing: a door that opened onto no box is not a state this
 *  command has to carry a guard for. */
type Knock =
  | {
      readonly ok: true;
      readonly username: string;
      readonly userType: UserType;
      readonly machineId: string;
    }
  | { readonly ok: false };

/** An address nothing holds never reaches a door, so `knock` is only ever handed a
 *  target that resolved — which is what lets each arm below be the last word rather
 *  than one more guard. */
type ReachedTarget = Exclude<Target, { kind: 'nowhere' }>;

/** Knock, and see who opens. This has to be asked of the BOX rather than of the
 *  player's own map of the world: a listener somebody planted lives in that
 *  machine's journal, which only the server replays — so a port this side reads as
 *  closed may still be a door. Netcat opens a socket instead of consulting a table,
 *  and this is that socket. Each arm rides the gate its `ssh` counterpart does, so
 *  how far the knock travels stays the gate's business and who is behind the door
 *  stays the pidfile's. */
const knock = async (
  env: CommandEnv,
  target: ReachedTarget,
  request: { readonly host: string; readonly port: number; readonly essid: string },
  sessionId: string,
): Promise<Knock> => {
  const shared = {
    sessionId,
    port: request.port,
    parentSessionId: env.session.id,
    sourceIp: null,
  };
  if (target.kind === 'public') {
    const opened = await env.nc.connectPublic({
      ...shared,
      target: request.host,
      callerMachineId: env.session.machineId,
    });
    return opened.ok ? { ...opened } : { ok: false };
  }
  if (target.kind === 'occupant') {
    const opened = await env.nc.connectSameLan({
      ...shared,
      essid: request.essid,
      targetIp: request.host,
    });
    return opened.ok ? { ...opened } : { ok: false };
  }
  if (target.innerGateway) {
    const opened = await env.nc.connectInnerGateway({
      ...shared,
      essid: request.essid,
      target: request.host,
    });
    return opened.ok ? { ...opened } : { ok: false };
  }
  // An ordinary host on the player's own LAN: the only arm whose machine id the
  // client can derive for itself, from the same resolver the gate used.
  const opened = await env.nc.connect({
    ...shared,
    essid: request.essid,
    targetIp: request.host,
  });
  return opened.ok
    ? { ...opened, machineId: resolveLanHostIdentity(target.host, request.essid).machineId }
    : { ok: false };
};

/** The service answering on `port`, or null when nothing is. A port with no
 *  catalog row answers the same way a shut one does: there is nothing here that
 *  speaks, which is what a refusal says. */
const serviceOnPort = (ports: readonly OpenPort[], port: number): ServiceSpec | null => {
  const open = ports.find((entry) => entry.port === port);
  if (open === undefined) return null;
  return serviceByName(open.service) ?? null;
};

/** The whole exchange: netcat announces each step before taking it, the far side
 *  greets, and the connection closes — a banner grab is one round trip, not a
 *  session. */
async function* conversation(
  env: CommandEnv,
  host: string,
  port: number,
  banner: string,
): AsyncGenerator<TerminalLine, number> {
  yield text(`Connecting to ${host}:${port}...`);
  await env.sleep(CONNECT_DELAY_MS);
  yield text(`Connected to ${host}.`);
  await env.sleep(BANNER_DELAY_MS);
  yield text(banner);
  yield text('');
  yield text('Connection closed.');
  return 0;
}

/** Leave a listener on this box: refuse unless the line, the caller and the port
 *  are all in order, then write the one file that IS the open port.
 *
 *  The gates read in the order a player meets them — what they typed, then
 *  whether they may, then whether the door is free. Argument shape comes before
 *  privilege because that is the order the same command already answers in
 *  connect mode, and a player learning one mode should not have to learn the
 *  other separately.
 *
 *  No connectivity gate: opening a socket needs a wire, leaving a file does not.
 *  `env.network` follows the player's OWN machine rather than the box the shell
 *  is standing on, so a gate here would refuse plants on a rooted host over the
 *  state of a laptop three hops away. */
const listen = async (env: CommandEnv, rawPort: string | undefined): Promise<CommandResult> => {
  if (rawPort === undefined) return error(USAGE);
  const port = parsePort(rawPort);
  if (port === null) return error(PORT_RANGE);
  if (env.session.userType !== 'root') return error(MUST_BE_ROOT);

  // The raw node, bypassing the caller's read perms, exactly as a daemon checks
  // its own pidfile: whether a port is taken is not a question about who is asking.
  const planted = env.fs.stat(listenerPidfilePath(port));
  if (planted !== null && planted.kind === 'file') {
    return error(`nc: already listening on port ${port}`);
  }
  // Two refusals for two facts. Your own listener is something you can `kill`;
  // the box's sshd is something you would have to stop, which is a different
  // command and a louder one.
  if (readOpenPorts(env.fs.root()).some((entry) => entry.port === port)) {
    return error(`nc: port ${port} already in use`);
  }

  // Permissions are NAMED rather than defaulted, for the reason every other
  // producer names them: a plant takes root, so the caller's own tier defaults
  // would stamp the file root-readable — and the row would then be pruned in
  // transit on exactly the hop where a visitor's `ps` should have shown it.
  const written = await env.patches.write(
    listenerPidfilePath(port),
    formatListenerContent({ port, user: env.session.username, userType: env.session.userType }),
    { isNew: true, permissions: PIDFILE_PERMISSIONS },
  );
  if (!written.ok) return error(`nc: ${PATCH_ERROR_REASON[written.error]}`);

  return { kind: 'sync', lines: [text(`Listening on 0.0.0.0 ${port}`)], exitCode: 0 };
};

const execute: Command['execute'] = async (env, args, flags) => {
  if (flags.get(LISTEN_FLAG) === true) return listen(env, args[0]);

  const host = args[0];
  const rawPort = args[1];
  if (host === undefined || rawPort === undefined) return error(USAGE);
  const port = parsePort(rawPort);
  if (port === null) return error(PORT_RANGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return error(UNREACHABLE);

  if (host === 'localhost' || host === LOOPBACK_IPV4 || host === wlan0.ipv4) {
    return error(OWN_BOX);
  }

  const essid = wlan0.association.essid;
  const target = await resolveTarget(env, host, essid);
  if (target.kind === 'nowhere') return connectError(host, port, 'Connection timed out');

  // A port the catalog can name is answered without asking anyone: a daemon greets
  // and hangs up, which is a banner grab rather than a way in.
  const service = target.kind === 'occupant' ? null : serviceOnPort(target.ports, port);
  if (service !== null) return streamedResult(conversation(env, host, port, service.banner));

  const sessionId = `nc-${port}-${env.now()}`;
  await env.sleep(CONNECT_DELAY_MS);
  const opened = await knock(env, target, { host, port, essid }, sessionId);
  if (!opened.ok) return connectError(host, port, 'Connection refused');

  env.pushSession({
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(opened.machineId),
    username: opened.username,
    userType: opened.userType,
    kind: 'nc',
    createdAt: env.now(),
  });
  env.setCwd(homeDirectory({ username: opened.username, userType: opened.userType }));
  return {
    kind: 'sync',
    lines: [text(`Connecting to ${host}:${port}...`), text(`Connected to ${host}.`)],
    exitCode: 0,
  };
};

export const nc: Command = {
  name: 'nc',
  description: 'Netcat — open a raw connection to a port',
  category: 'network',
  tier: 'guest',
  // Installed, never shipped: netcat is the tool an intruder brings with them, so a
  // box only has it because someone put it there.
  availability: { kind: 'installed-package', packageName: 'netcat' },
  flags: { [LISTEN_FLAG]: 'boolean' },
  manual: {
    synopsis: 'nc <host> <port> | nc -l <port>',
    description:
      'Open a raw connection to a port and print whatever answers. Use it on a port a scan ' +
      'could not name, or to check what a service claims to be. The connection closes as soon ' +
      'as the far side has spoken. With "-l" it does the opposite: it holds a port open on this ' +
      'machine and leaves it there after you log out, which takes root. Connecting requires a ' +
      'network; listening does not. Install with "apt install netcat".',
    arguments: [
      { name: 'host', description: 'The address to connect to, e.g. 192.168.1.5', required: true },
      { name: 'port', description: 'The port to connect to, e.g. 22', required: true },
      { name: '-l', description: 'Listen on <port> instead of connecting (root only)' },
    ],
    examples: [
      { command: 'nc 192.168.1.5 22', description: 'See what is answering on the ssh port' },
      { command: 'nc 192.168.1.5 4444', description: 'Ask an unaccounted-for port what it is' },
      { command: 'nc -l 4444', description: 'Hold port 4444 open on this machine' },
    ],
  },
  execute,
};
