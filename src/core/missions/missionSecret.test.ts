import { describe, expect, it } from 'vitest';
import {
  MissionSecretMissingError,
  missionKey,
  missionKeyPath,
  requireMissionSecret,
} from './missionSecret.js';

const SECRET = 'a-deployment-secret';
const OTHER_SECRET = 'a-different-deployment-secret';

const KEY_SHAPE = /^ACCESS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe('the key a contract hands out', () => {
  it('is an ACCESS token of three unambiguous four-character groups', () => {
    expect(missionKey(66051, SECRET)).toMatch(KEY_SHAPE);
  });

  it('is the same key for the same number under the same secret', () => {
    // The key is checked against the proof a contractor mails long after they read it,
    // so a number must always derive the one key, today and on any later game day.
    expect(missionKey(66051, SECRET)).toBe(missionKey(66051, SECRET));
  });

  it('derives a fixed token from the number and secret — a vector that must not drift', () => {
    // Pinned so any change to the HMAC or the base32 encoding is caught: a key a contractor
    // mailed must still verify on a later deploy of the same secret, so the exact bytes the
    // digest produces are part of the contract, not only the token's shape.
    expect(missionKey(66051, SECRET)).toBe('ACCESS-S770-AP28-PYMA');
    expect(missionKey(2, SECRET)).toBe('ACCESS-FMVN-Y62F-129G');
  });

  it('is a different key for a different number', () => {
    expect(missionKey(66051, SECRET)).not.toBe(missionKey(66052, SECRET));
  });

  it('is a different key under a different secret', () => {
    // The secret is what keeps the key out of reach of anyone who knows the number: the
    // number ships in the bundle, the key must not be derivable from it alone. A dev read
    // of a key must not work on prod, so the two deployments' secrets give different keys.
    expect(missionKey(66051, SECRET)).not.toBe(missionKey(66051, OTHER_SECRET));
  });
});

describe('where a contract hides its key', () => {
  it('is an absolute path in a system directory, not a home', () => {
    // A believable root-only file: under a system directory a non-root shell cannot read,
    // never under /home where the world leaves user-owned files.
    expect(missionKeyPath(66051)).toMatch(/^\/(etc|root|var|opt)\//);
  });

  it('is the same path for the same number', () => {
    expect(missionKeyPath(66051)).toBe(missionKeyPath(66051));
  });

  it('varies with the number across the pool, every path a root-only system file', () => {
    // Not a proof of uniqueness — the pool is smaller than the numbers — only that the
    // path is drawn from the number rather than fixed for every contract. Every path the
    // pool can yield is a believable root-only absolute file, so none leaks a key into a
    // place a non-root shell could read.
    const paths = Array.from({ length: 200 }, (_unused, index) => missionKeyPath(index + 2));

    expect(new Set(paths).size).toBeGreaterThan(1);
    for (const path of paths) {
      expect(path).toMatch(/^\/(etc|root|var|opt)\/[^/]/);
    }
  });
});

describe('requiring the deployment secret', () => {
  it('returns the secret when the environment held a non-empty one', () => {
    expect(requireMissionSecret(SECRET)).toBe(SECRET);
  });

  it('fails closed when the secret is unset — no default to guess', () => {
    // There is never a default: a default would put one guessable key in production. A door
    // that needs the secret and finds none must refuse, so the handler can answer 500.
    expect(() => requireMissionSecret(undefined)).toThrow(MissionSecretMissingError);
  });

  it('fails closed when the secret is set but empty', () => {
    expect(() => requireMissionSecret('')).toThrow(MissionSecretMissingError);
  });
});
