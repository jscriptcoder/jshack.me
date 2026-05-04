import { describe, it, expect, vi } from 'vitest';
import { createSupabaseUpsertWorkstation } from './supabaseUpsert';
import type { WorkstationRow } from './types';

const baseRow: WorkstationRow = {
  player_key: 'pubkey-A',
  workstation_name: 'skylab',
  username: 'alice',
};

describe('createSupabaseUpsertWorkstation', () => {
  it('reports inserted: true when the upsert returned the new row', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ data: [baseRow], error: null });
    const selectExisting = vi.fn();
    const upsert = createSupabaseUpsertWorkstation(upsertRow, selectExisting);

    const result = await upsert(baseRow);

    expect(result).toEqual({ ok: true, inserted: true });
    expect(selectExisting).not.toHaveBeenCalled();
  });

  it('reads back the existing row when the upsert conflict-dropped', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ data: [], error: null });
    const existingRow: WorkstationRow = {
      player_key: 'pubkey-A',
      workstation_name: 'OLDER-BOX',
      username: 'older-user',
    };
    const selectExisting = vi.fn().mockResolvedValue({ data: existingRow, error: null });
    const upsert = createSupabaseUpsertWorkstation(upsertRow, selectExisting);

    const result = await upsert(baseRow);

    expect(result).toEqual({
      ok: true,
      inserted: false,
      existing: {
        workstation_name: 'OLDER-BOX',
        username: 'older-user',
      },
    });
    expect(selectExisting).toHaveBeenCalledWith('pubkey-A');
  });

  it('reports ok: false when the upsert returns a DB error', async () => {
    const upsertRow = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'X', message: 'boom' } });
    const selectExisting = vi.fn();
    const upsert = createSupabaseUpsertWorkstation(upsertRow, selectExisting);

    const result = await upsert(baseRow);

    expect(result).toEqual({ ok: false });
    expect(selectExisting).not.toHaveBeenCalled();
  });

  it('reports ok: false when the conflict read-back fails (race or DB error)', async () => {
    const upsertRow = vi.fn().mockResolvedValue({ data: [], error: null });
    const selectExisting = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = createSupabaseUpsertWorkstation(upsertRow, selectExisting);

    const result = await upsert(baseRow);

    expect(result).toEqual({ ok: false });
  });
});
