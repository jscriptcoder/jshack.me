import { describe, it, expect, vi } from 'vitest';
import { createUpstashRateLimiter, noopRateLimiter } from './rateLimit';

describe('noopRateLimiter', () => {
  it('always allows', async () => {
    expect(await noopRateLimiter('any-key')).toEqual({ allowed: true });
  });
});

describe('createUpstashRateLimiter', () => {
  it('returns allowed when Upstash returns success', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
    const rateLimiter = createUpstashRateLimiter(limit);

    expect(await rateLimiter('1.2.3.4')).toEqual({ allowed: true });
    expect(limit).toHaveBeenCalledWith('1.2.3.4');
  });

  it('returns denied with retryAfterSeconds when Upstash denies', async () => {
    const reset = Date.now() + 30_000; // 30s from now
    const limit = vi.fn().mockResolvedValue({ success: false, reset });
    const rateLimiter = createUpstashRateLimiter(limit);

    const result = await rateLimiter('1.2.3.4');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // Math.ceil((reset - now) / 1000) — should be ~30, allow ±1 for clock drift
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(29);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(31);
    }
  });

  it('floors retryAfterSeconds at 1 (never zero or negative)', async () => {
    // Reset already in the past — would compute as 0 or negative
    const limit = vi.fn().mockResolvedValue({ success: false, reset: Date.now() - 5_000 });
    const rateLimiter = createUpstashRateLimiter(limit);

    const result = await rateLimiter('1.2.3.4');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBe(1);
    }
  });
});
