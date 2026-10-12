/**
 * hasTty — whether a shell has a terminal behind it. Asked by the shell, which refuses a
 * prompt to one that has none, and by the server, which cannot hand a terminal on from a
 * shell that never had one. It reads only the kind of the session, which the server holds
 * on the session row, so both sides answer from the same list.
 */

import type { SessionKind } from '../commands/types.js';

/** The shells with no pty behind them: a planted listener, because netcat is a
 *  pipe and nobody allocated it one, and the weaker of the two grants a CVE can
 *  hand over, which is modelled on it deliberately. */
const PTY_LESS_KINDS: readonly SessionKind[] = ['nc', 'exploit_limited'];

/** Whether the shell running this session has a terminal behind it. Everything
 *  reached by LOGGING IN does. It is the difference every writeup opens by fixing
 *  (`python3 -c 'import pty;…'`), and here it is what separates the doors: ftp
 *  moves files, a backdoor and a weak exploit let you look and break, and only a
 *  real login — or the full grant, which is one in all but name — can be pivoted
 *  onward from. */
export const hasTty = (session: { readonly kind: SessionKind }): boolean =>
  !PTY_LESS_KINDS.includes(session.kind);
