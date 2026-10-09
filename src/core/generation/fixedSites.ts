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
  /** The name it answers to on the web. */
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

/** Every fixed site, in the order their addresses were handed out. */
export const FIXED_SITES: readonly FixedSite[] = [FINDIT, HACKADEMY];

/** The fixed site known by `key`, or `undefined` for any other network. */
export const fixedSite = (key: string): FixedSite | undefined =>
  FIXED_SITES.find((site) => site.key === key);

// findit keeps its own names: its search is the one thing a fixed site does that the
// others do not.
export const FINDIT_NETWORK = FINDIT.key;
export const FINDIT_DOMAIN = FINDIT.domain;
export const FINDIT_HOSTNAME = FINDIT.hostname;

export const HACKADEMY_NETWORK = HACKADEMY.key;
