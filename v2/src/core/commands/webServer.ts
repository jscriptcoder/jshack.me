/**
 * nginx / apache2 — start THE web server on the current machine.
 *
 * Two names, one capability. Both write `/var/run/nginx.pid`, because a port can
 * only be bound once: whichever the player installs and starts owns port 80, and
 * the other is refused. The refusal names the CONFLICT ("a web server is already
 * running") rather than the program, since "apache2 is already running" would be
 * false when it was nginx that came up. This mirrors `SERVICE_CATALOG.http`
 * holding one row for the web rather than one row per server program.
 *
 * Root-only, unconditionally — the same gate order as `sshd`. Real Unix reserves
 * ports below 1024 for root, which is tempting to model here, but the root gate
 * already refuses every non-root caller before a port is even parsed: the rule
 * would be an unreachable branch. A high port is refused for the same reason as
 * a low one — you are not root.
 *
 * Unlike `sshd`, neither program ships pre-installed. `apt install nginx` (or
 * `apache2`) puts the binary in `/usr/bin`, and the existing binary-presence gate
 * turns its absence into `command not found` with the install hint, so this
 * module carries no availability logic of its own beyond declaring the package.
 */

import type { Command, CommandEnv, CommandResult, PatchResult, TerminalLine } from './types';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatPidfileContent, parsePidfilePort, pidfilePath } from '../services/pidfile';
import { errorLine, streamedResult, text } from './streaming';

const WEB = SERVICE_CATALOG.http;
const PIDFILE_PATH = pidfilePath(WEB);

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
  lines: [errorLine(content)],
  exitCode: 1,
});

/** The optional `[port]` arg as a valid 1–65535 integer, the catalog default
 *  (80) when absent, or null when it isn't a port. */
const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) return WEB.defaultPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return port;
};

/** The port the web server is already listening on (from the shared pidfile), or
 *  null when nothing is up. A malformed pidfile falls back to the default port. */
const runningPort = (env: CommandEnv): number | null => {
  const node = env.fs.stat(PIDFILE_PATH);
  if (node === null || node.kind !== 'file') return null;
  return parsePidfilePort(node.content) ?? WEB.defaultPort;
};

async function* start(
  env: CommandEnv,
  program: WebServerProgram,
  port: number,
): AsyncGenerator<TerminalLine, number> {
  yield text(`Starting ${program.displayName}...`);
  await env.sleep(STARTUP_DELAY_MS);

  const result = await env.patches.write(PIDFILE_PATH, formatPidfileContent(WEB, port), {
    isNew: true,
  });
  if (!result.ok) {
    yield errorLine(`${program.name}: ${WRITE_ERROR[result.error]}`);
    return 1;
  }

  yield text(`Server listening on 0.0.0.0 port ${port}.`);
  return 0;
}

type WebServerProgram = {
  /** The command name — what the player typed, and what every message is prefixed
   *  with, so a refusal is attributed to the program they actually ran. */
  readonly name: string;
  /** How the program announces itself while starting (`nginx`, `Apache httpd`). */
  readonly displayName: string;
  readonly description: string;
};

/** Build one of the interchangeable server programs. Both share every gate and
 *  the pidfile; only their name, banner, and apt package differ. */
const webServerCommand = (program: WebServerProgram): Command => ({
  name: program.name,
  description: program.description,
  category: 'network',
  tier: 'root',
  availability: { kind: 'installed-package', packageName: program.name },
  manual: {
    synopsis: `${program.name} [port]`,
    description:
      `Start the ${program.displayName} web server, opening the HTTP port (default 80) on this machine and publishing /var/www/html to anyone who can reach it. ` +
      'Must be run as root (run "su" first). Only one web server can run at a time — nginx and apache2 compete for the same port.',
    arguments: [{ name: 'port', description: 'Port to listen on (default: 80)', required: false }],
    examples: [
      { command: program.name, description: 'Serve /var/www/html on the default port 80' },
      { command: `${program.name} 8080`, description: 'Serve it on port 8080 instead' },
    ],
  },
  execute: async (env, args) => {
    if (env.session.userType !== 'root') {
      return errorResult(`${program.name}: must be run as root`);
    }

    const port = parsePort(args[0]);
    if (port === null) {
      return errorResult(`${program.name}: invalid port: ${args[0]}`);
    }

    // The pidfile is shared, so this refuses a second nginx AND an apache2 over a
    // running nginx — one web server, whichever name started it.
    const already = runningPort(env);
    if (already !== null) {
      return errorResult(`${program.name}: web server already running on port ${already}`);
    }

    return streamedResult(start(env, program, port));
  },
});

export const nginx = webServerCommand({
  name: 'nginx',
  displayName: 'nginx',
  description: 'Nginx web server',
});

export const apache2 = webServerCommand({
  name: 'apache2',
  displayName: 'Apache httpd',
  description: 'Apache HTTP server',
});
