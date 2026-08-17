/**
 * ssh — log into a generated remote LAN host (ssh epic, PR 3c).
 *
 * `ssh [-p port] user@host` connects to a host on the player's connected LAN,
 * authenticates the password SERVER-side via the `env.ssh.authenticate` seam (the
 * server regenerates the host's `/etc/passwd` and validates), and on success
 * pushes the remote session onto the hop chain + moves into the remote home. The
 * prompt then reflects the remote box; `ls`/`cat` browse its tree.
 *
 * Reachability is checked LOCALLY from the deterministic generated FS before any
 * password is asked: a target that isn't a host on your LAN is "No route to
 * host"; a host whose `sshd` isn't running on the requested port (default 22,
 * `-p` overrides) is "Connection refused". Only a reachable host prompts. Auth
 * failures (bad password / unknown user collapse to "Permission denied") push no
 * session. The client never claims a tier — the userType comes back server-derived.
 */

import { asMachineId } from '../types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { isInnerGateway, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { parsePidfilePort } from '../services/pidfile';
import type { Command, CommandEnv, CommandResult, Session } from './types';
import type { Directory } from '../filesystem/types';
import { homeDirectory } from '../sessions/homeDirectory';

const DEFAULT_PORT = 22;
const SSHD_PIDFILE = 'sshd.pid';
const USAGE = 'usage: ssh [-p port] user@host';

const errorResult = (content: string, exitCode = 255): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

const connectError = (host: string, port: number, reason: string): CommandResult =>
  errorResult(`ssh: connect to host ${host} port ${port}: ${reason}`);

/** Split `user@host` into its parts, or null if it isn't that shape (empty user
 *  or empty host both reject). */
const parseTarget = (raw: string): { readonly user: string; readonly host: string } | null => {
  const at = raw.indexOf('@');
  if (at <= 0 || at === raw.length - 1) return null;
  return { user: raw.slice(0, at), host: raw.slice(at + 1) };
};

/** `-p <port>` (default 22); a non-numeric/missing/valueless flag falls back to the
 *  default. `raw` is `true` for a bare `-p` and `undefined` when absent — both
 *  non-strings, so one `typeof` guard covers them. */
const parsePort = (raw: string | true | undefined): number => {
  if (typeof raw !== 'string') return DEFAULT_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
};

/** The port a host's `sshd` listens on (from `/var/run/sshd.pid`), or null when no
 *  ssh service is running there. */
const sshPortOf = (fs: Directory): number | null => {
  const varDir = fs.entries.get('var');
  if (varDir === undefined || varDir.kind !== 'directory') return null;
  const run = varDir.entries.get('run');
  if (run === undefined || run.kind !== 'directory') return null;
  const pid = run.entries.get(SSHD_PIDFILE);
  return pid !== undefined && pid.kind === 'file' ? parsePidfilePort(pid.content) : null;
};

/** Cross-player login to a PUBLIC IP (Story 2): the target isn't on the player's
 *  own LAN, so reachability comes from the server via `env.scan.resolvePublic`
 *  (host up? ssh on the asked port?) and auth from `env.ssh.authenticatePublic`,
 *  which lands the session on the OWNER's real workstation id — whose name drives
 *  the prompt hostname. */
const executePublicLogin = async (
  env: CommandEnv,
  target: { readonly user: string; readonly host: string },
  port: number,
  sourceIp: string | null,
): Promise<CommandResult> => {
  const resolution = await env.scan.resolvePublic(target.host);
  if (!resolution.found) {
    return connectError(target.host, port, 'No route to host');
  }
  if (!resolution.ports.some((open) => open.port === port && open.service === 'ssh')) {
    return connectError(target.host, port, 'Connection refused');
  }

  let password: string;
  try {
    password = await env.prompt({
      message: `${target.user}@${target.host}'s password: `,
      masked: true,
    });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const sessionId = `ssh-${target.user}-${env.now()}`;
  const result = await env.ssh.authenticatePublic({
    sessionId,
    target: target.host,
    username: target.user,
    password,
    port,
    parentSessionId: env.session.id,
    sourceIp,
  });
  if (!result.ok) {
    if (result.error === 'invalid_credentials') return errorResult('Permission denied (password).');
    if (result.error === 'host_unreachable') {
      return connectError(target.host, port, 'Connection refused');
    }
    return connectError(target.host, port, 'Network error');
  }

  const session: Session = {
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(result.machineId),
    username: target.user,
    userType: result.userType,
    kind: 'ssh',
    createdAt: env.now(),
  };
  env.pushSession(session);
  env.setCwd(homeDirectory({ username: target.user, userType: result.userType }));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

/** Same-LAN login to a FELLOW OCCUPANT (Story 7): the target is a private IP on the
 *  player's own ESSID owned by another occupant, reached DIRECTLY over the shared LAN
 *  (no router/NAT). Reachability + auth go through `env.ssh.authenticateSameLan`, which
 *  resolves the IP via the ESSID occupancy and lands the session on the OWNER's real
 *  workstation id — whose name drives the prompt hostname. */
const executeSameLanLogin = async (
  env: CommandEnv,
  target: { readonly user: string; readonly host: string },
  port: number,
  sourceIp: string | null,
  essid: string,
): Promise<CommandResult> => {
  let password: string;
  try {
    password = await env.prompt({
      message: `${target.user}@${target.host}'s password: `,
      masked: true,
    });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const sessionId = `ssh-${target.user}-${env.now()}`;
  const result = await env.ssh.authenticateSameLan({
    sessionId,
    essid,
    targetIp: target.host,
    username: target.user,
    password,
    port,
    parentSessionId: env.session.id,
    sourceIp,
  });
  if (!result.ok) {
    if (result.error === 'invalid_credentials') return errorResult('Permission denied (password).');
    if (result.error === 'host_unreachable') {
      return connectError(target.host, port, 'Connection refused');
    }
    return connectError(target.host, port, 'Network error');
  }

  const session: Session = {
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(result.machineId),
    username: target.user,
    userType: result.userType,
    kind: 'ssh',
    createdAt: env.now(),
  };
  env.pushSession(session);
  env.setCwd(homeDirectory({ username: target.user, userType: result.userType }));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

/** Login THROUGH a NAT forward on the player's OWN inner gateway (multi-layer depth):
 *  the forward lives on the gateway's server-side journal, so reachability comes from
 *  `env.scan.resolveInnerGateway` (the gateway's own ports ∪ its live forwards) and auth
 *  from `env.ssh.authenticateInnerGateway`, which routes the forwarded port to the deep
 *  host behind the gateway and lands the session on THAT host's id — whose name drives
 *  the prompt hostname. Only an ssh forward connects; a dark/down gateway is "No route
 *  to host", a port with no live ssh forward is "Connection refused". */
const executeForwardLogin = async (
  env: CommandEnv,
  target: { readonly user: string; readonly host: string },
  port: number,
  sourceIp: string | null,
  essid: string,
): Promise<CommandResult> => {
  const resolution = await env.scan.resolveInnerGateway(essid, target.host);
  if (!resolution.found) {
    return connectError(target.host, port, 'No route to host');
  }
  if (!resolution.ports.some((open) => open.port === port && open.service === 'ssh')) {
    return connectError(target.host, port, 'Connection refused');
  }

  let password: string;
  try {
    password = await env.prompt({
      message: `${target.user}@${target.host}'s password: `,
      masked: true,
    });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const sessionId = `ssh-${target.user}-${env.now()}`;
  const result = await env.ssh.authenticateInnerGateway({
    sessionId,
    essid,
    target: target.host,
    username: target.user,
    password,
    port,
    parentSessionId: env.session.id,
    sourceIp,
  });
  if (!result.ok) {
    if (result.error === 'invalid_credentials') return errorResult('Permission denied (password).');
    if (result.error === 'host_unreachable') {
      return connectError(target.host, port, 'Connection refused');
    }
    return connectError(target.host, port, 'Network error');
  }

  const session: Session = {
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(result.machineId),
    username: target.user,
    userType: result.userType,
    kind: 'ssh',
    createdAt: env.now(),
  };
  env.pushSession(session);
  env.setCwd(homeDirectory({ username: target.user, userType: result.userType }));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

const execute: Command['execute'] = async (env, args, flags) => {
  const rawTarget = args[0];
  if (rawTarget === undefined) return errorResult(USAGE);
  const target = parseTarget(rawTarget);
  if (target === null) return errorResult(USAGE);
  const port = parsePort(flags.get('-p'));

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (
    !env.network.isOnline() ||
    wlan0 === undefined ||
    wlan0.kind !== 'wireless' ||
    wlan0.association === null
  ) {
    return connectError(target.host, port, 'Network is unreachable');
  }
  const essid = wlan0.association.essid;
  const sourceIp = wlan0.ipv4;

  // A public IP isn't on the player's own LAN — route it cross-player (server-side lookup
  // resolution + cross-player auth) instead of the deterministic own-LAN path.
  if (isPublicIp(target.host)) {
    return executePublicLogin(env, target, port, sourceIp);
  }

  // A private IP that belongs to a FELLOW OCCUPANT of this ESSID is reached directly
  // over the shared LAN. Checked BEFORE the generated-LAN path so a real occupant wins
  // an octet collision with a generated NPC — the same precedence the nmap merge uses.
  const occupants = await env.scan.resolveOccupants(essid);
  if (occupants.some((occupant) => occupant.localIp === target.host)) {
    return executeSameLanLogin(env, target, port, sourceIp, essid);
  }

  // Reachability is resolved from the deterministic generated world — no prompt
  // for a host that is down or not listening on the asked port.
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target.host);
  if (host === undefined) {
    return connectError(target.host, port, 'No route to host');
  }
  // The shared resolver maps the host to its machine id + seeded FS — the edge
  // router (`.1`), an inner gateway (a deeper-layer router), or a coordinate-seeded
  // sibling. Reachability reads the FS; the hop is stamped with the same id the
  // server (resolving the same ip → host) lands the session on, so they never
  // disagree about which box you are on.
  const { machineId, baseFs: hostFs } = resolveLanHostIdentity(host, essid);
  // A host not running ssh has a null port, which is `!== port` too — so the one
  // check covers both "no ssh service" and "listening on a different port".
  const runningPort = sshPortOf(hostFs);

  // An inner gateway on a port OTHER than its own sshd is a NAT forward into the deep
  // layer behind it. The forward lives on the gateway's server-side journal (not the
  // client's static FS), so this can't be checked locally — reachability + auth resolve
  // server-side, landing the session on the deep host. The gateway's own port falls
  // through to the own-LAN path below (5b.1a: `ssh root@<inner>` lands on the gateway).
  if (isInnerGateway(host) && port !== runningPort) {
    return executeForwardLogin(env, target, port, sourceIp, essid);
  }

  if (runningPort !== port) {
    return connectError(target.host, port, 'Connection refused');
  }

  let password: string;
  try {
    password = await env.prompt({
      message: `${target.user}@${target.host}'s password: `,
      masked: true,
    });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const sessionId = `ssh-${target.user}-${env.now()}`;
  const result = await env.ssh.authenticate({
    sessionId,
    essid,
    targetIp: target.host,
    username: target.user,
    password,
    parentSessionId: env.session.id,
    sourceIp,
  });
  if (!result.ok) {
    if (result.error === 'invalid_credentials') return errorResult('Permission denied (password).');
    if (result.error === 'host_unreachable') {
      return connectError(target.host, port, 'Connection refused');
    }
    return connectError(target.host, port, 'Network error');
  }

  const session: Session = {
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(machineId),
    username: target.user,
    userType: result.userType,
    kind: 'ssh',
    createdAt: env.now(),
  };
  env.pushSession(session);
  env.setCwd(homeDirectory({ username: target.user, userType: result.userType }));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const ssh: Command = {
  name: 'ssh',
  description: 'Log into a remote machine over SSH',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // No terminal, no password prompt — so a backdoor is a room you can search but
  // not a door you can pivot onward through. That is what a real login buys.
  withoutTty: 'ssh: must be run from a terminal',
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'ssh [-p port] user@host',
    description:
      'Open a login session on a remote host on your network. Connects to the host, ' +
      'prompts for the account password, and on success drops you into that machine ' +
      'with the account’s privileges and home directory. Use "-p" to connect to an ssh ' +
      'service on a non-standard port (default 22). Use "exit" to drop back to your own machine.',
    arguments: [
      {
        name: 'user@host',
        description: 'The account and host IP to log in as, e.g. root@192.168.1.5',
        required: true,
      },
    ],
    examples: [
      { command: 'ssh root@192.168.1.5', description: 'Log into 192.168.1.5 as root' },
      { command: 'ssh -p 2222 admin@192.168.1.9', description: 'Connect to ssh on port 2222' },
    ],
  },
  execute,
};
