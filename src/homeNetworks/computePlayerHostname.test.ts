import { describe, it, expect } from 'vitest';
import { computePlayerHostname } from './computePlayerHostname';
import { generateIdentity } from '../identity/identity';
import { deriveHostnameSuffix } from './deriveHostnameSuffix';

describe('computePlayerHostname', () => {
  it('returns workstationName followed by a dash and the identity-derived suffix', () => {
    const identity = generateIdentity();
    const expectedSuffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
    expect(computePlayerHostname('skylab', identity)).toBe(`skylab-${expectedSuffix}`);
  });

  it('matches the format /^.+-[0-9a-f]{4}$/', () => {
    const identity = generateIdentity();
    expect(computePlayerHostname('mainframe', identity)).toMatch(/^mainframe-[0-9a-f]{4}$/);
  });

  it('returns the same hostname for the same (workstationName, identity)', () => {
    const identity = generateIdentity();
    expect(computePlayerHostname('rocket', identity)).toBe(
      computePlayerHostname('rocket', identity),
    );
  });

  it('returns different suffixes for different identities (same prefix)', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(computePlayerHostname('skylab', a)).not.toBe(computePlayerHostname('skylab', b));
  });

  it('preserves the workstationName prefix verbatim', () => {
    const identity = generateIdentity();
    const hostname = computePlayerHostname('weird-name-with-dashes', identity);
    expect(hostname.startsWith('weird-name-with-dashes-')).toBe(true);
  });
});
