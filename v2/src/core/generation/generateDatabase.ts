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
import { usernamePool } from './pools/usernames';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { npcUsername } from './remoteHostFs';
import { usersRows, USERS_COLUMNS } from './databaseApp';
import { lanZoneName } from '../network/resolveName';
import {
  DB_NAME_PREFIXES,
  DB_NAME_SUFFIXES,
  DRAWN_TABLE_TEMPLATES,
  MYSQL_USERNAMES,
} from './pools/database';
import type { DrawnRole } from './machineRole';
import type { MysqlCredential, MysqlDatabase, MysqlTable } from '../mysql/types';

/** How many logins an application on a deep box keeps beside the box's own account. */
const DEEP_LOGIN_RANGE = { min: 4, max: 9 } as const;

/**
 * The database `host` keeps on `essid`.
 *
 * `account` is the box's REAL user — the one with a home directory a visitor can see —
 * and it leads the `users` table as the application's admin, which is what ties the
 * database to the machine it is on. On a LAN everyone else in the table is a neighbour:
 * every account whose machine shares the network, and nobody whose machine does not.
 * A deep box has no neighbours to give, so its application keeps logins drawn from the
 * same role-keyed pool that named the box.
 */
export const generateDatabase = ({
  seed,
  appSeed,
  essid,
  host,
  account,
  role,
}: {
  /** The stream the accounts are drawn on, and nothing else. */
  readonly seed: string;
  /** The stream the application is drawn on, so reshaping what a database holds never
   *  moves the passwords that guard it. */
  readonly appSeed: string;
  readonly essid: string;
  readonly host: LanHost;
  readonly account: string;
  readonly role: DrawnRole | undefined;
}): MysqlDatabase => {
  const prng = createPrng(appSeed);
  const name = `${prng.pick(DB_NAME_PREFIXES)}_${prng.pick(DB_NAME_SUFFIXES)}`;

  const others = isOnHomeLan(essid, host)
    ? generateHomeLan(essid)
        .hosts.filter((candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip)
        .map((neighbour) => npcUsername(essid, neighbour))
    : prng.pickN(
        usernamePool(role).filter((login) => login !== account),
        prng.nextInt(DEEP_LOGIN_RANGE.min, DEEP_LOGIN_RANGE.max),
      );
  const people = [...new Set([account, ...others])];

  const tables: Record<string, MysqlTable> = {
    users: { columns: USERS_COLUMNS, rows: usersRows({ prng, people, zone: lanZoneName(essid) }) },
    ...Object.fromEntries(
      prng
        .pickN(DRAWN_TABLE_TEMPLATES, prng.nextInt(2, 4))
        .map((template) => [
          template.name,
          { columns: template.columns, rows: template.rowGenerator(prng, people, host.hostname) },
        ]),
    ),
  };

  return { name, tables, credentials: drawDatabaseCredentials(seed) };
};

/**
 * The accounts a database answers to, drawn from `seed` alone.
 *
 * Always a root and an application account; a read-only one about half the time. The
 * ladder is the world's existing one, so what a player meets here is the curve they
 * already know: the read-only account nearly always falls, the application account
 * usually, and root about one database in eight — which is what makes the statements
 * only root may run rare rather than routine.
 */
export const drawDatabaseCredentials = (seed: string): readonly MysqlCredential[] => {
  const prng = createPrng(seed);
  const rootPassword = drawPassword(prng, CRACK_CHANCE.npcRoot);
  const appUsername = prng.pick(MYSQL_USERNAMES);
  const appPassword = drawPassword(prng, CRACK_CHANCE.npcUser);
  const hasReadonly = prng.next() < 0.5;
  const readonlyPassword = drawPassword(prng, CRACK_CHANCE.guest);

  return [
    { username: 'root', passwordHash: md5(rootPassword), userType: 'root' },
    { username: appUsername, passwordHash: md5(appPassword), userType: 'user' },
    ...(hasReadonly
      ? [{ username: 'readonly', passwordHash: md5(readonlyPassword), userType: 'guest' as const }]
      : []),
  ];
};
