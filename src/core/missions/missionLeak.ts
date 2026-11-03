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
 */

import { FTP_PUBLIC_FILE, ROOT_FILE } from '../generation/baseFs.js';
import { missionKeyBoxNumber } from '../generation/lanHostIdentity.js';
import { md5 } from '../generation/md5.js';
import { createPrng } from '../generation/prng.js';
import { WEB_ROOT } from '../network/http.js';
import { parseSecrets } from '../secrets/parseSecrets.js';
import { ANONYMOUS_FTP_ROOT } from '../sessions/doorAdmission.js';
import type { FilePermissions } from '../filesystem/types.js';
import { LEAKABLE_HASHES } from './leakablePool.js';
import { missionKey, missionKeyPath, requireMissionSecret } from './missionSecret.js';
import { missionShape, type MissionRoute } from './missionShape.js';

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
    missionShape(missionNumber).route === 'ftp'
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
  const home = LEAK_HOMES[missionShape(missionNumber).route];
  return home === undefined
    ? null
    : { path: `${home.directory}/${forgottenFileOf(missionNumber).name}`, perms: home.perms };
};

/** Where the forgotten file sits, drawn from the number, or null on a route with no leak.
 *  The path alone needs no secret, so the write gate can ask for it. */
export const missionLeakPath = (missionNumber: number): string | null =>
  leakPlaceOf(missionNumber)?.path ?? null;

/** The word this contract's forgotten file gives away, which is its key box's root. */
export const missionLeakWord = (missionNumber: number, rawSecrets: string | undefined): string =>
  leakedWord(missionShape(missionNumber).keyBoxRootHash, rawSecrets);

/** The forgotten file itself, or null on a route with no leak. */
export const missionLeakFile = (
  missionNumber: number,
  rawSecrets: string | undefined,
): MissionFile | null => {
  const place = leakPlaceOf(missionNumber);
  if (place === null) return null;
  return {
    ...place,
    content: forgottenFileOf(missionNumber).render(missionLeakWord(missionNumber, rawSecrets)),
  };
};

/** Every file the server lays onto this contract's key box. A route with no leak never
 *  touches the pools, so a missing `JSHACK_SECRETS` closes only the boxes that need it. */
export const missionFiles = (
  missionNumber: number,
  env: { readonly keySecret: string | undefined; readonly rawSecrets: string | undefined },
): readonly MissionFile[] => {
  const key = {
    path: missionKeyPath(missionNumber),
    content: `${missionKey(missionNumber, requireMissionSecret(env.keySecret))}\n`,
    perms: ROOT_FILE,
  };
  const leak = missionLeakFile(missionNumber, env.rawSecrets);
  return leak === null ? [key] : [key, leak];
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
  const leakPath = missionLeakPath(missionNumber);
  const keyPath = missionKeyPath(missionNumber);
  return leakPath === null ? [keyPath] : [keyPath, leakPath];
};
