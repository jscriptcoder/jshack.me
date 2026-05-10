import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindWorkstationsByName } from './supabaseFindWorkstationsByName';

// PR 6 of plans/cross-player-base-fs-replication.md — query workstations
// rows by workstation_name. The handler matches the suffix in TS; the
// adapter stays SQL-only so the test surface is small.
//
// Multiple rows can come back if two players chose the same name (rare
// but valid). The handler iterates and finds the one whose computed
// workstation_id matches the parsed suffix.

describe('createSupabaseFindWorkstationsByName', () => {
  it('returns ok:true with rows on a successful query', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: [
        {
          player_key: 'aabbccdd',
          workstation_name: 'omen',
          username: 'alice',
          seed: 'seed-1',
        },
      ],
      error: null,
    });
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'omen' });

    expect(queryFn).toHaveBeenCalledWith({ workstation_name: 'omen' });
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          player_key: 'aabbccdd',
          workstation_name: 'omen',
          username: 'alice',
          seed: 'seed-1',
        },
      ],
    });
  });

  it('returns ok:true with multiple rows when several players share a name', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: [
        { player_key: 'aaaa', workstation_name: 'omen', username: 'alice', seed: 's1' },
        { player_key: 'bbbb', workstation_name: 'omen', username: 'bob', seed: 's2' },
      ],
      error: null,
    });
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'omen' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('returns ok:true with empty rows when no match', async () => {
    const queryFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'ghost' });
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it('returns ok:true with empty rows when data is null', async () => {
    const queryFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'omen' });
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it('returns ok:false when the query throws an error', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'omen' });
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false when queryFn rejects', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('network'));
    const findFn = createSupabaseFindWorkstationsByName(queryFn);

    const result = await findFn({ workstation_name: 'omen' });
    expect(result).toEqual({ ok: false });
  });
});
