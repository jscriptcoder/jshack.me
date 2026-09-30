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
import {
  BUSINESS_CATEGORY_WEIGHTS,
  BUSINESS_SUBTYPES,
  NAME_TEMPLATES,
  NAME_WORDS,
  type BusinessCategory,
  type BusinessSubtype,
} from './pools/businessKinds.js';
import { TOWN_HOMES, type TownHome } from './pools/townHomes.js';
import { createPrng } from './prng.js';
import { FINDIT_NETWORK } from './finditNetwork.js';

/** How much stands behind a network's gateway: one machine, a few, or today's inner
 *  router, switch and chain of hidden segments. */
export type NetworkProfile = 'lone' | 'flat' | 'deep';

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
  /** The region its town stands in. */
  readonly region: string;
  /** The sites of its town's institutions, when it is the network that keeps the town's
   *  directory. */
  readonly directory?: readonly PublishedSite[];
  /** Set when its site asks every crawler to stay away, so no search ever lists it. */
  readonly unlisted?: true;
  /** How much stands behind its gateway. A landmark declares none: it keeps the shape it
   *  was authored with, which is `deep`. */
  readonly profile?: NetworkProfile;
  /** What kind of shop, café or office it is. Only a business a town draws has one. */
  readonly subtype?: BusinessSubtype;
};

/** A region of the world: what it is called, and the first octet of the block its
 *  towns' addresses are carved from. */
type Region = { readonly name: string; readonly firstOctet: number };

/** The region Ridgemont stands in, and until a second arrives the whole world. */
export const HARROW_VALLEY = 'Harrow Valley';

/** The world's regions, by index. Only ever appended: a region's index is part of every
 *  key and address inside it. */
const REGIONS: readonly Region[] = [{ name: HARROW_VALLEY, firstOctet: 87 }];

/** Every region's first octet. Each is kept out of the placeless block, so no town's
 *  address can ever equal a placeless network's. */
export const REGION_FIRST_OCTETS: readonly number[] = REGIONS.map((region) => region.firstOctet);

/** The town everybody stands in, whose networks are the catalog. */
export const RIDGEMONT = 'Ridgemont';

/** A town's place among its region's towns, and what it is called. */
type Town = { readonly region: number; readonly index: number; readonly name: string };

const RIDGEMONT_TOWN: Town = { region: 0, index: 0, name: RIDGEMONT };
const MILLBROOK: Town = { region: 0, index: 1, name: 'Millbrook' };

/** The name of the region `town` stands in. */
const regionOf = (town: Town): string => REGIONS[town.region].name;

/** A network as a town declares it, before it has a key or a town. The town's council
 *  keeps its directory: a page on its site linking every institution in the town. */
type Institution = Omit<DeclaredNetwork, 'key' | 'town' | 'region' | 'directory' | 'profile'> & {
  readonly keepsDirectory?: true;
};

/** Millbrook's council, police and library. A village has one of each, named for it. */
const MILLBROOK_INSTITUTIONS: readonly Institution[] = [
  {
    essid: 'TOWN-HALL-WIFI',
    category: 'government',
    place: 'the town hall',
    site: { domain: 'millbrook.gov', name: 'Millbrook Town Council' },
    keepsDirectory: true,
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

/** A business: what kind it is, and the name over its door. */
type BusinessKind = { readonly category: BusinessCategory; readonly subtype: BusinessSubtype };

/** The wifi and the domain a business's name is spelt as: its letters and digits, with
 *  no accent and no apostrophe, as the sign over the door reads to somebody typing it. */
export const businessSpelling = (name: string): { essid: string; domain: string } => {
  const plain = name.normalize('NFD').replace(/[\p{M}'’]/gu, '');
  return {
    essid: plain.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    domain: `${plain.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`,
  };
};

/** A business under the name over its door: its wifi and its domain are spelt from it. */
const business = ({ category, subtype }: BusinessKind, name: string): Institution => {
  const { essid, domain } = businessSpelling(name);
  return { essid, category, subtype, place: name, site: { domain, name } };
};

/** The kind of each of `town`'s `count` businesses, on a stream of the town's own. No
 *  two are the same kind while their category has another left.
 *
 *  Every town keeps an office: the leads to its homes and to its hidden sites start on
 *  an office's desk or its file share, so a town without one would be a dead end. When
 *  the draw holds none, the last business is one instead; it still draws its category,
 *  so nothing drawn after it moves. */
const kindsOf = (town: Town, count: number): readonly BusinessKind[] => {
  const prng = createPrng(`town-business-kinds-${townKey(town)}`);
  const weighted = (Object.keys(BUSINESS_CATEGORY_WEIGHTS) as BusinessCategory[]).flatMap(
    (category) => Array.from({ length: BUSINESS_CATEGORY_WEIGHTS[category] }, () => category),
  );
  return Array.from({ length: count }).reduce<readonly BusinessKind[]>((drawn, _, index) => {
    const drew = prng.pick(weighted);
    const lacksOffice = index === count - 1 && !drawn.some((kind) => kind.category === 'corporate');
    const category = lacksOffice ? 'corporate' : drew;
    const subtypes: readonly BusinessSubtype[] = BUSINESS_SUBTYPES[category];
    const left = subtypes.filter((subtype) => !drawn.some((kind) => kind.subtype === subtype));
    return [...drawn, { category, subtype: prng.pick(left.length > 0 ? left : subtypes) }];
  }, []);
};

/** The fewest and the most homes a village keeps. */
const VILLAGE_HOMES_MIN = 4;
const VILLAGE_HOMES_MAX = 8;

/** A home, which publishes nothing. */
const home = ([essid, place]: TownHome): Institution => ({
  essid,
  category: 'residential',
  place,
});

/** The share of a town's publishers whose site asks every crawler to stay away. */
const UNLISTED_SHARE = 0.15;

/** How likely each kind of place is to stand as each profile. Nobody keeps an inner
 *  router and a chain of hidden segments at home or behind a café counter, and no council
 *  or office runs on one machine. A category no town draws yet has no row. */
const PROFILE_WEIGHTS: Readonly<
  Partial<Record<NetworkCategory, Readonly<Record<NetworkProfile, number>>>>
> = {
  government: { lone: 0, flat: 30, deep: 70 },
  public: { lone: 10, flat: 60, deep: 30 },
  corporate: { lone: 0, flat: 40, deep: 60 },
  retail: { lone: 40, flat: 50, deep: 10 },
  cafe: { lone: 60, flat: 40, deep: 0 },
  residential: { lone: 40, flat: 60, deep: 0 },
};

/** The profile the network under `key` draws for its category, on a stream of its own. */
const profileOf = (key: string, category: NetworkCategory): NetworkProfile => {
  const weights = PROFILE_WEIGHTS[category];
  if (weights === undefined) throw new Error(`no town draws a ${category} network yet`);
  const weighted = (['lone', 'flat', 'deep'] as const).flatMap((profile) =>
    Array.from({ length: weights[profile] }, () => profile),
  );
  return createPrng(`network-profile-${key}`).pick(weighted);
};

const townKey = (town: Town): string => `r${town.region}/t${town.index}`;

/** Each of `town`'s businesses under a name from its kind's templates, drawn on a stream
 *  of the town's own. A name whose wifi or domain another network already holds is drawn
 *  again: two networks under one domain would answer as one site. */
const businessesOf = (
  town: Town,
  kinds: readonly BusinessKind[],
  neighbours: readonly Institution[],
): readonly Institution[] => {
  const prng = createPrng(`town-business-names-${townKey(town)}`);
  const held = [...ESSID_CATALOG, ...neighbours];
  const essids = new Set(held.map((network) => network.essid));
  const domains = new Set([
    FINDIT_NETWORK,
    ...held.flatMap((network) => network.site?.domain ?? []),
  ]);
  const draw = (kind: BusinessKind): string => {
    const name = prng
      .pick(NAME_TEMPLATES[kind.subtype])
      .replace(/\{(\w+)\}/, (_, slot: keyof typeof NAME_WORDS) => prng.pick(NAME_WORDS[slot]));
    const { essid, domain } = businessSpelling(name);
    if (essids.has(essid) || domains.has(domain)) return draw(kind);
    essids.add(essid);
    domains.add(domain);
    return name;
  };
  return kinds.map((kind) => business(kind, draw(kind)));
};

/** The publishers of a town whose sites no search lists: 15% of them, at least one, drawn
 *  on a stream of the town's own. The council is never among them: its directory is how
 *  the town's unlisted institutions are found, so it must be found first. */
const unlistedOf = (town: Town, networks: readonly Institution[]): readonly Institution[] => {
  const publishers = networks.filter((network) => network.site !== undefined);
  const count = Math.max(1, Math.round(publishers.length * UNLISTED_SHARE));
  return createPrng(`town-unlisted-${townKey(town)}`).pickN(
    publishers.filter((network) => network.keepsDirectory !== true),
    count,
  );
};

/** Every network in `town`: its institutions first, then the businesses and then the
 *  homes it draws, each on a stream of its own, each keyed by its place in the town. The
 *  homes come last so that drawing them moved no business's key or address. */
const networksOf = (
  town: Town,
  institutions: readonly Institution[],
): readonly DeclaredNetwork[] => {
  const prng = createPrng(`town-businesses-${townKey(town)}`);
  const count = prng.nextInt(VILLAGE_BUSINESSES_MIN, VILLAGE_BUSINESSES_MAX);
  const homesPrng = createPrng(`town-homes-${townKey(town)}`);
  const homes = homesPrng.pickN(
    TOWN_HOMES,
    homesPrng.nextInt(VILLAGE_HOMES_MIN, VILLAGE_HOMES_MAX),
  );
  const directory = institutions.flatMap((institution) => institution.site ?? []);
  const networks = [
    ...institutions,
    ...businessesOf(town, kindsOf(town, count), [...institutions, ...homes.map(home)]),
    ...homes.map(home),
  ];
  const unlisted = unlistedOf(town, networks);
  return networks.map((institution: Institution, index) => {
    const { keepsDirectory, ...network } = institution;
    const key = `${townKey(town)}/n${index}`;
    return {
      ...network,
      key,
      profile: profileOf(key, network.category),
      town: town.name,
      region: regionOf(town),
      ...(keepsDirectory === true ? { directory } : {}),
      ...(unlisted.includes(institution) ? { unlisted: true as const } : {}),
    };
  });
};

const MILLBROOK_NETWORKS = networksOf(MILLBROOK, MILLBROOK_INSTITUTIONS);

/** Ridgemont's networks are the catalog's, each known by the name it broadcasts. */
const LANDMARKS: readonly DeclaredNetwork[] = ESSID_CATALOG.map((entry) => ({
  ...entry,
  key: entry.essid,
  town: RIDGEMONT,
  region: regionOf(RIDGEMONT_TOWN),
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

/** A slot in a town's block, as the third and fourth octets it answers at. */
const hostOctets = (slot: number): string =>
  `${Math.floor(slot / HOST_OCTETS)}.${(slot % HOST_OCTETS) + FIRST_HOST_OCTET}`;

const addressOf = (town: Town, index: number): string => {
  const second = ((town.index * TOWN_STRIDE) % TOWNS_PER_REGION) + 1;
  const slot = (index * NETWORK_STRIDE) % NETWORKS_PER_TOWN;
  return `${REGIONS[town.region].firstOctet}.${second}.${hostOctets(slot)}`;
};

/** The block of the networks that stand in no town: findit, and the corporations. */
export const PLACELESS_FIRST_OCTET = 193;
/** How many networks the placeless block holds: every second octet by a town's worth. */
const PLACELESS_NETWORKS = TOWNS_PER_REGION * NETWORKS_PER_TOWN;
/** Steps through the placeless block. A prime sharing no factor with
 *  `PLACELESS_NETWORKS` (2⁹ · 11 · 23 · 127), it lands every index on an address of
 *  its own, and neighbouring indices in different second octets. */
const PLACELESS_STRIDE = 1_000_003;

const placelessAddress = (index: number): string => {
  const slot = (index * PLACELESS_STRIDE) % PLACELESS_NETWORKS;
  const second = Math.floor(slot / NETWORKS_PER_TOWN) + 1;
  return `${PLACELESS_FIRST_OCTET}.${second}.${hostOctets(slot % NETWORKS_PER_TOWN)}`;
};

/** A corporation stands in no town, so a landmark corporation answers in the placeless
 *  block, after findit, in the catalog's order. Every other landmark answers in
 *  Ridgemont's block, placed by its position in the catalog. */
const landmarkAddresses = (): readonly (readonly [string, string])[] => {
  const corporations = LANDMARKS.filter((network) => network.category === 'corporate');
  return LANDMARKS.map((network, index) => [
    network.key,
    network.category === 'corporate'
      ? placelessAddress(corporations.indexOf(network) + 1)
      : addressOf(RIDGEMONT_TOWN, index),
  ]);
};

const ADDRESS_BY_KEY: ReadonlyMap<string, string> = new Map([
  [FINDIT_NETWORK, placelessAddress(0)],
  ...landmarkAddresses(),
  ...MILLBROOK_NETWORKS.map((network, index): [string, string] => [
    network.key,
    addressOf(MILLBROOK, index),
  ]),
]);

const KEY_BY_ADDRESS: ReadonlyMap<string, string> = new Map(
  [...ADDRESS_BY_KEY].map(([key, address]) => [address, key]),
);

/** Where the network known by `key` answers on the internet, or `undefined` for a
 *  network the world does not declare. A town network answers in its town's block: its
 *  region's octet, then the town's place in the region, then the network's place in the
 *  town. findit and the corporations answer in the placeless block. Positions are
 *  distinct, so addresses are too, without anything being drawn or stored. */
export const publicAddress = (key: string): string | undefined => ADDRESS_BY_KEY.get(key);

/** The network that answers at `address`, or `undefined` where none does. */
export const networkAt = (address: string): string | undefined => KEY_BY_ADDRESS.get(address);
