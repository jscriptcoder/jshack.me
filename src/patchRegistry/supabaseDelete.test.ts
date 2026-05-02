import { describe, it, expect, vi } from 'vitest';
import { createSupabaseRemovePatch, createSupabaseClearOwnedPatches } from './supabaseDelete';
import type { ClearPatchesParams, RemovePatchParams } from './types';

const params: RemovePatchParams = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
  path: '/tmp/foo.txt',
  dual_write: true,
};

const okEmpty = { data: [], error: null };
const okOne = { data: [{ path: '/tmp/foo.txt' }], error: null };
const okMany = {
  data: [{ path: '/dir' }, { path: '/dir/a' }, { path: '/dir/b/c' }],
  error: null,
};

describe('createSupabaseRemovePatch', () => {
  it('returns ok: true with affected = data.length when delete succeeds', async () => {
    const deleteRows = vi.fn().mockResolvedValue(okMany);
    const removePatch = createSupabaseRemovePatch(deleteRows);

    expect(await removePatch({ ...params, path: '/dir' })).toEqual({
      ok: true,
      affected: 3,
    });
  });

  it('returns ok: true with affected = 0 when no rows matched (idempotent)', async () => {
    const deleteRows = vi.fn().mockResolvedValue(okEmpty);
    const removePatch = createSupabaseRemovePatch(deleteRows);

    expect(await removePatch(params)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: true with affected = 0 when data is null and no error (defensive)', async () => {
    // Guards against SDK shapes where data === null without an error.
    const deleteRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const removePatch = createSupabaseRemovePatch(deleteRows);

    expect(await removePatch(params)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const deleteRows = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'storage error' } });
    const removePatch = createSupabaseRemovePatch(deleteRows);

    expect(await removePatch(params)).toEqual({ ok: false });
  });

  describe('descendant prefix calculation', () => {
    it('appends "/" to a non-trailing-slash path (file-style)', async () => {
      const deleteRows = vi.fn().mockResolvedValue(okOne);
      const removePatch = createSupabaseRemovePatch(deleteRows);

      await removePatch({ ...params, path: '/tmp/foo.txt' });

      expect(deleteRows).toHaveBeenCalledWith({
        player_key: 'pubkey-hex',
        machine_id: '10.0.0.1',
        path: '/tmp/foo.txt',
        path_prefix: '/tmp/foo.txt/',
        dual_write: true,
      });
    });

    it('preserves a trailing-slash path (directory-style) without doubling', async () => {
      const deleteRows = vi.fn().mockResolvedValue(okOne);
      const removePatch = createSupabaseRemovePatch(deleteRows);

      await removePatch({ ...params, path: '/srv/data/' });

      expect(deleteRows).toHaveBeenCalledWith({
        player_key: 'pubkey-hex',
        machine_id: '10.0.0.1',
        path: '/srv/data/',
        path_prefix: '/srv/data/',
        dual_write: true,
      });
    });

    it('handles a single-segment path correctly', async () => {
      const deleteRows = vi.fn().mockResolvedValue(okOne);
      const removePatch = createSupabaseRemovePatch(deleteRows);

      await removePatch({ ...params, path: '/foo' });

      expect(deleteRows).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/foo', path_prefix: '/foo/' }),
      );
    });

    it('forwards player_key and machine_id verbatim', async () => {
      const deleteRows = vi.fn().mockResolvedValue(okOne);
      const removePatch = createSupabaseRemovePatch(deleteRows);

      await removePatch({
        player_key: 'another-key',
        machine_id: 'localhost',
        path: '/etc',
        dual_write: true,
      });

      expect(deleteRows).toHaveBeenCalledWith(
        expect.objectContaining({
          player_key: 'another-key',
          machine_id: 'localhost',
        }),
      );
    });

    it('forwards dual_write=false (own-workstation bypass) verbatim', async () => {
      // Pinned: the handler decides own-workstation bypass; the adapter
      // must propagate the flag without re-deciding it. Flipping
      // dual_write back to true here would corrupt the L2 invariant by
      // dropping shared machine_filesystems rows when the player wipes
      // their own box.
      const deleteRows = vi.fn().mockResolvedValue(okOne);
      const removePatch = createSupabaseRemovePatch(deleteRows);

      await removePatch({ ...params, dual_write: false });

      expect(deleteRows).toHaveBeenCalledWith(expect.objectContaining({ dual_write: false }));
    });
  });
});

// -----------------------------------------------------------------------
// clearOwnedPatches — DELETE WHERE player_key=me AND
//   machine_id=$workstation_id  (the player's own-workstation patches,
//   not the shared world). The workstation_id arrives in the signed
//   envelope; under the eliminated-localhost model it IS the suffixed
//   hostname computed from the player_key, so a forged value won't
//   match any rows owned by the verified player_key.
// -----------------------------------------------------------------------

const clearParams: ClearPatchesParams = {
  player_key: 'pubkey-hex',
  workstation_id: 'skylab-aabbccdd',
};

describe('createSupabaseClearOwnedPatches', () => {
  it('returns ok: true with affected = data.length when delete succeeds', async () => {
    const clearOwned = vi.fn().mockResolvedValue({
      data: Array.from({ length: 7 }, (_, i) => ({ path: `/tmp/${i}` })),
      error: null,
    });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 7 });
  });

  it('returns ok: true with affected = 0 when player has no own-workstation patches', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: true with affected = 0 when data is null and no error (defensive)', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: null, error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const clearOwned = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'storage error' } });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    expect(await clear(clearParams)).toEqual({ ok: false });
  });

  it('passes the workstation_id verbatim as the machine_id filter', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    await clear(clearParams);

    expect(clearOwned).toHaveBeenCalledWith({
      player_key: 'pubkey-hex',
      workstation_id: 'skylab-aabbccdd',
    });
    // Pinned: cross-player patches on other machines must NOT be wiped
    // by reset — that's the whole point of scoping to owned machines.
    expect(clearOwned).toHaveBeenCalledTimes(1);
  });

  it('forwards a different player_key + workstation_id verbatim', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    await clear({ player_key: 'another-key', workstation_id: 'rocket-bbccdd11' });

    expect(clearOwned).toHaveBeenCalledWith({
      player_key: 'another-key',
      workstation_id: 'rocket-bbccdd11',
    });
  });
});
