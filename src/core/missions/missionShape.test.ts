import { describe, expect, it } from 'vitest';
import {
  MISSION_ROUTE_DAY,
  missionShape,
  type MissionBox,
  type MissionForward,
  type MissionRoute,
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

  it('keeps the key in a file, encrypted, or in a database, each about a third of the time', () => {
    const counts = SAMPLE_SHAPES.reduce<Record<string, number>>((tally, { storage }) => {
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

  describe('two hops', () => {
    const twoHopShapes = SAMPLE_SHAPES.filter((shape) => shape.frontBox !== null);

    /** One single-hop contract of every route and storage, and the digest of its whole shape
     *  taken from the generator before a contract could have two hops. Two hops draw on a
     *  stream of their own, so a contract that stays single-hop keeps its network to the byte. */
    const SINGLE_HOP_BEFORE: readonly (readonly [number, string])[] = [
      [16764, '406a2ac2a2ac5d9d8aba524c1552d5a7'], // mysql, database
      [25145, '2899c72c38899a20775eacd862504e63'], // ftp, database
      [41907, 'dfe62d63aeea34374499dda4f52983c6'], // snmp, file
      [50288, '9100465eaeba93b353353a2130fe2bc5'], // web, file
      [58669, '460336488108903f6ca870a6ae665233'], // web, gpg
      [83812, '4992d3b22a2f5a86f6460309d57f079d'], // snmp, gpg
      [92193, '9f84ae6624ea30640ce8b1404ac188ec'], // msfconsole, database
      [117336, '8793081a9cd2857ce6d6f7f779dbffe9'], // web, database
      [125717, 'aa7ad61e60fc856f7acba2cd601b660f'], // snmp, database
      [142479, '0a14a7ee3735bccd7c9d9d50b64efc8d'], // ftp, file
      [209527, 'f2edad300e3e6bf84d40b81bff149c01'], // msfconsole, file
      [217908, 'dc3a04e3012e1bccb373cab3f1975e75'], // ftp, gpg
      [226289, 'e2e8599af2ac001cbde658e3f22522e4'], // mysql, gpg
      [243051, 'a661feaeb8e04ba2ad1a2f1dd140f0a4'], // hydra, file
      [276575, 'f47cdc65a5812f79fa6d583b4ac70b94'], // hydra, gpg
      [284956, 'dc3f3053467b53a0ade9856e027f45bc'], // mysql, file
      [368766, '78215693e7d17d17c3da2ba4e9f7aaa1'], // hydra, database
      [435814, '22849ccf16a47a53d089e9214473d82f'], // msfconsole, gpg
    ];

    /** One two-hop contract of every route and storage, and the digest of its key box as it
     *  stood before the contract had two hops, its forwards and decoys aside: its names, route,
     *  hashes and the doors it ran for its route and its storage. */
    const KEY_BOX_BEFORE: readonly (readonly [number, string])[] = [
      [2, 'adc2e9aaac7cf6b183456923667a518c'], // hydra, gpg
      [8383, 'aaee771c5cc6118f6546fc3a4cd4f013'], // ftp, file
      [75431, '58748b0b87078d192708cdcc76a6f4ba'], // ftp, database
      [134098, 'dcbef343e36fdf2840eedb351fc86040'], // mysql, file
      [192765, '3164c5ec5dcc7e3d1b57611ae6a1c968'], // snmp, database
      [259813, '52911d8541f1ce5b163d1965fede88ab'], // mysql, database
      [310099, '9614d3b678fb2665836f8bfab5e6cc89'], // msfconsole, database
      [326861, 'e59e6a512b82f15e98b745db194293e2'], // hydra, database
      [377147, 'd1d2955652ce68aea09d51c1ee238c4e'], // web, gpg
      [452576, '7f574cedfb32bbf08bdf4ec1d0c0adc2'], // web, database
      [486100, '020cfae8783a805a9b0f791209f6e07f'], // snmp, file
      [494481, '456f97cbbf36a0615d42b00a4ec05842'], // mysql, gpg
      [519624, '6c62e8268001b700677e05dee7a7e670'], // msfconsole, gpg
      [528005, '2ebce9b6d65f2b192fabe23be37c80da'], // web, file
      [754292, '003e65afea43e84312c9f16c5dac3fc6'], // msfconsole, file
      [762673, 'a9b0a1a88b572b9c314902f636e4ace6'], // ftp, gpg
      [1047627, 'f2547fb5f6635ed4b2d5f041fdd1ae32'], // hydra, file
      [1651059, 'c74f61b70032f807db40773f5b3bf9e5'], // snmp, gpg
    ];

    it('puts the key box behind a front box about a third of the time', () => {
      expect(twoHopShapes.length / SAMPLE_NUMBERS.length).toBeGreaterThan(0.28);
      expect(twoHopShapes.length / SAMPLE_NUMBERS.length).toBeLessThan(0.39);
    });

    it('leaves a single-hop contract exactly as it was', () => {
      for (const [missionNumber, digest] of SINGLE_HOP_BEFORE) {
        const { frontBox, ...shape } = missionShape(missionNumber);
        expect(frontBox, `contract ${missionNumber}`).toBeNull();
        expect(md5(JSON.stringify(shape)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    it('keeps the key box it had, without its forwards or decoys', () => {
      for (const [missionNumber, digest] of KEY_BOX_BEFORE) {
        const shape = missionShape(missionNumber);
        const { keyBox } = shape;
        const label = `contract ${missionNumber}`;

        expect(shape.frontBox, label).not.toBeNull();
        expect(keyBox.decoys, label).toEqual([]);
        expect(
          md5(
            JSON.stringify({
              stem: shape.stem,
              storage: shape.storage,
              gatewayAdminHash: shape.gatewayAdminHash,
              octet: keyBox.octet,
              route: keyBox.route,
              rootHash: keyBox.rootHash,
              database: keyBox.database,
              communityHash: keyBox.communityHash,
              services: keyBox.services,
            }),
          ),
          label,
        ).toBe(digest);
      }
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

    /** One single-hop contract of every route and storage, and the digest of what it had
     *  before decoys, taken from the generator as it stood then. */
    const BEFORE_DECOYS: readonly (readonly [number, string])[] = [
      [276575, 'ec468c5de19605040fc3a0c16c81324e'], // hydra, gpg
      [142479, '1110188b6fd5637a7cca7794d0a8797b'], // ftp, file
      [16764, '646ccb637762c304422bd9971fc3befc'], // mysql, database
      [25145, '82ce6de46a91a30b00ea3035a7332fad'], // ftp, database
      [41907, 'bf8c66bf1de205869667465a64a01786'], // snmp, file
      [50288, '7267dc78e1fc632f631c363951dd4330'], // web, file
      [58669, 'cb05365ca18db26904b0aad1db72edd1'], // web, gpg
      [83812, '0b1c897db7b8604765a5d928d0a82fa0'], // snmp, gpg
      [92193, '2c7418f13f45f6cc6783f384c0d089e7'], // msfconsole, database
      [117336, 'bc52de232c69d51a7215e482cc453904'], // web, database
      [125717, '49e62e4ace55181ab445f5cfafd49bfb'], // snmp, database
      [284956, 'e1d6038c52c28a5dee58fb3a401e7287'], // mysql, file
      [209527, 'edbbe13c6e744a84e0fb468b77a27048'], // msfconsole, file
      [217908, '336ca5ac3e27ac7b4221a209e62e4854'], // ftp, gpg
      [226289, '2fda4ce88d9d688d6fc7d1807a8a6527'], // mysql, gpg
      [243051, 'fdc080efe1512df31eba9c8dac360134'], // hydra, file
      [368766, '0f43c51a9a909c61a5c73cc41a964bc3'], // hydra, database
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
