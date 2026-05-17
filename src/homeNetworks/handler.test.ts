import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleJoinHomeNetworkRequest,
  handleLookupHomeNetworkRequest,
  type HandlerDeps,
  type LookupHomeNetworkDeps,
} from './handler';
import type {
  HomeNetworkOccupantRow,
  HomeNetworkRow,
  InsertOccupantResult,
  DensityTier,
  OccupantSummary,
} from './types';
import { noopRateLimiter, type RateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';
import { deriveHostnameSuffix } from './homeNetworkHelpers';

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
  pickLanIp: overrides.pickLanIp ?? vi.fn().mockResolvedValue('.187'),
  // Optional in HandlerDeps — only forward if the caller supplied one.
  // Most existing tests don't care about the broadcast; the omitted-dep
  // codepath is exercised by the dedicated "handler stays ok when
  // publishOccupantChange dep is omitted" test.
  ...(overrides.publishOccupantChange !== undefined && {
    publishOccupantChange: overrides.publishOccupantChange,
  }),
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
        .mockResolvedValueOnce('.10')
        .mockResolvedValueOnce('.11')
        .mockResolvedValueOnce('.12');
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

    it('forwards the network seed + publicIp to pickLanIp so the wiring can compute exclusions', async () => {
      // Pinned: the handler MUST pass the seed/publicIp pair on every
      // call so the wiring layer can build a per-network exclusion set
      // (NPC octets the FS generator produced + existing occupant
      // octets). A mutant that called pickLanIp() without args would
      // regress to the blind-random allocator that landed Player B
      // on top of NPC IPs.
      const pickLanIp = vi.fn().mockResolvedValue('.187');
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(envelope, mkDeps({ pickLanIp }));

      expect(pickLanIp).toHaveBeenCalledWith(
        expect.objectContaining({
          seed: expect.any(String),
          publicIp: expect.any(String),
        }),
      );
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
      expect(firstCall.hostname).toMatch(/^skylab-[0-9a-f]{8}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Realtime hint broadcast on successful occupant insert
  //
  // Mirrors the patches hint design (project_realtime_publish_authorization
  // memory): after each successful occupant INSERT, broadcast
  // `{ network_id, originator_key }` on `occupants:<network_id>`.
  // Subscribers refetch authoritative state via listOccupants.
  //
  // Must NOT fire on idempotent existing-row return (nothing changed) or
  // on any failure path (lan_ip_conflict that exhausts retries,
  // hostname_conflict, occupant insert error, ip_allocation_exhausted).
  // -----------------------------------------------------------------------

  describe('hint broadcast on successful insert', () => {
    it('fires publishOccupantChange(network_id, originator_key) after a successful new join', async () => {
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(envelope, mkDeps({ publishOccupantChange }));

      expect(publishOccupantChange).toHaveBeenCalledTimes(1);
      expect(publishOccupantChange).toHaveBeenCalledWith(
        '203.0.113.10',
        `ed25519:${identity.publicKeyHex}`,
      );
    });

    it('originator_key matches the player_key stamped on the occupant row (ed25519: prefix)', async () => {
      // Subscribers compare hint.originator_key to their own row.player_key
      // for self-skip — the prefixes must match. A mutant that dropped
      // the 'ed25519:' prefix on either side would break self-skip.
      const insertOccupant = vi
        .fn<(row: HomeNetworkOccupantRow) => Promise<InsertOccupantResult>>()
        .mockResolvedValue('ok');
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ insertOccupant, publishOccupantChange }),
      );

      const insertedKey = insertOccupant.mock.calls[0]![0].player_key;
      const broadcastKey = publishOccupantChange.mock.calls[0]![1];
      expect(broadcastKey).toBe(insertedKey);
    });

    it('uses the chosen network public_ip as the channel network_id', async () => {
      // Whether the network was created fresh or reused, the broadcast
      // network_id must be the actual public_ip the occupant landed on.
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const findNetworkWithFreeSlots = vi
        .fn()
        .mockResolvedValue(sampleNetwork({ public_ip: '198.51.100.7' }));
      const envelope = makeEnvelope(identity);

      await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ findNetworkWithFreeSlots, publishOccupantChange }),
      );

      expect(publishOccupantChange).toHaveBeenCalledWith(
        '198.51.100.7',
        `ed25519:${identity.publicKeyHex}`,
      );
    });

    it('does NOT fire on idempotent existing-row return (nothing changed)', async () => {
      // The findOccupantByPlayer short-circuit returns the cached slot
      // without inserting anything. No subscribers need to know.
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const findOccupantByPlayer = vi.fn().mockResolvedValue({
        network: sampleNetwork(),
        occupant: sampleOccupant({ player_key: `ed25519:${identity.publicKeyHex}` }),
      });
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ findOccupantByPlayer, publishOccupantChange }),
      );

      expect(result.status).toBe(200);
      expect(publishOccupantChange).not.toHaveBeenCalled();
    });

    it('does NOT fire when slot allocation exhausts retries', async () => {
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('lan_ip_conflict');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ insertOccupant, publishOccupantChange }),
      );

      expect(result.status).toBe(500);
      expect(publishOccupantChange).not.toHaveBeenCalled();
    });

    it('does NOT fire on hostname_conflict (insert failed deterministically)', async () => {
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('hostname_conflict');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ insertOccupant, publishOccupantChange }),
      );

      expect(result.status).toBe(409);
      expect(publishOccupantChange).not.toHaveBeenCalled();
    });

    it('does NOT fire on occupant insert error', async () => {
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const insertOccupant = vi
        .fn<() => Promise<InsertOccupantResult>>()
        .mockResolvedValue('error');
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ insertOccupant, publishOccupantChange }),
      );

      expect(result.status).toBe(500);
      expect(publishOccupantChange).not.toHaveBeenCalled();
    });

    it('does NOT fire on ip_allocation_exhausted (no network was created)', async () => {
      const publishOccupantChange = vi
        .fn<(network_id: string, originator_key: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const allocatePublicIp = vi.fn().mockResolvedValue(null);
      const envelope = makeEnvelope(identity);

      const result = await handleJoinHomeNetworkRequest(
        envelope,
        mkDeps({ allocatePublicIp, publishOccupantChange }),
      );

      expect(result.status).toBe(500);
      expect(publishOccupantChange).not.toHaveBeenCalled();
    });

    it('handler stays ok when publishOccupantChange dep is omitted (optional)', async () => {
      // Tests + alternate adapters that don't care about broadcasts can
      // skip wiring the dep. Handler must not throw.
      const envelope = makeEnvelope(identity);
      const result = await handleJoinHomeNetworkRequest(envelope, mkDeps({}));
      expect(result.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// handleLookupHomeNetworkRequest — piece-2b lazy-subscription primitive
// ---------------------------------------------------------------------------

const makeLookupEnvelope = (identity: Identity, publicIp = '203.0.113.42') => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'lookupHomeNetwork', { public_ip: publicIp });
  } finally {
    Date.now = realNow;
  }
};

const mkLookupDeps = (overrides: Partial<LookupHomeNetworkDeps> = {}): LookupHomeNetworkDeps => ({
  findHomeNetworkByPublicIp: overrides.findHomeNetworkByPublicIp ?? vi.fn().mockResolvedValue(null),
  listOccupantsByNetworkId: overrides.listOccupantsByNetworkId ?? vi.fn().mockResolvedValue([]),
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
    it('returns 200 with public_ip + occupants when the home_networks row exists', async () => {
      const network = sampleNetwork({ public_ip: '203.0.113.42' });
      const occupants: readonly OccupantSummary[] = [
        { network_id: '203.0.113.42', lan_ip: '.187', hostname: 'skylab-9k3' },
        { network_id: '203.0.113.42', lan_ip: '.42', hostname: 'rocket-bbccdd11' },
      ];
      const findHomeNetworkByPublicIp = vi.fn().mockResolvedValue(network);
      const listOccupantsByNetworkId = vi.fn().mockResolvedValue(occupants);
      const envelope = makeLookupEnvelope(identity);

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkLookupDeps({ findHomeNetworkByPublicIp, listOccupantsByNetworkId }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        public_ip: '203.0.113.42',
        occupants,
      });
      expect(findHomeNetworkByPublicIp).toHaveBeenCalledWith('203.0.113.42');
      expect(listOccupantsByNetworkId).toHaveBeenCalledWith('203.0.113.42');
    });

    it('returns 200 with empty occupants when the row exists but has no occupants', async () => {
      // Edge case: a brand-new home_networks row that has not yet had its
      // first joinOccupant complete (race window). Lookup must still succeed
      // and report an empty occupant list — the router itself is reachable
      // even without players on the LAN.
      const network = sampleNetwork({ public_ip: '203.0.113.42' });
      const findHomeNetworkByPublicIp = vi.fn().mockResolvedValue(network);
      const listOccupantsByNetworkId = vi.fn().mockResolvedValue([]);
      const envelope = makeLookupEnvelope(identity);

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkLookupDeps({ findHomeNetworkByPublicIp, listOccupantsByNetworkId }),
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ public_ip: '203.0.113.42', occupants: [] });
    });
  });

  describe('not found', () => {
    it('returns 404 when no home_networks row matches the public_ip', async () => {
      // Distinct from a hard error — the client wrapper turns 404 into null
      // so callers can treat the IP as unresolvable without throwing.
      const findHomeNetworkByPublicIp = vi.fn().mockResolvedValue(null);
      const listOccupantsByNetworkId = vi.fn();
      const envelope = makeLookupEnvelope(identity);

      const result = await handleLookupHomeNetworkRequest(
        envelope,
        mkLookupDeps({ findHomeNetworkByPublicIp, listOccupantsByNetworkId }),
      );

      expect(result.status).toBe(404);
      expect(result.body).toEqual({ error: 'not_found' });
      // Occupant query skipped — no row to query against.
      expect(listOccupantsByNetworkId).not.toHaveBeenCalled();
    });
  });

  describe('auth + rate limit', () => {
    it('returns 401 when the signature is forged', async () => {
      // Sign with one identity, swap the publicKey to another — verify fails.
      const realEnvelope = makeLookupEnvelope(identity);
      const otherIdentity = generateIdentity();
      const forged = { ...realEnvelope, publicKey: otherIdentity.publicKeyHex };

      const result = await handleLookupHomeNetworkRequest(forged, mkLookupDeps({}));

      expect(result.status).toBe(401);
    });

    it('returns 400 when the envelope is structurally invalid', async () => {
      const result = await handleLookupHomeNetworkRequest(
        { not: 'a real envelope' },
        mkLookupDeps({}),
      );
      expect(result.status).toBe(400);
    });

    it('returns 400 when the payload public_ip is malformed', async () => {
      // 'not-an-ip' fails the IPv4 regex in
      // lookupHomeNetworkSignedPayloadSchema.
      const realNow = Date.now;
      Date.now = () => FIXED_NOW;
      const envelope = signRequest(identity, 'lookupHomeNetwork', { public_ip: 'not-an-ip' });
      Date.now = realNow;

      const result = await handleLookupHomeNetworkRequest(envelope, mkLookupDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 429 when the rate limiter denies', async () => {
      const rateLimiter: RateLimiter = vi
        .fn()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeLookupEnvelope(identity);

      const result = await handleLookupHomeNetworkRequest(envelope, mkLookupDeps({ rateLimiter }));

      expect(result.status).toBe(429);
      expect(result.body).toEqual({ error: 'rate_limited' });
      expect(result.headers).toEqual({ 'Retry-After': '30' });
    });

    it('does NOT query the DB when the rate limiter denies', async () => {
      // Cheap-checks-first: rate limiter gate fires before any DB I/O so a
      // hammering client can't drain Supabase quota.
      const rateLimiter: RateLimiter = vi
        .fn()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 1 });
      const findHomeNetworkByPublicIp = vi.fn();
      const envelope = makeLookupEnvelope(identity);

      await handleLookupHomeNetworkRequest(
        envelope,
        mkLookupDeps({ rateLimiter, findHomeNetworkByPublicIp }),
      );

      expect(findHomeNetworkByPublicIp).not.toHaveBeenCalled();
    });
  });
});
