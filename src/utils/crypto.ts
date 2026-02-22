// Crypto utilities for deterministic XOR encryption with FNV-1a checksum.
// Used by the decrypt command and mission generator for encrypted exfiltrate targets.

// Convert hex string to Uint8Array
export const hexToBytes = (hex: string): Uint8Array => {
  const cleanHex = hex.replace(/\s/g, '');
  const buffer = new ArrayBuffer(cleanHex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Convert Uint8Array to hex string
export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// Generate a random 256-bit key as hex string
export const generateKey = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

// FNV-1a hash of a byte array, returning 4 bytes.
const fnv1aBytes = (data: Uint8Array): Uint8Array => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] as number;
    hash = Math.imul(hash, 0x01000193);
  }
  const h = hash >>> 0;
  return new Uint8Array([(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff]);
};

// XOR data with a cycled key
const xorWithKey = (data: Uint8Array, keyBytes: Uint8Array): Uint8Array => {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = (data[i] as number) ^ (keyBytes[i % keyBytes.length] as number);
  }
  return result;
};

// Encrypt content using XOR with FNV-1a checksum.
// Format: base64( checksum[4] + xor(plaintext, key) )
// Checksum = FNV-1a(plaintext) XOR'd with first 4 key bytes.
export const encryptContent = (plaintext: string, keyHex: string): string => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const keyBytes = hexToBytes(keyHex);

  // Compute checksum: FNV-1a of plaintext XOR'd with first 4 key bytes
  const rawChecksum = fnv1aBytes(data);
  const checksum = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    checksum[i] = (rawChecksum[i] as number) ^ (keyBytes[i] as number);
  }

  // XOR encrypt the plaintext
  const ciphertext = xorWithKey(data, keyBytes);

  // Combine: checksum + ciphertext
  const combined = new Uint8Array(4 + ciphertext.length);
  combined.set(checksum);
  combined.set(ciphertext, 4);

  return btoa(String.fromCharCode(...combined));
};

// Decrypt content using XOR with FNV-1a checksum verification.
// Throws on checksum mismatch (wrong key or corrupted data).
export const decryptContent = (encryptedBase64: string, keyHex: string): string => {
  const encryptedData = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const keyBytes = hexToBytes(keyHex);

  if (encryptedData.length < 4) {
    throw new Error('Decryption failed: data too short');
  }

  // Extract checksum and ciphertext
  const storedChecksum = encryptedData.slice(0, 4);
  const ciphertext = encryptedData.slice(4);

  // XOR decrypt
  const decrypted = xorWithKey(ciphertext, keyBytes);

  // Verify checksum: FNV-1a(decrypted) XOR'd with first 4 key bytes should match stored
  const rawChecksum = fnv1aBytes(decrypted);
  const expectedChecksum = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    expectedChecksum[i] = (rawChecksum[i] as number) ^ (keyBytes[i] as number);
  }

  const checksumMatch = storedChecksum.every((b, i) => b === expectedChecksum[i]);
  if (!checksumMatch) {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};
