import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './hex';

describe('bytesToHex', () => {
  it('encodes bytes as lowercase hex, two chars per byte', () => {
    expect(bytesToHex(new Uint8Array([0, 255, 16]))).toBe('00ff10');
  });

  it('zero-pads bytes below 16 to two chars (catches the padStart width)', () => {
    // Without padStart(2,'0'), byte 5 would encode as '5' not '05'.
    expect(bytesToHex(new Uint8Array([5]))).toBe('05');
  });

  it('encodes an empty array as the empty string', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('');
  });
});

describe('hexToBytes', () => {
  it('decodes lowercase hex into the original bytes', () => {
    expect(hexToBytes('00ff10')).toEqual(new Uint8Array([0, 255, 16]));
  });

  it('accepts uppercase hex (lenient on input case)', () => {
    expect(hexToBytes('FF')).toEqual(new Uint8Array([255]));
  });

  it('decodes the empty string to an empty array', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]));
  });

  it('returns null for odd-length input', () => {
    expect(hexToBytes('abc')).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(hexToBytes('zz')).toBeNull();
  });

  it('round-trips arbitrary bytes through bytesToHex', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 128, 0]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});
