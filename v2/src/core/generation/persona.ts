/**
 * Who the machines on a network belong to.
 *
 * A network is one place, such as an office, a café or a flat. Everything its people leave
 * on their machines reads as that place: notes about the work there, mail signed on
 * the network's own domain. This is derived, never stored, like every other fact about
 * a generated network, so every occupant reads the same place.
 */

import { lanZoneName } from '../network/resolveName';
import { createPrng } from './prng';
import type { LanHost } from './generateHomeLan';
import { FIRST_NAMES_BY_INITIAL, SURNAMES } from './pools/people';
import {
  ESSID_CATALOG,
  NETWORK_CATEGORIES,
  type NetworkCategory,
} from './pools/essidCatalog';

export type NetworkPersona = {
  readonly category: NetworkCategory;
  /** How the people there name the place in their own writing. */
  readonly place: string;
  /** The network's own domain, which its people's addresses end in. */
  readonly domain: string;
};

/** What the people on an uncatalogued network call where they are. A catalog network
 *  has a name of its own; these are places that never got one. */
const UNNAMED_PLACES: Readonly<Record<NetworkCategory, readonly string[]>> = {
  corporate: ['the office', 'head office', 'the branch office', 'the studio', 'the agency'],
  cafe: ['the café', 'the coffee shop', 'the bakery', 'the tea room', 'the corner bistro'],
  residential: ['the flat', 'the house', 'home', 'the cottage', 'the loft'],
  university: ['the department', 'the lab', 'the dorm', 'the faculty', 'the campus'],
  public: ['the library', 'the community centre', 'the station', 'the town hall', 'the park'],
  iot: ['the garage', 'the kitchen', 'the hallway', 'the utility room', 'the porch'],
  hacker: ['the hackerspace', 'the lab', 'the basement', 'the workshop', 'the bunker'],
};

const CATALOG_BY_ESSID = new Map(ESSID_CATALOG.map((entry) => [entry.essid, entry]));

export const networkPersona = (essid: string): NetworkPersona => {
  const domain = lanZoneName(essid);
  const known = CATALOG_BY_ESSID.get(essid);
  if (known !== undefined) {
    return { category: known.category, place: known.place, domain };
  }
  // A network another player named, or one that left the catalog, still belongs
  // somewhere: its own stream picks a kind of place and a name for it.
  const prng = createPrng(`network-persona-${essid}`);
  const category = prng.pick(NETWORK_CATEGORIES);
  return { category, place: prng.pick(UNNAMED_PLACES[category]), domain };
};

export type Inhabitant = {
  readonly fullName: string;
  readonly email: string;
};

const ALL_FIRST_NAMES: readonly string[] = Object.values(FIRST_NAMES_BY_INITIAL).flat();
const ALL_SURNAMES: readonly string[] = [...SURNAMES.values()];

/** The person an account belongs to. An account spelled initial-then-surname
 *  (`mrodriguez`) is that person, with a first name drawn under the initial. An account
 *  named for a job (`developer`) still has somebody behind it, drawn whole. The draw has
 *  its own stream keyed by the box, so two boxes with the same account name are usually
 *  two different people. */
export const inhabitant = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): Inhabitant => {
  const { essid, host, username } = options;
  const prng = createPrng(`inhabitant-${essid}-${host.ip}`);
  const surname = SURNAMES.get(username.slice(1));
  const initialNames = FIRST_NAMES_BY_INITIAL[username.charAt(0)];
  const fullName =
    surname === undefined || initialNames === undefined
      ? `${prng.pick(ALL_FIRST_NAMES)} ${prng.pick(ALL_SURNAMES)}`
      : `${prng.pick(initialNames)} ${surname}`;
  return { fullName, email: `${username}@${lanZoneName(essid)}` };
};
