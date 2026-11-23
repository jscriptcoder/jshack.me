import { describe, expect, it } from 'vitest';
import {
  MISSION_ROUTE_DAY,
  chainFinal,
  missionKind,
  missionShape,
  missionTopology,
  recordsStorage,
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
import {
  FIRMWARE_VENDORS,
  firmwarePackageOf,
  isFirmwarePackage,
  type FirmwareVendor,
} from '../packages/packageVersions.js';
import { firmwareExploitOutcome, higherSeverityOutcome } from '../cve/firmwareExploit.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { UNCRACKABLE_HASHES, WHITE_HAT_HASHES } from '../generation/passwordPools.js';
import { FIXED_BOXES } from '../generation/fixedSites.js';
import { buildFixedSiteFs } from '../generation/fixedSiteFs.js';
import { accountIn } from '../sessions/passwdAccount.js';
import { md5 } from '../generation/md5.js';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist.js';
import { LEAKABLE_HASHES, SHUT_HASHES, fixedBoxRootHash } from './leakablePool.js';
import { portforwardJob, type PortforwardService } from './portforwardJob.js';
import { closeDoorJob } from './closeDoorJob.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import { missionEssid } from './missionNetwork.js';
import { buildApGatewayBaseFs } from '../generation/routerFs.js';
import { machineServing } from '../network/machineServing.js';

/** A forward's two ports, whichever box it reaches. */
type PortPair = Omit<MissionForward, 'boxOctet'>;

/** A box without the cache hash, which is null on every box but a portforward job's cache
 *  server, so a digest taken before the field existed still matches. */
const withoutStoreHash = ({
  storeHash: _storeHash,
  ...box
}: MissionBox): Omit<MissionBox, 'storeHash'> => box;

/** The route a box falls to. Every box in the routed sample has one: only a portforward job's
 *  target has none. */
const routeOf = (box: MissionBox): MissionRoute => {
  if (box.route === null) throw new Error(`the box at .${box.octet} has no route`);
  return box.route;
};

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

/** The release a msfconsole router's firmware sits on, by vendor: the four with a release by
 *  the route day whose hole lands a root shell. mikrotik and ddwrt have none. */
const ROOT_SHELL_FIRMWARE: Readonly<Partial<Record<FirmwareVendor, string>>> = {
  cisco: '17.0.5',
  openwrt: '24.4.1',
  pfsense: '3.0.3',
  ubiquiti: '3.3.0',
};

/** The package every router's sshd runs as. */
const SSHD_PACKAGE = 'openssh-server';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const ALL_SAMPLE_SHAPES: readonly MissionShape[] = SAMPLE_NUMBERS.map(missionShape);

/** The sample's contracts whose boxes each fall to a route: all but the portforward and
 *  close-the-door jobs, whose target nobody roots, and the cleanup jobs, whose client hands over
 *  root. */
const SAMPLE_SHAPES: readonly MissionShape[] = ALL_SAMPLE_SHAPES.filter(
  ({ kind }) => kind !== 'portforward' && kind !== 'cleanup' && kind !== 'closedoor',
);

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
      const route = routeOf(keyBox);
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
      expect(count / SAMPLE_SHAPES.length).toBeGreaterThan(0.12);
      expect(count / SAMPLE_SHAPES.length).toBeLessThan(0.22);
    }
  });

  it('makes about a thirteenth of the contracts each of key, tamper, sabotage, file, backdoor, infiltrate, portforward, credential, destroy, wipe, chain, cleanup and close-the-door jobs', () => {
    const counts = ALL_SAMPLE_SHAPES.reduce<Record<string, number>>(
      (tally, { kind }) => ({ ...tally, [kind]: (tally[kind] ?? 0) + 1 }),
      {},
    );

    expect(Object.keys(counts).sort()).toEqual([
      'backdoor',
      'chain',
      'cleanup',
      'closedoor',
      'credential',
      'destroy',
      'file',
      'infiltrate',
      'key',
      'portforward',
      'sabotage',
      'tamper',
      'wipe',
    ]);
    for (const [kind, count] of Object.entries(counts)) {
      expect(count / ALL_SAMPLE_SHAPES.length, kind).toBeGreaterThan(0.05);
      expect(count / ALL_SAMPLE_SHAPES.length, kind).toBeLessThan(0.105);
    }
  });

  it('turns no contract from one older kind into another: each keeps its kind or becomes a close-the-door job', () => {
    // The contracts drawn nearest the bottom and the top of every piece of the draw, with the kind
    // each had before close-the-door jobs. Each older kind gave up the top of its largest piece,
    // the lowest on a tie, so the top of the draw stays portforward.
    const drawnAtTheEdges = [
      [50188, 'tamper', 'tamper'],
      [382189, 'tamper', 'tamper'],
      [103736, 'tamper', 'closedoor'],
      [285493, 'tamper', 'closedoor'],
      [284749, 'cleanup', 'cleanup'],
      [19182, 'cleanup', 'cleanup'],
      [19869, 'cleanup', 'closedoor'],
      [1, 'cleanup', 'closedoor'],
      [264480, 'chain', 'chain'],
      [221416, 'chain', 'chain'],
      [159517, 'cleanup', 'cleanup'],
      [79015, 'cleanup', 'cleanup'],
      [289154, 'wipe', 'wipe'],
      [92958, 'wipe', 'wipe'],
      [258415, 'chain', 'chain'],
      [410333, 'chain', 'chain'],
      [413609, 'chain', 'closedoor'],
      [147445, 'chain', 'closedoor'],
      [38316, 'destroy', 'destroy'],
      [187051, 'destroy', 'destroy'],
      [142239, 'wipe', 'wipe'],
      [27031, 'wipe', 'wipe'],
      [309428, 'cleanup', 'cleanup'],
      [111531, 'cleanup', 'cleanup'],
      [394474, 'credential', 'credential'],
      [410321, 'credential', 'credential'],
      [164649, 'wipe', 'wipe'],
      [130215, 'wipe', 'wipe'],
      [300222, 'wipe', 'closedoor'],
      [159029, 'wipe', 'closedoor'],
      [65482, 'portforward', 'portforward'],
      [182042, 'portforward', 'portforward'],
      [122989, 'chain', 'chain'],
      [342672, 'chain', 'chain'],
      [327384, 'destroy', 'destroy'],
      [283614, 'destroy', 'destroy'],
      [164172, 'chain', 'chain'],
      [150704, 'chain', 'chain'],
      [4238, 'infiltrate', 'infiltrate'],
      [381984, 'infiltrate', 'infiltrate'],
      [133932, 'chain', 'chain'],
      [247387, 'chain', 'chain'],
      [299480, 'credential', 'credential'],
      [368717, 'credential', 'credential'],
      [311770, 'chain', 'chain'],
      [412821, 'chain', 'chain'],
      [379538, 'backdoor', 'backdoor'],
      [8680, 'backdoor', 'backdoor'],
      [307488, 'credential', 'credential'],
      [56418, 'credential', 'credential'],
      [271153, 'cleanup', 'cleanup'],
      [85779, 'cleanup', 'cleanup'],
      [98011, 'portforward', 'portforward'],
      [197989, 'portforward', 'portforward'],
      [250014, 'credential', 'credential'],
      [222036, 'credential', 'credential'],
      [413395, 'credential', 'closedoor'],
      [178075, 'credential', 'closedoor'],
      [171959, 'file', 'file'],
      [102421, 'file', 'file'],
      [181423, 'chain', 'chain'],
      [53114, 'chain', 'chain'],
      [65058, 'wipe', 'wipe'],
      [264492, 'wipe', 'wipe'],
      [201442, 'destroy', 'destroy'],
      [220076, 'destroy', 'destroy'],
      [396178, 'cleanup', 'cleanup'],
      [85176, 'cleanup', 'cleanup'],
      [357602, 'credential', 'credential'],
      [122434, 'credential', 'credential'],
      [274029, 'sabotage', 'sabotage'],
      [398852, 'sabotage', 'sabotage'],
      [148879, 'sabotage', 'closedoor'],
      [392944, 'sabotage', 'closedoor'],
      [255980, 'cleanup', 'cleanup'],
      [91152, 'cleanup', 'cleanup'],
      [319204, 'chain', 'chain'],
      [173917, 'chain', 'chain'],
      [205855, 'wipe', 'wipe'],
      [119597, 'wipe', 'wipe'],
      [106011, 'destroy', 'destroy'],
      [85724, 'destroy', 'destroy'],
      [354605, 'destroy', 'closedoor'],
      [113543, 'destroy', 'closedoor'],
      [191694, 'credential', 'credential'],
      [368933, 'credential', 'credential'],
      [67874, 'portforward', 'portforward'],
      [296702, 'portforward', 'portforward'],
      [41737, 'wipe', 'wipe'],
      [249111, 'wipe', 'wipe'],
      [349488, 'infiltrate', 'infiltrate'],
      [162246, 'infiltrate', 'infiltrate'],
      [114746, 'destroy', 'destroy'],
      [339062, 'destroy', 'destroy'],
      [314335, 'backdoor', 'backdoor'],
      [179988, 'backdoor', 'backdoor'],
      [163361, 'chain', 'chain'],
      [52062, 'chain', 'chain'],
      [253581, 'destroy', 'destroy'],
      [159977, 'destroy', 'destroy'],
      [373540, 'file', 'file'],
      [164779, 'file', 'file'],
      [284184, 'file', 'closedoor'],
      [212121, 'file', 'closedoor'],
      [82018, 'cleanup', 'cleanup'],
      [33426, 'cleanup', 'cleanup'],
      [351177, 'portforward', 'portforward'],
      [182231, 'portforward', 'portforward'],
      [152823, 'cleanup', 'cleanup'],
      [98506, 'cleanup', 'cleanup'],
      [31807, 'infiltrate', 'infiltrate'],
      [191315, 'infiltrate', 'infiltrate'],
      [414330, 'wipe', 'wipe'],
      [124259, 'wipe', 'wipe'],
      [414845, 'backdoor', 'backdoor'],
      [319327, 'backdoor', 'backdoor'],
      [195095, 'backdoor', 'closedoor'],
      [375582, 'backdoor', 'closedoor'],
      [138691, 'cleanup', 'cleanup'],
      [10449, 'cleanup', 'cleanup'],
      [147532, 'wipe', 'wipe'],
      [62849, 'wipe', 'wipe'],
      [205635, 'key', 'key'],
      [386648, 'key', 'key'],
      [13400, 'key', 'closedoor'],
      [365748, 'key', 'closedoor'],
      [342722, 'cleanup', 'cleanup'],
      [318435, 'cleanup', 'cleanup'],
      [246170, 'chain', 'chain'],
      [70378, 'chain', 'chain'],
      [359893, 'wipe', 'wipe'],
      [287980, 'wipe', 'wipe'],
      [266303, 'destroy', 'destroy'],
      [415248, 'destroy', 'destroy'],
      [12571, 'credential', 'credential'],
      [41914, 'credential', 'credential'],
      [337672, 'destroy', 'destroy'],
      [76265, 'destroy', 'destroy'],
      [250139, 'portforward', 'portforward'],
      [125601, 'portforward', 'portforward'],
      [386725, 'portforward', 'closedoor'],
      [289215, 'portforward', 'closedoor'],
      [369810, 'infiltrate', 'infiltrate'],
      [27168, 'infiltrate', 'infiltrate'],
      [58133, 'infiltrate', 'closedoor'],
      [155082, 'infiltrate', 'closedoor'],
      [363109, 'cleanup', 'cleanup'],
      [4512, 'cleanup', 'cleanup'],
      [323218, 'backdoor', 'backdoor'],
      [269448, 'backdoor', 'backdoor'],
      [74985, 'infiltrate', 'infiltrate'],
      [226749, 'infiltrate', 'infiltrate'],
      [106274, 'portforward', 'portforward'],
      [318254, 'portforward', 'portforward'],
    ] as const;

    for (const [missionNumber, before, now] of drawnAtTheEdges) {
      expect(missionKind(missionNumber), `contract ${missionNumber}, a ${before} job before`).toBe(
        now,
      );
    }
  });

  it('always puts a front box before a chain job target, keeping nothing in storage unless its last step wipes a table', () => {
    const chainJobs = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'chain');

    expect(chainJobs.length).toBeGreaterThan(0);
    for (const { missionNumber, storage, frontBox } of chainJobs) {
      const label = `contract ${missionNumber}, ${chainFinal(missionNumber)}`;

      expect(frontBox, label).not.toBeNull();
      expect(storage, label).toBe(
        chainFinal(missionNumber) === 'wipe' ? recordsStorage(missionNumber) : null,
      );
    }
  });

  it('gives a chain job wiping records kept in a database a database server on its target', () => {
    const databaseJobs = ALL_SAMPLE_SHAPES.filter(
      ({ kind, storage }) => kind === 'chain' && storage === 'database',
    );

    expect(databaseJobs.length).toBeGreaterThan(0);
    for (const { missionNumber, keyBox } of databaseJobs) {
      expect(
        realServices(keyBox).map(({ program }) => program),
        `contract ${missionNumber}`,
      ).toContain('mysqld');
    }
  });

  it('keeps nothing in storage on a destroy job, and puts about one in three behind a front box', () => {
    const destroyJobs = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'destroy');
    const twoHop = destroyJobs.filter(({ frontBox }) => frontBox !== null);

    expect(new Set(destroyJobs.map(({ storage }) => storage))).toEqual(new Set([null]));
    expect(twoHop.length / destroyJobs.length).toBeGreaterThan(0.24);
    expect(twoHop.length / destroyJobs.length).toBeLessThan(0.43);
  });

  it("keeps about half the wipe jobs' records in a database and the rest in a file, and puts about one in three behind a front box", () => {
    const wipeJobs = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'wipe');
    const twoHop = wipeJobs.filter(({ frontBox }) => frontBox !== null);

    for (const storage of ['database', 'file'] as const) {
      const kept = wipeJobs.filter((shape) => shape.storage === storage);

      expect(kept.length / wipeJobs.length, storage).toBeGreaterThan(0.4);
      expect(kept.length / wipeJobs.length, storage).toBeLessThan(0.6);
    }
    expect(twoHop.length / wipeJobs.length).toBeGreaterThan(0.24);
    expect(twoHop.length / wipeJobs.length).toBeLessThan(0.43);
    // Kept where a tamper job on the same number would keep them, on the same stream.
    for (const { missionNumber, storage } of wipeJobs) {
      expect(storage, `contract ${missionNumber}`).toBe(recordsStorage(missionNumber));
    }
  });

  it('gives a wipe job keeping its records in a database a database server, behind a :3306 forward on one hop', () => {
    const databaseJobs = ALL_SAMPLE_SHAPES.filter(
      ({ kind, storage }) => kind === 'wipe' && storage === 'database',
    );

    expect(databaseJobs.length).toBeGreaterThan(0);
    for (const shape of databaseJobs) {
      const label = `contract ${shape.missionNumber}`;

      expect(
        realServices(shape.keyBox).map(({ program }) => program),
        label,
      ).toContain('mysqld');
      if (shape.frontBox === null) {
        expect(
          shape.forwards.some(({ internalPort }) => internalPort === 3306),
          label,
        ).toBe(true);
      }
    }
  });

  it('keeps the key in a file, encrypted, or in a database, each about a third of the time', () => {
    const keyJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'key');
    const counts = keyJobs.reduce<Record<string, number>>((tally, { storage }) => {
      return { ...tally, [String(storage)]: (tally[String(storage)] ?? 0) + 1 };
    }, {});

    expect(Object.keys(counts).sort()).toEqual(['database', 'file', 'gpg']);
    for (const count of Object.values(counts)) {
      expect(count / keyJobs.length).toBeGreaterThan(0.25);
      expect(count / keyJobs.length).toBeLessThan(0.42);
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
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[routeOf(keyBox)]);
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
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[routeOf(keyBox)]);
      }
    }
  });

  it("gives a file job's target nothing to keep: no storage, and only the doors its route runs", () => {
    const fileJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'file');

    expect(new Set(fileJobs.map(({ keyBox }) => keyBox.route))).toEqual(
      new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
    );
    expect(new Set(fileJobs.map(({ frontBox }) => frontBox === null))).toEqual(
      new Set([true, false]),
    );
    for (const shape of fileJobs) {
      const { keyBox } = shape;
      const label = `${keyBox.route} contract ${shape.missionNumber}`;
      const programs = realServices(keyBox).map(({ program }) => program);

      expect(shape.storage, label).toBeNull();
      expect(programs.includes('mysqld'), label).toBe(keyBox.route === 'mysql');
      if (shape.frontBox === null) {
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[routeOf(keyBox)]);
      }
    }
  });

  it("gives an infiltrate job's target nothing to keep: no storage, and only the doors its route runs", () => {
    const infiltrateJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'infiltrate');

    expect(new Set(infiltrateJobs.map(({ keyBox }) => keyBox.route))).toEqual(
      new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
    );
    expect(new Set(infiltrateJobs.map(({ frontBox }) => frontBox === null))).toEqual(
      new Set([true, false]),
    );
    for (const shape of infiltrateJobs) {
      const { keyBox } = shape;
      const label = `${keyBox.route} contract ${shape.missionNumber}`;
      const programs = realServices(keyBox).map(({ program }) => program);

      expect(shape.storage, label).toBeNull();
      expect(programs.includes('mysqld'), label).toBe(keyBox.route === 'mysql');
      if (shape.frontBox === null) {
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[routeOf(keyBox)]);
      }
    }
  });

  it("gives a backdoor job's target nothing to keep: no storage, and only the doors its route runs", () => {
    const backdoorJobs = SAMPLE_SHAPES.filter(({ kind }) => kind === 'backdoor');

    expect(new Set(backdoorJobs.map(({ keyBox }) => keyBox.route))).toEqual(
      new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
    );
    expect(new Set(backdoorJobs.map(({ frontBox }) => frontBox === null))).toEqual(
      new Set([true, false]),
    );
    for (const shape of backdoorJobs) {
      const { keyBox } = shape;
      const label = `${keyBox.route} contract ${shape.missionNumber}`;
      const programs = realServices(keyBox).map(({ program }) => program);

      expect(shape.storage, label).toBeNull();
      expect(programs.includes('mysqld'), label).toBe(keyBox.route === 'mysql');
      if (shape.frontBox === null) {
        expect(realForwards(shape), label).toEqual(ROUTE_FORWARDS[routeOf(keyBox)]);
      }
    }
  });

  it('draws where the key is kept without moving anything a contract already had', () => {
    // An accepted contract keeps its network: the storage draw must not shift the topology,
    // the route or the hashes drawn before it existed.
    const before = [
      [66051, 'hydra', 'corva', 87, '5fcfd41e547a12215b173ff47fdd3739'],
      [2, 'hydra', 'sternco', 150, '0d107d09f5bbe40cade3de5c71e9e9b7'],
      [1234573, 'msfconsole', 'brightmoor', 151, 'a333fc5371a08ccd9f6513e098c36172'],
      [10000000, 'hydra', 'kestrelle', 166, '0571749e2ac330a7455809c6b0e7af90'],
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
    /** The contracts whose hops are drawn: a chain job always has two. */
    const drawnHopShapes = SAMPLE_SHAPES.filter(({ kind }) => kind !== 'chain');

    /** Single-hop contracts across the routes and storages, and the digest of each whole shape
     *  taken from the generator before a contract could have two hops. Two hops draw on a
     *  stream of their own, so a contract that stays single-hop keeps its network to the byte.
     *  Only key jobs: a contract that became a tamper job keeps its records in its database.
     *  Contracts that later turned file, backdoor, infiltrate, portforward, destroy, wipe or close-the-door jobs were swapped for key jobs alike,
     *  digested on the generator before that kind. */
    const SINGLE_HOP_BEFORE: readonly (readonly [number, string])[] = [
      [16837, 'f27ddd33257d952bc4a6d15bf3649686'], // mysql, database
      [3989358, '82a4a03274db6a08767bd9b788c6b0ca'], // snmp, file
      [25, 'bc6079d753a35b0d2fbbc0d419866d9b'], // web, file
      [188, 'e22849bb6178062832ca21a15ac6ec26'], // snmp, database
      [26, 'bebc7e5d21c0cec1690d8cf632581e64'], // ftp, file
      [933, 'c6cbad730e79f75385a76475bff44a5e'], // msfconsole, file
      [243624, '7c68cca9b7aa79bf353cfa5d54b2ad88'], // hydra, file
      [369262, '58f3820e66d08af310e1cdfc9895fddc'], // hydra, database
    ];

    /** Two-hop key jobs across the routes and storages, and the digest of each key box as it
     *  stood before the contract had two hops, its forwards and decoys aside: its names, route,
     *  hashes and the doors it ran for its route and its storage. Contracts that later turned
     *  sabotage, file, backdoor, infiltrate, portforward, credential, destroy, wipe, chain, cleanup or close-the-door jobs were swapped for key jobs alike, digested on the generator before
     *  that kind. */
    const KEY_BOX_BEFORE: readonly (readonly [number, string])[] = [
      [3123, '03a899a0dd25fdf05107be461c2533ec'], // ftp, file
      [134098, 'dcbef343e36fdf2840eedb351fc86040'], // mysql, file
      [107, '07e6b06a5f7a03c022308311f9773111'], // web, database
      [1131, '0e675fc551df9bd38209c346974f729e'], // snmp, file
      [8064, 'ecc1c1f4d60a0bb5de51a6e65cfa4cf3'], // msfconsole, gpg
      [4075, '4ce1ca7b12ada33872ff6d52d7ce8839'], // msfconsole, file
      [1049074, 'bfd8b75efdc9d35cae9ff1dc2f34617c'], // hydra, file
      [929, '2d4a5dc6923e351565f77cd2d1dbb97b'], // hydra, gpg
      [6068, '7a7bf4713e4f1e702e1e2beb440d952c'], // mysql, database
      [1095, '156fa82806abd4a4bbf12ab943fcd9e4'], // web, gpg
      [12269786, '02f63ddca1bc7ff62bb445e814beb98d'], // ftp, gpg
    ];

    it('puts the key box behind a front box about a third of the time, on every kind but portforward and chain', () => {
      const drawnTwoHop = drawnHopShapes.filter((shape) => shape.frontBox !== null);

      expect(drawnTwoHop.length / drawnHopShapes.length).toBeGreaterThan(0.28);
      expect(drawnTwoHop.length / drawnHopShapes.length).toBeLessThan(0.39);
    });

    it('leaves a single-hop contract exactly as it was', () => {
      for (const [missionNumber, digest] of SINGLE_HOP_BEFORE) {
        // The router's route and vendor came after these digests, null on every kind they are.
        const { frontBox, kind, routerRoute, routerVendor, keyBox, ...shape } =
          missionShape(missionNumber);
        expect(frontBox, `contract ${missionNumber}`).toBeNull();
        expect(kind, `contract ${missionNumber}`).toBe('key');
        expect(routerRoute, `contract ${missionNumber}`).toBeNull();
        expect(routerVendor, `contract ${missionNumber}`).toBeNull();
        const { missionNumber: _number, stem, storage, ...afterKeyBox } = shape;
        expect(
          md5(
            JSON.stringify({
              missionNumber,
              stem,
              storage,
              keyBox: withoutStoreHash(keyBox),
              ...afterKeyBox,
            }),
          ),
          `contract ${missionNumber}`,
        ).toBe(digest);
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
     *  sabotage, file, backdoor, infiltrate, portforward, credential, destroy, wipe, chain, cleanup or close-the-door jobs were swapped for key jobs alike, digested on the generator before
     *  that kind. */
    const BESIDE_KEY_BOX_BEFORE: readonly (readonly [number, string])[] = [
      [3123, 'ffdeeae469845a328fc5eb6f048093c2'], // ftp, front msfconsole
      [134098, '3d8cd43ac152027f6eb3e5a142dec083'], // mysql, front hydra
      [107, '710e67a04a3478676b7959999df01141'], // web, front hydra
      [1131, 'bb02faef930af04f3b737dd7647a8978'], // snmp, front hydra
      [8064, 'b6ac6f1b16c2d14a428475b0bf322b05'], // msfconsole, front web
      [4075, 'cb38daa91fadab5c6c7196780fd53521'], // msfconsole, front web
      [1049074, '01d872c7ef8470098ac4b8177f582430'], // hydra, front snmp
      [929, '0bbb667b4152faaf0fc2594ad134cca4'], // hydra, front mysql
      [6068, '9411744ba409adb9772a7993742b9ee1'], // mysql, front msfconsole
      [1095, '9056602c14fca79c916e962c82f82c0d'], // web, front web
      [12269786, '7b5dd59c802097475555ac3286435859'], // ftp, front snmp
    ];

    it('leaves the front box, the forwards and the gateway as they were', () => {
      for (const [missionNumber, digest] of BESIDE_KEY_BOX_BEFORE) {
        // The router's route and vendor and the cache hash came after these digests, null on
        // these contracts.
        const {
          keyBox: _keyBox,
          kind: _kind,
          routerRoute: _routerRoute,
          routerVendor: _routerVendor,
          frontBox,
          ...rest
        } = missionShape(missionNumber);
        const { missionNumber: _number, stem, storage, ...afterFrontBox } = rest;
        const besideKeyBox = {
          missionNumber,
          stem,
          storage,
          frontBox: frontBox === null ? null : withoutStoreHash(frontBox),
          ...afterFrontBox,
        };
        expect(md5(JSON.stringify(besideKeyBox)), `contract ${missionNumber}`).toBe(digest);
      }
    });

    describe('inside decoys', () => {
      /** The ports of the doors a key box runs for its route and its storage, in order. */
      const realDoorPorts = (shape: MissionShape): readonly number[] => {
        const route = routeOf(shape.keyBox);
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
      const routeForwards = ROUTE_FORWARDS[routeOf(entry)];
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
     *  sabotage, file, backdoor, infiltrate, portforward, credential, destroy, wipe or close-the-door jobs were swapped for key jobs alike, digested on the generator before
     *  that kind. */
    const BEFORE_DECOYS: readonly (readonly [number, string])[] = [
      [26, '529fc16f6500aaea7286d4b3f6457e5c'], // ftp, file
      [16837, '66ef50b38177d710035d491c3117101a'], // mysql, database
      [3989358, '522716c66d0a298f6c790b504f8095be'], // snmp, file
      [25, 'd6ab3acaa8ca2c0fb37bdd0aef86b65f'], // web, file
      [188, 'fa38e003de44240bca1b8067df439f9f'], // snmp, database
      [933, '1436b8c852232a355b50a275be14f5bc'], // msfconsole, file
      [243624, '924baecf49de2ecb96d61a2e4255a120'], // hydra, file
      [231, '116f11ad14d62f50f30b701bdc8799d0'], // hydra, database
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
          const route = routeOf(entryBox(shape));
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

describe('a credential contract', () => {
  const credentialShapes = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'credential');

  it('keeps nothing on its target: the job is the login, on a box its route roots', () => {
    expect(credentialShapes.length).toBeGreaterThan(100);
    for (const { missionNumber, storage, keyBox } of credentialShapes) {
      expect(storage, `contract ${missionNumber}`).toBeNull();
      expect(keyBox.route, `contract ${missionNumber}`).not.toBeNull();
    }
  });
});

describe('a cleanup contract', () => {
  const cleanupShapes = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'cleanup');
  const singleHop = cleanupShapes.filter(({ frontBox }) => frontBox === null);
  const twoHop = cleanupShapes.filter(({ frontBox }) => frontBox !== null);

  it('puts the target behind a front box about a third of the time', () => {
    expect(cleanupShapes.length).toBeGreaterThan(100);
    expect(twoHop.length / cleanupShapes.length).toBeGreaterThan(0.22);
    expect(twoHop.length / cleanupShapes.length).toBeLessThan(0.45);
    for (const shape of cleanupShapes) {
      expect(missionTopology(shape.missionNumber).frontBoxOctet).toBe(
        shape.frontBox?.octet ?? null,
      );
    }
  });

  // The client lets the contractor in, so no box is broken into: each root is a word the
  // briefing hands over, drawn from the white-hat words no other door holds.
  it('gives every box a root the client hands over, and no other way in', () => {
    for (const shape of cleanupShapes) {
      for (const box of boxesOf(shape)) {
        const label = `${box === shape.keyBox ? 'target' : 'front box'} of ${shape.missionNumber}`;
        expect(box.route, label).toBeNull();
        expect(WHITE_HAT_HASHES, label).toContain(box.rootHash);
        expect(realServices(box), label).toEqual([]);
        for (const severity of pinnedSeverities(box.versions)) {
          expect(['low', 'medium'], label).toContain(severity);
        }
      }
      expect(shape.storage, `contract ${shape.missionNumber}`).toBeNull();
      expect(SHUT_HASHES, `contract ${shape.missionNumber}`).toContain(shape.gatewayAdminHash);
      for (const severity of pinnedSeverities(shape.gatewayVersions)) {
        expect(['low', 'medium'], `gateway of ${shape.missionNumber}`).toContain(severity);
      }
    }
  });

  it('forwards the public :2222 onto the sshd of the box the login is for, decoys after it', () => {
    for (const shape of cleanupShapes) {
      const label = `contract ${shape.missionNumber}`;
      const entry = entryBox(shape);

      expect(realForwards(shape), label).toEqual([SSH]);
      expect([3, 4], label).toContain(shape.forwards.length);
      for (const forward of shape.forwards) expect(forward.boxOctet, label).toBe(entry.octet);
    }
  });

  it('reaches the target on two hops only from inside: the gateway forwards nothing to it', () => {
    expect(twoHop.length).toBeGreaterThan(0);
    for (const shape of twoHop) {
      const label = `contract ${shape.missionNumber}`;
      expect(shape.frontBox?.octet, label).not.toBe(shape.keyBox.octet);
      for (const forward of shape.forwards) {
        expect(forward.boxOctet, label).not.toBe(shape.keyBox.octet);
      }
      // A scan from the front box reads like any two-hop box's: two or three doors besides sshd.
      expect([2, 3], label).toContain(shape.keyBox.decoys.length);
    }
    expect(singleHop.length).toBeGreaterThan(0);
  });
});

/** The program each machine's service runs as, none for ssh: sshd runs on every box. */
const PROGRAMS: Readonly<Record<PortforwardService, readonly string[]>> = {
  mysql: ['mysqld'],
  redis: ['redis-server'],
  web: ['nginx'],
  ssh: [],
};

/** The decoy that would already expose each machine's service, none for redis. */
const EXPOSING_DECOY: Readonly<Record<PortforwardService, MissionDecoy | null>> = {
  mysql: 'mysql',
  redis: null,
  web: 'web',
  ssh: 'ssh',
};

describe('a portforward contract', () => {
  const portforwardShapes = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'portforward');

  it('is single-hop: the target stands in the key-box slot, and no front box', () => {
    expect(portforwardShapes.length).toBeGreaterThan(150);
    for (const shape of portforwardShapes) {
      expect(shape.frontBox, `contract ${shape.missionNumber}`).toBeNull();
      expect(missionTopology(shape.missionNumber).frontBoxOctet).toBeNull();
    }
  });

  it("runs the machine's service on its inside port, on a safe release, and keeps nothing", () => {
    for (const shape of portforwardShapes) {
      const { machine } = portforwardJob(shape.missionNumber);
      const label = `${machine.noun} of ${shape.missionNumber}`;
      const real = realServices(shape.keyBox);

      expect(shape.storage, label).toBeNull();
      expect(
        real.map(({ program }) => program),
        label,
      ).toEqual(PROGRAMS[machine.service]);
      for (const service of real) expect(service.port, label).toBe(machine.insidePort);
      for (const severity of pinnedSeverities(shape.keyBox.versions)) {
        expect(['low', 'medium'], label).toContain(severity);
      }
    }
  });

  it('gives the target no route and no way to root it: root, the database and the cache shut', () => {
    for (const shape of portforwardShapes) {
      const { machine } = portforwardJob(shape.missionNumber);
      const { keyBox } = shape;
      const label = `${machine.noun} of ${shape.missionNumber}`;

      expect(keyBox.route, label).toBeNull();
      expect(SHUT_HASHES, label).toContain(keyBox.rootHash);
      if (machine.service === 'mysql') {
        expect(SHUT_HASHES, label).toContain(keyBox.database?.accountHash);
        expect(SHUT_HASHES, label).toContain(keyBox.database?.rootHash);
      } else if (!keyBox.decoys.includes('mysql')) {
        // A database decoy brings a database of its own; nothing else on the target keeps one.
        expect(keyBox.database, label).toBeNull();
      }
      if (machine.service === 'redis') expect(SHUT_HASHES, label).toContain(keyBox.storeHash);
      else expect(keyBox.storeHash, label).toBeNull();
    }
  });

  it('forwards only three or four decoys onto the target, none of the kind the job exposes', () => {
    for (const shape of portforwardShapes) {
      const { machine } = portforwardJob(shape.missionNumber);
      const label = `${machine.noun} of ${shape.missionNumber}`;

      expect(realForwards(shape), label).toEqual([]);
      expect([3, 4], label).toContain(shape.forwards.length);
      expect(shape.keyBox.decoys, label).toHaveLength(shape.forwards.length);
      for (const forward of shape.forwards)
        expect(forward.boxOctet, label).toBe(shape.keyBox.octet);
      const exposing = EXPOSING_DECOY[machine.service];
      if (exposing !== null) expect(shape.keyBox.decoys, label).not.toContain(exposing);
    }
    for (const exposing of ['mysql', 'web', 'ssh'] as const) {
      expect(
        portforwardShapes.some(({ keyBox }) => keyBox.decoys.includes(exposing)),
        `some target runs a ${exposing} decoy`,
      ).toBe(true);
    }
  });

  it('draws the same network for a number every time, on streams of its own', () => {
    // Captured from the generator: one contract per machine, the first on the msfconsole route.
    expect(
      [5, 37, 13, 94].map((missionNumber) => md5(JSON.stringify(missionShape(missionNumber)))),
    ).toEqual([
      'd3f5bef71294baf5e5ecc66a27fd834e',
      '913a6b18d96fe2eb57032dc1ae019c64',
      '783f38f65c0c870640c5ec3a367c5249',
      '4919a4efe3de4a00b0444a085831a779',
    ]);
  });

  it('asks for a public port the router neither listens on nor forwards', () => {
    for (const shape of portforwardShapes) {
      const { publicPort } = portforwardJob(shape.missionNumber);
      const routerFs = buildApGatewayBaseFs(missionEssid(shape.missionNumber));

      expect(
        machineServing({ routerFs, port: publicPort }),
        `contract ${shape.missionNumber}`,
      ).toEqual({ kind: 'none' });
    }
  });

  it("draws the router's way in half and half: hydra on a crackable admin, msfconsole on a shut one", () => {
    // A close-the-door job's router is handed over, not broken into: its own block below.
    for (const shape of ALL_SAMPLE_SHAPES.filter(({ kind }) => kind !== 'closedoor')) {
      const label = `${shape.kind} contract ${shape.missionNumber}`;
      if (shape.kind !== 'portforward') {
        expect(shape.routerRoute, label).toBeNull();
        expect(shape.routerVendor, label).toBeNull();
        expect(SHUT_HASHES, label).toContain(shape.gatewayAdminHash);
      } else if (shape.routerRoute === 'hydra') {
        expect(shape.routerVendor, label).toBeNull();
        expect(UNCRACKABLE_HASHES, label).not.toContain(shape.gatewayAdminHash);
      } else {
        expect(shape.routerRoute, label).toBe('msfconsole');
        expect(SHUT_HASHES, label).toContain(shape.gatewayAdminHash);
      }
    }
    const onHydra = portforwardShapes.filter(({ routerRoute }) => routerRoute === 'hydra');
    expect(onHydra.length / portforwardShapes.length).toBeGreaterThan(0.4);
    expect(onHydra.length / portforwardShapes.length).toBeLessThan(0.6);
  });

  it('puts a msfconsole router on one of four vendors, whose firmware hole lands a root shell over its sshd', () => {
    const onFirmware = portforwardShapes.filter(({ routerRoute }) => routerRoute === 'msfconsole');
    for (const shape of onFirmware) {
      const label = `contract ${shape.missionNumber}`;
      const vendor = shape.routerVendor ?? 'mikrotik';
      const versions = parseDpkgVersions(
        readDpkgStatus(buildApGatewayBaseFs(missionEssid(shape.missionNumber))),
      );
      const firmware = [...versions].filter(([key]) => isFirmwarePackage(key));

      expect(firmware, label).toEqual([[firmwarePackageOf(vendor), ROOT_SHELL_FIRMWARE[vendor]]]);
      const throughFirmware = firmwareExploitOutcome(versions, MISSION_ROUTE_DAY);
      expect(throughFirmware, label).toMatchObject({ effect: 'shell_full', tier: 'root' });
      const sshd = versions.get(SSHD_PACKAGE) ?? '';
      expect(
        higherSeverityOutcome(
          exploitOutcome(SSHD_PACKAGE, sshd, MISSION_ROUTE_DAY),
          throughFirmware,
        ),
        label,
      ).toBe(throughFirmware);
    }
    expect(new Set(onFirmware.map(({ routerVendor }) => routerVendor))).toEqual(
      new Set(Object.keys(ROOT_SHELL_FIRMWARE)),
    );
  });

  it('builds a hydra router as any vendor the builder draws', () => {
    const firmwares = portforwardShapes
      .filter(({ routerRoute }) => routerRoute === 'hydra')
      .map(({ missionNumber }) => {
        const versions = parseDpkgVersions(
          readDpkgStatus(buildApGatewayBaseFs(missionEssid(missionNumber))),
        );
        return [...versions.keys()].find(isFirmwarePackage);
      });
    expect(new Set(firmwares)).toEqual(new Set(FIRMWARE_VENDORS.map(firmwarePackageOf)));
  });

  it('keeps everything else on the router low or medium, so the drawn route is the only high one', () => {
    for (const shape of portforwardShapes) {
      const label = `gateway for ${shape.missionNumber}`;
      const routed =
        shape.routerVendor === null ? undefined : firmwarePackageOf(shape.routerVendor);
      const others = Object.fromEntries(
        Object.entries(shape.gatewayVersions).filter(([key]) => key !== routed),
      );
      for (const severity of pinnedSeverities(others)) {
        expect(['low', 'medium'], label).toContain(severity);
      }
      if (routed !== undefined) {
        expect(['critical', 'high'], label).toContain(
          pinnedSeverities({ [routed]: shape.gatewayVersions[routed] ?? '' })[0],
        );
      }
    }
  });
});

describe('a close-the-door contract', () => {
  const closeDoorShapes = ALL_SAMPLE_SHAPES.filter(({ kind }) => kind === 'closedoor');

  /** Where the rogue forward stands among the router's forwards: the one onto the machine's
   *  port. */
  const rogueIndex = (shape: MissionShape): number =>
    shape.forwards.findIndex(
      ({ internalPort }) => internalPort === closeDoorJob(shape.missionNumber).machine.insidePort,
    );

  it("draws each job's router word and its target's logins apart, so no two jobs read alike", () => {
    expect(new Set(closeDoorShapes.map(({ gatewayAdminHash }) => gatewayAdminHash)).size).toBe(
      WHITE_HAT_HASHES.length,
    );
    // Within one machine, so a difference is the job's own draw and not the machine's.
    const databases = closeDoorShapes.filter(
      ({ missionNumber }) => closeDoorJob(missionNumber).machine.service === 'mysql',
    );
    expect(new Set(databases.map(({ keyBox }) => keyBox.rootHash)).size).toBeGreaterThan(1);
  });

  it('is single-hop: the target stands in the key-box slot, and no front box', () => {
    expect(closeDoorShapes.length).toBeGreaterThan(100);
    for (const shape of closeDoorShapes) {
      expect(shape.frontBox, `contract ${shape.missionNumber}`).toBeNull();
    }
  });

  it("seals the target as a portforward job's: its service on the inside port, on a safe release, root shut, nothing kept", () => {
    for (const shape of closeDoorShapes) {
      const { machine } = closeDoorJob(shape.missionNumber);
      const { keyBox } = shape;
      const label = `${machine.noun} of ${shape.missionNumber}`;
      const real = realServices(keyBox);

      expect(shape.storage, label).toBeNull();
      expect(keyBox.route, label).toBeNull();
      expect(SHUT_HASHES, label).toContain(keyBox.rootHash);
      expect(
        real.map(({ program }) => program),
        label,
      ).toEqual(PROGRAMS[machine.service]);
      for (const service of real) expect(service.port, label).toBe(machine.insidePort);
      for (const severity of pinnedSeverities(keyBox.versions)) {
        expect(['low', 'medium'], label).toContain(severity);
      }
    }
  });

  // The client hands over the router, so nothing breaks into it: its root is a white-hat word
  // and every package on it sits on a low or medium release.
  it('hands over the router: root a white-hat word, no route, no vendor pinned, every release safe', () => {
    for (const shape of closeDoorShapes) {
      const label = `gateway of ${shape.missionNumber}`;

      expect(WHITE_HAT_HASHES, label).toContain(shape.gatewayAdminHash);
      expect(shape.routerRoute, label).toBeNull();
      expect(shape.routerVendor, label).toBeNull();
      for (const severity of pinnedSeverities(shape.gatewayVersions)) {
        expect(['low', 'medium'], label).toContain(severity);
      }
    }
  });

  it("forwards three or four ports onto the target: the rogue one onto the machine's port, the rest decoys of other kinds", () => {
    for (const shape of closeDoorShapes) {
      const { machine, publicPort } = closeDoorJob(shape.missionNumber);
      const label = `${machine.noun} of ${shape.missionNumber}`;
      const ontoTheService = shape.forwards.filter(
        ({ internalPort }) => internalPort === machine.insidePort,
      );

      expect([3, 4], label).toContain(shape.forwards.length);
      for (const forward of shape.forwards) {
        expect(forward.boxOctet, label).toBe(shape.keyBox.octet);
      }
      expect(ontoTheService, label).toEqual([
        { publicPort, boxOctet: shape.keyBox.octet, internalPort: machine.insidePort },
      ]);
      expect(shape.keyBox.decoys, label).toHaveLength(shape.forwards.length - 1);
      const exposing = EXPOSING_DECOY[machine.service];
      if (exposing !== null) expect(shape.keyBox.decoys, label).not.toContain(exposing);
    }
  });

  it('puts the rogue forward at any place among the others, so its line in the rules tells nothing', () => {
    const places = closeDoorShapes.map(rogueIndex);
    const first = places.filter((place) => place === 0).length;

    expect(new Set(places)).toEqual(new Set([0, 1, 2, 3]));
    expect(first / places.length).toBeGreaterThan(0.2);
    expect(first / places.length).toBeLessThan(0.45);
  });

  it("sends the rogue public port to the machine's service before anyone touches the router", () => {
    for (const shape of closeDoorShapes) {
      const { machine, publicPort } = closeDoorJob(shape.missionNumber);
      const essid = missionEssid(shape.missionNumber);

      expect(
        machineServing({ routerFs: buildApGatewayBaseFs(essid), port: publicPort }),
        `contract ${shape.missionNumber}`,
      ).toEqual({
        kind: 'forward',
        internalIp: `${lanSubnetPrefix(essid)}.${shape.keyBox.octet}`,
        internalPort: machine.insidePort,
      });
    }
  });
});

describe('the firmware a msfconsole router runs', () => {
  /** Every release of `vendor`'s firmware published by the route day whose hole lands a
   *  full shell, oldest first. */
  const fullShellReleases = (vendor: FirmwareVendor) => {
    const key = firmwarePackageOf(vendor);
    return packageTimeline(key, MISSION_ROUTE_DAY).filter(
      (release) =>
        release.publishedAt <= MISSION_ROUTE_DAY &&
        firmwareExploitOutcome(new Map([[key, release.version]]), MISSION_ROUTE_DAY)?.effect ===
          'shell_full',
    );
  };

  it("is each vendor's newest release by the route day that is critical or high and lands a root shell", () => {
    // Walks the timelines: a vendor that ever loses its release takes its routers' way in.
    for (const vendor of FIRMWARE_VENDORS) {
      const rootShells = fullShellReleases(vendor).filter(
        ({ severity }) => severity === 'critical' || severity === 'high',
      );
      expect(rootShells.at(-1)?.version, vendor).toBe(ROOT_SHELL_FIRMWARE[vendor]);
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
