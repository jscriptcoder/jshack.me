import { describe, expect, it } from 'vitest';
import { cleanupJob, keyBoxSuffix } from './targetRoles.js';
import { missionKind } from './missionShape.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const CLEANUP_NUMBERS = Array.from({ length: 5000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'cleanup');

/** The classic ports an intruder's listener holds. */
const CLASSIC_PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337];

describe('what a cleanup job names', () => {
  it('names a port one of the eight classic listener ports, each about an eighth of the time', () => {
    const ports = CLEANUP_NUMBERS.map((missionNumber) => cleanupJob(missionNumber).port);

    expect(new Set(ports)).toEqual(new Set(CLASSIC_PORTS));
    for (const port of CLASSIC_PORTS) {
      const share = ports.filter((drawn) => drawn === port).length / ports.length;
      expect(share, `port ${port}`).toBeGreaterThan(0.07);
      expect(share, `port ${port}`).toBeLessThan(0.18);
    }
  });

  it('names its target box for the machine it is, so the contractor knows the box they land on', () => {
    for (const missionNumber of CLEANUP_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        cleanupJob(missionNumber).role.suffix,
      );
    }
  });

  it('runs each machine’s listener under a named service account of its own', () => {
    const accounts = new Map(
      CLEANUP_NUMBERS.map((missionNumber) => {
        const { role } = cleanupJob(missionNumber);
        return [role.suffix, role.serviceAccount] as const;
      }),
    );

    expect(accounts.size).toBe(7);
    expect(new Set(accounts.values()).size).toBe(7);
    for (const [suffix, account] of accounts) expect(account, suffix).toMatch(/^[a-z][a-z0-9]*$/);
  });
});
