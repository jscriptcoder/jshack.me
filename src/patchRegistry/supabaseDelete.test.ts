import { describe, it, expect, vi } from 'vitest';
import {
  createSupabaseRemovePatch,
  createSupabaseClearTransientPatches,
  createSupabaseClearOwnedPatches,
  PERSISTENT_MACHINE_ID,
} from './supabaseDelete';
import type { ClearPatchesParams, RemovePatchParams } from './types';

const params: RemovePatchParams = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
  path: '/tmp/foo.txt',
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
      });

      expect(deleteRows).toHaveBeenCalledWith(
        expect.objectContaining({
          player_key: 'another-key',
          machine_id: 'localhost',
        }),
      );
    });
  });
});

// -----------------------------------------------------------------------
// Persistent-machine literal — single source of truth for the localhost
// filter shared between adapter and api/patches.ts wiring layer.
// -----------------------------------------------------------------------

describe('PERSISTENT_MACHINE_ID', () => {
  it('is "localhost" — mirrors PERSISTENT_MACHINE_KEYS in FileSystemContext', () => {
    expect(PERSISTENT_MACHINE_ID).toBe('localhost');
  });
});

// -----------------------------------------------------------------------
// clearTransientPatches — DELETE WHERE machine_id <> 'localhost'
// -----------------------------------------------------------------------

const clearParams: ClearPatchesParams = {
  player_key: 'pubkey-hex',
};

describe('createSupabaseClearTransientPatches', () => {
  it('returns ok: true with affected = data.length when delete succeeds', async () => {
    const clearTransient = vi.fn().mockResolvedValue({
      data: [{ path: '/etc/passwd' }, { path: '/srv/data' }, { path: '/var/log/auth.log' }],
      error: null,
    });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 3 });
  });

  it('returns ok: true with affected = 0 when no transient rows exist', async () => {
    const clearTransient = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: true with affected = 0 when data is null and no error (defensive)', async () => {
    const clearTransient = vi.fn().mockResolvedValue({ data: null, error: null });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const clearTransient = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'storage error' } });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    expect(await clear(clearParams)).toEqual({ ok: false });
  });

  it('passes the localhost literal as persistent_machine_id to clearTransient', async () => {
    const clearTransient = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    await clear(clearParams);

    expect(clearTransient).toHaveBeenCalledWith({
      player_key: 'pubkey-hex',
      persistent_machine_id: 'localhost',
    });
  });

  it('forwards a different player_key verbatim', async () => {
    const clearTransient = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearTransientPatches(clearTransient);

    await clear({ player_key: 'another-key' });

    expect(clearTransient).toHaveBeenCalledWith(
      expect.objectContaining({ player_key: 'another-key' }),
    );
  });
});

// -----------------------------------------------------------------------
// clearOwnedPatches — DELETE WHERE player_key=me AND machine_id='localhost'
// (the player's own-machine patches, not the shared world)
// -----------------------------------------------------------------------

describe('createSupabaseClearOwnedPatches', () => {
  it('returns ok: true with affected = data.length when delete succeeds', async () => {
    const clearOwned = vi.fn().mockResolvedValue({
      data: Array.from({ length: 7 }, (_, i) => ({ path: `/tmp/${i}` })),
      error: null,
    });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    expect(await clear(clearParams)).toEqual({ ok: true, affected: 7 });
  });

  it('returns ok: true with affected = 0 when player has no owned-machine patches', async () => {
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

  it('passes the localhost literal as persistent_machine_id (own-machine filter)', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    await clear(clearParams);

    expect(clearOwned).toHaveBeenCalledWith({
      player_key: 'pubkey-hex',
      persistent_machine_id: 'localhost',
    });
    // Pinned: cross-player patches on other machines must NOT be wiped
    // by reset — that's the whole point of scoping to owned machines.
    expect(clearOwned).toHaveBeenCalledTimes(1);
  });

  it('forwards a different player_key verbatim', async () => {
    const clearOwned = vi.fn().mockResolvedValue({ data: [], error: null });
    const clear = createSupabaseClearOwnedPatches(clearOwned);

    await clear({ player_key: 'another-key' });

    expect(clearOwned).toHaveBeenCalledWith(expect.objectContaining({ player_key: 'another-key' }));
  });
});
