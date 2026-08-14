/**
 * vsftpd — start the FTP server daemon on the current machine.
 *
 * Starting the daemon writes `/var/run/vsftpd.pid` (`vsftpd:port=<N>`), which IS the
 * source of truth for "ftp is up / the port is open" — a later `nmap`/`ftp` reads that
 * file. The pidfile format lives in `core/services/pidfile` so this writer and the
 * world generator stay byte-identical.
 *
 * Deliberately a mirror of `sshd`, down to the order of its gates: a second door that
 * refused differently from the first would be a second set of rules to learn for no
 * gain. What differs is only what the two doors ARE — the pidfile names the program
 * (`vsftpd`) while the catalog names the protocol (`ftp`), and each reader wants its
 * own.
 */

import type { Command, CommandEnv, CommandResult, PatchResult, TerminalLine } from './types';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatPidfileContent, parsePidfilePort, pidfilePath } from '../services/pidfile';
import { errorLine, streamedResult, text } from './streaming';

const FTP = SERVICE_CATALOG.ftp;
const PIDFILE_PATH = pidfilePath(FTP);

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

/** The optional `[port]` arg as a valid 1–65535 integer, the catalog default (21)
 *  when absent, or null when it isn't a valid port. */
const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) return FTP.defaultPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return port;
};

/** The port vsftpd is already listening on (from its pidfile), or null when it isn't
 *  running. A malformed pidfile falls back to the default port. */
const runningPort = (env: CommandEnv): number | null => {
  const node = env.fs.stat(PIDFILE_PATH);
  if (node === null || node.kind !== 'file') return null;
  return parsePidfilePort(node.content) ?? FTP.defaultPort;
};

async function* start(env: CommandEnv, port: number): AsyncGenerator<TerminalLine, number> {
  yield text('Starting FTP server...');
  await env.sleep(STARTUP_DELAY_MS);

  const result = await env.patches.write(PIDFILE_PATH, formatPidfileContent(FTP, port), {
    isNew: true,
  });
  if (!result.ok) {
    yield errorLine(`vsftpd: ${WRITE_ERROR[result.error]}`);
    return 1;
  }

  yield text(`Server listening on 0.0.0.0 port ${port}.`);
  return 0;
}

const execute: Command['execute'] = async (env, args) => {
  if (env.session.userType !== 'root') {
    return errorResult('vsftpd: must be run as root');
  }

  const port = parsePort(args[0]);
  if (port === null) {
    return errorResult(`vsftpd: invalid port: ${args[0]}`);
  }

  const already = runningPort(env);
  if (already !== null) {
    return errorResult(`vsftpd: already running on port ${already}`);
  }

  return streamedResult(start(env, port));
};

export const vsftpd: Command = {
  name: 'vsftpd',
  description: 'FTP server daemon',
  category: 'network',
  tier: 'root',
  // The daemon binary ships in `/usr/sbin` on every machine, as `sshd` does, so the
  // command is meaningful anywhere. The ftp CLIENT is apt-gated instead — the real
  // asymmetry the world already models, since `scp` arrives with openssh and `ftp`
  // does not.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'vsftpd [port]',
    description:
      'Start the FTP server daemon, opening the FTP port (default 21) on this machine so it accepts incoming connections. Must be run as root (run "su" first). Refuses to start if vsftpd is already running.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 21)', required: false }],
    examples: [
      { command: 'vsftpd', description: 'Start the FTP server on the default port 21' },
      { command: 'vsftpd 2121', description: 'Start the FTP server on port 2121' },
    ],
  },
  execute,
};
