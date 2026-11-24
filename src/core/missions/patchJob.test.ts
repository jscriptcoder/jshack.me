import { describe, expect, it } from 'vitest';
import { keyBoxSuffix, patchJob } from './targetRoles.js';
import { missionKind } from './missionShape.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const PATCH_NUMBERS = Array.from({ length: 5000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'patch');

describe('what a patch-it job names', () => {
  it('names its target box for the machine it is, so the contractor knows the box they land on', () => {
    expect(PATCH_NUMBERS.length).toBeGreaterThan(200);
    for (const missionNumber of PATCH_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        patchJob(missionNumber).role.suffix,
      );
    }
  });

  it('draws every one of the seven machines', () => {
    const suffixes = new Set(
      PATCH_NUMBERS.map((missionNumber) => patchJob(missionNumber).role.suffix),
    );

    expect([...suffixes].sort()).toEqual(['access', 'backup', 'billing', 'ci', 'lic', 'mon', 'nvr']);
  });
});
