import { describe, it, expect, vi } from 'vitest';
import { createSupabaseListSessions } from './supabaseSelect';
import type { ListSessionsParams, SessionSummary } from './types';

const params: ListSessionsParams = { player_key: 'pubkey-hex' };

const sample: SessionSummary = {
  session_id: '11111111-2222-4333-8444-555555555555',
  machine_id: '10.0.0.1',
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: null,
  source_ip: null,
  created_at: '2026-04-26T10:00:00.000Z',
};

describe('createSupabaseListSessions', () => {
  it('returns ok with sessions array on success', async () => {
    const queryRows = vi.fn().mockResolvedValue({ data: [sample], error: null });
    const listSessions = createSupabaseListSessions(queryRows);

    expect(await listSessions(params)).toEqual({ ok: true, sessions: [sample] });
    expect(queryRows).toHaveBeenCalledWith(params);
  });

  it('returns ok with empty array when no rows match', async () => {
    const queryRows = vi.fn().mockResolvedValue({ data: [], error: null });
    const listSessions = createSupabaseListSessions(queryRows);

    expect(await listSessions(params)).toEqual({ ok: true, sessions: [] });
  });

  it('returns ok: false when supabase returns an error', async () => {
    const queryRows = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'RLS violation' } });
    const listSessions = createSupabaseListSessions(queryRows);

    expect(await listSessions(params)).toEqual({ ok: false });
  });

  it('returns ok with empty array when data is null and no error (defensive)', async () => {
    const queryRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const listSessions = createSupabaseListSessions(queryRows);

    expect(await listSessions(params)).toEqual({ ok: true, sessions: [] });
  });
});
