/**
 * The store a PLAYER's own box keeps, drawn when they buy one.
 *
 * A fresh install: it holds no keys, as a new `redis-server` holds none. A generated
 * store is the working set of an application somebody on its box ran, and the player is
 * the only person on theirs, so any keys drawn here would describe an application nobody
 * there ever used.
 *
 * The store's LOCK is the password the player chose for the box itself, read from its own
 * `/etc/passwd`, so they open their own prompt with nothing to look up. This door has no
 * ladder underneath it: a store answers to one password and knows no accounts, so
 * mirroring is the whole of its authorization rather than the top rung of it. That is why
 * a player's store is never one of the four in ten the generator draws open — an unlocked
 * store on your own box is a door standing open with nothing said about it, and there is
 * no second credential behind it to find.
 *
 * It cuts both ways, deliberately. A chosen password is almost never in the wordlist, so
 * this lock is out of a SWEEP's reach; but whoever cracks the box's root hash and runs
 * `su root` is holding the store's password already. The harder path reaching what the
 * easier one cannot is the reward for taking it.
 */

import { drawStoreLock } from '../generation/generateRedisStore';
import { accountIn } from '../sessions/passwdAccount';
import type { Directory } from '../filesystem/types';
import type { RedisStore } from './types';

/** The account whose password the store's lock becomes. */
const ROOT_ACCOUNT = 'root';

export const ownStore = ({
  ownerKeyHex,
  fs,
}: {
  readonly ownerKeyHex: string;
  /** The box's own filesystem, for the root password the lock mirrors. */
  readonly fs: Directory;
}): RedisStore => {
  // By NAME, through the reader every auth gate on the box already uses: the password
  // being mirrored is the one `su root` asks for, so it has to be read the way `su`
  // reads it. Asking for the root-TIER account instead would answer with whichever row
  // came first on a box whose passwd has been edited.
  const boxRoot = accountIn(fs, ROOT_ACCOUNT);

  // A box that declares no root account has nothing to mirror, so a drawn lock stands —
  // open or not — on its OWN stream, namespaced away from every other draw seeded on
  // this pubkey. Inventing one here would put a password on the box that its own passwd
  // file has never heard of, and blanking it for everyone would decide a rule this code
  // is not the place to decide.
  return {
    keys: {},
    requirepassHash: boxRoot === null ? drawStoreLock(`redis-store-own-${ownerKeyHex}`) : boxRoot.hash,
  };
};
