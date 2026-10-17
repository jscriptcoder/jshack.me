/**
 * The read-write community of the agent a player installed on their own box.
 *
 * Every other SNMP door in the world belongs to a device the generator built, and its
 * community falls out of the ESSID or the machine that fronts it. This one belongs to a
 * box nothing generated, so it is derived from the OWNER'S PUBKEY — the same key
 * `workstationGuestPassword`, `ownDatabase` and `ownStore` are drawn from.
 *
 * The pubkey rather than anything else on the box, for three reasons. The word is the
 * owner's rather than the game's, so what one player reads off their install is not
 * every other agent's community (two can still share one by chance: the crackable pool
 * is small). It survives a rename, which a hostname
 * key would not — and renaming your own machine should not silently hand you a new
 * secret. And it is DETERMINISTIC, so deleting the state file and reinstalling recovers
 * the community the owner already had instead of rolling a new one behind their back;
 * that is the documented way back to a string they lost.
 *
 * Note what this is NOT for: nothing server-side ever reconstructs this plaintext. A
 * crack reads the HASH off the target's own filesystem (`secretOn`) and sweeps the
 * attacker's wordlist against it, and a read-write walk compares hashes too. The
 * plaintext exists in exactly two places — the install's own output, and whatever
 * wordlist happens to contain it.
 *
 * Drawn from the crackable pool only, never through the generated devices' roll. Two
 * reasons that agree: the owner is told this word, so it can always be one the client is
 * allowed to know, whatever the uncrackable pool holds; and every agent a player runs
 * joins the economy, so the filter it guards is never defending against nothing. A
 * neighbour with the shipped wordlist always gets in — that is the price of running an
 * agent at all.
 *
 * PLAINTEXT out. The install names it to its owner once and hashes it into the root-only
 * state file; nothing hands the string back afterwards. Hashing here instead would make
 * the one moment the owner is told their own community impossible to write.
 */

import { createPrng } from '../generation/prng.js';
import { CRACKABLE_PASSWORDS } from '../generation/passwordPools.js';

export const ownAgentCommunity = (ownerKeyHex: string): string =>
  createPrng(`own-agent-community-${ownerKeyHex}`).pick(CRACKABLE_PASSWORDS);
