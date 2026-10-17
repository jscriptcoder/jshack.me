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

import { secrets } from '../secrets/__encoded.js';
import { md5 } from './md5.js';
import type { Prng } from './prng.js';

/**
 * Passwords the shipped wordlist covers completely — obvious and guessable by
 * design, an attacker's first twenty tries. Both pools come from the
 * `JSHACK_SECRETS` environment variable through the build-time codec
 * (`scripts/encode.ts`), so the repo does not hold them and a grep of the
 * deployed bundle does not return the answer key.
 *
 * Encoded even though every player's `passwords.txt` prints them: that file mixes
 * them with common-list padding, so it does not say which words this world
 * actually draws. Printed in the bundle they would.
 *
 * Obfuscation, not secrecy: `contentCodec.ts` says so plainly, and the key ships
 * with the bundle. It raises the cost of skipping the progression; it does not
 * make skipping impossible.
 */
export const CRACKABLE_PASSWORDS: readonly string[] = JSON.parse(
  secrets.CRACKABLE_PASSWORDS,
) as readonly string[];

/**
 * The md5 of every password the shipped wordlist covers not at all, in the pool's
 * own order — an account that draws one holds against a default install until the
 * player harvests that exact word and appends it. Printed in the bundle the words
 * would be a lookup table for the whole game, and a player who grepped for them
 * would skip the progression entirely; so the game never holds them, only their
 * hashes, which a player has to crack exactly as they would in-game.
 *
 * Long on purpose: wordlist growth is the progression, and it stays one only
 * while each find is a real but partial gain. And deliberately idiosyncratic
 * rather than merely long — they read like passwords somebody chose, which is
 * exactly why a generic wordlist misses them.
 */
export const UNCRACKABLE_HASHES: readonly string[] = JSON.parse(
  secrets.UNCRACKABLE_HASHES,
) as readonly string[];

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
 * - `community` is the softest lock in the table, and the only one that is not a
 *   password. A community string is the weakest secret on a real network, left at its
 *   default far more often than any root account, and this one buys PORT CONTROL and
 *   nothing else — no file read, no command. Set at or below `gateway` it would be
 *   pointless, because root already grants `nano` on the very file it rewrites.
 * - `gateway` is the best root odds in the game and sits well above `npcRoot`,
 *   because the router is the door a player is MEANT to hunt before the
 *   vulnerability phase exists. Still a crack rather than a birthright: most of
 *   a sweep's gateways hold.
 */
export const CRACK_CHANCE = {
  guest: 1,
  npcUser: 0.7,
  npcRoot: 0.12,
  gateway: 0.4,
  community: 0.6,
} as const;

/**
 * One door's password hash: crackable with probability `crackChance`, otherwise not.
 * A hash and never a word, because the uncrackable pool exists in the game only as
 * hashes. Always consumes exactly two draws from `prng` whichever branch it takes,
 * so a caller's later draws stay put when a chance is retuned.
 */
export const drawPasswordHash = (prng: Prng, crackChance: number): string => {
  const crackable = prng.next() < crackChance;
  return crackable ? md5(prng.pick(CRACKABLE_PASSWORDS)) : prng.pick(UNCRACKABLE_HASHES);
};
