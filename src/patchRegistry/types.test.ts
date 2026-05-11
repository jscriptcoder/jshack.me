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

  it('parses clearOwnedPatches with workstation_id', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'clearOwnedPatches',
        ...baseEnvelope,
        workstation_id: 'skylab-aabbccdd',
      }),
    ).not.toThrow();
  });
});

// PR 6 of plans/cross-player-base-fs-replication.md — eager bulk-fetch
// of cross-player workstation base filesystems. Single machine_id per
// request because the trigger is "session establish on workstation X"
// (one at a time). Server determines machine type and tier-filters the
// returned FileNode tree.
describe('getBaseFs schema arm', () => {
  it('parses a valid envelope', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'getBaseFs',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
    });
    expect(result.action).toBe('getBaseFs');
    if (result.action === 'getBaseFs') {
      expect(result.machine_id).toBe('omen-4a3b1c2d');
    }
  });

  it('rejects missing machine_id', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
      }),
    ).toThrow();
  });

  it('rejects empty machine_id (min 1)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
        machine_id: '',
      }),
    ).toThrow();
  });

  it('rejects oversized machine_id (> 256 chars)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
        machine_id: 'x'.repeat(257),
      }),
    ).toThrow();
  });

  it('accepts machine_id at the 256-char boundary', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
        machine_id: 'x'.repeat(256),
      }),
    ).not.toThrow();
  });

  it('rejects extra unknown fields (strict)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        extra: 'oops',
      }),
    ).toThrow();
  });

  it('rejects non-string machine_id', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'getBaseFs',
        ...baseEnvelope,
        machine_id: 42,
      }),
    ).toThrow();
  });
});

// PR 7 of plans/cross-player-base-fs-replication.md — server-side single-
// path read endpoint for the file_read / dir_list CVE effects, walking
// the cross-player workstation base FS at the caller's active session
// userType (read from the session row, not the envelope).
describe('exploitRead schema arm', () => {
  it('parses a valid file_read envelope', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'exploitRead',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
      path: '/etc/passwd',
      kind: 'file_read',
    });
    expect(result.action).toBe('exploitRead');
    if (result.action === 'exploitRead') {
      expect(result.machine_id).toBe('omen-4a3b1c2d');
      expect(result.path).toBe('/etc/passwd');
      expect(result.kind).toBe('file_read');
    }
  });

  it('parses a valid dir_list envelope', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'exploitRead',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
      path: '/root',
      kind: 'dir_list',
    });
    expect(result.action).toBe('exploitRead');
    if (result.action === 'exploitRead') {
      expect(result.kind).toBe('dir_list');
    }
  });

  it('rejects unknown kind', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        path: '/etc/passwd',
        kind: 'file_write',
      }),
    ).toThrow();
  });

  it('rejects missing path', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        kind: 'file_read',
      }),
    ).toThrow();
  });

  it('rejects missing kind', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        path: '/etc/passwd',
      }),
    ).toThrow();
  });

  it('rejects empty machine_id (min 1)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: '',
        path: '/etc/passwd',
        kind: 'file_read',
      }),
    ).toThrow();
  });

  it('rejects oversized path (> 4096 chars)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        path: 'x'.repeat(4097),
        kind: 'file_read',
      }),
    ).toThrow();
  });

  it('rejects extra unknown fields (strict)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        path: '/etc/passwd',
        kind: 'file_read',
        extra: 'oops',
      }),
    ).toThrow();
  });

  it('rejects envelope-supplied tier (server reads from session row)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'exploitRead',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        path: '/etc/passwd',
        kind: 'file_read',
        tier: 'root',
      }),
    ).toThrow();
  });
});

describe('crackCredentials schema arm', () => {
  const hash = (n: number): string => n.toString(16).padStart(32, '0');

  it('parses a valid ssh envelope', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'crackCredentials',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
      service: 'ssh',
      candidate_hashes: [hash(1), hash(2), hash(3)],
    });
    expect(result.action).toBe('crackCredentials');
    if (result.action === 'crackCredentials') {
      expect(result.machine_id).toBe('omen-4a3b1c2d');
      expect(result.service).toBe('ssh');
      expect(result.candidate_hashes).toHaveLength(3);
    }
  });

  it('parses a valid ftp envelope with user_filter', () => {
    const result = patchesSignedPayloadSchema.parse({
      action: 'crackCredentials',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
      service: 'ftp',
      candidate_hashes: [hash(1)],
      user_filter: 'alice',
    });
    expect(result.action).toBe('crackCredentials');
    if (result.action === 'crackCredentials') {
      expect(result.service).toBe('ftp');
      expect(result.user_filter).toBe('alice');
    }
  });

  it('rejects unsupported service', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'mysql',
        candidate_hashes: [hash(1)],
      }),
    ).toThrow();
  });

  it('rejects empty candidate_hashes (min 1)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: [],
      }),
    ).toThrow();
  });

  it('rejects oversized batch (> 200)', () => {
    const big = Array.from({ length: 201 }, (_, i) => hash(i + 1));
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: big,
      }),
    ).toThrow();
  });

  it('accepts batch at the upper limit (= 200)', () => {
    const exact = Array.from({ length: 200 }, (_, i) => hash(i + 1));
    const result = patchesSignedPayloadSchema.parse({
      action: 'crackCredentials',
      ...baseEnvelope,
      machine_id: 'omen-4a3b1c2d',
      service: 'ssh',
      candidate_hashes: exact,
    });
    expect(result.action).toBe('crackCredentials');
  });

  it('rejects non-hex hash', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: ['not-a-hash'],
      }),
    ).toThrow();
  });

  it('rejects wrong-length hash (not 32 chars)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: ['abc123'],
      }),
    ).toThrow();
  });

  it('rejects empty machine_id', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: '',
        service: 'ssh',
        candidate_hashes: [hash(1)],
      }),
    ).toThrow();
  });

  it('rejects extra unknown fields (strict)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: [hash(1)],
        tier: 'root',
      }),
    ).toThrow();
  });

  it('rejects empty user_filter (min 1 when present)', () => {
    expect(() =>
      patchesSignedPayloadSchema.parse({
        action: 'crackCredentials',
        ...baseEnvelope,
        machine_id: 'omen-4a3b1c2d',
        service: 'ssh',
        candidate_hashes: [hash(1)],
        user_filter: '',
      }),
    ).toThrow();
  });
});
