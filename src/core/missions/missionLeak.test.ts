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
import {
  missionKey,
  missionKeyPath,
  missionPassphrase,
  MissionSecretMissingError,
} from './missionSecret.js';
import { missionShape, type MissionRoute, type MissionStorage } from './missionShape.js';
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
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { withMissionFiles } from '../network/missionBoxFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { DATADIR_FILE, ROOT_FILE } from '../generation/baseFs.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { parseSnmpdConf, SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS } from '../snmp/conf.js';
import { parseMysqlDatabase } from '../mysql/types.js';
import { runStatement } from '../mysql/statements.js';
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

/** Contracts on this route that keep the key as `storage` says: a plain file unless told
 *  otherwise, which is what every route's own tests are about. */
const numbersWithRoute = (
  route: MissionRoute,
  storage: MissionStorage = 'file',
): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.route === route && shape.storage === storage;
  });

const numbersWithStorage = (storage: MissionStorage): readonly number[] =>
  SAMPLE_NUMBERS.filter((missionNumber) => missionShape(missionNumber).storage === storage);

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

  it('is the datadir on a database route, as root-only as the one it replaces', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const leak = missionLeakFile(missionNumber, RAW_SECRETS);

      expect(missionLeakPath(missionNumber)).toBe(DATADIR_PATH);
      expect(leak?.path).toBe(DATADIR_PATH);
      expect(leak?.perms).toEqual(DATADIR_FILE);
    }
  });

  it('adds only the settings table to the database the box generates', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const laid = parseMysqlDatabase(missionLeakFile(missionNumber, RAW_SECRETS)?.content ?? '');
      const generated = databaseIn(buildMissionKeyBoxFs(missionNumber));
      const { settings: _settings, ...others } = laid?.tables ?? {};

      expect(laid?.name, `name of ${missionNumber}`).toBe(generated?.name);
      expect(laid?.credentials, `accounts of ${missionNumber}`).toEqual(generated?.credentials);
      expect(others, `tables of ${missionNumber}`).toEqual(generated?.tables);
    }
  });

  it('holds the word of the box root in a settings row, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('mysql')) {
      const word = plaintextFor(missionShape(missionNumber).keyBoxRootHash);
      const laid = parseMysqlDatabase(missionLeakFile(missionNumber, RAW_SECRETS)?.content ?? '');
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

    expect(missionLeakFile(missionNumber, RAW_SECRETS)).toEqual(
      missionLeakFile(missionNumber, RAW_SECRETS),
    );
  });

  it('is the agent config on an snmp route, readable by any tier and written by root', () => {
    for (const missionNumber of numbersWithRoute('snmp')) {
      const leak = missionLeakFile(missionNumber, RAW_SECRETS);

      expect(missionLeakPath(missionNumber)).toBe(SNMPD_CONF_PATH);
      expect(leak?.path).toBe(SNMPD_CONF_PATH);
      expect(leak?.perms).toEqual(SNMPD_CONF_PERMISSIONS);
    }
  });

  it('holds the word of the box root as the contact, and never names the account', () => {
    for (const missionNumber of numbersWithRoute('snmp')) {
      const word = plaintextFor(missionShape(missionNumber).keyBoxRootHash);
      const content = missionLeakFile(missionNumber, RAW_SECRETS)?.content ?? '';

      expect(parseSnmpdConf(content).sysContact.includes(word), `${missionNumber}`).toBe(true);
      expect(/root/i.test(content), `${missionNumber}`).toBe(false);
    }
  });

  it('reads as a config: a header, its two directives and a closing newline', () => {
    const lines = (missionLeakFile(firstWithRoute('snmp'), RAW_SECRETS)?.content ?? '').split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('# /etc/snmp/snmpd.conf — SNMP agent configuration');
    expect(lines[3]).toBe('');
  });

  it.each(['web', 'ftp'] as const)('keeps the agent config off a %s route', (route) => {
    for (const missionNumber of numbersWithRoute(route)) {
      const content = missionLeakFile(missionNumber, RAW_SECRETS)?.content ?? '';

      expect(parseSnmpdConf(content).roCommunity, `${missionNumber}`).toBeNull();
    }
  });

  it('answers to monitor or netops and never to public, so a default walk gets silence', () => {
    const communities = numbersWithRoute('snmp').map(
      (missionNumber) =>
        parseSnmpdConf(missionLeakFile(missionNumber, RAW_SECRETS)?.content ?? '').roCommunity,
    );

    expect([...new Set(communities)].sort()).toEqual(['monitor', 'netops']);
  });

  it('is the same config for the same number', () => {
    const missionNumber = firstWithRoute('snmp');

    expect(missionLeakFile(missionNumber, RAW_SECRETS)).toEqual(
      missionLeakFile(missionNumber, RAW_SECRETS),
    );
  });

  it('refuses the config when the deployment holds no pools', () => {
    expect(() => missionLeakFile(firstWithRoute('snmp'), undefined)).toThrow(
      MissionLeakUnavailableError,
    );
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

  it.each(['web', 'ftp', 'mysql'] as const)(
    'fails closed on a %s route when the pools are missing',
    (route) => {
      expect(() =>
        missionFiles(firstWithRoute(route), { keySecret: KEY_SECRET, rawSecrets: undefined }),
      ).toThrow(MissionLeakUnavailableError);
    },
  );

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
    for (const route of ['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp'] as const) {
      for (const storage of ['file', 'gpg', 'database'] as const) {
        const missionNumber = firstWithRoute(route, storage);
        const laid = missionFiles(missionNumber, {
          keySecret: KEY_SECRET,
          rawSecrets: RAW_SECRETS,
        });

        expect(missionFilePaths(missionNumber), `${route} ${storage}`).toEqual(
          laid.map((file) => file.path),
        );
      }
    }
  });

  it('lays nothing in for a decoy, which is the real door as the box generates', () => {
    // A decoy's agent config is the generated box's, so a root's edit of it is the box's own
    // write and never one the server would lay over.
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { route, decoys } = missionShape(missionNumber);
      if (route === 'snmp' || !decoys.includes('snmp')) continue;

      expect(missionFilePaths(missionNumber), `${route} ${missionNumber}`).not.toContain(
        SNMPD_CONF_PATH,
      );
    }
  });
});

describe('a contract that keeps its key encrypted', () => {
  const HOLDING_BOTH = { keySecret: KEY_SECRET, rawSecrets: RAW_SECRETS };

  const sealedPathOf = (missionNumber: number): string => `${missionKeyPath(missionNumber)}.gpg`;
  const programPathOf = (missionNumber: number): string =>
    `/usr/local/bin/${missionShape(missionNumber).stem}-vault`;

  const fileAt = (missionNumber: number, path: string) =>
    missionFiles(missionNumber, HOLDING_BOTH).find((laid) => laid.path === path);

  it('lays the key sealed beside where the plain key would be, root-only, and no plain key', () => {
    for (const missionNumber of numbersWithStorage('gpg').slice(0, 20)) {
      const laid = missionFiles(missionNumber, HOLDING_BOTH);
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

    expect(missionFilePaths(missionNumber)).toEqual([
      sealedPathOf(missionNumber),
      programPathOf(missionNumber),
      '/root/.bash_history',
    ]);
    expect(missionFiles(missionNumber, HOLDING_BOTH).map((file) => file.path)).toEqual(
      missionFilePaths(missionNumber),
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

    expect(missionFilePaths(missionNumber)).toEqual([
      sealedPathOf(missionNumber),
      programPathOf(missionNumber),
      '/root/.bash_history',
      missionLeakPath(missionNumber),
    ]);
    expect(missionFiles(missionNumber, HOLDING_BOTH).map((file) => file.path)).toEqual(
      missionFilePaths(missionNumber),
    );
  });

  it('fails closed when the key secret is missing', () => {
    expect(() =>
      missionFiles(firstWithStorage('gpg'), { keySecret: undefined, rawSecrets: RAW_SECRETS }),
    ).toThrow(MissionSecretMissingError);
  });

  describe('on the box, as root', () => {
    const laidTree = async (missionNumber: number): Promise<Directory> => {
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
      missionFiles(missionNumber, HOLDING_BOTH).find((laid) => laid.path === DATADIR_PATH)
        ?.content ?? '',
    );

  it('lays no key file, only the datadir, as root-only as the one it replaces', () => {
    // Off the database route nothing else is laid, so the pools are never needed.
    const missionNumber = firstWithRoute('hydra', 'database');

    expect(
      missionFiles(missionNumber, { keySecret: KEY_SECRET, rawSecrets: undefined }).map(
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
    const word = plaintextFor(missionShape(missionNumber).keyBoxRootHash);

    expect(missionFilePaths(missionNumber)).toEqual([DATADIR_PATH]);
    expect(missionFiles(missionNumber, HOLDING_BOTH).map((laidFile) => laidFile.path)).toEqual([
      DATADIR_PATH,
    ]);
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

    expect(missionFilePaths(missionNumber)).toEqual([missionLeakPath(missionNumber), DATADIR_PATH]);
  });

  it('fails closed when the key secret is missing', () => {
    expect(() =>
      missionFiles(firstWithRoute('hydra', 'database'), {
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
      missionFiles(firstWithRoute('mysql', 'database'), {
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
    const leak = missionLeakFile(firstWithRoute('ftp'), RAW_SECRETS);

    expect(leak?.perms.write).toEqual(['root']);
    expect(leak?.perms.execute).toEqual([]);
  });
});
