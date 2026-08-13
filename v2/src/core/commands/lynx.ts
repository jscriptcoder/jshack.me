/**
 * lynx — read a page instead of reading its source.
 *
 * The fetch is `curl`'s: parse the URL, reach the host on the player's own LAN
 * through the step both share (`reachWebHost`), record the hit on the box that
 * answered, then read the file beneath its document root. A browsed page and a
 * curled one are the same request — literally the same resolution — so a defender
 * reading their `access.log` cannot tell which tool asked.
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

import type { Command, CommandResult } from './types';
import { parseHttpUrl } from '../network/http';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0 } from '../network/interfaces';
import { fetchWebPage } from './webPage';

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

  const page = fetchWebPage({
    root: env.fs.root(),
    program: 'lynx',
    url,
    wlan0,
    appendAccessLog: (fetched) => env.log.appendAccessLog(fetched),
  });
  if (page.kind === 'unreachable') {
    return page.failure;
  }
  if (page.kind === 'not_found') {
    return error(NOT_FOUND);
  }

  return { kind: 'mode_change', mode: { kind: 'lynx', url: raw, content: page.content } };
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
