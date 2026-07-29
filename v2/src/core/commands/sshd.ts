/**
 * sshd — start the OpenSSH server daemon on the current machine.
 *
 * Starting the daemon writes `/var/run/sshd.pid` (`sshd:port=<N>`), which IS the
 * source of truth for "ssh is up / the port is open" — a later `nmap`/`ssh` reads
 * that file. The pidfile format lives in `core/services/pidfile` so this writer
 * and the world generator (Slice 2) stay byte-identical.
 *
 * Gates, in order (mirrors `apt`'s "root first"):
 *   - ROOT only: a real `/usr/sbin/sshd` is world-executable but binding the port
 *     and writing the pidfile need root, so a non-root caller is refused BEFORE
 *     any write — modelling that runtime failure as a clean up-front check.
 *   - ALREADY RUNNING: if the pidfile exists the daemon is up; starting again is
 *     refused (you can't bind the port twice), reporting the running port.
 *   - PORT: the optional `[port]` arg must be a 1–65535 integer (default 22).
 *
 * The already-running check reads the pidfile via `fs.stat` (the raw node,
 * bypassing the caller's read perms) — a daemon checks its own pidfile regardless
 * of who invoked it.
 *
 * Bringing the daemon up STREAMS (see `streaming.ts`): the start is announced
 * before the write that opens the port, so the player watches it come up rather
 * than being told afterwards. The gates above refuse instantly and never reached
 * the daemon, so they stay sync.
 */

import type { Command, CommandEnv, CommandResult, PatchResult, TerminalLine } from './types';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatPidfileContent, parsePidfilePort, pidfilePath } from '../services/pidfile';
import { errorLine, streamedResult, text } from './streaming';

const SSH = SERVICE_CATALOG.ssh;
const PIDFILE_PATH = pidfilePath(SSH);

const PORT_MIN = 1;
const PORT_MAX = 65535;

/** Beat between the start announcement and the port coming up, so the daemon
 *  visibly takes a moment even when the write returns instantly. */
const STARTUP_DELAY_MS = 400;

/** patches.write failures, mapped to a daemon-style reason. */
const WRITE_ERROR: Record<Extract<PatchResult, { ok: false }>['error'], string> = {
  no_session: 'Permission denied',
  permission_denied: 'Permission denied',
  network_error: 'I/O error',
  modified_since_open: 'File changed on disk',
};

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

/** The optional `[port]` arg as a valid 1–65535 integer, the catalog default
 *  (22) when absent, or null when it isn't a valid port. */
const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) return SSH.defaultPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return port;
};

/** The port sshd is already listening on (from its pidfile), or null when it
 *  isn't running. A malformed pidfile falls back to the default port. */
const runningPort = (env: CommandEnv): number | null => {
  const node = env.fs.stat(PIDFILE_PATH);
  if (node === null || node.kind !== 'file') return null;
  return parsePidfilePort(node.content) ?? SSH.defaultPort;
};

async function* start(env: CommandEnv, port: number): AsyncGenerator<TerminalLine, number> {
  yield text('Starting OpenSSH server...');
  await env.sleep(STARTUP_DELAY_MS);

  const result = await env.patches.write(PIDFILE_PATH, formatPidfileContent(SSH, port), {
    isNew: true,
  });
  if (!result.ok) {
    yield errorLine(`sshd: ${WRITE_ERROR[result.error]}`);
    return 1;
  }

  yield text(`Server listening on 0.0.0.0 port ${port}.`);
  return 0;
}

const execute: Command['execute'] = async (env, args) => {
  if (env.session.userType !== 'root') {
    return errorResult('sshd: must be run as root');
  }

  const port = parsePort(args[0]);
  if (port === null) {
    return errorResult(`sshd: invalid port: ${args[0]}`);
  }

  const already = runningPort(env);
  if (already !== null) {
    return errorResult(`sshd: already running on port ${already}`);
  }

  return streamedResult(start(env, port));
};

export const sshd: Command = {
  name: 'sshd',
  description: 'OpenSSH server daemon',
  category: 'network',
  tier: 'root',
  // The OpenSSH daemon binary ships on every machine (like the `ssh` client), so
  // the command is meaningful anywhere — on the workstation now, on machines you
  // enter later. (Today's gate is the binary's FS presence; this field is
  // declarative until remote sessions consume it.)
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'sshd [port]',
    description:
      'Start the OpenSSH server daemon, opening the SSH port (default 22) on this machine so it accepts incoming connections. Must be run as root (run "su" first). Refuses to start if sshd is already running.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 22)', required: false }],
    examples: [
      { command: 'sshd', description: 'Start the SSH server on the default port 22' },
      { command: 'sshd 2222', description: 'Start the SSH server on port 2222' },
    ],
  },
  execute,
};
