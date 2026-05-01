import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '../identity/hex.js';

// Identity-derived stable hostname suffix. Same player key always produces
// the same suffix, regardless of which LAN they join — gives players a
// recognizable cross-LAN handle for the trail-following gameplay.
//
// Universal application (every player, every LAN) is what makes this
// leak-free: a suffix on your hostname says nothing about other occupants
// because everyone has one. Truncating to 4 hex chars (~65k space) keeps
// pairwise collision probability under 0.05% in 8-slot LANs while leaving
// the suffix short enough for humans to read.
//
// See README.md "Design rules" for the full rationale.

export const deriveHostnameSuffix = (playerKey: string): string => {
  const bytes = new TextEncoder().encode(playerKey);
  return bytesToHex(sha256(bytes)).slice(0, 4);
};
