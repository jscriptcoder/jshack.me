import { describe, it, expect, vi } from 'vitest';
import { createSupabaseListPatches } from './supabaseSelect';
import type { ListPatchesParams, PatchSummary } from './types';

const params: ListPatchesParams = {
  player_key: 'pubkey-hex',
};

const samplePatch: PatchSummary = {
  machine_id: '10.0.0.1',
  path: '/tmp/foo.txt',
  content: 'hello',
  owner: 'user',
  permissions: null,
  is_new: false,
  node_type: 'file',
};

const sampleDirPatch: PatchSummary = {
  machine_id: '10.0.0.1',
  path: '/srv/data',
  content: null,
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
  is_new: true,
  node_type: 'directory',
};

describe('createSupabaseListPatches', () => {
  it('returns ok: true with patches array when select succeeds', async () => {
    const selectRows = vi.fn().mockResolvedValue({
      data: [samplePatch, sampleDirPatch],
      error: null,
    });
    const listPatches = createSupabaseListPatches(selectRows);

    expect(await listPatches(params)).toEqual({
      ok: true,
      patches: [samplePatch, sampleDirPatch],
    });
    expect(selectRows).toHaveBeenCalledWith(params);
  });

  it('returns ok: true with empty array when player has no patches', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: [], error: null });
    const listPatches = createSupabaseListPatches(selectRows);

    expect(await listPatches(params)).toEqual({ ok: true, patches: [] });
  });

  it('returns ok: true with empty array when data is null and no error (defensive)', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const listPatches = createSupabaseListPatches(selectRows);

    expect(await listPatches(params)).toEqual({ ok: true, patches: [] });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const selectRows = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'query error' } });
    const listPatches = createSupabaseListPatches(selectRows);

    expect(await listPatches(params)).toEqual({ ok: false });
  });

  it('forwards the player_key verbatim to selectRows', async () => {
    const selectRows = vi.fn().mockResolvedValue({ data: [], error: null });
    const listPatches = createSupabaseListPatches(selectRows);

    await listPatches({ player_key: 'another-key' });

    expect(selectRows).toHaveBeenCalledWith({ player_key: 'another-key' });
  });
});
