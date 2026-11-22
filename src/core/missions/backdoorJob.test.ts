import { describe, expect, it } from 'vitest';
import { backdoorJob } from './targetRoles.js';
import { missionKind } from './missionShape.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const BACKDOOR_NUMBERS = Array.from({ length: 5000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'backdoor');

/** The classic ports a client names for the listener it wants left. */
const CLASSIC_PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337];

describe('the port a backdoor job names', () => {
  it('is one of eight classic listener ports, each about an eighth of the time', () => {
    const ports = BACKDOOR_NUMBERS.map((missionNumber) => backdoorJob(missionNumber).port);

    expect(new Set(ports)).toEqual(new Set(CLASSIC_PORTS));
    for (const port of CLASSIC_PORTS) {
      const share = ports.filter((drawn) => drawn === port).length / ports.length;
      expect(share, `port ${port}`).toBeGreaterThan(0.08);
      expect(share, `port ${port}`).toBeLessThan(0.17);
    }
  });

  // A target only runs services on their default ports, so a port no service defaults to is
  // one the box never already holds, and `nc -l` on it is never refused as in use.
  it('is never a port any service runs on by default', () => {
    const servicePorts = Object.values(SERVICE_CATALOG).map(({ defaultPort }) => defaultPort);

    for (const port of CLASSIC_PORTS) expect(servicePorts).not.toContain(port);
  });
});
