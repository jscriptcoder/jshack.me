/**
 * Rebuild the session + return-cwd stacks from the server's active sessions on
 * boot, so a `su` elevation survives a refresh.
 *
 * The base login (`seed`) is always the bottom of the stack and is never one of
 * the server rows (only PUSHED sessions are persisted). Rows are sorted by
 * `createdAt` ascending so the rebuild never depends on the server's row order.
 *
 * `returnCwdStack` is LOSSY: the exact cwd a session was pushed from isn't
 * persisted, so each pop restores to the HOME of the session beneath it
 * (root → /root, else /home/<user>) — matching legacy's reconstructed
 * `currentPath`. Kept in lockstep with the pushed (non-base) sessions.
 */

import { asAbsPath, type AbsPath } from '../core/types';
import type { Session } from '../core/commands/types';

export type RehydratedStack = {
  readonly sessionStack: readonly Session[];
  readonly returnCwdStack: readonly AbsPath[];
  /** The cwd to land in — the home of the active (top) session. Lossy, like
   *  `returnCwdStack`: the exact cwd at refresh isn't persisted. */
  readonly activeCwd: AbsPath;
};

/** The home directory a user lands in — root has /root, everyone else /home/<user>. */
const homeOf = (session: Session): AbsPath =>
  session.userType === 'root' ? asAbsPath('/root') : asAbsPath(`/home/${session.username}`);

export const rehydrateSessionStack = (
  seed: Session,
  rows: readonly Session[],
): RehydratedStack => {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  return {
    sessionStack: [seed, ...sorted],
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
