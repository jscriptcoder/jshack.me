/**
 * The world beyond one wifi scan: its regions, the towns in each, and the networks each
 * town holds.
 *
 * Ridgemont is where everybody stands, and its networks are the hand-authored catalog.
 * Every other town is declared here as a row and generated from it, so the whole world is
 * a list anything can walk (findit's index, the reverse address lookup) and nothing about
 * it is stored. A row is a name and a size, a village or a town, and the size sets how many
 * of each kind of place it draws. Rows are only ever appended: a town's index is part of
 * every key and address inside it, so reordering the rows would move them all.
 */

import { ESSID_CATALOG, type NetworkCategory, type PublishedSite } from './pools/essidCatalog.js';
import {
  BUSINESS_CATEGORY_WEIGHTS,
  BUSINESS_SUBTYPES,
  CORPORATION_NAME_TEMPLATES,
  NAME_TEMPLATES,
  NAME_WORDS,
  PRACTICE_SUBTYPES,
  type BusinessCategory,
  type BusinessSubtype,
  type NamedSubtype,
  type NetworkSubtype,
} from './pools/businessKinds.js';
import {
  HOME_FORM_WEIGHTS,
  HOME_TEMPLATES,
  HOME_WORDS,
  type HomeTemplate,
} from './pools/homeNames.js';
import { createPrng, type Prng } from './prng.js';
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
  /** The town it stands in. A corporation the world draws stands in none. */
  readonly town?: string;
  /** The region its town stands in. */
  readonly region?: string;
  /** The sites of its town's institutions, when it is the network that keeps the town's
   *  directory. */
  readonly directory?: readonly PublishedSite[];
  /** Set when its site asks every crawler to stay away, so no search ever lists it. */
  readonly unlisted?: true;
  /** How much stands behind its gateway. A landmark declares none: it keeps the shape it
   *  was authored with, which is `deep`. */
  readonly profile?: NetworkProfile;
  /** What kind of shop, café, office or place of care it is. Only a business or a
   *  practice a town draws, and a hospital, has one. */
  readonly subtype?: NetworkSubtype;
  /** The key of the corporation a branch is an office of. Only a branch has one. */
  readonly parent?: string;
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

/** How big a town the world draws is. */
type SizeClass = 'village' | 'town';

/** The fewest and the most of something a town keeps. */
type Range = { readonly min: number; readonly max: number };

/** How many of each kind of place a town of a size keeps beyond its institutions: its
 *  businesses, its homes, its practices and the corporations' branches. */
type SizeCounts = {
  readonly businesses: Range;
  readonly homes: Range;
  readonly practices: Range;
  readonly branches: Range;
};

/** What each size of town keeps. A size is only ever added: a town's counts are drawn
 *  from its ranges, so a range that moved would redraw every town of that size. */
const SIZE_CLASSES: Readonly<Record<SizeClass, SizeCounts>> = {
  village: {
    businesses: { min: 3, max: 6 },
    homes: { min: 4, max: 8 },
    practices: { min: 1, max: 2 },
    branches: { min: 1, max: 2 },
  },
  town: {
    businesses: { min: 12, max: 24 },
    homes: { min: 12, max: 24 },
    practices: { min: 2, max: 4 },
    branches: { min: 2, max: 3 },
  },
};

/** A town the world draws: its place, its name, and its size. */
type DrawnTown = Town & { readonly size: SizeClass };

/** How many of `kind` `town` keeps, drawn on `prng` from its size's range. */
const countOf = (town: DrawnTown, kind: keyof SizeCounts, prng: Prng): number => {
  const { min, max } = SIZE_CLASSES[town.size][kind];
  return prng.nextInt(min, max);
};

const RIDGEMONT_TOWN: Town = { region: 0, index: 0, name: RIDGEMONT };
const MILLBROOK: DrawnTown = { region: 0, index: 1, name: 'Millbrook', size: 'village' };
const ASHBY: DrawnTown = { region: 0, index: 2, name: 'Ashby', size: 'village' };
const OAKHURST: DrawnTown = { region: 0, index: 3, name: 'Oakhurst', size: 'town' };

/** The name of the region `town` stands in. */
const regionOf = (town: Town): string => REGIONS[town.region].name;

/** A network as a town declares it, before it has a key or a town. The town's council
 *  keeps its directory: a page on its site linking every institution in the town. */
type Institution = Omit<DeclaredNetwork, 'key' | 'town' | 'region' | 'directory' | 'profile'> & {
  readonly keepsDirectory?: true;
};

/** A town's council, police and library: every town has one of each, named for it. A
 *  town bigger than a village also keeps a courthouse, and a hospital or none, drawn on a
 *  stream of its own. */
const institutionsOf = (town: DrawnTown): readonly Institution[] => {
  const lower = town.name.toLowerCase();
  const courthouse: Institution = {
    essid: 'COURTHOUSE-WIFI',
    category: 'government',
    place: 'the courthouse',
    site: { domain: `${lower}courts.gov`, name: `${town.name} County Court` },
  };
  const hospital: Institution = {
    essid: 'GENERAL-HOSPITAL',
    category: 'healthcare',
    subtype: 'hospital',
    place: 'the hospital',
    site: { domain: `${lower}hospital.org`, name: `${town.name} General Hospital` },
  };
  const hospitals = (): readonly Institution[] =>
    createPrng(`town-hospital-${townKey(town)}`).nextInt(0, 1) === 1 ? [hospital] : [];
  const beyondVillage = town.size === 'village' ? [] : [courthouse, ...hospitals()];
  return [
    {
      essid: 'TOWN-HALL-WIFI',
      category: 'government',
      place: 'the town hall',
      site: { domain: `${lower}.gov`, name: `${town.name} Town Council` },
      keepsDirectory: true,
    },
    {
      essid: `${town.name.toUpperCase()}-PD`,
      category: 'government',
      place: 'the police station',
      site: { domain: `${lower}pd.gov`, name: `${town.name} Police Department` },
    },
    {
      essid: 'LIBRARY-PUBLIC',
      category: 'public',
      place: 'the public library',
      site: { domain: `${lower}library.org`, name: `${town.name} Public Library` },
    },
    ...beyondVillage,
  ];
};

/** Millbrook's institutions declared after its homes: the town already had its keys when
 *  they arrived, so they stand last and move none of them. */
const MILLBROOK_LATER_INSTITUTIONS: readonly Institution[] = [
  {
    essid: 'COTTAGE-HOSPITAL',
    category: 'healthcare',
    subtype: 'hospital',
    place: 'the cottage hospital',
    site: { domain: 'millbrookhospital.org', name: 'Millbrook Cottage Hospital' },
  },
];

/** Each of `weights`' keys as many times as its weight, in their order: a list a draw
 *  picks from by weight. */
const byWeight = <Key extends string>(weights: Readonly<Record<Key, number>>): readonly Key[] =>
  (Object.keys(weights) as Key[]).flatMap((key) => Array.from({ length: weights[key] }, () => key));

/** A business: what kind it is, and the name over its door. */
type BusinessKind = { readonly category: BusinessCategory; readonly subtype: BusinessSubtype };

/** A place a town names from its kind's grammar: a business or a practice. */
type NamedKind = { readonly category: NetworkCategory; readonly subtype: NamedSubtype };

/** The wifi and the domain a business's name is spelt as: its letters and digits, with
 *  no accent and no apostrophe, as the sign over the door reads to somebody typing it. */
export const businessSpelling = (name: string): { essid: string; domain: string } => {
  const plain = name.normalize('NFD').replace(/[\p{M}'’]/gu, '');
  return {
    essid: plain.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    domain: `${plain.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`,
  };
};

/** A business or a practice under the name over its door: its wifi and its domain are
 *  spelt from it. */
const business = ({ category, subtype }: NamedKind, name: string): Institution => {
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
  const weighted = byWeight(BUSINESS_CATEGORY_WEIGHTS);
  return Array.from({ length: count }).reduce<readonly BusinessKind[]>((drawn, _, index) => {
    const drew = prng.pick(weighted);
    const lacksOffice = index === count - 1 && !drawn.some((kind) => kind.category === 'corporate');
    const category = lacksOffice ? 'corporate' : drew;
    const subtypes: readonly BusinessSubtype[] = BUSINESS_SUBTYPES[category];
    const left = subtypes.filter((subtype) => !drawn.some((kind) => kind.subtype === subtype));
    return [...drawn, { category, subtype: prng.pick(left.length > 0 ? left : subtypes) }];
  }, []);
};

/** `count` of `kinds`, drawn on `prng`, no kind twice while another is left. */
const distinctKinds = <Kind>(prng: Prng, kinds: readonly Kind[], count: number): readonly Kind[] =>
  Array.from({ length: count }).reduce<readonly Kind[]>((drawn) => {
    const left = kinds.filter((kind) => !drawn.includes(kind));
    return [...drawn, prng.pick(left.length > 0 ? left : kinds)];
  }, []);

/** How many practices `town` keeps, and the kind of each, on a stream of the town's own.
 *  No two are the same kind while another is left. */
const practiceKindsOf = (town: DrawnTown): readonly NamedKind[] => {
  const prng = createPrng(`town-practices-${townKey(town)}`);
  const count = countOf(town, 'practices', prng);
  return distinctKinds(prng, PRACTICE_SUBTYPES, count).map((subtype) => ({
    category: 'healthcare',
    subtype,
  }));
};

/** A family named in the plural: a surname already ending in "s" takes no more. */
const familyOf = (surname: string): string => (surname.endsWith('s') ? surname : `${surname}s`);

/** The doors on each floor of a block of flats. */
const FLAT_DOORS: readonly string[] = ['A', 'B', 'C', 'D'];
const FLAT_FLOORS_MAX = 9;

/** The largest of the four hex digits a router's default name ends in. */
const ROUTER_SUFFIX_MAX = 0xffff;

/** A home named from `template`, each of its slots filled on `prng`. A home publishes
 *  nothing. */
const homeNamed = ([essid, place]: HomeTemplate, prng: Prng): Named => {
  const template = `${essid} ${place}`;
  const slot = /\{(surname|plant|description)s?\}/.exec(template)?.[1] as
    | keyof typeof HOME_WORDS
    | undefined;
  const word = slot === undefined ? '' : prng.pick(HOME_WORDS[slot]);
  const flat = template.includes('{flat}')
    ? `${prng.nextInt(1, FLAT_FLOORS_MAX)}${prng.pick(FLAT_DOORS)}`
    : '';
  const suffix = template.includes('{hex}')
    ? prng.nextInt(0, ROUTER_SUFFIX_MAX).toString(16).toUpperCase().padStart(4, '0')
    : '';
  const filled = (text: string): string =>
    text
      .replace('{surnames}', familyOf(word))
      .replace(`{${slot}}`, word)
      .replace('{flat}', flat)
      .replace('{hex}', suffix);
  return {
    network: {
      essid: businessSpelling(filled(essid)).essid,
      category: 'residential',
      place: filled(place),
    },
    words: slot === undefined ? [] : [word],
  };
};

/** How many homes `town` keeps, and the name of each, on a stream of the town's own: the
 *  count first, then each home's form, template and words. No two share a wifi or a word. */
const homesOf = (town: DrawnTown): readonly Named[] => {
  const prng = createPrng(`town-homes-${townKey(town)}`);
  const count = countOf(town, 'homes', prng);
  const forms = byWeight(HOME_FORM_WEIGHTS);
  return Array.from({ length: count }).reduce<readonly Named[]>((drawn) => {
    const draw = (): Named => {
      const named = homeNamed(prng.pick(HOME_TEMPLATES[prng.pick(forms)]), prng);
      const taken = drawn.some(
        (home) =>
          home.network.essid === named.network.essid ||
          home.words.some((word) => named.words.includes(word)),
      );
      return taken ? draw() : named;
    };
    return [...drawn, draw()];
  }, []);
};

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
  healthcare: { lone: 0, flat: 50, deep: 50 },
  cafe: { lone: 60, flat: 40, deep: 0 },
  residential: { lone: 40, flat: 60, deep: 0 },
};

/** The profile the network under `key` draws for its category, on a stream of its own. */
const profileOf = (key: string, category: NetworkCategory): NetworkProfile => {
  const weights = PROFILE_WEIGHTS[category];
  if (weights === undefined) throw new Error(`no town draws a ${category} network yet`);
  return createPrng(`network-profile-${key}`).pick(byWeight(weights));
};

const townKey = (town: Town): string => `r${town.region}/t${town.index}`;

/** A business or a practice is named from its kind's templates. */
const kindTemplates = (kind: NamedKind): readonly string[] => NAME_TEMPLATES[kind.subtype];

/** A place a grammar named, and the words from the lists its name is made of. */
type Named = { readonly network: Institution; readonly words: readonly string[] };

/** `template` with each slot filled from its word list, drawn on `prng`, and the words
 *  that fill it. No word fills two slots: a partnership of one family would read as a
 *  typing slip. */
const filledName = (
  template: string,
  prng: Prng,
): { readonly name: string; readonly words: readonly string[] } => {
  const slots = [...template.matchAll(/\{(\w+)\}/g)].map(
    ([, slot]) => slot as keyof typeof NAME_WORDS,
  );
  const words = slots.reduce<readonly string[]>(
    (drawn, slot) => [
      ...drawn,
      prng.pick(NAME_WORDS[slot].filter((word) => !drawn.includes(word))),
    ],
    [],
  );
  const name = words.reduce(
    (filled, word, index) => filled.replace(`{${slots[index]}}`, word),
    template,
  );
  return { name, words };
};

/** Each of `kinds` under a name from `templatesOf` it, drawn on `stream`. A name whose
 *  wifi or domain another network already holds is drawn again: two networks under one
 *  domain would answer as one site. So is one using a word already held, among `words`
 *  or the names drawn before it: a town of two Greenleafs reads as written from one short
 *  list. */
const namedOf = (
  stream: string,
  kinds: readonly NamedKind[],
  {
    neighbours,
    words,
  }: { readonly neighbours: readonly Institution[]; readonly words: readonly string[] },
  templatesOf: (kind: NamedKind) => readonly string[],
): readonly Named[] => {
  const prng = createPrng(stream);
  const held = [...ESSID_CATALOG, ...neighbours];
  const essids = new Set(held.map((network) => network.essid));
  const domains = new Set([
    FINDIT_NETWORK,
    ...held.flatMap((network) => network.site?.domain ?? []),
  ]);
  const heldWords = new Set(words);
  const draw = (kind: NamedKind): Named => {
    const filled = filledName(prng.pick(templatesOf(kind)), prng);
    const { essid, domain } = businessSpelling(filled.name);
    const taken =
      essids.has(essid) || domains.has(domain) || filled.words.some((word) => heldWords.has(word));
    if (taken) return draw(kind);
    essids.add(essid);
    domains.add(domain);
    filled.words.forEach((word) => heldWords.add(word));
    return { network: business(kind, filled.name), words: filled.words };
  };
  return kinds.map((kind) => draw(kind));
};

/** The networks `named` names. */
const networksNamed = (named: readonly Named[]): readonly Institution[] =>
  named.map(({ network }) => network);

/** The publishers of a town whose sites no search lists: 15% of them, at least one, drawn
 *  on a stream of the town's own. The council is never among them: its directory is how
 *  the town's unlisted institutions are found, so it must be found first. Nor is every
 *  office: the leads to the town's homes start on an office's desk, so a draw that would
 *  leave the town no office a search lists is drawn again. */
const unlistedOf = (town: Town, networks: readonly Institution[]): readonly Institution[] => {
  const publishers = networks.filter((network) => network.site !== undefined);
  const count = Math.max(1, Math.round(publishers.length * UNLISTED_SHARE));
  const offices = publishers.filter((network) => network.category === 'corporate');
  const prng = createPrng(`town-unlisted-${townKey(town)}`);
  const draw = (): readonly Institution[] => {
    const drawn = prng.pickN(
      publishers.filter((network) => network.keepsDirectory !== true),
      count,
    );
    return offices.every((office) => drawn.includes(office)) ? draw() : drawn;
  };
  return draw();
};

/** Every network in `town`: its institutions first, then the businesses and then the
 *  homes it draws, each on a stream of its own, then the institutions declared later, then
 *  the practices it draws, each keyed by its place in the town. Whatever arrived later
 *  comes after what was there, so declaring it moved no earlier key or address. The names
 *  it draws avoid those of every network declared `before` it elsewhere in the world. */
const networksOf = (
  town: DrawnTown,
  {
    later,
    before,
  }: { readonly later: readonly Institution[]; readonly before: readonly Institution[] },
): readonly DeclaredNetwork[] => {
  const institutions = institutionsOf(town);
  const prng = createPrng(`town-businesses-${townKey(town)}`);
  const count = countOf(town, 'businesses', prng);
  const namedHomes = homesOf(town);
  const homes = networksNamed(namedHomes);
  const directory = [...institutions, ...later].flatMap((institution) => institution.site ?? []);
  const namedBusinesses = namedOf(
    `town-business-names-${townKey(town)}`,
    kindsOf(town, count),
    {
      neighbours: [...institutions, ...homes, ...later, ...before],
      words: namedHomes.flatMap(({ words }) => words),
    },
    kindTemplates,
  );
  const businesses = networksNamed(namedBusinesses);
  // A practice's name is drawn after every other, so it avoids them all and moves none.
  const practices = networksNamed(
    namedOf(
      `town-practice-names-${townKey(town)}`,
      practiceKindsOf(town),
      {
        neighbours: [...institutions, ...businesses, ...homes, ...later, ...before],
        words: [...namedHomes, ...namedBusinesses].flatMap(({ words }) => words),
      },
      kindTemplates,
    ),
  );
  const networks = [...institutions, ...businesses, ...homes, ...later, ...practices];
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

const MILLBROOK_NETWORKS = networksOf(MILLBROOK, {
  later: MILLBROOK_LATER_INSTITUTIONS,
  before: [],
});

/** The fewest and the most corporations the world holds beyond the landmarks. */
const CORPORATIONS_MIN = 20;
const CORPORATIONS_MAX = 40;

/** How many corporations the world holds, and the kind of each, on a stream of the
 *  world's own. No two are the same kind while another is left. */
const corporationKinds = (): readonly NamedKind[] => {
  const prng = createPrng('corporations');
  const count = prng.nextInt(CORPORATIONS_MIN, CORPORATIONS_MAX);
  return distinctKinds(prng, BUSINESS_SUBTYPES.corporate, count).map((subtype) => ({
    category: 'corporate',
    subtype,
  }));
};

/** The corporations: head offices that stand in no town, declared after every town so
 *  none of their keys moves. Their names are drawn after every other, so they avoid them
 *  all and move none. */
const CORPORATIONS: readonly DeclaredNetwork[] = networksNamed(
  namedOf(
    'corporation-names',
    corporationKinds(),
    { neighbours: MILLBROOK_NETWORKS, words: [] },
    () => CORPORATION_NAME_TEMPLATES,
  ),
).map((corporation, index) => {
  const key = `c${index}`;
  return { ...corporation, key, profile: profileOf(key, corporation.category) };
});

/** The offices the corporations keep in `town`, on a stream of the town's own, keyed
 *  after the `count` networks the town already holds. No corporation keeps two offices in
 *  one town. A branch publishes nothing: its company's site is its public face. */
const branchesOf = (town: DrawnTown, count: number): readonly DeclaredNetwork[] => {
  const prng = createPrng(`town-branches-${townKey(town)}`);
  const parents = prng.pickN(CORPORATIONS, countOf(town, 'branches', prng));
  return parents.map((parent, index) => {
    const key = `${townKey(town)}/n${count + index}`;
    return {
      key,
      essid: `${parent.essid}-${town.name.toUpperCase()}`,
      category: parent.category,
      ...(parent.subtype === undefined ? {} : { subtype: parent.subtype }),
      place: `the ${town.name} office`,
      town: town.name,
      region: regionOf(town),
      profile: profileOf(key, parent.category),
      parent: parent.key,
    };
  });
};

/** Millbrook's branches: declared after the corporations, whose names they carry, and
 *  still keyed as the town's next networks. */
const MILLBROOK_BRANCHES = branchesOf(MILLBROOK, MILLBROOK_NETWORKS.length);

/** Ashby: drawn after the corporations, so its names avoid theirs and Millbrook's and move
 *  none of them. */
const ASHBY_NETWORKS = networksOf(ASHBY, {
  later: [],
  before: [...MILLBROOK_NETWORKS, ...CORPORATIONS],
});
const ASHBY_BRANCHES = branchesOf(ASHBY, ASHBY_NETWORKS.length);

/** Oakhurst, the first town: drawn after Ashby, so its names avoid every network declared
 *  before it and move none of them. */
const OAKHURST_NETWORKS = networksOf(OAKHURST, {
  later: [],
  before: [
    ...MILLBROOK_NETWORKS,
    ...CORPORATIONS,
    ...MILLBROOK_BRANCHES,
    ...ASHBY_NETWORKS,
    ...ASHBY_BRANCHES,
  ],
});
const OAKHURST_BRANCHES = branchesOf(OAKHURST, OAKHURST_NETWORKS.length);

/** Ridgemont's networks are the catalog's, each known by the name it broadcasts. */
const LANDMARKS: readonly DeclaredNetwork[] = ESSID_CATALOG.map((entry) => ({
  ...entry,
  key: entry.essid,
  town: RIDGEMONT,
  region: regionOf(RIDGEMONT_TOWN),
}));

/** Every network the world declares: Ridgemont's first, then Millbrook's, the
 *  corporations and Millbrook's branches, then each later town's networks and its branches,
 *  in the order the towns were declared. */
export const DECLARED_NETWORKS: readonly DeclaredNetwork[] = [
  ...LANDMARKS,
  ...MILLBROOK_NETWORKS,
  ...CORPORATIONS,
  ...MILLBROOK_BRANCHES,
  ...ASHBY_NETWORKS,
  ...ASHBY_BRANCHES,
  ...OAKHURST_NETWORKS,
  ...OAKHURST_BRANCHES,
];

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

const LANDMARK_CORPORATIONS = LANDMARKS.filter((network) => network.category === 'corporate');

/** A corporation stands in no town, so a landmark corporation answers in the placeless
 *  block, after findit, in the catalog's order. Every other landmark answers in
 *  Ridgemont's block, placed by its position in the catalog. */
const landmarkAddresses = (): readonly (readonly [string, string])[] =>
  LANDMARKS.map((network, index) => [
    network.key,
    network.category === 'corporate'
      ? placelessAddress(LANDMARK_CORPORATIONS.indexOf(network) + 1)
      : addressOf(RIDGEMONT_TOWN, index),
  ]);

/** Where each of `networks` in `town` answers, placed by its position in the town. A
 *  branch is keyed after every network the town held before it, so it answers after them
 *  too. */
const townAddresses = (
  town: Town,
  networks: readonly DeclaredNetwork[],
): readonly (readonly [string, string])[] =>
  networks.map((network, index) => [network.key, addressOf(town, index)]);

const ADDRESS_BY_KEY: ReadonlyMap<string, string> = new Map([
  [FINDIT_NETWORK, placelessAddress(0)],
  ...landmarkAddresses(),
  ...townAddresses(MILLBROOK, [...MILLBROOK_NETWORKS, ...MILLBROOK_BRANCHES]),
  // The drawn corporations answer after findit and every landmark corporation.
  ...CORPORATIONS.map((network, index): [string, string] => [
    network.key,
    placelessAddress(1 + LANDMARK_CORPORATIONS.length + index),
  ]),
  ...townAddresses(ASHBY, [...ASHBY_NETWORKS, ...ASHBY_BRANCHES]),
  ...townAddresses(OAKHURST, [...OAKHURST_NETWORKS, ...OAKHURST_BRANCHES]),
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
