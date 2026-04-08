import type { Prng } from './prng';
import { passwords } from './pools/machines';
import { redisKeyGenerators } from './pools/redis';

export type RedisData = {
  readonly keys: Readonly<Record<string, string>>;
  readonly requirepass: string | null;
};

const REQUIREPASS_CHANCE = 0.25;

export const generateRedisData = (prng: Prng, users: readonly string[]): RedisData => {
  const keyCount = prng.nextInt(8, 15);

  // Shuffle generators and keep generating until we have enough unique keys.
  // Cap attempts to avoid infinite loops if the pool is too small.
  const shuffled = [...redisKeyGenerators].sort(() => prng.next() - 0.5);
  const keys: Record<string, string> = {};
  const maxAttempts = keyCount * 3;

  for (let i = 0; i < maxAttempts && Object.keys(keys).length < keyCount; i++) {
    const generator = shuffled[i % shuffled.length]!;
    const { key, value } = generator(prng, users);
    keys[key] = value;
  }

  // ~25% chance of requirepass
  const requirepass = prng.next() < REQUIREPASS_CHANCE ? prng.pick(passwords) : null;

  return { keys, requirepass };
};
