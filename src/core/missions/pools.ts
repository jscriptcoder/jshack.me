/**
 * The name pools a contract's network is drawn from, all ships-in-the-bundle flavour
 * (nothing here is secret: it is the shape a player sees once they hold the address).
 *
 * A target is the company that owns the network, and it names its own boxes: a stem
 * such as `halden` gives the gateway `halden-gw` and the key box `halden-files`, so a
 * scan reads like one company's two machines rather than the world's `nginx-12` filler.
 * The stem is a short, lowercase, hostname-safe word; the suffixes say what each box is.
 */

/** Target company stems — the word a contract's boxes are named after. */
export const TARGET_STEMS: readonly string[] = [
  'halden',
  'corva',
  'meridian',
  'oakridge',
  'vantell',
  'brightmoor',
  'calderon',
  'sternco',
  'northgate',
  'pellic',
  'ardent',
  'kestrelle',
  'lumen',
  'draycott',
  'ferro',
  'quillan',
];

/** The suffix on the gateway's hostname: the box at the public address. */
export const GATEWAY_SUFFIX = 'gw';
/** The suffix on the key box's hostname: the box the key sits on. */
export const KEY_BOX_SUFFIX = 'files';

/** What a key box's agent answers a read-only walk to, in place of `public`, on the snmp route
 *  and behind an snmp decoy alike. Short and common enough for a player to guess. A sweep never
 *  finds one: it attacks only the read-write community. */
export const GUESSABLE_COMMUNITIES: readonly string[] = ['monitor', 'netops'];
