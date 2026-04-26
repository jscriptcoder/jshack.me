import { describe, it, expect, vi } from 'vitest';
import { createSupabaseUpsertPatch } from './supabaseUpsert';
import type { PatchRow } from './types';

const row: PatchRow = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
  path: '/tmp/foo.txt',
  content: 'hello',
  owner: 'user',
};

const rowWithOptionals: PatchRow = {
  ...row,
  path: '/srv/data',
  content: null,
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
  is_new: true,
  node_type: 'directory',
};

describe('createSupabaseUpsertPatch', () => {
  it('returns ok: true when the upsert succeeds', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(row)).toEqual({ ok: true });
    expect(upsertRow).toHaveBeenCalledWith(row);
  });

  it('passes optional fields (permissions, is_new, node_type) through to upsertRow', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(rowWithOptionals)).toEqual({ ok: true });
    expect(upsertRow).toHaveBeenCalledWith(rowWithOptionals);
  });

  it('returns ok: false when supabase returns an error', async () => {
    const upsertRow = vi.fn().mockResolvedValue({
      error: { code: '42501', message: 'RLS violation' },
    });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(row)).toEqual({ ok: false });
  });

  it('returns ok: false on an unknown supabase error code (does not swallow)', async () => {
    // Defensive: any non-null error → ok: false. The handler maps that
    // to 500. We never partially-succeed.
    const upsertRow = vi.fn().mockResolvedValue({
      error: { code: 'XX001', message: 'connection lost' },
    });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(row)).toEqual({ ok: false });
  });
});
