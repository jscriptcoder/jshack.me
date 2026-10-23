/**
 * Where a player stands: the town they last travelled to, or, until they first travel, the
 * town their key draws them into. The draw stays a pure function of the key; only a trip
 * writes a row, so a player who never travels has none.
 *
 * Every server read that depends on the player's town asks here: the join admits only
 * that town's networks, and the scan draws from it.
 */

import { startingTown } from '../generation/startingTown.js';

/** A player's stored location: the town they last travelled to and how many trips they
 *  have taken. Keyed by their verified public key. */
export type PlayerLocationRow = { readonly town: string; readonly trips: number };

/** The location stored for `ownerKey`, or null for a player who has never travelled. */
export type FindPlayerLocation = (
  ownerKey: string,
) => Promise<{ readonly data: PlayerLocationRow | null; readonly error: unknown }>;

/** The town the player under `publicKeyHex` stands in. */
export const standingTown = (row: PlayerLocationRow | null, publicKeyHex: string): string =>
  row?.town ?? startingTown(publicKeyHex);
