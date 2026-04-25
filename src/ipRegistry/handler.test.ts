import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAllocateRequest } from './handler';
import type { InsertResult } from './types';
import type { RateLimiter } from './rateLimit';
import { noopRateLimiter } from './rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';

// Real signing in tests — handler-side behaviour is tightly coupled to the
// signing flow, so end-to-end tests are clearer than mocking verify().
const FIXED_NOW = 1_700_000_000_000;

const makeEnvelope = (
  identity: Identity,
  fields: Record<string, unknown> = { kind: 'mission_instance' },
) => {
  // Pin Date.now() during signing so the embedded ts matches our fixed now.
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'allocateIp', fields);
  } finally {
    Date.now = realNow;
  }
};

const mkDeps = (overrides: {
  readonly insertIp?: (row: unknown) => Promise<InsertResult>;
  readonly rollIp?: () => string;
  readonly rateLimiter?: RateLimiter;
  readonly nonceStore?: NonceStore;
  readonly now?: () => number;
}) => ({
  insertIp:
    overrides.insertIp ?? vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok'),
  rollIp: overrides.rollIp ?? vi.fn<() => string>().mockReturnValue('51.1.2.3'),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

describe('handleAllocateRequest', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('returns 200 with the allocated IP on a valid signed envelope', async () => {
    const envelope = makeEnvelope(identity);
    const result = await handleAllocateRequest(envelope, mkDeps({}));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ip: '51.1.2.3' });
  });

  it('stamps owner_key from verified public key (server-side, not client-trusted)', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const envelope = makeEnvelope(identity, { kind: 'home_network' });

    await handleAllocateRequest(envelope, mkDeps({ insertIp }));

    expect(insertIp).toHaveBeenCalledWith({
      ip: '51.1.2.3',
      kind: 'home_network',
      owner_key: `ed25519:${identity.publicKeyHex}`,
    });
  });

  it('passes through instance_ref from the signed payload', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const envelope = makeEnvelope(identity, {
      kind: 'mission_instance',
      instance_ref: 'ref-xyz',
    });

    await handleAllocateRequest(envelope, mkDeps({ insertIp }));

    expect(insertIp).toHaveBeenCalledWith(expect.objectContaining({ instance_ref: 'ref-xyz' }));
  });

  it('ignores client-supplied owner_key (server stamps from verified pubkey)', async () => {
    // A malicious client tries to claim a different owner. Strict schema
    // rejects unknown fields, so this comes back as a 400 (payload_invalid).
    const envelope = makeEnvelope(identity, {
      kind: 'mission_instance',
      owner_key: 'ed25519:attacker',
    });
    const result = await handleAllocateRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'payload_invalid' });
  });

  describe('signature validation', () => {
    it('returns 400 when envelope is not an object', async () => {
      const result = await handleAllocateRequest('garbage', mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'envelope_invalid' });
    });

    it('returns 400 when envelope is missing required fields', async () => {
      const result = await handleAllocateRequest({}, mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'envelope_invalid' });
    });

    it('returns 401 when signature does not match public key', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
      const result = await handleAllocateRequest(tampered, mkDeps({}));
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'signature_invalid' });
    });

    it('returns 401 when payload is tampered after signing', async () => {
      const envelope = makeEnvelope(identity, { kind: 'mission_instance' });
      const tampered = {
        ...envelope,
        payload: envelope.payload.replace('mission_instance', 'home_network'),
      };
      const result = await handleAllocateRequest(tampered, mkDeps({}));
      expect(result.status).toBe(401);
    });

    it('returns 400 when kind is not in the allowed enum', async () => {
      const envelope = makeEnvelope(identity, { kind: 'evil_kind' });
      const result = await handleAllocateRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'payload_invalid' });
    });

    it('returns 401 when timestamp is too old (replay window exceeded)', async () => {
      const envelope = makeEnvelope(identity);
      // Server's now() is 200s after the embedded ts — outside the 120s window
      const result = await handleAllocateRequest(
        envelope,
        mkDeps({ now: () => FIXED_NOW + 200_000 }),
      );
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'timestamp_skew' });
    });

    it('returns 401 when nonce store reports a replay (duplicate nonce)', async () => {
      const envelope = makeEnvelope(identity);
      const replayedStore: NonceStore = vi.fn().mockResolvedValue({ fresh: false });
      const result = await handleAllocateRequest(envelope, mkDeps({ nonceStore: replayedStore }));
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'replay' });
    });
  });

  describe('rate limiting', () => {
    it('rate-limits on the verified public key (not the IP)', async () => {
      const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
      const envelope = makeEnvelope(identity);

      await handleAllocateRequest(envelope, mkDeps({ rateLimiter }));

      expect(rateLimiter).toHaveBeenCalledWith(identity.publicKeyHex);
    });

    it('returns 429 with Retry-After header when rate-limited', async () => {
      const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
      const envelope = makeEnvelope(identity);

      const result = await handleAllocateRequest(envelope, mkDeps({ insertIp, rateLimiter }));

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ error: 'rate_limited' });
      expect(result.headers).toMatchObject({ 'Retry-After': '42' });
      expect(insertIp).not.toHaveBeenCalled();
    });

    it('rate-limit check runs after verification (does not run on garbage envelopes)', async () => {
      // A flood of unsigned/malformed bodies should NOT consume rate-limit
      // budget for anyone — those requests fail at envelope_invalid.
      const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
      await handleAllocateRequest('garbage', mkDeps({ rateLimiter }));
      expect(rateLimiter).not.toHaveBeenCalled();
    });
  });

  describe('allocator failures', () => {
    it('returns 500 when allocation exhausts retries', async () => {
      const insertIp = vi
        .fn<(row: unknown) => Promise<InsertResult>>()
        .mockResolvedValue('conflict');
      const envelope = makeEnvelope(identity);
      const result = await handleAllocateRequest(envelope, mkDeps({ insertIp }));
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'exhausted' });
    });

    it('returns 500 when insert errors', async () => {
      const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('error');
      const envelope = makeEnvelope(identity);
      const result = await handleAllocateRequest(envelope, mkDeps({ insertIp }));
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'insert_failed' });
    });
  });
});
