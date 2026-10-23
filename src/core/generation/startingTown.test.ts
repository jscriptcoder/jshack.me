import { describe, expect, it } from 'vitest';
import { startingTown, type StartingTown } from './startingTown.js';
import { createPrng } from './prng.js';
import { DECLARED_NETWORKS, TOWNS } from './world.js';

/**
 * A player starts in the town their key draws, and a town draws players in proportion to
 * how many networks stand in it, so a network is about as likely to have company wherever
 * it is. The client and the server each work the town out from the same public key, and
 * nothing about it is stored, so the draw has to be a pure function of the key.
 */

/** `count` distinct 64-hex public keys, the shape a signed-up player's key has. */
const keysOf = (count: number): readonly string[] => {
  const prng = createPrng('starting-town-test-keys');
  return Array.from({ length: count }, () =>
    Array.from({ length: 32 }, () => prng.nextInt(0, 255).toString(16).padStart(2, '0')).join(''),
  );
};

/** How many of the world's declared networks stand in each town, by town name. */
const networksByTown = (): ReadonlyMap<string, number> =>
  new Map(
    TOWNS.map((town) => [
      town.name,
      DECLARED_NETWORKS.filter((network) => network.town === town.name).length,
    ]),
  );

/** Each town's share of `keys`, by the town each key draws in `towns`. */
const sharesOf = (
  keys: readonly string[],
  towns?: readonly StartingTown[],
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const town = startingTown(key, towns);
    counts.set(town, (counts.get(town) ?? 0) + 1);
  }
  return new Map([...counts].map(([town, count]) => [town, count / keys.length]));
};

describe('startingTown', () => {
  it('draws the same town for the same key every time', () => {
    for (const key of keysOf(50)) {
      expect(startingTown(key)).toBe(startingTown(key));
    }
  });

  it("gives each town a share of players within a point and a half of its share of the world's networks", () => {
    const networks = networksByTown();
    const placed = [...networks.values()].reduce((sum, count) => sum + count, 0);
    const shares = sharesOf(keysOf(20_000));

    const offShare = [...networks]
      .map(([town, count]) => ({ town, players: shares.get(town) ?? 0, networks: count / placed }))
      .filter((town) => Math.abs(town.players - town.networks) > 0.015);

    expect(offShare).toEqual([]);
  });

  it('only ever starts a player in a town, never at a network that stands in none', () => {
    const townNames = new Set(TOWNS.map((town) => town.name));
    const drawn = new Set(keysOf(2_000).map((key) => startingTown(key)));

    expect([...drawn].filter((town) => !townNames.has(town))).toEqual([]);
    expect(DECLARED_NETWORKS.some((network) => network.town === undefined)).toBe(true);
  });

  it('moves only the players a newly appended town draws, and every other player keeps their town', () => {
    const world: readonly StartingTown[] = [...networksByTown()].map(([name, networks]) => ({
      name,
      networks,
    }));
    const placed = world.reduce((sum, town) => sum + town.networks, 0);
    const grown: readonly StartingTown[] = [...world, { name: 'Newtown', networks: 60 }];
    const keys = keysOf(5_000);

    const moved = keys.filter((key) => startingTown(key, grown) !== startingTown(key, world));
    const movedShare = moved.length / keys.length;

    expect(moved.filter((key) => startingTown(key, grown) !== 'Newtown')).toEqual([]);
    expect(Math.abs(movedShare - 60 / (placed + 60))).toBeLessThan(0.015);
  });
});
