import { describe, expect, it } from 'vitest';
import {
  leakedWord,
  missionFilePaths,
  missionFiles,
  missionFilesForBox,
  missionLeakFile,
  missionLeakPath,
  MissionLeakUnavailableError,
} from './missionLeak.js';
import { LEAKABLE_HASHES, SHUT_HASHES } from './leakablePool.js';
import { missionKey, missionKeyPath, MissionSecretMissingError } from './missionSecret.js';
import { missionShape, type MissionRoute } from './missionShape.js';
import { DEFAULT_DIRLIST } from '../network/defaultDirlist.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { computeApGatewayId } from '../identity/router.js';
import { missionEssid } from './missionNetwork.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { withMissionFiles } from '../network/missionBoxFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { ROOT_FILE } from '../generation/baseFs.js';
import {
  COMMON_PASSWORDS,
  CRACKABLE_PASSWORDS,
  plaintextFor,
  UNCRACKABLE_PASSWORDS,
  WIFI_PASSWORDS,
} from '../../test/passwords.js';

/** The deployment's password pools, as the server reads them from its environment. */
const RAW_SECRETS = JSON.stringify({
  UNCRACKABLE_PASSWORDS,
  CRACKABLE_PASSWORDS,
  COMMON_PASSWORDS,
  WIFI_PASSWORDS,
});

const KEY_SECRET = 'test-mission-secret';

const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const numbersWithRoute = (route: MissionRoute): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => missionShape(missionNumber).route === route);

const firstWithRoute = (route: MissionRoute): number => {
  const [found] = numbersWithRoute(route);
  if (found === undefined) throw new Error(`no ${route} contract in the sample`);
  return found;
};

// Assertions on a word go through booleans: a failing `toContain` would print the word.
describe('leakedWord', () => {
  it('gives the word behind a hash a file may leak', () => {
    const [hash] = LEAKABLE_HASHES;
    if (hash === undefined) throw new Error('no leakable hash');

    expect(leakedWord(hash, RAW_SECRETS) === plaintextFor(hash)).toBe(true);
  });

  it('refuses every hash outside the slice, so no other word can come out', () => {
    for (const hash of SHUT_HASHES) {
      expect(() => leakedWord(hash, RAW_SECRETS), hash).toThrow(MissionLeakUnavailableError);
    }
  });

  it('refuses when the deployment holds no pools, rather than guessing', () => {
    const [hash] = LEAKABLE_HASHES;
    if (hash === undefined) throw new Error('no leakable hash');

    expect(() => leakedWord(hash, undefined)).toThrow(MissionLeakUnavailableError);
  });

  it('refuses when the pools no longer hold the word the bundle hashed', () => {
    const [hash] = LEAKABLE_HASHES;
    if (hash === undefined) throw new Error('no leakable hash');
    const word = plaintextFor(hash);
    const others = UNCRACKABLE_PASSWORDS.filter((candidate) => candidate !== word);
    const rotated = JSON.stringify({
      UNCRACKABLE_PASSWORDS: others,
      CRACKABLE_PASSWORDS,
      COMMON_PASSWORDS,
      WIFI_PASSWORDS,
    });

    expect(() => leakedWord(hash, rotated)).toThrow(MissionLeakUnavailableError);
  });
});

describe('missionLeakFile', () => {
  it('sits at a name the default list tries, under the document root', () => {
    const paths = numbersWithRoute('web').map(missionLeakPath);

    for (const path of paths) {
      const name = path?.replace('/var/www/html/', '');
      expect(path, 'under the document root').toMatch(/^\/var\/www\/html\/[^/]+$/);
      expect(DEFAULT_DIRLIST).toContain(name);
    }
    // Drawn from the number, across more than one name.
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('can be a dotfile on a web route, where a sweep finds what a listing would hide', () => {
    expect(numbersWithRoute('web').map(missionLeakPath)).toContain('/var/www/html/.env');
  });

  it('is the same for the same number', () => {
    const missionNumber = firstWithRoute('web');

    expect(missionLeakFile(missionNumber, RAW_SECRETS)).toEqual(
      missionLeakFile(missionNumber, RAW_SECRETS),
    );
  });

  it('holds the word of the box root, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('web')) {
      const word = plaintextFor(missionShape(missionNumber).keyBoxRootHash);
      const leak = missionLeakFile(missionNumber, RAW_SECRETS);

      expect(leak?.content.includes(word), `word in file of ${missionNumber}`).toBe(true);
      expect(/root/i.test(leak?.content ?? 'root'), `account in file of ${missionNumber}`).toBe(
        false,
      );
    }
  });

  it('sits in the ftp public directory on an ftp route, at a name a plain ls shows', () => {
    const paths = numbersWithRoute('ftp').map(missionLeakPath);

    for (const path of paths) {
      expect(path, 'in pub').toMatch(/^\/srv\/ftp\/pub\/[^./][^/]*$/);
    }
    // Drawn from the number, across more than one name.
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('holds the word of the box root on an ftp route, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('ftp')) {
      const word = plaintextFor(missionShape(missionNumber).keyBoxRootHash);
      const leak = missionLeakFile(missionNumber, RAW_SECRETS);

      expect(leak?.content.includes(word), `word in file of ${missionNumber}`).toBe(true);
      expect(/root/i.test(leak?.content ?? 'root'), `account in file of ${missionNumber}`).toBe(
        false,
      );
    }
  });

  it('does not exist on a route with no leak', () => {
    for (const route of ['hydra', 'msfconsole'] as const) {
      const missionNumber = firstWithRoute(route);
      expect(missionLeakPath(missionNumber), route).toBeNull();
      expect(missionLeakFile(missionNumber, RAW_SECRETS), route).toBeNull();
    }
  });
});

describe('missionFiles', () => {
  it('lays the key alone on a route with no leak, without needing the pools', () => {
    const missionNumber = firstWithRoute('hydra');

    expect(missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: undefined })).toEqual([
      {
        path: missionKeyPath(missionNumber),
        content: `${missionKey(missionNumber, KEY_SECRET)}\n`,
        perms: ROOT_FILE,
      },
    ]);
  });

  it('lays the key and the leak on a web route', () => {
    const missionNumber = firstWithRoute('web');

    expect(missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS })).toEqual(
      [
        {
          path: missionKeyPath(missionNumber),
          content: `${missionKey(missionNumber, KEY_SECRET)}\n`,
          perms: ROOT_FILE,
        },
        missionLeakFile(missionNumber, RAW_SECRETS),
      ],
    );
  });

  it('fails closed on a web route when the pools are missing', () => {
    const missionNumber = firstWithRoute('web');

    expect(() =>
      missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: undefined }),
    ).toThrow(MissionLeakUnavailableError);
  });

  it('fails closed on any route when the key secret is missing', () => {
    expect(() =>
      missionFiles(firstWithRoute('hydra'), { keySecret: undefined, rawSecrets: RAW_SECRETS }),
    ).toThrow(MissionSecretMissingError);
  });
});

describe('missionFilesForBox', () => {
  const keyBoxOf = (missionNumber: number) => {
    const essid = missionEssid(missionNumber);
    const keyBox = generateHomeLan(essid).hosts.find((host) => host.kind === 'machine');
    if (keyBox === undefined) throw new Error('a contract network has a key box');
    return { essid, machine_id: machineIdForLanHost(keyBox, essid) };
  };
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  it('gives a key box its files', async () => {
    const missionNumber = firstWithRoute('web');

    expect(await missionFilesForBox(keyBoxOf(missionNumber), HOLDING_BOTH)).toEqual({
      data: missionFiles(missionNumber, HOLDING_BOTH),
      error: null,
    });
  });

  it('gives a contract gateway nothing', async () => {
    const essid = missionEssid(firstWithRoute('web'));

    expect(
      await missionFilesForBox({ essid, machine_id: computeApGatewayId(essid) }, HOLDING_BOTH),
    ).toEqual({ data: [], error: null });
  });

  it('gives a box on an ordinary network nothing, whatever the deployment holds', async () => {
    const essid = 'BEAN-THERE-WIFI';

    expect(
      await missionFilesForBox(
        { essid, machine_id: computeApGatewayId(essid) },
        { keySecret: undefined, rawSecrets: undefined },
      ),
    ).toEqual({ data: [], error: null });
  });

  it.each(['web', 'ftp'] as const)(
    'fails closed on a %s route when the pools are unset',
    async (route) => {
      expect(
        await missionFilesForBox(keyBoxOf(firstWithRoute(route)), {
          keySecret: KEY_SECRET,
          rawSecrets: undefined,
        }),
      ).toEqual({ data: null, error: 'mission_secret_missing' });
    },
  );

  it('fails closed on any route when the key secret is unset', async () => {
    expect(
      await missionFilesForBox(keyBoxOf(firstWithRoute('hydra')), {
        keySecret: undefined,
        rawSecrets: RAW_SECRETS,
      }),
    ).toEqual({ data: null, error: 'mission_secret_missing' });
  });

  it('leaves a route with no leak working when only the pools are unset', async () => {
    const missionNumber = firstWithRoute('hydra');

    expect(
      await missionFilesForBox(keyBoxOf(missionNumber), {
        keySecret: KEY_SECRET,
        rawSecrets: undefined,
      }),
    ).toEqual({
      data: missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: undefined }),
      error: null,
    });
  });
});

describe('missionFilePaths', () => {
  it('names the same files the server lays in, from the number alone', () => {
    for (const route of ['hydra', 'msfconsole', 'web', 'ftp'] as const) {
      const missionNumber = firstWithRoute(route);
      const laid = missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS });

      expect(missionFilePaths(missionNumber), route).toEqual(laid.map((file) => file.path));
    }
  });
});

describe('who can read what the server lays onto a key box', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  /** The key box as a door sees it, with the number's files laid on. */
  const laidBox = async (missionNumber: number) => {
    const tree = await withMissionFiles(
      async () => ({ data: missionFiles(missionNumber, HOLDING_BOTH), error: null }),
      {
        essid: missionEssid(missionNumber),
        machineId: 'key-box',
        baseFs: buildMissionKeyBoxFs(missionNumber),
      },
    );
    if (tree === null) throw new Error('the files could not be made');
    return tree;
  };

  const readableBy = (
    tree: Awaited<ReturnType<typeof laidBox>>,
    userType: 'guest' | 'root',
    path: string,
  ): boolean => createFsView(tree, { userType }).read(asAbsPath(path)).ok;

  it('lets a guest read the file in pub on an ftp route, and not the key', async () => {
    const missionNumber = firstWithRoute('ftp');
    const tree = await laidBox(missionNumber);

    expect(readableBy(tree, 'guest', missionLeakPath(missionNumber) ?? '')).toBe(true);
    expect(readableBy(tree, 'guest', missionKeyPath(missionNumber))).toBe(false);
    expect(readableBy(tree, 'root', missionKeyPath(missionNumber))).toBe(true);
  });

  it('keeps the file root-only on a web route, where the web door serves it instead', async () => {
    const missionNumber = firstWithRoute('web');
    const tree = await laidBox(missionNumber);

    expect(readableBy(tree, 'guest', missionLeakPath(missionNumber) ?? '')).toBe(false);
    expect(readableBy(tree, 'root', missionLeakPath(missionNumber) ?? '')).toBe(true);
  });

  it('lets only root change the file in pub', () => {
    const leak = missionLeakFile(firstWithRoute('ftp'), RAW_SECRETS);

    expect(leak?.perms.write).toEqual(['root']);
    expect(leak?.perms.execute).toEqual([]);
  });
});
