/**
 * The town a player starts in, drawn from their public key, so the client that draws
 * their scan and the server that admits their join both work it out and nothing stores
 * it.
 *
 * A town draws players in proportion to how many networks stand in it, so a network is
 * about as likely to have company wherever it is. The draw is weighted rendezvous
 * hashing: every town scores the key on a stream of its own, and the best score wins.
 * A town appended to the world therefore takes only the players it outscores, and every
 * other player keeps the town they had. A network that stands in no town is never a
 * starting place. See docs/procedural-world-architecture.md.
 */

import { createPrng } from './prng.js';
import { DECLARED_NETWORKS, TOWNS } from './world.js';

/** A town a player can start in, and how many networks stand in it. */
export type StartingTown = { readonly name: string; readonly networks: number };

/** Every town the world declares, each with the networks that stand in it. */
const WORLD_TOWNS: readonly StartingTown[] = TOWNS.map((town) => ({
  name: town.name,
  networks: DECLARED_NETWORKS.filter((network) => network.town === town.name).length,
}));

/** How strongly `town` claims the player under `publicKeyHex`. A uniform draw `u` turned
 *  into `networks / -ln(u)` makes each town the best score with a chance proportional to
 *  its networks. */
const scoreOf = (town: StartingTown, publicKeyHex: string): number =>
  town.networks / -Math.log(createPrng(`starting-town-${town.name}-${publicKeyHex}`).next());

/** The name of the town the player under `publicKeyHex` starts in, among `towns`. */
export const startingTown = (
  publicKeyHex: string,
  towns: readonly StartingTown[] = WORLD_TOWNS,
): string =>
  towns
    .map((town) => ({ name: town.name, score: scoreOf(town, publicKeyHex) }))
    .reduce((best, town) => (town.score > best.score ? town : best)).name;
