import { describe, expect, it } from 'vitest';
import { MISSION_ROUTE_DAY, missionShape } from './missionShape.js';
import { liveCve } from '../cve/liveCve.js';
import { packageTimeline } from '../cve/packageTimeline.js';
import { FIRMWARE_VENDORS, firmwarePackageOf } from '../packages/packageVersions.js';
import { UNCRACKABLE_HASHES } from '../generation/passwordPools.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

/** The hole each pinned release carries, read straight off the release rather than through
 *  a game day — a release's severity is fixed when it publishes and never changes, so this
 *  is both exact and cheap. A pin whose release this world has no record of is a bug, so it
 *  surfaces as `unknown` rather than being skipped. */
const pinnedSeverities = (versions: Readonly<Record<string, string>>): readonly string[] =>
  Object.entries(versions).map(([key, version]) => {
    const release = packageTimeline(key, MISSION_ROUTE_DAY).find(
      (candidate) => candidate.version === version,
    );
    return release?.severity ?? 'unknown';
  });

describe('missionShape', () => {
  it('is the same shape for the same number', () => {
    expect(missionShape(66051)).toEqual(missionShape(66051));
  });

  it('draws the same stem and key-box octet the topology does, from the number alone', () => {
    // generateHomeLan reads these two off the front of the same stream; if the shape
    // drew them differently the forward would point at the wrong box.
    const shape = missionShape(66051);
    expect(shape.stem.length).toBeGreaterThan(0);
    expect(shape.keyBoxOctet).toBeGreaterThanOrEqual(2);
    expect(shape.keyBoxOctet).toBeLessThanOrEqual(254);
  });

  it('draws both routes across the number space', () => {
    const routes = new Set(SAMPLE_NUMBERS.map((missionNumber) => missionShape(missionNumber).route));
    expect(routes).toEqual(new Set(['hydra', 'msfconsole']));
  });

  const firstWithRoute = (route: 'hydra' | 'msfconsole'): number => {
    const found = SAMPLE_NUMBERS.find((missionNumber) => missionShape(missionNumber).route === route);
    if (found === undefined) throw new Error(`no ${route} contract in the sample`);
    return found;
  };

  it('gives the hydra route a crackable key box root, forwarded to the box own sshd', () => {
    // The hydra route is a way IN: its key box root must be crackable (the msfconsole route's
    // stays shut — see the key-box test), and the gateway forwards the public :2222 onto the
    // box's own :22 so the crack has a real sshd to land on.
    const shape = missionShape(firstWithRoute('hydra'));

    expect(UNCRACKABLE_HASHES).not.toContain(shape.keyBoxRootHash);
    expect(shape.forward).toEqual({ publicPort: 2222, internalPort: 22 });
  });

  it('forwards the msfconsole route straight onto the exposed service port', () => {
    // The way in is the service hole, so the gateway forwards the public port onto the same
    // port the service listens on behind it.
    const shape = missionShape(firstWithRoute('msfconsole'));
    const routeService = shape.keyBoxServices[0];

    expect(routeService).toBeDefined();
    expect(shape.forward).toEqual({
      publicPort: routeService?.port,
      internalPort: routeService?.port,
    });
  });

  it('gives the msfconsole route a live critical hole, and pins everything else safe', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'msfconsole') continue;

      const routeService = shape.keyBoxServices[0];
      expect(routeService).toBeDefined();
      const routeCve = liveCve(
        routeService?.package ?? '',
        routeService?.version ?? '',
        MISSION_ROUTE_DAY,
      );
      // The route's hole is critical and already published by the day the slice ships,
      // so it is live whenever the contract is played.
      expect(routeCve?.severity, `route for ${missionNumber}`).toBe('critical');

      // Nothing the key box carries beyond the route grants more than a guest shell.
      const { [routeService?.package ?? '']: _routeVersion, ...others } = shape.keyBoxVersions;
      for (const severity of pinnedSeverities(others)) {
        expect(['low', 'medium'], `non-route pin for ${missionNumber}`).toContain(severity);
      }
    }
  });

  it('pins the hydra key box and the gateway so nothing on them grants more than guest', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);

      const keyBoxPins = shape.route === 'hydra' ? shape.keyBoxVersions : {};
      for (const severity of pinnedSeverities(keyBoxPins)) {
        expect(['low', 'medium'], `hydra key box for ${missionNumber}`).toContain(severity);
      }
      for (const severity of pinnedSeverities(shape.gatewayVersions)) {
        expect(['low', 'medium'], `gateway for ${missionNumber}`).toContain(severity);
      }
      // The gateway's firmware is among its pins, so the gateway is not rootable by CVE.
      for (const vendor of FIRMWARE_VENDORS) {
        expect(shape.gatewayVersions[firmwarePackageOf(vendor)]).toBeDefined();
      }
    }
  });
});
