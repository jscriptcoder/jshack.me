import { describe, expect, it } from 'vitest';
import { chainJob, keyBoxSuffix } from './targetRoles.js';
import { missionKind } from './missionShape.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const CHAIN_NUMBERS = Array.from({ length: 6000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'chain');

/** The classic ports a client names for the listener it wants left. */
const CLASSIC_PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337];

/** Every machine a client can want taken down. */
const MACHINES = [
  'CCTV recorder',
  'backup server',
  'monitoring station',
  'build server',
  'licence server',
  'door-access controller',
  'billing server',
];

describe('what a chain job names', () => {
  it("names a listener port from the backdoor job's eight, each about an eighth of the time", () => {
    const ports = CHAIN_NUMBERS.map((missionNumber) => chainJob(missionNumber).port);

    expect(new Set(ports)).toEqual(new Set(CLASSIC_PORTS));
    for (const port of CLASSIC_PORTS) {
      const share = ports.filter((drawn) => drawn === port).length / ports.length;
      expect(share, `port ${port}`).toBeGreaterThan(0.08);
      expect(share, `port ${port}`).toBeLessThan(0.17);
    }
  });

  it('names a machine to take down from the seven, each about a seventh of the time', () => {
    const machines = CHAIN_NUMBERS.map((missionNumber) => chainJob(missionNumber).role.noun);

    for (const machine of MACHINES) {
      const share = machines.filter((drawn) => drawn === machine).length / machines.length;
      expect(share, machine).toBeGreaterThan(0.1);
      expect(share, machine).toBeLessThan(0.19);
    }
  });

  // The machine to take down stands in the key-box slot, behind the front box the listener goes on.
  it('names the box in the key-box slot for the machine it asks taken down', () => {
    for (const missionNumber of CHAIN_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        chainJob(missionNumber).role.suffix,
      );
    }
  });
});
