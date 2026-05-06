import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindMachineFsBatch } from './supabaseFindMachineFsBatch';
import type { FindMachineFsBatchParams } from './supabaseFindMachineFsBatch';

// Bulk adapter for the read-path filter: one SQL call per request to
// gather every (machine_id, path, owner, permissions) row needed for
// per-row + ancestor walker decisions, vs. N round-trips with the
// single-row supabaseFindMachineFs. Used exclusively by
// handleListPatchesForMachines (PR 2's wiring).

const validRow = (overrides?: Partial<{ machine_id: string; path: string }>) => ({
  machine_id: '10.0.0.1',
  path: '/etc/passwd',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  ...overrides,
});

describe('createSupabaseFindMachineFsBatch', () => {
  it('returns ok: true with rows[] when query returns multiple rows', async () => {
    const rowA = validRow({ machine_id: '10.0.0.1', path: '/etc/passwd' });
    const rowB = validRow({ machine_id: '10.0.0.2', path: '/var/run/sshd.pid' });
    const query = vi.fn().mockResolvedValue({ data: [rowA, rowB], error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    const result = await find({ machine_ids: ['10.0.0.1', '10.0.0.2'] });
    expect(result).toEqual({
      ok: true,
      rows: [rowA, rowB],
    });
  });

  it('short-circuits on empty machine_ids — does not invoke the query', async () => {
    // Avoids a `WHERE machine_id IN ()` round-trip that some Postgres
    // builds reject as a syntax error. Returning early also lets the
    // handler skip the bulk fetch when payload.machine_ids is empty
    // (caught upstream by zod min(1) but defense-in-depth).
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    const result = await find({ machine_ids: [] });
    expect(result).toEqual({ ok: true, rows: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns ok: true with empty rows for valid query yielding no matches', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.99'] })).toEqual({ ok: true, rows: [] });
  });

  it('returns ok: true with empty rows when data is null and no error', async () => {
    const query = vi.fn().mockResolvedValue({ data: null, error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.1'] })).toEqual({ ok: true, rows: [] });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const query = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX001', message: 'connection lost' },
    });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('forwards machine_ids verbatim to the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    await find({ machine_ids: ['kali-aabbccdd', '203.0.113.42', '10.0.0.5'] });

    expect(query).toHaveBeenCalledWith({
      machine_ids: ['kali-aabbccdd', '203.0.113.42', '10.0.0.5'],
    });
  });

  it('returns ok: false when any row has an out-of-enum owner (strict parse)', async () => {
    // Defensive against rogue rows: one bad row poisons the batch so
    // the handler short-circuits to 500 rather than acting on partial
    // data.
    const query = vi.fn().mockResolvedValue({
      data: [validRow(), { ...validRow(), owner: 'admin' }],
      error: null,
    });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('returns ok: false when any row has malformed permissions JSONB', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ ...validRow(), permissions: { read: ['root'] } }],
      error: null,
    });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('returns ok: false when any row carries unknown extra fields (strict parse)', async () => {
    // Same fail-closed posture as the single-row adapter — never silently
    // accept a future schema drift the walker doesn't model.
    const query = vi.fn().mockResolvedValue({
      data: [{ ...validRow(), node_type: 'file' }],
      error: null,
    });
    const find = createSupabaseFindMachineFsBatch(query);

    expect(await find({ machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('preserves row ordering from the query result', async () => {
    const rowA = validRow({ machine_id: 'a', path: '/a' });
    const rowB = validRow({ machine_id: 'b', path: '/b' });
    const rowC = validRow({ machine_id: 'c', path: '/c' });
    const query = vi.fn().mockResolvedValue({ data: [rowB, rowA, rowC], error: null });
    const find = createSupabaseFindMachineFsBatch(query);

    const result = await find({ machine_ids: ['a', 'b', 'c'] });
    expect(result).toEqual({ ok: true, rows: [rowB, rowA, rowC] });
  });
});

// Type sanity: ensure the params type is exported for the api/patches.ts
// wiring layer.
const _typeCheck: FindMachineFsBatchParams = { machine_ids: ['x'] };
void _typeCheck;
