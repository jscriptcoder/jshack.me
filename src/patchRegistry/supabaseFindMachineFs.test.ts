import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindMachineFs } from './supabaseFindMachineFs';
import type { FindMachineFsParams } from './supabaseFindMachineFs';

const params: FindMachineFsParams = {
  machine_id: '10.0.0.1',
  path: '/etc/shadow',
};

const validRow = {
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
};

describe('createSupabaseFindMachineFs', () => {
  it('returns ok: true with found: true and the parsed node when query returns a row', async () => {
    const query = vi.fn().mockResolvedValue({ data: [validRow], error: null });
    const find = createSupabaseFindMachineFs(query);

    const result = await find(params);
    expect(result).toEqual({
      ok: true,
      found: true,
      node: {
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      },
    });
  });

  it('returns ok: true with found: false when query returns an empty array', async () => {
    // The "no row" case is the L2 gap — handler today maps this to allow
    // (leaf-only enforcement). The adapter just surfaces the absence.
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: true, found: false });
  });

  it('returns ok: true with found: false when data is null and no error (defensive)', async () => {
    const query = vi.fn().mockResolvedValue({ data: null, error: null });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: true, found: false });
  });

  it('returns ok: false when supabase returns an error', async () => {
    // Distinct from "row not found" — the lookup itself broke. Handler
    // maps to 500 (server can't determine), not 403 (L2 deny).
    const query = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX001', message: 'connection lost' },
    });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: false });
  });

  it('forwards machine_id and path verbatim to the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindMachineFs(query);

    await find({ machine_id: 'kali-aabbccdd', path: '/home/alice/notes.txt' });

    expect(query).toHaveBeenCalledWith({
      machine_id: 'kali-aabbccdd',
      path: '/home/alice/notes.txt',
    });
  });

  it('returns ok: false when row owner is not in the user-type enum', async () => {
    // Defensive against rogue inserts: an attacker who somehow inserted
    // a row with owner='admin' wouldn't be honored by L2.
    const query = vi.fn().mockResolvedValue({
      data: [{ ...validRow, owner: 'admin' }],
      error: null,
    });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: false });
  });

  it('returns ok: false when permissions JSONB is missing required keys', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ ...validRow, permissions: { read: ['root'] } }],
      error: null,
    });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: false });
  });

  it('returns ok: false when row carries unknown extra fields (strict parse)', async () => {
    // Schema is .strict() — fail-closed if a stale projection or
    // hand-written row sneaks in extra columns the L2 walker doesn't
    // model. Pinned because dropping the strictness would silently
    // accept node_type/content from a future migration regression.
    const query = vi.fn().mockResolvedValue({
      data: [{ ...validRow, node_type: 'file' }],
      error: null,
    });
    const find = createSupabaseFindMachineFs(query);

    expect(await find(params)).toEqual({ ok: false });
  });
});
