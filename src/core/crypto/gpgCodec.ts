/**
 * The cipher behind `gpg -c`/`-d`, apart from the command so the server can seal a file a
 * player later opens with the same command.
 *
 * Legacy's codec, so a file encrypted in one place opens in the other:
 * `base64( FNV-1a(plaintext)[4] XOR key[0..3] || XOR(plaintext, key) )`, keyed by md5 of
 * the passphrase. The four-byte checksum is what makes a wrong passphrase a clean refusal
 * rather than a screenful of garbage, and base64 is what keeps the result storable in a
 * TEXT column.
 */

import { md5 } from '../generation/md5.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_unused, index) =>
    parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );

/** FNV-1a over the plaintext, as four bytes. The offset basis and the prime are
 *  the algorithm's own constants, not arbitrary values. */
const fnv1aBytes = (data: Uint8Array): Uint8Array => {
  const hash = data.reduce(
    (accumulator, byte) => Math.imul(accumulator ^ byte, 0x01000193),
    0x811c9dc5,
  );
  const unsigned = hash >>> 0;
  return Uint8Array.of(
    (unsigned >>> 24) & 0xff,
    (unsigned >>> 16) & 0xff,
    (unsigned >>> 8) & 0xff,
    unsigned & 0xff,
  );
};

const xorWithKey = (data: Uint8Array, key: Uint8Array): Uint8Array =>
  Uint8Array.from(data, (byte, index) => byte ^ (key[index % key.length] as number));

/** Base64 without spreading the array into `String.fromCharCode` — the spread
 *  form legacy used overflows the argument limit on a large file. */
const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

const tryFromBase64 = (encoded: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

/** The checksum as stored: FNV-1a of the plaintext, masked by the first four
 *  key bytes, so it says nothing about the plaintext to a reader without the
 *  passphrase. */
const maskedChecksum = (plaintext: Uint8Array, key: Uint8Array): Uint8Array => {
  const raw = fnv1aBytes(plaintext);
  return Uint8Array.from(raw, (byte, index) => byte ^ (key[index] as number));
};

const keyFrom = (passphrase: string): Uint8Array => hexToBytes(md5(passphrase));

export const encryptContent = (plaintext: string, passphrase: string): string => {
  const key = keyFrom(passphrase);
  const data = encoder.encode(plaintext);
  const combined = new Uint8Array(4 + data.length);
  combined.set(maskedChecksum(data, key));
  combined.set(xorWithKey(data, key), 4);
  return toBase64(combined);
};

/** `null` for anything that does not decrypt: a wrong passphrase, a file that
 *  was never ciphertext, a truncated one. The caller says so in one voice — the
 *  three cases are indistinguishable by construction, which is the point. */
export const decryptContent = (ciphertext: string, passphrase: string): string | null => {
  const key = keyFrom(passphrase);
  // `atob` THROWS on anything that is not base64, which is most files a player
  // will point this at by mistake. Caught here so the refusal is gpg's, not the
  // shell's report of an exception escaping a command.
  const encrypted = tryFromBase64(ciphertext);
  if (encrypted === null || encrypted.length < 4) return null;

  const plaintext = xorWithKey(encrypted.slice(4), key);
  const expected = maskedChecksum(plaintext, key);
  const stored = encrypted.slice(0, 4);
  if (!stored.every((byte, index) => byte === expected[index])) return null;

  return decoder.decode(plaintext);
};
