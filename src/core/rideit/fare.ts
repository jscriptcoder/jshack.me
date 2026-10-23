/**
 * What a ride costs, and where it is paid.
 *
 * One flat fare to any town, in JSC. JSC is designed at one dollar a coin
 * (docs/wallet-architecture.md), and a regional coach or train across a county costs
 * $10–$40, so a ride sits inside that.
 *
 * The fare is paid to an address made for the traveller and their next trip. The ledger
 * says only which address paid which, and a wallet is not a player, so the address is
 * what says who paid for which trip. No key was ever made for it, so nothing can move
 * the coins sent there again: a fare is burned.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '../identity/hex.js';

export const RIDE_FARE = 25;

/** How many hex characters of the hash a trip address keeps, as many as a wallet's. */
const TRIP_ADDRESS_HASH_LENGTH = 40;

/** Where `playerKey` pays for the trip after the `tripsTaken` they have taken. */
export const tripAddress = (playerKey: string, tripsTaken: number): string => {
  const hash = sha256(new TextEncoder().encode(`rideit-trip-${playerKey}-${tripsTaken}`));
  return `jsc${bytesToHex(hash).slice(0, TRIP_ADDRESS_HASH_LENGTH)}`;
};
