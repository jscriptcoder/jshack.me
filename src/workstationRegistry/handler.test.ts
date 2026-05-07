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

const DEFAULT_ENVELOPE_FIELDS = {
  workstation_name: 'skylab',
  username: 'alice',
  seed: '0123456789abcdef',
  rootPassword: 'sup3r-s3cr3t',
};

const makeEnvelope = (
  identity: Identity,
  fields: Record<string, unknown> = DEFAULT_ENVELOPE_FIELDS,
) => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'registerWorkstation', fields);
  } finally {
    Date.now = realNow;
  }
};

type PopulateBaseFsFn = (row: WorkstationRow, rootPassword: string) => Promise<PopulateBaseFsResult>;

const mkDeps = (overrides: {
  readonly upsertWorkstation?: (row: WorkstationRow) => Promise<UpsertWorkstationResult>;
  readonly populateBaseFs?: PopulateBaseFsFn;
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
    vi.fn<PopulateBaseFsFn>().mockResolvedValue({ ok: true }),
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
    const populateBaseFs = vi.fn<PopulateBaseFsFn>().mockResolvedValue({ ok: true });
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
      seed: '0123456789abcdef',
    });
    expect(populateBaseFs).toHaveBeenCalledWith(
      {
        player_key: identity.publicKeyHex,
        workstation_name: 'skylab',
        username: 'alice',
        seed: '0123456789abcdef',
      },
      'sup3r-s3cr3t',
    );
  });

  it('passes rootPassword separately from the row, never on it (persistence boundary)', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({ ok: true, inserted: true });
    const populateBaseFs = vi.fn<PopulateBaseFsFn>().mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity);

    await handleRegisterWorkstationRequest(envelope, mkDeps({ upsertWorkstation, populateBaseFs }));

    // upsertWorkstation row must not contain rootPassword — that's the
    // persistence boundary (row is what hits the workstations table).
    const rowArg = upsertWorkstation.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(rowArg).toBeDefined();
    expect(rowArg).not.toHaveProperty('rootPassword');

    // populateBaseFs is called with (row, rootPassword) positionally;
    // rootPassword is the second arg, not folded into the row.
    const populateRowArg = populateBaseFs.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(populateRowArg).toBeDefined();
    expect(populateRowArg).not.toHaveProperty('rootPassword');
    expect(populateBaseFs.mock.calls[0]?.[1]).toBe('sup3r-s3cr3t');
  });

  it('returns 200 when re-registering with identical workstation_name and username', async () => {
    const upsertWorkstation = vi
      .fn<(row: WorkstationRow) => Promise<UpsertWorkstationResult>>()
      .mockResolvedValue({
        ok: true,
        inserted: false,
        existing: { workstation_name: 'skylab', username: 'alice' },
      });
    const populateBaseFs = vi.fn<PopulateBaseFsFn>();
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
    const populateBaseFs = vi.fn<PopulateBaseFsFn>();
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
    const populateBaseFs = vi.fn<PopulateBaseFsFn>().mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity);

    const result = await handleRegisterWorkstationRequest(
      envelope,
      mkDeps({ upsertWorkstation, populateBaseFs }),
    );

    expect(result.status).toBe(201);
    expect(populateBaseFs).toHaveBeenCalledOnce();
  });
});
