import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the realtime module so listTestNetworks can pick up our fake
// Supabase client when no explicit client is injected.
vi.mock('../patchRegistry/realtime', () => ({
  getRealtimeClient: vi.fn(),
}));

import { listTestNetworks } from './client';
import { getRealtimeClient as mockedGetRealtimeClient } from '../patchRegistry/realtime';
import type { TestNetwork } from './types';

const seedRows: TestNetwork[] = [
  {
    public_ip: '203.0.113.42',
    seed: 'test-basic',
    name: 'Basic Playground',
    description: 'Shared playground for cross-player visibility smoke tests.',
  },
];

// Build a minimal Supabase mock that matches the .from(...).select(...)
// chain we depend on. select() resolves to { data, error } per the
// supabase-js v2 contract.
type FromMock = ReturnType<typeof vi.fn>;
const makeSupabaseMock = (response: {
  data: TestNetwork[] | null;
  error: unknown;
}): {
  client: { from: FromMock };
  selectSpy: ReturnType<typeof vi.fn>;
} => {
  const selectSpy = vi.fn().mockResolvedValue(response);
  const from: FromMock = vi.fn().mockReturnValue({ select: selectSpy });
  return { client: { from }, selectSpy };
};

describe('listTestNetworks', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(mockedGetRealtimeClient).mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns the rows when select succeeds', async () => {
    const { client } = makeSupabaseMock({ data: seedRows, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listTestNetworks(client as any);

    expect(result).toEqual(seedRows);
  });

  it('queries the test_networks table with the expected field projection', async () => {
    const { client, selectSpy } = makeSupabaseMock({ data: [], error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listTestNetworks(client as any);

    expect(client.from).toHaveBeenCalledWith('test_networks');
    expect(selectSpy).toHaveBeenCalledWith('public_ip, seed, name, description');
  });

  it('returns [] when getRealtimeClient returns null (env vars missing)', async () => {
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);

    const result = await listTestNetworks();

    expect(result).toEqual([]);
  });

  it('returns [] and logs when supabase returns an error', async () => {
    const { client } = makeSupabaseMock({
      data: null,
      error: { code: 'XX001', message: 'query failed' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listTestNetworks(client as any);

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[testNetworks] list error:'),
      expect.anything(),
    );
  });

  it('returns [] when supabase data is null and no error (defensive)', async () => {
    const { client } = makeSupabaseMock({ data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listTestNetworks(client as any);

    expect(result).toEqual([]);
  });

  it('uses getRealtimeClient when no explicit client is supplied', async () => {
    const { client } = makeSupabaseMock({ data: seedRows, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(client as any);

    const result = await listTestNetworks();

    expect(result).toEqual(seedRows);
    expect(mockedGetRealtimeClient).toHaveBeenCalled();
  });
});
