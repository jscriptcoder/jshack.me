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

    expect(await upsertPatch(row, true)).toEqual({ ok: true });
    expect(upsertRow).toHaveBeenCalledWith(row, true, false);
  });

  it('passes optional fields (permissions, is_new, node_type) through to upsertRow', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(rowWithOptionals, true)).toEqual({ ok: true });
    expect(upsertRow).toHaveBeenCalledWith(rowWithOptionals, true, false);
  });

  it('forwards dualWrite=false (own-workstation bypass) through to upsertRow', async () => {
    // Pinned: the handler computes own-workstation bypass and passes
    // dualWrite=false. The adapter must not silently flip it back to
    // true — that would project own-workstation patches into the shared
    // machine_filesystems table.
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    await upsertPatch(row, false);
    expect(upsertRow).toHaveBeenCalledWith(row, false, false);
  });

  it('passes projectFsContent=true for paths in the FS projection allowlist (/etc/passwd)', async () => {
    // The dual-write SQL function uses this flag to decide whether to
    // store content in machine_filesystems. /etc/passwd is the first
    // (and currently only) path in FS_PROJECTED_CONTENT_PATHS — server-
    // side userType validation in createSession reads it.
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);
    const passwdRow: PatchRow = { ...row, path: '/etc/passwd', content: 'root:x:0:0' };

    await upsertPatch(passwdRow, true);
    expect(upsertRow).toHaveBeenCalledWith(passwdRow, true, true);
  });

  it('passes projectFsContent=false for non-allowlisted paths', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ error: null });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);
    const arbitraryRow: PatchRow = { ...row, path: '/var/log/auth.log' };

    await upsertPatch(arbitraryRow, true);
    expect(upsertRow).toHaveBeenCalledWith(arbitraryRow, true, false);
  });

  it('returns ok: false when supabase returns an error', async () => {
    const upsertRow = vi.fn().mockResolvedValue({
      error: { code: '42501', message: 'RLS violation' },
    });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(row, true)).toEqual({ ok: false });
  });

  it('returns ok: false on an unknown supabase error code (does not swallow)', async () => {
    // Defensive: any non-null error → ok: false. The handler maps that
    // to 500. We never partially-succeed.
    const upsertRow = vi.fn().mockResolvedValue({
      error: { code: 'XX001', message: 'connection lost' },
    });
    const upsertPatch = createSupabaseUpsertPatch(upsertRow);

    expect(await upsertPatch(row, true)).toEqual({ ok: false });
  });
});
