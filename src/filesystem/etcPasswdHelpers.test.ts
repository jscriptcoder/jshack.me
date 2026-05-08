import { describe, it, expect } from 'vitest';
import {
  deriveUserTypeFromEtcPasswd,
  findEtcPasswdEntry,
  getEtcPasswdHash,
} from './etcPasswdHelpers';

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

describe('deriveUserTypeFromEtcPasswd', () => {
  it('returns "root" when the entry has uid 0', () => {
    const content = line('root', 'roothash', 0);
    expect(deriveUserTypeFromEtcPasswd(content, 'root')).toBe('root');
  });

  it('returns "guest" when the username is exactly "guest"', () => {
    // Even with a non-special uid, the literal username 'guest' is the
    // game's tier marker for unprivileged shell access.
    const content = line('guest', 'guesthash', 65534);
    expect(deriveUserTypeFromEtcPasswd(content, 'guest')).toBe('guest');
  });

  it('returns "user" for a normal non-zero uid that is not "guest"', () => {
    const content = line('bob', 'bobhash', 1001);
    expect(deriveUserTypeFromEtcPasswd(content, 'bob')).toBe('user');
  });

  it('correctly disambiguates root + bob + guest in a multi-user file', () => {
    const content = [
      line('root', 'rh', 0),
      line('bob', 'bh', 1001),
      line('guest', 'gh', 65534),
    ].join('\n');
    expect(deriveUserTypeFromEtcPasswd(content, 'root')).toBe('root');
    expect(deriveUserTypeFromEtcPasswd(content, 'bob')).toBe('user');
    expect(deriveUserTypeFromEtcPasswd(content, 'guest')).toBe('guest');
  });

  it('returns undefined when content is null', () => {
    expect(deriveUserTypeFromEtcPasswd(null, 'bob')).toBeUndefined();
  });

  it('returns undefined when the username is not in the file', () => {
    const content = line('alice', 'ah', 1000);
    expect(deriveUserTypeFromEtcPasswd(content, 'bob')).toBeUndefined();
  });

  it('returns undefined when the uid field is missing', () => {
    // bob:hash:::... — third field empty
    const content = 'bob:bh::1001:bob:/home/bob:/bin/bash';
    expect(deriveUserTypeFromEtcPasswd(content, 'bob')).toBeUndefined();
  });

  it('returns undefined when the uid field is non-numeric (garbled)', () => {
    const content = 'bob:bh:notanumber:1001:bob:/home/bob:/bin/bash';
    expect(deriveUserTypeFromEtcPasswd(content, 'bob')).toBeUndefined();
  });

  it('does not treat a non-root user named "root" with non-zero uid as root', () => {
    // Defense in depth: the special-case is uid 0, not the username.
    // A garbled /etc/passwd that re-uses the 'root' username with a
    // different uid should not auto-promote.
    const content = line('root', 'rh', 1001);
    expect(deriveUserTypeFromEtcPasswd(content, 'root')).toBe('user');
  });
});

describe('findEtcPasswdEntry', () => {
  it('returns combined { passwordHash, userType } for an entry', () => {
    const content = line('bob', 'bobhash', 1001);
    expect(findEtcPasswdEntry(content, 'bob')).toEqual({
      passwordHash: 'bobhash',
      userType: 'user',
    });
  });

  it('returns root for uid=0', () => {
    const content = line('root', 'rh', 0);
    expect(findEtcPasswdEntry(content, 'root')).toEqual({
      passwordHash: 'rh',
      userType: 'root',
    });
  });

  it('returns guest tier for the literal username "guest"', () => {
    const content = line('guest', 'gh', 65534);
    expect(findEtcPasswdEntry(content, 'guest')).toEqual({
      passwordHash: 'gh',
      userType: 'guest',
    });
  });

  it('returns undefined when content is null', () => {
    expect(findEtcPasswdEntry(null, 'bob')).toBeUndefined();
  });

  it('returns undefined when the username is not in the file', () => {
    const content = line('alice', 'ah', 1000);
    expect(findEtcPasswdEntry(content, 'bob')).toBeUndefined();
  });

  it('returns undefined when the hash field is empty (sabotaged entry)', () => {
    const content = 'bob::1001:1001:bob:/home/bob:/bin/bash';
    expect(findEtcPasswdEntry(content, 'bob')).toBeUndefined();
  });

  it('returns undefined when the uid field is missing', () => {
    const content = 'bob:bh::1001:bob:/home/bob:/bin/bash';
    expect(findEtcPasswdEntry(content, 'bob')).toBeUndefined();
  });

  it('disambiguates multiple users in a multi-line file', () => {
    const content = [
      line('root', 'rh', 0),
      line('bob', 'bh', 1001),
      line('guest', 'gh', 65534),
    ].join('\n');
    expect(findEtcPasswdEntry(content, 'root')).toEqual({ passwordHash: 'rh', userType: 'root' });
    expect(findEtcPasswdEntry(content, 'bob')).toEqual({ passwordHash: 'bh', userType: 'user' });
    expect(findEtcPasswdEntry(content, 'guest')).toEqual({ passwordHash: 'gh', userType: 'guest' });
  });
});
