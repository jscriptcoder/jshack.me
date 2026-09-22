import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { drawDatabaseCredentials } from './generateDatabase';
import { CRACK_CHANCE, CRACKABLE_PASSWORDS } from './passwordPools';
import { MYSQL_USERNAMES } from './pools/database';
import { md5 } from './md5';
import { databaseIn } from '../mysql/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { ALL_ESSIDS, deepBoxes, lanBoxes, type Box } from '../../test/worldContent';
import type { MysqlDatabase } from '../mysql/types';

type DatabaseBox = Box & { readonly database: MysqlDatabase };

/** Every database the world holds: each LAN box that runs mysqld, and each deep box
 *  that does. Built inside each test rather than cached, so a mutation run credits the
 *  test that actually reads the generator. */
const everyDatabase = (): readonly DatabaseBox[] => {
  const lan = lanBoxes(ALL_ESSIDS)
    .filter(({ essid, host }) =>
      hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
    )
    .map(({ essid, host }) => ({ essid, host, fs: buildRemoteHostFs(essid, host) }));
  const deep = deepBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
    essid,
    host,
    fs: buildDeepHostFs(essid, host),
  }));
  return [...lan, ...deep].flatMap(({ essid, host, fs }) => {
    const database = databaseIn(fs);
    return database === null ? [] : [{ essid, host, database }];
  });
};

const CRACKABLE_HASHES = new Set(CRACKABLE_PASSWORDS.map((password) => md5(password)));

describe('the accounts a database answers to', () => {
  it('are drawn from the box’s own database seed and from nothing else', () => {
    // The application a database holds is drawn separately, so reshaping what is IN a
    // database never moves the passwords that guard it.
    const databases = everyDatabase();
    const drifted = databases
      .filter(
        ({ essid, host, database }) =>
          JSON.stringify(database.credentials) !==
          JSON.stringify(drawDatabaseCredentials(`mysql-db-${essid}-${host.ip}`)),
      )
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(databases.length).toBeGreaterThan(30);
    expect({ count: drifted.length, sample: drifted.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('are root, one application account and sometimes a read-only one, on the world’s crack ladder', () => {
    const draws = Array.from({ length: 4000 }, (_, index) =>
      drawDatabaseCredentials(`ladder-${index}`),
    );
    const byTier = (tier: 'root' | 'user' | 'guest') =>
      draws.flatMap((credentials) =>
        credentials.filter((credential) => credential.userType === tier),
      );
    const crackableShare = (tier: 'root' | 'user' | 'guest') =>
      byTier(tier).filter((credential) => CRACKABLE_HASHES.has(credential.passwordHash)).length /
      byTier(tier).length;

    expect(draws.every((credentials) => credentials[0]?.username === 'root')).toBe(true);
    expect(draws.every((credentials) => credentials[0]?.userType === 'root')).toBe(true);
    expect(draws.every((credentials) => credentials[1]?.userType === 'user')).toBe(true);
    expect(
      draws.every((credentials) => MYSQL_USERNAMES.includes(credentials[1]?.username ?? '')),
    ).toBe(true);
    expect(byTier('guest').every((credential) => credential.username === 'readonly')).toBe(true);
    expect(draws.every((credentials) => credentials.length <= 3)).toBe(true);
    expect(byTier('guest').length / draws.length).toBeCloseTo(0.5, 1);
    expect(crackableShare('root')).toBeCloseTo(CRACK_CHANCE.npcRoot, 1);
    expect(crackableShare('user')).toBeCloseTo(CRACK_CHANCE.npcUser, 1);
    expect(crackableShare('guest')).toBe(CRACK_CHANCE.guest);
  });
});
