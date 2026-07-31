/**
 * The two pools every generated account draws its password from, and how often
 * each kind of account draws the easy one.
 *
 * "Crackable" is not a property of a password — it is membership in the wordlist
 * the player is holding. These pools encode that: the crackable pool ships whole
 * in the file `apt install hydra` writes, and the uncrackable pool ships in none
 * of it. Nothing else in the game decides what falls.
 *
 * The pools are drawn from at GENERATION, which makes crackability a property of
 * the world rather than of a login attempt. Two consequences worth knowing: a
 * host's answer is stable forever (two occupants cracking one box agree, and so
 * do hydra and ssh), and any claim about how OFTEN accounts fall is only
 * observable across a population of hosts, never against one.
 */

import { secrets } from '../secrets/__encoded';
import type { Prng } from './prng';

/**
 * Passwords the shipped wordlist covers completely. Obvious and guessable by
 * design — an attacker's first twenty tries. Committed in plaintext because
 * they are printed into every player's `passwords.txt` anyway; hiding them
 * would protect nothing.
 */
export const CRACKABLE_PASSWORDS: readonly string[] = [
  'guest',
  'password',
  'letmein',
  'changeme',
  'welcome1',
  'qwerty123',
  'trustno1',
  'sunshine',
  'admin123',
  'root1234',
];

/**
 * Passwords the shipped wordlist covers not at all — an account that draws one
 * holds against a default install until the player harvests that exact word and
 * appends it. Read through the build-time codec (see `secrets.ts`) so a grep of
 * the deployed bundle does not return the answer key.
 *
 * Obfuscation, not secrecy: `contentCodec.ts` says so plainly, and the key ships
 * with the bundle. It raises the cost of skipping the progression; it does not
 * make skipping impossible.
 */
export const UNCRACKABLE_PASSWORDS: readonly string[] = JSON.parse(
  secrets.UNCRACKABLE_PASSWORDS,
) as readonly string[];

/**
 * Every password a generated account can hold. The reverse lookup (hash back to
 * plaintext) that credential-validating code and its tests need — a generated
 * account draws from either pool, so matching against one alone silently misses
 * half the world.
 */
export const ALL_GENERATED_PASSWORDS: readonly string[] = [
  ...CRACKABLE_PASSWORDS,
  ...UNCRACKABLE_PASSWORDS,
];

/**
 * How often each kind of account draws from the crackable pool.
 *
 * Stated once, together, because the numbers only mean anything relative to each
 * other: the curve is the point, not any single value.
 *
 * - `guest` is 1 — never a gamble. A defender's chosen root password is safe
 *   until the vulnerability phase, so guest is the only way into a player's box
 *   and the entire cross-player loop rests on it being reachable.
 * - `npcUser` is the routine win: sweep a LAN, get footholds.
 * - `npcRoot` is deliberately near the floor — roughly one crackable root per
 *   eight-host LAN, so day-one rooting happens and still feels like a find. It
 *   is also what makes the gateway worth hunting.
 */
export const CRACK_CHANCE = {
  guest: 1,
  npcUser: 0.7,
  npcRoot: 0.12,
} as const;

/**
 * One account's password: crackable with probability `crackChance`, otherwise
 * not. Always consumes exactly two draws from `prng` whichever branch it takes,
 * so a caller's later draws stay put when a chance is retuned.
 */
export const drawPassword = (prng: Prng, crackChance: number): string => {
  const crackable = prng.next() < crackChance;
  const pool = crackable ? CRACKABLE_PASSWORDS : UNCRACKABLE_PASSWORDS;
  return prng.pick(pool);
};
