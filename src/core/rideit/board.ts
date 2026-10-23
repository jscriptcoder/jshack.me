/**
 * Boarding a ride at rideit.io: what a form POSTed to `/board` becomes.
 *
 * The form names a town, exactly as the ticket page writes it. A town the world declares
 * moves the player there; anything else is refused and changes nothing.
 *
 * Boarding is leaving, by the same rule as `nmcli disconnect`: the player's box comes off
 * every network it is on, and every connection that ran through it closes, both ways,
 * while the owner's own sessions on the box stay open. The traveller is the verified
 * signer, wherever their shell stands. The leaving comes before the move: a write that
 * fails leaves the player disconnected where they were, never moved while still on a
 * network in another town.
 *
 * The move names the trip count it read and holds only if it still stands, so two
 * boardings at once count one trip: the one that lost the race left, and moved nobody.
 */

import { TOWNS } from '../generation/world.js';
import type { FindPlayerLocation } from '../network/playerLocation.js';
import { dropConnectionsThrough, type DropConnectionsDeps } from '../network/unregisterOccupant.js';
import { arrivedPage, NOWHERE_PAGE, USED_TICKET_PAGE } from './pages.js';

/** Store the player in `town` as their next trip, only if they have still taken
 *  `tripsTaken` trips. `moved` is false when another boarding moved them first. */
export type MoveLocation = (move: {
  readonly ownerKey: string;
  readonly town: string;
  readonly tripsTaken: number;
}) => Promise<{ readonly moved: boolean; readonly error: unknown }>;

export type BoardDeps = DropConnectionsDeps & {
  readonly findPlayerLocation: FindPlayerLocation;
  /** Take the player's box off every network it is on, answering with the rows removed,
   *  which name the box that left. Empty when it was on none. */
  readonly deleteOccupancies: (ownerKey: string) => Promise<{
    readonly data: readonly { readonly workstation_machine_id: string }[] | null;
    readonly error: unknown;
  }>;
  readonly moveLocation: MoveLocation;
};

/** The page a boarding answers with, and whether the player left the network they were
 *  on, which their own tab has to learn so it can take its WiFi down. */
export type BoardAnswer = { readonly page: string; readonly left: boolean };

const DECLARED_TOWNS = new Set(TOWNS.map((town) => town.name));

/** The answer to a boarding, or null when the store could not say what happened. */
export const answerBoard = async ({
  form,
  playerKey,
  deps,
}: {
  /** The request body exactly as sent. */
  readonly form: string;
  /** The verified signer: the one who travels. */
  readonly playerKey: string;
  readonly deps: BoardDeps;
}): Promise<BoardAnswer | null> => {
  const town = new URLSearchParams(form).get('town') ?? '';
  if (!DECLARED_TOWNS.has(town)) return { page: NOWHERE_PAGE, left: false };

  const location = await deps.findPlayerLocation(playerKey);
  if (location.error) return null;

  const left = await deps.deleteOccupancies(playerKey);
  if (left.error) return null;
  const leftBoxes = new Set((left.data ?? []).map((row) => row.workstation_machine_id));
  for (const machineId of leftBoxes) {
    const dropped = await dropConnectionsThrough(deps, {
      machine_id: machineId,
      owner_key: playerKey,
    });
    if (!dropped) return null;
  }

  const move = await deps.moveLocation({
    ownerKey: playerKey,
    town,
    tripsTaken: location.data?.trips ?? 0,
  });
  if (move.error) return null;
  return { page: move.moved ? arrivedPage(town) : USED_TICKET_PAGE, left: true };
};
