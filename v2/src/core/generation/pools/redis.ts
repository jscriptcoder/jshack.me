/**
 * What a generated key-value store holds, keyed by the shape of the thing stored.
 *
 * These are legacy's generators, ported with their weights. They are web-application
 * state — sessions, cached profiles, permission sets, rate-limit counters, queue
 * depths — which is the evidence that decided where a store is PLACED: legacy put
 * redis on database boxes only, while generating the working set of the box next door
 * that serves the pages.
 *
 * Two rules govern everything here.
 *
 * **Nothing generated is loot that works.** A store is believability, not a shortcut.
 * This is where that erodes fastest, because a session token and an API key beg to be
 * spent in a way a table of customers does not — so no value here resolves anywhere,
 * and every service a value names (`smtp`, `ldap`, an S3 bucket, a webhook endpoint)
 * exists nowhere in the world for it to be tried against.
 *
 * **A name the box really carries never carries a secret.** The people a store names
 * ARE the box's own accounts, deliberately: an open store hands out with no credential
 * the names `/etc/passwd` refuses a guest, which is the real-world exposed-store
 * problem and the reason an open find is worth something. But a real name attached to
 * a password is a different thing entirely — it reads as a working credential right up
 * until a player spends an attempt on it. So the one generator that mints a credential
 * pair draws its user from the pool of database service accounts, which name nobody
 * who lives on the box. The database generator beside this one draws the same line.
 *
 * Every value that names a domain names the box's OWN hostname. Legacy hardcoded
 * `corp.local` everywhere; there is no company identity in this world for that to mean,
 * and the store of a box that serves a page should agree with the page.
 */

import type { Prng } from '../prng';
import { MYSQL_USERNAMES } from './database';

/** Who the store is about, and what box it sits on. `people` are the box's real
 *  non-guest accounts — the store is about the machine it is on, not about a company
 *  nobody can visit. */
export type StoreSubject = {
  readonly people: readonly string[];
  readonly hostname: string;
};

type RedisKeyGenerator = (
  prng: Prng,
  subject: StoreSubject,
) => { readonly key: string; readonly value: string };

/** A run of hex, the shape every token and secret in a real store takes. */
const hex = (prng: Prng, length: number): string =>
  Array.from({ length }, () => prng.nextInt(0, 15).toString(16)).join('');

// --- Session tokens ---

const sessionBasic: RedisKeyGenerator = (prng, { people }) => ({
  key: `sess:${hex(prng, 16)}`,
  value: JSON.stringify({
    username: prng.pick(people),
    ip: `10.${prng.nextInt(0, 255)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`,
    role: prng.pick(['admin', 'user', 'operator']),
    created: '2024-01-15T08:30:00Z',
  }),
});

const sessionJwt: RedisKeyGenerator = (prng, { people, hostname }) => ({
  key: `sess:jwt:${hex(prng, 24)}`,
  value: JSON.stringify({
    sub: prng.pick(people),
    iat: 1705312200,
    exp: 1705398600,
    scope: prng.pick(['read', 'read write', 'admin', 'read write delete']),
    iss: `auth.${hostname}`,
  }),
});

// --- Cached user profiles ---

const userCache: RedisKeyGenerator = (prng, { people, hostname }) => {
  const person = prng.pick(people);
  return {
    key: `cache:user:${prng.nextInt(1000, 9999)}`,
    value: JSON.stringify({
      username: person,
      email: `${person}@${hostname}`,
      role: prng.pick(['admin', 'editor', 'viewer', 'analyst', 'operator']),
      last_login: '2024-01-15T14:22:00Z',
    }),
  };
};

const userPermissions: RedisKeyGenerator = (prng, { people }) => ({
  key: `perms:${prng.pick(people)}`,
  value: JSON.stringify({
    read: true,
    write: prng.next() < 0.5,
    admin: prng.next() < 0.2,
    groups: prng.pick([
      ['staff', 'dev'],
      ['staff', 'ops'],
      ['staff', 'dev', 'admin'],
      ['contractors'],
    ]),
  }),
});

// --- API keys ---

const API_KEY_NAMES: readonly string[] = [
  'prod',
  'staging',
  'internal',
  'webhook',
  'monitoring',
  'backup',
  'ci',
  'mobile',
  'partner',
  'legacy',
];

const apiKey: RedisKeyGenerator = (prng) => ({
  key: `api:key:${prng.pick(API_KEY_NAMES)}`,
  value: hex(prng, 32),
});

// --- App config variants ---

const APP_PASSWORDS: readonly string[] = [
  's3cret!',
  'db_p4ss',
  'pr0d_db!',
  'r3pl1ca',
  'b4ckup_pw',
  'qu3ry_usr',
];

/** The one generator that mints a user-and-password pair, so the one that must name
 *  nobody the box really carries. It draws from the database service accounts for the
 *  same reason the database's own credentials do: `/etc/passwd` cannot answer who you
 *  are to a database, so a name from that pool is a name no `ssh` can be pointed at. */
const configDb: RedisKeyGenerator = (prng, { hostname }) => ({
  key: 'app:config',
  value: JSON.stringify({
    db_url: `mysql://${prng.pick(MYSQL_USERNAMES)}:${prng.pick(APP_PASSWORDS)}@localhost:3306/app_prod`,
    cache_ttl: prng.nextInt(300, 3600),
    debug: false,
    version: `${prng.nextInt(1, 5)}.${prng.nextInt(0, 9)}.${prng.nextInt(0, 20)}`,
    host: hostname,
  }),
});

const configSmtp: RedisKeyGenerator = (prng, { hostname }) => ({
  key: 'config:smtp',
  value: JSON.stringify({
    host: prng.pick([`smtp.${hostname}`, `mail.${hostname}`, `relay.${hostname}`]),
    port: prng.pick([25, 587, 465]),
    username: prng.pick(['noreply', 'alerts', 'postmaster', 'mailer']),
    password: prng.pick(['m41l_s3nd!', 'r3l4y_p4ss', 'smtp_4uth', 'p0stm4st3r']),
    tls: true,
  }),
});

const configS3: RedisKeyGenerator = (prng) => ({
  key: 'config:s3',
  value: JSON.stringify({
    bucket: prng.pick(['corp-backups', 'app-uploads', 'log-archive', 'data-exports']),
    region: prng.pick(['us-east-1', 'eu-west-1', 'ap-southeast-1']),
    access_key: `AKIA${Array.from({ length: 16 }, () =>
      prng.pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.split('')),
    ).join('')}`,
    secret_key: hex(prng, 40),
  }),
});

const configLdap: RedisKeyGenerator = (prng, { hostname }) => ({
  key: 'config:ldap',
  value: JSON.stringify({
    url: `ldap://${prng.pick(['dc01', 'ldap', 'ad-server', 'directory'])}.${hostname}:389`,
    bind_dn: `cn=${prng.pick(['svc-app', 'ldap-reader', 'bind-user'])},ou=services,dc=${hostname}`,
    bind_password: prng.pick(['Ld4p_b1nd!', 'r34d_0nly', 's3rv1c3_pw', 'b1nd_4uth']),
    base_dn: `dc=${hostname}`,
  }),
});

// --- Tokens and locks ---

const resetToken: RedisKeyGenerator = (prng, { people }) => ({
  key: `token:reset:${hex(prng, 20)}`,
  value: JSON.stringify({
    username: prng.pick(people),
    expires: '2024-01-16T08:30:00Z',
    used: false,
  }),
});

const deployLock: RedisKeyGenerator = (prng, { people }) => ({
  key: `lock:${prng.pick(['deploy', 'migration', 'maintenance', 'backup'])}`,
  value: JSON.stringify({
    holder: prng.pick(people),
    acquired: '2024-01-15T18:00:00Z',
    ttl: prng.nextInt(300, 1800),
  }),
});

// --- Rate limiting and counters ---

const rateLimit: RedisKeyGenerator = (prng) => ({
  key: `ratelimit:${prng.nextInt(10, 192)}.${prng.nextInt(0, 255)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`,
  value: String(prng.nextInt(1, 150)),
});

const STATS_COUNTER_NAMES: readonly string[] = [
  'requests',
  'errors',
  'logins',
  'cache_hits',
  'cache_misses',
  'active_users',
  'failed_auth',
  'api_calls',
  'db_queries',
  'ws_connections',
];

const statsCounter: RedisKeyGenerator = (prng) => ({
  key: `stats:${prng.pick(STATS_COUNTER_NAMES)}`,
  value: String(prng.nextInt(100, 99999)),
});

// --- Queue and cron ---

const QUEUE_NAMES: readonly string[] = [
  'jobs',
  'emails',
  'notifications',
  'reports',
  'exports',
  'imports',
];

const queueCount: RedisKeyGenerator = (prng) => ({
  key: `queue:${prng.pick(QUEUE_NAMES)}`,
  value: String(prng.nextInt(0, 50)),
});

const cronLastRun: RedisKeyGenerator = (prng) => ({
  key: `cron:last_run:${prng.pick(['backup', 'cleanup', 'report', 'sync', 'health_check', 'rotate_logs'])}`,
  value: JSON.stringify({
    status: prng.pick(['ok', 'ok', 'ok', 'failed']),
    duration_ms: prng.nextInt(100, 30000),
    timestamp: '2024-01-15T02:00:00Z',
  }),
});

// --- Webhook secrets ---

const webhookSecret: RedisKeyGenerator = (prng) => {
  const name = prng.pick(['github', 'stripe', 'slack', 'jira', 'pagerduty', 'datadog']);
  const secret = hex(prng, 24);
  return {
    key: `webhook:${name}`,
    value: JSON.stringify({
      url: `https://hooks.${name}.com/${secret.slice(0, 8)}`,
      secret,
      active: true,
    }),
  };
};

/** Higher weight, more often drawn. Sessions and cached profiles lead because they are
 *  what a live application actually fills a store with; a store that read as an even
 *  spread of sixteen exotic shapes would read as a fixture. */
const WEIGHTED_GENERATORS: readonly (readonly [RedisKeyGenerator, number])[] = [
  [sessionBasic, 3],
  [sessionJwt, 2],
  [userCache, 3],
  [userPermissions, 1],
  [apiKey, 2],
  [configDb, 2],
  [configSmtp, 1],
  [configS3, 1],
  [configLdap, 1],
  [resetToken, 1],
  [deployLock, 1],
  [rateLimit, 1],
  [statsCounter, 2],
  [queueCount, 1],
  [cronLastRun, 1],
  [webhookSecret, 1],
];

export const REDIS_KEY_GENERATORS: readonly RedisKeyGenerator[] = WEIGHTED_GENERATORS.flatMap(
  ([generator, weight]) => Array.from({ length: weight }, () => generator),
);
