/**
 * The application a database holds: its login table, and the rows in it.
 *
 * Every application keeps `users`, the table its people sign in through. Their
 * password hashes are bcrypt-shaped because that is what an application stores, and
 * because the only cracker in the world reverses md5: a hash lifted from this table
 * opens nothing, so reading it is recon rather than a free credential.
 */

import type { Prng } from './prng';
import type { MysqlColumn } from '../mysql/types';

/** The application's login table, the same in every application. */
export const USERS_COLUMNS: readonly MysqlColumn[] = [
  { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
  { name: 'username', type: 'VARCHAR', nullable: false, key: 'UNI' },
  { name: 'email', type: 'VARCHAR', nullable: false },
  { name: 'password_hash', type: 'VARCHAR', nullable: false },
  { name: 'role', type: 'VARCHAR', nullable: false, defaultValue: 'user' },
  { name: 'created_at', type: 'DATETIME', nullable: false },
];

const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** A password hash as a PHP application stores one: cost 10, then salt and digest. */
export const bcryptHash = (prng: Prng): string =>
  `$2y$10$${Array.from({ length: 53 }, () => prng.pick(BCRYPT_ALPHABET)).join('')}`;

/** An instant as a DATETIME cell reads it: `YYYY-MM-DD HH:MM:SS`, in UTC. */
export const datetimeAt = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
