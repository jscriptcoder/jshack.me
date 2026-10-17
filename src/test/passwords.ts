/**
 * The words behind the world's password hashes, for tests and scripts only.
 *
 * The game itself never holds an uncrackable word: the bundle carries the uncrackable
 * pool as md5s, so a player who digs through it finds only hashes to crack. A test
 * that logs in as a generated account still needs the word, so it reads the raw lists
 * from `__plaintext.ts`, which `scripts/encode.ts` writes beside the bundled module
 * and lint forbids to production code.
 */

import { md5 } from '../core/generation/md5.js';
import {
  COMMON_PASSWORDS,
  CRACKABLE_PASSWORDS,
  UNCRACKABLE_PASSWORDS,
  WIFI_PASSWORDS,
} from '../core/secrets/__plaintext.js';

export { COMMON_PASSWORDS, CRACKABLE_PASSWORDS, UNCRACKABLE_PASSWORDS, WIFI_PASSWORDS };

/**
 * Every password a generated door can hold. A door draws from either pool, so
 * matching a hash against one alone silently misses half the world rather than
 * failing loudly.
 */
export const ALL_GENERATED_PASSWORDS: readonly string[] = [
  ...CRACKABLE_PASSWORDS,
  ...UNCRACKABLE_PASSWORDS,
];

/** The word a generated hash was drawn from. Throws for a hash from no pool: a
 *  caller asking this always expects a generated door, and an `undefined` password
 *  would only fail later as a puzzling wrong-password login. */
export const plaintextFor = (hash: string): string => {
  const word = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === hash);
  if (word === undefined) throw new Error(`no generated password hashes to ${hash}`);
  return word;
};
