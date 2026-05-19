import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLookupHomeNetworkRequest, type LookupHandlerDeps } from './lookupHandler';
import type { HomeNetworkRow } from './types';
import { noopRateLimiter, type RateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';

const FIXED_NOW = 1_700_000_000_000;

const makeEnvelope = (identity: Identity, publicIp = '162.174.39.103') => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'lookupHomeNetwork', { public_ip: publicIp });
  } finally {
    Date.now = realNow;
  }
};

const sampleNetwork = (overrides: Partial<HomeNetworkRow> = {}): HomeNetworkRow => ({
  public_ip: '162.174.39.103',
  essid_template: 'ACME-CORP',
  density_tier: 'crowded',
  max_slots: 8,
  seed: 'home-162.174.39.103',
  ...overrides,
});

const mkDeps = (overrides: Partial<LookupHandlerDeps> = {}): LookupHandlerDeps => ({
  findNetworkByPublicIp:
    overrides.findNetworkByPublicIp ?? vi.fn().mockResolvedValue(sampleNetwork()),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

describe('handleLookupHomeNetworkRequest', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  describe('happy path', () => {
    it('returns 200 with the full row projection for a found network', async () => {
      const envelope = makeEnvelope(identity, '162.174.39.103');
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(sampleNetwork());

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        public_ip: '162.174.39.103',
        essid_template: 'ACME-CORP',
        density_tier: 'crowded',
        max_slots: 8,
        seed: 'home-162.174.39.103',
      });
    });

    it('forwards the verified public_ip to findNetworkByPublicIp (not any other field)', async () => {
      const envelope = makeEnvelope(identity, '203.0.113.99');
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(
        sampleNetwork({
          public_ip: '203.0.113.99',
          seed: 'home-203.0.113.99',
        }),
      );

      await handleLookupHomeNetworkRequest(envelope, mkDeps({ findNetworkByPublicIp }));

      expect(findNetworkByPublicIp).toHaveBeenCalledWith('203.0.113.99');
    });

    it('returns the row exactly as the storage layer delivered it (no field reshape)', async () => {
      // Pinned: a mutant that re-derived seed as `home-${public_ip}` would
      // silently work on new rows but lose any legacy seed scheme. The
      // handler MUST pass-through whatever the DB returned.
      const envelope = makeEnvelope(identity, '198.51.100.20');
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(
        sampleNetwork({
          public_ip: '198.51.100.20',
          essid_template: 'WEIRD-LEGACY',
          density_tier: 'solo',
          max_slots: 1,
          seed: 'legacy-uuid-12345',
        }),
      );

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp }),
      );

      expect(result.body).toEqual({
        public_ip: '198.51.100.20',
        essid_template: 'WEIRD-LEGACY',
        density_tier: 'solo',
        max_slots: 1,
        seed: 'legacy-uuid-12345',
      });
    });
  });

  describe('not found', () => {
    it('returns 404 when the public IP has no corresponding network', async () => {
      const envelope = makeEnvelope(identity);
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(null);

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp }),
      );

      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ error: 'not_found' });
    });
  });

  describe('auth and rate limiting', () => {
    it('returns 401 when signature is invalid', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };

      const result = await handleLookupHomeNetworkRequest(tampered, mkDeps());

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'signature_invalid' });
    });

    it('returns 401 when the nonce has already been seen (replay)', async () => {
      // Match the contract used by handleJoinHomeNetworkRequest.
      // First call: nonce fresh → store records it. Second call (same
      // envelope, same nonce): nonceStore returns fresh: false → handler
      // rejects with 401 replay.
      const seen = new Set<string>();
      const nonceStore: NonceStore = async (nonce) => {
        if (seen.has(nonce)) return { fresh: false };
        seen.add(nonce);
        return { fresh: true };
      };
      const envelope = makeEnvelope(identity);
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(sampleNetwork());

      const first = await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp, nonceStore }),
      );
      const second = await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp, nonceStore }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(second.body).toMatchObject({ error: 'replay' });
    });

    it('returns 429 when rate limit is exceeded', async () => {
      const rateLimiter: RateLimiter = async () => ({
        allowed: false,
        retryAfterSeconds: 30,
      });
      const envelope = makeEnvelope(identity);

      const result = await handleLookupHomeNetworkRequest(envelope, mkDeps({ rateLimiter }));

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ error: 'rate_limited' });
      expect(result.headers).toMatchObject({ 'Retry-After': '30' });
    });

    it('rejects malformed payloads (empty public_ip)', async () => {
      // Sign a payload that violates the schema (`.min(1)`) — should be
      // rejected with payload_invalid.
      const realNow = Date.now;
      Date.now = () => FIXED_NOW;
      const envelope = signRequest(identity, 'lookupHomeNetwork', { public_ip: '' });
      Date.now = realNow;

      const result = await handleLookupHomeNetworkRequest(envelope, mkDeps());

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'payload_invalid' });
    });

    it('does not call the storage layer when auth fails', async () => {
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(sampleNetwork());
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };

      await handleLookupHomeNetworkRequest(tampered, mkDeps({ findNetworkByPublicIp }));

      expect(findNetworkByPublicIp).not.toHaveBeenCalled();
    });

    it('does not call the storage layer when rate limit blocks', async () => {
      const findNetworkByPublicIp = vi.fn().mockResolvedValue(sampleNetwork());
      const rateLimiter: RateLimiter = async () => ({
        allowed: false,
        retryAfterSeconds: 30,
      });
      const envelope = makeEnvelope(identity);

      await handleLookupHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkByPublicIp, rateLimiter }),
      );

      expect(findNetworkByPublicIp).not.toHaveBeenCalled();
    });
  });
});
