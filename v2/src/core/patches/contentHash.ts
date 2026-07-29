/**
 * contentHash — the fingerprint an editor sends to say "this is the content I was
 * shown", so a save can be refused when the machine no longer holds it.
 *
 * Shared deliberately by both ends: the client hashes the buffer it opened, the
 * server hashes the row a reader would materialize, and they compare. Two
 * implementations of "the same content" could drift into rejecting every save.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '../identity/hex';

export const contentHash = (content: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(content)));
