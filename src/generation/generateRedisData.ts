import type { Prng } from './prng';
import { passwords } from './pools/machines';

export type RedisData = {
  readonly keys: Readonly<Record<string, string>>;
  readonly requirepass: string | null;
};

const REQUIREPASS_CHANCE = 0.25;

// Session token templates — cached user sessions
const sessionTemplates = (prng: Prng, users: readonly string[]) => {
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

// Cached user profile templates
const userCacheTemplates = (prng: Prng, users: readonly string[]) => {
  const user = prng.pick(users);
  const id = prng.nextInt(1000, 9999);
  return {
    key: `cache:user:${id}`,
    value: JSON.stringify({
      username: user,
      email: `${user}@corp.local`,
      role: prng.pick(['admin', 'editor', 'viewer']),
      last_login: '2024-01-15T14:22:00Z',
    }),
  };
};

// API key templates
const apiKeyTemplates = (prng: Prng) => {
  const name = prng.pick(['prod', 'staging', 'internal', 'webhook', 'monitoring', 'backup']);
  const key = Array.from({ length: 32 }, () => prng.nextInt(0, 15).toString(16)).join('');
  return { key: `api:key:${name}`, value: key };
};

// App config template
const appConfigTemplate = (prng: Prng) => ({
  key: 'app:config',
  value: JSON.stringify({
    db_url: `mysql://app:${prng.pick(passwords)}@localhost:3306/app_prod`,
    cache_ttl: prng.nextInt(300, 3600),
    debug: false,
    version: `${prng.nextInt(1, 5)}.${prng.nextInt(0, 9)}.${prng.nextInt(0, 20)}`,
  }),
});

// Stats counters
const statsTemplates = (prng: Prng) => {
  const name = prng.pick([
    'requests',
    'errors',
    'logins',
    'cache_hits',
    'cache_misses',
    'active_users',
  ]);
  return { key: `stats:${name}`, value: String(prng.nextInt(100, 99999)) };
};

// Queue job count
const queueTemplate = (prng: Prng) => {
  const name = prng.pick(['jobs', 'emails', 'notifications', 'reports']);
  return { key: `queue:${name}`, value: String(prng.nextInt(0, 50)) };
};

type KeyGenerator = (
  prng: Prng,
  users: readonly string[],
) => { readonly key: string; readonly value: string };

const allGenerators: readonly KeyGenerator[] = [
  sessionTemplates,
  sessionTemplates,
  userCacheTemplates,
  userCacheTemplates,
  apiKeyTemplates,
  apiKeyTemplates,
  (prng) => appConfigTemplate(prng),
  (prng) => statsTemplates(prng),
  (prng) => statsTemplates(prng),
  (prng) => queueTemplate(prng),
];

export const generateRedisData = (prng: Prng, users: readonly string[]): RedisData => {
  const keyCount = prng.nextInt(8, 15);

  // Pick generators and generate key-value pairs, deduplicating keys
  const keys: Record<string, string> = {};
  const shuffled = [...allGenerators].sort(() => prng.next() - 0.5);

  for (let i = 0; i < keyCount; i++) {
    const generator = shuffled[i % shuffled.length]!;
    const { key, value } = generator(prng, users);
    keys[key] = value;
  }

  // ~25% chance of requirepass
  const requirepass = prng.next() < REQUIREPASS_CHANCE ? prng.pick(passwords) : null;

  return { keys, requirepass };
};
