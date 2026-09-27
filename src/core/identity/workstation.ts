/**
 * Workstation identity — the canonical machine_id for a player's own box.
 *
 * Under the eliminated-localhost model, a player's workstation is stored
 * everywhere (patches.machine_id, sessions, Realtime channel, occupant
 * hostname) as `${workstationName}-${suffix}`, where the suffix is derived
 * from the player's identity. Two players who pick the same name still get
 * distinct ids because the suffix is identity-derived.
 *
 * The `'ed25519:'` prefix is LOAD-BEARING: the suffix is
 * sha256('ed25519:' + playerKeyHex)[0..8], NOT sha256(playerKeyHex)[0..8].
 * Deriving without the prefix produces a divergent suffix that silently
 * breaks every cross-player auth/lookup path (see
 * project_workstation_id_ed25519_prefix). The only public entry points apply
 * the prefix internally — callers pass the raw playerKeyHex.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from './hex';

/** sha256 of the given (already-prefixed) string, first 8 hex chars. */
export const deriveHostnameSuffix = (playerKey: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(playerKey))).slice(0, 8);

export const computeWorkstationId = (workstationName: string, playerKeyHex: string): string =>
  `${workstationName}-${deriveHostnameSuffix(`ed25519:${playerKeyHex}`)}`;

// `${name}-${8 lowercase hex}`. The greedy `.+` keeps internal hyphens in the
// name (e.g. `skylab-prime`), matching only the final 8-hex group as suffix.
const WORKSTATION_ID_PATTERN = /^(.+)-([0-9a-f]{8})$/;

export const parseWorkstationId = (
  id: string,
): { readonly name: string; readonly suffix: string } | undefined => {
  const match = WORKSTATION_ID_PATTERN.exec(id);
  if (match === null) return undefined;
  return { name: match[1]!, suffix: match[2]! };
};

/** Server-side own-workstation check: the server doesn't know the player's
 *  chosen workstation NAME, only their pubkey — so it matches on the
 *  identity-derived suffix. Non-workstation ids (IPv4, mission/world ids)
 *  are never "own". */
export const isOwnWorkstation = (machineId: string, playerKeyHex: string): boolean => {
  const parsed = parseWorkstationId(machineId);
  if (parsed === undefined) return false;
  return parsed.suffix === deriveHostnameSuffix(`ed25519:${playerKeyHex}`);
};
