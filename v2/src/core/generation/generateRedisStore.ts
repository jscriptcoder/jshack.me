/**
 * generateRedisStore — the key-value store a box that runs the daemon keeps.
 *
 * Deterministic from the caller's seed, like every other thing about a generated box,
 * so two occupants reading one store agree about what is in it.
 *
 * Its stream is its OWN. Appending these draws to the host filesystem's sequence would
 * move every value picked after them — including the octets the lease allocator
 * excludes when it issues an occupant an address, which would put a player on top of an
 * NPC. The same rule the web page, the `/etc` config, the database and the backdoor
 * each follow.
 *
 * The secret here belongs to the SERVICE, not to a person: a store answers to one
 * password and knows no accounts. That is the whole difference between this door and
 * the database next to it — there is no tier ladder to climb, only a lock that is
 * either there or is not. Four stores in ten have no lock at all, and on those the
 * finding IS the whole play.
 *
 * It is kept as a hash rather than beside the keys in plaintext because a sweep should
 * crack it through the same path every other door is cracked through, and because the
 * conf a box publishes is readable by a guest.
 */

import { asAbsPath } from '../types';
import { createPrng, type Prng } from './prng';
import { md5 } from './md5';
import { CRACK_CHANCE, drawPassword } from './passwordPools';
import { STORE_SPECS, type StoreSpec } from './pools/storeApps';
import { roleOfHostname } from './pools/hostnames';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { npcUsername } from './remoteHostFs';
import { databaseArchetype, datetimeAt } from './databaseApp';
import { WORLD_EPOCH } from '../cve/worldClock';
import type { Application } from './generateDatabase';
import type { MysqlRow } from '../mysql/types';
import { DATADIR_DIR } from '../redis/datadir';
import { REDIS_LOG_PATH } from '../logging/redisLog';
import type { RedisStore } from '../redis/types';

/** How much a store holds. A working application keeps dozens of keys; past eighty,
 *  `KEYS *` is a wall a player scrolls past rather than reads. */
const KEY_COUNT_RANGE = { min: 20, max: 80 } as const;

/** A developer's local copy of the application keeps a smaller working set, as its
 *  database keeps fewer rows. */
const DEV_KEY_COUNT_RANGE = { min: 20, max: 30 } as const;

/** How often a store is locked. Raised from legacy's quarter so that cracking is the
 *  main way in and the open store stays a real but secondary find — still better than
 *  one store in three, which is what makes it worth trying the door before the sweep. */
const REQUIREPASS_CHANCE = 0.6;

/** How many people are signed in when the world stops, at most. A store is a working
 *  set, and a working set is whoever used the application lately, not everyone who ever
 *  signed up. */
const MAX_SESSIONS = 6;

/** How far back a session still alive at the epoch can have begun. */
const SESSION_WINDOW_SECONDS = 14 * 86_400;

/** How long a session lives without being used: half an hour, an hour, a day, a week. */
const SESSION_TTLS: readonly number[] = [1800, 3600, 86_400, 604_800];

/** How far back a job still waiting at the epoch, or a lock still held, can reach. */
const RECENT_WINDOW_SECONDS = 2 * 86_400;

/** How long a job's lock is held before it expires on its own. */
const LOCK_TTLS: readonly number[] = [300, 600, 1800, 3600];

/** How far a feature has been rolled out, in percent. */
const ROLLOUTS: readonly number[] = [0, 10, 25, 50, 100];

/** Most jobs waiting on any one queue, and most rate-limit windows open at once. */
const MAX_JOBS = 4;
const MAX_RATE_WINDOWS = 4;
const MAX_PERMISSION_SETS = 3;

const LAST_SECOND = WORLD_EPOCH / 1000 - 1;

const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

type Keys = Readonly<Record<string, string>>;

/** A run of hex, the shape every token and secret in a real store takes. */
const hex = (prng: Prng, length: number): string =>
  Array.from({ length }, () => prng.nextInt(0, 15).toString(16)).join('');

const secondsOf = (datetime: string): number =>
  Date.parse(`${datetime.replace(' ', 'T')}Z`) / 1000;

/** The latest moment a row states, in seconds, so nothing about it is dated before it
 *  existed. */
const latestSecondOf = (row: MysqlRow): number =>
  Object.values(row)
    .filter((cell): cell is string => typeof cell === 'string' && DATETIME.test(cell))
    .reduce((latest, cell) => Math.max(latest, secondsOf(cell)), 0);

/** A moment no earlier than `floor` and no later than the world's last second, inside
 *  the recent window when the floor allows it. */
const recentSecond = (prng: Prng, floor: number, window: number): number =>
  prng.nextInt(Math.max(floor, LAST_SECOND - window), LAST_SECOND);

/**
 * Where each login's sessions come from: the machine that person uses. On a LAN the box's
 * own account signs in from the box and every other login is the account of a neighbour,
 * whose machine is where they sign in from. A deep box's logins have no machine of their
 * own anywhere a player can see, so their sessions reach the box directly.
 */
const originOf = ({
  essid,
  host,
  account,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly account: string;
}): ((username: string) => string) => {
  if (!isOnHomeLan(essid, host)) return () => host.ip;
  const neighbours = generateHomeLan(essid).hosts.filter(
    (candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip,
  );
  return (username) =>
    username === account
      ? host.ip
      : (neighbours.find((neighbour) => npcUsername(essid, neighbour) === username)?.ip ??
        host.ip);
};

const drawSessions = (
  prng: Prng,
  users: readonly MysqlRow[],
  origin: (username: string) => string,
): Keys => {
  const signedIn = prng.pickN(users, prng.nextInt(1, Math.min(users.length, MAX_SESSIONS)));
  return Object.fromEntries(
    signedIn.map((user) => {
      const username = String(user.username);
      const began = recentSecond(prng, secondsOf(String(user.created_at)), SESSION_WINDOW_SECONDS);
      const lastSeen = prng.nextInt(began, LAST_SECOND);
      return [
        `sess:${hex(prng, 32)}`,
        JSON.stringify({
          user_id: user.id,
          username,
          role: user.role,
          ip: origin(username),
          created_at: datetimeAt(began * 1000),
          last_seen: datetimeAt(lastSeen * 1000),
          ttl: prng.pick(SESSION_TTLS),
        }),
      ];
    }),
  );
};

/** Each queue the application runs, with the jobs waiting on it: every one about a row
 *  that exists, queued after that row last changed. */
const drawQueues = (prng: Prng, spec: StoreSpec, application: Application): Keys =>
  Object.fromEntries(
    spec.queues.flatMap((queue) => {
      const rows = application.tables[queue.table]?.rows ?? [];
      if (rows.length === 0) return [];
      const firstJob = prng.nextInt(100, 9000);
      const jobs = prng.pickN(rows, prng.nextInt(0, Math.min(rows.length, MAX_JOBS))).map((row, index) => ({
        id: firstJob + index,
        kind: queue.kind,
        table: queue.table,
        row_id: row.id,
        queued_at: datetimeAt(recentSecond(prng, latestSecondOf(row), RECENT_WINDOW_SECONDS) * 1000),
      }));
      return [[`queue:${queue.name}`, JSON.stringify(jobs)]];
    }),
  );

const drawLocks = (prng: Prng, spec: StoreSpec, users: readonly MysqlRow[]): Keys =>
  Object.fromEntries(
    prng.pickN(spec.locks, prng.nextInt(0, spec.locks.length)).map((job) => {
      const holder = prng.pick(users);
      return [
        `lock:${job}`,
        JSON.stringify({
          holder: holder.username,
          acquired_at: datetimeAt(
            recentSecond(prng, secondsOf(String(holder.created_at)), RECENT_WINDOW_SECONDS) * 1000,
          ),
          ttl: prng.pick(LOCK_TTLS),
        }),
      ];
    }),
  );

const drawPermissions = (prng: Prng, users: readonly MysqlRow[]): Keys =>
  Object.fromEntries(
    prng.pickN(users, prng.nextInt(1, Math.min(users.length, MAX_PERMISSION_SETS))).map((user) => {
      const admin = user.role === 'admin';
      return [
        `perms:${String(user.username)}`,
        JSON.stringify({ read: true, write: admin || prng.next() < 0.6, admin }),
      ];
    }),
  );

/** Rate-limit windows open for the application's routes, each keyed by the address of a
 *  machine one of its logins signs in from. */
const drawRateLimits = (prng: Prng, spec: StoreSpec, origins: readonly string[]): Keys => {
  const windows = spec.routes.flatMap((route) => origins.map((ip) => `ratelimit:${route}:${ip}`));
  return Object.fromEntries(
    prng
      .pickN(windows, prng.nextInt(1, Math.min(windows.length, MAX_RATE_WINDOWS)))
      .map((key) => [key, String(prng.nextInt(1, 120))]),
  );
};

const drawCounters = (prng: Prng, spec: StoreSpec): Keys =>
  Object.fromEntries(
    prng
      .pickN(spec.counters, prng.nextInt(2, spec.counters.length))
      .map((name) => [`stats:${name}`, String(prng.nextInt(3, 4800))]),
  );

const drawFlags = (prng: Prng, spec: StoreSpec): Keys =>
  Object.fromEntries(
    prng
      .pickN(spec.flags, prng.nextInt(1, spec.flags.length))
      .map((feature) => [
        `flag:${feature}`,
        JSON.stringify({ enabled: prng.next() < 0.7, rollout: prng.pick(ROLLOUTS) }),
      ]),
  );

/** Outside services that call the application back. Their secrets are the vendor's, and
 *  the vendor is outside the world: nothing in the game can reach the URL to try one. */
const drawWebhooks = (prng: Prng, spec: StoreSpec): Keys =>
  Object.fromEntries(
    prng
      .pickN(spec.webhooks, prng.nextInt(0, spec.webhooks.length))
      .map((vendor) => [
        `config:webhook:${vendor}`,
        JSON.stringify({ url: `https://hooks.${vendor}.com/${hex(prng, 12)}`, secret: hex(prng, 32) }),
      ]),
  );

/** Cached copies of the application's rows, exactly as its tables hold them — except a
 *  login's password hash, which no application keeps in a cache. */
const drawCache = (prng: Prng, spec: StoreSpec, application: Application, count: number): Keys => {
  const candidates = spec.cached.flatMap((table) =>
    (application.tables[table]?.rows ?? []).map((row) => ({ table, row })),
  );
  return Object.fromEntries(
    prng.pickN(candidates, Math.min(count, candidates.length)).map(({ table, row }) => {
      const { password_hash: _hash, ...withoutHash } = row;
      return [`cache:${table}:${String(row.id)}`, JSON.stringify(table === 'users' ? withoutHash : row)];
    }),
  );
};

/**
 * The store `host` keeps on `essid`: the working set of the application the box runs.
 *
 * Its sessions are the application's real logins, each signed in from the machine that
 * person uses — so an open store hands out with no credential the names `/etc/passwd`
 * refuses a guest. That is kept on purpose: it is the real-world exposed-store problem,
 * and it is what an open find is worth. What it never hands out is one of those names
 * attached to a password.
 */
export const generateRedisStore = ({
  seed,
  appSeed,
  essid,
  host,
  account,
  application,
}: {
  /** The stream the lock is drawn on, and nothing else. */
  readonly seed: string;
  /** The stream the keys are drawn on, so reshaping what a store holds never moves the
   *  lock that guards it. */
  readonly appSeed: string;
  readonly essid: string;
  readonly host: LanHost;
  /** The box's own account, which signs in from the box itself. */
  readonly account: string;
  /** What the box runs, whether or not mysqld serves it. */
  readonly application: Application;
}): RedisStore => {
  const prng = createPrng(appSeed);
  const spec = STORE_SPECS[databaseArchetype(essid, host)];
  const users = application.tables.users?.rows ?? [];
  const origin = originOf({ essid, host, account });
  const range =
    roleOfHostname(host.hostname) === 'workstation' ? DEV_KEY_COUNT_RANGE : KEY_COUNT_RANGE;
  const target = prng.nextInt(range.min, range.max);

  const working: Keys = {
    ...drawSessions(prng, users, origin),
    ...drawQueues(prng, spec, application),
    ...drawLocks(prng, spec, users),
    ...drawPermissions(prng, users),
    ...drawRateLimits(prng, spec, [...new Set(users.map((user) => origin(String(user.username))))]),
    ...drawCounters(prng, spec),
    ...drawFlags(prng, spec),
    ...drawWebhooks(prng, spec),
  };
  const cached = drawCache(prng, spec, application, target - Object.keys(working).length);

  // Shuffled, because a real `KEYS *` answers in the order of the server's hash table,
  // never grouped by what each key is for.
  const keys = Object.fromEntries(prng.shuffle(Object.entries({ ...working, ...cached })));

  return { keys, requirepassHash: drawStoreLock(seed) };
};

/**
 * The md5 of the password a store answers to, or `null` for one that answers to nobody.
 *
 * Drawn on the same two-pool ladder every other credential in the world is drawn on: a
 * password is crackable because it is in the wordlist the player holds, and nothing else
 * decides that. At the user tier rather than root's, because the sweep is meant to be the
 * way in rather than a wall.
 */
export const drawStoreLock = (seed: string): string | null => {
  const prng = createPrng(seed);
  return prng.next() < REQUIREPASS_CHANCE ? md5(drawPassword(prng, CRACK_CHANCE.npcUser)) : null;
};

/**
 * The conf a box publishes about the store it runs.
 *
 * Unlike the `/etc` file a box keeps for its ROLE, this one follows the SERVICE. A
 * store is likeliest on a webserver, whose role slot is already spoken for by its httpd
 * config — so a conf keyed by role would leave most stores undescribed, and the paths
 * below are the ones the rest of the box really uses. A box has to be able to say where
 * its own data is.
 *
 * It names no secret, which is what lets it sit on the rung a guest can read. Real Redis
 * keeps its password here in plaintext; this world keeps it hashed in the datadir
 * instead — the same divergence v2 already makes by putting hashes inline in
 * `/etc/passwd` where real Linux has `/etc/shadow`. A player who cats this looking for
 * `requirepass` learns what real Redis tells them: `NOAUTH Authentication required.`
 */
/** Where the conf sits. Declared beside the formatter rather than at each writer,
 *  because a box that published its conf somewhere else would be describing itself in a
 *  file nobody doing recon on it thinks to open. */
export const REDIS_CONF_PATH = asAbsPath('/etc/redis/redis.conf');

export const formatRedisConf = ({
  hostname,
  port,
  pidfilePath,
}: {
  readonly hostname: string;
  readonly port: number;
  readonly pidfilePath: string;
}): string =>
  [
    `# ${hostname}`,
    'bind 0.0.0.0',
    `port ${port}`,
    'daemonize yes',
    `pidfile ${pidfilePath}`,
    `logfile ${REDIS_LOG_PATH}`,
    `dir ${DATADIR_DIR}`,
  ].join('\n');
