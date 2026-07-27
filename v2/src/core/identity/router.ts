/**
 * Gateway identity — the canonical machine_id for the AP gateway and for the
 * deeper gateways behind it.
 *
 * The AP gateway is the `.1` of an access point's LAN: it bears the public IP,
 * runs its own `sshd`, and owns `/etc/iptables/rules.v4`. It belongs to the ACCESS
 * POINT, not to any player — an AP has one gateway, so every occupant of an ESSID
 * is behind the same NAT on the same box, and it therefore derives from the ESSID
 * alone. Deriving it per-player instead would give each occupant a private `.1`
 * while all of them claimed one shared public address.
 *
 * Nobody owns it: it is a contested machine reached the same way as any other
 * target, by cracking its (deliberately weak, ESSID-seeded) admin password. There
 * is no "own gateway" shortcut.
 *
 * Namespaces are LOAD-BEARING. `isOwnWorkstation` matches on the identity-derived
 * suffix ALONE (it ignores the name part), so an id built from the same `'ed25519:'`
 * namespace as the workstation would collide on the suffix and be wrongly claimed
 * as the player's own box. Each gateway kind therefore hashes in its own domain →
 * independent, never-colliding suffixes. The exact prefix bytes are an internal
 * detail; only determinism + distinctness across kinds are the contract.
 */

import { deriveHostnameSuffix } from './workstation';

/** The machine_id for an access point's gateway, keyed by the ESSID ALONE so every
 *  occupant of that AP resolves the same box. The `ap-gw:` namespace is not an
 *  `ed25519-` one because this id is not derived from any keypair — no player owns
 *  an access point. */
export const computeApGatewayId = (essid: string): string =>
  `ap-gw-${deriveHostnameSuffix(`ap-gw:${essid}`)}`;

/** The machine_id for a deeper-layer gateway on an AP's LAN — a router that fronts
 *  the deeper layers, and which must NOT alias the edge router. It derives from a
 *  SEPARATE (`inner-gw:`) namespace keyed by BOTH the ESSID and the gateway's LAN
 *  octet: the octet-less edge router (`computeApGatewayId`) and a second inner gateway
 *  at another octet therefore each get an independent suffix, and an NPC sibling that
 *  happens to share the octet (the coordinate `host:` namespace) can never collide
 *  either. Keyed by the ESSID rather than by a player, for the same reason the edge
 *  gateway is: the box stands on the access point's LAN, so every occupant that reaches
 *  it must reach ONE machine with one journal — not a private copy per viewer. */
export const computeInnerGatewayId = (essid: string, octet: number): string =>
  `inner-gw-${deriveHostnameSuffix(`inner-gw:${essid}:${octet}`)}`;

/** The machine_id for a gateway hanging off a DEEPER layer — a router the player
 *  owns that sits behind an inner gateway, fronting a layer further down. It must be
 *  unique across the whole chain (and, later, across branches), so it derives from a
 *  SEPARATE (`ed25519-deep-gw:`) namespace keyed by the owner key, its PARENT
 *  gateway's machine_id, AND its octet on the deep `/24`: two deep gateways at the
 *  same octet behind different parents therefore each get an independent suffix, and
 *  it can never alias the edge router, an inner gateway, or its own parent. The
 *  server recovers it by walking the owner's chain, which fixes the parent + octet. */
export const computeDeepGatewayId = (
  playerKeyHex: string,
  parentMachineId: string,
  octet: number,
): string =>
  `deep-gw-${deriveHostnameSuffix(`ed25519-deep-gw:${playerKeyHex}:${parentMachineId}:${octet}`)}`;
