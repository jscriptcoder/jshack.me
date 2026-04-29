import { describe, it, expect, vi } from 'vitest';
import { createSupabaseListPatchesForMachines } from './supabaseSelectByMachine';
import type { ListPatchesForMachinesParams, PatchSummary } from './types';

const params: ListPatchesForMachinesParams = {
  machine_ids: ['10.0.0.1', 'localhost'],
  player_key: 'aa'.repeat(32),
};

// Two patches at the same path on the same machine, different authors —
// simulates Player A and Player B both editing /etc/hosts on machine X.
// The wiring layer's ORDER BY updated_at ASC means later-written rows
// arrive last; the adapter just preserves order.
const patchFromPlayerA: PatchSummary = {
  machine_id: '10.0.0.1',
  path: '/etc/hosts',
  content: '127.0.0.1 localhost\n10.0.0.1 from-A',
  owner: 'root',
  permissions: null,
  is_new: false,
  node_type: 'file',
};

const patchFromPlayerB: PatchSummary = {
  machine_id: '10.0.0.1',
  path: '/etc/hosts',
  content: '127.0.0.1 localhost\n10.0.0.1 from-B',
  owner: 'root',
  permissions: null,
  is_new: false,
  node_type: 'file',
};

const patchOnDifferentMachine: PatchSummary = {
  machine_id: 'localhost',
  path: '/home/user/.bashrc',
  content: 'export PS1="$ "',
  owner: 'user',
  permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: [] },
  is_new: true,
  node_type: 'file',
};

describe('createSupabaseListPatchesForMachines', () => {
  it('returns ok: true with patches array when select succeeds', async () => {
    const selectRows = vi.fn().mockResolvedValue({
      data: [patchFromPlayerA, patchFromPlayerB, patchOnDifferentMachine],
      error: null,
    });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    expect(await listForMachines(params)).toEqual({
      ok: true,
      patches: [patchFromPlayerA, patchFromPlayerB, patchOnDifferentMachine],
    });
    expect(selectRows).toHaveBeenCalledWith(params);
  });

  it('preserves multi-author row order (adapter does not sort)', async () => {
    // Caller (api/patches.ts) is responsible for ORDER BY updated_at ASC.
    // Adapter must NOT reorder — that would defeat last-write-wins.
    const selectRows = vi.fn().mockResolvedValue({
      data: [patchFromPlayerA, patchFromPlayerB],
      error: null,
    });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    const result = await listForMachines(params);
    expect(result).toEqual({
      ok: true,
      patches: [patchFromPlayerA, patchFromPlayerB],
    });
  });

  it('returns ok: true with empty array when no patches exist', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: [], error: null });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    expect(await listForMachines(params)).toEqual({ ok: true, patches: [] });
  });

  it('returns ok: true with empty array when data is null and no error (defensive)', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    expect(await listForMachines(params)).toEqual({ ok: true, patches: [] });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const selectRows = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'query error' } });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    expect(await listForMachines(params)).toEqual({ ok: false });
  });

  it('forwards the params object (machine_ids + player_key) verbatim to selectRows', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: [], error: null });
    const listForMachines = createSupabaseListPatchesForMachines(selectRows);

    await listForMachines({ machine_ids: ['a', 'b', 'c'], player_key: 'bb'.repeat(32) });

    expect(selectRows).toHaveBeenCalledWith({
      machine_ids: ['a', 'b', 'c'],
      player_key: 'bb'.repeat(32),
    });
  });
});
