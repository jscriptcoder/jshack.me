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
