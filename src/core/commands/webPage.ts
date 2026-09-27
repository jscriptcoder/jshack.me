/**
 * Fetching one page — behind `curl <url>` and `lynx <url>`, and behind every link
 * followed inside the browser that second command opens.
 *
 * The callers sit on opposite sides of the app: two are commands with a whole
 * environment, the third is a browser screen with a URL and nothing else. What must
 * not differ between them is WHICH TREE the request reads and WHETHER the box that
 * answered hears about it — so all three go through here, and none gets to skip the
 * trace by taking a shorter route to the same file.
 *
 * Two ways to reach a page, split by the address itself: one on the player's own LAN
 * that reads a tree here, and one at another player's public IP that asks the server.
 * They are separate functions rather than one with a branch, because only the caller
 * knows which of the two it is allowed to do — and they return the SAME three
 * outcomes, so nothing downstream has to care how far away the page was.
 *
 * Three outcomes rather than two, because a reader treats them differently and the
 * target's log agrees with the split. A page and a 404 both mean the box ANSWERED:
 * each leaves a line behind, and each is something a browser can put on screen. A
 * host that was never reached leaves no line, because nothing was there to write
 * one — and a browser has nowhere to go, so it stays where it is.
 *
 * It asks for a tree and a way to log rather than for a command environment: the
 * browser has both to hand and no environment to build.
 */

import type { AccessLogFetch, RemoteApi } from './types';
import type { Directory } from '../filesystem/types';
import type { ConnectedWlan0 } from '../network/interfaces';
import type { ParsedUrl } from '../network/http';
import { createFsView } from '../filesystem/fsView';
import { resolveWebPath } from '../network/http';
import { connectError, reachWebHost, type ErrorResult } from './webHost';

export type PageResult =
  /** The box answered with a page — logged. */
  | { readonly kind: 'page'; readonly content: string }
  /** The box answered and had nothing there — logged, because it answered. */
  | { readonly kind: 'not_found' }
  /** Nothing answered, so nothing was logged and nowhere was visited. */
  | { readonly kind: 'unreachable'; readonly failure: ErrorResult };

/** The one line a page read leaves on the box that served it. Fire-and-forget: a
 *  page renders alongside the round-trip, and a failed write must not break a read
 *  that worked. */
const recordVisit = ({
  appendAccessLog,
  fetched,
}: {
  readonly appendAccessLog: (fetched: AccessLogFetch) => Promise<void>;
  readonly fetched: AccessLogFetch;
}): void => {
  try {
    void appendAccessLog(fetched).catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the read.
  }
};

/** The page `url` names on the player's own LAN, and the trace reading it leaves. */
export const fetchWebPage = ({
  root,
  program,
  url,
  wlan0,
  appendAccessLog,
}: {
  readonly root: Directory;
  readonly program: string;
  readonly url: ParsedUrl;
  readonly wlan0: ConnectedWlan0;
  readonly appendAccessLog: (fetched: AccessLogFetch) => Promise<void>;
}): PageResult => {
  const reached = reachWebHost({ root, program, url, wlan0 });
  if (!reached.ok) {
    return { kind: 'unreachable', failure: reached.failure };
  }
  const { fs, essid, address, sourceIp } = reached.host;

  // Logged before the read, so a miss is recorded as readily as a hit: the box was
  // asked either way, and what a defender needs to see is that it was asked.
  recordVisit({
    appendAccessLog,
    fetched: { essid, target: address, port: url.port, paths: [url.path], sourceIp },
  });

  const filePath = resolveWebPath(url.path);
  if (filePath === null) {
    return { kind: 'not_found' };
  }

  // Read as the SERVER: a web server serves its document root under its own
  // account, and the reader has no account on that box at all.
  const served = createFsView(fs, { userType: 'root' }).read(filePath);
  return served.ok ? { kind: 'page', content: served.content } : { kind: 'not_found' };
};

/**
 * The page behind ANOTHER player's public IP — a server round-trip, because the
 * target's journal lives server-side and its page cannot be rebuilt from this
 * client's world.
 *
 * The url path goes over as written. Resolving it to a file is the server's job:
 * this client has no business naming a path on someone else's box, and the
 * document-root confinement has to hold against clients that were never this one.
 * Nothing else goes over — there is no field an address could travel in, which is
 * what makes the line in the target's log the SERVER's word about who called.
 *
 * The same three outcomes as a local read, and for the same reasons. The one
 * distinction worth keeping is inside the third: a target that refused says
 * `Connection refused` with every cause collapsed — dark, bricked, unforwarded,
 * nothing serving the web — while `Network error` means this side never completed
 * the round-trip, and blaming the target for our own outage would be a lie.
 */
export const fetchPageAcrossNetwork = async ({
  program,
  url,
  fetchPublic,
}: {
  readonly program: string;
  readonly url: ParsedUrl;
  readonly fetchPublic: RemoteApi['fetchPublic'];
}): Promise<PageResult> => {
  const fetched = await fetchPublic({ target: url.host, port: url.port, path: url.path });
  if (fetched.ok) {
    return { kind: 'page', content: fetched.content };
  }
  if (fetched.error === 'not_found') {
    return { kind: 'not_found' };
  }
  const reason = fetched.error === 'host_unreachable' ? 'Connection refused' : 'Network error';
  return {
    kind: 'unreachable',
    failure: connectError({ program, host: url.host, port: url.port, reason }),
  };
};
