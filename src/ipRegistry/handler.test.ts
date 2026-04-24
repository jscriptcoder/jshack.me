import { describe, it, expect, vi } from 'vitest';
import { handleAllocateRequest } from './handler';
import type { InsertResult } from './types';

const mkDeps = (overrides: {
  readonly insertIp?: (row: unknown) => Promise<InsertResult>;
  readonly rollIp?: () => string;
}) => ({
  insertIp:
    overrides.insertIp ?? vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok'),
  rollIp: overrides.rollIp ?? vi.fn<() => string>().mockReturnValue('51.1.2.3'),
});

describe('handleAllocateRequest', () => {
  it('returns 200 with the allocated IP on success', async () => {
    const deps = mkDeps({});
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, deps);
    expect(result).toEqual({ status: 200, body: { ip: '51.1.2.3' } });
  });

  it('accepts optional owner_key and instance_ref', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const deps = mkDeps({ insertIp });

    const result = await handleAllocateRequest(
      { kind: 'home_network', owner_key: 'ed25519:abc', instance_ref: 'ref-xyz' },
      deps,
    );

    expect(result.status).toBe(200);
    expect(insertIp).toHaveBeenCalledWith({
      ip: '51.1.2.3',
      kind: 'home_network',
      owner_key: 'ed25519:abc',
      instance_ref: 'ref-xyz',
    });
  });

  it('returns 400 when body is missing kind', async () => {
    const result = await handleAllocateRequest({}, mkDeps({}));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'invalid_request' });
  });

  it('returns 400 when kind is not a known value', async () => {
    const result = await handleAllocateRequest({ kind: 'malicious_kind' }, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when body has unknown extra fields (strict schema)', async () => {
    const result = await handleAllocateRequest(
      { kind: 'mission_instance', admin: true },
      mkDeps({}),
    );
    expect(result.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const result = await handleAllocateRequest('malicious', mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when body is null', async () => {
    const result = await handleAllocateRequest(null, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 500 when allocation exhausts retries', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('conflict');
    const deps = mkDeps({ insertIp });
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'exhausted' });
  });

  it('returns 500 when insert errors', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('error');
    const deps = mkDeps({ insertIp });
    const result = await handleAllocateRequest({ kind: 'mission_instance' }, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'insert_failed' });
  });

  it('rejects oversized owner_key to prevent abuse', async () => {
    const result = await handleAllocateRequest(
      { kind: 'mission_instance', owner_key: 'x'.repeat(500) },
      mkDeps({}),
    );
    expect(result.status).toBe(400);
  });
});
