import { describe, it, expect, vi } from 'vitest';
import { subscribeToNetworkOccupants } from './realtime';

// Mock supabase client shape we depend on. The real SupabaseClient
// has a much wider surface, but the helper only touches `.channel()`
// + the channel's `.on() / .subscribe() / .unsubscribe()` chain.
type ChannelMock = {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
};

type SupabaseMock = {
  channel: ReturnType<typeof vi.fn>;
};

const makeMocks = () => {
  const channel: ChannelMock = {
    on: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  const supabase: SupabaseMock = {
    channel: vi.fn().mockReturnValue(channel),
  };

  return { supabase, channel };
};

const ORIGINATOR_KEY = 'ed25519:' + 'aa'.repeat(32);

describe('subscribeToNetworkOccupants', () => {
  it('creates a channel named "occupants:<network_id>"', () => {
    const { supabase } = makeMocks();
    const onHint = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '203.0.113.42', onHint);

    expect(supabase.channel).toHaveBeenCalledWith('occupants:203.0.113.42');
  });

  it('uses network_id verbatim in the channel name', () => {
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '198.51.100.7', vi.fn());

    expect(supabase.channel).toHaveBeenCalledWith('occupants:198.51.100.7');
  });

  it('registers a broadcast listener for event "occupant_change"', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '203.0.113.42', vi.fn());

    expect(channel.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'occupant_change' },
      expect.any(Function),
    );
  });

  it('calls subscribe() to activate the channel', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '203.0.113.42', vi.fn());

    expect(channel.subscribe).toHaveBeenCalled();
  });

  it('invokes onHint with { networkId, originatorKey } when the broadcast fires', () => {
    // Wire shape (snake_case from the server) → client shape (camelCase).
    const { supabase, channel } = makeMocks();
    const onHint = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '203.0.113.42', onHint);

    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: { readonly network_id: string; readonly originator_key: string };
    }) => void;
    broadcastCallback({
      payload: { network_id: '203.0.113.42', originator_key: ORIGINATOR_KEY },
    });

    expect(onHint).toHaveBeenCalledWith({
      networkId: '203.0.113.42',
      originatorKey: ORIGINATOR_KEY,
    });
  });

  it('preserves both network_id and originator_key through the wire→client conversion', () => {
    // Mutation-kill: a mutant that swapped the two fields, dropped
    // either, or substituted a constant should fail this test.
    const { supabase, channel } = makeMocks();
    const onHint = vi.fn();
    const otherKey = 'ed25519:' + 'cc'.repeat(32);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToNetworkOccupants(supabase as any, '198.51.100.7', onHint);

    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: { readonly network_id: string; readonly originator_key: string };
    }) => void;
    broadcastCallback({
      payload: { network_id: '198.51.100.7', originator_key: otherKey },
    });

    expect(onHint).toHaveBeenCalledWith({
      networkId: '198.51.100.7',
      originatorKey: otherKey,
    });
  });

  it('returned function calls channel.unsubscribe() when invoked', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = subscribeToNetworkOccupants(supabase as any, '203.0.113.42', vi.fn());

    expect(channel.unsubscribe).not.toHaveBeenCalled();

    unsubscribe();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe is idempotent — multiple calls work without throwing', () => {
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = subscribeToNetworkOccupants(supabase as any, '203.0.113.42', vi.fn());

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
