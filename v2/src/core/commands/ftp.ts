/**
 * ftp — log into a generated LAN host's FTP daemon.
 *
 * `ftp <host> [user]` reaches the box's vsftpd, authenticates SERVER-side through
 * the same endpoint `ssh` uses (one `/etc/passwd`, one tier — the door adds no
 * authorization dimension), and on success leaves the player at an `ftp>` prompt.
 *
 * The session is PARALLEL, not a hop. `ssh` pushes onto the hop chain and moves the
 * cwd, so the shell you were in is gone until you `exit`. An ftp login instead runs
 * ALONGSIDE the shell the player is standing in: the hop chain, the cwd and the tier
 * are untouched, and `quit` hands back a shell that never went anywhere. That is
 * what makes `lls`/`lcd` meaningful later — there are two machines in the room.
 *
 * Reachability is checked LOCALLY from the deterministic generated FS before any
 * password is asked, exactly as `ssh` does: only ~a third of hosts run the daemon,
 * so a box with no ftp door must refuse before prompting rather than take a
 * credential and hand it to a service that isn't there.
 */

import { asMachineId } from '../types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { isPublicIp } from '../generation/ip';
import { addressForTarget } from '../network/resolveName';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Command, CommandEnv, CommandResult, PublicAuthResult, Session } from './types';

const USAGE = 'usage: ftp [-p port] <host> [user]';

const errorResult = (content: string, exitCode = 1): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/** `-p <port>`, defaulting to the ftp door's own port rather than ssh's — a bare or
 *  non-numeric flag falls back the same way. */
const parsePort = (raw: string | true | undefined): number => {
  const port = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(port) && port > 0 ? port : SERVICE_CATALOG.ftp.defaultPort;
};

/** Ctrl-C at either prompt: nothing was sent, nothing is held. */
const ABORTED: CommandResult = { kind: 'sync', lines: [], exitCode: 130 };

const greeting = (target: string) => [
  { kind: 'text' as const, content: `Connected to ${target}.` },
  { kind: 'text' as const, content: '220 (vsFTPd 3.0.3)' },
];

type Credential = { readonly username: string; readonly password: string };

/** Ask the way a real client does: an account named on the command line skips the Name
 *  prompt, otherwise the player's own account is the offered default. `null` for an
 *  abort at either prompt. */
const askCredential = async (
  env: CommandEnv,
  target: string,
  named: string | undefined,
): Promise<Credential | null> => {
  try {
    const username =
      named ??
      (await env.prompt({ message: `Name (${target}:${env.session.username}): `, masked: false }));
    const password = await env.prompt({ message: 'Password: ', masked: true });
    return { username, password };
  } catch {
    return null;
  }
};

/** A rejected credential is the daemon answering (530, after its banner); anything else
 *  never got that far, so it reads as a connection that failed. */
const refusal = (target: string, error: string): CommandResult =>
  error === 'invalid_credentials'
    ? {
        kind: 'sync',
        lines: [...greeting(target), { kind: 'error', content: '530 Login incorrect.' }],
        exitCode: 1,
      }
    : errorResult('ftp: connect: Connection refused');

const accepted = (env: CommandEnv, target: string, session: Session): CommandResult => {
  env.ftp.enter(session);
  return {
    kind: 'sync',
    lines: [...greeting(target), { kind: 'text', content: '230 Login successful.' }],
    exitCode: 0,
  };
};

/** The address the client reports for itself. Truthful on the player's own LAN, where
 *  it is the only address the target could have seen; on a public target the server
 *  derives it instead, and this is kept only for the session row. */
const localAddress = (env: CommandEnv): string | null =>
  env.network.interfaces().find((iface) => iface.kind === 'wireless')?.ipv4 ?? null;

/** A host on the player's OWN generated LAN: reachability is deterministic, so it is
 *  resolved here before anything is typed. */
const lanLogin = async (
  env: CommandEnv,
  target: string,
  essid: string,
  named: string | undefined,
): Promise<CommandResult> => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined) return errorResult(`ftp: connect: No route to host`);

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads, so a door the player was shown is a door that opens.
  const { baseFs, machineId } = resolveLanHostIdentity(host, essid);
  const open = readOpenPorts(baseFs).find((port) => port.service === SERVICE_CATALOG.ftp.service);
  if (open === undefined) return errorResult('ftp: connect: Connection refused');

  const credential = await askCredential(env, target, named);
  if (credential === null) return ABORTED;

  const sessionId = `ftp-${credential.username}-${env.now()}`;
  const result = await env.ftp.authenticate({
    sessionId,
    essid,
    targetIp: target,
    username: credential.username,
    password: credential.password,
    parentSessionId: env.session.id,
    sourceIp: localAddress(env),
  });
  if (!result.ok) return refusal(target, result.error);

  return accepted(env, target, {
    id: sessionId,
    playerKey: env.identity.publicKeyHex,
    machineId: asMachineId(machineId),
    username: credential.username,
    userType: result.userType,
    kind: 'ftp',
    createdAt: env.now(),
  });
};

/** Another player's box, behind the port its owner forwarded. Nothing about it is
 *  derivable here — the forward table lives on THEIR gateway's journal — so both
 *  reachability and the machine id come back from the server. */
const publicLogin = async (
  env: CommandEnv,
  target: string,
  port: number,
  named: string | undefined,
): Promise<CommandResult> => {
  const resolution = await env.scan.resolvePublic(target);
  if (!resolution.found) return errorResult('ftp: connect: No route to host');
  // The port has to be answered by THIS daemon: a forward names one internal port, so
  // a stranger's :2121 reaching their sshd is not a door this command can open, and a
  // password typed at it would be handed over for nothing.
  const open = resolution.ports.some(
    (candidate) => candidate.port === port && candidate.service === SERVICE_CATALOG.ftp.service,
  );
  if (!open) return errorResult('ftp: connect: Connection refused');

  const credential = await askCredential(env, target, named);
  if (credential === null) return ABORTED;

  const sessionId = `ftp-${credential.username}-${env.now()}`;
  const result: PublicAuthResult = await env.ftp.authenticatePublic({
    sessionId,
    target,
    port,
    username: credential.username,
    password: credential.password,
    parentSessionId: env.session.id,
    sourceIp: localAddress(env),
    // The box this command is being RUN from, which is what the target actually saw.
    // A claim, not a credential: the server refuses a caller who holds no session there.
    callerMachineId: env.session.machineId,
  });
  if (!result.ok) return refusal(target, result.error);

  return accepted(env, target, {
    id: sessionId,
    playerKey: env.identity.publicKeyHex,
    machineId: asMachineId(result.machineId),
    username: credential.username,
    userType: result.userType,
    kind: 'ftp',
    createdAt: env.now(),
  });
};

const execute: Command['execute'] = async (env, args, flags) => {
  const requested = args[0];
  if (requested === undefined) return errorResult(USAGE);

  const essid = env.network.interfaces().find((iface) => iface.kind === 'wireless')?.association
    ?.essid;
  if (essid === undefined || !env.network.isOnline()) {
    return errorResult('ftp: connect: Network is unreachable');
  }

  // A name becomes the address before anything routes on it, so every path below
  // sees the target it already knows how to reach. A name nothing answers to is left
  // exactly as typed, and falls through to the same unknown-target path an unknown
  // address takes.
  const target = await addressForTarget({
    essid,
    target: requested,
    resolveOccupants: env.scan.resolveOccupants,
  });

  return isPublicIp(target)
    ? publicLogin(env, target, parsePort(flags.get('-p')), args[1])
    : lanLogin(env, target, essid, args[1]);
};

export const ftp: Command = {
  name: 'ftp',
  description: 'Transfer files to and from a remote machine over FTP',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  // Prompts for a name and a password before its sub-shell ever opens.
  withoutTty: 'ftp: must be run from a terminal',
  withoutScript: 'ftp: cannot be run from a script',
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'ftp [-p port] <host> [user]',
    description:
      'Open a file-transfer session on a remote host running an FTP server. Prompts ' +
      'for the account password and, on success, leaves you at an "ftp>" prompt where ' +
      'you browse the remote machine and move files between it and your own. Your shell ' +
      'stays exactly where it was — "quit" hands it straight back.',
    arguments: [
      { name: 'host', description: 'The host IP to connect to, e.g. 192.168.1.5', required: true },
      {
        name: 'user',
        description: 'The account to log in as. Omitted, you are asked for it.',
        required: false,
      },
    ],
    examples: [
      { command: 'ftp 192.168.1.5', description: 'Connect to the FTP server on 192.168.1.5' },
      { command: 'ftp 192.168.1.5 guest', description: 'Connect as the guest account' },
      {
        command: 'ftp -p 2121 203.0.113.7 guest',
        description: "Connect through a forwarded port on someone else's public address",
      },
    ],
  },
  execute,
};
