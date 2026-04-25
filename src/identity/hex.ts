// Hex encode/decode for byte arrays. Shared by identity primitives,
// localStorage serialization, and signed-request envelopes — anywhere we
// need to move bytes through a JSON-safe text channel.
//
// Lowercase output by convention (matches Identity.publicKeyHex). Decoding
// accepts either case to be lenient with hand-typed input.

export const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
};

// Returns null on malformed input rather than throwing — callers in the
// identity/storage paths use this as a validation step where null means
// "fall back / reject."
export const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};
