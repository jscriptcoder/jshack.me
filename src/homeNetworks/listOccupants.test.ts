import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listOccupants } from './listOccupants';

type SelectResult = {
  readonly data: ReadonlyArray<Record<string, unknown>> | null;
  readonly error: { readonly message: string } | null;
};

const fakeSupabase = (
  result: SelectResult,
  spy?: (params: { networkId: string }) => void,
): SupabaseClient => {
  const eq = vi.fn((column: string, value: string) => {
    if (column === 'network_id') spy?.({ networkId: value });
    return Promise.resolve(result);
  });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
};

describe('listOccupants', () => {
  it('returns parsed occupant rows for the requested network_id', async () => {
    // No player_key — the projection deliberately omits it (see
    // occupantSummarySchema). Schema is .strict() so a stray player_key
    // would fail validation here.
    const supabase = fakeSupabase({
      data: [
        {
          network_id: '203.0.113.42',
          lan_ip: '.187',
          hostname: 'skylab-9k3',
        },
        {
          network_id: '203.0.113.42',
          lan_ip: '.43',
          hostname: 'rocket-7c',
        },
      ],
      error: null,
    });

    const result = await listOccupants('203.0.113.42', supabase);

    expect(result).toHaveLength(2);
    expect(result[0]?.lan_ip).toBe('.187');
    expect(result[1]?.hostname).toBe('rocket-7c');
  });

  it('queries on network_id (passes the requested network through)', async () => {
    const seen: { networkId?: string } = {};
    const supabase = fakeSupabase({ data: [], error: null }, ({ networkId }) => {
      seen.networkId = networkId;
    });

    await listOccupants('203.0.113.50', supabase);

    expect(seen.networkId).toBe('203.0.113.50');
  });

  it('returns an empty list on database error (graceful degradation)', async () => {
    const supabase = fakeSupabase({ data: null, error: { message: 'connection refused' } });
    expect(await listOccupants('203.0.113.42', supabase)).toEqual([]);
  });

  it('drops rows that fail schema validation, keeping the rest', async () => {
    const supabase = fakeSupabase({
      data: [
        {
          network_id: '203.0.113.42',
          lan_ip: '.187',
          hostname: 'skylab-9k3',
        },
        // Invalid: missing hostname
        {
          network_id: '203.0.113.42',
          lan_ip: '.43',
        },
      ],
      error: null,
    });

    const result = await listOccupants('203.0.113.42', supabase);
    expect(result).toHaveLength(1);
    expect(result[0]?.hostname).toBe('skylab-9k3');
  });

  it('returns empty list when no supabase client is provided (env-vars missing)', async () => {
    expect(await listOccupants('203.0.113.42')).toEqual([]);
  });
});
