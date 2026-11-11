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
import { buildMissionFrontBoxFs, buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { missionBoxAt } from '../generation/lanHostIdentity.js';
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
import {
  missionKind,
  missionShape,
  recordsStorage,
  type MissionBox,
  type MissionBoxRef,
  type MissionRoute,
} from './missionShape.js';
import { GUESSABLE_COMMUNITIES } from './pools.js';
import { missionRecords, recordsFiles } from './missionRecords.js';

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

/** The record of the box `ref` names. A single-hop contract has no front box, and no door
 *  can reach one, so asking for it is a caller's bug. */
const boxOf = ({ missionNumber, role }: MissionBoxRef): MissionBox => {
  const shape = missionShape(missionNumber);
  if (role === 'key') return shape.keyBox;
  if (shape.frontBox === null) throw new Error(`contract ${missionNumber} has no front box`);
  return shape.frontBox;
};

/** The stream a box's forgotten file and its agent's community are drawn on. The key box keeps
 *  the one it always had, and the front box has its own, so neither moves the other's. */
const leakSeedOf = ({ missionNumber, role }: MissionBoxRef): string =>
  role === 'key' ? `mission-leak-${missionNumber}` : `mission-front-leak-${missionNumber}`;

/** The box as it generates, whose datadir a laid one replaces. */
const generatedBoxOf = ({ missionNumber, role }: MissionBoxRef) =>
  role === 'key' ? buildMissionKeyBoxFs(missionNumber) : buildMissionFrontBoxFs(missionNumber);

/** A plain `ls` hides a dotfile, so `pub/` would look empty with one in it. */
const forgottenFileOf = (ref: MissionBoxRef): (typeof FORGOTTEN_FILES)[number] =>
  createPrng(leakSeedOf(ref)).pick(
    boxOf(ref).route === 'ftp'
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
  ref: MissionBoxRef,
): { readonly path: string; readonly perms: FilePermissions } | null => {
  const { route } = boxOf(ref);
  if (route === 'mysql') return { path: DATADIR_PATH, perms: DATADIR_FILE };
  if (route === 'snmp') return { path: SNMPD_CONF_PATH, perms: SNMPD_CONF_PERMISSIONS };
  const home = LEAK_HOMES[route];
  return home === undefined
    ? null
    : { path: `${home.directory}/${forgottenFileOf(ref).name}`, perms: home.perms };
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
const databaseWith = (ref: MissionBoxRef, tables: Readonly<Record<string, MysqlTable>>): string => {
  const database = databaseIn(generatedBoxOf(ref));
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
const agentConfig = (ref: MissionBoxRef, word: string): string =>
  [
    '# /etc/snmp/snmpd.conf — SNMP agent configuration',
    `rocommunity ${createPrng(leakSeedOf(ref)).pick(GUESSABLE_COMMUNITIES)}`,
    `syscontact helpdesk: the server password is still ${word}, change it!`,
    '',
  ].join('\n');

/** What the file holds on this route, given the word. */
const leakContent = (ref: MissionBoxRef, word: string): string => {
  const { route } = boxOf(ref);
  if (route === 'mysql') return databaseWith(ref, { settings: settingsTable(word) });
  if (route === 'snmp') return agentConfig(ref, word);
  return forgottenFileOf(ref).render(word);
};

/** Where the box's forgotten file sits, drawn from the number, or null on a route with no
 *  leak. The path alone needs no secret, so the write gate can ask for it. */
export const missionLeakPath = (ref: MissionBoxRef): string | null =>
  leakPlaceOf(ref)?.path ?? null;

/** The word the box's forgotten file gives away, which is that box's root. */
export const missionLeakWord = (ref: MissionBoxRef, rawSecrets: string | undefined): string =>
  leakedWord(boxOf(ref).rootHash, rawSecrets);

/** The box's forgotten file itself, or null on a route with no leak. */
export const missionLeakFile = (
  ref: MissionBoxRef,
  rawSecrets: string | undefined,
): MissionFile | null => {
  const place = leakPlaceOf(ref);
  if (place === null) return null;
  return { ...place, content: leakContent(ref, missionLeakWord(ref, rawSecrets)) };
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

/** Whether the box is a key job's key box. A front box never holds the key, and a tamper job
 *  has none. */
const holdsKey = (ref: MissionBoxRef): boolean =>
  ref.role === 'key' && missionKind(ref.missionNumber) === 'key';

/** Whether the box keeps the contract's key in its datadir: the key box, on a contract keeping
 *  it in a database. */
const keepsKeyInDatabase = (ref: MissionBoxRef): boolean =>
  holdsKey(ref) && missionShape(ref.missionNumber).storage === 'database';

/** Whether the box holds the records a tamper job asks to have changed: its records box. */
const holdsRecords = (ref: MissionBoxRef): boolean =>
  ref.role === 'key' && missionKind(ref.missionNumber) === 'tamper';

/** Whether the box keeps a tamper job's records in its database. */
const holdsRecordsInDatabase = (ref: MissionBoxRef): boolean =>
  holdsRecords(ref) && recordsStorage(ref.missionNumber) === 'database';

/** Whether the box keeps a tamper job's records in a root-only file. */
const holdsRecordsInFile = (ref: MissionBoxRef): boolean =>
  holdsRecords(ref) && recordsStorage(ref.missionNumber) === 'file';

/** Whether the server lays the box's datadir: on the database route, where it holds the word,
 *  on the key box of a contract keeping its key in it, and on a records box keeping the records
 *  in it. Built once from every table they add. */
const laysDatadir = (ref: MissionBoxRef): boolean =>
  boxOf(ref).route === 'mysql' || keepsKeyInDatabase(ref) || holdsRecordsInDatabase(ref);

/** The datadir as laid: the word's table on the database route, beside the key's on a key box
 *  keeping it there or the records' tables on a records box. */
const datadirFile = (ref: MissionBoxRef, env: MissionSecretsEnv): MissionFile => {
  const { missionNumber } = ref;
  const tables = {
    ...(boxOf(ref).route === 'mysql'
      ? { settings: settingsTable(missionLeakWord(ref, env.rawSecrets)) }
      : {}),
    ...(holdsRecordsInDatabase(ref)
      ? Object.fromEntries(
          missionRecords(missionNumber).tables.map(({ name, table }) => [name, table]),
        )
      : {}),
    ...(keepsKeyInDatabase(ref)
      ? {
          api_keys: apiKeysTable(
            missionNumber,
            missionKey(missionNumber, requireMissionSecret(env.keySecret)),
          ),
        }
      : {}),
  };
  return { path: DATADIR_PATH, content: databaseWith(ref, tables), perms: DATADIR_FILE };
};

/** The records a job keeping them in files holds, a file a table, only root may read or
 *  write. */
const recordsFilesLaid = (missionNumber: number): readonly MissionFile[] =>
  recordsFiles(missionNumber).map(({ path, content }) => ({ path, content, perms: ROOT_FILE }));

/** The leak when it is a file of its own; on the database route the leak is the datadir. */
const ownLeakFile = (ref: MissionBoxRef, rawSecrets: string | undefined): MissionFile | null =>
  boxOf(ref).route === 'mysql' ? null : missionLeakFile(ref, rawSecrets);

/** Where `ownLeakFile` lays it, from the number alone. */
const ownLeakPath = (ref: MissionBoxRef): string | null =>
  boxOf(ref).route === 'mysql' ? null : missionLeakPath(ref);

/** The two secrets the server holds, as it reads them from its environment. */
type MissionSecretsEnv = {
  readonly keySecret: string | undefined;
  readonly rawSecrets: string | undefined;
};

/** Every file the server lays onto the box: on a key job's key box the key's files, then its
 *  leak and its datadir; on a records box or a front box its leak, its datadir and a records box's
 *  file, which never need the key's secret. A route with no leak never touches the pools, so a missing
 *  `JSHACK_SECRETS` closes only the boxes that need it. */
export const missionFiles = (
  ref: MissionBoxRef,
  env: MissionSecretsEnv,
): readonly MissionFile[] => {
  const keyFilesLaid = holdsKey(ref)
    ? keyFiles(ref.missionNumber, requireMissionSecret(env.keySecret))
    : [];
  const leak = ownLeakFile(ref, env.rawSecrets);
  return [
    ...keyFilesLaid,
    ...(leak === null ? [] : [leak]),
    ...(laysDatadir(ref) ? [datadirFile(ref, env)] : []),
    ...(holdsRecordsInFile(ref) ? recordsFilesLaid(ref.missionNumber) : []),
  ];
};

/** The files for the box a door has reached: none unless it is a contract's key or front box,
 *  and an error when a secret that box needs is unset, which the door answers 500. */
export const missionFilesForBox = async (
  box: { readonly essid: string; readonly machine_id: string },
  env: { readonly keySecret: string | undefined; readonly rawSecrets: string | undefined },
): Promise<
  | { readonly data: readonly MissionFile[]; readonly error: null }
  | { readonly data: null; readonly error: 'mission_secret_missing' }
> => {
  const reached = missionBoxAt(box.essid, box.machine_id);
  if (reached === null) return { data: [], error: null };
  try {
    return { data: missionFiles(reached, env), error: null };
  } catch {
    return { data: null, error: 'mission_secret_missing' };
  }
};

/** The paths `missionFiles` lays in, from the number alone: the write gate asks whether a
 *  tier may write one, which only root may on any of them, and needs no secret to ask. */
export const missionFilePaths = (ref: MissionBoxRef): readonly string[] => {
  const leakPath = ownLeakPath(ref);
  return [
    ...(holdsKey(ref) ? keyFilePaths(ref.missionNumber) : []),
    ...(leakPath === null ? [] : [leakPath]),
    ...(laysDatadir(ref) ? [DATADIR_PATH] : []),
    ...(holdsRecordsInFile(ref) ? recordsFiles(ref.missionNumber).map(({ path }) => path) : []),
  ];
};
