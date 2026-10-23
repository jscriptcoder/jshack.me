/**
 * A fresh player identity whose key starts them in a given town.
 *
 *     const alice = generateIdentityIn(RIDGEMONT);
 *
 * A player may join only a network of the town their key draws, so a test that joins a
 * declared network needs a key from that network's town. Keys are made until one draws
 * it: about three tries for Ridgemont, about forty for the smallest village.
 */

import { generateIdentity } from '../../core/identity/identity.js';
import { startingTown } from '../../core/generation/startingTown.js';
import { TOWNS } from '../../core/generation/world.js';
import type { Identity } from '../../core/commands/types.js';

export const generateIdentityIn = (town: string): Identity => {
  // A name the world does not declare would never be drawn, and the loop would not end.
  if (!TOWNS.some((declared) => declared.name === town)) {
    throw new Error(`no town is called ${town}`);
  }
  for (;;) {
    const identity = generateIdentity();
    if (startingTown(identity.publicKeyHex) === town) return identity;
  }
};
