/**
 * Spoiler obfuscation for build-time secrets (XOR + Base64).
 *
 * This is OBFUSCATION, NOT SECRECY. The key sits in the shipped bundle, so a
 * determined reader can always recover the plaintext. Its only job: stop a
 * casual `grep` of the deployed `dist/` from surfacing spoiler strings (WiFi
 * passwords and friends) that would trivialise the game.
 *
 * The key is deliberately styled as an asset/content fingerprint so it doesn't
 * read as "the decode key" to someone scanning the bundle. Changing it
 * invalidates any already-encoded data — re-run `npm run encode`.
 */
const CODEC_KEY = '9f3a7c1e8b2d4506a1f7e9c3b5d80246';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyBytes = encoder.encode(CODEC_KEY);

const xorBytes = (data: Uint8Array): Uint8Array =>
  Uint8Array.from(data, (byte, index) => byte ^ keyBytes[index % keyBytes.length]);

const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

const fromBase64 = (encoded: string): Uint8Array =>
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

export const encodeContent = (plain: string): string => toBase64(xorBytes(encoder.encode(plain)));

export const decodeContent = (encoded: string): string =>
  decoder.decode(xorBytes(fromBase64(encoded)));
