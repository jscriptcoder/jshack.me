/**
 * The store a PLAYER's own box keeps, drawn when they buy one.
 *
 * Per-player, seeded from the owner's pubkey and drawn through the same
 * `generateRedisStore` the world's own boxes are built from, so what a visitor meets on
 * a player's box is what they have already learned to expect on an NPC's: the same key
 * shapes, the same working-set size. A CONSTANT store fails the same way a constant
 * database would — the first player to read their own would know every other one.
 *
 * One thing differs, and only one. The store's LOCK is the password the player chose for
 * the box itself, read from its own `/etc/passwd`, so they open their own prompt with
 * nothing to look up. This door has no ladder underneath it: a store answers to one
 * password and knows no accounts, so mirroring is the whole of its authorization rather
 * than the top rung of it. That is why a player's store is never one of the four in ten
 * the generator draws open — an unlocked store on your own box is a door standing open
 * with nothing said about it, and there is no second credential behind it to find.
 *
 * It cuts both ways, deliberately. A chosen password is almost never in the wordlist, so
 * this lock is out of a SWEEP's reach; but whoever cracks the box's root hash and runs
 * `su root` is holding the store's password already. The harder path reaching what the
 * easier one cannot is the reward for taking it.
 *
 * NPC generation is untouched: their stores keep drawing their own lock, which is what
 * keeps a box and its store two locks with two keys everywhere except where the owner is
 * a person who has to remember them.
 */

import { generateRedisStore } from '../generation/generateRedisStore';
import { accountIn, accountsIn } from '../sessions/passwdAccount';
import type { Directory } from '../filesystem/types';
import type { RedisStore } from './types';

/** The account whose password the store's lock becomes. */
const ROOT_ACCOUNT = 'root';

/** Who the store's keys are about on a box that names no ordinary user — which takes a
 *  root player editing their own `/etc/passwd`. `guest` is the one account every box
 *  keeps, so the keys still describe somebody who is really there. */
const FALLBACK_ACCOUNT = 'guest';

export const ownStore = ({
  ownerKeyHex,
  hostname,
  fs,
}: {
  readonly ownerKeyHex: string;
  readonly hostname: string;
  /** The box's own filesystem, for the accounts it declares. */
  readonly fs: Directory;
}): RedisStore => {
  // By NAME, through the reader every auth gate on the box already uses: the password
  // being mirrored is the one `su root` asks for, so it has to be read the way `su`
  // reads it. Asking for the root-TIER account instead would answer with whichever row
  // came first on a box whose passwd has been edited.
  const boxRoot = accountIn(fs, ROOT_ACCOUNT);
  // By tier, because there is no name to ask for: an ordinary user is whatever the box
  // called them.
  const owner = accountsIn(fs).find((account) => account.userType === 'user');

  // Its OWN stream, namespaced away from every other draw seeded on this pubkey — the
  // workstation tree, the guest password, the home LAN, the database next door. Sharing
  // one would move every value picked after it.
  const drawn = generateRedisStore({
    seed: `redis-store-own-${ownerKeyHex}`,
    hostname,
    people: [ROOT_ACCOUNT, owner?.username ?? FALLBACK_ACCOUNT],
  });

  // A box that declares no root account has nothing to mirror, so the drawn lock stands
  // — open or not. Inventing one here would put a password on the box that its own
  // passwd file has never heard of, and blanking it for everyone would decide a rule
  // this code is not the place to decide.
  return boxRoot === null ? drawn : { ...drawn, requirepassHash: boxRoot.hash };
};
