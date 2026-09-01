/**
 * lynx — read a page instead of reading its source.
 *
 * The fetch is `curl`'s, both halves of it: an address on the player's own LAN is
 * reached through the step every web tool shares (`reachWebHost`), the hit recorded
 * on the box that answered, then the file read beneath its document root; a PUBLIC
 * address is another player's and goes out through the server, which resolves it and
 * writes their log itself. A browsed page and a curled one are the same request —
 * literally the same resolution — so a defender reading their `access.log` cannot
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

import type { Command, CommandResult } from './types';
import { parseHttpUrl } from '../network/http';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0 } from '../network/interfaces';
import { fetchPageAcrossNetwork, fetchWebPage } from './webPage';

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

  // A public address is another player's and is not on this LAN by construction, so
  // it is reached the way the internet is — through the server. Either way what comes
  // back is the same three outcomes, so only this line knows how far the page was.
  const page = isPublicIp(url.host)
    ? await fetchPageAcrossNetwork({
        program: 'lynx',
        url,
        fetchPublic: (params) => env.remote.fetchPublic(params),
      })
    : fetchWebPage({
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
  // A full-screen browser with no screen to open.
  withoutTty: 'lynx: must be run from a terminal',
  withoutScript: 'lynx: cannot be run from a script',
  manual: {
    synopsis: 'lynx <url>',
    description:
      'Open a web page in a full-screen text browser. The page is rendered as readable text — ' +
      'headings, paragraphs and lists — rather than as the markup `curl` prints, so comments ' +
      'and scripts are not shown. Links are numbered: use the arrow keys to select one and ' +
      'Enter to follow it, and Left Arrow or Backspace to go back. Press q or Escape to return ' +
      'to the terminal. Reaches hosts on your own network, including your own address once you ' +
      'are running a web server, and any public IP that forwards its web port. No login is ' +
      'needed: a web server publishes its document root to whoever asks.',
    arguments: [{ name: 'url', description: 'The page to read, e.g. http://192.168.1.5' }],
    examples: [
      { command: 'lynx http://192.168.1.5', description: 'Read a page on a host on your network' },
      {
        command: 'lynx http://localhost',
        description: 'Read the page your own web server is publishing',
      },
      {
        command: 'lynx http://203.0.113.7',
        description: "Read another player's page across the network — no login needed",
      },
    ],
  },
  execute,
};
