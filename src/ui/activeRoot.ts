/**
 * needsFreshTree — whether the box the active session stands on has to be re-read
 * before the next line runs.
 *
 * WHERE that tree comes from is a separate question with a one-line answer in
 * `ui/state.ts`: the player's own workstation is rebuilt locally from its journal, and
 * every other box is the tree the server serves. This one only asks whether the copy in
 * hand is allowed to be the one the player walked in with.
 */

import type { Session } from '../core/commands/types.js';

/**
 * It began as one case — a backdoor, the only door that could be taken away while
 * it was being held. A reboot makes that true of every session on a box that is
 * not the player's own: the rows close server-side in one stroke, and the marker
 * on the box's own tree is the only thing that can tell a shell already standing
 * there. Answering from a tree fetched at the hop would describe the box the
 * player walked into rather than the one they are typing at.
 *
 * Your own workstation is the exception, and deliberately so. It is the one
 * machine whose tree is already local, and the one session nobody can close
 * without you — the base login is not a row, so no reboot can end it. That keeps
 * the priced claim this narrowing has always been about: a command on your own box
 * issues no requests at all.
 *
 * A backdoor stays in by name, because it is the one door that can be taken away
 * on your own box too: a visitor holding a session there can `kill` the listener
 * that admitted them.
 */
export const needsFreshTree = (session: Session, ownWorkstationId: string): boolean =>
  session.kind === 'nc' || session.machineId !== ownWorkstationId;
