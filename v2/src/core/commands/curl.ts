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
 * host and check something is listening on the port — `reachWebHost`, the step every
 * web tool shares — then ask for the file.
 *
 * Two kinds of target, split by the address itself. An address on the player's own LAN
 * resolves locally — including their own, which reads their live filesystem rather than a
 * generated one (see `reachWebHost`). A PUBLIC address is another player's, and resolves
 * through the server (see `fetchAcrossNetwork`): their journal lives server-side, so
 * their page cannot be rebuilt from this client's world.
 *
 * The local path reads the file itself; the cross-network path asks for it and is handed
 * content. What the two share is the response: both hand the same `responseLines` the
 * same string, so a page looks the same however far away it was.
 */

import type { Command, CommandResult, TerminalLine } from './types';
import { createFsView } from '../filesystem/fsView';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { parseHttpUrl, resolveWebPath } from '../network/http';
import { isPublicIp } from '../generation/ip';
import { addressForTarget } from '../network/resolveName';
import { connectedWlan0 } from '../network/interfaces';
import { reachWebHost } from './webHost';
import { fetchPageAcrossNetwork } from './webPage';

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

/** The response, once some target has produced content — identical whether the file came
 *  off a tree on this LAN or off a machine the server materialized. */
const respond = (content: string, includeHeaders: boolean): CommandResult => ({
  kind: 'async',
  lines: responseLines(content, includeHeaders),
  exitCode: async () => 0,
});

const execute: Command['execute'] = async (env, args, flags) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const requested = parseHttpUrl(raw);
  if (requested === null) {
    return error(`curl: (3) URL rejected: ${raw}`);
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error(UNREACHABLE);
  }

  // A name becomes the address before anything routes on it, so every path below
  // sees the target it already knows how to reach. A name nothing answers to is left
  // exactly as typed, and falls through to the same unknown-target path an unknown
  // address takes.
  const url = {
    ...requested,
    host: await addressForTarget({
      essid: wlan0.association.essid,
      target: requested.host,
      resolveOccupants: env.scan.resolveOccupants,
    }),
  };

  // A public address is not on this LAN by construction, so it can only be reached the
  // way the internet is reached — through the server. Gated on being online first: the
  // player needs a connection either way.
  if (isPublicIp(url.host)) {
    const page = await fetchPageAcrossNetwork({
      program: 'curl',
      url,
      fetchPublic: (params) => env.remote.fetchPublic(params),
    });
    if (page.kind === 'unreachable') {
      return page.failure;
    }
    if (page.kind === 'not_found') {
      return error(NOT_FOUND);
    }
    return respond(page.content, flags.has('-i'));
  }

  const reached = reachWebHost({ root: env.fs.root(), program: 'curl', url, wlan0 });
  if (!reached.ok) {
    return reached.failure;
  }
  const { fs: hostFs, essid, address, sourceIp } = reached.host;

  // Something answered, so the box that answered records the hit — the server resolves
  // which machine that is and writes its /var/log/access.log itself. Above this line
  // nothing was reached, and an access log belongs to a server that handled a request.
  //
  // Fire-and-forget: the page renders alongside the round-trip rather than waiting on
  // it, and neither a failed write nor an unwired seam can break a fetch that already
  // succeeded.
  try {
    void env.log
      .appendAccessLog({
        essid,
        target: address,
        port: url.port,
        // One fetch is one path. The seam takes a run of them because a path sweep
        // asks many at once; a fetch that named several would be claiming requests it
        // never made.
        paths: [url.path],
        sourceIp,
      })
      .catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the fetch.
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

  return respond(served.content, flags.has('-i'));
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
      'Fetch a URL over HTTP and print what the server returns. Reaches hosts on your own network, e.g. "curl http://192.168.1.5", including your own address once you are running a web server, and any public IP that forwards its web port. No login is needed: a web server publishes its document root to whoever asks, and nothing else on the target is readable this way. Requires a network connection.',
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
      {
        command: 'curl http://203.0.113.7',
        description: "Fetch another player's page across the network — no login needed",
      },
    ],
  },
  execute,
};
