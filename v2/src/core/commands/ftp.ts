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
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Command, CommandEnv, CommandResult, Session } from './types';

const USAGE = 'usage: ftp <host> [user]';

const errorResult = (content: string, exitCode = 1): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const target = args[0];
  if (target === undefined) return errorResult(USAGE);

  const essid = env.network.interfaces().find((iface) => iface.kind === 'wireless')?.association
    ?.essid;
  if (essid === undefined || !env.network.isOnline()) {
    return errorResult('ftp: connect: Network is unreachable');
  }

  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined) return errorResult(`ftp: connect: No route to host`);

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads, so a door the player was shown is a door that opens.
  const { baseFs, machineId } = resolveLanHostIdentity(host, essid);
  const open = readOpenPorts(baseFs).find(
    (port) => port.service === SERVICE_CATALOG.ftp.service,
  );
  if (open === undefined) return errorResult('ftp: connect: Connection refused');

  const lines = [
    { kind: 'text' as const, content: `Connected to ${target}.` },
    { kind: 'text' as const, content: '220 (vsFTPd 3.0.3)' },
  ];

  let username = args[1];
  try {
    // An account named on the command line skips the Name prompt, exactly as a real
    // client does; otherwise the player's own account is the offered default.
    username =
      username ??
      (await env.prompt({
        message: `Name (${target}:${env.session.username}): `,
        masked: false,
      }));
    const password = await env.prompt({ message: 'Password: ', masked: true });

    const sessionId = `ftp-${username}-${env.now()}`;
    const result = await env.ftp.authenticate({
      sessionId,
      essid,
      targetIp: target,
      username,
      password,
      parentSessionId: env.session.id,
      sourceIp: env.network.interfaces().find((iface) => iface.kind === 'wireless')?.ipv4 ?? null,
    });

    if (!result.ok) {
      if (result.error === 'invalid_credentials') {
        return {
          kind: 'sync',
          lines: [...lines, { kind: 'error', content: '530 Login incorrect.' }],
          exitCode: 1,
        };
      }
      return errorResult('ftp: connect: Connection refused');
    }

    const session: Session = {
      id: sessionId,
      playerKey: env.identity.publicKeyHex,
      machineId: asMachineId(machineId),
      username,
      userType: result.userType,
      kind: 'ftp',
      createdAt: env.now(),
    };
    env.ftp.enter(session);
    return {
      kind: 'sync',
      lines: [...lines, { kind: 'text', content: '230 Login successful.' }],
      exitCode: 0,
    };
  } catch {
    // Ctrl-C at either prompt: nothing was sent, nothing is held.
    return { kind: 'sync', lines: [], exitCode: 130 };
  }
};

export const ftp: Command = {
  name: 'ftp',
  description: 'Transfer files to and from a remote machine over FTP',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  flags: {},
  manual: {
    synopsis: 'ftp <host> [user]',
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
    ],
  },
  execute,
};
