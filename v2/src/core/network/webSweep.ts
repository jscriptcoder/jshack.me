/**
 * What one word of a path list finds on a web server — the single definition of a
 * probe, shared by the sweep a player runs against their own network and the one the
 * server runs on their behalf against somebody else's.
 *
 * It exists as one function because two readings would mean a path found by a sweep
 * of a neighbour and missed by a sweep of a stranger, for no reason a player could
 * ever see. The same rule already holds for reaching a host and for resolving a url.
 *
 * Read as the SERVER, like every other web read: a web server serves its document
 * root under its own account, and a sweeper has no account on that box at all. The
 * confinement is the document root, never the file permissions.
 *
 * A word naming a DIRECTORY is a hit when that directory holds an index — a real
 * server redirects to the trailing-slash form and serves it, which is exactly how a
 * player finds a folder they were never linked to. That retry costs a second request,
 * and both are reported as `asked`: what the TARGET is told about, as opposed to what
 * the sweeper is shown. A directory with no index serves nothing and is not a find.
 */

import type { Directory } from '../filesystem/types';
import { createFsView } from '../filesystem/fsView';
import { resolveWebPath } from './http';

/** One request that reached the server, and what it answered with. */
export type ProbedPath = {
  /** The url path AS ASKED FOR, never as resolved: a request that resolved to
   *  nothing is exactly the line a defender needs to see. */
  readonly path: string;
  readonly status: number;
  /** Bytes returned; `0` for a response with no body. */
  readonly size: number;
};

export type SweptWord = {
  /** Every request this one word cost, in the order tried. */
  readonly asked: readonly ProbedPath[];
  /** The one a player acts on — the address they can go and fetch — or null. */
  readonly found: ProbedPath | null;
};

const FOUND = 200;
const NOT_FOUND = 404;

const missAt = (path: string): ProbedPath => ({ path, status: NOT_FOUND, size: 0 });

export const isFound = (probed: ProbedPath): boolean => probed.status === FOUND;

export const sweepWord = (tree: Directory, word: string): SweptWord => {
  const view = createFsView(tree, { userType: 'root' });
  const requestPath = `/${word}`;
  const filePath = resolveWebPath(requestPath);
  // A path that climbs out of the published directory names nothing, and is not
  // distinguishable from a miss — telling a sweeper their traversal was SPOTTED is
  // itself a hint worth withholding. The TARGET is still told it was asked: silence
  // is owed to the attacker, not to the box's owner.
  const served = filePath === null ? null : view.read(filePath);
  if (served !== null && served.ok) {
    const hit = { path: requestPath, status: FOUND, size: served.content.length };
    return { asked: [hit], found: hit };
  }

  const missed = missAt(requestPath);
  // Known-equivalent under mutation, deliberately kept: removing this guard only
  // makes every miss take the directory retry as well, which fails the same way
  // (nothing can live under a path that does not exist) — but it would cost the
  // target a second logged request for every word that found nothing, doubling the
  // wall a defender reads. It states the intent and saves the work.
  if (served === null || served.error !== 'is_directory') {
    return { asked: [missed], found: null };
  }

  const indexPath = resolveWebPath(`${requestPath}/`);
  // Required by the type rather than by a case: a path that escaped the document
  // root already returned above, so appending a slash cannot escape either.
  const index = indexPath === null ? null : view.read(indexPath);
  const indexed =
    index !== null && index.ok
      ? { path: `${requestPath}/`, status: FOUND, size: index.content.length }
      : missAt(`${requestPath}/`);
  return { asked: [missed, indexed], found: isFound(indexed) ? indexed : null };
};
