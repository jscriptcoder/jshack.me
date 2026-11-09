import { describe, expect, it } from 'vitest';
import { MISSION_ROUTE_DAY, missionShape, type MissionRoute } from './missionShape.js';
import { liveCve } from '../cve/liveCve.js';
import { exploitOutcome } from '../cve/exploitEffect.js';
import { packageTimeline } from '../cve/packageTimeline.js';
import { FIRMWARE_VENDORS, firmwarePackageOf } from '../packages/packageVersions.js';
import { UNCRACKABLE_HASHES } from '../generation/passwordPools.js';
import { FIXED_BOXES } from '../generation/fixedSites.js';
import { buildFixedSiteFs } from '../generation/fixedSiteFs.js';
import { accountIn } from '../sessions/passwdAccount.js';
import { md5 } from '../generation/md5.js';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist.js';
import { LEAKABLE_HASHES, SHUT_HASHES, fixedBoxRootHash } from './leakablePool.js';

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

  it('draws every route about a sixth of the time', () => {
    const counts = SAMPLE_NUMBERS.reduce<Record<string, number>>((tally, missionNumber) => {
      const { route } = missionShape(missionNumber);
      return { ...tally, [route]: (tally[route] ?? 0) + 1 };
    }, {});

    expect(Object.keys(counts).sort()).toEqual([
      'ftp',
      'hydra',
      'msfconsole',
      'mysql',
      'snmp',
      'web',
    ]);
    for (const count of Object.values(counts)) {
      expect(count / SAMPLE_NUMBERS.length).toBeGreaterThan(0.12);
      expect(count / SAMPLE_NUMBERS.length).toBeLessThan(0.22);
    }
  });

  it('keeps the key in a file, encrypted, or in a database, each about a third of the time', () => {
    const counts = SAMPLE_NUMBERS.reduce<Record<string, number>>((tally, missionNumber) => {
      const { storage } = missionShape(missionNumber);
      return { ...tally, [storage]: (tally[storage] ?? 0) + 1 };
    }, {});

    expect(Object.keys(counts).sort()).toEqual(['database', 'file', 'gpg']);
    for (const count of Object.values(counts)) {
      expect(count / SAMPLE_NUMBERS.length).toBeGreaterThan(0.28);
      expect(count / SAMPLE_NUMBERS.length).toBeLessThan(0.39);
    }
  });

  it('draws where the key is kept without moving anything a contract already had', () => {
    // An accepted contract keeps its network: the storage draw must not shift the topology,
    // the route or the hashes drawn before it existed.
    const before = [
      [66051, 'hydra', 'corva', 87, '5fcfd41e547a12215b173ff47fdd3739'],
      [2, 'hydra', 'sternco', 150, '0d107d09f5bbe40cade3de5c71e9e9b7'],
      [1234567, 'msfconsole', 'oakridge', 207, '505828c63fbafed59bd2d0cec555a8b9'],
      [9999999, 'hydra', 'northgate', 153, 'dfeaf10390e560aea745ccba53e044ed'],
    ] as const;
    for (const [missionNumber, route, stem, keyBoxOctet, keyBoxRootHash] of before) {
      expect(missionShape(missionNumber)).toMatchObject({ route, stem, keyBoxOctet, keyBoxRootHash });
    }
  });

  const firstWithRoute = (route: MissionRoute): number => {
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
    expect(shape.forwards).toEqual([{ publicPort: 2222, internalPort: 22 }]);
  });

  it('forwards the msfconsole route straight onto the exposed service port', () => {
    // The way in is the service hole, so the gateway forwards the public port onto the same
    // port the service listens on behind it.
    const shape = missionShape(firstWithRoute('msfconsole'));
    const routeService = shape.keyBoxServices[0];

    expect(routeService).toBeDefined();
    expect(shape.forwards).toEqual([
      { publicPort: routeService?.port, internalPort: routeService?.port },
    ]);
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

  it('gives the msfconsole route a hole that lands a root shell, the only way to read the key', () => {
    // A critical hole that only lists directories or reads a file leaves the root-only key
    // out of reach: the gateway forwards nothing but the hole's own port, so no shell means
    // no way in at all.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'msfconsole') continue;

      const [routeService] = shape.keyBoxServices;
      const outcome = exploitOutcome(
        routeService?.package ?? '',
        routeService?.version ?? '',
        MISSION_ROUTE_DAY,
      );
      expect(outcome?.effect, `route for ${missionNumber}`).toBe('shell_full');
      expect(outcome?.tier, `route for ${missionNumber}`).toBe('root');
    }
  });

  it('pins every other key box and the gateway so nothing on them grants more than guest', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);

      const keyBoxPins = shape.route === 'msfconsole' ? {} : shape.keyBoxVersions;
      for (const severity of pinnedSeverities(keyBoxPins)) {
        expect(['low', 'medium'], `${shape.route} key box for ${missionNumber}`).toContain(
          severity,
        );
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

  it('gives the web route a web server on a safe release, reached through :80 beside :2222', () => {
    // The leaked word is the way in, so the web server is a door to read through and not a
    // hole to fall through: the forward to :2222 is what the word logs in by.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'web') continue;

      const [webService] = shape.keyBoxServices;
      expect(webService?.service, `web service for ${missionNumber}`).toBe('http');
      expect(webService?.port).toBe(80);
      expect(shape.keyBoxVersions[webService?.package ?? '']).toBe(webService?.version);
      expect(shape.forwards).toEqual([
        { publicPort: 80, internalPort: 80 },
        { publicPort: 2222, internalPort: 22 },
      ]);
    }
  });

  it('gives the ftp route an ftp server on a safe release, reached through :21 beside :2222', () => {
    // The leaked word is the way in, so the daemon is a door to read through and not a hole
    // to fall through. :2222 is what tells a scan this route from an msfconsole route on :21.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'ftp') continue;

      const [ftpService] = shape.keyBoxServices;
      expect(ftpService?.service, `ftp service for ${missionNumber}`).toBe('ftp');
      expect(ftpService?.port).toBe(21);
      expect(shape.keyBoxVersions[ftpService?.package ?? '']).toBe(ftpService?.version);
      expect(shape.forwards).toEqual([
        { publicPort: 21, internalPort: 21 },
        { publicPort: 2222, internalPort: 22 },
      ]);
    }
  });

  it('gives the database route mysqld on a safe release, reached through :3306 beside :2222', () => {
    // The table is the way in, so the daemon is a door to read through and not a hole to fall
    // through. :2222 is what the word logs in by, since a database cannot log anybody in.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'mysql') continue;

      const [databaseService] = shape.keyBoxServices;
      expect(databaseService?.service, `service for ${missionNumber}`).toBe('mysql');
      expect(databaseService?.program).toBe('mysqld');
      expect(databaseService?.port).toBe(3306);
      expect(shape.keyBoxVersions[databaseService?.package ?? '']).toBe(databaseService?.version);
      expect(shape.forwards).toEqual([
        { publicPort: 3306, internalPort: 3306 },
        { publicPort: 2222, internalPort: 22 },
      ]);
    }
  });

  it('puts the database application account on the default list, and its root out of reach', () => {
    // The application account is the way into the table, so a sweep with the list every player
    // starts with has to find it. A shared list of leaked words must never open database root,
    // or the route could be walked around without a sweep.
    const listed = DEFAULT_WORDLIST.map((word) => md5(word));
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'mysql') continue;

      expect(listed, `account of ${missionNumber}`).toContain(shape.keyBoxDatabase?.accountHash);
      expect(SHUT_HASHES, `database root of ${missionNumber}`).toContain(
        shape.keyBoxDatabase?.rootHash,
      );
    }
  });

  it('draws no database on any other route', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route === 'mysql') continue;
      expect(shape.keyBoxDatabase, `${shape.route} route ${missionNumber}`).toBeNull();
    }
  });

  it('gives the snmp route an agent on a safe release, reached through :161 beside :2222', () => {
    // The file is the way in, so the agent is a door to read through and not a hole to fall
    // through. :2222 is what the word logs in by, since an agent cannot log anybody in.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'snmp') continue;

      const [agent] = shape.keyBoxServices;
      expect(agent?.service, `service for ${missionNumber}`).toBe('snmp');
      expect(agent?.program).toBe('snmpd');
      expect(agent?.port).toBe(161);
      expect(shape.keyBoxVersions[agent?.package ?? '']).toBe(agent?.version);
      expect(shape.forwards).toEqual([
        { publicPort: 161, internalPort: 161 },
        { publicPort: 2222, internalPort: 22 },
      ]);
    }
  });

  it('puts the read-write community on the default list, so a sweep always finds one', () => {
    const listed = DEFAULT_WORDLIST.map((word) => md5(word));
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route !== 'snmp') continue;

      expect(listed, `community of ${missionNumber}`).toContain(shape.keyBoxCommunityHash);
    }
  });

  it('draws no community on any other route', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.route === 'snmp') continue;
      expect(shape.keyBoxCommunityHash, `${shape.route} route ${missionNumber}`).toBeNull();
    }
  });

  it.each(['web', 'ftp', 'mysql', 'snmp'] as const)(
    'spreads %s route roots across the whole slice, so a farmed list really is 13 words',
    (route) => {
      const roots = SAMPLE_NUMBERS.map((missionNumber) => missionShape(missionNumber))
        .filter((shape) => shape.route === route)
        .map((shape) => shape.keyBoxRootHash);

      expect([...new Set(roots)].sort()).toEqual([...LEAKABLE_HASHES].sort());
    },
  );

  it('holds a leak route root to the leakable words, and every other shut door out of them', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      expect(SHUT_HASHES, `gateway of ${missionNumber}`).toContain(shape.gatewayAdminHash);
      if (
        shape.route === 'web' ||
        shape.route === 'ftp' ||
        shape.route === 'mysql' ||
        shape.route === 'snmp'
      ) {
        expect(LEAKABLE_HASHES, `${shape.route} root of ${missionNumber}`).toContain(
          shape.keyBoxRootHash,
        );
      }
      if (shape.route === 'msfconsole') {
        expect(SHUT_HASHES, `msfconsole root of ${missionNumber}`).toContain(shape.keyBoxRootHash);
      }
    }
  });
});

describe('the leakable slice of the uncrackable pool', () => {
  it('splits the pool in two, a quarter or so able to leak', () => {
    expect([...LEAKABLE_HASHES, ...SHUT_HASHES].sort()).toEqual([...UNCRACKABLE_HASHES].sort());
    expect(LEAKABLE_HASHES).toHaveLength(13);
  });

  it('never includes the root of a fixed box', () => {
    for (const site of FIXED_BOXES) {
      expect(LEAKABLE_HASHES, site.key).not.toContain(fixedBoxRootHash(site));
    }
  });

  it('reads a fixed box root off the same draw that builds its /etc/passwd', () => {
    // The slice is computed without building ten whole trees, so this holds the cheap draw
    // to the box a player would actually read.
    for (const site of FIXED_BOXES) {
      const root = accountIn(buildFixedSiteFs(site), 'root');
      expect(root?.hash, site.key).toBe(fixedBoxRootHash(site));
    }
  });
});
