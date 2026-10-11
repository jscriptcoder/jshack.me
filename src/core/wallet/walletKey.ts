/**
 * A wallet's key, the address it answers to, and the file that holds them.
 *
 * The key is the wallet. Nothing ties it to the player who made it: it is a
 * fresh Ed25519 key, drawn at random rather than derived from their identity,
 * so whoever holds the file's text holds the coins at its address.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { generateIdentity, publicKeyOf } from '../identity/identity.js';
import { bytesToHex, hexToBytes } from '../identity/hex.js';
import type { Signer } from '../signedRequest/sign.js';

/** How many hex characters of the public key's hash an address keeps. The key
 *  itself is 64, and two of those do not fit on one history line. */
const ADDRESS_HASH_LENGTH = 40;

/** The whole of what makes text an address. There is no check character and no
 *  list of addresses in use, so a mistyped one of the right shape is an address
 *  like any other, and upper case is not. */
const ADDRESS = new RegExp(`^jsc[0-9a-f]{${ADDRESS_HASH_LENGTH}}$`);

/** A key line: the label at the start of a line and 64 lower-case hex characters
 *  to its end, as `formatWalletFile` writes it. */
const KEY_LINE = /^key: ([0-9a-f]{64})$/m;

export type WalletKey = {
  readonly address: string;
  /** Hex-encoded private key. */
  readonly keyHex: string;
};

export const isAddress = (text: string): boolean => ADDRESS.test(text);

const addressOfPublicKeyBytes = (publicKey: Uint8Array): string =>
  `jsc${bytesToHex(sha256(publicKey)).slice(0, ADDRESS_HASH_LENGTH)}`;

/** The address a public key answers to. It is worked out from the key's bytes,
 *  so the same key written in upper case is the same address. Every caller hands
 *  this 64 hex characters (an envelope's public key, already checked for shape),
 *  so hexToBytes never returns null here. */
export const addressOfPublicKey = (publicKeyHex: string): string =>
  addressOfPublicKeyBytes(hexToBytes(publicKeyHex)!);

// Every caller hands this 64-char hex (a made key, or one KEY_LINE matched), so
// hexToBytes never returns null here.
const walletKeyOf = (keyHex: string): WalletKey => ({
  address: addressOfPublicKeyBytes(publicKeyOf(hexToBytes(keyHex)!)),
  keyHex,
});

/** Both halves of a wallet's key, as a signed request wants its signer. Every
 *  caller hands this a key `readWalletFile` matched, so hexToBytes never returns
 *  null here. */
export const signerOf = (keyHex: string): Signer => ({
  publicKeyHex: bytesToHex(publicKeyOf(hexToBytes(keyHex)!)),
  privateKeyHex: keyHex,
});

/** A new key pair has exactly the shape an identity does, so it is made the same
 *  way. It is a different key from the player's own, every time. */
export const generateWalletKey = (): WalletKey => walletKeyOf(generateIdentity().privateKeyHex);

/** The address line is for whoever reads the file with `cat`. Only the key line
 *  is ever read back. */
export const formatWalletFile = ({ address, keyHex }: WalletKey): string =>
  `address: ${address}\nkey: ${keyHex}\n`;

/** The key a wallet file holds, with the address worked out from it again, or
 *  `null` when the text holds no key line. What the file's own address line says
 *  is not consulted: an edited one would otherwise name somebody else's coins. */
export const readWalletFile = (content: string): WalletKey | null => {
  const keyHex = KEY_LINE.exec(content)?.[1];
  return keyHex === undefined ? null : walletKeyOf(keyHex);
};
