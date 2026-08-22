/**
 * The database a PLAYER's own box keeps, drawn when they buy one.
 *
 * Per-player, seeded from the owner's pubkey, so no two players hold the same
 * database. A CONSTANT one — the shape a shipped data file usually takes, and the
 * shape hydra's wordlist really does take — fails on one chain: the first player to
 * crack their own application account would hold a credential valid against every
 * database in the game, and a sweep of anyone else's would be permanently skippable.
 * A wordlist can be a shared constant because knowing it buys nothing. A password
 * file cannot.
 *
 * Drawn through the same `generateDatabase` the world's own boxes are built from, so
 * what a visitor meets on a player's box is what they have already learned to expect
 * on an NPC's: the same name pools, the same two-to-four tables past `users`, the
 * same crack ladder underneath.
 *
 * One thing differs, and only one. The database's ROOT answers to the password the
 * player chose for the box itself, read from the box's own `/etc/passwd` — so they
 * reach their own prompt with nothing to look up, print, store or delete. It costs
 * exactly what it sounds like: a chosen password is almost never in the wordlist, so
 * this account is effectively uncrackable and an attacker will not reach the
 * statements only root may run. That is accepted rather than overlooked. The drawn
 * accounts below it are the attack surface, cracking them still buys nothing toward
 * the box, and the version-vulnerability route is the way in that this door is not
 * trying to provide.
 *
 * NPC generation is untouched: their databases keep drawing their own root, which is
 * what keeps cracking a box and cracking its database two locks with two keys.
 */

import { generateDatabase } from '../generation/generateDatabase';
import { accountIn, accountsIn } from '../sessions/passwdAccount';
import type { Directory } from '../filesystem/types';
import type { MysqlDatabase } from './types';

/** The database account whose password the box's own root password becomes. */
const ROOT_ACCOUNT = 'root';

/** Who leads the `users` table on a box that names no ordinary user — which takes
 *  a root player editing their own `/etc/passwd`, and is theirs to do. `guest` is
 *  the one account every box keeps, so the table is still led by somebody who is
 *  really there rather than by a name invented to fill the row. */
const FALLBACK_ACCOUNT = 'guest';

export const ownDatabase = ({
  ownerKeyHex,
  hostname,
  fs,
}: {
  readonly ownerKeyHex: string;
  readonly hostname: string;
  /** The box's own filesystem, for the accounts it declares. */
  readonly fs: Directory;
}): MysqlDatabase => {
  // By NAME, through the reader every auth gate on the box already uses: the password
  // being mirrored is the one `su root` asks for, so it has to be read the way `su`
  // reads it. Asking for the root-TIER account instead would answer with whichever
  // row came first on a box whose passwd has been edited.
  const boxRoot = accountIn(fs, ROOT_ACCOUNT);
  // By tier, because there is no name to ask for: an ordinary user is whatever the
  // box called them.
  const owner = accountsIn(fs).find((account) => account.userType === 'user');

  // Its OWN stream, namespaced away from every other draw seeded on this pubkey —
  // the workstation tree, the guest password, the home LAN. Sharing one would move
  // every value picked after it.
  const drawn = generateDatabase({
    seed: `mysql-db-own-${ownerKeyHex}`,
    hostname,
    account: owner?.username ?? FALLBACK_ACCOUNT,
    role: undefined,
  });

  // A box that declares no root account has nothing to mirror, so the drawn password
  // stands. Nothing else could: inventing one here would put a password on the box
  // that its own passwd file has never heard of.
  if (boxRoot === null) return drawn;

  return {
    ...drawn,
    credentials: drawn.credentials.map((credential) =>
      credential.username === ROOT_ACCOUNT
        ? { ...credential, passwordHash: boxRoot.hash }
        : credential,
    ),
  };
};
