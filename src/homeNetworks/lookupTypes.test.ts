import { describe, it, expect } from 'vitest';
import { lookupHomeNetworkSignedPayloadSchema, homeNetworkLookupResultSchema } from './types';

const validSignedPayload = {
  action: 'lookupHomeNetwork',
  ts: 1_700_000_000_000,
  nonce: 'a'.repeat(32),
  public_ip: '162.174.39.103',
};

describe('lookupHomeNetworkSignedPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse(validSignedPayload);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown field (.strict)', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse({
      ...validSignedPayload,
      extra: 'oops',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a wrong action literal', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse({
      ...validSignedPayload,
      action: 'joinHomeNetwork',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a nonce that is not 32 hex chars', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse({
      ...validSignedPayload,
      nonce: 'short',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty public_ip', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse({
      ...validSignedPayload,
      public_ip: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a numeric public_ip', () => {
    const parsed = lookupHomeNetworkSignedPayloadSchema.safeParse({
      ...validSignedPayload,
      public_ip: 162,
    });
    expect(parsed.success).toBe(false);
  });
});

const validLookupResult = {
  public_ip: '162.174.39.103',
  essid_template: 'ACME-CORP',
  density_tier: 'crowded',
  max_slots: 8,
  seed: 'home-162.174.39.103',
};

describe('homeNetworkLookupResultSchema', () => {
  it('accepts a well-formed row projection', () => {
    const parsed = homeNetworkLookupResultSchema.safeParse(validLookupResult);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown field (.strict)', () => {
    const parsed = homeNetworkLookupResultSchema.safeParse({
      ...validLookupResult,
      created_at: '2026-05-01',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a density_tier outside the canonical set', () => {
    const parsed = homeNetworkLookupResultSchema.safeParse({
      ...validLookupResult,
      density_tier: 'tiny',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing seed', () => {
    const { seed: _seed, ...withoutSeed } = validLookupResult;
    const parsed = homeNetworkLookupResultSchema.safeParse(withoutSeed);
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-numeric max_slots', () => {
    const parsed = homeNetworkLookupResultSchema.safeParse({
      ...validLookupResult,
      max_slots: '8',
    });
    expect(parsed.success).toBe(false);
  });
});
