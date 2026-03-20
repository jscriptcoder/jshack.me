// Generates a random game seed as a 16-character hex string.
// Uses crypto.getRandomValues for proper randomness.
export const generateGameSeed = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
