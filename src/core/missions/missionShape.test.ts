import { describe, expect, it } from 'vitest';
import {
  MISSION_ROUTE_DAY,
  missionShape,
  type MissionForward,
  type MissionRoute,
  type MissionShape,
  type MissionStorage,
} from './missionShape.js';
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

/** A forward's two ports, whichever box it reaches. */
type PortPair = Omit<MissionForward, 'boxOctet'>;

/** The forwards a contract has for its route and its storage, before any decoy, as their ports. */
const realForwards = (shape: MissionShape): readonly PortPair[] =>
  shape.forwards
    .slice(0, shape.forwards.length - shape.keyBox.decoys.length)
    .map(({ publicPort, internalPort }) => ({ publicPort, internalPort }));

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
    expect(shape.keyBox.octet).toBeGreaterThanOrEqual(2);
    expect(shape.keyBox.octet).toBeLessThanOrEqual(254);
  });

  it('draws every route about a sixth of the time', () => {
    const counts = SAMPLE_NUMBERS.reduce<Record<string, number>>((tally, missionNumber) => {
      const { route } = missionShape(missionNumber).keyBox;
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
    for (const [missionNumber, route, stem, octet, rootHash] of before) {
      expect(missionShape(missionNumber)).toMatchObject({
        stem,
        keyBox: { route, octet, rootHash },
      });
    }
  });

  describe('decoys', () => {
    /** What a contract had before decoys: its route and storage, its names, the hashes on its
     *  doors, its real forwards and the services behind them, and its database and community
     *  where the route or the storage put them. A decoy draws on a stream of its own, so none
     *  of it moves; a change would re-roll a contract somebody may already hold. */
    const beforeDecoys = (shape: MissionShape): string => {
      const real = realForwards(shape);
      const forwardedPorts = real.map(({ internalPort }) => internalPort);
      return md5(
        JSON.stringify({
          route: shape.keyBox.route,
          storage: shape.storage,
          stem: shape.stem,
          keyBoxOctet: shape.keyBox.octet,
          keyBoxRootHash: shape.keyBox.rootHash,
          gatewayAdminHash: shape.gatewayAdminHash,
          forwards: real,
          services: shape.keyBox.services.filter(({ port }) => forwardedPorts.includes(port)),
          database:
            shape.keyBox.route === 'mysql' || shape.storage === 'database'
              ? shape.keyBox.database
              : null,
          community: shape.keyBox.route === 'snmp' ? shape.keyBox.communityHash : null,
        }),
      );
    };

    /** One contract of every route and storage, and the digest of what it had before decoys,
     *  taken from the generator as it stood then. */
    const BEFORE_DECOYS: readonly (readonly [number, string])[] = [
      [2, 'e36f71ab2944011b3cbb4eddfb44e868'], // hydra, gpg
      [8383, '1a91fd58214e8396af8413401e11c739'], // ftp, file
      [16764, '646ccb637762c304422bd9971fc3befc'], // mysql, database
      [25145, '82ce6de46a91a30b00ea3035a7332fad'], // ftp, database
      [41907, 'bf8c66bf1de205869667465a64a01786'], // snmp, file
      [50288, '7267dc78e1fc632f631c363951dd4330'], // web, file
      [58669, 'cb05365ca18db26904b0aad1db72edd1'], // web, gpg
      [83812, '0b1c897db7b8604765a5d928d0a82fa0'], // snmp, gpg
      [92193, '2c7418f13f45f6cc6783f384c0d089e7'], // msfconsole, database
      [117336, 'bc52de232c69d51a7215e482cc453904'], // web, database
      [125717, '49e62e4ace55181ab445f5cfafd49bfb'], // snmp, database
      [134098, 'd5f4c3397a2aa98db5074a97f9b76f42'], // mysql, file
      [209527, 'edbbe13c6e744a84e0fb468b77a27048'], // msfconsole, file
      [217908, '336ca5ac3e27ac7b4221a209e62e4854'], // ftp, gpg
      [226289, '2fda4ce88d9d688d6fc7d1807a8a6527'], // mysql, gpg
      [243051, 'fdc080efe1512df31eba9c8dac360134'], // hydra, file
      [326861, 'c16b8ce2c967bb6d3913f7631161be81'], // hydra, database
      [435814, 'dc9971575f323c423e3cf2d6caf9e0d1'], // msfconsole, gpg
    ];

    /** The public port each decoy kind answers on. */
    const DECOY_PORTS = [2222, 80, 21, 3306, 161];

    it('moves nothing a contract already had, and adds its decoys after it', () => {
      for (const [missionNumber, digest] of BEFORE_DECOYS) {
        expect(beforeDecoys(missionShape(missionNumber)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    it('forwards three or four ports, each about half the time, whatever the route', () => {
      const shapes = SAMPLE_NUMBERS.map(missionShape);
      const countsByRoute = shapes.reduce<Record<string, ReadonlySet<number>>>(
        (tally, shape) => ({
          ...tally,
          [shape.keyBox.route]: new Set([
            ...(tally[shape.keyBox.route] ?? []),
            shape.forwards.length,
          ]),
        }),
        {},
      );

      for (const counts of Object.values(countsByRoute)) {
        expect([...counts].sort()).toEqual([3, 4]);
      }
      const threes = shapes.filter((shape) => shape.forwards.length === 3).length;
      expect(threes / shapes.length).toBeGreaterThan(0.4);
      expect(threes / shapes.length).toBeLessThan(0.6);
    });

    it('opens each decoy on a public port some route uses, never one already forwarded', () => {
      for (const shape of SAMPLE_NUMBERS.map(missionShape)) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;
        const publicPorts = shape.forwards.map(({ publicPort }) => publicPort);

        expect(new Set(publicPorts).size, label).toBe(publicPorts.length);
        for (const { publicPort, internalPort } of shape.forwards.slice(
          realForwards(shape).length,
        )) {
          expect(DECOY_PORTS, label).toContain(publicPort);
          expect(internalPort, label).toBe(publicPort === 2222 ? 22 : publicPort);
        }
      }
    });

    it('runs a daemon behind every decoy but ssh, on a release that grants a guest at most', () => {
      const decoyServices = { web: 'http', ftp: 'ftp', mysql: 'mysql', snmp: 'snmp' } as const;
      for (const shape of SAMPLE_NUMBERS.map(missionShape)) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;
        for (const decoy of shape.keyBox.decoys) {
          if (decoy === 'ssh') continue;
          const running = shape.keyBox.services.filter(
            ({ service }) => service === decoyServices[decoy],
          );

          expect(running, `${decoy} decoy on ${label}`).toHaveLength(1);
          expect(shape.keyBox.versions[running[0]?.package ?? ''], label).toBe(running[0]?.version);
          expect(['low', 'medium'], `${decoy} decoy on ${label}`).toContain(
            pinnedSeverities({ [running[0]?.package ?? '']: running[0]?.version ?? '' })[0],
          );
        }
      }
    });

    it('puts a database decoy behind a login a sweep finds and a root that stays shut', () => {
      const listed = DEFAULT_WORDLIST.map((word) => md5(word));
      const shapes = SAMPLE_NUMBERS.map(missionShape).filter((shape) =>
        shape.keyBox.decoys.includes('mysql'),
      );

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;
        expect(listed, label).toContain(shape.keyBox.database?.accountHash);
        expect(SHUT_HASHES, label).toContain(shape.keyBox.database?.rootHash);
      }
    });

    it('gives an agent decoy a read-write community no sweep finds', () => {
      // A read-write community shuts a box's ports without root, so a decoy's stays shut.
      const shapes = SAMPLE_NUMBERS.map(missionShape).filter((shape) =>
        shape.keyBox.decoys.includes('snmp'),
      );

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(SHUT_HASHES, `${shape.keyBox.route} route ${shape.missionNumber}`).toContain(
          shape.keyBox.communityHash,
        );
      }
    });

    it('draws every kind of decoy, so a scan can be any mix of them', () => {
      const kinds = new Set(
        SAMPLE_NUMBERS.flatMap((missionNumber) => missionShape(missionNumber).keyBox.decoys),
      );
      expect([...kinds].sort()).toEqual(['ftp', 'mysql', 'snmp', 'ssh', 'web']);
    });
  });

  /** The first contract on this route keeping its key as `storage` says: a plain file unless
   *  told otherwise, since a database contract adds a door of its own beside the route's. */
  const firstWithRoute = (route: MissionRoute, storage: MissionStorage = 'file'): number => {
    const found = SAMPLE_NUMBERS.find((missionNumber) => {
      const shape = missionShape(missionNumber);
      return shape.keyBox.route === route && shape.storage === storage;
    });
    if (found === undefined) throw new Error(`no ${route} contract in the sample`);
    return found;
  };

  it('gives the hydra route a crackable key box root, forwarded to the box own sshd', () => {
    // The hydra route is a way IN: its key box root must be crackable (the msfconsole route's
    // stays shut — see the key-box test), and the gateway forwards the public :2222 onto the
    // box's own :22 so the crack has a real sshd to land on.
    const shape = missionShape(firstWithRoute('hydra'));

    expect(UNCRACKABLE_HASHES).not.toContain(shape.keyBox.rootHash);
    expect(realForwards(shape)).toEqual([{ publicPort: 2222, internalPort: 22 }]);
  });

  it('forwards the msfconsole route straight onto the exposed service port', () => {
    // The way in is the service hole, so the gateway forwards the public port onto the same
    // port the service listens on behind it.
    const shape = missionShape(firstWithRoute('msfconsole'));
    const routeService = shape.keyBox.services[0];

    expect(routeService).toBeDefined();
    expect(realForwards(shape)).toEqual([
      { publicPort: routeService?.port, internalPort: routeService?.port },
    ]);
  });

  it('gives the msfconsole route a live critical hole, and pins everything else safe', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.keyBox.route !== 'msfconsole') continue;

      const routeService = shape.keyBox.services[0];
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
      const { [routeService?.package ?? '']: _routeVersion, ...others } = shape.keyBox.versions;
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
      if (shape.keyBox.route !== 'msfconsole') continue;

      const [routeService] = shape.keyBox.services;
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

      const keyBoxPins = shape.keyBox.route === 'msfconsole' ? {} : shape.keyBox.versions;
      for (const severity of pinnedSeverities(keyBoxPins)) {
        expect(['low', 'medium'], `${shape.keyBox.route} key box for ${missionNumber}`).toContain(
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
      if (shape.keyBox.route !== 'web' || shape.storage === 'database') continue;

      const [webService] = shape.keyBox.services;
      expect(webService?.service, `web service for ${missionNumber}`).toBe('http');
      expect(webService?.port).toBe(80);
      expect(shape.keyBox.versions[webService?.package ?? '']).toBe(webService?.version);
      expect(realForwards(shape)).toEqual([
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
      if (shape.keyBox.route !== 'ftp' || shape.storage === 'database') continue;

      const [ftpService] = shape.keyBox.services;
      expect(ftpService?.service, `ftp service for ${missionNumber}`).toBe('ftp');
      expect(ftpService?.port).toBe(21);
      expect(shape.keyBox.versions[ftpService?.package ?? '']).toBe(ftpService?.version);
      expect(realForwards(shape)).toEqual([
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
      if (shape.keyBox.route !== 'mysql') continue;

      const [databaseService] = shape.keyBox.services;
      expect(databaseService?.service, `service for ${missionNumber}`).toBe('mysql');
      expect(databaseService?.program).toBe('mysqld');
      expect(databaseService?.port).toBe(3306);
      expect(shape.keyBox.versions[databaseService?.package ?? '']).toBe(databaseService?.version);
      expect(realForwards(shape)).toEqual([
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
      if (shape.keyBox.route !== 'mysql') continue;

      expect(listed, `account of ${missionNumber}`).toContain(shape.keyBox.database?.accountHash);
      expect(SHUT_HASHES, `database root of ${missionNumber}`).toContain(
        shape.keyBox.database?.rootHash,
      );
    }
  });

  it('draws no database on any other route, unless the key is kept in one or a decoy runs one', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.keyBox.route === 'mysql' || shape.storage === 'database') continue;
      if (shape.keyBox.decoys.includes('mysql')) continue;
      expect(shape.keyBox.database, `${shape.keyBox.route} route ${missionNumber}`).toBeNull();
      expect(
        shape.keyBox.services.some(({ service }) => service === 'mysql'),
        `${shape.keyBox.route} route ${missionNumber}`,
      ).toBe(false);
    }
  });

  describe('on a contract that keeps its key in its database', () => {
    // The key is reached from outside, as a database user: whatever the route, the box runs the
    // database behind a forward and an application login a sweep finds. The route still roots
    // the box, which is a second way to the same row.
    const databaseContracts: readonly MissionShape[] = SAMPLE_NUMBERS.map(missionShape).filter(
      (shape) => shape.storage === 'database',
    );

    const SSH: PortPair = { publicPort: 2222, internalPort: 22 };
    const DATABASE: PortPair = { publicPort: 3306, internalPort: 3306 };
    const ROUTE_FORWARDS: Readonly<Record<MissionRoute, readonly PortPair[]>> = {
      hydra: [SSH],
      msfconsole: [{ publicPort: 80, internalPort: 80 }],
      web: [{ publicPort: 80, internalPort: 80 }, SSH],
      ftp: [{ publicPort: 21, internalPort: 21 }, SSH],
      mysql: [DATABASE, SSH],
      snmp: [{ publicPort: 161, internalPort: 161 }, SSH],
    };

    it('meets every route', () => {
      expect(new Set(databaseContracts.map(({ keyBox }) => keyBox.route))).toEqual(
        new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
      );
    });

    it('runs one mysqld, on a release whose hole grants a guest at most', () => {
      for (const shape of databaseContracts) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;
        const databases = shape.keyBox.services.filter(({ service }) => service === 'mysql');

        expect(databases, label).toHaveLength(1);
        expect(databases[0]?.program, label).toBe('mysqld');
        expect(databases[0]?.port, label).toBe(3306);
        expect(shape.keyBox.versions['mysql'], label).toBe(databases[0]?.version);
        expect(['low', 'medium'], label).toContain(
          pinnedSeverities({ mysql: databases[0]?.version ?? '' })[0],
        );
      }
    });

    it('forwards :3306 after the route own forwards, and only once on the database route', () => {
      for (const shape of databaseContracts) {
        const routeForwards = ROUTE_FORWARDS[shape.keyBox.route];

        expect(realForwards(shape), `${shape.keyBox.route} route ${shape.missionNumber}`).toEqual(
          shape.keyBox.route === 'mysql' ? routeForwards : [...routeForwards, DATABASE],
        );
      }
    });

    it('puts the application account on the default list, and its root out of reach', () => {
      const listed = DEFAULT_WORDLIST.map((word) => md5(word));
      for (const shape of databaseContracts) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;

        expect(listed, label).toContain(shape.keyBox.database?.accountHash);
        expect(SHUT_HASHES, label).toContain(shape.keyBox.database?.rootHash);
      }
    });
  });

  it('gives the snmp route an agent on a safe release, reached through :161 beside :2222', () => {
    // The file is the way in, so the agent is a door to read through and not a hole to fall
    // through. :2222 is what the word logs in by, since an agent cannot log anybody in.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.keyBox.route !== 'snmp' || shape.storage === 'database') continue;

      const [agent] = shape.keyBox.services;
      expect(agent?.service, `service for ${missionNumber}`).toBe('snmp');
      expect(agent?.program).toBe('snmpd');
      expect(agent?.port).toBe(161);
      expect(shape.keyBox.versions[agent?.package ?? '']).toBe(agent?.version);
      expect(realForwards(shape)).toEqual([
        { publicPort: 161, internalPort: 161 },
        { publicPort: 2222, internalPort: 22 },
      ]);
    }
  });

  it('puts the read-write community on the default list, so a sweep always finds one', () => {
    const listed = DEFAULT_WORDLIST.map((word) => md5(word));
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.keyBox.route !== 'snmp') continue;

      expect(listed, `community of ${missionNumber}`).toContain(shape.keyBox.communityHash);
    }
  });

  it('draws no community on any other route, unless a decoy runs an agent', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      if (shape.keyBox.route === 'snmp' || shape.keyBox.decoys.includes('snmp')) continue;
      expect(shape.keyBox.communityHash, `${shape.keyBox.route} route ${missionNumber}`).toBeNull();
    }
  });

  it.each(['web', 'ftp', 'mysql', 'snmp'] as const)(
    'spreads %s route roots across the whole slice, so a farmed list really is 13 words',
    (route) => {
      const roots = SAMPLE_NUMBERS.map((missionNumber) => missionShape(missionNumber))
        .filter((shape) => shape.keyBox.route === route)
        .map((shape) => shape.keyBox.rootHash);

      expect([...new Set(roots)].sort()).toEqual([...LEAKABLE_HASHES].sort());
    },
  );

  it('holds a leak route root to the leakable words, and every other shut door out of them', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const shape = missionShape(missionNumber);
      expect(SHUT_HASHES, `gateway of ${missionNumber}`).toContain(shape.gatewayAdminHash);
      if (
        shape.keyBox.route === 'web' ||
        shape.keyBox.route === 'ftp' ||
        shape.keyBox.route === 'mysql' ||
        shape.keyBox.route === 'snmp'
      ) {
        expect(LEAKABLE_HASHES, `${shape.keyBox.route} root of ${missionNumber}`).toContain(
          shape.keyBox.rootHash,
        );
      }
      if (shape.keyBox.route === 'msfconsole') {
        expect(SHUT_HASHES, `msfconsole root of ${missionNumber}`).toContain(shape.keyBox.rootHash);
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
