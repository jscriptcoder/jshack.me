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

import { createPrng, type Prng } from './prng';
import { md5 } from './md5';
import { CRACK_CHANCE, drawPassword } from './passwordPools';
import { REDIS_KEY_GENERATORS, type StoreSubject } from './pools/redis';
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

const drawKeys = (
  prng: Prng,
  subject: StoreSubject,
  target: number,
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
  }, {});
};

/**
 * The store `hostname` keeps.
 *
 * `people` are the box's REAL non-guest accounts, and the keys name them: an open store
 * hands out with no credential the names `/etc/passwd` refuses a guest. That is kept on
 * purpose — it is the real-world exposed-store problem, and it is what an open find is
 * worth. What it never hands out is one of those names attached to a password.
 */
export const generateRedisStore = ({
  seed,
  hostname,
  people,
}: {
  readonly seed: string;
  readonly hostname: string;
  readonly people: readonly string[];
}): RedisStore => {
  const prng = createPrng(seed);
  const keys = drawKeys(
    prng,
    { people, hostname },
    prng.nextInt(KEY_COUNT_RANGE.min, KEY_COUNT_RANGE.max),
  );

  // Drawn on the same two-pool ladder every other credential in the world is drawn on:
  // a password is crackable because it is in the wordlist the player holds, and nothing
  // else decides that. At the user tier rather than root's, because the sweep is meant
  // to be the way in rather than a wall.
  const requirepassHash =
    prng.next() < REQUIREPASS_CHANCE ? md5(drawPassword(prng, CRACK_CHANCE.npcUser)) : null;

  return { keys, requirepassHash };
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
