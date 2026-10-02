import { describe, expect, it } from 'vitest';
import { DECLARED_NETWORKS, RIDGEMONT, type DeclaredNetwork } from '../core/generation/world.js';
import { TOWN_KEYS, townKeysSwept } from './worldContent.js';

/** Every network the world draws beyond Ridgemont. */
const drawn = DECLARED_NETWORKS.filter((network) => network.town !== RIDGEMONT);

/** What makes two networks of a town read alike to a content sweep. */
const shapeOf = (network: DeclaredNetwork): string =>
  [
    network.category,
    network.subtype ?? '-',
    network.profile,
    network.parent === undefined ? 'own' : 'branch',
    network.unlisted === true ? 'unlisted' : 'listed',
  ].join(' ');

const inTown = (town: string | undefined) => (network: DeclaredNetwork) => network.town === town;

/**
 * The whole-world content sweeps read every Ridgemont network and every key outside the
 * catalog, but only a fixed sample of the drawn towns: each town adds dozens of networks
 * that read alike, and sweeping them all would make the suite pay for every town the
 * world grows by. The whole world is still swept once at each pull request's gate.
 */
describe('the drawn networks a content sweep reads', () => {
  it('are every one of them when the whole world is asked for', () => {
    expect(townKeysSwept('full')).toEqual(TOWN_KEYS);
  });

  it('are a sample otherwise, holding no network twice', () => {
    const sample = townKeysSwept(undefined);
    expect(sample.length).toBeLessThan(TOWN_KEYS.length);
    expect(new Set(sample).size).toBe(sample.length);
  });

  it('keep all of Millbrook and all of the corporations, the networks the world drew first', () => {
    const sample = townKeysSwept(undefined);
    const whole = drawn.filter(
      (network) => network.town === 'Millbrook' || network.town === undefined,
    );
    expect(whole.length).toBeGreaterThan(0);
    expect(sample).toEqual(expect.arrayContaining(whole.map((network) => network.key)));
  });

  it('keep, from every other town, the first network of each shape it holds, and no other', () => {
    const sample = townKeysSwept(undefined);
    const towns = [...new Set(drawn.flatMap((network) => network.town ?? []))].filter(
      (town) => town !== 'Millbrook',
    );
    expect(towns.length).toBeGreaterThan(1);
    for (const town of towns) {
      const networks = drawn.filter(inTown(town));
      const first = networks.filter(
        (network, index) =>
          networks.findIndex((other) => shapeOf(other) === shapeOf(network)) === index,
      );
      expect(
        networks.filter((network) => sample.includes(network.key)).map((network) => network.key),
        town,
      ).toEqual(first.map((network) => network.key));
    }
  });
});
