/**
 * A wallet's key, the address it answers to, and the file that holds them.
 *
 * The key is the wallet. Nothing ties it to the player who made it: it is a
 * fresh Ed25519 key, drawn at random rather than derived from their identity,
 * so whoever holds the file's text holds the coins at its address.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { generateIdentity } from '../identity/identity.js';
import { bytesToHex, hexToBytes } from '../identity/hex.js';

/** How many hex characters of the public key's hash an address keeps. The key
 *  itself is 64, and two of those do not fit on one history line. */
const ADDRESS_HASH_LENGTH = 40;

export type WalletKey = {
  readonly address: string;
  /** Hex-encoded private key. */
  readonly keyHex: string;
};

// publicKeyHex is 64-char hex by construction (generateIdentity), so hexToBytes
// never returns null here.
const addressOfPublicKey = (publicKeyHex: string): string =>
  `jsc${bytesToHex(sha256(hexToBytes(publicKeyHex)!)).slice(0, ADDRESS_HASH_LENGTH)}`;

/** A new key pair has exactly the shape an identity does, so it is made the same
 *  way. It is a different key from the player's own, every time. */
export const generateWalletKey = (): WalletKey => {
  const { publicKeyHex, privateKeyHex } = generateIdentity();
  return { address: addressOfPublicKey(publicKeyHex), keyHex: privateKeyHex };
};

/** The address line is for whoever reads the file with `cat`. Only the key line
 *  is ever read back. */
export const formatWalletFile = ({ address, keyHex }: WalletKey): string =>
  `address: ${address}\nkey: ${keyHex}\n`;
