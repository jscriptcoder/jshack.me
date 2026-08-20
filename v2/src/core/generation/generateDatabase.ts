/**
 * generateDatabase — the database a box that runs mysqld keeps.
 *
 * Deterministic from the caller's seed, like every other thing about a generated box,
 * so two occupants querying one database agree about what is in it.
 *
 * Its stream is its OWN. Appending these draws to the host filesystem's sequence would
 * move every value picked after them — including the octets the lease allocator
 * excludes when it issues an occupant an address, which would put a player on top of an
 * NPC. The same rule the web page, the `/etc` config and the backdoor each follow.
 *
 * Accounts here are the DATABASE's, not the box's. They are drawn on the same two-pool
 * ladder every other credential in the world is drawn on — a password is crackable
 * because it is in the wordlist the player holds, and nothing else decides that — but
 * they are drawn INDEPENDENTLY of the box's system accounts. Cracking a box buys
 * nothing toward its database, and cracking a database buys nothing toward its box.
 */

import { createPrng } from './prng';
import { md5 } from './md5';
import { CRACK_CHANCE, drawPassword } from './passwordPools';
import { pickUsername } from './pools/usernames';
import {
  DB_NAME_PREFIXES,
  DB_NAME_SUFFIXES,
  DRAWN_TABLE_TEMPLATES,
  MYSQL_USERNAMES,
  USERS_TABLE,
} from './pools/database';
import type { DrawnRole } from './machineRole';
import type { MysqlCredential, MysqlDatabase, MysqlTable } from '../mysql/types';

/** How many colleagues the box's own account appears among. A `users` table holding one
 *  row reads as a fixture rather than a company. */
const COLLEAGUE_RANGE = { min: 3, max: 7 } as const;

/**
 * The database `hostname` keeps.
 *
 * `account` is the box's REAL user — the one with a home directory a visitor can see —
 * and it leads the `users` table, which is what ties the database to the machine it is
 * on. The rest of the table is drawn from the same role-keyed pool that named it, so a
 * warehouse box is staffed by warehouse people.
 */
export const generateDatabase = ({
  seed,
  hostname,
  account,
  role,
}: {
  readonly seed: string;
  readonly hostname: string;
  readonly account: string;
  readonly role: DrawnRole | undefined;
}): MysqlDatabase => {
  const prng = createPrng(seed);
  const name = `${prng.pick(DB_NAME_PREFIXES)}_${prng.pick(DB_NAME_SUFFIXES)}`;

  const colleagues = Array.from(
    { length: prng.nextInt(COLLEAGUE_RANGE.min, COLLEAGUE_RANGE.max) },
    () => pickUsername({ prng, role }),
  );
  const people = [account, ...colleagues.filter((colleague) => colleague !== account)];

  const templates = [
    USERS_TABLE,
    ...prng.pickN(DRAWN_TABLE_TEMPLATES, prng.nextInt(2, 4)),
  ];
  const tables: Record<string, MysqlTable> = Object.fromEntries(
    templates.map((template) => [
      template.name,
      { columns: template.columns, rows: template.rowGenerator(prng, people, hostname) },
    ]),
  );

  // Always a root and an application account; a read-only one about half the time. The
  // ladder is the world's existing one, so what a player meets here is the curve they
  // already know: the read-only account nearly always falls, the application account
  // usually, and root about one database in eight — which is what makes the statements
  // only root may run rare rather than routine.
  const rootPassword = drawPassword(prng, CRACK_CHANCE.npcRoot);
  const appUsername = prng.pick(MYSQL_USERNAMES);
  const appPassword = drawPassword(prng, CRACK_CHANCE.npcUser);
  const hasReadonly = prng.next() < 0.5;
  const readonlyPassword = drawPassword(prng, CRACK_CHANCE.guest);

  const credentials: readonly MysqlCredential[] = [
    { username: 'root', passwordHash: md5(rootPassword), userType: 'root' },
    { username: appUsername, passwordHash: md5(appPassword), userType: 'user' },
    ...(hasReadonly
      ? [{ username: 'readonly', passwordHash: md5(readonlyPassword), userType: 'guest' as const }]
      : []),
  ];

  return { name, tables, credentials };
};
