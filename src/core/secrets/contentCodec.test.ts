import { describe, expect, it } from 'vitest';
import { decodeContent, encodeContent } from './contentCodec';

/**
 * The codec is obfuscation, not secrecy: it keeps spoiler strings (WiFi
 * passwords) out of a grep of the deployed bundle, nothing more. Its contract
 * is a pure round-trip plus a fixed wire format. The known vectors LOCK the
 * XOR key and the base64 alphabet, so any mutation to either is caught (a
 * round-trip test alone would survive a key change — encode and decode would
 * mutate together).
 */
describe('contentCodec', () => {
  it.each([
    'hello',
    '',
    'cr4ck3d_w1f1',
    'sunshine2024',
    'café ☕ — unicode/emoji round-trips',
    JSON.stringify(['a', 'list', 'of', 'passwords']),
  ])('round-trips %j unchanged', (plain) => {
    expect(decodeContent(encodeContent(plain))).toBe(plain);
  });

  it('encodes to the locked wire format (pins the XOR key + base64 alphabet)', () => {
    expect(encodeContent('hello')).toBe('UQNfDVg=');
    expect(encodeContent('')).toBe('');
    expect(encodeContent('cr4ck3d_w1f1')).toBe('WhQHAlxQVTpPU1RV');
  });

  it('decodes a known-encoded constant back to plaintext', () => {
    expect(decodeContent('WhQHAlxQVTpPU1RV')).toBe('cr4ck3d_w1f1');
  });
});
