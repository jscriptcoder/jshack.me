import { describe, expect, it } from 'vitest';
import { closeDoorJob } from './closeDoorJob.js';
import { missionKind } from './missionShape.js';
import { keyBoxSuffix } from './targetRoles.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const CLOSE_DOOR_NUMBERS = Array.from({ length: 5000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'closedoor');

describe('what a close-the-door job names', () => {
  it('names its target box for the machine it is, so a sweep of the LAN shows which box it is', () => {
    expect(CLOSE_DOOR_NUMBERS.length).toBeGreaterThan(200);
    for (const missionNumber of CLOSE_DOOR_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        closeDoorJob(missionNumber).machine.suffix,
      );
    }
  });

  it('forwards one of the public ports its machine reads like, each port drawn', () => {
    const portsByMachine = CLOSE_DOOR_NUMBERS.reduce<ReadonlyMap<string, ReadonlySet<number>>>(
      (seen, missionNumber) => {
        const { machine, publicPort } = closeDoorJob(missionNumber);
        expect(machine.publicPorts, `contract ${missionNumber}`).toContain(publicPort);
        return new Map(seen).set(
          machine.suffix,
          new Set([...(seen.get(machine.suffix) ?? []), publicPort]),
        );
      },
      new Map(),
    );

    expect(
      Object.fromEntries([...portsByMachine].map(([suffix, ports]) => [suffix, [...ports].sort()])),
    ).toEqual({
      db: [13306],
      cache: [16379],
      intranet: [8080, 8443],
      dev: [2022, 8022],
    });
  });
});
