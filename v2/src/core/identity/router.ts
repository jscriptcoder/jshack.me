/**
 * Router identity — the canonical machine_id for a player's home router.
 *
 * The router is a DISTINCT machine from the player's workstation: it bears the
 * public IP, runs its own `sshd`, and owns `/etc/iptables/rules.v4`. It must NOT
 * alias the workstation, so it derives from a SEPARATE hash namespace.
 *
 * `isOwnWorkstation` matches on the identity-derived suffix ALONE (it ignores
 * the name part), so a router id built from the same `'ed25519:'` namespace as
 * the workstation would collide on the suffix and be wrongly claimed as the
 * player's own box. The `'ed25519-router:'` prefix is therefore LOAD-BEARING —
 * same key, different domain → an independent, never-colliding suffix. Both the
 * registry writer and every server-side lookup call this one function, so the
 * exact prefix bytes are an internal detail; only determinism + distinctness
 * from the workstation suffix are the contract.
 */

import { deriveHostnameSuffix } from './workstation';

export const computeRouterId = (playerKeyHex: string): string =>
  `router-${deriveHostnameSuffix(`ed25519-router:${playerKeyHex}`)}`;

/** Whether `machineId` is the caller's OWN router — the router counterpart of
 *  `isOwnWorkstation`. The router has its own (`'ed25519-router:'`) namespace, so
 *  this is a plain identity-derived match: A's router id is `computeRouterId(A)`
 *  and no other key reproduces it. Used both client-side (route the own-router FS
 *  view, exclude it from the cross-player hop) and server-side (the L2 walker
 *  rebuilds the router tree for an own-router write). Unlike `isOwnWorkstation`,
 *  holding this id grants no L1 bypass: the router is always session-gated. */
export const isOwnRouter = (machineId: string, playerKeyHex: string): boolean =>
  machineId === computeRouterId(playerKeyHex);

/** The machine_id for a deeper-layer gateway hanging off the player's OWN LAN — a
 *  router the player owns, but which must NOT alias the edge router. It derives
 *  from a SEPARATE (`ed25519-inner-gw:`) namespace keyed by BOTH the owner key and
 *  the gateway's LAN octet: the octet-less edge router (`computeRouterId`) and a
 *  second inner gateway at another octet therefore each get an independent suffix,
 *  and an NPC sibling that happens to share the octet (the coordinate `host:`
 *  namespace) can never collide either. Like the edge router, the server recovers
 *  this id by regenerating the owner's LAN, which fixes the octet. */
export const computeInnerGatewayId = (playerKeyHex: string, octet: number): string =>
  `inner-gw-${deriveHostnameSuffix(`ed25519-inner-gw:${playerKeyHex}:${octet}`)}`;

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
