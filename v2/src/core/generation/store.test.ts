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
import { ALL_GENERATED_PASSWORDS, CRACK_CHANCE, CRACKABLE_PASSWORDS } from './passwordPools';
import { md5 } from './md5';
import { storeIn } from '../redis/datadir';
import { databaseIn } from '../mysql/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { lanZoneName } from '../network/resolveName';
import {
  ALL_ESSIDS,
  deepBoxes,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';
import type { RedisStore } from '../redis/types';
import type { Directory } from '../filesystem/types';
import type { MysqlRow } from '../mysql/types';

type StoreBox = Box & { readonly store: RedisStore; readonly fs: Directory };

/** Every store the world holds: each LAN box that runs redis, and each deep box that
 *  does. Built inside each test rather than cached, so a mutation run credits the test
 *  that actually reads the generator. */
const everyStore = (): readonly StoreBox[] => {
  const runsRedis = ({ essid, host }: Box) =>
    hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.redis);
  const lan = lanBoxes(ALL_ESSIDS)
    .filter(runsRedis)
    .map(({ essid, host }) => ({ essid, host, fs: buildRemoteHostFs(essid, host) }));
  const deep = deepBoxes(ALL_ESSIDS)
    .filter(runsRedis)
    .map(({ essid, host }) => ({ essid, host, fs: buildDeepHostFs(essid, host) }));
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
  readonly essid: string;
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
      essid: box.essid,
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
        essid,
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

/** The earliest moment any key under `prefix` states, anywhere in the world. */
const earliestMomentUnder = (cases: readonly StoreCase[], prefix: string): string =>
  cases
    .flatMap(({ store }) => entriesUnder(store, prefix))
    .flatMap(({ value }) => [...value.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)])
    .reduce((earliest, match) => (match[0] < earliest ? match[0] : earliest), LAST_SECOND);

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

  it('reaches back over the fortnight for its sessions, and over the last days for its jobs and locks', () => {
    const cases = allCases();

    // Not everybody signed in, and not every job was queued, in the world's final second:
    // a working set that all carries one timestamp reads as a snapshot, not as use.
    const crowded = [
      { prefix: 'sess:', by: '2026-07-04 23:59:59' },
      { prefix: 'queue:', by: '2026-07-11 11:59:59' },
      { prefix: 'lock:', by: '2026-07-11 11:59:59' },
    ]
      .map(({ prefix, by }) => ({ prefix, by, earliest: earliestMomentUnder(cases, prefix) }))
      .filter(({ by, earliest }) => earliest >= by)
      .map(({ prefix, earliest }) => `${prefix} nothing before ${earliest}`);

    expect(verdict(crowded)).toEqual(CLEAN);
  });
});

/** Every value a key holds, as `[field, text]` pairs down to its leaves: a structured
 *  value is JSON, and a plain one is a single leaf with no field. */
const leavesOf = (value: string): readonly (readonly [string, string])[] => {
  const walk = (node: unknown, field: string): readonly (readonly [string, string])[] => {
    if (Array.isArray(node)) return node.flatMap((item) => walk(item, field));
    if (node !== null && typeof node === 'object') {
      return Object.entries(node).flatMap(([name, child]) => walk(child, name));
    }
    return [[field, String(node)]];
  };
  try {
    return walk(JSON.parse(value), '');
  } catch {
    return [['', value]];
  }
};

/** Every field name a value carries, at any depth. */
const fieldsOf = (value: string): readonly string[] => {
  const walk = (node: unknown): readonly string[] => {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (node !== null && typeof node === 'object') {
      return Object.entries(node).flatMap(([name, child]) => [name, ...walk(child)]);
    }
    return [];
  };
  try {
    return walk(JSON.parse(value));
  } catch {
    return [];
  }
};

const POOL_WORDS = new Set(ALL_GENERATED_PASSWORDS);
const PASSWORD_FIELDS = new Set(['password', 'pass', 'pw', 'passwd', 'db_url']);

describe('the shape of a store', () => {
  it('holds sessions, queues, permissions, rate limits, counters, flags and cached rows in every store', () => {
    const always = ['sess:', 'queue:', 'perms:', 'ratelimit:', 'stats:', 'flag:', 'cache:'];
    const offenders = allCases().flatMap(({ label, store }) =>
      always
        .filter((family) => !Object.keys(store.keys).some((key) => key.startsWith(family)))
        .map((family) => `${label}: no ${family}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('holds a lock and an outside webhook in some store of every application', () => {
    const cases = sampleCases();
    const missing = (Object.keys(STORE_SPECS) as ArchetypeKey[]).flatMap((archetype) => {
      const keys = cases
        .filter((candidate) => candidate.archetype === archetype)
        .flatMap(({ store }) => Object.keys(store.keys));
      return ['lock:', 'config:webhook:']
        .filter((family) => !keys.some((key) => key.startsWith(family)))
        .map((family) => `${archetype}: no ${family}`);
    });

    expect(verdict(missing)).toEqual(CLEAN);
  });

  it('names every key the way its family does, with no empty or spaced part', () => {
    const IP = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
    const shapes = [
      /^sess:[0-9a-f]{32}$/,
      /^cache:[a-z_]+:\d+$/,
      /^queue:[a-z_]+$/,
      /^lock:[a-z_]+$/,
      /^perms:[a-z0-9_.-]+$/,
      new RegExp(`^ratelimit:[a-z0-9_]+:${IP}$`),
      /^stats:[a-z0-9_]+$/,
      /^flag:[a-z0-9_]+$/,
      /^config:webhook:[a-z]+$/,
    ];
    const offenders = allCases().flatMap(({ label, store }) =>
      Object.keys(store.keys)
        .filter((key) => !shapes.some((shape) => shape.test(key)))
        .map((key) => `${label}: ${key}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('names what each queued job does as the application does, and numbers a queue’s jobs in order', () => {
    const offenders = allCases().flatMap(({ label, store }) =>
      entriesUnder(store, 'queue:').flatMap(({ name, value }) => {
        const jobs = JSON.parse(value) as readonly Record<string, unknown>[];
        const ids = jobs.map((job) => Number(job.id));
        const inOrder = ids.every((id, index) => index === 0 || id === (ids[index - 1] ?? 0) + 1);
        const misnamed = jobs.filter((job) => !/^[a-z]+\.[a-z_]+$/.test(String(job.kind)));
        return inOrder && misnamed.length === 0 ? [] : [`${label}: queue:${name} ${value}`];
      }),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('lets every login read, lets every administrator write, and lets some others write and not all', () => {
    const permissions = allCases().flatMap(({ store, application }) =>
      entriesUnder(store, 'perms:').map(({ name, value }) => ({
        login: userNamed(application, name),
        perms: JSON.parse(value) as Record<string, unknown>,
      })),
    );
    const others = permissions.filter(({ login }) => login?.role !== 'admin');

    expect(permissions.filter(({ perms }) => perms.read !== true)).toEqual([]);
    expect(
      permissions.filter(({ login, perms }) => login?.role === 'admin' && perms.write !== true),
    ).toEqual([]);
    expect(others.some(({ perms }) => perms.write === true)).toBe(true);
    expect(others.some(({ perms }) => perms.write === false)).toBe(true);
  });

  it('has some features switched on and some off', () => {
    const flags = allCases().flatMap(({ store }) =>
      entriesUnder(store, 'flag:').map(({ value }) => JSON.parse(value) as Record<string, unknown>),
    );

    expect(flags.some((flag) => flag.enabled === true)).toBe(true);
    expect(flags.some((flag) => flag.enabled === false)).toBe(true);
  });
});

describe('what a store never holds', () => {
  it('no password: no field named for one, and no word a player’s wordlist would try', () => {
    const offenders = allCases().flatMap(({ label, store }) =>
      Object.entries(store.keys).flatMap(([key, value]) => [
        ...fieldsOf(value)
          .filter((field) => PASSWORD_FIELDS.has(field))
          .map((field) => `${label}: ${key} has ${field}`),
        // What the store composes itself. A cached row is the database's own cells copied
        // exactly (a wiki may well tag a page `admin`), and those answer to the
        // database's rules; a login's role says what the login is, and `admin` is a role
        // before it is anybody's password.
        ...(key.startsWith('cache:') ? [] : leavesOf(value))
          .filter(([field, text]) => field !== 'role' && POOL_WORDS.has(text))
          .map(([field, text]) => `${label}: ${key} ${field}=${text}`),
      ]),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('no version, in any key or any value', () => {
    const offenders = allCases().flatMap(({ label, store }) =>
      Object.entries(store.keys)
        .filter(([key, value]) => softwareVersionsIn(`${key} ${value}`).length > 0)
        .map(([key, value]) => `${label}: ${key} ${softwareVersionsIn(`${key} ${value}`).join(',')}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('no unfilled slot', () => {
    const offenders = allCases().flatMap(({ label, store }) =>
      Object.entries(store.keys)
        .filter(([key, value]) => /\{\{|\}\}|undefined|NaN|\[object/.test(`${key} ${value}`))
        .map(([key]) => `${label}: ${key}`),
    );

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('no address off the network’s own zone, and no host outside the world but a webhook’s vendor', () => {
    const offenders = allCases().flatMap(({ label, essid, store }) => {
      const zone = lanZoneName(essid);
      return Object.entries(store.keys).flatMap(([key, value]) => {
        const text = `${key} ${value}`;
        const offZone = [...text.matchAll(/@([a-z0-9.-]+)/g)]
          .map((match) => match[1])
          .filter((domain) => domain !== zone);
        const invented = [...text.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:lan|local|internal)\b/g)]
          .map((match) => match[0])
          .filter((name) => name !== zone && !name.endsWith(`.${zone}`));
        const outside = key.startsWith('config:webhook:')
          ? []
          : [...text.matchAll(/https?:\/\/[^\s"]+/g)].map((match) => match[0]);
        return [...offZone, ...invented, ...outside].map((found) => `${label}: ${key} ${found}`);
      });
    });

    expect(verdict(offenders)).toEqual(CLEAN);
  });

  it('no date outside the application’s life', () => {
    const offenders = allCases().flatMap(({ label, store, application }) => {
      const installed = usersOf(application)
        .map((row) => String(row.created_at))
        .reduce((earliest, created) => (created < earliest ? created : earliest));
      return Object.entries(store.keys).flatMap(([key, value]) =>
        [...value.matchAll(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/g)]
          .map((match) => match[0].replace('T', ' '))
          .filter((moment) => moment < installed || moment > LAST_SECOND)
          .map((moment) => `${label}: ${key} ${moment}`),
      );
    });

    expect(verdict(offenders)).toEqual(CLEAN);
  });
});

/** What a store chose to hold: which queues, locks, counters, flags and webhooks. The
 *  keys naming rows, logins and addresses are set aside, because those differ with the
 *  application and the network whatever the store itself draws, and would make any two
 *  stores differ without either reading any differently. */
const shapeOf = (store: RedisStore): string =>
  Object.keys(store.keys)
    .filter((key) => /^(queue|lock|stats|flag|config:webhook):/.test(key))
    .sort()
    .join(' ');

describe('stores read differently', () => {
  it('never alike on one network', () => {
    const cases = worldCases();
    const alike = [...new Set(cases.map(({ essid }) => essid))].filter((essid) => {
      const shapes = cases.filter((candidate) => candidate.essid === essid).map(({ store }) => shapeOf(store));
      return new Set(shapes).size !== shapes.length;
    });

    expect(verdict(alike)).toEqual(CLEAN);
  });

  it('almost never alike across the world', () => {
    const shapes = worldCases().map(({ store }) => shapeOf(store));

    expect(new Set(shapes).size / shapes.length).toBeGreaterThanOrEqual(0.9);
  });
});
