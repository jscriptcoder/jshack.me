import { describe, expect, it } from 'vitest';
import {
  MISSION_ROUTE_DAY,
  missionShape,
  type MissionBox,
  type MissionDecoy,
  type MissionForward,
  type MissionRoute,
  type MissionService,
  type MissionShape,
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

/** The box the gateway forwards onto: the front box on a two-hop contract, else the key box. */
const entryBox = (shape: MissionShape): MissionBox => shape.frontBox ?? shape.keyBox;

/** Every box a contract draws a route for: its key box and, on two hops, its front box. */
const boxesOf = (shape: MissionShape): readonly MissionBox[] =>
  shape.frontBox === null ? [shape.keyBox] : [shape.keyBox, shape.frontBox];

/** The forwards a contract has for its route and its storage, before any decoy, as their ports. */
const realForwards = (shape: MissionShape): readonly PortPair[] =>
  shape.forwards
    .slice(0, shape.forwards.length - entryBox(shape).decoys.length)
    .map(({ publicPort, internalPort }) => ({ publicPort, internalPort }));

const SSH: PortPair = { publicPort: 2222, internalPort: 22 };
const DATABASE: PortPair = { publicPort: 3306, internalPort: 3306 };

/** The forwards each route takes onto the box it roots: its door, and `:2222` where a leaked
 *  word logs in. */
const ROUTE_FORWARDS: Readonly<Record<MissionRoute, readonly PortPair[]>> = {
  hydra: [SSH],
  msfconsole: [{ publicPort: 80, internalPort: 80 }],
  web: [{ publicPort: 80, internalPort: 80 }, SSH],
  ftp: [{ publicPort: 21, internalPort: 21 }, SSH],
  mysql: [DATABASE, SSH],
  snmp: [{ publicPort: 161, internalPort: 161 }, SSH],
};

/** The port of the service each route but hydra runs on the box it roots. */
const ROUTE_DOOR_PORTS: Readonly<Record<Exclude<MissionRoute, 'hydra'>, number>> = {
  msfconsole: 80,
  web: 80,
  ftp: 21,
  mysql: 3306,
  snmp: 161,
};

/** A box's services for its route and its storage: those before its decoys' daemons, an ssh
 *  decoy running none of its own. */
const realServices = (box: MissionBox): readonly MissionService[] =>
  box.services.slice(0, box.services.length - box.decoys.filter((decoy) => decoy !== 'ssh').length);

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const SAMPLE_SHAPES: readonly MissionShape[] = SAMPLE_NUMBERS.map(missionShape);

/** Every box in the sample on `route`, with the contract it belongs to. */
const boxesOnRoute = (
  route: MissionRoute,
): readonly { readonly shape: MissionShape; readonly box: MissionBox; readonly label: string }[] =>
  SAMPLE_SHAPES.flatMap((shape) =>
    boxesOf(shape)
      .filter((box) => box.route === route)
      .map((box) => ({
        shape,
        box,
        label: `${box === shape.keyBox ? 'key' : 'front'} box of ${shape.missionNumber}`,
      })),
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
    const counts = SAMPLE_SHAPES.reduce<Record<string, number>>((tally, { keyBox }) => {
      return { ...tally, [keyBox.route]: (tally[keyBox.route] ?? 0) + 1 };
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

  it('makes about a third of the contracts key jobs, a third tamper jobs and a third sabotage jobs', () => {
    const counts = SAMPLE_SHAPES.reduce<Record<string, number>>(
      (tally, { kind }) => ({ ...tally, [kind]: (tally[kind] ?? 0) + 1 }),
      {},
    );

    expect(Object.keys(counts).sort()).toEqual(['key', 'sabotage', 'tamper']);
    for (const [kind, count] of Object.entries(counts)) {
      expect(count / SAMPLE_SHAPES.length, kind).toBeGreaterThan(0.29);
      expect(count / SAMPLE_SHAPES.length, kind).toBeLessThan(0.38);
    }
  });

  it('keeps the key in a file, encrypted, or in a database, each about a third of the time', () => {
    const keyJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'key');
    const counts = keyJobs.reduce<Record<string, number>>((tally, { storage }) => {
      return { ...tally, [String(storage)]: (tally[String(storage)] ?? 0) + 1 };
    }, {});

    expect(Object.keys(counts).sort()).toEqual(['database', 'file', 'gpg']);
    for (const count of Object.values(counts)) {
      expect(count / keyJobs.length).toBeGreaterThan(0.28);
      expect(count / keyJobs.length).toBeLessThan(0.39);
    }
  });

  it("keeps about half the tamper jobs' records in a database and the rest in a file, on every route and both hop counts", () => {
    // A records box keeping a database is reached as a box keeping its key in one is: mysqld, a
    // login a sweep finds, and on one hop a :3306 forward. The tests on such a contract below
    // hold it. One keeping a file is reached by its route's root.
    const tamperJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'tamper');

    expect(new Set(tamperJobs.map(({ storage }) => storage))).toEqual(
      new Set(['database', 'file']),
    );
    for (const storage of ['database', 'file'] as const) {
      const kept = tamperJobs.filter((shape) => shape.storage === storage);

      expect(kept.length / tamperJobs.length, storage).toBeGreaterThan(0.42);
      expect(kept.length / tamperJobs.length, storage).toBeLessThan(0.58);
      expect(new Set(kept.map(({ keyBox }) => keyBox.route)), storage).toEqual(
        new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
      );
      expect(new Set(kept.map(({ frontBox }) => frontBox === null)), storage).toEqual(
        new Set([true, false]),
      );
    }
  });

  it('gives a records box keeping a file no database server and no :3306 forward of its own', () => {
    const fileJobs = SAMPLE_SHAPES.filter(
      ({ kind, storage }) => kind === 'tamper' && storage === 'file',
    );

    for (const shape of fileJobs) {
      const { keyBox } = shape;
      const label = `${keyBox.route} contract ${shape.missionNumber}`;
      const programs = realServices(keyBox).map(({ program }) => program);

      // The database route runs its own mysqld, its door; no other route runs one.
      expect(programs.includes('mysqld'), label).toBe(keyBox.route === 'mysql');
      if (shape.frontBox === null) {
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[keyBox.route]);
      }
    }
  });

  it('gives a sabotage target nothing to keep: no storage, and only the doors its route runs', () => {
    const sabotageJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'sabotage');

    expect(new Set(sabotageJobs.map(({ keyBox }) => keyBox.route))).toEqual(
      new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
    );
    for (const shape of sabotageJobs) {
      const { keyBox } = shape;
      const label = `${keyBox.route} contract ${shape.missionNumber}`;
      const programs = realServices(keyBox).map(({ program }) => program);

      expect(shape.storage, label).toBeNull();
      // The database route runs its own mysqld, its door; no other route runs one.
      expect(programs.includes('mysqld'), label).toBe(keyBox.route === 'mysql');
      if (shape.frontBox === null) {
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[keyBox.route]);
      }
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

  describe('two hops', () => {
    const twoHopShapes = SAMPLE_SHAPES.filter((shape) => shape.frontBox !== null);

    /** Single-hop contracts across the routes and storages, and the digest of each whole shape
     *  taken from the generator before a contract could have two hops. Two hops draw on a
     *  stream of their own, so a contract that stays single-hop keeps its network to the byte.
     *  Only key jobs: a contract that became a tamper job keeps its records in its database. */
    const SINGLE_HOP_BEFORE: readonly (readonly [number, string])[] = [
      [16764, '406a2ac2a2ac5d9d8aba524c1552d5a7'], // mysql, database
      [41907, 'dfe62d63aeea34374499dda4f52983c6'], // snmp, file
      [50288, '9100465eaeba93b353353a2130fe2bc5'], // web, file
      [125717, 'aa7ad61e60fc856f7acba2cd601b660f'], // snmp, database
      [142479, '0a14a7ee3735bccd7c9d9d50b64efc8d'], // ftp, file
      [209527, 'f2edad300e3e6bf84d40b81bff149c01'], // msfconsole, file
      [243051, 'a661feaeb8e04ba2ad1a2f1dd140f0a4'], // hydra, file
      [368903, '36a36b311b4534b957fdb586a4f25297'], // hydra, database
    ];

    /** Two-hop key jobs across the routes and storages, and the digest of each key box as it
     *  stood before the contract had two hops, its forwards and decoys aside: its names, route,
     *  hashes and the doors it ran for its route and its storage. Contracts that later turned
     *  sabotage were swapped for key jobs alike, digested on the generator before sabotage. */
    const KEY_BOX_BEFORE: readonly (readonly [number, string])[] = [
      [8383, 'aaee771c5cc6118f6546fc3a4cd4f013'], // ftp, file
      [134098, 'dcbef343e36fdf2840eedb351fc86040'], // mysql, file
      [452576, '7f574cedfb32bbf08bdf4ec1d0c0adc2'], // web, database
      [486100, '020cfae8783a805a9b0f791209f6e07f'], // snmp, file
      [519624, '6c62e8268001b700677e05dee7a7e670'], // msfconsole, gpg
      [754292, '003e65afea43e84312c9f16c5dac3fc6'], // msfconsole, file
      [1047627, 'f2547fb5f6635ed4b2d5f041fdd1ae32'], // hydra, file
      [1961156, '0d3a36891737ac49d802b89b5db5acd2'], // hydra, gpg
      [5330318, '141ee9f7ca72a345278489238e192c4a'], // mysql, database
      [8984434, '9486fbbd8425f1d82e5976764a1c34e7'], // web, gpg
      [12269786, '02f63ddca1bc7ff62bb445e814beb98d'], // ftp, gpg
    ];

    it('puts the key box behind a front box about a third of the time', () => {
      expect(twoHopShapes.length / SAMPLE_NUMBERS.length).toBeGreaterThan(0.28);
      expect(twoHopShapes.length / SAMPLE_NUMBERS.length).toBeLessThan(0.39);
    });

    it('leaves a single-hop contract exactly as it was', () => {
      for (const [missionNumber, digest] of SINGLE_HOP_BEFORE) {
        const { frontBox, kind, ...shape } = missionShape(missionNumber);
        expect(frontBox, `contract ${missionNumber}`).toBeNull();
        expect(kind, `contract ${missionNumber}`).toBe('key');
        expect(md5(JSON.stringify(shape)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    it('keeps the key box it had, its inside decoys aside', () => {
      for (const [missionNumber, digest] of KEY_BOX_BEFORE) {
        const shape = missionShape(missionNumber);
        const { keyBox } = shape;
        const label = `contract ${missionNumber}`;

        expect(shape.frontBox, label).not.toBeNull();
        expect(
          md5(
            JSON.stringify({
              stem: shape.stem,
              storage: shape.storage,
              gatewayAdminHash: shape.gatewayAdminHash,
              octet: keyBox.octet,
              route: keyBox.route,
              rootHash: keyBox.rootHash,
              database: keyBox.decoys.includes('mysql') ? null : keyBox.database,
              communityHash: keyBox.decoys.includes('snmp') ? null : keyBox.communityHash,
              services: realServices(keyBox),
            }),
          ),
          label,
        ).toBe(digest);
      }
    });

    /** Two-hop key jobs across the routes on each box, and the digest of everything but the key
     *  box, taken from the generator before the key box ran decoys of its own. Contracts that later turned
     *  sabotage were swapped for key jobs alike, digested on the generator before sabotage. */
    const BESIDE_KEY_BOX_BEFORE: readonly (readonly [number, string])[] = [
      [8383, '6f6f3067dd12250be4531b6a7a680890'], // ftp, front msfconsole
      [134098, '3d8cd43ac152027f6eb3e5a142dec083'], // mysql, front hydra
      [452576, 'fbb1a6d118de208d11a970785af2f169'], // web, front hydra
      [486100, 'c356fa209f4fec49e6c8b9a6e359dd89'], // snmp, front hydra
      [519624, '1874be1d39e76a597b1813269fcb3bca'], // msfconsole, front web
      [754292, '10e4a17d13d754700d5f93172421f7e5'], // msfconsole, front web
      [1047627, '2126d38910890ae0e2783d301f3e699b'], // hydra, front snmp
      [1961156, '92d165a7be49111e9d0ba07ba43fbb31'], // hydra, front mysql
      [5330318, 'dac53e92eef67b5ad68c0083305f7e89'], // mysql, front msfconsole
      [8984434, '753e932d1f29c78d6b98330908bfd9a6'], // web, front web
      [12269786, '7b5dd59c802097475555ac3286435859'], // ftp, front snmp
    ];

    it('leaves the front box, the forwards and the gateway as they were', () => {
      for (const [missionNumber, digest] of BESIDE_KEY_BOX_BEFORE) {
        const { keyBox: _keyBox, kind: _kind, ...besideKeyBox } = missionShape(missionNumber);
        expect(md5(JSON.stringify(besideKeyBox)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    describe('inside decoys', () => {
      /** The ports of the doors a key box runs for its route and its storage, in order. */
      const realDoorPorts = (shape: MissionShape): readonly number[] => {
        const { route } = shape.keyBox;
        const routeDoor = route === 'hydra' ? [] : [ROUTE_DOOR_PORTS[route]];
        const keptInDatabase = shape.storage === 'database' && route !== 'mysql' ? [3306] : [];
        return [...routeDoor, ...keptInDatabase];
      };

      it('runs two or three service doors besides :22 on the key box, each about half the time', () => {
        for (const { missionNumber, keyBox } of twoHopShapes) {
          expect([2, 3], `contract ${missionNumber}`).toContain(keyBox.services.length);
        }
        const twos = twoHopShapes.filter(({ keyBox }) => keyBox.services.length === 2).length;
        expect(twos / twoHopShapes.length).toBeGreaterThan(0.4);
        expect(twos / twoHopShapes.length).toBeLessThan(0.6);
      });

      it('runs the real doors first, then a decoy behind every door after them', () => {
        for (const shape of twoHopShapes) {
          const { keyBox } = shape;
          const label = `${keyBox.route} key box of ${shape.missionNumber}`;
          const real = realDoorPorts(shape);

          expect(
            realServices(keyBox).map(({ port }) => port),
            label,
          ).toEqual(real);
          expect(keyBox.decoys, label).toHaveLength(keyBox.services.length - real.length);
        }
      });

      it('fills the gap from web, ftp, mysql and snmp, never twice and never a door it runs', () => {
        const decoyServices: Readonly<Record<MissionDecoy, string>> = {
          ssh: 'ssh',
          web: 'http',
          ftp: 'ftp',
          mysql: 'mysql',
          snmp: 'snmp',
        };
        for (const { missionNumber, keyBox } of twoHopShapes) {
          const label = `${keyBox.route} key box of ${missionNumber}`;
          const ports = keyBox.services.map(({ port }) => port);
          const decoyDoors = keyBox.services.slice(realServices(keyBox).length);

          expect(new Set(ports).size, label).toBe(ports.length);
          expect(
            keyBox.decoys.map((decoy) => decoyServices[decoy]),
            label,
          ).toEqual(decoyDoors.map(({ service }) => service));
        }
      });

      it('reaches every count its real doors allow, on every route and storage', () => {
        const byDoors = new Map<string, { readonly real: number; readonly counts: Set<number> }>();
        for (const shape of twoHopShapes) {
          const real = realDoorPorts(shape);
          const doors = `${shape.keyBox.route} key box on [${real.join(', ')}]`;
          const group = byDoors.get(doors) ?? { real: real.length, counts: new Set<number>() };
          group.counts.add(shape.keyBox.decoys.length);
          byDoors.set(doors, group);
        }

        // Every route on a plain key, and again on a key kept in a database but for mysql's,
        // whose door already is the database's.
        expect(byDoors.size).toBe(11);
        for (const [doors, { real, counts }] of byDoors) {
          expect([...counts].sort(), doors).toEqual([2 - real, 3 - real]);
        }
      });

      it('runs each inside decoy on a release that grants a guest at most', () => {
        for (const { missionNumber, keyBox } of twoHopShapes) {
          const label = `${keyBox.route} key box of ${missionNumber}`;
          for (const decoy of keyBox.services.slice(realServices(keyBox).length)) {
            expect(keyBox.versions[decoy.package], label).toBe(decoy.version);
            expect(['low', 'medium'], label).toContain(
              pinnedSeverities({ [decoy.package]: decoy.version })[0],
            );
          }
        }
      });

      it('puts a database decoy behind a login a sweep finds and a root that stays shut', () => {
        const listed = DEFAULT_WORDLIST.map((word) => md5(word));
        const shapes = twoHopShapes.filter(({ keyBox }) => keyBox.decoys.includes('mysql'));

        expect(shapes.length).toBeGreaterThan(0);
        for (const { missionNumber, keyBox } of shapes) {
          const label = `${keyBox.route} key box of ${missionNumber}`;
          expect(listed, label).toContain(keyBox.database?.accountHash);
          expect(SHUT_HASHES, label).toContain(keyBox.database?.rootHash);
        }
      });

      it('gives an agent decoy a read-write community no sweep finds', () => {
        const shapes = twoHopShapes.filter(({ keyBox }) => keyBox.decoys.includes('snmp'));

        expect(shapes.length).toBeGreaterThan(0);
        for (const { missionNumber, keyBox } of shapes) {
          expect(SHUT_HASHES, `${keyBox.route} key box of ${missionNumber}`).toContain(
            keyBox.communityHash,
          );
        }
      });

      it('draws every kind but ssh, whose door every box already runs', () => {
        const kinds = new Set(twoHopShapes.flatMap(({ keyBox }) => keyBox.decoys));
        expect([...kinds].sort()).toEqual(['ftp', 'mysql', 'snmp', 'web']);
      });
    });

    it('stands the front box at an address of its own, anywhere on the subnet', () => {
      for (const { missionNumber, keyBox, frontBox } of twoHopShapes) {
        expect(frontBox?.octet, `contract ${missionNumber}`).toBeGreaterThanOrEqual(2);
        expect(frontBox?.octet, `contract ${missionNumber}`).toBeLessThanOrEqual(254);
        expect(frontBox?.octet, `contract ${missionNumber}`).not.toBe(keyBox.octet);
      }
      // Drawn rather than placed beside the key box, so its address says nothing.
      const offsets = new Set(
        twoHopShapes.map(({ keyBox, frontBox }) => (frontBox?.octet ?? 0) - keyBox.octet),
      );
      expect(offsets.size).toBeGreaterThan(100);
    });

    it("draws the front box's route from all six, whatever the key box's", () => {
      const counts = twoHopShapes.reduce<Record<string, number>>((tally, { frontBox }) => {
        const route = frontBox?.route ?? 'none';
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
        expect(count / twoHopShapes.length).toBeGreaterThan(0.1);
        expect(count / twoHopShapes.length).toBeLessThan(0.24);
      }
      const sameRoute = twoHopShapes.filter(
        ({ keyBox, frontBox }) => frontBox?.route === keyBox.route,
      );
      expect(sameRoute.length).toBeGreaterThan(0);
      expect(sameRoute.length).toBeLessThan(twoHopShapes.length / 3);
    });

    it('forwards only onto the front box, never onto the key box', () => {
      for (const { missionNumber, forwards, frontBox } of twoHopShapes) {
        for (const forward of forwards) {
          expect(forward.boxOctet, `contract ${missionNumber}`).toBe(frontBox?.octet);
        }
      }
    });

    it('runs a database on the front box only for its own route or behind a decoy', () => {
      // The key is the key box's, so a contract keeping it in a database runs that database
      // inside, on the key box, and the front box gains nothing for it.
      for (const { missionNumber, frontBox } of twoHopShapes) {
        if (frontBox === null) continue;
        if (frontBox.route === 'mysql' || frontBox.decoys.includes('mysql')) continue;
        expect(frontBox.database, `contract ${missionNumber}`).toBeNull();
        expect(
          frontBox.services.some(({ service }) => service === 'mysql'),
          `contract ${missionNumber}`,
        ).toBe(false);
      }
    });
  });

  it('forwards the box it reaches its route doors, then :3306 for a key kept in a database', () => {
    for (const shape of SAMPLE_SHAPES) {
      const entry = entryBox(shape);
      const routeForwards = ROUTE_FORWARDS[entry.route];
      const keptInDatabase =
        entry === shape.keyBox && shape.storage === 'database' && entry.route !== 'mysql';

      expect(realForwards(shape), `${entry.route} route ${shape.missionNumber}`).toEqual(
        keptInDatabase ? [...routeForwards, DATABASE] : routeForwards,
      );
    }
  });

  it('forwards the msfconsole route straight onto the exposed service port', () => {
    // The way in is the service hole, so the gateway forwards the public port onto the same
    // port the service listens on behind it.
    for (const { box, label } of boxesOnRoute('msfconsole')) {
      expect(box.services[0]?.port, label).toBe(ROUTE_FORWARDS.msfconsole[0]?.internalPort);
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

    /** Single-hop key jobs across the routes and storages, and the digest of what each had
     *  before decoys, taken from the generator as it stood then. Contracts that later turned
     *  sabotage were swapped for key jobs alike, digested on the generator before sabotage. */
    const BEFORE_DECOYS: readonly (readonly [number, string])[] = [
      [142479, '1110188b6fd5637a7cca7794d0a8797b'], // ftp, file
      [16764, '646ccb637762c304422bd9971fc3befc'], // mysql, database
      [41907, 'bf8c66bf1de205869667465a64a01786'], // snmp, file
      [50288, '7267dc78e1fc632f631c363951dd4330'], // web, file
      [125717, '49e62e4ace55181ab445f5cfafd49bfb'], // snmp, database
      [209527, 'edbbe13c6e744a84e0fb468b77a27048'], // msfconsole, file
      [243051, 'fdc080efe1512df31eba9c8dac360134'], // hydra, file
      [1399629, '6cb3ec4d0ad9d409b82a5782b65977d7'], // hydra, database
    ];

    /** The public port each decoy kind answers on. */
    const DECOY_PORTS = [2222, 80, 21, 3306, 161];

    it('moves nothing a contract already had, and adds its decoys after it', () => {
      for (const [missionNumber, digest] of BEFORE_DECOYS) {
        expect(beforeDecoys(missionShape(missionNumber)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    it('forwards three or four ports, each about half the time, whatever the route', () => {
      const countsByRoute = SAMPLE_SHAPES.reduce<Record<string, ReadonlySet<number>>>(
        (tally, shape) => {
          const { route } = entryBox(shape);
          return { ...tally, [route]: new Set([...(tally[route] ?? []), shape.forwards.length]) };
        },
        {},
      );

      for (const counts of Object.values(countsByRoute)) {
        expect([...counts].sort()).toEqual([3, 4]);
      }
      const threes = SAMPLE_SHAPES.filter((shape) => shape.forwards.length === 3).length;
      expect(threes / SAMPLE_SHAPES.length).toBeGreaterThan(0.4);
      expect(threes / SAMPLE_SHAPES.length).toBeLessThan(0.6);
    });

    it('opens each decoy on a public port some route uses, never one already forwarded', () => {
      for (const shape of SAMPLE_SHAPES) {
        const label = `${entryBox(shape).route} route ${shape.missionNumber}`;
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
      for (const shape of SAMPLE_SHAPES) {
        const entry = entryBox(shape);
        const label = `${entry.route} route ${shape.missionNumber}`;
        for (const decoy of entry.decoys) {
          if (decoy === 'ssh') continue;
          const running = entry.services.filter(({ service }) => service === decoyServices[decoy]);

          expect(running, `${decoy} decoy on ${label}`).toHaveLength(1);
          expect(entry.versions[running[0]?.package ?? ''], label).toBe(running[0]?.version);
          expect(['low', 'medium'], `${decoy} decoy on ${label}`).toContain(
            pinnedSeverities({ [running[0]?.package ?? '']: running[0]?.version ?? '' })[0],
          );
        }
      }
    });

    it('puts a database decoy behind a login a sweep finds and a root that stays shut', () => {
      const listed = DEFAULT_WORDLIST.map((word) => md5(word));
      const shapes = SAMPLE_SHAPES.filter((shape) => entryBox(shape).decoys.includes('mysql'));

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        const entry = entryBox(shape);
        const label = `${entry.route} route ${shape.missionNumber}`;
        expect(listed, label).toContain(entry.database?.accountHash);
        expect(SHUT_HASHES, label).toContain(entry.database?.rootHash);
      }
    });

    it('gives an agent decoy a read-write community no sweep finds', () => {
      // A read-write community shuts a box's ports without root, so a decoy's stays shut.
      const shapes = SAMPLE_SHAPES.filter((shape) => entryBox(shape).decoys.includes('snmp'));

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        const entry = entryBox(shape);
        expect(SHUT_HASHES, `${entry.route} route ${shape.missionNumber}`).toContain(
          entry.communityHash,
        );
      }
    });

    it('draws every kind of decoy, so a scan can be any mix of them', () => {
      const kinds = new Set(SAMPLE_SHAPES.flatMap((shape) => entryBox(shape).decoys));
      expect([...kinds].sort()).toEqual(['ftp', 'mysql', 'snmp', 'ssh', 'web']);
    });
  });

  it('gives the hydra route a crackable root, on whichever box it roots', () => {
    // The hydra route is a way IN: its root must be crackable (the msfconsole route's stays
    // shut — see the leakable test), reached on the box's own sshd.
    const boxes = boxesOnRoute('hydra');
    expect(boxes.some(({ box, shape }) => box === shape.frontBox)).toBe(true);
    for (const { box, label } of boxes) {
      expect(UNCRACKABLE_HASHES, label).not.toContain(box.rootHash);
    }
  });

  it('gives the msfconsole route a live critical hole, and pins everything else safe', () => {
    const boxes = boxesOnRoute('msfconsole');
    expect(boxes.some(({ box, shape }) => box === shape.frontBox)).toBe(true);
    for (const { box, label } of boxes) {
      const routeService = box.services[0];
      expect(routeService).toBeDefined();
      const routeCve = liveCve(
        routeService?.package ?? '',
        routeService?.version ?? '',
        MISSION_ROUTE_DAY,
      );
      // The route's hole is critical and already published by the day the slice ships,
      // so it is live whenever the contract is played.
      expect(routeCve?.severity, label).toBe('critical');

      // Nothing the box carries beyond the route grants more than a guest shell.
      const { [routeService?.package ?? '']: _routeVersion, ...others } = box.versions;
      for (const severity of pinnedSeverities(others)) {
        expect(['low', 'medium'], `non-route pin on ${label}`).toContain(severity);
      }
    }
  });

  it('gives the msfconsole route a hole that lands a root shell, the only way to read the key', () => {
    // A critical hole that only lists directories or reads a file leaves the root-only key
    // out of reach: the route's own port is the only door to the box, so no shell means no
    // way in at all.
    for (const { box, label } of boxesOnRoute('msfconsole')) {
      const [routeService] = box.services;
      const outcome = exploitOutcome(
        routeService?.package ?? '',
        routeService?.version ?? '',
        MISSION_ROUTE_DAY,
      );
      expect(outcome?.effect, label).toBe('shell_full');
      expect(outcome?.tier, label).toBe('root');
    }
  });

  it('pins every other box and the gateway so nothing on them grants more than guest', () => {
    for (const shape of SAMPLE_SHAPES) {
      for (const box of boxesOf(shape)) {
        const pins = box.route === 'msfconsole' ? {} : box.versions;
        for (const severity of pinnedSeverities(pins)) {
          expect(['low', 'medium'], `${box.route} box of ${shape.missionNumber}`).toContain(
            severity,
          );
        }
      }
      for (const severity of pinnedSeverities(shape.gatewayVersions)) {
        expect(['low', 'medium'], `gateway for ${shape.missionNumber}`).toContain(severity);
      }
      // The gateway's firmware is among its pins, so the gateway is not rootable by CVE.
      for (const vendor of FIRMWARE_VENDORS) {
        expect(shape.gatewayVersions[firmwarePackageOf(vendor)]).toBeDefined();
      }
    }
  });

  // On a leak route the word is the way in, so the door is one to read through and not a hole
  // to fall through: it sits on a safe release, and the word logs in on the box's own sshd.
  it.each([
    ['web', 'http', 'nginx', 80],
    ['ftp', 'ftp', 'vsftpd', 21],
    ['mysql', 'mysql', 'mysqld', 3306],
    ['snmp', 'snmp', 'snmpd', 161],
  ] as const)(
    'gives the %s route its door first, on a safe release, on whichever box it roots',
    (route, service, program, port) => {
      const boxes = boxesOnRoute(route);
      expect(boxes.some(({ box, shape }) => box === shape.frontBox)).toBe(true);
      for (const { box, label } of boxes) {
        const [door] = box.services;
        expect(door, label).toMatchObject({ service, program, port });
        expect(box.versions[door?.package ?? ''], label).toBe(door?.version);
        expect(['low', 'medium'], label).toContain(
          pinnedSeverities({ [door?.package ?? '']: door?.version ?? '' })[0],
        );
      }
    },
  );

  it('puts the database application account on the default list, and its root out of reach', () => {
    // The application account is the way into the table, so a sweep with the list every player
    // starts with has to find it. A shared list of leaked words must never open database root,
    // or the route could be walked around without a sweep.
    const listed = DEFAULT_WORDLIST.map((word) => md5(word));
    for (const { box, label } of boxesOnRoute('mysql')) {
      expect(listed, label).toContain(box.database?.accountHash);
      expect(SHUT_HASHES, label).toContain(box.database?.rootHash);
    }
  });

  it('draws no database on any other route, unless the key is kept in one or a decoy runs one', () => {
    for (const shape of SAMPLE_SHAPES) {
      for (const box of boxesOf(shape)) {
        if (box.route === 'mysql' || box.decoys.includes('mysql')) continue;
        if (box === shape.keyBox && shape.storage === 'database') continue;
        const label = `${box.route} box of ${shape.missionNumber}`;
        expect(box.database, label).toBeNull();
        expect(
          box.services.some(({ service }) => service === 'mysql'),
          label,
        ).toBe(false);
      }
    }
  });

  describe('on a contract that keeps its key in its database', () => {
    // The key is reached as a database user: whatever the route, the key box runs the database
    // and an application login a sweep finds. The route still roots the box, which is a second
    // way to the same row.
    const databaseContracts = SAMPLE_SHAPES.filter((shape) => shape.storage === 'database');

    it('meets every route', () => {
      expect(new Set(databaseContracts.map(({ keyBox }) => keyBox.route))).toEqual(
        new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
      );
    });

    it('runs one mysqld on the key box, on a release whose hole grants a guest at most', () => {
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

    it('puts the application account on the default list, and its root out of reach', () => {
      const listed = DEFAULT_WORDLIST.map((word) => md5(word));
      for (const shape of databaseContracts) {
        const label = `${shape.keyBox.route} route ${shape.missionNumber}`;

        expect(listed, label).toContain(shape.keyBox.database?.accountHash);
        expect(SHUT_HASHES, label).toContain(shape.keyBox.database?.rootHash);
      }
    });
  });

  it('puts the read-write community on the default list, so a sweep always finds one', () => {
    const listed = DEFAULT_WORDLIST.map((word) => md5(word));
    for (const { box, label } of boxesOnRoute('snmp')) {
      expect(listed, label).toContain(box.communityHash);
    }
  });

  it('draws no community on any other route, unless a decoy runs an agent', () => {
    for (const shape of SAMPLE_SHAPES) {
      for (const box of boxesOf(shape)) {
        if (box.route === 'snmp' || box.decoys.includes('snmp')) continue;
        expect(box.communityHash, `${box.route} box of ${shape.missionNumber}`).toBeNull();
      }
    }
  });

  it.each(['web', 'ftp', 'mysql', 'snmp'] as const)(
    'spreads %s route roots across the whole slice, so a farmed list really is 13 words',
    (route) => {
      const roots = boxesOnRoute(route).map(({ box }) => box.rootHash);

      expect([...new Set(roots)].sort()).toEqual([...LEAKABLE_HASHES].sort());
    },
  );

  it('holds a leak route root to the leakable words, and every other shut door out of them', () => {
    for (const shape of SAMPLE_SHAPES) {
      expect(SHUT_HASHES, `gateway of ${shape.missionNumber}`).toContain(shape.gatewayAdminHash);
      for (const box of boxesOf(shape)) {
        const label = `${box.route} box of ${shape.missionNumber}`;
        if (box.route === 'msfconsole') {
          expect(SHUT_HASHES, label).toContain(box.rootHash);
        } else if (box.route !== 'hydra') {
          expect(LEAKABLE_HASHES, label).toContain(box.rootHash);
        }
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
