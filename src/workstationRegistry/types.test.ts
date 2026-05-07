import { describe, it, expect } from 'vitest';
import { registerWorkstationSignedPayloadSchema } from './types';

// Schema-shape tests for the registerWorkstation envelope. The schema
// is the server-side boundary — IntroScreen-side limits are UX, this
// is what the Vercel handler trusts. seed and rootPassword were added
// in PR 1 of plans/cross-player-base-fs-replication.md to drive correct
// /etc/passwd content projection (real hashes, not the placeholder hash
// stored before this PR).

const baseEnvelope = {
  action: 'registerWorkstation' as const,
  ts: 1_700_000_000,
  nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const validFields = {
  workstation_name: 'skylab',
  username: 'alice',
  seed: '0123456789abcdef',
  rootPassword: 'sup3r-s3cr3t',
};

describe('registerWorkstationSignedPayloadSchema', () => {
  it('parses a valid envelope with all required fields', () => {
    const result = registerWorkstationSignedPayloadSchema.parse({
      ...baseEnvelope,
      ...validFields,
    });
    expect(result.seed).toBe('0123456789abcdef');
    expect(result.rootPassword).toBe('sup3r-s3cr3t');
  });

  it('rejects an envelope missing seed', () => {
    const { seed: _seed, ...rest } = validFields;
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({ ...baseEnvelope, ...rest }),
    ).toThrow();
  });

  it('rejects an envelope missing rootPassword', () => {
    const { rootPassword: _rp, ...rest } = validFields;
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({ ...baseEnvelope, ...rest }),
    ).toThrow();
  });

  it('rejects empty seed (min 1)', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        seed: '',
      }),
    ).toThrow();
  });

  it('rejects empty rootPassword (min 1)', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        rootPassword: '',
      }),
    ).toThrow();
  });

  it('rejects oversized seed (> 64)', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        seed: 'x'.repeat(65),
      }),
    ).toThrow();
  });

  it('rejects oversized rootPassword (> 64)', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        rootPassword: 'x'.repeat(65),
      }),
    ).toThrow();
  });

  it('accepts the boundary of 64 chars', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        seed: 'x'.repeat(64),
        rootPassword: 'x'.repeat(64),
      }),
    ).not.toThrow();
  });

  it('rejects non-string seed', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        seed: 12345,
      }),
    ).toThrow();
  });

  it('rejects non-string rootPassword', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        rootPassword: 12345,
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      registerWorkstationSignedPayloadSchema.parse({
        ...baseEnvelope,
        ...validFields,
        unknown_field: 'oops',
      }),
    ).toThrow();
  });
});
