import { describe, it, expect } from 'vitest';
import { findVirtualUserHash } from './virtualUsersConfHelpers';

describe('findVirtualUserHash', () => {
  it('returns the hash for a present username', () => {
    const content = 'alice:5f4dcc3b5aa765d61d8327deb882cf99\nbob:e99a18c428cb38d5f260853678922e03';
    expect(findVirtualUserHash(content, 'alice')).toBe('5f4dcc3b5aa765d61d8327deb882cf99');
    expect(findVirtualUserHash(content, 'bob')).toBe('e99a18c428cb38d5f260853678922e03');
  });

  it('returns undefined when the username is absent from the overlay', () => {
    const content = 'alice:hash1\nbob:hash2';
    expect(findVirtualUserHash(content, 'charlie')).toBeUndefined();
  });

  it('returns undefined for null content', () => {
    expect(findVirtualUserHash(null, 'alice')).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(findVirtualUserHash('', 'alice')).toBeUndefined();
  });

  it('skips malformed lines (no colon) instead of throwing', () => {
    const content = 'malformed-line\nalice:goodhash';
    expect(findVirtualUserHash(content, 'alice')).toBe('goodhash');
  });

  it('skips empty lines and trims whitespace', () => {
    const content = '\n   \nalice:goodhash\n\n';
    expect(findVirtualUserHash(content, 'alice')).toBe('goodhash');
  });

  it('returns undefined when the matching line has empty hash', () => {
    // Defensive: `username:` with no hash isn't a valid credential entry.
    const content = 'alice:\nbob:realhash';
    expect(findVirtualUserHash(content, 'alice')).toBeUndefined();
  });

  it('handles hashes that themselves contain colons (legacy/test-shape robustness)', () => {
    // The format treats EVERYTHING after the first colon as the hash.
    // Real md5 hashes are hex-only (no colons), but split-on-first-colon
    // is the canonical interpretation.
    const content = 'alice:multi:colon:hash';
    expect(findVirtualUserHash(content, 'alice')).toBe('multi:colon:hash');
  });

  it('matches usernames exactly (no prefix/substring confusion)', () => {
    const content = 'alice:hash1\nalicia:hash2';
    expect(findVirtualUserHash(content, 'alice')).toBe('hash1');
    expect(findVirtualUserHash(content, 'alicia')).toBe('hash2');
  });
});
