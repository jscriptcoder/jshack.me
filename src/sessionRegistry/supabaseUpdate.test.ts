import { describe, it, expect, vi } from 'vitest';
import { createSupabaseEndSession } from './supabaseUpdate';
import type { EndSessionParams } from './types';

const params: EndSessionParams = {
  session_id: '11111111-2222-4333-8444-555555555555',
  player_key: 'pubkey-hex',
  reason: 'user_exit',
};

describe('createSupabaseEndSession', () => {
  it('returns ok with affected = 1 when one row was updated', async () => {
    const endRow = vi.fn().mockResolvedValue({
      data: [{ session_id: params.session_id }],
      error: null,
    });
    const endSession = createSupabaseEndSession(endRow);

    expect(await endSession(params)).toEqual({ ok: true, affected: 1 });
    expect(endRow).toHaveBeenCalledWith(params);
  });

  it('returns ok with affected = 0 when no row matched the WHERE filter', async () => {
    // The UPDATE filters by session_id + player_key + ended_at IS NULL.
    // Empty data means: not found, not yours, or already ended.
    const endRow = vi.fn().mockResolvedValue({ data: [], error: null });
    const endSession = createSupabaseEndSession(endRow);

    expect(await endSession(params)).toEqual({ ok: true, affected: 0 });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'RLS violation' } });
    const endSession = createSupabaseEndSession(endRow);

    expect(await endSession(params)).toEqual({ ok: false });
  });

  it('returns ok with affected = 0 when data is null and no error (defensive)', async () => {
    const endRow = vi.fn().mockResolvedValue({ data: null, error: null });
    const endSession = createSupabaseEndSession(endRow);

    expect(await endSession(params)).toEqual({ ok: true, affected: 0 });
  });
});
