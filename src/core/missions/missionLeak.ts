/**
 * The files the server lays onto a contract's key box: the key, and on a leak route the
 * forgotten file holding `root`'s password. Imported from `api/` and `scripts/` alone. The
 * bundle holds the uncrackable pool as hashes, and the words behind them reach a door only
 * through this module, read from the same `JSHACK_SECRETS` the build encodes them from, so
 * the words a deployment hands out cannot drift from the hashes it ships.
 *
 * Only the leakable slice can come out. A hash outside it is refused however it got here,
 * so no bug in a caller can turn this into a lookup for the words meant to stay shut.
 *
 * A file gives away a word and never whose it is: the player works out that it is a login
 * and which account's, by hand or by adding it to `passwords.txt` for `hydra`.
 *
 * The key is root-only on every route. So is the web route's file: a page on a generated box
 * is otherwise readable by a guest, and the web door reads as the server, inside the document
 * root, so root-only stops nothing it serves. The ftp route's file is readable by a guest,
 * because the anonymous login that fetches it is one.
 *
 * On a database route the file is the whole datadir, the generated database with a `settings`
 * table added. It stays root-only like any datadir, because the door reads it as the server and
 * hands out only the rows an account may select.
 *
 * On an snmp route the file is the agent's config, readable by any tier like every such config.
 * It holds the read-only community as well as the word, so neither reaches the bundle.
 *
 * Where the key sits follows the contract's storage. On `file` it is the plain key. On `gpg`
 * it is sealed, root-only, beside where the plain key would be, and the passphrase is compiled
 * into a program in `/usr/local/bin`: binary-looking, so `grep` skips it and only `strings`
 * reads it, and readable by any tier like any program, which costs nothing while the sealed
 * key stays root-only. On `database` no key file is laid: the key is a row of an `api_keys` table
 * in the datadir, read from outside by the application account a sweep finds. The datadir is
 * laid once with every table the contract adds, so on the database route it holds both.
 */

import { DATADIR_FILE, FTP_PUBLIC_FILE, ROOT_FILE } from '../generation/baseFs.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { missionKeyBoxNumber } from '../generation/lanHostIdentity.js';
import { md5 } from '../generation/md5.js';
import { createPrng } from '../generation/prng.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import type { MysqlTable } from '../mysql/types.js';
import { WEB_ROOT } from '../network/http.js';
import { parseSecrets } from '../secrets/parseSecrets.js';
import { ANONYMOUS_FTP_ROOT } from '../sessions/doorAdmission.js';
import { SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS } from '../snmp/conf.js';
import type { FilePermissions } from '../filesystem/types.js';
import { encryptContent } from '../crypto/gpgCodec.js';
import { binaryStub } from '../generation/binaries.js';
import { LEAKABLE_HASHES } from './leakablePool.js';
import {
  missionKey,
  missionKeyPath,
  missionPassphrase,
  requireMissionSecret,
} from './missionSecret.js';
import { missionShape, type MissionRoute } from './missionShape.js';
import { GUESSABLE_COMMUNITIES } from './pools.js';

/** A file the server lays onto a key box before its journal replays. */
export type MissionFile = {
  readonly path: string;
  readonly content: string;
  readonly perms: FilePermissions;
};

/** Thrown when a door asks for a word this deployment cannot or may not give. The handler
 *  turns it into a 500, as it does a missing key secret: there is no default word. */
export class MissionLeakUnavailableError extends Error {
  constructor() {
    super('mission leak unavailable');
    this.name = 'MissionLeakUnavailableError';
  }
}

/** The word behind a leakable hash, or a thrown `MissionLeakUnavailableError` when the hash
 *  is outside the slice, the deployment holds no valid pools, or those pools no longer hold
 *  the word. The caller reads the raw value from `process.env` at the server boundary. */
export const leakedWord = (hash: string, rawSecrets: string | undefined): string => {
  if (!LEAKABLE_HASHES.includes(hash)) throw new MissionLeakUnavailableError();
  const parsed = parseSecrets(rawSecrets);
  if (!parsed.ok) throw new MissionLeakUnavailableError();
  const word = parsed.secrets.UNCRACKABLE_PASSWORDS.find((candidate) => md5(candidate) === hash);
  if (word === undefined) throw new MissionLeakUnavailableError();
  return word;
};

/** Each name is one a default `gobuster` tries, since on the web route being on that list is
 *  the whole gate. Its wording is tied to the name, so what a file says reads like what it is
 *  called. */
const FORGOTTEN_FILES: readonly {
  readonly name: string;
  readonly render: (word: string) => string;
}[] = [
  { name: '.env', render: (word) => `APP_ENV=production\nAPP_DEBUG=false\nADMIN_PASS=${word}\n` },
  { name: 'config.php', render: (word) => `<?php\n$admin_pass = '${word}';\n` },
  { name: 'settings', render: (word) => `site_mode: live\nadmin_password: ${word}\n` },
  { name: 'notes.txt', render: (word) => `the server password is still ${word}, change it!\n` },
  {
    name: 'todo.txt',
    render: (word) => `- renew the certificate\n- change the password, still ${word}\n`,
  },
  { name: 'readme.txt', render: (word) => `Server handover\nlogin password: ${word}\n` },
  { name: 'backup', render: (word) => `# saved before the migration\nadmin pass: ${word}\n` },
  { name: 'old', render: (word) => `old server password, should still work: ${word}\n` },
  {
    name: 'dump.sql',
    render: (word) => `INSERT INTO settings (name, value) VALUES ('admin_pass', '${word}');\n`,
  },
];

/** A plain `ls` hides a dotfile, so `pub/` would look empty with one in it. */
const forgottenFileOf = (missionNumber: number): (typeof FORGOTTEN_FILES)[number] =>
  createPrng(`mission-leak-${missionNumber}`).pick(
    missionShape(missionNumber).keyBox.route === 'ftp'
      ? FORGOTTEN_FILES.filter(({ name }) => !name.startsWith('.'))
      : FORGOTTEN_FILES,
  );

/** The directory a leak route's file sits in, and who may read it there. */
const LEAK_HOMES: Readonly<
  Partial<Record<MissionRoute, { readonly directory: string; readonly perms: FilePermissions }>>
> = {
  web: { directory: WEB_ROOT, perms: ROOT_FILE },
  ftp: { directory: `${ANONYMOUS_FTP_ROOT}/pub`, perms: FTP_PUBLIC_FILE },
};

const leakPlaceOf = (
  missionNumber: number,
): { readonly path: string; readonly perms: FilePermissions } | null => {
  const { route } = missionShape(missionNumber).keyBox;
  if (route === 'mysql') return { path: DATADIR_PATH, perms: DATADIR_FILE };
  if (route === 'snmp') return { path: SNMPD_CONF_PATH, perms: SNMPD_CONF_PERMISSIONS };
  const home = LEAK_HOMES[route];
  return home === undefined
    ? null
    : { path: `${home.directory}/${forgottenFileOf(missionNumber).name}`, perms: home.perms };
};

/** The table a word sits in on a database route. Its rows are fixed, and read as what they are:
 *  a word somebody kept beside the other settings. */
const settingsTable = (word: string): MysqlTable => ({
  columns: [
    { name: 'name', type: 'VARCHAR', nullable: false, key: 'PRI' },
    { name: 'value', type: 'VARCHAR', nullable: false },
  ],
  rows: [
    { name: 'site_mode', value: 'live' },
    { name: 'maintenance', value: '0' },
    { name: 'admin_pass', value: word },
  ],
});

/** The datadir with the tables added, which is the whole file: a laid file replaces the box's
 *  and never merges into it. */
const databaseWith = (
  missionNumber: number,
  tables: Readonly<Record<string, MysqlTable>>,
): string => {
  const database = databaseIn(buildMissionKeyBoxFs(missionNumber));
  if (database === null) throw new MissionLeakUnavailableError();
  return JSON.stringify({ ...database, tables: { ...database.tables, ...tables } });
};

/** A key to another service, as the client's application would hold one: the service's own
 *  prefix on a token drawn from the number, so no two contracts' tables read alike. */
const otherServiceKey = (missionNumber: number, prefix: string, length: number): string =>
  `${prefix}${md5(`${prefix}${missionNumber}`).slice(0, length)}`;

/** The table the key sits in on a contract keeping it in its database, among the keys the
 *  client's application holds to other services, none of them in the key's shape. */
const apiKeysTable = (missionNumber: number, key: string): MysqlTable => ({
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'service', type: 'VARCHAR', nullable: false },
    { name: 'api_key', type: 'VARCHAR', nullable: false },
  ],
  rows: [
    { id: 1, service: 'stripe', api_key: otherServiceKey(missionNumber, 'sk_live_', 24) },
    { id: 2, service: 'sendgrid', api_key: otherServiceKey(missionNumber, 'SG.', 22) },
    { id: 3, service: 'portal', api_key: key },
    { id: 4, service: 'mapbox', api_key: otherServiceKey(missionNumber, 'pk.', 32) },
  ],
});

/** The agent's whole config. The word is its contact, which a walk prints at either tier. */
const agentConfig = (missionNumber: number, word: string): string =>
  [
    '# /etc/snmp/snmpd.conf — SNMP agent configuration',
    `rocommunity ${createPrng(`mission-leak-${missionNumber}`).pick(GUESSABLE_COMMUNITIES)}`,
    `syscontact helpdesk: the server password is still ${word}, change it!`,
    '',
  ].join('\n');

/** What the file holds on this route, given the word. */
const leakContent = (missionNumber: number, word: string): string => {
  const { route } = missionShape(missionNumber).keyBox;
  if (route === 'mysql') return databaseWith(missionNumber, { settings: settingsTable(word) });
  if (route === 'snmp') return agentConfig(missionNumber, word);
  return forgottenFileOf(missionNumber).render(word);
};

/** Where the forgotten file sits, drawn from the number, or null on a route with no leak.
 *  The path alone needs no secret, so the write gate can ask for it. */
export const missionLeakPath = (missionNumber: number): string | null =>
  leakPlaceOf(missionNumber)?.path ?? null;

/** The word this contract's forgotten file gives away, which is its key box's root. */
export const missionLeakWord = (missionNumber: number, rawSecrets: string | undefined): string =>
  leakedWord(missionShape(missionNumber).keyBox.rootHash, rawSecrets);

/** The forgotten file itself, or null on a route with no leak. */
export const missionLeakFile = (
  missionNumber: number,
  rawSecrets: string | undefined,
): MissionFile | null => {
  const place = leakPlaceOf(missionNumber);
  if (place === null) return null;
  return { ...place, content: leakContent(missionNumber, missionLeakWord(missionNumber, rawSecrets)) };
};

/** A program on the box, as every program is: any tier reads and runs it, only root changes it. */
const PROGRAM_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

/** Ends one readable run inside the program and starts the next, as the padding between a real
 *  binary's strings does. Not NUL: a root's edit of the file goes to a TEXT column. */
const RUN_BREAK = String.fromCharCode(1);

const sealedKeyPath = (missionNumber: number): string => `${missionKeyPath(missionNumber)}.gpg`;

/** The file the key is in: the sealed one on a gpg contract, the datadir on a database one,
 *  the plain one otherwise. */
export const missionKeyFilePath = (missionNumber: number): string => {
  const { storage } = missionShape(missionNumber);
  if (storage === 'database') return DATADIR_PATH;
  return storage === 'gpg' ? sealedKeyPath(missionNumber) : missionKeyPath(missionNumber);
};

const vaultName = (missionNumber: number): string => `${missionShape(missionNumber).stem}-vault`;

const vaultPath = (missionNumber: number): string => `/usr/local/bin/${vaultName(missionNumber)}`;

/** Root's history, laid by the server because it names the key path, which never ships. */
const ROOT_HISTORY_PATH = '/root/.bash_history';

/** What root last did: sealed the key with the program, then removed the plain one. Points
 *  at the program without saying the passphrase is in it. */
const sealingHistory = (missionNumber: number): string => {
  const keyPath = missionKeyPath(missionNumber);
  return `${vaultName(missionNumber)} --seal ${keyPath}\nrm ${keyPath}\n`;
};

/** The program that sealed the key, its passphrase compiled in among its other strings. */
const vaultProgram = (name: string, passphrase: string): string =>
  [
    binaryStub(name),
    `usage: ${name} --seal <file> | --open <file.gpg>`,
    'sealed %s -> %s.gpg',
    'bad passphrase',
    passphrase,
    'GCC: (Debian 12.2.0-14) 12.2.0',
  ].join(RUN_BREAK);

/** Where the key goes on this contract, from the number alone: nowhere of its own on a
 *  database contract, whose key is a row of the datadir. */
const keyFilePaths = (missionNumber: number): readonly string[] => {
  const { storage } = missionShape(missionNumber);
  if (storage === 'database') return [];
  return storage === 'gpg'
    ? [sealedKeyPath(missionNumber), vaultPath(missionNumber), ROOT_HISTORY_PATH]
    : [missionKeyPath(missionNumber)];
};

/** The key's files: the plain key, or the sealed key, the program holding its passphrase and
 *  the history that points at it, or none when the key is a row of the datadir. */
const keyFiles = (missionNumber: number, secret: string): readonly MissionFile[] => {
  const { storage } = missionShape(missionNumber);
  if (storage === 'database') return [];
  const key = `${missionKey(missionNumber, secret)}\n`;
  if (storage === 'file') {
    return [{ path: missionKeyPath(missionNumber), content: key, perms: ROOT_FILE }];
  }
  const passphrase = missionPassphrase(missionNumber, secret);
  return [
    { path: sealedKeyPath(missionNumber), content: encryptContent(key, passphrase), perms: ROOT_FILE },
    {
      path: vaultPath(missionNumber),
      content: vaultProgram(vaultName(missionNumber), passphrase),
      perms: PROGRAM_FILE,
    },
    { path: ROOT_HISTORY_PATH, content: sealingHistory(missionNumber), perms: ROOT_FILE },
  ];
};

/** Whether the server lays the datadir: on the database route, where it holds the word, and on
 *  a contract keeping its key in it. Built once from every table either adds. */
const laysDatadir = (missionNumber: number): boolean => {
  const { keyBox, storage } = missionShape(missionNumber);
  return keyBox.route === 'mysql' || storage === 'database';
};

/** The datadir as laid: the word's table on the database route, the key's on a contract
 *  keeping it there, or both. */
const datadirFile = (
  missionNumber: number,
  secret: string,
  rawSecrets: string | undefined,
): MissionFile => {
  const { keyBox, storage } = missionShape(missionNumber);
  const tables = {
    ...(keyBox.route === 'mysql'
      ? { settings: settingsTable(missionLeakWord(missionNumber, rawSecrets)) }
      : {}),
    ...(storage === 'database'
      ? { api_keys: apiKeysTable(missionNumber, missionKey(missionNumber, secret)) }
      : {}),
  };
  return { path: DATADIR_PATH, content: databaseWith(missionNumber, tables), perms: DATADIR_FILE };
};

/** The leak when it is a file of its own; on the database route the leak is the datadir. */
const ownLeakFile = (missionNumber: number, rawSecrets: string | undefined): MissionFile | null =>
  missionShape(missionNumber).keyBox.route === 'mysql'
    ? null
    : missionLeakFile(missionNumber, rawSecrets);

/** Where `ownLeakFile` lays it, from the number alone. */
const ownLeakPath = (missionNumber: number): string | null =>
  missionShape(missionNumber).keyBox.route === 'mysql' ? null : missionLeakPath(missionNumber);

/** Every file the server lays onto this contract's key box. A route with no leak never
 *  touches the pools, so a missing `JSHACK_SECRETS` closes only the boxes that need it. */
export const missionFiles = (
  missionNumber: number,
  env: { readonly keySecret: string | undefined; readonly rawSecrets: string | undefined },
): readonly MissionFile[] => {
  const secret = requireMissionSecret(env.keySecret);
  const leak = ownLeakFile(missionNumber, env.rawSecrets);
  return [
    ...keyFiles(missionNumber, secret),
    ...(leak === null ? [] : [leak]),
    ...(laysDatadir(missionNumber) ? [datadirFile(missionNumber, secret, env.rawSecrets)] : []),
  ];
};

/** The files for the box a door has reached: none unless it is a contract's key box, and an
 *  error when a secret that box needs is unset, which the door answers 500. */
export const missionFilesForBox = async (
  box: { readonly essid: string; readonly machine_id: string },
  env: { readonly keySecret: string | undefined; readonly rawSecrets: string | undefined },
): Promise<
  | { readonly data: readonly MissionFile[]; readonly error: null }
  | { readonly data: null; readonly error: 'mission_secret_missing' }
> => {
  const missionNumber = missionKeyBoxNumber(box.essid, box.machine_id);
  if (missionNumber === null) return { data: [], error: null };
  try {
    return { data: missionFiles(missionNumber, env), error: null };
  } catch {
    return { data: null, error: 'mission_secret_missing' };
  }
};

/** The paths `missionFiles` lays in, from the number alone: the write gate asks whether a
 *  tier may write one, which only root may on any of them, and needs no secret to ask. */
export const missionFilePaths = (missionNumber: number): readonly string[] => {
  const leakPath = ownLeakPath(missionNumber);
  return [
    ...keyFilePaths(missionNumber),
    ...(leakPath === null ? [] : [leakPath]),
    ...(laysDatadir(missionNumber) ? [DATADIR_PATH] : []),
  ];
};
