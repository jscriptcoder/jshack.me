import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRegisterWorkstationRequest } from './handler';
import type { WorkstationRow, UpsertWorkstationResult, PopulateBaseFsResult } from './types';
import type { RateLimiter } from '../ipRegistry/rateLimit';
import { noopRateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';

// Real signing in tests — handler-side behaviour is tightly coupled to
// the signing flow, so end-to-end tests are clearer than mocking
// verify(). Same approach as src/sessionRegistry/handler.test.ts.
const FIXED_NOW = 1_700_000_000_000;

const makeEnvelope = (
  identity: Identity,
  fields: Record<string, unknown> = {
    workstation_name: 'skylab',
    username: 'alice',
  },
) => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'registerWorkstation', fields);
  } finally {
    Date.now = realNow;
  }
};

const mkDeps = (overrides: {
  readonly upsertWorkstation?: (row: WorkstationRow) => Promise<UpsertWorkstationResult>;
  readonly populateBaseFs?: (row: WorkstationRow) => Promise<PopulateBaseFsResult>;
  readonly rateLimiter?: RateLimiter;
  readonly nonceStore?: NonceStore;
  readonly now?: () => number;
}) => ({
  upsertWorkstation:
    overrides.upsertWorkstation ??
    vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({ ok: true, inserted: true }),
  populateBaseFs:
    overrides.populateBaseFs ??
    vi.fn<(row: WorkstationRow) => Promise<PopulateBaseFsResult>>().mockResolvedValue({ ok: true }),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

describe('handleRegisterWorkstationRequest', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('returns 201 and stamps player_key from the verified pubkey on a fresh registration', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({ ok: true, inserted: true });
    const populateBaseFs = vi
      .fn<(row: WorkstationRow) => Promise<PopulateBaseFsResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(
      envelope,
      mkDeps({ upsertWorkstation, populateBaseFs }),
    );

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ inserted: true });
    expect(upsertWorkstation).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      workstation_name: 'skylab',
      username: 'alice',
    });
    expect(populateBaseFs).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      workstation_name: 'skylab',
      username: 'alice',
    });
  });

  it('returns 200 when re-registering with identical workstation_name and username', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({
        ok: true,
        inserted: false,
        existing: { workstation_name: 'skylab', username: 'alice' },
      });
    const populateBaseFs = vi.fn<(row: WorkstationRow) => Promise<PopulateBaseFsResult>>();
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(
      envelope,
      mkDeps({ upsertWorkstation, populateBaseFs }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ inserted: false });
    expect(populateBaseFs).not.toHaveBeenCalled();
  });

  it('returns 409 already_registered when re-registering with a different workstation_name', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({
        ok: true,
        inserted: false,
        existing: { workstation_name: 'OTHER-BOX', username: 'alice' },
      });
    const populateBaseFs = vi.fn<(row: WorkstationRow) => Promise<PopulateBaseFsResult>>();
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(
      envelope,
      mkDeps({ upsertWorkstation, populateBaseFs }),
    );

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'already_registered' });
    expect(populateBaseFs).not.toHaveBeenCalled();
  });

  it('returns 409 already_registered when re-registering with a different username', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({
        ok: true,
        inserted: false,
        existing: { workstation_name: 'skylab', username: 'OTHER-USER' },
      });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(envelope, mkDeps({ upsertWorkstation }));

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'already_registered' });
  });

  it('returns 401 signature_invalid when the signature is tampered', async () => {
    const envelope = makeEnvelope(identity);
    const tampered = { ...envelope, signature: '00'.repeat(64) };

    const result = await handleRegisterWorkstationRequest(tampered, mkDeps({}));

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'signature_invalid' });
  });

  it('returns 400 payload_invalid when the workstation_name violates the schema bounds', async () => {
    const envelope = makeEnvelope(identity, {
      workstation_name: '',
      username: 'alice',
    });

    const result = await handleRegisterWorkstationRequest(envelope, mkDeps({}));

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'payload_invalid' });
  });

  it('returns 429 rate_limited with Retry-After when the rate-limiter rejects', async () => {
    const rateLimiter: RateLimiter = vi
      .fn<RateLimiter>()
      .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(envelope, mkDeps({ rateLimiter }));

    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'rate_limited' });
    expect(result.headers).toEqual({ 'Retry-After': '30' });
  });

  it('returns 500 upsert_failed when the DB upsert fails', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(envelope, mkDeps({ upsertWorkstation }));

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'upsert_failed' });
  });

  it('still returns 201 on a fresh insert when populateBaseFs reports failure (best-effort)', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({ ok: true, inserted: true });
    const populateBaseFs = vi
      .fn<(row: WorkstationRow) => Promise<PopulateBaseFsResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(
      envelope,
      mkDeps({ upsertWorkstation, populateBaseFs }),
    );

    expect(result.status).toBe(201);
    expect(populateBaseFs).toHaveBeenCalledOnce();
  });
});
