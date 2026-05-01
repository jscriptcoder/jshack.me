import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleJoinHomeNetworkRequest, type HandlerDeps } from './handler';
import type {
  HomeNetworkOccupantRow,
  HomeNetworkRow,
  InsertOccupantResult,
  DensityTier,
} from './types';
import { noopRateLimiter, type RateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';
import { deriveHostnameSuffix } from './deriveHostnameSuffix';

// Real signing in tests — handler-side behavior is tightly coupled to the
// signing flow (player_key derivation, idempotency keying), so end-to-end
// tests are clearer than mocking verifySignedRequest.
const FIXED_NOW = 1_700_000_000_000;

const makeEnvelope = (
  identity: Identity,
  fields: {
    readonly essid_template?: string;
    readonly density_tier?: DensityTier;
    readonly workstation_prefix?: string;
  } = {},
) => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'joinHomeNetwork', {
      essid_template: fields.essid_template ?? 'ACME-CORP',
      density_tier: fields.density_tier ?? 'crowded',
      workstation_prefix: fields.workstation_prefix ?? 'skylab',
    });
  } finally {
    Date.now = realNow;
  }
};

const sampleNetwork = (overrides: Partial<HomeNetworkRow> = {}): HomeNetworkRow => {
  const public_ip = overrides.public_ip ?? '203.0.113.10';
  return {
    public_ip,
    essid_template: 'ACME-CORP',
    density_tier: 'crowded',
    max_slots: 8,
    seed: `home-${public_ip}`,
    ...overrides,
  };
};

const sampleOccupant = (
  overrides: Partial<HomeNetworkOccupantRow> = {},
): HomeNetworkOccupantRow => ({
  network_id: '203.0.113.10',
  player_key: 'ed25519:placeholder',
  lan_ip: '.187',
  hostname: 'skylab-9k3',
  ...overrides,
});

const mkDeps = (overrides: Partial<HandlerDeps> = {}): HandlerDeps => ({
  findOccupantByPlayer: overrides.findOccupantByPlayer ?? vi.fn().mockResolvedValue(null),
  findNetworkWithFreeSlots: overrides.findNetworkWithFreeSlots ?? vi.fn().mockResolvedValue(null),
  createNetwork:
    overrides.createNetwork ??
    vi.fn().mockImplementation(async (params) => ({
      public_ip: params.publicIp,
      essid_template: params.essidTemplate,
      density_tier: params.densityTier,
      max_slots: params.maxSlots,
      seed: params.seed,
    })),
  insertOccupant:
    overrides.insertOccupant ??
    vi.fn<() => Promise<InsertOccupantResult>>().mockResolvedValue('ok'),
  allocatePublicIp: overrides.allocatePublicIp ?? vi.fn().mockResolvedValue('203.0.113.10'),
  pickLanIp: overrides.pickLanIp ?? vi.fn().mockReturnValue('.187'),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

describe('handleJoinHomeNetworkRequest', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  describe('happy path', () => {
    it('creates a new network and occupant on first join, returns slot info', async () => {
      const allocatePublicIp = vi.fn().mockResolvedValue('203.0.113.42');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ allocatePublicIp }));

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        public_ip: '203.0.113.42',
        lan_ip: '.187',
        hostname: `skylab-${deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`)}`,
        network_seed: 'home-203.0.113.42',
      });
      expect(allocatePublicIp).toHaveBeenCalledOnce();
    });

    it('reuses an existing network with free slots, allocates a new occupant slot', async () => {
      const existingNetwork = sampleNetwork({ public_ip: '203.0.113.50' });
      const findNetworkWithFreeSlots = vi.fn().mockResolvedValue(existingNetwork);
      const allocatePublicIp = vi.fn();
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkWithFreeSlots, allocatePublicIp }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        public_ip: '203.0.113.50',
        network_seed: 'home-203.0.113.50',
      });
      // Allocator NOT called — reuses the existing public IP
      expect(allocatePublicIp).not.toHaveBeenCalled();
    });

    it('creates a new network when no row has free slots', async () => {
      const findNetworkWithFreeSlots = vi.fn().mockResolvedValue(null);
      const allocatePublicIp = vi.fn().mockResolvedValue('203.0.113.99');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkWithFreeSlots, allocatePublicIp }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ public_ip: '203.0.113.99' });
      expect(allocatePublicIp).toHaveBeenCalledOnce();
    });
  });

  describe('idempotency', () => {
    it('returns the existing slot for a player who already joined this LAN', async () => {
      const existingNetwork = sampleNetwork({
        public_ip: '203.0.113.77',
        seed: 'home-203.0.113.77',
      });
      const existingOccupant = sampleOccupant({
        network_id: '203.0.113.77',
        lan_ip: '.42',
        hostname: 'skylab-old',
      });
      const findOccupantByPlayer = vi
        .fn()
        .mockResolvedValue({ network: existingNetwork, occupant: existingOccupant });
      const insertOccupant = vi.fn();
      const allocatePublicIp = vi.fn();
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ findOccupantByPlayer, insertOccupant, allocatePublicIp }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        public_ip: '203.0.113.77',
        lan_ip: '.42',
        hostname: 'skylab-old',
        network_seed: 'home-203.0.113.77',
      });
      // No allocation, no INSERT — pure read-and-return
      expect(insertOccupant).not.toHaveBeenCalled();
      expect(allocatePublicIp).not.toHaveBeenCalled();
    });
  });

  describe('slot collisions', () => {
    it('retries with a new lan_ip when the picked one collides', async () => {
      const pickLanIp = vi
        .fn()
        .mockReturnValueOnce('.10')
        .mockReturnValueOnce('.11')
        .mockReturnValueOnce('.12');
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValueOnce('lan_ip_conflict')
        .mockResolvedValueOnce('lan_ip_conflict')
        .mockResolvedValueOnce('ok');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ pickLanIp, insertOccupant }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ lan_ip: '.12' });
      expect(insertOccupant).toHaveBeenCalledTimes(3);
    });

    it('returns 500 when slot allocation exhausts retries', async () => {
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('lan_ip_conflict');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ insertOccupant }));

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'slot_allocation_exhausted' });
    });

    it('returns 409 immediately on hostname collision (retrying lan_ip would not help)', async () => {
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('hostname_conflict');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ insertOccupant }));

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ error: 'hostname_conflict' });
      // Single attempt — no retry loop wasted on a deterministic conflict
      expect(insertOccupant).toHaveBeenCalledOnce();
    });
  });

  describe('failure paths', () => {
    it('returns 500 when public IP allocation is exhausted', async () => {
      const allocatePublicIp = vi.fn().mockResolvedValue(null);
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ allocatePublicIp }));

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'ip_allocation_exhausted' });
    });

    it('returns 500 on storage error during occupant insert', async () => {
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('error');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ insertOccupant }));

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'occupant_insert_failed' });
    });
  });

  describe('auth and rate limiting', () => {
    it('returns 401 when signature is invalid', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };

      const result = await handleJoinHomeNetworkRequest(tampered, mkDeps());

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'signature_invalid' });
    });

    it('returns 429 when rate limit is exceeded', async () => {
      const rateLimiter: RateLimiter = async () => ({
        allowed: false,
        retryAfterSeconds: 30,
      });
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({ rateLimiter }));

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ error: 'rate_limited' });
      expect(result.headers).toMatchObject({ 'Retry-After': '30' });
    });

    it('rejects malformed payloads (essid_template too long)', async () => {
      // 65 chars — exceeds the 64-char schema limit
      const envelope = makeEnvelope(identity, { essid_template: 'A'.repeat(65) });
      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps());
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'payload_invalid' });
    });
  });

  describe('player_key handling', () => {
    it('keys idempotency lookup on the verified pubkey, not on any client-supplied field', async () => {
      const findOccupantByPlayer = vi.fn().mockResolvedValue(null);
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(envelope, mkDeps({ findOccupantByPlayer }));

      expect(findOccupantByPlayer).toHaveBeenCalledWith(
        expect.objectContaining({ playerKey: `ed25519:${identity.publicKeyHex}` }),
      );
    });

    it('stamps player_key on the occupant insert from the verified pubkey', async () => {
      const insertOccupant = vi
        .fn<(row: HomeNetworkOccupantRow) => Promise<InsertOccupantResult>>()
        .mockResolvedValue('ok');
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(envelope, mkDeps({ insertOccupant }));

      expect(insertOccupant).toHaveBeenCalledWith(
        expect.objectContaining({ player_key: `ed25519:${identity.publicKeyHex}` }),
      );
    });

    it('derives the hostname suffix from the verified pubkey, stable across calls', async () => {
      const insertOccupant = vi
        .fn<(row: HomeNetworkOccupantRow) => Promise<InsertOccupantResult>>()
        .mockResolvedValue('ok');

      // First call
      const envelope1 = makeEnvelope(identity);
      await handleJoinHomeNetworkRequest(envelope1, mkDeps({ insertOccupant }));
      const firstCall = insertOccupant.mock.calls[0]![0];

      // Second call (different envelope, same identity) — same hostname expected
      const envelope2 = makeEnvelope(identity);
      const insertOccupant2 = vi
        .fn<(row: HomeNetworkOccupantRow) => Promise<InsertOccupantResult>>()
        .mockResolvedValue('ok');
      await handleJoinHomeNetworkRequest(envelope2, mkDeps({ insertOccupant: insertOccupant2 }));
      const secondCall = insertOccupant2.mock.calls[0]![0];

      expect(firstCall.hostname).toBe(secondCall.hostname);
      expect(firstCall.hostname).toMatch(/^skylab-[0-9a-f]{4}$/);
    });
  });
});
