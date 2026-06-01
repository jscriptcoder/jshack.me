import { describe, expect, it } from 'vitest';
import { md5 } from './md5';

/**
 * md5 is a verbatim port of the legacy RFC 1321 implementation. Its public
 * contract is the RFC's published test vectors — assert against those so the
 * port is real, not a stub, and so any mutation to the algorithm's internals
 * is caught (acceptance criterion: "hashes are real, not stubbed").
 */
describe('md5 (RFC 1321 known vectors)', () => {
  it('hashes the empty string', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('hashes "abc"', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('hashes "message digest"', () => {
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('hashes a message long enough to span multiple 64-byte blocks', () => {
    // 80 chars > 64 → exercises the multi-block + length-padding path.
    expect(md5('a'.repeat(80))).toBe('b15af9cdabbaea0516866a33d8fd0f98');
  });

  it('hashes a 55-byte message (just fits the length field — no extra block)', () => {
    // 55 is the exact boundary: the 0x80 terminator lands in byte 55, leaving
    // room for the 8-byte length in the same block. Pins `i > 55` against the
    // off-by-one `i >= 55`, which would wrongly emit an extra block here.
    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
  });

  it('hashes a 56-byte message (the length spills the padding into an extra block)', () => {
    // A 56-byte remainder leaves no room for the 8-byte length field in the
    // same block, forcing the `i > 55` extra-block path in md5core.
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
  });
});
