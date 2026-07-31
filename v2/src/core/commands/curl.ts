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
 * Two kinds of target, split by the address itself. An address on the player's own LAN
 * resolves locally — including their own, which reads their live filesystem rather than a
 * generated one (see `targetFs`). A PUBLIC address is another player's, and resolves
 * through the server (see `fetchAcrossNetwork`): their journal lives server-side, so
 * their page cannot be rebuilt from this client's world.
 *
 * The local path reads the file itself; the cross-network path asks for it and is handed
 * content. What the two share is the response: both hand the same `responseLines` the
 * same string, so a page looks the same however far away it was.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import type { Directory } from '../filesystem/types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { createFsView } from '../filesystem/fsView';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { parseHttpUrl, resolveWebPath, type ParsedUrl } from '../network/http';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0, LOOPBACK_IPV4 } from '../network/interfaces';

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

/** The names a box answers to for ITSELF. A player testing their own web server types
 *  `localhost` long before they type the address they were leased, and every real box
 *  answers to both — so a failure here would read as a broken server rather than a
 *  missing alias. The address comes from `interfaces`, which already owns it. */
const LOOPBACK_NAMES: readonly string[] = ['localhost', LOOPBACK_IPV4];

/** How a failed connect reads, whichever side of the network the target is on — one
 *  sentence shape, so "refused" means the same thing on the LAN and across the world. */
const connectError = (host: string, port: number, reason: string): CommandResult =>
  error(`curl: (7) Failed to connect to ${host} port ${port}: ${reason}`);

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

/**
 * The filesystem behind `target`, or null when nothing on the LAN answers to that
 * address.
 *
 * The player's own address resolves to their LIVE tree, NOT to a generated one:
 * their box is the only host on the network whose filesystem is real, so pointing
 * the host generator at their own IP would fabricate an NPC page for a box that may
 * publish nothing at all. Reading the live tree is also what makes an edit visible
 * — `nano` on the page changes what a fetch returns, because it is the same tree.
 *
 * Everything downstream is identical for both: a generated host's tree and the
 * player's own are both just trees, so the port check, the web-root confinement,
 * and the read all stay in one place.
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

/** The response, once some target has produced content — identical whether the file came
 *  off a tree on this LAN or off a machine the server materialized. */
const respond = (content: string, includeHeaders: boolean): CommandResult => ({
  kind: 'async',
  lines: responseLines(content, includeHeaders),
  exitCode: async () => 0,
});

/**
 * Fetch from ANOTHER player's public IP — a server round-trip, because the target's
 * journal lives server-side and its page cannot be rebuilt from this client's world.
 *
 * The url path goes over as written. Resolving it to a file is the server's job: this
 * client has no business naming a path on someone else's box, and the document-root
 * confinement has to hold against clients that were never this one.
 */
const fetchAcrossNetwork = async (
  env: CommandEnv,
  url: ParsedUrl,
  includeHeaders: boolean,
): Promise<CommandResult> => {
  const fetched = await env.remote.fetchPublic({
    target: url.host,
    port: url.port,
    path: url.path,
  });
  if (!fetched.ok) {
    // A reached server saying "no such page" is a 404; everything else is a connect
    // failure — the target refused, or we never got to ask.
    if (fetched.error === 'not_found') return error(NOT_FOUND);
    const reason = fetched.error === 'host_unreachable' ? 'Connection refused' : 'Network error';
    return connectError(url.host, url.port, reason);
  }
  return respond(fetched.content, includeHeaders);
};

const execute: Command['execute'] = async (env, args, flags) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const url = parseHttpUrl(raw);
  if (url === null) {
    return error(`curl: (3) URL rejected: ${raw}`);
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error(UNREACHABLE);
  }

  // A public address is not on this LAN by construction, so it can only be reached the
  // way the internet is reached — through the server. Gated on being online first: the
  // player needs a connection either way.
  if (isPublicIp(url.host)) {
    return fetchAcrossNetwork(env, url, flags.has('-i'));
  }

  const essid = wlan0.association.essid;
  // The names a box answers to for ITSELF all resolve to the ONE address it was
  // leased, before anything else looks at the target. That keeps the tree, the port
  // check, and the trace the server writes talking about one machine under one name —
  // `localhost` cannot end up disagreeing with the LAN address about the same box.
  const isLoopback = LOOPBACK_NAMES.includes(url.host);
  const targetAddress = isLoopback ? wlan0.ipv4 : url.host;
  const hostFs = targetFs({ env, essid, ownIp: wlan0.ipv4, target: targetAddress });
  if (hostFs === null) {
    return error(`curl: (6) Could not resolve host: ${url.host}`);
  }

  const listening = readOpenPorts(hostFs).some(
    (entry) => entry.port === url.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!listening) {
    return connectError(url.host, url.port, 'Connection refused');
  }

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
        // The RESOLVED address, never the typed name: the server finds the machine by
        // the address it leased, and `localhost` names no machine to anyone but us.
        target: targetAddress,
        port: url.port,
        path: url.path,
        // A request that arrived over loopback says so, as a real server's log does —
        // the box is both ends of it.
        sourceIp: isLoopback ? LOOPBACK_IPV4 : wlan0.ipv4,
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
