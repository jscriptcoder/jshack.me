import type { Prng } from '../prng';

type RedisKeyGenerator = (
  prng: Prng,
  users: readonly string[],
) => { readonly key: string; readonly value: string };

// --- Session tokens ---

const sessionBasic: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  const token = Array.from({ length: 16 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return {
    key: `sess:${token}`,
    value: JSON.stringify({
      username: user,
      ip: `10.${prng.nextInt(0, 255)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`,
      role: prng.pick(['admin', 'user', 'operator']),
      created: '2024-01-15T08:30:00Z',
    }),
  };
};

const sessionJwt: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  const token = Array.from({ length: 24 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return {
    key: `sess:jwt:${token}`,
    value: JSON.stringify({
      sub: user,
      iat: 1705312200,
      exp: 1705398600,
      scope: prng.pick(['read', 'read write', 'admin', 'read write delete']),
      iss: 'auth.corp.local',
    }),
  };
};

// --- Cached user profiles ---

const userCache: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  const id = prng.nextInt(1000, 9999);
  return {
    key: `cache:user:${id}`,
    value: JSON.stringify({
      username: user,
      email: `${user}@corp.local`,
      role: prng.pick(['admin', 'editor', 'viewer', 'analyst', 'operator']),
      last_login: '2024-01-15T14:22:00Z',
    }),
  };
};

const userPermissions: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  return {
    key: `perms:${user}`,
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
  };
};

// --- API keys ---

const apiKeyNames = [
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
] as const;

const apiKey: RedisKeyGenerator = (prng) => {
  const name = prng.pick(apiKeyNames);
  const key = Array.from({ length: 32 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return { key: `api:key:${name}`, value: key };
};

// --- App config variants ---

const configDb: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  const passwords = ['s3cret!', 'db_p4ss', 'pr0d_db!', 'r3pl1ca', 'b4ckup_pw', 'qu3ry_usr'];
  return {
    key: 'app:config',
    value: JSON.stringify({
      db_url: `mysql://${user}:${prng.pick(passwords)}@localhost:3306/app_prod`,
      cache_ttl: prng.nextInt(300, 3600),
      debug: false,
      version: `${prng.nextInt(1, 5)}.${prng.nextInt(0, 9)}.${prng.nextInt(0, 20)}`,
    }),
  };
};

const configSmtp: RedisKeyGenerator = (prng) => ({
  key: 'config:smtp',
  value: JSON.stringify({
    host: prng.pick(['smtp.corp.local', 'mail.internal', 'relay.corp.local']),
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
    access_key: `AKIA${Array.from({ length: 16 }, () => prng.pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.split(''))).join('')}`,
    secret_key: Array.from({ length: 40 }, () => prng.nextInt(0, 15).toString(16)).join(''),
  }),
});

const configLdap: RedisKeyGenerator = (prng) => ({
  key: 'config:ldap',
  value: JSON.stringify({
    url: `ldap://${prng.pick(['dc01', 'ldap', 'ad-server', 'directory'])}.corp.local:389`,
    bind_dn: `cn=${prng.pick(['svc-app', 'ldap-reader', 'bind-user'])},ou=services,dc=corp,dc=local`,
    bind_password: prng.pick(['Ld4p_b1nd!', 'r34d_0nly', 's3rv1c3_pw', 'b1nd_4uth']),
    base_dn: 'dc=corp,dc=local',
  }),
});

// --- Tokens and locks ---

const resetToken: RedisKeyGenerator = (prng, users) => {
  const user = prng.pick(users);
  const token = Array.from({ length: 20 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return {
    key: `token:reset:${token}`,
    value: JSON.stringify({ username: user, expires: '2024-01-16T08:30:00Z', used: false }),
  };
};

const deployLock: RedisKeyGenerator = (prng, users) => ({
  key: `lock:${prng.pick(['deploy', 'migration', 'maintenance', 'backup'])}`,
  value: JSON.stringify({
    holder: prng.pick(users),
    acquired: '2024-01-15T18:00:00Z',
    ttl: prng.nextInt(300, 1800),
  }),
});

// --- Rate limiting and counters ---

const rateLimit: RedisKeyGenerator = (prng) => {
  const ip = `${prng.nextInt(10, 192)}.${prng.nextInt(0, 255)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`;
  return {
    key: `ratelimit:${ip}`,
    value: String(prng.nextInt(1, 150)),
  };
};

const statsCounterNames = [
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
] as const;

const statsCounter: RedisKeyGenerator = (prng) => ({
  key: `stats:${prng.pick(statsCounterNames)}`,
  value: String(prng.nextInt(100, 99999)),
});

// --- Queue and cron ---

const queueNames = ['jobs', 'emails', 'notifications', 'reports', 'exports', 'imports'] as const;

const queueCount: RedisKeyGenerator = (prng) => ({
  key: `queue:${prng.pick(queueNames)}`,
  value: String(prng.nextInt(0, 50)),
});

const cronLastRun: RedisKeyGenerator = (prng) => {
  const job = prng.pick(['backup', 'cleanup', 'report', 'sync', 'health_check', 'rotate_logs']);
  return {
    key: `cron:last_run:${job}`,
    value: JSON.stringify({
      status: prng.pick(['ok', 'ok', 'ok', 'failed']),
      duration_ms: prng.nextInt(100, 30000),
      timestamp: '2024-01-15T02:00:00Z',
    }),
  };
};

// --- Webhook secrets ---

const webhookSecret: RedisKeyGenerator = (prng) => {
  const name = prng.pick(['github', 'stripe', 'slack', 'jira', 'pagerduty', 'datadog']);
  const secret = Array.from({ length: 24 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return {
    key: `webhook:${name}`,
    value: JSON.stringify({
      url: `https://hooks.${name}.com/${secret.slice(0, 8)}`,
      secret,
      active: true,
    }),
  };
};

// All generators grouped by weight — higher weight = more likely to appear.
// Each entry is [generator, weight]. Total pool is flattened by repeating
// generators according to their weight.
const weightedGenerators: readonly (readonly [RedisKeyGenerator, number])[] = [
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

// Flatten weighted generators into a pool for PRNG picking
export const redisKeyGenerators: readonly RedisKeyGenerator[] = weightedGenerators.flatMap(
  ([gen, weight]) => Array.from({ length: weight }, () => gen),
);
