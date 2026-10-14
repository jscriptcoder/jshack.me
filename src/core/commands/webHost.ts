/**
 * Reaching a web server on the player's own LAN — the step every web tool takes
 * before it can ask for anything.
 *
 * `curl`, `gobuster` and `lynx` ask three different questions of the same door:
 * fetch this path, try these paths, render this page. Getting to the door is
 * identical for all three, and it is the step that decides WHICH TREE the request
 * reads — so a second copy drifting from this one is not untidiness, it is one
 * tool reading a machine another tool would have refused.
 *
 * It is one function rather than a handful of helpers because the ORDER is the
 * part worth protecting. A caller that resolved the host before mapping
 * `localhost` onto the address it was leased would read a different tree and key
 * its trace to a different machine — while still sharing every helper.
 *
 * Only the two failures that belong to this step live here, prefixed with the
 * program the caller names. Everything else a web tool can say — a rejected URL,
 * no network, a 404, a cross-network target it cannot serve — stays with the
 * tool, because none of it is about reaching the host.
 */

import type { CommandResult } from './types.js';
import type { Directory } from '../filesystem/types.js';
import type { ParsedUrl } from '../network/http.js';
import type { Vantage } from '../network/vantage.js';
import { errorLine } from './streaming.js';
import { readOpenPorts } from '../services/pidfile.js';
import { webProgramOn } from '../network/webServing.js';
import { resolveLanName } from '../network/resolveName.js';
import { LOOPBACK_IPV4, LOOPBACK_NAMES } from '../network/interfaces.js';

/** A server that was reached, in the terms every caller needs. */
export type ReachedHost = {
  /** The tree to read. */
  readonly fs: Directory;
  /** The network the reached box sits on — what the server keys a trace by. The one the
   *  shell stands on, which at home is the player's own WiFi. */
  readonly essid: string;
  /** The RESOLVED address, never the typed name: the server finds the machine by the
   *  address it leased, and `localhost` names no machine to anyone but us. A loopback
   *  fetch reports the loopback address, so the box logs the visit as local. */
  readonly address: string;
  /** The program serving the web there (`nginx`, `apache2`), for a `Server` header. */
  readonly server: string;
};

/** A finished result carrying lines — narrow enough that a caller with no terminal
 *  to print to can still read what went wrong. */
export type ErrorResult = Extract<CommandResult, { readonly kind: 'sync' }>;

/** Either the host answered, or here is the line the caller returns instead. `unresolved`
 *  is any address but the player's own box at home, which the server answers for, while
 *  `refused` is their own box serving no web on that port. */
export type Reach =
  | { readonly ok: true; readonly host: ReachedHost }
  | {
      readonly ok: false;
      readonly reason: 'unresolved' | 'refused';
      /** The RESOLVED address, as on a reached host: what a caller asks the server
       *  about. */
      readonly address: string;
      readonly failure: ErrorResult;
    };

const error = (message: string): ErrorResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

/** How a failed connect reads, whichever side of the network the target is on — one
 *  sentence shape, so "refused" means the same thing on the LAN and across the world. */
export const connectError = ({
  program,
  host,
  port,
  reason,
}: {
  readonly program: string;
  readonly host: string;
  readonly port: number;
  readonly reason: string;
}): ErrorResult => error(`${program}: (7) Failed to connect to ${host} port ${port}: ${reason}`);

/**
 * Whether `address` is the player's own workstation, at home — by loopback or by the
 * address it leased. That is the ONE box this side reads for itself: its filesystem is
 * the live tree the browser holds, so a `nano` edit or a fresh `mkdir` shows up at once.
 *
 * Every other box is the server's to answer for, because what it serves is in a journal
 * only the server holds. A box the network generates may have had its pages rewritten,
 * its web server stopped or its boot files deleted; a fellow occupant's box is built
 * from their journal; and the tree a shell holds on a box it stands on is pruned to the
 * session's tier, which is not what the box's web server serves.
 */
const isOwnBoxAtHome = ({
  vantage,
  isLoopback,
  address,
}: {
  readonly vantage: Vantage;
  readonly isLoopback: boolean;
  readonly address: string;
}): boolean => vantage.kind === 'home' && (isLoopback || address === vantage.address);

/**
 * Resolve `url`'s host on the network the shell stands on and confirm something is
 * listening there.
 *
 * A host that exists but serves nothing refuses the connection rather than answering
 * emptily, so "unreachable" and "nothing there" stay distinguishable.
 */
export const reachWebHost = ({
  root,
  program,
  url,
  vantage,
}: {
  /** The tree the shell's OWN box holds — the one address on its network whose
   *  filesystem is real rather than generated. */
  readonly root: Directory;
  readonly program: string;
  readonly url: ParsedUrl;
  /** Where the shell stands: the network it is on, its address there, and the layers it
   *  reaches. Every tool asks this one question, so none can reach a network the shell
   *  is not standing on. */
  readonly vantage: Vantage;
}): Reach => {
  const essid = vantage.essid;
  // The names a box answers to for ITSELF resolve to the loopback address, before
  // anything else looks at the target — so the box the shell stands on serves the page,
  // and its log records a local visit, whatever the shell's own LAN address is.
  //
  // A name the network gives one of its own hosts resolves here too, through the same
  // resolver `curl` uses, so an intranet page that links `www-04.<zone>` sends the
  // browser, a followed link and a sweep to the box a curl of that name reaches.
  const isLoopback = LOOPBACK_NAMES.includes(url.host);
  const address = isLoopback ? LOOPBACK_IPV4 : (resolveLanName(essid, url.host)?.ip ?? url.host);
  if (!isOwnBoxAtHome({ vantage, isLoopback, address })) {
    return {
      ok: false,
      reason: 'unresolved',
      address,
      failure: error(`${program}: (6) Could not resolve host: ${url.host}`),
    };
  }

  // Nothing stands between a box and itself, so every port it opened answers, and its
  // own tree names the web server holding it, or nothing when what holds it is not the
  // web.
  const reachable = readOpenPorts(root).some((entry) => entry.port === url.port);
  const server = reachable ? webProgramOn(root, url.port) : undefined;
  if (server === undefined) {
    return {
      ok: false,
      reason: 'refused',
      address,
      failure: connectError({
        program,
        host: url.host,
        port: url.port,
        reason: 'Connection refused',
      }),
    };
  }

  return {
    ok: true,
    host: { fs: root, essid, address, server },
  };
};
