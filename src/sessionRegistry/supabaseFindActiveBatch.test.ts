import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindActiveSessionsBatch } from './supabaseFindActiveBatch';
import type { FindActiveSessionsBatchParams } from './supabaseFindActiveBatch';

// Bulk variant of supabaseFindActiveSession — fetches the requester's
// credentials for every machine in the requested set in one SQL round-
// trip. The read-path filter (handleListPatchesForMachines) needs
// per-machine session decisions to dispatch tier 2 vs tier 3; calling
// the single-row adapter once per machine_id would be O(N) round-trips
// for a request that already costs one round-trip overall.
//
// Filter posture: only ended_at IS NULL rows (matches L1 semantics).

const validRow = (
  machine_id: string,
  credentials: { username: string; userType: 'root' | 'user' | 'guest' } = {
    username: 'alice',
    userType: 'user',
  },
) => ({
  machine_id,
  credentials,
});

describe('createSupabaseFindActiveSessionsBatch', () => {
  it('returns ok: true with credentials per machine for each row', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [
        validRow('10.0.0.1', { username: 'alice', userType: 'user' }),
        validRow('10.0.0.2', { username: 'guest1', userType: 'guest' }),
      ],
      error: null,
    });
    const find = createSupabaseFindActiveSessionsBatch(query);

    const result = await find({
      player_key: 'pk1',
      machine_ids: ['10.0.0.1', '10.0.0.2'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionsByMachine.get('10.0.0.1')).toEqual({
        username: 'alice',
        userType: 'user',
      });
      expect(result.sessionsByMachine.get('10.0.0.2')).toEqual({
        username: 'guest1',
        userType: 'guest',
      });
    }
  });

  it('returns an empty map when player has no sessions on any requested machine', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSessionsBatch(query);

    const result = await find({ player_key: 'pk1', machine_ids: ['10.0.0.1'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionsByMachine.size).toBe(0);
    }
  });

  it('short-circuits on empty machine_ids without invoking the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSessionsBatch(query);

    const result = await find({ player_key: 'pk1', machine_ids: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionsByMachine.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an empty map when data is null and no error (defensive)', async () => {
    const query = vi.fn().mockResolvedValue({ data: null, error: null });
    const find = createSupabaseFindActiveSessionsBatch(query);

    const result = await find({ player_key: 'pk1', machine_ids: ['10.0.0.1'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionsByMachine.size).toBe(0);
  });

  it('returns ok: false when supabase returns an error', async () => {
    const query = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX001', message: 'connection lost' },
    });
    const find = createSupabaseFindActiveSessionsBatch(query);

    expect(await find({ player_key: 'pk1', machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('forwards player_key and machine_ids verbatim to the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSessionsBatch(query);

    await find({ player_key: 'pubkey-aabbccdd', machine_ids: ['10.0.0.1', '203.0.113.42'] });

    expect(query).toHaveBeenCalledWith({
      player_key: 'pubkey-aabbccdd',
      machine_ids: ['10.0.0.1', '203.0.113.42'],
    });
  });

  it('returns ok: false when any row has malformed credentials JSONB', async () => {
    // Defensive against rogue inserts: a row with userType='admin' or
    // missing username poisons the batch so the handler short-circuits
    // to 500 rather than acting on partial data.
    const query = vi.fn().mockResolvedValue({
      data: [
        validRow('10.0.0.1'),
        { machine_id: '10.0.0.2', credentials: { username: 'rogue', userType: 'admin' } },
      ],
      error: null,
    });
    const find = createSupabaseFindActiveSessionsBatch(query);

    expect(await find({ player_key: 'pk1', machine_ids: ['10.0.0.1', '10.0.0.2'] })).toEqual({
      ok: false,
    });
  });

  it('returns ok: false when credentials carries unknown extra fields (strict parse)', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'alice', userType: 'user', extra: 'field' },
        },
      ],
      error: null,
    });
    const find = createSupabaseFindActiveSessionsBatch(query);

    expect(await find({ player_key: 'pk1', machine_ids: ['10.0.0.1'] })).toEqual({ ok: false });
  });

  it('handles stacked sessions on the same machine_id by keeping the FIRST row (most-recent under DESC SQL order)', async () => {
    // pushSession doesn't end the prior server session, so after `su` a
    // player has TWO active rows for (player, machine): the original
    // user-tier session and the new root-tier one. The wiring SQL orders
    // by created_at DESC, so the FIRST row is the newest — matching the
    // foreground UI session. The adapter takes first-write-wins to
    // preserve that selection.
    const query = vi.fn().mockResolvedValue({
      data: [
        // Newest first (SQL ORDER BY created_at DESC):
        validRow('10.0.0.1', { username: 'alice', userType: 'root' }),
        // Older rows for the same machine — must be ignored:
        validRow('10.0.0.1', { username: 'alice', userType: 'user' }),
        validRow('10.0.0.1', { username: 'guest1', userType: 'guest' }),
      ],
      error: null,
    });
    const find = createSupabaseFindActiveSessionsBatch(query);

    const result = await find({ player_key: 'pk1', machine_ids: ['10.0.0.1'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionsByMachine.get('10.0.0.1')).toEqual({
        username: 'alice',
        userType: 'root',
      });
    }
  });
});

const _typeCheck: FindActiveSessionsBatchParams = { player_key: 'x', machine_ids: ['y'] };
void _typeCheck;
