// Nonce dedupe store — a write-once-with-TTL key/value used by
// verifySignedRequest to reject replays. Atomic SET NX EX in Redis: returns
// 'OK' when the key was created (first time we've seen this nonce), null when
// the key already existed (replay).
//
// TTL matches REPLAY_WINDOW_MS — once the replay window has elapsed the
// timestamp check would reject the request anyway, so we don't need to keep
// nonces around longer than that.

export type NonceStore = (nonce: string) => Promise<{ readonly fresh: boolean }>;

// Minimal subset of @upstash/redis's set() — the bits we actually use.
// Typed locally so this file doesn't import @upstash/redis (kept to the
// Vercel function adapter, same pattern as rateLimit.ts).
type UpstashSetFn = (
  key: string,
  value: string,
  opts: { readonly ex: number; readonly nx: true },
) => Promise<string | null>;

const NONCE_TTL_SECONDS = 120;
const NONCE_KEY_PREFIX = 'nonce:';

export const createUpstashNonceStore = (set: UpstashSetFn): NonceStore => {
  return async (nonce) => {
    const result = await set(`${NONCE_KEY_PREFIX}${nonce}`, '1', {
      ex: NONCE_TTL_SECONDS,
      nx: true,
    });
    return { fresh: result === 'OK' };
  };
};

// Always-fresh store. Used when Upstash env vars are missing — replay
// protection is effectively disabled in that case, same caveat as
// noopRateLimiter (api/allocate-ip.ts logs a warning).
export const noopNonceStore: NonceStore = async () => ({ fresh: true });
