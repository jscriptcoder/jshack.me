/**
 * scp — carry one file onto a machine you hold a credential for, or take one off it.
 *
 * `scp [-p port] <local-file> <user>@<host>:<path>` opens a session on the target,
 * writes the file through the same gate an `ssh` session's write goes through, and
 * closes the session behind itself. Reverse the operands and the same session reads
 * instead: whichever one names a host is the remote, and that is the whole of how
 * the two directions tell themselves apart.
 *
 * The session is TRANSIENT, and that is forced rather than chosen: the write gate
 * requires an active session row on the target, so create → write → end is the only
 * shape that can write at all. It is also the shape worth having — the row's lifetime
 * is exactly one command, so there is no state left behind to reason about and no
 * cached door to invalidate. An existing session on the same box is deliberately NOT
 * reused: `scp` behaving differently depending on invisible state is a worse bargain
 * than a second, truthful login line.
 *
 * The trace is a LOGIN and nothing more, in BOTH directions. Real sshd records the
 * authentication before it can know the session is a copy, so no line names the file
 * — which is exactly how this door differs from ftp's, where every byte is itemised.
 * Two doors, two costs: ftp is easier to OPEN and tells on you, scp needs a
 * credential you already earned and takes the file in silence.
 *
 * Reachability is read from the deterministic generated FS before anything is typed,
 * as `ssh` does, and from the SSH daemon specifically: scp reaches exactly what ssh
 * reaches, so a box serving no sshd is shut to it whatever else it runs. The LOCAL
 * half is settled first of all, whichever way the file is going — a typo that reached
 * the target would put a line in somebody's log for a transfer never possible.
 */

import { asAbsPath, asMachineId } from '../types.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { isPublicIp } from '../generation/ip.js';
import { addressForTarget } from '../network/resolveName.js';
import { admitOwnBoxLogin, ownBoxVisitFrom } from './ownBoxLogin.js';
import { LOOPBACK_IPV4, LOOPBACK_NAMES } from '../network/interfaces.js';
import { vantageOf } from '../network/vantage.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { basename, dirname, resolveAbsPath } from '../filesystem/path.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { errorLine, streamedResult, text } from './streaming.js';
import type {
  Command,
  CommandEnv,
  CommandResult,
  PatchResult,
  PublicAuthResult,
  Session,
  TerminalLine,
} from './types.js';
import type { AbsPath, UserType } from '../types.js';
import type { Directory } from '../filesystem/types.js';

const USAGE = 'usage: scp [-p port] <local-file> <user>@<host>:<path>';

/** How a refused remote write reads back. The tier that could not write and the
 *  session that has gone are one refusal by the time they reach us, and naming them
 *  apart would be a guess dressed as a diagnosis. */
const WRITE_REFUSAL = 'Permission denied';

/** The remote half of the command line: `user@host:path`. Anything without both an
 *  `@` and a following `:` is a local path, which is how the two operands tell
 *  themselves apart. */
type RemoteOperand = {
  readonly user: string;
  readonly host: string;
  readonly path: string;
};

const parseRemote = (raw: string): RemoteOperand | null => {
  const at = raw.indexOf('@');
  if (at <= 0) return null;
  const colon = raw.indexOf(':', at + 1);
  if (colon <= at + 1 || colon === raw.length - 1) return null;
  return { user: raw.slice(0, at), host: raw.slice(at + 1, colon), path: raw.slice(colon + 1) };
};

/** The port a host's `sshd` listens on, or null when it runs no ssh at all. The
 *  pidfiles are the truth about what is listening — the same source `nmap` reads and
 *  the ftp door checks its own daemon through, so a door the player was SHOWN is a
 *  door that opens. */
const sshPortOf = (fs: Directory): number | null =>
  readOpenPorts(fs).find((open) => open.service === SERVICE_CATALOG.ssh.service)?.port ?? null;

/** `-p <port>`; a bare or non-numeric flag is no port at all, and the caller then
 *  falls back to whatever the target is actually serving. */
const parsePort = (raw: string | true | undefined): number | null => {
  if (typeof raw !== 'string') return null;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : null;
};

/** An answer that needs no round-trip: nothing is pending, so there is nothing to
 *  announce and nothing to pace. Only the path that actually reaches the network
 *  streams. */
const failure = (line: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(line)],
  exitCode: 1,
});

/** Ctrl-C at the password prompt: nothing was sent, so nothing is held and nothing
 *  needs saying. */
const ABORTED: CommandResult = { kind: 'sync', lines: [], exitCode: 130 };

/** Read the local file, or say why not in scp's own voice. A directory is named as
 *  one rather than collapsed into "no such file": it exists, and telling the player
 *  so is what makes the missing `-r` legible instead of mysterious. */
type Source =
  | { readonly ok: true; readonly path: AbsPath; readonly content: string }
  | { readonly ok: false; readonly line: string };

const readSource = (env: CommandEnv, raw: string): Source => {
  const path = resolveAbsPath(env.fs.cwd(), raw);
  const read = env.fs.read(path);
  if (read.ok) return { ok: true, path, content: read.content };
  return {
    ok: false,
    line: `scp: ${path}: ${read.error === 'is_directory' ? 'Is a directory' : 'No such file or directory'}`,
  };
};

/** Where a taken file lands on the box the player is standing on. A destination that
 *  names a directory takes the file in under the name it wore on the box it came
 *  from — which is how `scp host:/etc/passwd ./` means anything at all. A destination
 *  with no containing directory is the player's own typo, caught here so it costs
 *  them nothing in somebody else's log: the same rule the source check follows. */
type Landing =
  | { readonly ok: true; readonly path: AbsPath }
  | { readonly ok: false; readonly line: string };

const resolveLanding = (env: CommandEnv, raw: string, remoteName: string): Landing => {
  const named = resolveAbsPath(env.fs.cwd(), raw);
  const into = env.fs.stat(named);
  const path = into?.kind === 'directory' ? resolveAbsPath(named, remoteName) : named;
  if (env.fs.stat(dirname(path)) === null) {
    return { ok: false, line: `scp: ${path}: No such file or directory` };
  }
  return { ok: true, path };
};

/** How a refused remote read reads back. Missing and sealed are ONE answer, because
 *  telling them apart maps out a box from outside the tier that is allowed to see it
 *  — the argument ftp's `cd` already makes. A directory is neither, and the tier that
 *  reached it could have listed it anyway, so naming it gives nothing away. */
const READ_REFUSAL = {
  not_found: 'No such file or directory',
  permission_denied: 'No such file or directory',
  is_directory: 'not a regular file',
} as const;

/** A round-trip that never completed is OURS, not the target's — and a player told
 *  their file is missing stops looking for something that is probably still there. */
const UNREACHABLE = 'Connection closed by remote host.';

/** What one direction has to say once the session exists. Both directions answer in
 *  this shape so the row is closed by the SAME line of code either way, rather than
 *  by each path remembering to. */
type Transfer = {
  readonly lines: readonly TerminalLine[];
  readonly exitCode: number;
};

/** Ctrl-C once a session is open: nothing lands and nothing is said, matching an
 *  abandoned password prompt. The row is still closed — by the caller, on the way
 *  out, exactly as a completed transfer's is. */
const INTERRUPTED: Transfer = { lines: [], exitCode: 130 };

/** `100%` is truthful at the moment it prints: the bytes are there. A live progress
 *  bar is what an append-only terminal cannot honestly draw. */
const landed = (name: string, bytes: number): Transfer => ({
  lines: [text(`${name}   100%  ${bytes} bytes`)],
  exitCode: 0,
});

const refused = (line: string): Transfer => ({ lines: [errorLine(line)], exitCode: 1 });

/** How a refused write reads back, either end of the transfer. A write that never
 *  reached its destination is OURS, exactly as a read that never did is — and the
 *  player has already been told the file was there, so blaming their tier would send
 *  them hunting a problem they do not have. Everything else collapses: the tier that
 *  could not write and the session that has gone are one refusal by the time they
 *  reach us, and naming them apart would be a guess dressed as a diagnosis. */
const writeRefusal = (
  path: AbsPath,
  error: Extract<PatchResult, { readonly ok: false }>['error'],
): Transfer =>
  error === 'network_error' ? refused(UNREACHABLE) : refused(`scp: ${path}: ${WRITE_REFUSAL}`);

/** Put the file on the target: one atomic write, so a refusal moved nothing.
 *
 *  No `isNew`, deliberately: that flag says "no base-FS file stood here", and this
 *  direction never looks. The read that would let it look belongs to the other
 *  direction and addresses a different box, so claiming knowledge it does not have
 *  would be worse than omitting the claim — omission preserves whatever the row
 *  already says, which is exactly scp's position. */
const carry = async (
  env: CommandEnv,
  session: Session,
  destination: AbsPath,
  source: { readonly path: AbsPath; readonly content: string },
): Promise<Transfer> => {
  const written = await env.scp.write(session, destination, source.content);
  if (!written.ok) return writeRefusal(destination, written.error);
  return landed(basename(source.path), source.content.length);
};

/** Take the file off the target: read at the tier the credential bought, then write
 *  it on the box the player is standing on — the second is their own write, exactly
 *  as if they had typed it into their shell.
 *
 *  Nothing is recorded anywhere. That is the door's whole bargain, and it is true by
 *  construction rather than by suppression: this direction has no ledger to reach. */
const take = async (
  env: CommandEnv,
  session: Session,
  remotePath: AbsPath,
  landing: AbsPath,
): Promise<Transfer> => {
  const read = await env.scp.read(session, remotePath);
  if (!read.ok) {
    return read.error === 'network_error'
      ? refused(UNREACHABLE)
      : refused(`scp: ${remotePath}: ${READ_REFUSAL[read.error]}`);
  }

  // The bytes are in hand and get dropped: a file half-taken is a file the player
  // did not ask for, and this is the last moment nothing has landed.
  if (env.signal.aborted) return INTERRUPTED;

  const written = await env.patches.write(landing, read.content);
  if (!written.ok) return writeRefusal(landing, written.error);
  return landed(basename(remotePath), read.content.length);
};

/** The port scp knocks on when the player names none — sshd's, because the transfer
 *  rides sshd and reaches exactly what a login reaches. */
const SSH_PORT = SERVICE_CATALOG.ssh.defaultPort;

const unreachable = (host: string, port: number): string =>
  `scp: connect to host ${host} port ${port}: Connection refused`;

/** What is on the other end, once something has been established to be there: the
 *  port that answered, and the login that opens a row on whatever is behind it. By
 *  the time a password has been typed the two ways of getting here — a host on the
 *  player's own LAN, and a stranger's box behind a forward — differ in nothing else,
 *  which is why everything after this point is one piece of code. */
type Reach = {
  readonly port: number;
  readonly login: (sessionId: string, password: string) => Promise<Login>;
};

/** A login's answer. Across the network the box is always on SOME network; the
 *  player's own box, reached at home, stands on none of its own. */
type Login =
  | Extract<PublicAuthResult, { readonly ok: false }>
  | {
      readonly ok: true;
      readonly userType: UserType;
      readonly machineId: string;
      readonly essid: string | null;
    };

type Reached =
  | { readonly ok: true; readonly reach: Reach }
  | { readonly ok: false; readonly line: string };

/** Whether `fs`'s sshd answers the port a transfer knocks on — an explicit `-p` has to
 *  name the port it listens on, because a transfer reaches a login's door and never one
 *  the box answers with something else — and which port that knock went to. */
const sshdAnswering = (
  fs: Directory,
  portFlag: string | true | undefined,
): { readonly port: number; readonly open: boolean } => {
  const serving = sshPortOf(fs);
  const port = parsePort(portFlag) ?? serving ?? SSH_PORT;
  return { port, open: port === serving };
};

/** A host on the player's OWN generated LAN: what is listening is deterministic, so
 *  it is settled here before anything is typed. The ssh daemon's pidfile is the whole
 *  of what reachability means — an explicit `-p` has to name that same port, because
 *  a transfer reaches a login's door and never one the box answers with something
 *  else. The machine id is resolvable locally, so the login supplies it rather than
 *  waiting to be told. */
const reachLan = (
  env: CommandEnv,
  remote: RemoteOperand,
  essid: string,
  portFlag: string | true | undefined,
): Reached => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === remote.host);
  if (host === undefined) {
    return { ok: false, line: `scp: connect to host ${remote.host} port ${SSH_PORT}: No route to host` };
  }

  const { machineId, baseFs } = resolveLanHostIdentity(host, essid);
  const door = sshdAnswering(baseFs, portFlag);
  if (!door.open) return { ok: false, line: unreachable(remote.host, door.port) };

  return {
    ok: true,
    reach: {
      port: door.port,
      login: async (sessionId, password) => {
        const authenticated = await env.scp.authenticate({
          sessionId,
          essid,
          targetIp: remote.host,
          username: remote.user,
          password,
          parentSessionId: env.session.id,
          // The box the transfer is run from, so the server places it on that box's
          // network and traces it to that box's address — not the player's home.
          callerMachineId: env.session.machineId,
        });
        return authenticated.ok
          ? { ok: true, userType: authenticated.userType, machineId, essid }
          : authenticated;
      },
    },
  };
};

/** Another player's box, behind the port its owner forwarded. Nothing about it is
 *  derivable here — the forward table lives on THEIR gateway's journal — so both
 *  reachability and the machine id come back from the server. The forward has to be
 *  answered by SSHD: a forward names ONE internal port, so a stranger's ftp door is
 *  not a door this command can open, and a password typed at it would be spent for
 *  nothing. */
const reachPublic = async (
  env: CommandEnv,
  remote: RemoteOperand,
  portFlag: string | true | undefined,
  sourceIp: string | null,
): Promise<Reached> => {
  const port = parsePort(portFlag) ?? SSH_PORT;
  const resolution = await env.scan.resolvePublic(
    remote.host,
    env.session.machineId,
  );
  if (!resolution.found) {
    return { ok: false, line: `scp: connect to host ${remote.host} port ${port}: No route to host` };
  }
  const serving = resolution.ports.some(
    (candidate) => candidate.port === port && candidate.service === SERVICE_CATALOG.ssh.service,
  );
  if (!serving) return { ok: false, line: unreachable(remote.host, port) };

  return {
    ok: true,
    reach: {
      port,
      login: (sessionId, password) =>
        env.scp.authenticatePublic({
          sessionId,
          target: remote.host,
          port,
          username: remote.user,
          password,
          parentSessionId: env.session.id,
          sourceIp,
          // The box this transfer is being RUN from, which is what the target
          // actually saw. A claim, not a credential: the server refuses a caller who
          // holds no session there.
          callerMachineId: env.session.machineId,
        }),
    },
  };
};

/** The player's OWN box, reached at home, answered from its own tree: its own sshd has
 *  to answer, and `admitOwnBoxLogin` decides who gets in. The transfer then runs on the
 *  box the shell already stands on, as the account that login bought — and the session
 *  stands where the shell does, so it carries the network the shell carries: none. */
const reachOwnBox = (
  env: CommandEnv,
  remote: RemoteOperand,
  portFlag: string | true | undefined,
  fromIp: string,
): Reached => {
  const door = sshdAnswering(env.fs.root(), portFlag);
  if (!door.open) return { ok: false, line: unreachable(remote.host, door.port) };

  return {
    ok: true,
    reach: {
      port: door.port,
      login: async (_sessionId, password) => {
        const userType = await admitOwnBoxLogin(env, {
          door: 'scp',
          user: remote.user,
          password,
          fromIp,
        });
        return userType === null
          ? { ok: false, error: 'invalid_credentials' }
          : { ok: true, userType, machineId: env.session.machineId, essid: env.session.essid };
      },
    },
  };
};

/** A host on a deeper layer the shell reaches, resolved like `ssh`'s deep arm: the
 *  box's own ports (a fronting switch's live ACL already filtered) decide reachability,
 *  and the login rides the same `authenticate` endpoint the own-LAN path does, landing
 *  on the id the resolution named. A denied or non-ssh port refuses like a shut one. */
const reachDeep = (
  env: CommandEnv,
  remote: RemoteOperand,
  essid: string,
  machineId: string,
  port: number,
): Reach => ({
  port,
  login: async (sessionId, password) => {
    const authenticated = await env.scp.authenticate({
      sessionId,
      essid,
      targetIp: remote.host,
      username: remote.user,
      password,
      parentSessionId: env.session.id,
      callerMachineId: env.session.machineId,
    });
    return authenticated.ok
      ? { ok: true, userType: authenticated.userType, machineId, essid }
      : authenticated;
  },
});

/** A FELLOW OCCUPANT's box on the shell's LAN, reached directly over shared WiFi: the
 *  owner's id and tier come back from the server, which resolves the IP through the
 *  ESSID occupancy. */
const reachOccupant = (
  env: CommandEnv,
  remote: RemoteOperand,
  essid: string,
  port: number,
  sourceIp: string | null,
): Reach => ({
  port,
  login: (sessionId, password) =>
    env.scp.authenticateSameLan({
      sessionId,
      essid,
      targetIp: remote.host,
      username: remote.user,
      password,
      port,
      parentSessionId: env.session.id,
      sourceIp,
      callerMachineId: env.session.machineId,
    }),
});

/** The box the shell stands on, named `localhost` from a hop. Its live `/var/run` is
 *  the server's to read, so loopback goes on with the port for the server to place and
 *  check. A box the network generates is placed by the own-LAN door, and the transfer
 *  lands where the shell stands; a player's workstation has no address the network gives
 *  it, only its owner's lease, which is the same-LAN door's to read. */
const reachHop = (
  env: CommandEnv,
  remote: RemoteOperand,
  vantage: NonNullable<ReturnType<typeof vantageOf>>,
  portFlag: string | true | undefined,
): Reach => {
  const port = parsePort(portFlag) ?? SSH_PORT;
  const onLoopback = { ...remote, host: LOOPBACK_IPV4 };
  if (vantage.address === null) return reachOccupant(env, onLoopback, vantage.essid, port, null);
  return {
    port,
    login: async (sessionId, password) => {
      const authenticated = await env.scp.authenticate({
        sessionId,
        essid: vantage.essid,
        targetIp: LOOPBACK_IPV4,
        port,
        username: remote.user,
        password,
        parentSessionId: env.session.id,
        callerMachineId: env.session.machineId,
      });
      return authenticated.ok
        ? {
            ok: true,
            userType: authenticated.userType,
            machineId: env.session.machineId,
            essid: vantage.essid,
          }
        : authenticated;
    },
  };
};

/** A private address from the box the shell stands on: a deeper layer the box fronts, a
 *  fellow occupant, or an ordinary generated host — the three ways `ssh` reaches a
 *  private target, in its order so a real occupant wins an octet collision. */
const reachPrivate = async (
  env: CommandEnv,
  remote: RemoteOperand,
  essid: string,
  vantage: NonNullable<ReturnType<typeof vantageOf>>,
  portFlag: string | true | undefined,
  occupantsHere: () => ReturnType<CommandEnv['scan']['resolveOccupants']>,
): Promise<Reached> => {
  for (const segment of vantage.reaches) {
    if (segment.fronting === null) continue;
    const onLayer = resolveDeepScanHosts(essid, segment.fronting, env.fs.root()).hosts.find(
      (entry) => entry.host.ip === remote.host,
    );
    if (onLayer === undefined) continue;
    const port = parsePort(portFlag) ?? SSH_PORT;
    if (!onLayer.ports.some((open) => open.port === port && open.service === SERVICE_CATALOG.ssh.service)) {
      return { ok: false, line: unreachable(remote.host, port) };
    }
    return { ok: true, reach: reachDeep(env, remote, essid, onLayer.machineId, port) };
  }

  const occupants = await occupantsHere();
  if (occupants.some((occupant) => occupant.localIp === remote.host)) {
    return {
      ok: true,
      reach: reachOccupant(env, remote, essid, parsePort(portFlag) ?? SSH_PORT, vantage.address),
    };
  }

  return reachLan(env, remote, essid, portFlag);
};

/** The target named on the command line, reached from where the shell stands, and the
 *  operand as the rest of the transfer should name it. The player's own box, named for
 *  itself at home, is answered from its own tree before anything asks about the
 *  network — loopback needs none. Everything else is reached across it, with a name
 *  turned into the address it routes on. */
const reachTarget = async (
  env: CommandEnv,
  typed: RemoteOperand,
  portFlag: string | true | undefined,
): Promise<{ readonly remote: RemoteOperand; readonly reached: Reached }> => {
  const ownSource = ownBoxVisitFrom(env, typed.host);
  if (ownSource !== null) {
    return { remote: typed, reached: reachOwnBox(env, typed, portFlag, ownSource) };
  }

  // Where the shell stands: the hop on top of the stack, or the player's own WiFi on
  // their own box. Every address below is reached FROM there.
  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
    return { remote: typed, reached: { ok: false, line: 'scp: Network is unreachable' } };
  }
  const essid = vantage.essid;
  // From a hop, `localhost` is the hop: nothing on this side can say what it answers.
  if (LOOPBACK_NAMES.includes(typed.host)) {
    return { remote: typed, reached: { ok: true, reach: reachHop(env, typed, vantage, portFlag) } };
  }

  // Who else is on this LAN, read at most once and from the box the shell stands on, so
  // a hop lists the hop's neighbours — for a name to resolve, and to tell a fellow
  // occupant's box from a generated one.
  let occupantsRead: ReturnType<CommandEnv['scan']['resolveOccupants']> | undefined;
  const occupantsHere = () =>
    (occupantsRead ??= env.scan.resolveOccupants(essid, env.session.machineId));

  // A name becomes the address before anything routes on it, so every path below
  // sees the target it already knows how to reach. A name nothing answers to is left
  // exactly as typed, and falls through to the same unknown-target path an unknown
  // address takes.
  const remote = {
    ...typed,
    host: await addressForTarget({ essid, target: typed.host, resolveOccupants: occupantsHere }),
  };

  const reached = isPublicIp(remote.host)
    ? await reachPublic(env, remote, portFlag, vantage.address)
    : await reachPrivate(env, remote, essid, vantage, portFlag, occupantsHere);
  return { remote, reached };
};

/** Reach the target, hold a session open for exactly one transfer, and close it
 *  behind whatever the transfer had to say. Both directions and both ways of getting
 *  there come through here, so the row's lifetime is one piece of code rather than a
 *  discipline each path has to keep: create → transfer → end, with the end on EVERY
 *  way out. */
const connectAndTransfer = async (params: {
  readonly env: CommandEnv;
  readonly remote: RemoteOperand;
  readonly portFlag: string | true | undefined;
  readonly transfer: (session: Session, remotePath: AbsPath) => Promise<Transfer>;
}): Promise<CommandResult> => {
  const { env } = params;

  const { remote, reached } = await reachTarget(env, params.remote, params.portFlag);
  if (!reached.ok) return failure(reached.line);

  let password: string;
  try {
    password = await env.prompt({
      message: `${remote.user}@${remote.host}'s password: `,
      masked: true,
    });
  } catch {
    return ABORTED;
  }

  const sessionId = `scp-${remote.user}-${env.now()}`;

  return streamedResult(
    (async function* stream(): AsyncGenerator<TerminalLine, number> {
      // Announced BEFORE the round-trip, so the line paints while it is pending
      // rather than narrating it afterwards.
      yield text(`Connecting to ${remote.host}...`);

      const authenticated = await reached.reach.login(sessionId, password);
      if (!authenticated.ok) {
        // No row was created, so there is nothing to close behind us.
        yield errorLine(
          authenticated.error === 'invalid_credentials'
            ? 'Permission denied (password).'
            : unreachable(remote.host, reached.reach.port),
        );
        return 1;
      }

      const session: Session = {
        id: sessionId,
        playerKey: env.identity.publicKeyHex,
        machineId: asMachineId(authenticated.machineId),
        username: remote.user,
        userType: authenticated.userType,
        kind: 'scp',
        createdAt: env.now(),
        essid: authenticated.essid,
      };

      // The remote half of the command line means what a login would have meant by
      // it — an account's own directory — and the tier that decides where that is
      // only exists now. Resolved once, here, so both directions read it the same.
      const remotePath = resolveAbsPath(homeDirectory(session), remote.path);

      const transferred = env.signal.aborted
        ? INTERRUPTED
        : await params.transfer(session, remotePath);
      // Whichever way it went, including an abandoned one: a row outliving the
      // command that opened it is a door held ajar by something that has already
      // printed its last line.
      env.scp.end(sessionId);

      yield* transferred.lines;
      return transferred.exitCode;
    })(),
  );
};

const execute: Command['execute'] = async (env, args, flags) => {
  const rawSource = args[0];
  const rawDestination = args[1];
  if (rawSource === undefined || rawDestination === undefined) return failure(USAGE);

  // Whichever operand names a host is the remote one, and that decides the
  // direction. Two of them is two transient sessions in one command — a door
  // nobody has opened yet, and guessing at it would move a file somewhere nobody
  // asked for.
  const remoteSource = parseRemote(rawSource);
  const remoteDestination = parseRemote(rawDestination);
  const remote = remoteSource ?? remoteDestination;
  if (remote === null || (remoteSource !== null && remoteDestination !== null)) {
    return failure(USAGE);
  }

  // The name a taken file wears is its last segment whichever directory the remote
  // half turns out to resolve against, so where it lands is settled before the
  // account's home is known.
  const remoteName = basename(resolveAbsPath(asAbsPath('/'), remote.path));
  const portFlag = flags.get('-p');

  // The LOCAL half first, before a port is looked at or a password asked for: a
  // mistake on the player's own box is theirs, and it must not cost them a line in
  // somebody else's log.
  if (remoteSource !== null) {
    const landing = resolveLanding(env, rawDestination, remoteName);
    if (!landing.ok) return failure(landing.line);
    return connectAndTransfer({
      env,
      remote,
      portFlag,
      transfer: (session, remotePath) => take(env, session, remotePath, landing.path),
    });
  }

  const source = readSource(env, rawSource);
  if (!source.ok) return failure(source.line);
  return connectAndTransfer({
    env,
    remote,
    portFlag,
    transfer: (session, remotePath) => carry(env, session, remotePath, source),
  });
};

export const scp: Command = {
  name: 'scp',
  description: 'Copy a file to a remote machine over SSH',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // Rides sshd, and prompts for the same password nobody can type here.
  withoutTty: 'scp: must be run from a terminal',
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'scp [-p port] <local-file> <user>@<host>:<path>',
    description:
      'Copy one file from the machine you are standing on to a remote host, using an ' +
      'account on that host. Prompts for the password, transfers the file, and hands ' +
      'the shell straight back — there is no prompt to leave. Use "-p" when the host ' +
      'serves ssh on a non-standard port. The destination directory must already ' +
      'exist; create it with "mkdir -p" first if it does not. Run inside a remote ' +
      'shell, the transfer travels from that box over the network you are on there: it ' +
      'reaches what that box reaches, and the host records that box’s address. ' +
      '"localhost" is the box your shell is on.',
    arguments: [
      { name: 'local-file', description: 'The file to copy, on your own machine', required: true },
      {
        name: 'user@host:path',
        description: 'The account, host and destination path, e.g. root@192.168.1.5:/root/list.txt',
        required: true,
      },
    ],
    examples: [
      {
        command: 'scp /root/passwords.txt root@192.168.1.5:/usr/share/wordlists/passwords.txt',
        description: 'Carry your wordlist onto a box you have rooted',
      },
      {
        command: 'scp -p 2222 notes.txt admin@192.168.1.9:/home/admin/notes.txt',
        description: 'Copy to a host serving ssh on port 2222',
      },
    ],
  },
  execute,
};
