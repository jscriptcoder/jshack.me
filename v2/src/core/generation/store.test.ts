import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { drawStoreLock } from './generateRedisStore';
import { generateApplication, type Application } from './generateDatabase';
import { generateHomeLan, isOnHomeLan } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { CRACK_CHANCE, CRACKABLE_PASSWORDS } from './passwordPools';
import { md5 } from './md5';
import { storeIn } from '../redis/datadir';
import { databaseIn } from '../mysql/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { ALL_ESSIDS, deepBoxes, lanBoxes, type Box } from '../../test/worldContent';
import type { RedisStore } from '../redis/types';
import type { Directory } from '../filesystem/types';
import type { MysqlRow } from '../mysql/types';

type StoreBox = Box & { readonly store: RedisStore; readonly fs: Directory };

/** Every store the world holds: each LAN box that runs redis, and each deep box that
 *  does. Built inside each test rather than cached, so a mutation run credits the test
 *  that actually reads the generator. */
const everyStore = (): readonly StoreBox[] => {
  const lan = lanBoxes(ALL_ESSIDS)
    .filter(({ essid, host }) =>
      hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.redis),
    )
    .map(({ essid, host }) => ({ essid, host, fs: buildRemoteHostFs(essid, host) }));
  const deep = deepBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
    essid,
    host,
    fs: buildDeepHostFs(essid, host),
  }));
  return [...lan, ...deep].flatMap(({ essid, host, fs }) => {
    const store = storeIn(fs);
    return store === null ? [] : [{ essid, host, store, fs }];
  });
};

const CRACKABLE_HASHES = new Set(CRACKABLE_PASSWORDS.map((password) => md5(password)));

/** The application a box runs: the one its database would hold, whether or not mysqld
 *  serves it. */
const applicationOf = ({ essid, host }: Box): Application =>
  generateApplication({
    appSeed: `db-app-${essid}-${host.ip}`,
    essid,
    host,
    account: npcUsername(essid, host),
    role: roleOfHostname(host.hostname),
  });

const usersOf = (application: Application): readonly MysqlRow[] =>
  application.tables.users?.rows ?? [];

type Session = {
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
};

const sessionsIn = (store: RedisStore): readonly Session[] =>
  Object.entries(store.keys)
    .filter(([key]) => key.startsWith('sess:'))
    .map(([key, value]) => ({ key, value: JSON.parse(value) as Record<string, unknown> }));

/** Where a login's sessions come from: the machine that person uses. On a LAN that is the
 *  box itself for its own account and the neighbour whose account it is for anyone else;
 *  a deep login has no machine of its own, so its sessions reach the box directly. */
const machineOf = (box: Box, username: unknown): string | undefined => {
  if (!isOnHomeLan(box.essid, box.host) || username === npcUsername(box.essid, box.host)) {
    return box.host.ip;
  }
  return generateHomeLan(box.essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      candidate.ip !== box.host.ip &&
      npcUsername(box.essid, candidate) === username,
  )?.ip;
};

const LAST_SECOND = '2026-07-11 23:59:59';
const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('a store’s lock', () => {
  it('is drawn on its own stream and nothing else, so reshaping what a store holds never moves it', () => {
    const stores = everyStore();
    const drifted = stores
      .filter(
        ({ essid, host, store }) =>
          store.requirepassHash !== drawStoreLock(`redis-store-${essid}-${host.ip}`),
      )
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(stores.length).toBeGreaterThan(30);
    expect({ count: drifted.length, sample: drifted.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('shuts six stores in ten, on the same crack chance as an ordinary account', () => {
    const locks = Array.from({ length: 4000 }, (_, index) => drawStoreLock(`lock-${index}`));
    const locked = locks.filter((lock): lock is string => lock !== null);
    const crackable = locked.filter((lock) => CRACKABLE_HASHES.has(lock));

    expect(locked.length / locks.length).toBeGreaterThan(0.57);
    expect(locked.length / locks.length).toBeLessThan(0.63);
    expect(crackable.length / locked.length).toBeGreaterThan(CRACK_CHANCE.npcUser - 0.04);
    expect(crackable.length / locked.length).toBeLessThan(CRACK_CHANCE.npcUser + 0.04);
  });
});

describe('a store’s sessions', () => {
  it('belong to the application the box runs — the very one its database holds, where it runs one', () => {
    const withDatabase = everyStore().filter(({ fs }) => databaseIn(fs) !== null);
    const disagreeing = withDatabase
      .filter((box) => {
        const database = databaseIn(box.fs);
        const application = applicationOf(box);
        return (
          database?.name !== application.name ||
          JSON.stringify(database.tables) !== JSON.stringify(application.tables)
        );
      })
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(withDatabase.length).toBeGreaterThan(5);
    expect({ count: disagreeing.length, sample: disagreeing.slice(0, 3) }).toEqual({
      count: 0,
      sample: [],
    });
  });

  it('are at least one on every store, at most one for each of the application’s users', () => {
    const offenders = everyStore()
      .filter((box) => {
        const sessions = sessionsIn(box.store);
        const usernames = sessions.map(({ value }) => value.username);
        return (
          sessions.length === 0 ||
          sessions.length > usersOf(applicationOf(box)).length ||
          new Set(usernames).size !== usernames.length ||
          sessions.some(({ key }) => !/^sess:[0-9a-f]{32}$/.test(key))
        );
      })
      .map(
        ({ essid, host, store }) => `${essid} ${host.hostname}: ${Object.keys(store.keys).join(' ')}`,
      );

    expect({ count: offenders.length, sample: offenders.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('each name one real login of the application, with its id and its role', () => {
    const offenders = everyStore().flatMap((box) => {
      const users = usersOf(applicationOf(box));
      return sessionsIn(box.store)
        .filter(
          ({ value }) =>
            !users.some(
              (row) =>
                row.id === value.user_id &&
                row.username === value.username &&
                row.role === value.role,
            ),
        )
        .map(({ key, value }) => `${box.essid} ${box.host.hostname} ${key} ${JSON.stringify(value)}`);
    });

    expect({ count: offenders.length, sample: offenders.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('come from the machine each person really uses', () => {
    const offenders = everyStore().flatMap((box) =>
      sessionsIn(box.store)
        .filter(({ value }) => value.ip !== machineOf(box, value.username))
        .map(
          ({ value }) =>
            `${box.essid} ${box.host.hostname} ${String(value.username)}@${String(value.ip)}`,
        ),
    );

    expect({ count: offenders.length, sample: offenders.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('began after the person signed up, were last seen before the world stopped, and carry a ttl in seconds', () => {
    const offenders = everyStore().flatMap((box) => {
      const users = usersOf(applicationOf(box));
      return sessionsIn(box.store)
        .filter(({ value }) => {
          const joined = String(users.find((row) => row.username === value.username)?.created_at);
          const { created_at: createdAt, last_seen: lastSeen, ttl } = value;
          return (
            typeof createdAt !== 'string' ||
            typeof lastSeen !== 'string' ||
            !DATETIME.test(createdAt) ||
            !DATETIME.test(lastSeen) ||
            createdAt < joined ||
            lastSeen < createdAt ||
            lastSeen > LAST_SECOND ||
            !Number.isInteger(ttl) ||
            Number(ttl) <= 0
          );
        })
        .map(({ key, value }) => `${box.essid} ${box.host.hostname} ${key} ${JSON.stringify(value)}`);
    });

    expect({ count: offenders.length, sample: offenders.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });
});
