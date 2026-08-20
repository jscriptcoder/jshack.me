/**
 * Where a box keeps its database, and how a server-side reader gets it back.
 *
 * The datadir is a FILE (`/var/lib/mysql/data.json`), so every read of it goes
 * through `parseMysqlDatabase` rather than a cast — the file is root-owned, root on
 * a box is a tier a player can reach, and anything a player can reach they can edit.
 *
 * A box with no datadir, a datadir that is not a file, and a datadir holding
 * something that is not a database all collapse to the same answer: this box has no
 * database. From a reader's side they are one condition, and telling them apart
 * would only tell a tamperer how their edit failed.
 */

import { parseMysqlDatabase, type MysqlDatabase } from './types';
import type { Directory } from '../filesystem/types';
import type { SweepableAccount } from '../wordlist/passwordSweep';

/** The database a box serves, or null when it serves none. Walked a directory at a
 *  time, the way every other reader of a known path on a generated box walks it. */
const databaseIn = (fs: Directory): MysqlDatabase | null => {
  const varDir = fs.entries.get('var');
  if (varDir === undefined || varDir.kind !== 'directory') return null;
  const lib = varDir.entries.get('lib');
  if (lib === undefined || lib.kind !== 'directory') return null;
  const mysql = lib.entries.get('mysql');
  if (mysql === undefined || mysql.kind !== 'directory') return null;
  const datadir = mysql.entries.get('data.json');
  if (datadir === undefined || datadir.kind !== 'file') return null;
  return parseMysqlDatabase(datadir.content);
};

/**
 * The accounts a credential sweep of the database door attacks.
 *
 * These are the DATABASE's accounts, never the box's. `/etc/passwd` answers who you
 * are on the machine; the datadir answers who you are to the database, and the two
 * are drawn on separate streams — so cracking a box buys nothing toward its database
 * and cracking a database buys nothing toward its box.
 *
 * A box with no readable database exposes NO accounts rather than falling back to the
 * box's own. Nothing to attack is the honest answer, and it is what keeps a sweep of
 * a tampered datadir from reporting unix logins as database ones.
 */
export const databaseAccountsIn = (fs: Directory): readonly SweepableAccount[] => {
  const database = databaseIn(fs);
  if (database === null) return [];
  return database.credentials.map((credential) => ({
    username: credential.username,
    hash: credential.passwordHash,
  }));
};
