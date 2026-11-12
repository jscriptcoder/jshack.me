import { describe, expect, it } from 'vitest';
import {
  leakedWord,
  missionFilePaths,
  missionFiles,
  missionFilesForBox,
  missionLeakFile,
  missionLeakPath,
  missionLeakWord,
  MissionLeakUnavailableError,
} from './missionLeak.js';
import { LEAKABLE_HASHES, SHUT_HASHES } from './leakablePool.js';
import {
  missionKey,
  missionKeyPath,
  missionPassphrase,
  MissionSecretMissingError,
} from './missionSecret.js';
import {
  missionShape,
  type MissionBoxRef,
  type MissionRoute,
  type MissionShape,
  type MissionStorage,
} from './missionShape.js';
import { decryptContent } from '../crypto/gpgCodec.js';
import { binaryStub } from '../generation/binaries.js';
import { strings } from '../commands/strings.js';
import { grep } from '../commands/grep.js';
import { gpg } from '../commands/gpg.js';
import { mockCommandEnv } from '../../test/factories/commandEnv.js';
import type { CommandResult } from '../commands/types.js';
import type { Directory } from '../filesystem/types.js';
import { DEFAULT_DIRLIST } from '../network/defaultDirlist.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { computeApGatewayId } from '../identity/router.js';
import { missionEssid } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { withMissionFiles } from '../network/missionBoxFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { DATADIR_FILE, ROOT_FILE } from '../generation/baseFs.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { parseSnmpdConf, SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS } from '../snmp/conf.js';
import { parseMysqlDatabase } from '../mysql/types.js';
import { runStatement } from '../mysql/statements.js';
import { missionAction, missionRecords, missionSetting } from './missionRecords.js';
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

/** A contract's key box, and on two hops its front box, as the server names them. */
const keyOf = (missionNumber: number): MissionBoxRef => ({ missionNumber, role: 'key' });
const frontOf = (missionNumber: number): MissionBoxRef => ({ missionNumber, role: 'front' });

const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

/** Key jobs on this route that keep the key as `storage` says: a plain file unless told
 *  otherwise, which is what every route's own tests are about. */
const numbersWithRoute = (
  route: MissionRoute,
  storage: MissionStorage = 'file',
): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'key' && shape.keyBox.route === route && shape.storage === storage;
  });

/** Key jobs keeping the key as `storage` says. */
const numbersWithStorage = (storage: MissionStorage): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'key' && shape.storage === storage;
  });

/** Tamper jobs whose records box falls to `route`, on either hop count, keeping the records as
 *  `storage` says: in its database unless a test asks for a file. */
const tamperNumbersWithRoute = (
  route: MissionRoute,
  storage: MissionStorage = 'database',
): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'tamper' && shape.keyBox.route === route && shape.storage === storage;
  });

const firstTamperWithRoute = (
  route: MissionRoute,
  storage: MissionStorage = 'database',
): number => {
  const [found] = tamperNumbersWithRoute(route, storage);
  if (found === undefined) throw new Error(`no tamper ${route} ${storage} contract in the sample`);
  return found;
};

const firstWithStorage = (storage: MissionStorage): number => {
  const [found] = numbersWithStorage(storage);
  if (found === undefined) throw new Error(`no ${storage} contract in the sample`);
  return found;
};

const firstWithRoute = (route: MissionRoute, storage: MissionStorage = 'file'): number => {
  const [found] = numbersWithRoute(route, storage);
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
    const paths = numbersWithRoute('web').map((missionNumber) =>
      missionLeakPath(keyOf(missionNumber)),
    );

    for (const path of paths) {
      const name = path?.replace('/var/www/html/', '');
      expect(path, 'under the document root').toMatch(/^\/var\/www\/html\/[^/]+$/);
      expect(DEFAULT_DIRLIST).toContain(name);
    }
    // Drawn from the number, across more than one name.
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('can be a dotfile on a web route, where a sweep finds what a listing would hide', () => {
    expect(
      numbersWithRoute('web').map((missionNumber) => missionLeakPath(keyOf(missionNumber))),
    ).toContain('/var/www/html/.env');
  });

  it('is the same for the same number', () => {
    const missionNumber = firstWithRoute('web');

    expect(missionLeakFile(keyOf(missionNumber), RAW_SECRETS)).toEqual(
      missionLeakFile(keyOf(missionNumber), RAW_SECRETS),
    );
  });

  it('holds the word of the box root, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('web')) {
      const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);
      const leak = missionLeakFile(keyOf(missionNumber), RAW_SECRETS);

      expect(leak?.content.includes(word), `word in file of ${missionNumber}`).toBe(true);
      expect(/root/i.test(leak?.content ?? 'root'), `account in file of ${missionNumber}`).toBe(
        false,
      );
    }
  });

  it('sits in the ftp public directory on an ftp route, at a name a plain ls shows', () => {
    const paths = numbersWithRoute('ftp').map((missionNumber) =>
      missionLeakPath(keyOf(missionNumber)),
    );

    for (const path of paths) {
      expect(path, 'in pub').toMatch(/^\/srv\/ftp\/pub\/[^./][^/]*$/);
    }
    // Drawn from the number, across more than one name.
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('holds the word of the box root on an ftp route, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('ftp')) {
      const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);
      const leak = missionLeakFile(keyOf(missionNumber), RAW_SECRETS);

      expect(leak?.content.includes(word), `word in file of ${missionNumber}`).toBe(true);
      expect(/root/i.test(leak?.content ?? 'root'), `account in file of ${missionNumber}`).toBe(
        false,
      );
    }
  });

  it('is the datadir on a database route, as root-only as the one it replaces', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const leak = missionLeakFile(keyOf(missionNumber), RAW_SECRETS);

      expect(missionLeakPath(keyOf(missionNumber))).toBe(DATADIR_PATH);
      expect(leak?.path).toBe(DATADIR_PATH);
      expect(leak?.perms).toEqual(DATADIR_FILE);
    }
  });

  it('adds only the settings table to the database the box generates', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const laid = parseMysqlDatabase(
        missionLeakFile(keyOf(missionNumber), RAW_SECRETS)?.content ?? '',
      );
      const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
      const { settings: _settings, ...others } = laid?.tables ?? {};

      expect(laid?.name, `name of ${missionNumber}`).toBe(generated?.name);
      expect(laid?.credentials, `accounts of ${missionNumber}`).toEqual(generated?.credentials);
      expect(others, `tables of ${missionNumber}`).toEqual(generated?.tables);
    }
  });

  it('holds the word of the box root in a settings row, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);
      const laid = parseMysqlDatabase(
        missionLeakFile(keyOf(missionNumber), RAW_SECRETS)?.content ?? '',
      );
      const settings = laid?.tables['settings'];

      expect(settings?.columns).toEqual([
        { name: 'name', type: 'VARCHAR', nullable: false, key: 'PRI' },
        { name: 'value', type: 'VARCHAR', nullable: false },
      ]);
      expect(settings?.rows.map((row) => row['name'])).toEqual([
        'site_mode',
        'maintenance',
        'admin_pass',
      ]);
      expect(settings?.rows[0]?.['value']).toBe('live');
      expect(settings?.rows[1]?.['value']).toBe('0');
      expect(settings?.rows[2]?.['value'] === word, `word of ${missionNumber}`).toBe(true);
      expect(/root/i.test(JSON.stringify(settings)), `account in table of ${missionNumber}`).toBe(
        false,
      );
    }
  });

  it('is the same database for the same number', () => {
    const missionNumber = firstWithRoute('mysql');

    expect(missionLeakFile(keyOf(missionNumber), RAW_SECRETS)).toEqual(
      missionLeakFile(keyOf(missionNumber), RAW_SECRETS),
    );
  });

  it('is the agent config on an snmp route, readable by any tier and written by root', () => {
    for (const missionNumber of numbersWithRoute('snmp')) {
      const leak = missionLeakFile(keyOf(missionNumber), RAW_SECRETS);

      expect(missionLeakPath(keyOf(missionNumber))).toBe(SNMPD_CONF_PATH);
      expect(leak?.path).toBe(SNMPD_CONF_PATH);
      expect(leak?.perms).toEqual(SNMPD_CONF_PERMISSIONS);
    }
  });

  it('holds the word of the box root as the contact, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('snmp')) {
      const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);
      const content = missionLeakFile(keyOf(missionNumber), RAW_SECRETS)?.content ?? '';

      expect(parseSnmpdConf(content).sysContact.includes(word), `${missionNumber}`).toBe(true);
      expect(/root/i.test(content), `${missionNumber}`).toBe(false);
    }
  });

  it('reads as a config: a header, its two directives and a closing newline', () => {
    const lines = (
      missionLeakFile(keyOf(firstWithRoute('snmp')), RAW_SECRETS)?.content ?? ''
    ).split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('# /etc/snmp/snmpd.conf — SNMP agent configuration');
    expect(lines[3]).toBe('');
  });

  it.each(['web', 'ftp'] as const)('keeps the agent config off a %s route', (route) => {
    for (const missionNumber of numbersWithRoute(route)) {
      const content = missionLeakFile(keyOf(missionNumber), RAW_SECRETS)?.content ?? '';

      expect(parseSnmpdConf(content).roCommunity, `${missionNumber}`).toBeNull();
    }
  });

  it('answers to monitor or netops and never to public, so a default walk gets silence', () => {
    const communities = numbersWithRoute('snmp').map(
      (missionNumber) =>
        parseSnmpdConf(missionLeakFile(keyOf(missionNumber), RAW_SECRETS)?.content ?? '')
          .roCommunity,
    );

    expect([...new Set(communities)].sort()).toEqual(['monitor', 'netops']);
  });

  it('is the same config for the same number', () => {
    const missionNumber = firstWithRoute('snmp');

    expect(missionLeakFile(keyOf(missionNumber), RAW_SECRETS)).toEqual(
      missionLeakFile(keyOf(missionNumber), RAW_SECRETS),
    );
  });

  it('refuses the config when the deployment holds no pools', () => {
    expect(() => missionLeakFile(keyOf(firstWithRoute('snmp')), undefined)).toThrow(
      MissionLeakUnavailableError,
    );
  });

  it('does not exist on a route with no leak', () => {
    for (const route of ['hydra', 'msfconsole'] as const) {
      const missionNumber = firstWithRoute(route);
      expect(missionLeakPath(keyOf(missionNumber)), route).toBeNull();
      expect(missionLeakFile(keyOf(missionNumber), RAW_SECRETS), route).toBeNull();
    }
  });
});

describe('missionFiles', () => {
  it('lays the key alone on a route with no leak, without needing the pools', () => {
    const missionNumber = firstWithRoute('hydra');

    expect(
      missionFiles(keyOf(missionNumber), { keySecret: KEY_SECRET, rawSecrets: undefined }),
    ).toEqual([
      {
        path: missionKeyPath(missionNumber),
        content: `${missionKey(missionNumber, KEY_SECRET)}\n`,
        perms: ROOT_FILE,
      },
    ]);
  });

  it('lays the key and the leak on a web route', () => {
    const missionNumber = firstWithRoute('web');

    expect(
      missionFiles(keyOf(missionNumber), { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS }),
    ).toEqual([
      {
        path: missionKeyPath(missionNumber),
        content: `${missionKey(missionNumber, KEY_SECRET)}\n`,
        perms: ROOT_FILE,
      },
      missionLeakFile(keyOf(missionNumber), RAW_SECRETS),
    ]);
  });

  it.each(['web', 'ftp', 'mysql'] as const)(
    'fails closed on a %s route when the pools are missing',
    (route) => {
      expect(() =>
        missionFiles(keyOf(firstWithRoute(route)), {
          keySecret: KEY_SECRET,
          rawSecrets: undefined,
        }),
      ).toThrow(MissionLeakUnavailableError);
    },
  );

  it('fails closed on any route when the key secret is missing', () => {
    expect(() =>
      missionFiles(keyOf(firstWithRoute('hydra')), {
        keySecret: undefined,
        rawSecrets: RAW_SECRETS,
      }),
    ).toThrow(MissionSecretMissingError);
  });
});

describe('missionFilesForBox', () => {
  const keyBoxOf = (missionNumber: number) => {
    const essid = missionEssid(missionNumber);
    const { keyBox: drawn } = missionShape(missionNumber);
    const keyBox = generateHomeLan(essid).hosts.find(({ ip }) => ip.endsWith(`.${drawn.octet}`));
    if (keyBox === undefined) throw new Error('a contract network has a key box');
    return { essid, machine_id: machineIdForLanHost(keyBox, essid) };
  };
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  it('gives a key box its files', async () => {
    const missionNumber = firstWithRoute('web');

    expect(await missionFilesForBox(keyBoxOf(missionNumber), HOLDING_BOTH)).toEqual({
      data: missionFiles(keyOf(missionNumber), HOLDING_BOTH),
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
      data: missionFiles(keyOf(missionNumber), { keySecret: KEY_SECRET, rawSecrets: undefined }),
      error: null,
    });
  });
});

describe('missionFilePaths', () => {
  it('names the same files the server lays in, from the number alone', () => {
    for (const route of ['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp'] as const) {
      for (const storage of ['file', 'gpg', 'database'] as const) {
        const missionNumber = firstWithRoute(route, storage);
        const laid = missionFiles(keyOf(missionNumber), {
          keySecret: KEY_SECRET,
          rawSecrets: RAW_SECRETS,
        });

        expect(missionFilePaths(keyOf(missionNumber)), `${route} ${storage}`).toEqual(
          laid.map((file) => file.path),
        );
      }
    }
  });

  it('lays nothing in for a decoy, which is the real door as the box generates', () => {
    // A decoy's agent config is the generated box's, so a root's edit of it is the box's own
    // write and never one the server would lay over.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { route, decoys } = missionShape(missionNumber).keyBox;
      if (route === 'snmp' || !decoys.includes('snmp')) continue;

      expect(missionFilePaths(keyOf(missionNumber)), `${route} ${missionNumber}`).not.toContain(
        SNMPD_CONF_PATH,
      );
    }
  });
});

describe('the files of a two-hop contract', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  const twoHopShapes = SAMPLE_NUMBERS.map(missionShape).filter((shape) => shape.frontBox !== null);

  const twoHopWith = (wanted: (shape: MissionShape) => boolean): number => {
    const found = twoHopShapes.find(wanted);
    if (found === undefined) throw new Error('no such two-hop contract in the sample');
    return found.missionNumber;
  };

  const frontWord = (missionNumber: number): string =>
    plaintextFor(missionShape(missionNumber).frontBox?.rootHash ?? '');

  it('lays the key and the key box own leak on the key box, and only its own leak on the front box', () => {
    const missionNumber = twoHopWith(
      (shape) =>
        shape.kind === 'key' &&
        shape.storage === 'file' &&
        shape.keyBox.route === 'ftp' &&
        shape.frontBox?.route === 'web',
    );
    const keyLeak = missionLeakPath(keyOf(missionNumber));
    const frontLeak = missionLeakPath(frontOf(missionNumber));

    expect(keyLeak).toMatch(/^\/srv\/ftp\/pub\//);
    expect(frontLeak).toMatch(/^\/var\/www\/html\//);
    expect(missionFiles(keyOf(missionNumber), HOLDING_BOTH).map(({ path }) => path)).toEqual([
      missionKeyPath(missionNumber),
      keyLeak,
    ]);
    expect(missionFiles(frontOf(missionNumber), HOLDING_BOTH).map(({ path }) => path)).toEqual([
      frontLeak,
    ]);
  });

  it.each(['web', 'ftp', 'snmp'] as const)(
    "gives a %s front box's file the front box own root word",
    (route) => {
      const missionNumber = twoHopWith((shape) => shape.frontBox?.route === route);
      const file = missionLeakFile(frontOf(missionNumber), RAW_SECRETS);

      expect(
        missionLeakWord(frontOf(missionNumber), RAW_SECRETS) === frontWord(missionNumber),
      ).toBe(true);
      expect(file?.content.includes(frontWord(missionNumber))).toBe(true);
    },
  );

  it('draws the front box forgotten file on a stream of its own, not the key box one', () => {
    const bothWeb = twoHopShapes.filter(
      (shape) => shape.keyBox.route === 'web' && shape.frontBox?.route === 'web',
    );
    const differing = bothWeb.filter(
      ({ missionNumber }) =>
        missionLeakPath(keyOf(missionNumber)) !== missionLeakPath(frontOf(missionNumber)),
    );

    expect(bothWeb.length).toBeGreaterThan(5);
    expect(differing.length).toBeGreaterThan(bothWeb.length / 2);
  });

  it('draws each contract its own front-box forgotten file', () => {
    const webFronts = twoHopShapes.filter((shape) => shape.frontBox?.route === 'web');
    const names = new Set(
      webFronts.map(({ missionNumber }) => missionLeakPath(frontOf(missionNumber))),
    );

    expect(webFronts.length).toBeGreaterThan(5);
    expect(names.size).toBeGreaterThan(1);
  });

  // Captured before a front box existed: a front box drawing its file on a stream of its own
  // must leave every key box's draw where it was.
  it.each([
    [66058, '/var/www/html/todo.txt'],
    [66065, '/srv/ftp/pub/old'],
    [66068, '/srv/ftp/pub/settings'],
    [66082, '/srv/ftp/pub/settings'],
    [66097, '/var/www/html/notes.txt'],
    [66098, '/var/www/html/readme.txt'],
  ])('keeps contract %i key box forgotten file at %s', (missionNumber, path) => {
    expect(missionLeakPath(keyOf(missionNumber))).toBe(path);
  });

  it.each(['hydra', 'msfconsole'] as const)(
    'lays nothing on a %s front box, and asks no secret to say so',
    (route) => {
      const missionNumber = twoHopWith((shape) => shape.frontBox?.route === route);
      const holdingNothing = { keySecret: undefined, rawSecrets: undefined };

      expect(missionFiles(frontOf(missionNumber), holdingNothing)).toEqual([]);
      expect(missionFilePaths(frontOf(missionNumber))).toEqual([]);
    },
  );

  it('lays a database front box its own datadir with its word, and the key only in the key box', () => {
    const missionNumber = twoHopWith(
      (shape) =>
        shape.kind === 'key' && shape.frontBox?.route === 'mysql' && shape.storage === 'database',
    );
    const [frontDatadir] = missionFiles(frontOf(missionNumber), HOLDING_BOTH);
    const keyDatadir = missionFiles(keyOf(missionNumber), HOLDING_BOTH).find(
      ({ path }) => path === DATADIR_PATH,
    );
    const front = parseMysqlDatabase(frontDatadir?.content ?? '');
    const key = parseMysqlDatabase(keyDatadir?.content ?? '');

    expect(frontDatadir?.path).toBe(DATADIR_PATH);
    expect(JSON.stringify(front?.tables['settings']).includes(frontWord(missionNumber))).toBe(true);
    expect(front?.tables['api_keys']).toBeUndefined();
    expect(
      JSON.stringify(key?.tables['api_keys']).includes(missionKey(missionNumber, KEY_SECRET)),
    ).toBe(true);
  });

  it('names the same files the server lays in, for each box', () => {
    for (const { missionNumber } of twoHopShapes.slice(0, 80)) {
      for (const box of [keyOf(missionNumber), frontOf(missionNumber)]) {
        expect(missionFilePaths(box), `${box.role} box of ${missionNumber}`).toEqual(
          missionFiles(box, HOLDING_BOTH).map(({ path }) => path),
        );
      }
    }
  });

  it('knows no front box on a single-hop contract', () => {
    const single = SAMPLE_NUMBERS.find(
      (missionNumber) => missionShape(missionNumber).frontBox === null,
    );
    if (single === undefined) throw new Error('no single-hop contract in the sample');

    expect(() => missionFiles(frontOf(single), HOLDING_BOTH)).toThrow();
    expect(() => missionFilePaths(frontOf(single))).toThrow();
  });

  it('gives each box of a two-hop contract its own files at the door', async () => {
    const missionNumber = twoHopWith((shape) => shape.frontBox?.route === 'web');
    const essid = missionEssid(missionNumber);
    const { keyBox, frontBox } = missionShape(missionNumber);
    const idAt = (octet: number | undefined) => {
      const host = generateHomeLan(essid).hosts.find(({ ip }) => ip.endsWith(`.${octet}`));
      if (host === undefined) throw new Error(`no box at .${octet}`);
      return { essid, machine_id: machineIdForLanHost(host, essid) };
    };

    expect(await missionFilesForBox(idAt(frontBox?.octet), HOLDING_BOTH)).toEqual({
      data: missionFiles(frontOf(missionNumber), HOLDING_BOTH),
      error: null,
    });
    expect(await missionFilesForBox(idAt(keyBox.octet), HOLDING_BOTH)).toEqual({
      data: missionFiles(keyOf(missionNumber), HOLDING_BOTH),
      error: null,
    });
  });
});

describe('a contract that keeps its key encrypted', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  const sealedPathOf = (missionNumber: number): string => `${missionKeyPath(missionNumber)}.gpg`;
  const programPathOf = (missionNumber: number): string =>
    `/usr/local/bin/${missionShape(missionNumber).stem}-vault`;

  const fileAt = (missionNumber: number, path: string) =>
    missionFiles(keyOf(missionNumber), HOLDING_BOTH).find((laid) => laid.path === path);

  it('lays the key sealed beside where the plain key would be, root-only, and no plain key', () => {
    for (const missionNumber of numbersWithStorage('gpg').slice(0, 20)) {
      const laid = missionFiles(keyOf(missionNumber), HOLDING_BOTH);
      const sealed = fileAt(missionNumber, sealedPathOf(missionNumber));

      expect(sealed?.perms).toEqual(ROOT_FILE);
      expect(laid.map((file) => file.path)).not.toContain(missionKeyPath(missionNumber));
      expect(
        decryptContent(sealed?.content ?? '', missionPassphrase(missionNumber, KEY_SECRET)),
      ).toBe(`${missionKey(missionNumber, KEY_SECRET)}\n`);
    }
  });

  it('seals the key so that no other passphrase opens it', () => {
    const missionNumber = firstWithStorage('gpg');
    const sealed = fileAt(missionNumber, sealedPathOf(missionNumber));

    expect(
      decryptContent(sealed?.content ?? '', missionPassphrase(missionNumber + 1, KEY_SECRET)),
    ).toBe(null);
  });

  it('lays a program named after the client, every tier may read and run it, only root change it', () => {
    for (const missionNumber of numbersWithStorage('gpg').slice(0, 20)) {
      const name = `${missionShape(missionNumber).stem}-vault`;
      const program = fileAt(missionNumber, programPathOf(missionNumber));

      expect(program?.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
      expect(program?.content.startsWith(binaryStub(name))).toBe(true);
      // A root's edit of it is stored in a TEXT column, which refuses the NUL byte.
      expect(program?.content.includes(String.fromCharCode(0))).toBe(false);
    }
  });

  it('lays the sealed key and the program, and nothing else', () => {
    const missionNumber = firstWithRoute('hydra', 'gpg');

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([
      sealedPathOf(missionNumber),
      programPathOf(missionNumber),
      '/root/.bash_history',
    ]);
    expect(missionFiles(keyOf(missionNumber), HOLDING_BOTH).map((file) => file.path)).toEqual(
      missionFilePaths(keyOf(missionNumber)),
    );
  });

  it('leaves root a history of sealing the key and removing the plain one, for root alone', () => {
    // The key path is the server's, never the bundle's, so the history naming it is laid in
    // here rather than generated with the box.
    for (const missionNumber of numbersWithStorage('gpg').slice(0, 20)) {
      const history = fileAt(missionNumber, '/root/.bash_history');
      const keyPath = missionKeyPath(missionNumber);

      expect(history).toEqual({
        path: '/root/.bash_history',
        content: `${missionShape(missionNumber).stem}-vault --seal ${keyPath}\nrm ${keyPath}\n`,
        perms: ROOT_FILE,
      });
    }
  });

  it('lays the leak beside them on a leak route', () => {
    const missionNumber = firstWithRoute('web', 'gpg');

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([
      sealedPathOf(missionNumber),
      programPathOf(missionNumber),
      '/root/.bash_history',
      missionLeakPath(keyOf(missionNumber)),
    ]);
    expect(missionFiles(keyOf(missionNumber), HOLDING_BOTH).map((file) => file.path)).toEqual(
      missionFilePaths(keyOf(missionNumber)),
    );
  });

  it('fails closed when the key secret is missing', () => {
    expect(() =>
      missionFiles(keyOf(firstWithStorage('gpg')), {
        keySecret: undefined,
        rawSecrets: RAW_SECRETS,
      }),
    ).toThrow(MissionSecretMissingError);
  });

  describe('on the box, as root', () => {
    const laidTree = async (missionNumber: number): Promise<Directory> => {
      const tree = await withMissionFiles(
        async () => ({ data: missionFiles(keyOf(missionNumber), HOLDING_BOTH), error: null }),
        {
          essid: missionEssid(missionNumber),
          machineId: 'key-box',
          baseFs: buildMissionKeyBoxFs(missionNumber),
        },
      );
      if (tree === null) throw new Error('the files could not be made');
      return tree;
    };

    const asRoot = (tree: Directory) =>
      mockCommandEnv({ fs: createFsView(tree, { userType: 'root', cwd: asAbsPath('/') }) });

    const textOf = (result: CommandResult): readonly string[] =>
      result.kind === 'sync'
        ? result.lines.filter((line) => line.kind === 'text').map((line) => line.content)
        : [];

    const NO_FLAGS = new Map<string, string | true>();

    it('gives the passphrase up to strings on a line of its own, beside a usage line', async () => {
      const missionNumber = firstWithStorage('gpg');
      const tree = await laidTree(missionNumber);

      const lines = textOf(
        await strings.execute(asRoot(tree), [programPathOf(missionNumber)], NO_FLAGS),
      );

      expect(lines).toContain(missionPassphrase(missionNumber, KEY_SECRET));
      expect(lines.some((line) => line.includes('--seal') && line.includes('--open'))).toBe(true);
    });

    it('reads to strings as a small program would, the passphrase one line among its others', async () => {
      const missionNumber = firstWithStorage('gpg');
      const name = `${missionShape(missionNumber).stem}-vault`;
      const tree = await laidTree(missionNumber);

      const lines = textOf(
        await strings.execute(asRoot(tree), [programPathOf(missionNumber)], NO_FLAGS),
      );

      expect(lines).toEqual([
        '/lib64/ld-linux-x86-64.so.2',
        'GLIBC_2.2.5',
        name,
        `usage: ${name} --seal <file> | --open <file.gpg>`,
        'sealed %s -> %s.gpg',
        'bad passphrase',
        missionPassphrase(missionNumber, KEY_SECRET),
        'GCC: (Debian 12.2.0-14) 12.2.0',
      ]);
    });

    it('keeps the passphrase from a grep over the whole box', async () => {
      const missionNumber = firstWithStorage('gpg');
      const tree = await laidTree(missionNumber);

      const lines = textOf(
        await grep.execute(
          asRoot(tree),
          [missionPassphrase(missionNumber, KEY_SECRET), '/'],
          NO_FLAGS,
        ),
      );

      expect(lines).toEqual([]);
    });

    it('opens the sealed key with gpg -d and the passphrase', async () => {
      const missionNumber = firstWithStorage('gpg');
      const tree = await laidTree(missionNumber);

      const lines = textOf(
        await gpg.execute(
          asRoot(tree),
          [sealedPathOf(missionNumber), missionPassphrase(missionNumber, KEY_SECRET)],
          new Map<string, string | true>([['-d', true]]),
        ),
      );

      expect(lines).toEqual([missionKey(missionNumber, KEY_SECRET)]);
    });
  });
});

describe('a contract that keeps its key in its database', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  const laidDatabase = (missionNumber: number) =>
    parseMysqlDatabase(
      missionFiles(keyOf(missionNumber), HOLDING_BOTH).find((laid) => laid.path === DATADIR_PATH)
        ?.content ?? '',
    );

  it('lays no key file, only the datadir, as root-only as the one it replaces', () => {
    // Off the database route nothing else is laid, so the pools are never needed.
    const missionNumber = firstWithRoute('hydra', 'database');

    expect(
      missionFiles(keyOf(missionNumber), { keySecret: KEY_SECRET, rawSecrets: undefined }).map(
        ({ path, perms }) => ({ path, perms }),
      ),
    ).toEqual([{ path: DATADIR_PATH, perms: DATADIR_FILE }]);
  });

  it('keeps the key in an api_keys row, among keys to other services', () => {
    for (const missionNumber of numbersWithStorage('database').slice(0, 20)) {
      const table = laidDatabase(missionNumber)?.tables['api_keys'];
      const [stripe, sendgrid, portal, mapbox] = table?.rows ?? [];

      expect(table?.columns).toEqual([
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'service', type: 'VARCHAR', nullable: false },
        { name: 'api_key', type: 'VARCHAR', nullable: false },
      ]);
      expect(table?.rows.map((row) => [row['id'], row['service']])).toEqual([
        [1, 'stripe'],
        [2, 'sendgrid'],
        [3, 'portal'],
        [4, 'mapbox'],
      ]);
      expect(portal?.['api_key']).toBe(missionKey(missionNumber, KEY_SECRET));
      expect(String(stripe?.['api_key'])).toMatch(/^sk_live_[0-9a-f]{24}$/);
      expect(String(sendgrid?.['api_key'])).toMatch(/^SG\.[0-9a-f]{22}$/);
      expect(String(mapbox?.['api_key'])).toMatch(/^pk\.[0-9a-f]{32}$/);
    }
  });

  it('draws the other services keys per contract, so no two databases read alike', () => {
    const [first, second] = numbersWithStorage('database');
    if (first === undefined || second === undefined) throw new Error('two database contracts');
    const decoysOf = (missionNumber: number) =>
      (laidDatabase(missionNumber)?.tables['api_keys']?.rows ?? [])
        .filter((row) => row['service'] !== 'portal')
        .map((row) => row['api_key']);

    for (const [index, decoy] of decoysOf(first).entries()) {
      expect(decoy).not.toBe(decoysOf(second)[index]);
    }
    expect(decoysOf(first)).toEqual(decoysOf(first));
  });

  it('adds only api_keys to the database the box generates, off the database route', () => {
    const missionNumber = firstWithRoute('snmp', 'database');
    const laid = laidDatabase(missionNumber);
    const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
    const { api_keys: _apiKeys, ...others } = laid?.tables ?? {};

    expect(laid?.name).toBe(generated?.name);
    expect(laid?.credentials).toEqual(generated?.credentials);
    expect(others).toEqual(generated?.tables);
  });

  it('adds the key beside the word in the one datadir on the database route', () => {
    const missionNumber = firstWithRoute('mysql', 'database');
    const laid = laidDatabase(missionNumber);
    const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
    const { api_keys: _apiKeys, settings, ...others } = laid?.tables ?? {};
    const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([DATADIR_PATH]);
    expect(
      missionFiles(keyOf(missionNumber), HOLDING_BOTH).map((laidFile) => laidFile.path),
    ).toEqual([DATADIR_PATH]);
    expect(laid?.tables['api_keys']?.rows[2]?.['api_key']).toBe(
      missionKey(missionNumber, KEY_SECRET),
    );
    expect(settings?.rows[2]?.['value'] === word).toBe(true);
    expect(others).toEqual(generated?.tables);
  });

  it('keeps the key out of the datadir on the database route when it is kept in a file', () => {
    const missionNumber = firstWithRoute('mysql', 'file');

    expect(Object.keys(laidDatabase(missionNumber)?.tables ?? {})).toContain('settings');
    expect(Object.keys(laidDatabase(missionNumber)?.tables ?? {})).not.toContain('api_keys');
  });

  it('lays the datadir after the leak on a leak route with a file of its own', () => {
    const missionNumber = firstWithRoute('web', 'database');

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([
      missionLeakPath(keyOf(missionNumber)),
      DATADIR_PATH,
    ]);
  });

  it('fails closed when the key secret is missing', () => {
    expect(() =>
      missionFiles(keyOf(firstWithRoute('hydra', 'database')), {
        keySecret: undefined,
        rawSecrets: RAW_SECRETS,
      }),
    ).toThrow(MissionSecretMissingError);
  });

  it.each(['mysql', 'hydra'] as const)(
    'gives the key to the application account at the prompt on a %s route',
    (route) => {
      // The login a sweep finds is an ordinary account, not the database root, and it reads
      // every table: that is the whole way to the key from outside.
      const missionNumber = firstWithRoute(route, 'database');
      const database = laidDatabase(missionNumber);
      if (database === null) throw new Error('the datadir could not be read');
      const application = database.credentials.find(({ userType }) => userType !== 'root');

      const { output, failed } = runStatement({
        database,
        line: "SELECT api_key FROM api_keys WHERE service = 'portal'",
        username: application?.username ?? '',
        userType: application?.userType ?? 'guest',
        sourceIp: '198.51.100.7',
      });

      expect(application?.userType).toBe('user');
      expect(failed).toBe(false);
      expect(output.some((line) => line.includes(missionKey(missionNumber, KEY_SECRET)))).toBe(
        true,
      );
    },
  );

  it('fails closed on the database route when the pools are missing', () => {
    expect(() =>
      missionFiles(keyOf(firstWithRoute('mysql', 'database')), {
        keySecret: KEY_SECRET,
        rawSecrets: undefined,
      }),
    ).toThrow(MissionLeakUnavailableError);
  });
});

describe('who can read what the server lays onto a key box', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  /** The key box as a door sees it, with the number's files laid on. */
  const laidBox = async (missionNumber: number) => {
    const tree = await withMissionFiles(
      async () => ({ data: missionFiles(keyOf(missionNumber), HOLDING_BOTH), error: null }),
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

    expect(readableBy(tree, 'guest', missionLeakPath(keyOf(missionNumber)) ?? '')).toBe(true);
    expect(readableBy(tree, 'guest', missionKeyPath(missionNumber))).toBe(false);
    expect(readableBy(tree, 'root', missionKeyPath(missionNumber))).toBe(true);
  });

  it('keeps the file root-only on a web route, where the web door serves it instead', async () => {
    const missionNumber = firstWithRoute('web');
    const tree = await laidBox(missionNumber);

    expect(readableBy(tree, 'guest', missionLeakPath(keyOf(missionNumber)) ?? '')).toBe(false);
    expect(readableBy(tree, 'root', missionLeakPath(keyOf(missionNumber)) ?? '')).toBe(true);
  });

  it('keeps the datadir from a guest on a database route, and opens it to root', async () => {
    const missionNumber = firstWithRoute('mysql');
    const tree = await laidBox(missionNumber);

    expect(readableBy(tree, 'guest', DATADIR_PATH)).toBe(false);
    expect(readableBy(tree, 'root', DATADIR_PATH)).toBe(true);
  });

  it('lets a guest read the agent config on an snmp route, and not the community hash', async () => {
    const tree = await laidBox(firstWithRoute('snmp'));

    expect(readableBy(tree, 'guest', SNMPD_CONF_PATH)).toBe(true);
    expect(readableBy(tree, 'guest', '/var/lib/snmp/snmpd.conf')).toBe(false);
    expect(readableBy(tree, 'root', '/var/lib/snmp/snmpd.conf')).toBe(true);
  });

  it('lets only root change the file in pub', () => {
    const leak = missionLeakFile(keyOf(firstWithRoute('ftp')), RAW_SECRETS);

    expect(leak?.perms.write).toEqual(['root']);
    expect(leak?.perms.execute).toEqual([]);
  });
});

describe("a sabotage job's target", () => {
  const NO_SECRETS = { keySecret: undefined, rawSecrets: undefined };

  /** The first sabotage job in the sample whose target falls to `route`. */
  const firstSabotageWithRoute = (route: MissionRoute): number => {
    const [found] = SAMPLE_NUMBERS.filter((missionNumber) => {
      const shape = missionShape(missionNumber);
      return shape.kind === 'sabotage' && shape.keyBox.route === route;
    });
    if (found === undefined) throw new Error(`no sabotage ${route} contract in the sample`);
    return found;
  };

  it('lays nothing off a leak route, and needs no secret: there is no key and no records', () => {
    for (const route of ['hydra', 'msfconsole'] as const) {
      const missionNumber = firstSabotageWithRoute(route);

      expect(
        missionFiles(keyOf(missionNumber), NO_SECRETS),
        `${route} contract ${missionNumber}`,
      ).toEqual([]);
      expect(missionFilePaths(keyOf(missionNumber)), `${route} contract ${missionNumber}`).toEqual(
        [],
      );
    }
  });

  it('lays a leak route only its own leak', () => {
    for (const route of ['web', 'ftp'] as const) {
      const missionNumber = firstSabotageWithRoute(route);

      expect(missionFilePaths(keyOf(missionNumber)), `${route} contract ${missionNumber}`).toEqual([
        missionLeakPath(keyOf(missionNumber)),
      ]);
    }
  });

  it('keeps only the word beside what the box generates in the datadir on the database route', () => {
    const missionNumber = firstSabotageWithRoute('mysql');
    const laid = parseMysqlDatabase(
      // The word comes from the leak secrets; no key secret is needed, as there is no key.
      missionFiles(keyOf(missionNumber), { keySecret: undefined, rawSecrets: RAW_SECRETS }).find(
        ({ path }) => path === DATADIR_PATH,
      )?.content ?? '',
    );
    const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
    const { settings, ...others } = laid?.tables ?? {};

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([DATADIR_PATH]);
    expect(settings).toBeDefined();
    expect(others).toEqual(generated?.tables);
  });

  it('lays the same on every machine a client wants down: what its route lays, and no more', () => {
    // A backup server holds no backups and a CCTV recorder no footage: filler on one kind of
    // box alone would tell a contractor which box the job is on.
    const sabotage = SAMPLE_NUMBERS.filter(
      (missionNumber) => missionShape(missionNumber).kind === 'sabotage',
    );
    const machineOf = (missionNumber: number): string =>
      missionTerms(missionNumber).kind.replace(/^take down (a|an internal) /, '');
    /** Where a box's lay-in goes, with the box-specific leak named for what it is. */
    const laidOn = (missionNumber: number): readonly string[] =>
      missionFilePaths(keyOf(missionNumber)).map((path) =>
        path === missionLeakPath(keyOf(missionNumber)) ? 'the leak' : path,
      );
    const laidByRoute = new Map<MissionRoute, string>();

    expect(new Set(sabotage.map(machineOf)).size).toBe(7);
    for (const missionNumber of sabotage) {
      const { route } = missionShape(missionNumber).keyBox;
      const laid = JSON.stringify(laidOn(missionNumber));
      const label = `${machineOf(missionNumber)} on ${route}, contract ${missionNumber}`;

      expect(laid, label).toBe(laidByRoute.get(route) ?? laid);
      laidByRoute.set(route, laid);
    }
  });
});

describe("a tamper job's records box", () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  const laidDatabase = (missionNumber: number) =>
    parseMysqlDatabase(
      missionFiles(keyOf(missionNumber), HOLDING_BOTH).find((laid) => laid.path === DATADIR_PATH)
        ?.content ?? '',
    );

  it('lays only the datadir, root-only, and needs no secret off the database route', () => {
    // There is no key to lay, so a deployment missing the key secret still opens the box.
    for (const route of ['hydra', 'msfconsole'] as const) {
      const missionNumber = firstTamperWithRoute(route);

      expect(
        missionFiles(keyOf(missionNumber), { keySecret: undefined, rawSecrets: undefined }).map(
          ({ path, perms }) => ({ path, perms }),
        ),
        `${route} contract ${missionNumber}`,
      ).toEqual([{ path: DATADIR_PATH, perms: DATADIR_FILE }]);
      expect(missionFilePaths(keyOf(missionNumber))).toEqual([DATADIR_PATH]);
    }
  });

  /** The datadir's tables split into the records' own, by name, and every other. */
  const recordsAndOthers = (missionNumber: number) => {
    const tables = laidDatabase(missionNumber)?.tables ?? {};
    const names = new Set(missionRecords(missionNumber).tables.map(({ name }) => name));
    return {
      records: Object.entries(tables)
        .filter(([name]) => names.has(name))
        .map(([name, table]) => ({ name, table })),
      others: Object.fromEntries(Object.entries(tables).filter(([name]) => !names.has(name))),
    };
  };

  it('adds the tables the number draws to the database the box generates, and no key', () => {
    for (const route of ['hydra', 'snmp', 'ftp'] as const) {
      const missionNumber = firstTamperWithRoute(route);
      const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
      const { records, others } = recordsAndOthers(missionNumber);

      expect(records, `${route} contract ${missionNumber}`).toEqual(
        missionRecords(missionNumber).tables,
      );
      expect(others, `${route} contract ${missionNumber}`).toEqual(generated?.tables);
      expect(laidDatabase(missionNumber)?.credentials).toEqual(generated?.credentials);
    }
  });

  it('holds the target table and both tables beside it, whatever the setting', () => {
    const settings = tamperNumbersWithRoute('hydra').map((missionNumber) => {
      expect(recordsAndOthers(missionNumber).records).toHaveLength(3);
      return missionSetting(missionNumber);
    });

    expect(new Set(settings).size).toBe(8);
  });

  it('keeps the grades beside the word in the one datadir on the database route', () => {
    const missionNumber = firstTamperWithRoute('mysql');
    const laid = laidDatabase(missionNumber);
    const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
    const { records, others } = recordsAndOthers(missionNumber);
    const { settings, ...generatedOthers } = others;
    const word = plaintextFor(missionShape(missionNumber).keyBox.rootHash);

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([DATADIR_PATH]);
    expect(records).toEqual(missionRecords(missionNumber).tables);
    expect(settings?.rows[2]?.['value'] === word).toBe(true);
    expect(generatedOthers).toEqual(generated?.tables);
    expect(laid?.name).toBe(generated?.name);
  });

  it('lays the datadir after the leak on a leak route with a file of its own', () => {
    const missionNumber = firstTamperWithRoute('web');

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([
      missionLeakPath(keyOf(missionNumber)),
      DATADIR_PATH,
    ]);
  });

  it('lets the application account read the grades and change one', () => {
    const missionNumber = tamperNumbersWithRoute('hydra').find(
      (candidate) =>
        missionAction(candidate) === 'change' && missionSetting(candidate) === 'school',
    );
    if (missionNumber === undefined) throw new Error('no hydra school change job in the sample');
    const database = laidDatabase(missionNumber);
    if (database === null) throw new Error('the datadir could not be read');
    const application = database.credentials.find(({ userType }) => userType !== 'root');
    const { target } = missionRecords(missionNumber);
    if (target.action !== 'change') throw new Error('the job asks for no change');
    const asApplication = {
      username: application?.username ?? '',
      userType: application?.userType ?? 'guest',
      sourceIp: '198.51.100.7',
    } as const;

    const changed = runStatement({
      ...asApplication,
      database,
      line: `UPDATE grades SET grade = '${target.to}' WHERE student = '${target.row['student']}' AND subject = '${target.row['subject']}'`,
    });
    const read = runStatement({
      ...asApplication,
      database: changed.database ?? database,
      line: `SELECT grade FROM grades WHERE id = '${target.row['id']}'`,
    });

    expect(changed.failed).toBe(false);
    expect(read.output.some((line) => line.includes(`| ${target.to} `))).toBe(true);
  });

  it('lays a two-hop front box only its own leak, never the records', () => {
    const [missionNumber] = SAMPLE_NUMBERS.filter((candidate) => {
      const shape = missionShape(candidate);
      return shape.kind === 'tamper' && shape.frontBox?.route === 'mysql';
    });
    if (missionNumber === undefined) throw new Error('no two-hop tamper contract fronted by mysql');

    const recordTables = missionRecords(missionNumber).tables.map(({ name }) => name);

    expect(
      Object.keys(laidFrontDatabase(missionNumber)?.tables ?? {}).filter((name) =>
        recordTables.includes(name),
      ),
    ).toEqual([]);
  });

  const laidFrontDatabase = (missionNumber: number) =>
    parseMysqlDatabase(
      missionFiles(frontOf(missionNumber), HOLDING_BOTH).find((laid) => laid.path === DATADIR_PATH)
        ?.content ?? '',
    );
});

describe("a tamper job's records kept in a file", () => {
  const NO_SECRETS = { keySecret: undefined, rawSecrets: undefined };

  /** Where a file job keeps a table: under the stem the boxes are named on, a file a table. */
  const csvPathOf = (missionNumber: number, table: string): string =>
    `/srv/${missionShape(missionNumber).stem}/records/${table}.csv`;

  /** A table as a CSV: a header naming the columns, then one line per row, in order. */
  const csvOf = (missionNumber: number, table: string): string => {
    const found = missionRecords(missionNumber).tables.find(({ name }) => name === table);
    const names = (found?.table.columns ?? []).map(({ name }) => name);
    const lines = (found?.table.rows ?? []).map((row) =>
      names.map((name) => `${row[name]}`).join(','),
    );
    return `${[names.join(','), ...lines].join('\n')}\n`;
  };

  /** Each of a contract's tables as the file it is laid in, the target's first. */
  const csvFilesOf = (missionNumber: number) =>
    missionRecords(missionNumber).tables.map(({ name }) => ({
      path: csvPathOf(missionNumber, name),
      content: csvOf(missionNumber, name),
      perms: ROOT_FILE,
    }));

  it('lays only the CSVs, a file a table, root-only, and needs no secret off the database route', () => {
    for (const route of ['hydra', 'msfconsole'] as const) {
      const missionNumber = firstTamperWithRoute(route, 'file');
      const files = csvFilesOf(missionNumber);

      expect(files).toHaveLength(3);
      expect(
        missionFiles(keyOf(missionNumber), NO_SECRETS),
        `${route} contract ${missionNumber}`,
      ).toEqual(files);
      expect(missionFilePaths(keyOf(missionNumber))).toEqual(files.map(({ path }) => path));
    }
  });

  it('lays the CSV after the leak on a leak route with a file of its own', () => {
    const missionNumber = firstTamperWithRoute('web', 'file');

    expect(missionFilePaths(keyOf(missionNumber))).toEqual([
      missionLeakPath(keyOf(missionNumber)),
      ...csvFilesOf(missionNumber).map(({ path }) => path),
    ]);
  });

  it("keeps no grades in the database route's datadir, only the word, and lays the CSV after it", () => {
    const missionNumber = firstTamperWithRoute('mysql', 'file');
    const laid = missionFiles(keyOf(missionNumber), {
      keySecret: KEY_SECRET,
      rawSecrets: RAW_SECRETS,
    });
    const database = parseMysqlDatabase(
      laid.find(({ path }) => path === DATADIR_PATH)?.content ?? '',
    );

    const recordTables = missionRecords(missionNumber).tables.map(({ name }) => name);

    expect(laid.map(({ path }) => path)).toEqual([
      DATADIR_PATH,
      ...csvFilesOf(missionNumber).map(({ path }) => path),
    ]);
    expect(
      Object.keys(database?.tables ?? {}).filter((name) => recordTables.includes(name)),
    ).toEqual([]);
    expect(Object.keys(database?.tables ?? {})).toContain('settings');
  });

  it('lets a root on the box read every CSV, and nobody else', async () => {
    const missionNumber = firstTamperWithRoute('hydra', 'file');
    const box = await withMissionFiles(
      async () => ({ data: missionFiles(keyOf(missionNumber), NO_SECRETS), error: null }),
      {
        essid: missionEssid(missionNumber),
        machineId: 'records-box',
        baseFs: buildMissionKeyBoxFs(missionNumber),
      },
    );
    if (box === null) throw new Error('the files could not be made');

    for (const { path, content } of csvFilesOf(missionNumber)) {
      expect(createFsView(box, { userType: 'root' }).read(asAbsPath(path))).toEqual({
        ok: true,
        content,
      });
      expect(createFsView(box, { userType: 'user' }).read(asAbsPath(path)).ok).toBe(false);
      expect(createFsView(box, { userType: 'guest' }).read(asAbsPath(path)).ok).toBe(false);
    }
  });
});
