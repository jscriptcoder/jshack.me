/**
 * Fetching one page — the request behind `lynx <url>`, and behind every link
 * followed inside the browser that command opens.
 *
 * The two callers sit on opposite sides of the app: one is a command with a whole
 * environment, the other is a browser screen with a URL and nothing else. What must
 * not differ between them is WHICH TREE the request reads and WHETHER the box that
 * answered hears about it — so both go through here, and neither gets to skip the
 * trace by taking a shorter route to the same file.
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

import type { AccessLogFetch } from './types';
import type { Directory } from '../filesystem/types';
import type { ConnectedWlan0 } from '../network/interfaces';
import type { ParsedUrl } from '../network/http';
import { createFsView } from '../filesystem/fsView';
import { resolveWebPath } from '../network/http';
import { reachWebHost, type ErrorResult } from './webHost';

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
