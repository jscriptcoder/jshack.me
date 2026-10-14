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
 * Two kinds of target, split by the address itself. A PUBLIC address resolves through
 * the server (see `fetchPageAcrossNetwork`). An address on the network the shell stands
 * on is read locally only when it is the player's own box at home, which reads its live
 * filesystem (see `reachWebHost`). Every other box there is asked of the server too:
 * what a box serves is in its journal, which lives server-side, and a box the network
 * generates may have been rewritten, stopped or bricked since it was generated.
 *
 * The local path reads the file itself; the others ask for it and are handed content.
 * What they share is the response: all hand the same `responseLines` the same string, so
 * a page looks the same however far away it was.
 */

import type { Command, CommandResult, TerminalLine } from './types.js';
import { parseTypedUrl } from '../network/http.js';
import { isPublicIp } from '../generation/ip.js';
import { addressForTarget } from '../network/resolveName.js';
import { vantageOf } from '../network/vantage.js';
import { fetchPageAcrossNetwork, fetchWebPage } from './webPage.js';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const USAGE = 'curl: usage: curl [-i] [-d <data>] <url> (e.g. http://192.168.1.5)';

/** No connected LAN to reach anything over — offline, or online with no
 *  associated, addressed wlan0. */
const UNREACHABLE = 'curl: (7) Failed to connect — network is unreachable';

const NOT_FOUND = 'curl: (22) The requested URL returned error: 404';

/** What each web program calls itself in a `Server:` header — its product token, as
 *  the real servers send it. No version: what version a service runs is what `nmap -sV`
 *  and the vulnerability system are for, and inventing one here would put a second
 *  answer in the world. */
const SERVER_TOKENS: Readonly<Record<string, string>> = {
  nginx: 'nginx',
  apache2: 'Apache',
};

/** The status lines a response here can carry. */
const STATUS_LINES = {
  200: 'HTTP/1.1 200 OK',
  405: 'HTTP/1.1 405 Method Not Allowed',
} as const;

/** The response. Under `-i` the status line and headers come first, then a blank
 *  line, then the body — the wire order, so what the player sees is what came back. */
type Response = {
  readonly status: keyof typeof STATUS_LINES;
  readonly content: string;
  /** The program that answered (`nginx`, `apache2`). */
  readonly server: string;
  readonly includeHeaders: boolean;
};

async function* responseLines({
  status,
  content,
  server,
  includeHeaders,
}: Response): AsyncIterable<TerminalLine> {
  if (includeHeaders) {
    yield text(STATUS_LINES[status]);
    yield text(`Server: ${SERVER_TOKENS[server]}`);
    yield text(`Content-Length: ${content.length}`);
    yield text('');
  }
  for (const line of content.split('\n')) yield text(line);
}

/** The response, once some target has produced content — identical whether the file came
 *  off a tree on this LAN or off a machine the server materialized. */
const respond = (response: Response): CommandResult => ({
  kind: 'async',
  lines: responseLines(response),
  exitCode: async () => 0,
});

const execute: Command['execute'] = async (env, args, flags) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const typed = parseTypedUrl(raw);
  if (typed === null) {
    return error(`curl: (3) URL rejected: ${raw}`);
  }
  const requested = typed.url;
  // `-d` is what makes the request a POST; the parser hands a valued flag over as text.
  const posted = flags.get('-d');
  const body = typeof posted === 'string' ? posted : undefined;

  // Where the shell stands: the hop on top of the stack and its network, or the
  // player's own WiFi on their own box. At home with no connected, addressed card there
  // is nowhere to reach from; on a hop the player's own card does not matter at all.
  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
    return error(UNREACHABLE);
  }

  // A name becomes the address before anything routes on it, so every path below
  // sees the target it already knows how to reach. Names resolve on the network the
  // shell stands on. A name nothing answers to is left exactly as typed, and falls
  // through to the same unknown-target path an unknown address takes.
  const url = {
    ...requested,
    host: await addressForTarget({
      essid: vantage.essid,
      target: requested.host,
      resolveOccupants: (scanned) => env.scan.resolveOccupants(scanned, env.session.machineId),
    }),
  };

  // A public address is not on this LAN by construction, so it can only be reached the
  // way the internet is reached — through the server. Either way what comes back is the
  // same three outcomes, so only this line knows how far the page was.
  const page = isPublicIp(url.host)
    ? await fetchPageAcrossNetwork({
        program: 'curl',
        url,
        body,
        callerMachineId: env.session.machineId,
        fetchPublic: (params) => env.remote.fetchPublic(params),
      })
    : await fetchWebPage({
        root: env.fs.root(),
        program: 'curl',
        url,
        vantage,
        body,
        callerMachineId: env.session.machineId,
        appendAccessLog: (fetched) => env.log.appendAccessLog(fetched),
        fetchOccupant: (params) => env.remote.fetchOccupant(params),
      });
  if (page.kind === 'unreachable') {
    return page.failure;
  }
  if (page.kind === 'not_found') {
    return error(NOT_FOUND);
  }
  // A server that takes no POST still answers, with a page of its own, and curl prints it
  // as it would any other: the request reached a server, it just said no.
  return respond({
    status: page.kind === 'method_not_allowed' ? 405 : 200,
    content: page.content,
    server: page.server,
    includeHeaders: flags.has('-i'),
  });
};

export const curl: Command = {
  name: 'curl',
  description: 'Transfer data from a URL',
  category: 'network',
  tier: 'guest',
  // The binary ships in /bin on every box, like `ls` — so a fetch is possible from
  // wherever the player currently stands, not only from their own workstation.
  availability: { kind: 'any-machine' },
  flags: { '-i': 'boolean', '-d': 'string' },
  manual: {
    synopsis: 'curl [-i] [-d <data>] <url>',
    description:
      'Fetch a URL over HTTP and print what the server returns. Reaches hosts on the network you are on — your own at home, or the network of a box you have a shell on — e.g. "curl http://192.168.1.5", including your own address once you are running a web server, and any public IP that forwards its web port, by its address or by the domain an institution publishes it under, e.g. "curl http://ridgemont.edu/". The "http://" may be left off, as with real curl: "curl ridgemont.edu" fetches the same page. No login is needed: a web server publishes its document root to whoever asks, and nothing else on the target is readable this way. With -d, curl POSTs a form instead, written as name=value pairs joined by "&", e.g. curl -d "handle=neo&password=s3cret" http://emailit.io/signup; as with real curl, a "&" or "=" inside a value is written %26 or %3D. Most servers take no form and answer 405 Method Not Allowed. Requires a network connection.',
    arguments: [
      {
        name: 'url',
        description: 'The URL to fetch, e.g. http://192.168.1.5/status',
        required: true,
      },
      { name: '-i', description: 'Print the response status line and headers before the body' },
      { name: '-d', description: 'POST this form data instead of fetching, e.g. -d handle=neo' },
    ],
    examples: [
      { command: 'curl http://192.168.1.5', description: 'Fetch the default page from a host' },
      {
        command: 'curl http://192.168.1.5:8080/status',
        description: 'Fetch a path from a server on a non-standard port',
      },
      {
        command: 'curl ridgemont.edu/about.html',
        description: "Fetch a page from an institution's site by its domain, no scheme needed",
      },
      {
        command: 'curl http://203.0.113.7',
        description: "Fetch another player's page across the network — no login needed",
      },
      {
        command: 'curl -d "handle=neo&password=s3cret" http://emailit.io/signup',
        description: 'Sign up for an address at emailit.io by POSTing its form',
      },
    ],
  },
  execute,
};
