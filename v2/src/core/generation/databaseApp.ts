/**
 * The application a database holds: its login table, and the rows in it.
 *
 * Every application keeps `users`, the table its people sign in through. Their
 * password hashes are bcrypt-shaped because that is what an application stores, and
 * because the only cracker in the world reverses md5: a hash lifted from this table
 * opens nothing, so reading it is recon rather than a free credential.
 */

import { WORLD_EPOCH } from '../cve/worldClock';
import type { Prng } from './prng';
import type { MysqlColumn, MysqlRow } from '../mysql/types';

const DAY_MS = 86_400_000;

/** How long before the world stopped an application was installed: somewhere between
 *  about a year and about four. */
const INSTALLED_DAYS_AGO = { min: 400, max: 1500 } as const;

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

/**
 * The login rows for `people`, in the order they signed up.
 *
 * The first is whoever installed the application, and administers it; everyone else
 * joined afterwards, at moments drawn between the install and the last second before
 * the world stopped, so the table reads in the order its accounts were made.
 */
export const usersRows = ({
  prng,
  people,
  zone,
}: {
  readonly prng: Prng;
  readonly people: readonly string[];
  /** The network's own domain, which every login's mail is addressed to. */
  readonly zone: string;
}): readonly MysqlRow[] => {
  const installedAt =
    WORLD_EPOCH -
    prng.nextInt(INSTALLED_DAYS_AGO.min, INSTALLED_DAYS_AGO.max) * DAY_MS -
    prng.nextInt(0, DAY_MS / 1000 - 1) * 1000;
  const lastSecond = WORLD_EPOCH / 1000 - 1;
  const joined = people
    .slice(1)
    .map(() => prng.nextInt(installedAt / 1000 + 1, lastSecond) * 1000)
    .sort((earlier, later) => earlier - later);
  const createdAt = [installedAt, ...joined];
  return people.map((username, index) => ({
    id: index + 1,
    username,
    email: `${username}@${zone}`,
    password_hash: bcryptHash(prng),
    role: index === 0 ? 'admin' : 'user',
    created_at: datetimeAt(createdAt[index] ?? installedAt),
  }));
};

/** An instant as a DATETIME cell reads it: `YYYY-MM-DD HH:MM:SS`, in UTC. */
export const datetimeAt = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
