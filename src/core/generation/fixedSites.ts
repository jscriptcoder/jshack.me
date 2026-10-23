/**
 * The fixed sites: places on the internet and nowhere else. Each is a single machine that
 * owns its public address, with no wifi anybody can join and no LAN behind it, so a request
 * to that address reaches a network whose "gateway" IS the box.
 *
 * Kept as a leaf of names so the world can refer to a fixed site without pulling in the
 * box generator. `generation/publisher` needs these strings at module load to resolve their
 * domains, and the generator (`generation/fixedSiteFs`) pulls in the whole apt/service graph,
 * which loops back through `generateHomeLan` to `publisher` — so the names living here is
 * what keeps that from being an initialization cycle.
 */

import type { NetworkCategory } from './pools/essidCatalog.js';

export type FixedSite = {
  /** The key the site is known by wherever a network is — its log rows, its address
   *  lookups. Never a wifi ESSID: nothing broadcasts it and nobody joins it. */
  readonly key: string;
  /** The domain its hostname sits under, and for a site in `FIXED_SITES` the name it
   *  answers to on the web. */
  readonly domain: string;
  /** What it calls itself on its own disk. */
  readonly hostname: string;
  /** The kind of place it is, and what its people call it. Fixed rather than drawn, as a
   *  network outside the catalog would draw it: players reach this box, and a kind of
   *  place added to the world must not turn it into another. */
  readonly place: { readonly category: NetworkCategory; readonly place: string };
};

const FINDIT: FixedSite = {
  key: 'findit.io',
  domain: 'findit.io',
  hostname: 'findit',
  place: { category: 'hacker', place: 'the workshop' },
};

const HACKADEMY: FixedSite = {
  key: 'hackademy.io',
  domain: 'hackademy.io',
  hostname: 'hackademy',
  place: { category: 'hacker', place: 'the school' },
};

const MAPIT: FixedSite = {
  key: 'mapit.io',
  domain: 'mapit.io',
  hostname: 'mapit',
  place: { category: 'hacker', place: 'the map room' },
};

const EMAILIT: FixedSite = {
  key: 'emailit.io',
  domain: 'emailit.io',
  hostname: 'emailit',
  place: { category: 'hacker', place: 'the post office' },
};

const CHAINIT: FixedSite = {
  key: 'chainit.io',
  domain: 'chainit.io',
  hostname: 'chainit',
  place: { category: 'hacker', place: 'the counting house' },
};

const TALKIT: FixedSite = {
  key: 'talkit.io',
  domain: 'talkit.io',
  hostname: 'talkit',
  place: { category: 'hacker', place: 'the town square' },
};

const HIREME: FixedSite = {
  key: 'hireme.io',
  domain: 'hireme.io',
  hostname: 'hireme',
  place: { category: 'hacker', place: 'the hiring hall' },
};

const VALLEYNEWS: FixedSite = {
  key: 'valleynews.io',
  domain: 'valleynews.io',
  hostname: 'valleynews',
  place: { category: 'hacker', place: 'the newsroom' },
};

const RIDEIT: FixedSite = {
  key: 'rideit.io',
  domain: 'rideit.io',
  hostname: 'rideit',
  place: { category: 'hacker', place: 'the ticket office' },
};

/** Every fixed site, in the order their addresses were handed out. */
export const FIXED_SITES: readonly FixedSite[] = [
  FINDIT,
  HACKADEMY,
  MAPIT,
  EMAILIT,
  CHAINIT,
  TALKIT,
  HIREME,
  VALLEYNEWS,
  RIDEIT,
];

/** The server hireme.io's contractor boards are served from: a fixed box like the sites,
 *  but listed nowhere. It has no address of its own and no domain anybody can resolve; it
 *  answers at every board's address, each held by one emailit.io handle, so nobody finds it
 *  but by an address somebody was mailed. */
const BOARD_SERVER: FixedSite = {
  key: 'boards.hireme.io',
  domain: HIREME.domain,
  hostname: 'boards',
  place: { category: 'hacker', place: 'the back office' },
};

/** Every fixed box: the sites, then the boards' server. */
export const FIXED_BOXES: readonly FixedSite[] = [...FIXED_SITES, BOARD_SERVER];

/** The fixed box known by `key` — a site or the boards' server — or `undefined` for any
 *  other network. */
export const fixedSite = (key: string): FixedSite | undefined =>
  FIXED_BOXES.find((site) => site.key === key);

// findit keeps its own names: its search is the one thing a fixed site does that the
// others do not.
export const FINDIT_NETWORK = FINDIT.key;
export const FINDIT_DOMAIN = FINDIT.domain;
export const FINDIT_HOSTNAME = FINDIT.hostname;

export const HACKADEMY_NETWORK = HACKADEMY.key;

export const MAPIT_NETWORK = MAPIT.key;

export const EMAILIT_NETWORK = EMAILIT.key;
export const EMAILIT_DOMAIN = EMAILIT.domain;

export const CHAINIT_NETWORK = CHAINIT.key;

export const TALKIT_NETWORK = TALKIT.key;
export const TALKIT_DOMAIN = TALKIT.domain;

export const HIREME_NETWORK = HIREME.key;
export const HIREME_DOMAIN = HIREME.domain;

export const VALLEYNEWS_NETWORK = VALLEYNEWS.key;

export const RIDEIT_NETWORK = RIDEIT.key;
export const RIDEIT_DOMAIN = RIDEIT.domain;

export const BOARD_SERVER_NETWORK = BOARD_SERVER.key;
