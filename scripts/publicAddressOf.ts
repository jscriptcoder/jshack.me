/**
 * The public address a wire-check aims at — the one the world derives for a declared
 * network, so a check reaches exactly what a player would.
 *
 * A network the world does not declare has no address at all, and a check aimed at
 * nothing would report against an empty world rather than fail. So an undeclared key
 * stops the run instead.
 */

import { publicAddress } from '../src/core/generation/world.js';

export const publicAddressOf = (key: string): string => {
  const address = publicAddress(key);
  if (address === undefined) {
    console.error(`FATAL: the world declares no network ${key}, so it has no public address`);
    process.exit(2);
  }
  return address;
};
