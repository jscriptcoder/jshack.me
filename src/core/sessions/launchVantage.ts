/**
 * launchVantage — which box an action was LAUNCHED from, given the session stack the
 * shell is standing on.
 *
 * It is the hop BELOW the active one, and getting this wrong is not cosmetic. Some
 * actions have a target of their own — an ftp transfer names the box it moved a file on
 * — but others happen exactly where the player is standing: an `apt` rollback changes
 * the manifest of the box whose shell is in front of them. For those, naming the ACTIVE
 * session as the vantage would tell the rolled-back box's own log that the visit came
 * from its own network, which is the one address it can never have been.
 *
 * `undefined` means there is nothing underneath — the player is at their base login, on
 * their own workstation. Every caller hands that to the server as "no box named", which
 * resolves the address from the actor's verified key instead: the network they own.
 *
 * An `su` elevation is not a hop, and needs no special case. It pushes a session on the
 * SAME machine, so the box underneath is that same workstation — and the server's
 * own-box bypass resolves it to the player's own network, which is the right answer by
 * the same route rather than by an exception.
 *
 * Pure: the stack is passed in, so the rule is readable without a running shell.
 */

import type { Session } from '../commands/types';
import type { MachineId } from '../types';

export const launchVantage = (stack: readonly Session[]): MachineId | undefined =>
  stack.at(-2)?.machineId;
