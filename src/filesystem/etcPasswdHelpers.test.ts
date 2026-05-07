import { describe, it, expect } from 'vitest';
import { getEtcPasswdHash } from './etcPasswdHelpers';

const line = (username: string, hash: string, uid = 1000) =>
  `${username}:${hash}:${uid}:${uid}:${username}:/home/${username}:/bin/bash`;

describe('getEtcPasswdHash', () => {
  it('returns the hash field for a matching username on a single-line file', () => {
    const content = line('bob', 'abc123');
    expect(getEtcPasswdHash(content, 'bob')).toBe('abc123');
  });

  it('returns the hash field for a matching username in a multi-user file', () => {
    const content = [
      line('root', 'roothash', 0),
      line('bob', 'bobhash', 1001),
      line('guest', 'guesthash', 65534),
    ].join('\n');
    expect(getEtcPasswdHash(content, 'bob')).toBe('bobhash');
    expect(getEtcPasswdHash(content, 'root')).toBe('roothash');
    expect(getEtcPasswdHash(content, 'guest')).toBe('guesthash');
  });

  it('returns undefined when content is null', () => {
    expect(getEtcPasswdHash(null, 'bob')).toBeUndefined();
  });

  it('returns undefined when content is the empty string', () => {
    expect(getEtcPasswdHash('', 'bob')).toBeUndefined();
  });

  it('returns undefined when the username is not in the file', () => {
    const content = line('alice', 'alicehash');
    expect(getEtcPasswdHash(content, 'bob')).toBeUndefined();
  });

  it('returns undefined when the matching entry has an empty hash field', () => {
    // Sabotage shape: bob's line exists but the second colon-separated
    // field is empty (e.g., truncated edit). No usable credential.
    const content = 'bob::1001:1001:bob:/home/bob:/bin/bash';
    expect(getEtcPasswdHash(content, 'bob')).toBeUndefined();
  });

  it('handles a trailing newline without confusing the parser', () => {
    const content = `${line('bob', 'bobhash')}\n`;
    expect(getEtcPasswdHash(content, 'bob')).toBe('bobhash');
  });

  it('returns undefined for malformed lines that do not contain a colon', () => {
    const content = 'this is garbage with no colons at all';
    expect(getEtcPasswdHash(content, 'bob')).toBeUndefined();
  });

  it('matches usernames exactly (does not match prefix substrings)', () => {
    // 'bobby' should not satisfy a lookup for 'bob' just because 'bob' is
    // a prefix. The first colon-separated field must equal the username.
    const content = line('bobby', 'bobbyhash');
    expect(getEtcPasswdHash(content, 'bob')).toBeUndefined();
  });
});
