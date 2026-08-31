/**
 * The read-write community of the agent a player installed on their own box.
 *
 * Every other SNMP door in the world belongs to a device the generator built, and its
 * community falls out of the ESSID or the machine that fronts it. This one belongs to a
 * box nothing generated, so it is derived from the OWNER'S PUBKEY — the same key
 * `workstationGuestPassword`, `ownDatabase` and `ownStore` are drawn from.
 *
 * The pubkey rather than anything else on the box, for three reasons. Two players never
 * share a community, so one crack opens one box. It survives a rename, which a hostname
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
 * Drawn through `seedSnmpCommunity`, so it comes out of the same pool at the same rate
 * as every generated device's. That is the whole point rather than a detail: a community
 * nobody's wordlist contains would make a player's own agent the one door in the game
 * that cannot be opened, and the filter it guards would be defending against nothing.
 * A player's box joins the economy every other device is already in.
 *
 * PLAINTEXT out. The install names it to its owner once and hashes it into the root-only
 * state file; nothing hands the string back afterwards. Hashing here instead would make
 * the one moment the owner is told their own community impossible to write.
 */

import { seedSnmpCommunity } from '../generation/routerFs';

export const ownAgentCommunity = (ownerKeyHex: string): string =>
  seedSnmpCommunity(`own-agent-community-${ownerKeyHex}`);
