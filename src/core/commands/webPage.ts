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
 * Two ways to reach a page, split by the address itself: one on the network the shell
 * stands on, and one at a public IP that asks the server. They are separate functions
 * rather than one with a branch, because only the caller knows which of the two it is
 * allowed to do — and they return the SAME three outcomes, so nothing downstream has to
 * care how far away the page was.
 *
 * On the network the shell stands on, only the player's own box at home is read here.
 * Every other box (one the network generates, or a fellow occupant's) is served from a
 * journal only the server has, so it is asked of the server. So is loopback in a shell
 * on any box but the player's own, which is the same box by its other name.
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

import type { AccessLogFetch, MailLogin, RemoteApi } from './types.js';
import type { Directory } from '../filesystem/types.js';
import type { MachineId } from '../types.js';
import type { Vantage } from '../network/vantage.js';
import type { ParsedUrl } from '../network/http.js';
import { createFsView } from '../filesystem/fsView.js';
import { METHOD_NOT_ALLOWED_PAGE, resolveWebPath } from '../network/http.js';
import { connectError, reachWebHost, type ErrorResult, type Reach } from './webHost.js';
import { siteAddress } from '../generation/publisher.js';
import { TALKIT_DOMAIN } from '../generation/fixedSites.js';

export type PageResult =
  /** The box answered with a page — logged. `server` is the program that answered. */
  | { readonly kind: 'page'; readonly content: string; readonly server: string }
  /** The box answered and had nothing there — logged, because it answered. */
  | { readonly kind: 'not_found' }
  /** The box answered a POST it does not take, with its 405 page — logged, because it
   *  answered. */
  | {
      readonly kind: 'method_not_allowed';
      readonly content: typeof METHOD_NOT_ALLOWED_PAGE;
      readonly server: string;
    }
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

/**
 * The page at any address but the player's own box at home. The server says which box
 * it is (a fellow occupant's, or one the network generates), serves the page off its
 * journal and records the visit there itself, so nothing is logged from here. It is asked about the
 * RESOLVED address: `localhost` names no machine to it, and the loopback address names
 * the box the shell stands on.
 *
 * An address the server finds nobody at stays what it was before anybody was asked:
 * unresolved. So does one it could not be asked about, since an outage of ours says
 * nothing about the address.
 */
const fetchFromOccupant = async ({
  unresolved,
  program,
  url,
  essid,
  body,
  callerMachineId,
  fetchOccupant,
}: {
  readonly unresolved: Extract<Reach, { readonly ok: false }>;
  readonly program: string;
  readonly url: ParsedUrl;
  readonly essid: string;
  readonly body: string | undefined;
  readonly callerMachineId: MachineId;
  readonly fetchOccupant: RemoteApi['fetchOccupant'];
}): Promise<PageResult> => {
  const fetched = await fetchOccupant({
    essid,
    target: unresolved.address,
    port: url.port,
    path: url.path,
    ...(body === undefined ? {} : { body }),
    callerMachineId,
  });
  if (fetched.ok) {
    return { kind: 'page', content: fetched.content, server: fetched.server };
  }
  if (fetched.error === 'not_found') {
    return { kind: 'not_found' };
  }
  if (fetched.error === 'method_not_allowed') {
    return { kind: 'method_not_allowed', content: METHOD_NOT_ALLOWED_PAGE, server: fetched.server };
  }
  if (fetched.error === 'connection_refused') {
    return {
      kind: 'unreachable',
      failure: connectError({
        program,
        host: url.host,
        port: url.port,
        reason: 'Connection refused',
      }),
    };
  }
  return { kind: 'unreachable', failure: unresolved.failure };
};

/** The page `url` names on the network the shell stands on, and the trace reading it
 *  leaves. The vantage decides what is reachable and where from; `callerMachineId` is
 *  the box it ran on, which the server places the caller by. */
export const fetchWebPage = async ({
  root,
  program,
  url,
  vantage,
  body,
  callerMachineId,
  appendAccessLog,
  fetchOccupant,
}: {
  readonly root: Directory;
  readonly program: string;
  readonly url: ParsedUrl;
  readonly vantage: Vantage;
  /** A form to POST. No box on a LAN takes one: a server that answers refuses it. */
  readonly body?: string | undefined;
  readonly callerMachineId: MachineId;
  readonly appendAccessLog: (fetched: AccessLogFetch) => Promise<void>;
  readonly fetchOccupant: RemoteApi['fetchOccupant'];
}): Promise<PageResult> => {
  const reached = reachWebHost({ root, program, url, vantage });
  if (!reached.ok) {
    return reached.reason === 'unresolved'
      ? fetchFromOccupant({
          unresolved: reached,
          program,
          url,
          essid: vantage.essid,
          body,
          callerMachineId,
          fetchOccupant,
        })
      : { kind: 'unreachable', failure: reached.failure };
  }
  const { fs, essid, address, server } = reached.host;

  // Logged before the read, so a miss is recorded as readily as a hit: the box was
  // asked either way, and what a defender needs to see is that it was asked.
  recordVisit({
    appendAccessLog,
    fetched: {
      essid,
      target: address,
      port: url.port,
      paths: [url.path],
      ...(body === undefined ? {} : { method: 'POST' as const }),
      callerMachineId,
    },
  });
  if (body !== undefined) {
    return { kind: 'method_not_allowed', content: METHOD_NOT_ALLOWED_PAGE, server };
  }

  const filePath = resolveWebPath(url.path);
  if (filePath === null) {
    return { kind: 'not_found' };
  }

  // Read as the SERVER: a web server serves its document root under its own
  // account, and the reader has no account on that box at all.
  const served = createFsView(fs, { userType: 'root' }).read(filePath);
  return served.ok ? { kind: 'page', content: served.content, server } : { kind: 'not_found' };
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
  body,
  callerMachineId,
  mailLogin,
  fetchPublic,
}: {
  readonly program: string;
  readonly url: ParsedUrl;
  /** A form to POST, sent as typed. Whether anything takes it is the far server's call. */
  readonly body?: string | undefined;
  readonly callerMachineId: MachineId;
  /** The emailit.io login the reader keeps, or null for none; read only when a form is
   *  posted to talkit.io. Absent, the caller has none to offer. */
  readonly mailLogin?: () => MailLogin | null;
  readonly fetchPublic: RemoteApi['fetchPublic'];
}): Promise<PageResult> => {
  // talkit.io's forms ask for no login: the one the reader keeps for emailit.io goes with
  // the form, as a browser sends a cookie to its own site and to no other.
  const login =
    body !== undefined && url.host === siteAddress(TALKIT_DOMAIN) ? (mailLogin?.() ?? null) : null;
  const fetched = await fetchPublic({
    target: url.host,
    port: url.port,
    path: url.path,
    ...(body === undefined ? {} : { body }),
    ...(login === null ? {} : { login }),
    callerMachineId,
  });
  if (fetched.ok) {
    return { kind: 'page', content: fetched.content, server: fetched.server };
  }
  if (fetched.error === 'not_found') {
    return { kind: 'not_found' };
  }
  if (fetched.error === 'method_not_allowed') {
    return { kind: 'method_not_allowed', content: METHOD_NOT_ALLOWED_PAGE, server: fetched.server };
  }
  const reason = fetched.error === 'host_unreachable' ? 'Connection refused' : 'Network error';
  return {
    kind: 'unreachable',
    failure: connectError({ program, host: url.host, port: url.port, reason }),
  };
};
