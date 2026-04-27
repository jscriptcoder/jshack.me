import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindActiveSession } from './supabaseFindActive';
import type { FindActiveSessionParams } from './supabaseFindActive';

const params: FindActiveSessionParams = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
};

describe('createSupabaseFindActiveSession', () => {
  it('returns ok: true with exists: true when query returns a row', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: '11111111-2222-4333-8444-555555555555' }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: true });
  });

  it('returns ok: true with exists: false when query returns an empty array', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: false });
  });

  it('returns ok: true with exists: false when data is null and no error (defensive)', async () => {
    // Guards against SDK shapes where data === null without an error.
    const query = vi.fn().mockResolvedValue({ data: null, error: null });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: false });
  });

  it('returns ok: false when supabase returns an error (DB outage / RLS / network)', async () => {
    // Distinct from "no session" — the lookup itself failed. Handler maps
    // this to 500 (server can't determine), not 403 (no session).
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'connection lost' } });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: false });
  });

  it('forwards player_key and machine_id verbatim to the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSession(query);

    await find({ player_key: 'another-key', machine_id: '192.168.50.10' });

    expect(query).toHaveBeenCalledWith({
      player_key: 'another-key',
      machine_id: '192.168.50.10',
    });
  });
});
