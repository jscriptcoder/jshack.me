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
import { REDIS_KEY_GENERATORS, hex, type StoreSubject } from './pools/redis';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { npcUsername } from './remoteHostFs';
import { datetimeAt } from './databaseApp';
import { WORLD_EPOCH } from '../cve/worldClock';
import type { Application } from './generateDatabase';
import type { MysqlRow } from '../mysql/types';
import { DATADIR_DIR } from '../redis/datadir';
import { REDIS_LOG_PATH } from '../logging/redisLog';
import type { RedisStore } from '../redis/types';

/** How much a store holds. Fewer than eight reads as a fixture rather than a working
 *  set; more than fifteen is a wall of text a player scrolls past. Legacy's range,
 *  kept. */
const KEY_COUNT_RANGE = { min: 8, max: 15 } as const;

/** How often a store is locked. Raised from legacy's quarter so that cracking is the
 *  main way in and the open store stays a real but secondary find — still better than
 *  one store in three, which is what makes it worth trying the door before the sweep. */
const REQUIREPASS_CHANCE = 0.6;

/** Draws per key wanted. Two generators can land on the same key — every box has one
 *  `app:config` and one `config:smtp` — so a run of draws yields fewer entries than it
 *  makes, and the store would come up short without room to try again. */
const ATTEMPTS_PER_KEY = 3;

/** How many people are signed in when the world stops, at most. A store is a working
 *  set, and a working set is whoever used the application lately, not everyone who ever
 *  signed up. */
const MAX_SESSIONS = 6;

/** How far back a session still alive at the epoch can have begun. */
const SESSION_WINDOW_SECONDS = 14 * 86_400;

/** How long a session lives without being used: half an hour, an hour, a day, a week. */
const SESSION_TTLS: readonly number[] = [1800, 3600, 86_400, 604_800];

const LAST_SECOND = WORLD_EPOCH / 1000 - 1;

const secondsOf = (datetime: string): number =>
  Date.parse(`${datetime.replace(' ', 'T')}Z`) / 1000;

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
): Readonly<Record<string, string>> => {
  const signedIn = prng.pickN(users, prng.nextInt(1, Math.min(users.length, MAX_SESSIONS)));
  return Object.fromEntries(
    signedIn.map((user) => {
      const username = String(user.username);
      const earliest = Math.max(
        secondsOf(String(user.created_at)),
        LAST_SECOND - SESSION_WINDOW_SECONDS,
      );
      const began = prng.nextInt(earliest, LAST_SECOND);
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

const drawKeys = (
  prng: Prng,
  subject: StoreSubject,
  target: number,
  initial: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  // Shuffled and then cycled rather than drawn one at a time: it spends each generator
  // once before repeating any, so a store reads as a working set rather than as three
  // copies of whichever shape the seed happened to favour.
  const shuffled = prng.shuffle(REDIS_KEY_GENERATORS);
  const attempts = Array.from({ length: ATTEMPTS_PER_KEY }, () => shuffled).flat();

  return attempts.reduce<Readonly<Record<string, string>>>((drawn, generator) => {
    if (Object.keys(drawn).length >= target) return drawn;
    const { key, value } = generator(prng, subject);
    return { ...drawn, [key]: value };
  }, initial);
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
  const users = application.tables.users?.rows ?? [];
  const sessions = drawSessions(prng, users, originOf({ essid, host, account }));
  const keys = drawKeys(
    prng,
    { people: users.map((user) => String(user.username)), hostname: host.hostname },
    Math.max(prng.nextInt(KEY_COUNT_RANGE.min, KEY_COUNT_RANGE.max), Object.keys(sessions).length),
    sessions,
  );

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
