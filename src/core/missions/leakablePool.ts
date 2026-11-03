/**
 * The two halves of the uncrackable pool: the words a contract network can leak, and the
 * rest. A leaked word is a word a player keeps, so a list of them opens every door that
 * drew one. Accepting and dropping a job costs nothing, so over enough jobs a player holds
 * every word that can leak, and may share them; capping those words is what caps how much
 * of the world a list like that can open.
 *
 * Only hashes: the server alone holds the words behind them.
 *
 * A fixed box is held out of the slice, because a site run by people who meant it to stay up
 * falls by the software it runs and never by a guess. Its root is read off the draw that
 * builds its `/etc/passwd`, not off a built tree, so this module needs none of the box
 * generators and costs nothing at load.
 */

import { createPrng } from '../generation/prng.js';
import { FIXED_BOXES, type FixedSite } from '../generation/fixedSites.js';
import { drawPasswordHash, UNCRACKABLE_HASHES } from '../generation/passwordPools.js';

/** About a quarter of the pool: enough that a list of them is worth holding, few enough
 *  that three quarters of the world's uncrackable doors never fall to it. */
const LEAKABLE_WORD_COUNT = 13;

/** The hash a fixed box's root draws. Never crackable, so the first draw only spends the
 *  stream, exactly as the box builder's does. */
export const fixedBoxRootHash = (site: FixedSite): string =>
  drawPasswordHash(createPrng(`host-fs-${site.key}`), 0);

const FIXED_BOX_ROOTS: ReadonlySet<string> = new Set(FIXED_BOXES.map(fixedBoxRootHash));

/** The words a leak route's root draws from, and so the only words a file can give away. */
export const LEAKABLE_HASHES: readonly string[] = UNCRACKABLE_HASHES.filter(
  (hash) => !FIXED_BOX_ROOTS.has(hash),
).slice(0, LEAKABLE_WORD_COUNT);

const LEAKABLE: ReadonlySet<string> = new Set(LEAKABLE_HASHES);

/** The words no file ever gives away: what every door meant to stay shut draws from. */
export const SHUT_HASHES: readonly string[] = UNCRACKABLE_HASHES.filter(
  (hash) => !LEAKABLE.has(hash),
);
