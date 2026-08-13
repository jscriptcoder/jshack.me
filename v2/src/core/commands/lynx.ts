/**
 * lynx — read a page instead of reading its source.
 *
 * The fetch is `curl`'s, step for step: parse the URL, resolve the host on the
 * player's own LAN, check something is listening, record the hit on the box that
 * answered, then read the file beneath its document root. A browsed page and a
 * curled one are the same request, so a defender reading their `access.log` cannot
 * tell which tool asked.
 *
 * What differs is where the answer goes. A page that came back opens the browser
 * screen; every way of NOT coming back is a message in the TERMINAL, because a
 * browser that opens on a failure has nothing to render. That is why the fetch
 * happens here rather than in the screen — and why following a link, once that
 * lands, is the case that renders its own failures: by then the browser is already
 * open, and closing it to report a 404 would be the wrong shape.
 *
 * `curl` remains worth running on the same page. This shows what a page SAYS; the
 * source shows what its author left in it, and the comments only one of them
 * renders are most of the difference.
 */

import type { Command, CommandEnv, CommandResult } from './types';
import type { Directory } from '../filesystem/types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { createFsView } from '../filesystem/fsView';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { parseHttpUrl, resolveWebPath } from '../network/http';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0, LOOPBACK_IPV4 } from '../network/interfaces';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const USAGE = 'lynx: usage: lynx <url> (e.g. lynx http://192.168.1.5)';

/** No connected LAN to reach anything over — offline, or online with no
 *  associated, addressed wlan0. */
const UNREACHABLE = 'lynx: (7) Failed to connect — network is unreachable';

const NOT_FOUND = 'lynx: (22) The requested URL returned error: 404';

/** Reading another player's page across the network is its own slice — the target's
 *  page lives server-side and cannot be rebuilt from this client's world. Said
 *  plainly rather than resolved as an unknown host, which would be a lie about why. */
const CROSS_NETWORK =
  'lynx: only pages on your own network can be read — cross-network browsing is not supported yet';

/** The names a box answers to for ITSELF. A player testing their own web server
 *  types `localhost` long before the address they were leased. */
const LOOPBACK_NAMES: readonly string[] = ['localhost', LOOPBACK_IPV4];

const connectError = (host: string, port: number, reason: string): CommandResult =>
  error(`lynx: (7) Failed to connect to ${host} port ${port}: ${reason}`);

/**
 * The filesystem behind `target`, or null when nothing on the LAN answers to that
 * address. The player's own address resolves to their LIVE tree, so a page they
 * just edited is the page they read back.
 */
const targetFs = ({
  env,
  essid,
  ownIp,
  target,
}: {
  readonly env: CommandEnv;
  readonly essid: string;
  readonly ownIp: string;
  readonly target: string;
}): Directory | null => {
  if (target === ownIp) return env.fs.root();
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  return host === undefined ? null : buildRemoteHostFs(essid, host);
};

const execute: Command['execute'] = async (env, args) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const url = parseHttpUrl(raw);
  if (url === null) {
    return error(`lynx: (3) URL rejected: ${raw}`);
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error(UNREACHABLE);
  }

  if (isPublicIp(url.host)) {
    return error(CROSS_NETWORK);
  }

  const essid = wlan0.association.essid;
  const isLoopback = LOOPBACK_NAMES.includes(url.host);
  const targetAddress = isLoopback ? wlan0.ipv4 : url.host;
  const hostFs = targetFs({ env, essid, ownIp: wlan0.ipv4, target: targetAddress });
  if (hostFs === null) {
    return error(`lynx: (6) Could not resolve host: ${url.host}`);
  }

  const listening = readOpenPorts(hostFs).some(
    (entry) => entry.port === url.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!listening) {
    return connectError(url.host, url.port, 'Connection refused');
  }

  // Something answered, so the box that answered records the hit — one line for one
  // page read, exactly as one fetch is one line. Fire-and-forget: a page renders
  // alongside the round-trip, and a failed write cannot break a read that worked.
  try {
    void env.log
      .appendAccessLog({
        essid,
        target: targetAddress,
        port: url.port,
        paths: [url.path],
        sourceIp: isLoopback ? LOOPBACK_IPV4 : wlan0.ipv4,
      })
      .catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the read.
  }

  const filePath = resolveWebPath(url.path);
  if (filePath === null) {
    return error(NOT_FOUND);
  }

  // Read as the SERVER: a web server serves its document root under its own
  // account, and the reader has no account on that box at all.
  const served = createFsView(hostFs, { userType: 'root' }).read(filePath);
  if (!served.ok) {
    return error(NOT_FOUND);
  }

  return { kind: 'mode_change', mode: { kind: 'lynx', url: raw, content: served.content } };
};

export const lynx: Command = {
  name: 'lynx',
  description: 'Browse a web page as text',
  category: 'network',
  tier: 'guest',
  // Like `curl`, this runs from wherever the player currently stands.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'lynx <url>',
    description:
      'Open a web page in a full-screen text browser. The page is rendered as readable text — ' +
      'headings, paragraphs and lists — rather than as the markup `curl` prints, so comments ' +
      'and scripts are not shown. Press q or Escape to return to the terminal. Reaches hosts ' +
      'on your own network, including your own address once you are running a web server. No ' +
      'login is needed: a web server publishes its document root to whoever asks.',
    arguments: [{ name: 'url', description: 'The page to read, e.g. http://192.168.1.5' }],
    examples: [
      { command: 'lynx http://192.168.1.5', description: 'Read a page on a host on your network' },
      {
        command: 'lynx http://localhost',
        description: 'Read the page your own web server is publishing',
      },
    ],
  },
  execute,
};
