// Rate limiter abstraction. Hides the @upstash/ratelimit implementation from
// the handler so tests can mock easily and so swapping the backend later
// (Postgres, Cloudflare KV, etc.) doesn't ripple.
//
// Pre-launch: not strictly needed (no DDOS surface yet) — but pre-wiring
// keeps abuse off the table once /api/allocate-ip becomes discoverable.

export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export type RateLimiter = (callerKey: string) => Promise<RateLimitResult>;

// Minimal subset of Upstash Ratelimit's `limit()` return shape — the bits
// we actually map to RateLimitResult. Typed locally so this file doesn't
// import @upstash/ratelimit (kept lazy, in api/allocate-ip.ts).
type UpstashLimitFn = (identifier: string) => Promise<{
  readonly success: boolean;
  readonly reset: number;
}>;

export const createUpstashRateLimiter = (limit: UpstashLimitFn): RateLimiter => {
  return async (callerKey) => {
    const { success, reset } = await limit(callerKey);
    if (success) return { allowed: true };
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds };
  };
};

// Always-allow limiter. Used when Upstash env vars are missing (local dev
// without a Redis configured, or pre-cloud-setup deploy). Logs a warning at
// the Vercel function level — see api/allocate-ip.ts.
export const noopRateLimiter: RateLimiter = async () => ({ allowed: true });
