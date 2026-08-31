/**
 * The read-write community of the agent a player installed on their own box.
 *
 * Every other SNMP door in the world belongs to a device the generator built, and its
 * community falls out of the ESSID or the machine that fronts it. This one belongs to a
 * box nothing generated, so it is derived from the OWNER'S PUBKEY — the same key
 * `workstationGuestPassword`, `ownDatabase` and `ownStore` are drawn from, and for the
 * same reason. The server has to be able to reconstruct this string when a STRANGER
 * cracks it, and it cannot read the owner's filesystem to do that; a community keyed by
 * anything the box itself carries would leave a cross-player crack with nothing to check
 * an answer against.
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
