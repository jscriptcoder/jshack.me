import { describe, expect, it } from 'vitest';
import { cleanupPlant, IMPLANT_FAMILIES } from './cleanupPlant.js';
import { missionFiles, missionFilePaths, missionFilesForBox } from './missionLeak.js';
import { missionKind, missionShape } from './missionShape.js';
import { cleanupJob } from './targetRoles.js';
import { isMissionNumber, missionEssid } from './missionNetwork.js';
import { networkAt } from '../generation/world.js';
import { isBoardAddress, isMissionAddress, isPublicIp } from '../generation/ip.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { file, withFiles } from '../generation/baseFs.js';
import { dirname } from '../filesystem/path.js';
import { asAbsPath, type UserType } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import type { CommandResult } from '../commands/types.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { grep } from '../commands/grep.js';
import { ps } from '../commands/ps.js';
import { strings } from '../commands/strings.js';
import { DEPLOYMENT_SECRETS } from '../../test/passwords.js';

/**
 * What the server lays on a cleanup job's target: the intruder's implant among the box's own
 * boot and schedule scripts, the listener it left running, and nothing a player holding the
 * bundle could make. The hunt is the job, so each claim is about what a root on the box finds.
 */

const SECRET = 'test-mission-secret';
const OTHER_SECRET = 'another-deployment-secret';

/** A spread of cleanup contracts, single- and two-hop, every machine among them. */
const CLEANUP_NUMBERS = Array.from({ length: 6000 }, (_unused, index) => index * 4153 + 9)
  .filter(isMissionNumber)
  .filter((missionNumber) => missionKind(missionNumber) === 'cleanup');

const ENV = { keySecret: SECRET, rawSecrets: DEPLOYMENT_SECRETS };

const target = (missionNumber: number) => ({ missionNumber, role: 'key' as const });

/** The seven places under `/etc` a box starts or schedules a script from. */
const SEVEN_PLACES = [
  '/etc/cron.d',
  '/etc/cron.daily',
  '/etc/cron.hourly',
  '/etc/init.d',
  '/etc/network/if-up.d',
  '/etc/systemd/system',
  '/etc',
];
const CRON_PLACES = ['/etc/cron.d', '/etc/cron.daily', '/etc/cron.hourly'];
const PLACEHOLDERS = CRON_PLACES.map((place) => `${place}/.placeholder`);

/** The classic ports an intruder's listener holds, any of which a decoy naming would muddy. */
const CLASSIC_PORTS = ['1337', '4444', '5555', '6666', '7777', '9001', '12345', '31337'];

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The target as a root standing on it reads it: the generated box with the server's files laid. */
const laidTarget = (missionNumber: number): Directory =>
  withFiles(
    buildMissionKeyBoxFs(missionNumber),
    missionFiles(target(missionNumber), ENV).map(
      ({ path, content, perms }) => [path, file(content, perms)] as const,
    ),
  );

const rootEnv = (tree: Directory, userType: UserType = 'root') =>
  mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
  });

const NO_FLAGS = new Map<string, string | true>();

const linesOf = (result: CommandResult): readonly string[] => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.lines.map((line) => line.content);
};

const firstWhere = (predicate: (missionNumber: number) => boolean): number => {
  const found = CLEANUP_NUMBERS.find(predicate);
  if (found === undefined) throw new Error('no such cleanup contract in the spread');
  return found;
};

describe('what the server lays on a cleanup target', () => {
  it('lays the implant, its listener, two to four decoys beside it and the cron placeholders', () => {
    const decoyCounts = new Set<number>();
    for (const missionNumber of CLEANUP_NUMBERS) {
      const { implant, decoys } = cleanupPlant(missionNumber, SECRET);
      const { port } = cleanupJob(missionNumber);
      const laid = missionFiles(target(missionNumber), ENV).map(({ path }) => path);

      expect(new Set(laid), `contract ${missionNumber}`).toEqual(
        new Set([
          implant.path,
          `/var/run/nc-${port}.pid`,
          ...decoys.map(({ path }) => path),
          ...PLACEHOLDERS,
        ]),
      );
      expect(laid, `contract ${missionNumber}`).toHaveLength(new Set(laid).size);
      for (const decoy of decoys)
        expect(dirname(asAbsPath(decoy.path))).toBe(dirname(asAbsPath(implant.path)));
      decoyCounts.add(decoys.length);
    }

    expect(decoyCounts).toEqual(new Set([2, 3, 4]));
  });

  it('lists every laid path for the write gate, so a root can remove each one', () => {
    for (const missionNumber of CLEANUP_NUMBERS.slice(0, 40)) {
      expect(missionFilePaths(target(missionNumber), SECRET)).toEqual(
        missionFiles(target(missionNumber), ENV).map(({ path }) => path),
      );
    }
  });

  // Without the secret nobody can say where the implant is, and a list drawn without it would
  // name paths a bundle holder can compute.
  it('lists no implant path for the write gate without the mission secret', () => {
    const missionNumber = CLEANUP_NUMBERS[0]!;
    const { implant } = cleanupPlant(missionNumber, SECRET);

    expect(missionFilePaths(target(missionNumber), undefined)).not.toContain(implant.path);
    expect(missionFilePaths(target(missionNumber), undefined)).toEqual([]);
  });

  it('lays nothing on a two-hop contract’s edge machine', () => {
    const twoHop = firstWhere((missionNumber) => missionShape(missionNumber).frontBox !== null);
    const front = { missionNumber: twoHop, role: 'front' as const };

    expect(missionFiles(front, ENV)).toEqual([]);
    expect(missionFilePaths(front, SECRET)).toEqual([]);
  });

  it('answers that the secret is missing rather than lay a target without it', async () => {
    const missionNumber = CLEANUP_NUMBERS[0]!;
    const essid = missionEssid(missionNumber);
    const { octet } = missionShape(missionNumber).keyBox;
    const keyBox = generateHomeLan(essid).hosts.find(({ ip }) => ip.endsWith(`.${octet}`));
    if (keyBox === undefined) throw new Error('a contract network has a key box');
    const machineId = machineIdForLanHost(keyBox, essid);

    expect(
      await missionFilesForBox(
        { essid, machine_id: machineId },
        {
          keySecret: undefined,
          rawSecrets: DEPLOYMENT_SECRETS,
          readPostedAt: async () => {
            throw new Error('a cleanup box never asks when its offer was posted');
          },
        },
      ),
    ).toEqual({ data: null, error: 'mission_secret_missing' });
  });

  // The implant is the hunt: a player holding the bundle must not read where it is.
  it('draws the implant from the secret, so another deployment hides it elsewhere', () => {
    const moved = CLEANUP_NUMBERS.filter(
      (missionNumber) =>
        cleanupPlant(missionNumber, SECRET).implant.path !==
        cleanupPlant(missionNumber, OTHER_SECRET).implant.path,
    );

    expect(moved.length / CLEANUP_NUMBERS.length).toBeGreaterThan(0.5);
  });
});

describe('where the implant hides', () => {
  it('puts it in one of the seven places a box starts or schedules a script from', () => {
    const places = CLEANUP_NUMBERS.map((missionNumber) =>
      dirname(asAbsPath(cleanupPlant(missionNumber, SECRET).implant.path)),
    );

    expect(new Set(places)).toEqual(new Set(SEVEN_PLACES));
  });

  it('dot-names about half the implants in a cron directory and none anywhere else', () => {
    const plants = CLEANUP_NUMBERS.map((missionNumber) => cleanupPlant(missionNumber, SECRET));
    const inCron = plants.filter(({ implant }) =>
      CRON_PLACES.includes(dirname(asAbsPath(implant.path))),
    );
    const dotted = inCron.filter(({ implant }) => basenameOf(implant.path).startsWith('.'));
    const elsewhere = plants.filter(
      ({ implant }) => !CRON_PLACES.includes(dirname(asAbsPath(implant.path))),
    );

    expect(dotted.length / inCron.length).toBeGreaterThan(0.35);
    expect(dotted.length / inCron.length).toBeLessThan(0.65);
    expect(elsewhere.filter(({ implant }) => basenameOf(implant.path).startsWith('.'))).toEqual([]);
  });

  it('gives each machine three or four implants of its own, every family among them', () => {
    const byMachine = new Map<string, Set<string>>();
    for (const missionNumber of CLEANUP_NUMBERS) {
      const { suffix } = cleanupJob(missionNumber).role;
      const name = basenameOf(cleanupPlant(missionNumber, SECRET).implant.path).replace(/^\./, '');
      byMachine.set(suffix, new Set([...(byMachine.get(suffix) ?? []), name]));
    }
    const everyName = [...byMachine.values()].flatMap((names) => [...names]);
    const families = new Set(
      CLEANUP_NUMBERS.map((missionNumber) => cleanupPlant(missionNumber, SECRET).implant.family),
    );

    expect([...byMachine.keys()].sort()).toEqual(
      ['access', 'backup', 'billing', 'ci', 'lic', 'mon', 'nvr'].sort(),
    );
    for (const [suffix, names] of byMachine) {
      expect(names.size, suffix).toBeGreaterThanOrEqual(3);
      expect(names.size, suffix).toBeLessThanOrEqual(4);
    }
    expect(everyName).toHaveLength(24);
    expect(new Set(everyName).size).toBe(24);
    expect(families).toEqual(new Set(IMPLANT_FAMILIES));
  });

  it('names the briefed port and its outside host in every implant, and no classic port in a decoy', () => {
    for (const missionNumber of CLEANUP_NUMBERS) {
      const { implant, decoys, outsideHost } = cleanupPlant(missionNumber, SECRET);
      const { port } = cleanupJob(missionNumber);

      expect(implant.content, `contract ${missionNumber}`).toContain(String(port));
      expect(implant.content, `contract ${missionNumber}`).toContain(outsideHost);
      for (const decoy of decoys) {
        for (const classic of CLASSIC_PORTS)
          expect(decoy.content, decoy.path).not.toContain(classic);
      }
    }
  });

  it('fills every decoy beside it, so no empty file gives the implant away', () => {
    for (const missionNumber of CLEANUP_NUMBERS) {
      for (const decoy of cleanupPlant(missionNumber, SECRET).decoys)
        expect(decoy.content.trim(), decoy.path).not.toBe('');
    }
  });

  it('compiles four of the twenty-four implants, which grep skips and strings reads', () => {
    const compiled = new Set(
      CLEANUP_NUMBERS.map((missionNumber) => cleanupPlant(missionNumber, SECRET).implant)
        .filter(({ binary }) => binary)
        .map(({ path }) => basenameOf(path).replace(/^\./, '')),
    );

    expect(compiled.size).toBe(4);
  });

  // An outside host must lead nowhere: not a contract any player may be handed, not a board,
  // not a network the world places, and never an address outside the game.
  it('names an outside host in the world that no network answers at', () => {
    for (const missionNumber of CLEANUP_NUMBERS) {
      const { outsideHost } = cleanupPlant(missionNumber, SECRET);

      expect(isPublicIp(outsideHost), outsideHost).toBe(true);
      expect(isMissionAddress(outsideHost), outsideHost).toBe(false);
      expect(isBoardAddress(outsideHost), outsideHost).toBe(false);
      expect(networkAt(outsideHost), outsideHost).toBeUndefined();
    }
  });
});

describe('the hunt, as a root on the target runs it', () => {
  it('shows the listener in ps on the briefed port, under the machine’s own service account', async () => {
    const missionNumber = CLEANUP_NUMBERS[0]!;
    const { port } = cleanupJob(missionNumber);
    const tree = laidTarget(missionNumber);

    const rows = linesOf(await ps.execute(rootEnv(tree), [], NO_FLAGS));
    const listener = rows.find((row) => row.includes(' nc ') && row.endsWith(String(port)));

    expect(listener, rows.join('\n')).toBeDefined();
    expect(listener).toContain(cleanupJob(missionNumber).role.serviceAccount);
  });

  it('lists that service account in the box’s passwd, locked so nobody logs in as it', () => {
    for (const missionNumber of CLEANUP_NUMBERS.slice(0, 20)) {
      const etc = buildMissionKeyBoxFs(missionNumber).entries.get('etc') as Directory;
      const passwd = etc.entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('no passwd');
      const account = cleanupJob(missionNumber).role.serviceAccount;
      const row = passwd.content.split('\n').find((line) => line.startsWith(`${account}:`));

      expect(row, `contract ${missionNumber}`).toBe(
        `${account}:*:999:999:${account}:/var/lib/${account}:/usr/sbin/nologin`,
      );
    }
  });

  it('finds a script implant, dot-named or not, and no decoy, by grepping /etc for the port', async () => {
    const scripts = CLEANUP_NUMBERS.filter(
      (missionNumber) => !cleanupPlant(missionNumber, SECRET).implant.binary,
    );
    const dotted = scripts.find((missionNumber) =>
      basenameOf(cleanupPlant(missionNumber, SECRET).implant.path).startsWith('.'),
    );
    const plain = scripts.find(
      (missionNumber) =>
        !basenameOf(cleanupPlant(missionNumber, SECRET).implant.path).startsWith('.'),
    );

    for (const missionNumber of [dotted!, plain!]) {
      const { port } = cleanupJob(missionNumber);
      const { implant } = cleanupPlant(missionNumber, SECRET);

      const found = linesOf(
        await grep.execute(
          rootEnv(laidTarget(missionNumber)),
          [String(port), '/etc'],
          new Map([['-l', true]]),
        ),
      );

      expect(found, `contract ${missionNumber}`).toEqual([implant.path]);
    }
  });

  it('hides a binary implant from grep, and gives up its port and host to strings', async () => {
    const missionNumber = firstWhere((candidate) => cleanupPlant(candidate, SECRET).implant.binary);
    const { port } = cleanupJob(missionNumber);
    const { implant, outsideHost } = cleanupPlant(missionNumber, SECRET);
    const tree = laidTarget(missionNumber);

    const grepped = await grep.execute(
      rootEnv(tree),
      [String(port), '/etc'],
      new Map([['-l', true]]),
    );
    const read = linesOf(await strings.execute(rootEnv(tree), [implant.path], NO_FLAGS)).join('\n');

    expect(linesOf(grepped)).toEqual([]);
    expect(read).toContain(String(port));
    expect(read).toContain(outsideHost);
  });
});
