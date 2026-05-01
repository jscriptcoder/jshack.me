import { describe, it, expect } from 'vitest';
import { patchesSignedPayloadSchema } from './types';

const baseEnvelope = {
  ts: 1700000000,
  nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

describe('listPatchesForMachines schema arm', () => {
  it('parses a valid envelope with machine_ids array', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'listPatchesForMachines',
      ...baseEnvelope,
      machine_ids: ['10.0.0.1', 'localhost'],
    });
    expect(result.action).toBe('listPatchesForMachines');
    if (result.action === 'listPatchesForMachines') {
      expect(result.machine_ids).toEqual(['10.0.0.1', 'localhost']);
    }
  });

  it('rejects empty machine_ids array (min 1)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: [],
      }),
    ).toThrow();
  });

  it('rejects oversized machine_ids array (> 100 entries)', () => {
    const oversized = Array.from({ length: 101 }, (_, i) => `10.0.0.${i}`);
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: oversized,
      }),
    ).toThrow();
  });

  it('accepts the boundary of 100 entries', () => {
    const onTheNose = Array.from({ length: 100 }, (_, i) => `10.0.0.${i}`);
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: onTheNose,
      }),
    ).not.toThrow();
  });

  it('rejects non-string entries in machine_ids', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: ['10.0.0.1', 42],
      }),
    ).toThrow();
  });

  it('rejects empty-string entries (min 1 char each)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: ['10.0.0.1', ''],
      }),
    ).toThrow();
  });

  it('rejects oversized-string entries (> 256 chars)', () => {
    const tooLong = 'x'.repeat(257);
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: ['10.0.0.1', tooLong],
      }),
    ).toThrow();
  });

  it('accepts the boundary of exactly 256-char entries', () => {
    const onTheNose = 'x'.repeat(256);
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: [onTheNose],
      }),
    ).not.toThrow();
  });

  it('rejects missing machine_ids field', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
      }),
    ).toThrow();
  });

  it('rejects extra unknown fields (strict)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'listPatchesForMachines',
        ...baseEnvelope,
        machine_ids: ['10.0.0.1'],
        extra: 'nope',
      }),
    ).toThrow();
  });
});

describe('existing schema arms still parse (regression)', () => {
  it('parses upsertPatch', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'upsertPatch',
        ...baseEnvelope,
        machine_id: '10.0.0.1',
        path: '/tmp/foo',
        content: 'hello',
        owner: 'user',
      }),
    ).not.toThrow();
  });

  it('parses removePatch', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'removePatch',
        ...baseEnvelope,
        machine_id: '10.0.0.1',
        path: '/tmp/foo',
      }),
    ).not.toThrow();
  });

  it('parses clearOwnedPatches', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'clearOwnedPatches',
        ...baseEnvelope,
      }),
    ).not.toThrow();
  });
});
