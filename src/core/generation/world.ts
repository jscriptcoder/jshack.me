/**
 * The world beyond one wifi scan: its regions, the towns in each, and the networks each
 * town holds.
 *
 * Ridgemont is where everybody stands, and its networks are the hand-authored catalog.
 * Every other town is declared here as a row and generated from it, so the whole world is
 * a list anything can walk (findit's index, the reverse address lookup) and nothing about
 * it is stored. Rows are only ever appended: a town's index is part of every key and
 * address inside it, so reordering the rows would move them all.
 */

import { ESSID_CATALOG, type NetworkCategory, type PublishedSite } from './pools/essidCatalog.js';
import { TOWN_BUSINESSES, type TownBusiness } from './pools/townBusinesses.js';
import { createPrng } from './prng.js';

/** A network the world declares: where it is, what it is, and what it publishes. */
export type DeclaredNetwork = {
  /** What the network is known by everywhere a machine or a journal is keyed. */
  readonly key: string;
  /** The name its wifi broadcasts, and the name its own machines live under. */
  readonly essid: string;
  readonly category: NetworkCategory;
  /** How the people there name the place in their own writing. */
  readonly place: string;
  /** The website it publishes to the whole world, if any. */
  readonly site?: PublishedSite;
  /** The town it stands in. */
  readonly town: string;
};

/** Every region's first octet: the block its towns' addresses are carved from. Kept out
 *  of the octets a joining network draws its address from, and out of the placeless
 *  block, so no derived address can ever equal one of theirs. */
export const REGION_FIRST_OCTETS: readonly number[] = [87];

/** The town everybody stands in, whose networks are the catalog. */
export const RIDGEMONT = 'Ridgemont';

/** A town's place among its region's towns, and what it is called. */
type Town = { readonly region: number; readonly index: number; readonly name: string };

const MILLBROOK: Town = { region: 0, index: 1, name: 'Millbrook' };

/** A network as a town declares it, before it has a key or a town. */
type Institution = Omit<DeclaredNetwork, 'key' | 'town'>;

/** Millbrook's council, police and library. A village has one of each, named for it. */
const MILLBROOK_INSTITUTIONS: readonly Institution[] = [
  {
    essid: 'TOWN-HALL-WIFI',
    category: 'government',
    place: 'the town hall',
    site: { domain: 'millbrook.gov', name: 'Millbrook Town Council' },
  },
  {
    essid: 'MILLBROOK-PD',
    category: 'government',
    place: 'the police station',
    site: { domain: 'millbrookpd.gov', name: 'Millbrook Police Department' },
  },
  {
    essid: 'LIBRARY-PUBLIC',
    category: 'public',
    place: 'the public library',
    site: { domain: 'millbrooklibrary.org', name: 'Millbrook Public Library' },
  },
];

/** The fewest and the most businesses a village keeps beyond its institutions. */
const VILLAGE_BUSINESSES_MIN = 3;
const VILLAGE_BUSINESSES_MAX = 6;

/** A business under the name over its door: its wifi and its domain are spelt from it. */
const business = ([category, name]: TownBusiness): Institution => ({
  essid: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
  category,
  place: name,
  site: { domain: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`, name },
});

const townKey = (town: Town): string => `r${town.region}/t${town.index}`;

/** Every network in `town`: its institutions first, then the businesses it draws on a
 *  stream of its own, each keyed by its place in the town. */
const networksOf = (
  town: Town,
  institutions: readonly Institution[],
): readonly DeclaredNetwork[] => {
  const prng = createPrng(`town-businesses-${townKey(town)}`);
  const count = prng.nextInt(VILLAGE_BUSINESSES_MIN, VILLAGE_BUSINESSES_MAX);
  return [...institutions, ...prng.pickN(TOWN_BUSINESSES, count).map(business)].map(
    (network, index) => ({ ...network, key: `${townKey(town)}/n${index}`, town: town.name }),
  );
};

const MILLBROOK_NETWORKS = networksOf(MILLBROOK, MILLBROOK_INSTITUTIONS);

/** Ridgemont's networks are the catalog's, each known by the name it broadcasts. */
const LANDMARKS: readonly DeclaredNetwork[] = ESSID_CATALOG.map((entry) => ({
  ...entry,
  key: entry.essid,
  town: RIDGEMONT,
}));

/** Every network the world declares, Ridgemont's first. */
export const DECLARED_NETWORKS: readonly DeclaredNetwork[] = [...LANDMARKS, ...MILLBROOK_NETWORKS];

const DECLARED_BY_KEY: ReadonlyMap<string, DeclaredNetwork> = new Map(
  DECLARED_NETWORKS.map((network) => [network.key, network]),
);

/** The network the world declares under `key`, or `undefined` for one it does not. */
export const declaredNetwork = (key: string): DeclaredNetwork | undefined =>
  DECLARED_BY_KEY.get(key);

/** How many towns a region's block holds: one per second octet, 1–254. */
const TOWNS_PER_REGION = 254;
/** Steps through the second octets. Sharing no factor with `TOWNS_PER_REGION`
 *  (2 · 127), it lands every town index on an octet of its own. */
const TOWN_STRIDE = 97;

/** The fourth octets a network can answer at: 2–254, never the network's `.0`, a
 *  gateway's `.1` or the broadcast `.255`. */
const FIRST_HOST_OCTET = 2;
const HOST_OCTETS = 253;
/** How many networks a town's block holds: every third octet by every host octet. */
const NETWORKS_PER_TOWN = 256 * HOST_OCTETS;
/** Steps through a town's block. Sharing no factor with `NETWORKS_PER_TOWN`
 *  (2⁸ · 11 · 23), it lands every network index on an address of its own, and
 *  neighbouring indices far apart, so a town's addresses look scattered rather than
 *  numbered in a row. */
const NETWORK_STRIDE = 24_681;

const addressOf = (town: Town, index: number): string => {
  const second = ((town.index * TOWN_STRIDE) % TOWNS_PER_REGION) + 1;
  const slot = (index * NETWORK_STRIDE) % NETWORKS_PER_TOWN;
  const third = Math.floor(slot / HOST_OCTETS);
  const fourth = (slot % HOST_OCTETS) + FIRST_HOST_OCTET;
  return `${REGION_FIRST_OCTETS[town.region]}.${second}.${third}.${fourth}`;
};

const ADDRESS_BY_KEY: ReadonlyMap<string, string> = new Map(
  MILLBROOK_NETWORKS.map((network, index) => [network.key, addressOf(MILLBROOK, index)]),
);

/** Where a town network answers on the internet: its region's octet, then the town's
 *  place in the region, then the network's place in the town. Positions are distinct,
 *  so addresses are too, without anything being drawn. A landmark has no town address
 *  yet; it keeps the one it has always had. */
export const townAddress = (key: string): string | undefined => ADDRESS_BY_KEY.get(key);
