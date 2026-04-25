import { describe, it, expect, vi } from 'vitest';
import { handleAllocateRequest } from './handler';
import type { InsertResult } from './types';
import type { RateLimiter } from './rateLimit';
import { noopRateLimiter } from './rateLimit';

const mkDeps = (overrides: {
  readonly insertIp?: (row: unknown) => Promise<InsertResult>;
  readonly rollIp?: () => string;
  readonly rateLimiter?: RateLimiter;
}) => ({
  insertIp:
    overrides.insertIp ?? vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok'),
  rollIp: overrides.rollIp ?? vi.fn<() => string>().mockReturnValue('51.1.2.3'),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
});

const CALLER_IP = '1.2.3.4';

describe('handleAllocateRequest', () => {
  it('returns 200 with the allocated IP on success', async () => {
    const deps = mkDeps({});
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, CALLER_IP, deps);
    expect(result).toEqual({ status: 200, body: { ip: '51.1.2.3' } });
  });

  it('accepts optional owner_key and instance_ref', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const deps = mkDeps({ insertIp });

    const result = await handleAllocateRequest(
      { kind: 'home_network', owner_key: 'ed25519:abc', instance_ref: 'ref-xyz' },
      CALLER_IP,
      deps,
    );

    expect(result.status).toBe(200);
    expect(insertIp).toHaveBeenCalledWith({
      ip: '51.1.2.3',
      kind: 'home_network',
      owner_key: 'ed25519:abc',
      instance_ref: 'ref-xyz',
    });
  });

  it('returns 400 when body is missing kind', async () => {
    const result = await handleAllocateRequest({}, CALLER_IP, mkDeps({}));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'invalid_request' });
  });

  it('returns 400 when kind is not a known value', async () => {
    const result = await handleAllocateRequest({ kind: 'malicious_kind' }, CALLER_IP, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when body has unknown extra fields (strict schema)', async () => {
    const result = await handleAllocateRequest(
      { kind: 'mission_instance', admin: true },
      CALLER_IP,
      mkDeps({}),
    );
    expect(result.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const result = await handleAllocateRequest('malicious', CALLER_IP, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when body is null', async () => {
    const result = await handleAllocateRequest(null, CALLER_IP, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 500 when allocation exhausts retries', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('conflict');
    const deps = mkDeps({ insertIp });
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, CALLER_IP, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'exhausted' });
  });

  it('returns 500 when insert errors', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('error');
    const deps = mkDeps({ insertIp });
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, CALLER_IP, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'insert_failed' });
  });

  it('rejects oversized owner_key to prevent abuse', async () => {
    const result = await handleAllocateRequest(
      { kind: 'mission_instance', owner_key: 'x'.repeat(500) },
      CALLER_IP,
      mkDeps({}),
    );
    expect(result.status).toBe(400);
  });

  describe('rate limiting', () => {
    it('returns 429 with Retry-After header when caller is rate-limited', async () => {
      const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
      const rateLimiter: RateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
      const deps = mkDeps({ insertIp, rateLimiter });

      const result = await handleAllocateRequest({ kind: 'mission_instance' }, CALLER_IP, deps);

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ error: 'rate_limited' });
      expect(result.headers).toMatchObject({ 'Retry-After': '42' });
      // Critically: insert never ran. Rate limit gates DB access.
      expect(insertIp).not.toHaveBeenCalled();
    });

    it('rate-limits on caller key, not body content', async () => {
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 10 });
      const deps = mkDeps({ rateLimiter });

      await handleAllocateRequest({ kind: 'mission_instance' }, '5.6.7.8', deps);

      expect(rateLimiter).toHaveBeenCalledWith('5.6.7.8');
    });

    it('rate-limit check runs before zod validation (protects CPU on garbage input)', async () => {
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
      const deps = mkDeps({ rateLimiter });

      // Even with malformed body, rate limit denies first → 429 not 400
      const result = await handleAllocateRequest('garbage', CALLER_IP, deps);

      expect(result.status).toBe(429);
      expect(rateLimiter).toHaveBeenCalled();
    });
  });
});
