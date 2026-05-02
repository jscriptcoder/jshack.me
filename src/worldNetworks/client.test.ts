import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the realtime module so listWorldNetworks can pick up our fake
// Supabase client when no explicit client is injected.
vi.mock('../patchRegistry/realtime', () => ({
  getRealtimeClient: vi.fn(),
}));

import { listWorldNetworks } from './client';
import { getRealtimeClient as mockedGetRealtimeClient } from '../patchRegistry/realtime';
import type { WorldNetwork } from './types';

const seedRows: WorldNetwork[] = [
  {
    public_ip: '203.0.113.42',
    seed: 'playground-basic',
    name: 'Playground',
    description: 'Shared playground for multiplayer smoke tests.',
    theme: 'playground',
    public_domain: null,
    search_metadata: null,
  },
];

type FromMock = ReturnType<typeof vi.fn>;
const makeSupabaseMock = (response: {
  data: WorldNetwork[] | null;
  error: unknown;
}): {
  client: { from: FromMock };
  selectSpy: ReturnType<typeof vi.fn>;
} => {
  const selectSpy = vi.fn().mockResolvedValue(response);
  const from: FromMock = vi.fn().mockReturnValue({ select: selectSpy });
  return { client: { from }, selectSpy };
};

describe('listWorldNetworks', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(mockedGetRealtimeClient).mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns the rows when select succeeds (including the theme field)', async () => {
    const { client } = makeSupabaseMock({ data: seedRows, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorldNetworks(client as any);

    expect(result).toEqual(seedRows);
    expect(result[0]?.theme).toBe('playground');
  });

  it('queries the world_networks table with the expected field projection (includes theme + public_domain + search_metadata)', async () => {
    const { client, selectSpy } = makeSupabaseMock({ data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listWorldNetworks(client as any);

    expect(client.from).toHaveBeenCalledWith('world_networks');
    expect(selectSpy).toHaveBeenCalledWith(
      'public_ip, seed, name, description, theme, public_domain, search_metadata',
    );
  });

  it('passes through rows whose search_metadata is populated', async () => {
    const indexedRow: WorldNetwork = {
      public_ip: '192.0.2.80',
      seed: 'findit-basic',
      name: 'findit.io',
      description: 'Search engine.',
      theme: 'search-engine',
      public_domain: 'findit.io',
      search_metadata: {
        title: 'findit.io',
        description: 'Search the web.',
        keywords: ['search', 'find', 'engine'],
      },
    };
    const { client } = makeSupabaseMock({ data: [indexedRow], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorldNetworks(client as any);

    expect(result).toEqual([indexedRow]);
    expect(result[0]?.search_metadata?.keywords).toContain('search');
  });

  it('drops rows whose search_metadata fails schema validation', async () => {
    const malformed = {
      public_ip: '203.0.113.44',
      seed: 'bad-seed',
      name: 'Bad',
      description: null,
      theme: 'search-engine',
      public_domain: null,
      // Missing required title/description/keywords
      search_metadata: { keywords: 'not an array' },
    };
    const { client } = makeSupabaseMock({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [malformed as any],
      error: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorldNetworks(client as any);

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[worldNetworks] dropping malformed row:'),
      expect.anything(),
    );
  });

  it('returns [] when getRealtimeClient returns null (env vars missing)', async () => {
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);

    const result = await listWorldNetworks();

    expect(result).toEqual([]);
  });

  it('returns [] and logs when supabase returns an error', async () => {
    const { client } = makeSupabaseMock({
      data: null,
      error: { code: 'XX001', message: 'query failed' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorldNetworks(client as any);

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[worldNetworks] list error:'),
      expect.anything(),
    );
  });

  it('returns [] when supabase data is null and no error (defensive)', async () => {
    const { client } = makeSupabaseMock({ data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listWorldNetworks(client as any);

    expect(result).toEqual([]);
  });

  it('uses getRealtimeClient when no explicit client is supplied', async () => {
    const { client } = makeSupabaseMock({ data: seedRows, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(client as any);

    const result = await listWorldNetworks();

    expect(result).toEqual(seedRows);
    expect(mockedGetRealtimeClient).toHaveBeenCalled();
  });
});
