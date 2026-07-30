/**
 * curl — fetch a URL over HTTP.
 *
 * The one door that opens with no credential: a web server publishes its document
 * root, so anyone who can reach the port can read what is there. That makes `curl`
 * the first thing a player points at a freshly-scanned host, and the page they get
 * back is recon — versions, paths worth trying, whatever the operator left in a
 * comment.
 *
 * Connecting mirrors what a real client does, in order: parse the URL, resolve the
 * host, check something is listening on the port, then ask for the file. A host that
 * exists but serves nothing refuses the connection rather than returning an empty
 * page, so "unreachable" and "nothing there" stay distinguishable.
 *
 * Only the player's own LAN resolves here. Reaching another player's box by its
 * public IP is a server round-trip (the target's journal lives server-side), which
 * arrives with the cross-player slice.
 */

import type { Command, CommandResult, TerminalLine } from './types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { createFsView } from '../filesystem/fsView';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { parseHttpUrl, resolveWebPath } from '../network/http';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const USAGE = 'curl: usage: curl <url> (e.g. http://192.168.1.5)';

/** No connected LAN to reach anything over — offline, or online with no
 *  associated, addressed wlan0. */
const UNREACHABLE = 'curl: (7) Failed to connect — network is unreachable';

const NOT_FOUND = 'curl: (22) The requested URL returned error: 404';

/** The daemon behind the web service — what the `Server:` header advertises. No
 *  version: what version a service runs is what `nmap -sV` and the vulnerability
 *  system are for, and inventing one here would put a second answer in the world. */
const SERVER_HEADER = SERVICE_CATALOG.http.pidfile.replace(/\.pid$/, '');

/** The response. Under `-i` the status line and headers come first, then a blank
 *  line, then the body — the wire order, so what the player sees is what came back. */
async function* responseLines(
  content: string,
  includeHeaders: boolean,
): AsyncIterable<TerminalLine> {
  if (includeHeaders) {
    yield text('HTTP/1.1 200 OK');
    yield text(`Server: ${SERVER_HEADER}`);
    yield text(`Content-Length: ${content.length}`);
    yield text('');
  }
  for (const line of content.split('\n')) yield text(line);
}

const execute: Command['execute'] = async (env, args, flags) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const url = parseHttpUrl(raw);
  if (url === null) {
    return error(`curl: (3) URL rejected: ${raw}`);
  }

  if (!env.network.isOnline()) {
    return error(UNREACHABLE);
  }
  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (
    wlan0 === undefined ||
    wlan0.kind !== 'wireless' ||
    wlan0.association === null ||
    wlan0.ipv4 === null
  ) {
    return error(UNREACHABLE);
  }

  const essid = wlan0.association.essid;
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === url.host);
  if (host === undefined) {
    return error(`curl: (6) Could not resolve host: ${url.host}`);
  }

  // The target's own filesystem — deterministic from the network + the host, the
  // same tree `nmap` read its ports from, so what a scan advertised is what a fetch
  // finds.
  const hostFs = buildRemoteHostFs(essid, host);
  const listening = readOpenPorts(hostFs).some(
    (entry) => entry.port === url.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!listening) {
    return error(
      `curl: (7) Failed to connect to ${url.host} port ${url.port}: Connection refused`,
    );
  }

  // A path that climbs out of the published directory names nothing, and says so the
  // same way a missing file does — telling a caller their traversal was SPOTTED is
  // itself a hint worth withholding.
  const filePath = resolveWebPath(url.path);
  if (filePath === null) {
    return error(NOT_FOUND);
  }

  // Read as the SERVER, not as the caller: a web server serves its document root
  // under its own account, and the requester has no account on that box at all. The
  // confinement is the document root, not the file permissions.
  const served = createFsView(hostFs, { userType: 'root' }).read(filePath);
  if (!served.ok) {
    return error(NOT_FOUND);
  }

  return {
    kind: 'async',
    lines: responseLines(served.content, flags.has('-i')),
    exitCode: async () => 0,
  };
};

export const curl: Command = {
  name: 'curl',
  description: 'Transfer data from a URL',
  category: 'network',
  tier: 'guest',
  // The binary ships in /bin on every box, like `ls` — so a fetch is possible from
  // wherever the player currently stands, not only from their own workstation.
  availability: { kind: 'any-machine' },
  flags: { '-i': 'boolean' },
  manual: {
    synopsis: 'curl [-i] <url>',
    description:
      'Fetch a URL over HTTP and print what the server returns. Reaches hosts on your own network, e.g. "curl http://192.168.1.5". A web server publishes only its document root, so nothing else on the target is readable this way. Requires a network connection.',
    arguments: [
      {
        name: 'url',
        description: 'The URL to fetch, e.g. http://192.168.1.5/status',
        required: true,
      },
      { name: '-i', description: 'Print the response status line and headers before the body' },
    ],
    examples: [
      { command: 'curl http://192.168.1.5', description: 'Fetch the default page from a host' },
      {
        command: 'curl http://192.168.1.5:8080/status',
        description: 'Fetch a path from a server on a non-standard port',
      },
    ],
  },
  execute,
};
