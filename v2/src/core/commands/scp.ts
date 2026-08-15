/**
 * scp — carry one file onto a machine you hold a credential for.
 *
 * `scp [-p port] <local-file> <user>@<host>:<path>` opens a session on the target,
 * writes the file through the same gate an `ssh` session's write goes through, and
 * closes the session behind itself.
 *
 * The session is TRANSIENT, and that is forced rather than chosen: the write gate
 * requires an active session row on the target, so create → write → end is the only
 * shape that can write at all. It is also the shape worth having — the row's lifetime
 * is exactly one command, so there is no state left behind to reason about and no
 * cached door to invalidate. An existing session on the same box is deliberately NOT
 * reused: `scp` behaving differently depending on invisible state is a worse bargain
 * than a second, truthful login line.
 *
 * The trace is a LOGIN and nothing more. Real sshd records the authentication before
 * it can know the session is a copy, so no line names the file — which is exactly
 * how this door differs from ftp's, where every byte is itemised. Two doors, two
 * costs: ftp is easier to OPEN and tells on you, scp needs a credential you already
 * earned and takes the file in silence.
 *
 * Reachability is read from the deterministic generated FS before anything is typed,
 * as `ssh` does, and from the SSH daemon specifically: scp reaches exactly what ssh
 * reaches, so a box serving no sshd is shut to it whatever else it runs. The source
 * is validated first of all — a typo that reached the target would put a line in
 * somebody's log for a transfer that was never possible.
 */

import { asMachineId } from '../types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { basename, resolveAbsPath } from '../filesystem/path';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { errorLine, streamedResult, text } from './streaming';
import type { Command, CommandEnv, CommandResult, Session, TerminalLine } from './types';
import type { AbsPath } from '../types';
import type { Directory } from '../filesystem/types';

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

/** The address the player is reaching the target from — their own leased LAN
 *  address, which on their own network is the only one the target could have seen. */
const localAddress = (env: CommandEnv): string | null =>
  env.network.interfaces().find((iface) => iface.kind === 'wireless')?.ipv4 ?? null;

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

const execute: Command['execute'] = async (env, args, flags) => {
  const rawSource = args[0];
  const rawDestination = args[1];
  if (rawSource === undefined || rawDestination === undefined) return failure(USAGE);

  // Whichever operand names a remote decides the direction. Only the upload half
  // exists so far, so a destination that is not remote has nowhere to go.
  const remote = parseRemote(rawDestination);
  if (remote === null) return failure(USAGE);

  // First of all, before a port is looked at or a password asked for: a source that
  // cannot be read is the player's own mistake, and it must not cost them a line in
  // somebody else's log.
  const source = readSource(env, rawSource);
  if (!source.ok) return failure(source.line);

  const essid = env.network.interfaces().find((iface) => iface.kind === 'wireless')?.association
    ?.essid;
  if (essid === undefined || !env.network.isOnline()) {
    return failure('scp: Network is unreachable');
  }

  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === remote.host);
  if (host === undefined) {
    return failure(`scp: connect to host ${remote.host} port 22: No route to host`);
  }

  const { machineId, baseFs } = resolveLanHostIdentity(host, essid);
  // scp rides sshd, so the ssh daemon's pidfile is the whole of what reachability
  // means here. An explicit `-p` has to name that same port: a transfer reaches
  // exactly what a login reaches, never a port the box answers with something else.
  const serving = sshPortOf(baseFs);
  const asked = parsePort(flags.get('-p'));
  const port = asked ?? serving;
  if (serving === null || port !== serving) {
    return failure(`scp: connect to host ${remote.host} port ${port ?? 22}: Connection refused`);
  }

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
  const destination = resolveAbsPath('/' as AbsPath, remote.path);

  return streamedResult(
    (async function* stream(): AsyncGenerator<TerminalLine, number> {
      // Announced BEFORE the round-trip, so the line paints while it is pending
      // rather than narrating it afterwards.
      yield text(`Connecting to ${remote.host}...`);

      const authenticated = await env.scp.authenticate({
        sessionId,
        essid,
        targetIp: remote.host,
        username: remote.user,
        password,
        parentSessionId: env.session.id,
        sourceIp: localAddress(env),
      });
      if (!authenticated.ok) {
        // No row was created, so there is nothing to close behind us.
        yield errorLine(
          authenticated.error === 'invalid_credentials'
            ? 'Permission denied (password).'
            : `scp: connect to host ${remote.host} port ${port}: Connection refused`,
        );
        return 1;
      }

      const session: Session = {
        id: sessionId,
        playerKey: env.identity.publicKeyHex,
        machineId: asMachineId(machineId),
        username: remote.user,
        userType: authenticated.userType,
        kind: 'scp',
        createdAt: env.now(),
      };

      // One atomic write, then the row closes whichever way it went — including the
      // refusal, where a session left open would outlive the command that opened it.
      //
      // No `isNew`, deliberately: that flag says "no base-FS file stood here", and
      // this command never looked. It cannot look until the download half brings a
      // read of the target with it, and claiming knowledge it does not have would be
      // worse than omitting the claim — omission preserves whatever the row already
      // says, which is exactly scp's position.
      const written = await env.scp.write(session, destination, source.content);
      env.scp.end(sessionId);

      if (!written.ok) {
        yield errorLine(`scp: ${destination}: ${WRITE_REFUSAL}`);
        return 1;
      }

      // `100%` is truthful at the moment it prints: the bytes are there. A live
      // progress bar is what an append-only terminal cannot honestly draw.
      yield text(`${basename(source.path)}   100%  ${source.content.length} bytes`);
      return 0;
    })(),
  );
};

export const scp: Command = {
  name: 'scp',
  description: 'Copy a file to a remote machine over SSH',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'scp [-p port] <local-file> <user>@<host>:<path>',
    description:
      'Copy one file from the machine you are standing on to a remote host, using an ' +
      'account on that host. Prompts for the password, transfers the file, and hands ' +
      'the shell straight back — there is no prompt to leave. Use "-p" when the host ' +
      'serves ssh on a non-standard port. The destination directory must already ' +
      'exist; create it with "mkdir -p" first if it does not.',
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
