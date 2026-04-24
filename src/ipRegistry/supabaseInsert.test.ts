import { describe, it, expect, vi } from 'vitest';
import { createSupabaseInsertIp } from './supabaseInsert';
import type { IpRow } from './types';

const row: IpRow = { ip: '51.1.2.3', kind: 'mission_instance' };

describe('createSupabaseInsertIp', () => {
  it("returns 'ok' when the insert succeeds", async () => {
    const insertRow = vi.fn().mockResolvedValue({ error: null });
    const insertIp = createSupabaseInsertIp(insertRow);

    expect(await insertIp(row)).toBe('ok');
    expect(insertRow).toHaveBeenCalledWith(row);
  });

  it("returns 'conflict' when Postgres unique violation (23505) is returned", async () => {
    const insertRow = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const insertIp = createSupabaseInsertIp(insertRow);

    expect(await insertIp(row)).toBe('conflict');
  });

  it("returns 'error' for any other Postgres error code", async () => {
    const insertRow = vi
      .fn()
      .mockResolvedValue({ error: { code: '23514', message: 'check constraint violated' } });
    const insertIp = createSupabaseInsertIp(insertRow);

    expect(await insertIp(row)).toBe('error');
  });

  it("returns 'error' when the error has no code field", async () => {
    const insertRow = vi.fn().mockResolvedValue({ error: { message: 'network error' } });
    const insertIp = createSupabaseInsertIp(insertRow);

    expect(await insertIp(row)).toBe('error');
  });
});
