import { describe, expect, it } from 'vitest';
import { createSupabaseNonceStore, type NonceDb } from './nonceStore';

/**
 * The Supabase-backed nonce store turns an atomic
 * INSERT ... ON CONFLICT DO NOTHING ... RETURNING into a freshness verdict:
 * the row came back (inserted) → fresh; nothing came back (conflict) → replay.
 *
 * The real ON CONFLICT dedupe is proven end-to-end against Postgres by the
 * `testNonceReplay.ts` wire-check. Here we pin the store's own behavior — the
 * rowcount→fresh mapping and the fail-open-on-error posture — through a fake of
 * the single DB op it issues (RETURNING the row only the first time a nonce is
 * inserted).
 */
const fakeNonceDb = (options: { readonly error?: unknown } = {}): NonceDb => {
  const seen = new Set<string>();
  return {
    from: () => ({
      upsert: (values) => ({
        select: () => {
          if (options.error !== undefined) {
            return Promise.resolve({ data: null, error: options.error });
          }
          const inserted = !seen.has(values.nonce);
          seen.add(values.nonce);
          return Promise.resolve({
            data: inserted ? [{ nonce: values.nonce }] : [],
            error: null,
          });
        },
      }),
    }),
  };
};

describe('createSupabaseNonceStore', () => {
  it('reports a never-seen nonce as fresh', async () => {
    const store = createSupabaseNonceStore(fakeNonceDb());
    expect(await store('nonce-a')).toEqual({ fresh: true });
  });

  it('reports a repeated nonce as not fresh (a replay)', async () => {
    const store = createSupabaseNonceStore(fakeNonceDb());
    await store('nonce-a');
    expect(await store('nonce-a')).toEqual({ fresh: false });
  });

  it('judges distinct nonces independently', async () => {
    const store = createSupabaseNonceStore(fakeNonceDb());
    await store('nonce-a');
    expect(await store('nonce-b')).toEqual({ fresh: true });
  });

  it('fails open (fresh) when the dedupe insert errors — a store outage falls back to timestamp-window protection, not a game-wide write block', async () => {
    const store = createSupabaseNonceStore(fakeNonceDb({ error: { message: 'boom' } }));
    expect(await store('nonce-a')).toEqual({ fresh: true });
  });
});
