/**
 * Rebuild the session + return-cwd stacks from the server's active sessions on
 * boot, so a `su` elevation survives a refresh.
 *
 * The base login (`seed`) is always the bottom of the stack and is never one of
 * the server rows (only PUSHED sessions are persisted). Rows are sorted by
 * `createdAt` ascending so the rebuild never depends on the server's row order.
 *
 * Only HOP kinds rebuild. A parallel session (ftp today) is a sub-shell of the
 * terminal that opened it, not a rung on the ladder, and the refresh that lost
 * that terminal is what makes its row abandoned — reported here so the caller can
 * close it, since sessions have no TTL and nothing else would.
 *
 * `returnCwdStack` is LOSSY: the exact cwd a session was pushed from isn't
 * persisted, so each pop restores to the HOME of the session beneath it
 * (root → /root, else /home/<user>) — matching legacy's reconstructed
 * `currentPath`. Kept in lockstep with the pushed (non-base) sessions.
 */

import { asAbsPath, type AbsPath } from '../core/types';
import type { Session, SessionKind } from '../core/commands/types';

export type RehydratedStack = {
  readonly sessionStack: readonly Session[];
  readonly returnCwdStack: readonly AbsPath[];
  /** The cwd to land in — the home of the active (top) session. Lossy, like
   *  `returnCwdStack`: the exact cwd at refresh isn't persisted. */
  readonly activeCwd: AbsPath;
  /** Active rows that are NOT hops, so the refresh left them with no owner. The
   *  caller ends them: nothing else ever will, and an active row is a standing
   *  write grant on somebody else's box. */
  readonly abandoned: readonly Session[];
};

/** The kinds that are HOPS: a stack of shells the player walked up, each standing
 *  on the one beneath. An allowlist rather than an ftp exclusion, because every
 *  later parallel session (`nc`, `mysql`, `redis`) is wrong on the stack for the
 *  same reason — a replay would put the player in a shell they never had, on a box
 *  they only ever held a transfer to. */
const HOP_KINDS: readonly SessionKind[] = ['ssh', 'su'];

const isHop = (session: Session): boolean => HOP_KINDS.includes(session.kind);

/** The home directory a user lands in — root has /root, everyone else /home/<user>. */
const homeOf = (session: Session): AbsPath =>
  session.userType === 'root' ? asAbsPath('/root') : asAbsPath(`/home/${session.username}`);

export const rehydrateSessionStack = (seed: Session, rows: readonly Session[]): RehydratedStack => {
  const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  const sorted = ordered.filter(isHop);
  return {
    sessionStack: [seed, ...sorted],
    abandoned: ordered.filter((session) => !isHop(session)),
    // The cwd to restore when each pushed session is popped is the home of the
    // session beneath it: the base user for the first push, the prior pushed
    // session for the rest.
    returnCwdStack: sorted.map((_session, index) =>
      homeOf(index === 0 ? seed : sorted[index - 1]!),
    ),
    // Land in the active (top) session's home — the base user when nothing was
    // pushed, otherwise the newest session.
    activeCwd: homeOf(sorted.at(-1) ?? seed),
  };
};
