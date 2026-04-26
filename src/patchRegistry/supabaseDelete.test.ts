import { describe, it, expect, vi } from 'vitest';
import { createSupabaseRemovePatch } from './supabaseDelete';
import type { RemovePatchParams } from './types';

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
