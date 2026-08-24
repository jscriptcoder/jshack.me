/**
 * The shape of a generated key-value store, and the one way to read one back.
 *
 * A store lives as a FILE on the box that serves it (`/var/lib/redis/data.json`),
 * which makes every read of it a TRUST BOUNDARY rather than an internal hand-off: the
 * file is root-owned, but root on a box is a tier a player can reach, and anything a
 * player can reach they can edit. So this is a schema first and a type second — the
 * types below are derived from it, and nothing else may re-declare them.
 *
 * The secret is the SERVICE's, not a person's: a store answers to one password and
 * knows no accounts at all. It is held here as a hash rather than in the conf the box
 * publishes, because that file is readable by a guest and says why it may — it names
 * neither an account nor a hash. Keeping the secret here lets a sweep crack it through
 * the same path every other door is cracked through, instead of a plaintext compare
 * only this door would use.
 */

import { z } from 'zod';

export const redisStoreSchema = z.object({
  /** What the store holds. Every value is a string, as a real Redis string type is —
   *  the JSON-shaped ones are strings the application chose to put there. */
  keys: z.record(z.string(), z.string()),
  /** The md5 of the password this store answers to, or `null` for one that answers to
   *  nobody. Four stores in ten are open, which is what makes this door a find rather
   *  than a lock: `null` is an ordinary state here, not a missing value. */
  requirepassHash: z.string().nullable(),
});

export type RedisStore = z.infer<typeof redisStoreSchema>;

/**
 * Read a store back, or `null` for anything that is not one.
 *
 * Malformed JSON, a truncated file and a well-formed file describing something else
 * all collapse to the same `null`: from the daemon's side they are one condition —
 * there is no store here — and telling them apart would only tell a player how their
 * tampering failed.
 */
export const parseRedisStore = (content: string): RedisStore | null => {
  const parsed = ((): unknown => {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  })();
  const result = redisStoreSchema.safeParse(parsed);
  return result.success ? result.data : null;
};
