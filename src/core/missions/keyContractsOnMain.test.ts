import { describe, expect, it } from 'vitest';
import { missionShape } from './missionShape.js';
import { missionTerms } from './missionTerms.js';
import { md5 } from '../generation/md5.js';
import { MAIN_DIGESTS } from './keyContractsOnMain.js';

// A guard for one branch only: the shape and terms main drew for a spread of numbers, hashed.
// Turning half the contracts into tamper jobs must leave every one that stays a key job exactly
// as it was. Deleted before the branch merges, since main moves on from here.

describe('a contract that stays a key job', () => {
  it('draws the shape and the terms main drew, to the byte', () => {
    const keyDigests = MAIN_DIGESTS.filter(
      ([missionNumber]) => missionShape(missionNumber).kind === 'key',
    );

    expect(keyDigests.length).toBeGreaterThan(800);
    for (const [missionNumber, shapeDigest, termsDigest] of keyDigests) {
      const { kind: _kind, ...shapeOnMain } = missionShape(missionNumber);
      const { job: _job, ...termsOnMain } = missionTerms(missionNumber);

      expect(md5(JSON.stringify(shapeOnMain)), `shape ${missionNumber}`).toBe(shapeDigest);
      expect(md5(JSON.stringify(termsOnMain)), `terms ${missionNumber}`).toBe(termsDigest);
    }
  });
});
