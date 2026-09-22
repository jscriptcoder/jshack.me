import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { drawStoreLock, generateRedisStore } from './generateRedisStore';
import {
  ARCHETYPES,
  buildApplication,
  databaseArchetype,
  networkArchetype,
  type ArchetypeKey,
} from './databaseApp';
import { STORE_SPECS } from './pools/storeApps';
import { createPrng } from './prng';
import { crackableEssidPool } from './generateWifi';
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

/** One store with everything its truth is judged against: the application it serves,
 *  which kind that application is, and the machines its logins sign in from. */
type StoreCase = {
  readonly label: string;
  readonly store: RedisStore;
  readonly application: Application;
  readonly archetype: ArchetypeKey;
  readonly origins: ReadonlySet<unknown>;
  readonly workstation: boolean;
};

const worldCases = (): readonly StoreCase[] =>
  everyStore().map((box) => {
    const application = applicationOf(box);
    return {
      label: `${box.essid} ${box.host.hostname}`,
      store: box.store,
      application,
      archetype: databaseArchetype(box.essid, box.host),
      origins: new Set(usersOf(application).map((row) => machineOf(box, row.username))),
      workstation: roleOfHostname(box.host.hostname) === 'workstation',
    };
  });

const SAMPLES_PER_ARCHETYPE = 20;

/** Twenty stores of every application, beside the world's: several applications occur on
 *  no catalog network, and a rule none of the world's stores exercises is untested. */
const sampleCases = (): readonly StoreCase[] =>
  (Object.keys(ARCHETYPES) as ArchetypeKey[]).flatMap((archetype) =>
    Array.from({ length: SAMPLES_PER_ARCHETYPE }, (_, index) => {
      const prefix =
        archetype === 'cms' ? 'portal' : archetype === 'api' ? 'api' : archetype === 'mail' ? 'mail' : 'db';
      const essid =
        crackableEssidPool.find((candidate) => networkArchetype(candidate) === archetype) ??
        'BEAN-THERE-WIFI';
      const host = { ip: `10.40.0.${index + 1}`, hostname: `${prefix}-${index + 1}`, kind: 'machine' as const };
      const people = ['mrodriguez', 'jchen', 'agarcia', 'hkim', 'tnguyen'].slice(0, 1 + (index % 5));
      const application = buildApplication({
        prng: createPrng(`sample-${archetype}-${index}`),
        essid,
        host,
        people,
      });
      return {
        label: `${archetype} sample ${index}`,
        store: generateRedisStore({
          seed: `sample-lock-${archetype}-${index}`,
          appSeed: `sample-store-${archetype}-${index}`,
          essid,
          host,
          account: people[0] ?? '',
          application,
        }),
        application,
        archetype,
        origins: new Set([host.ip]),
        workstation: false,
      };
    }),
  );

const allCases = (): readonly StoreCase[] => [...worldCases(), ...sampleCases()];

const entriesUnder = (store: RedisStore, prefix: string) =>
  Object.entries(store.keys)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({ name: key.slice(prefix.length), value }));

const rowOf = (application: Application, table: string, id: unknown): MysqlRow | undefined =>
  application.tables[table]?.rows.find((row) => row.id === id);

const userNamed = (application: Application, username: unknown): MysqlRow | undefined =>
  usersOf(application).find((row) => row.username === username);

/** The latest moment a row states, so nothing about it is dated before it existed. */
const latestMomentOf = (row: MysqlRow): string =>
  Object.values(row)
    .filter((cell): cell is string => typeof cell === 'string' && DATETIME.test(cell))
    .reduce((latest, cell) => (cell > latest ? cell : latest), '');

const verdict = (offenders: readonly string[]) => ({
  count: offenders.length,
  sample: offenders.slice(0, 3),
});
const CLEAN = { count: 0, sample: [] };

describe('what a store holds', () => {
  it('is a working set of 20 to 80 keys, and a developer’s copy of 20 to 30', () => {
    const offenders = allCases()
      .filter(({ store, workstation }) => {
        const size = Object.keys(store.keys).length;
        return workstation ? size < 20 || size > 30 : size < 20 || size > 80;
      })
      .map(({ label, store }) => `${label}: ${Object.keys(store.keys).length}`);

    expect(worldCases().some(({ workstation }) => workstation)).toBe(true);
    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('keys everything by the application’s own families, and nothing else', () => {
    const families = /^(sess|cache|queue|lock|perms|ratelimit|stats|flag|config:webhook):/;
    const offenders = allCases().flatMap(({ label, store }) =>
      Object.keys(store.keys)
        .filter((key) => !families.test(key))
        .map((key) => `${label}: ${key}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('caches rows exactly as the application holds them, from the tables it caches, never a password hash', () => {
    const offenders = allCases().flatMap(({ label, store, application, archetype }) =>
      entriesUnder(store, 'cache:')
        .filter(({ name, value }) => {
          const [table = '', id = ''] = name.split(':');
          const row = rowOf(application, table, Number(id));
          if (row === undefined || !STORE_SPECS[archetype].cached.includes(table)) return true;
          const { password_hash: _hash, ...cached } = row;
          return value !== JSON.stringify(table === 'users' ? cached : row);
        })
        .map(({ name }) => `${label}: cache:${name}`),
    );

    expect(allCases().every(({ store }) => entriesUnder(store, 'cache:').length > 0)).toBe(true);
    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('queues jobs that each point at a real row of the queue’s own table, queued after it existed', () => {
    const offenders = allCases().flatMap(({ label, store, application, archetype }) =>
      entriesUnder(store, 'queue:').flatMap(({ name, value }) => {
        const queue = STORE_SPECS[archetype].queues.find((candidate) => candidate.name === name);
        const jobs = JSON.parse(value) as readonly Record<string, unknown>[];
        return jobs
          .filter((job) => {
            const row = rowOf(application, String(job.table), job.row_id);
            const queuedAt = job.queued_at;
            return (
              queue === undefined ||
              job.kind !== queue.kind ||
              job.table !== queue.table ||
              row === undefined ||
              typeof queuedAt !== 'string' ||
              !DATETIME.test(queuedAt) ||
              queuedAt < latestMomentOf(row) ||
              queuedAt > LAST_SECOND ||
              !Number.isInteger(job.id)
            );
          })
          .map((job) => `${label}: queue:${name} ${JSON.stringify(job)}`);
      }),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('is locked only by real logins, after they signed up, for the jobs the application runs', () => {
    const offenders = allCases().flatMap(({ label, store, application, archetype }) =>
      entriesUnder(store, 'lock:')
        .filter(({ name, value }) => {
          const lock = JSON.parse(value) as Record<string, unknown>;
          const holder = userNamed(application, lock.holder);
          const acquiredAt = lock.acquired_at;
          return (
            !STORE_SPECS[archetype].locks.includes(name) ||
            holder === undefined ||
            typeof acquiredAt !== 'string' ||
            !DATETIME.test(acquiredAt) ||
            acquiredAt < String(holder.created_at) ||
            acquiredAt > LAST_SECOND ||
            !Number.isInteger(lock.ttl) ||
            Number(lock.ttl) <= 0
          );
        })
        .map(({ name, value }) => `${label}: lock:${name} ${value}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('grants permissions to real logins, and admin exactly to the administrators', () => {
    const offenders = allCases().flatMap(({ label, store, application }) =>
      entriesUnder(store, 'perms:')
        .filter(({ name, value }) => {
          const login = userNamed(application, name);
          const perms = JSON.parse(value) as Record<string, unknown>;
          return login === undefined || perms.admin !== (login.role === 'admin');
        })
        .map(({ name, value }) => `${label}: perms:${name} ${value}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('rate-limits the application’s own routes, for machines its logins really sign in from', () => {
    const offenders = allCases().flatMap(({ label, store, archetype, origins }) =>
      entriesUnder(store, 'ratelimit:')
        .filter(({ name, value }) => {
          const [route = '', ip = ''] = name.split(':');
          return (
            !STORE_SPECS[archetype].routes.includes(route) ||
            !origins.has(ip) ||
            !/^\d+$/.test(value)
          );
        })
        .map(({ name }) => `${label}: ratelimit:${name}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('counts, flags and calls out in the application’s own words', () => {
    const offenders = allCases().flatMap(({ label, store, archetype }) => {
      const spec = STORE_SPECS[archetype];
      const counters = entriesUnder(store, 'stats:').filter(
        ({ name, value }) => !spec.counters.includes(name) || !/^\d+$/.test(value),
      );
      const flags = entriesUnder(store, 'flag:').filter(({ name, value }) => {
        const flag = JSON.parse(value) as Record<string, unknown>;
        return (
          !spec.flags.includes(name) ||
          typeof flag.enabled !== 'boolean' ||
          !Number.isInteger(flag.rollout) ||
          Number(flag.rollout) < 0 ||
          Number(flag.rollout) > 100
        );
      });
      const webhooks = entriesUnder(store, 'config:webhook:').filter(({ name, value }) => {
        const webhook = JSON.parse(value) as Record<string, unknown>;
        return (
          !spec.webhooks.includes(name) ||
          JSON.stringify(Object.keys(webhook)) !== JSON.stringify(['url', 'secret']) ||
          !String(webhook.url).startsWith(`https://hooks.${name}.com/`) ||
          !/^[0-9a-f]+$/.test(String(webhook.secret))
        );
      });
      return [...counters, ...flags, ...webhooks].map(({ name }) => `${label}: ${name}`);
    });

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('reaches every counter, flag, lock, queue, route, webhook and cached table an application declares', () => {
    const cases = sampleCases();
    const unreached = (Object.keys(STORE_SPECS) as ArchetypeKey[]).flatMap((archetype) => {
      const keys = cases
        .filter((candidate) => candidate.archetype === archetype)
        .flatMap(({ store }) => Object.keys(store.keys));
      const spec = STORE_SPECS[archetype];
      const declared = [
        ...spec.counters.map((name) => `stats:${name}`),
        ...spec.flags.map((name) => `flag:${name}`),
        ...spec.locks.map((name) => `lock:${name}`),
        ...spec.queues.map(({ name }) => `queue:${name}`),
        ...spec.routes.map((name) => `ratelimit:${name}:`),
        ...spec.webhooks.map((name) => `config:webhook:${name}`),
        ...spec.cached.map((name) => `cache:${name}:`),
      ];
      return declared
        .filter((prefix) => !keys.some((key) => key.startsWith(prefix)))
        .map((prefix) => `${archetype}: ${prefix}`);
    });

    expect(verdict(unreached)).toEqual(CLEAN);
  });
});
