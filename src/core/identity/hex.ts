/**
 * Hex encode/decode for byte arrays. Shared by identity primitives,
 * localStorage serialization, and (later) signed-request envelopes —
 * anywhere bytes move through a JSON-safe text channel.
 *
 * Lowercase output by convention (matches Identity.publicKeyHex). Decoding
 * accepts either case to be lenient with hand-typed input; returns null on
 * malformed input rather than throwing, so callers can treat null as
 * "reject / fall back".
 */

export const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
};

export const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};
