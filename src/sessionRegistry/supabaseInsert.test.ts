import { describe, it, expect, vi } from 'vitest';
import { createSupabaseInsertSession } from './supabaseInsert';
import type { SessionRow } from './types';

const row: SessionRow = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
  credentials: { username: 'root', userType: 'root' },
};

describe('createSupabaseInsertSession', () => {
  it('returns ok with session_id when the insert succeeds', async () => {
    const insertRow = vi.fn().mockResolvedValue({
      data: { session_id: '11111111-2222-3333-4444-555555555555' },
      error: null,
    });
    const insertSession = createSupabaseInsertSession(insertRow);

    const result = await insertSession(row);
    expect(result).toEqual({ ok: true, session_id: '11111111-2222-3333-4444-555555555555' });
    expect(insertRow).toHaveBeenCalledWith(row);
  });

  it('returns ok: false when supabase returns an error', async () => {
    const insertRow = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'RLS violation' } });
    const insertSession = createSupabaseInsertSession(insertRow);

    expect(await insertSession(row)).toEqual({ ok: false });
  });

  it('returns ok: false when supabase returns no data and no error (defensive)', async () => {
    // Guards against edge cases where the SDK shape diverges from expectations
    // (e.g., a network error that surfaces as data === null without an error).
    const insertRow = vi.fn().mockResolvedValue({ data: null, error: null });
    const insertSession = createSupabaseInsertSession(insertRow);

    expect(await insertSession(row)).toEqual({ ok: false });
  });
});
