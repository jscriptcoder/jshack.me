import { describe, it, expect } from 'vitest';
import { bytesToHex, hexToBytes } from './hex';

describe('bytesToHex', () => {
  it('encodes empty byte array as empty string', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });

  it('encodes single byte with leading-zero padding', () => {
    expect(bytesToHex(new Uint8Array([0x00]))).toBe('00');
    expect(bytesToHex(new Uint8Array([0x0f]))).toBe('0f');
    expect(bytesToHex(new Uint8Array([0xff]))).toBe('ff');
  });

  it('encodes multi-byte arrays in order', () => {
    expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
  });

  it('always emits lowercase', () => {
    expect(bytesToHex(new Uint8Array([0xab, 0xcd, 0xef]))).toBe('abcdef');
  });
});

describe('hexToBytes', () => {
  it('decodes empty string to empty byte array', () => {
    const result = hexToBytes('');
    expect(result).not.toBeNull();
    expect(result).toEqual(new Uint8Array(0));
  });

  it('decodes valid hex (lowercase) to bytes', () => {
    expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('decodes valid hex (uppercase) to bytes', () => {
    expect(hexToBytes('DEADBEEF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('decodes mixed-case hex', () => {
    expect(hexToBytes('DeAdBeEf')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('returns null for odd-length input', () => {
    expect(hexToBytes('abc')).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(hexToBytes('zzzz')).toBeNull();
    expect(hexToBytes('ab cd')).toBeNull();
  });

  it('round-trips: bytesToHex(hexToBytes(x)) === x for valid hex', () => {
    const hex = '0123456789abcdef';
    expect(bytesToHex(hexToBytes(hex)!)).toBe(hex);
  });

  it('round-trips: hexToBytes(bytesToHex(x)) === x for any byte array', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});
