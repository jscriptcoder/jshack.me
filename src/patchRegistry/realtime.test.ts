import { describe, it, expect, vi } from 'vitest';
import { subscribeToMachine } from './realtime';

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
  // Fluent chain: on() and subscribe() return the channel itself
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  const supabase: SupabaseMock = {
    channel: vi.fn().mockReturnValue(channel),
  };

  return { supabase, channel };
};

const ORIGINATOR_KEY = 'aa'.repeat(32);

describe('subscribeToMachine', () => {
  it('creates a channel named "patches:<machine_id>"', () => {
    const { supabase } = makeMocks();
    const onHint = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', onHint);

    expect(supabase.channel).toHaveBeenCalledWith('patches:10.0.0.1');
  });

  it('uses machine_id verbatim — "localhost" produces "patches:localhost"', () => {
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, 'localhost', vi.fn());

    expect(supabase.channel).toHaveBeenCalledWith('patches:localhost');
  });

  it('registers a broadcast listener for event "patch_change"', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', vi.fn());

    expect(channel.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'patch_change' },
      expect.any(Function),
    );
  });

  it('calls subscribe() to activate the channel', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', vi.fn());

    expect(channel.subscribe).toHaveBeenCalled();
  });

  it('invokes onHint with { machineId, originatorKey } when the broadcast fires', async () => {
    // Wire shape (snake_case from the server) → client shape (camelCase).
    // No content / path / owner — hint-only design. See
    // project_realtime_publish_authorization memory.
    const { supabase, channel } = makeMocks();
    const onHint = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', onHint);

    // Pull out the registered broadcast callback and trigger it
    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: { readonly machine_id: string; readonly originator_key: string };
    }) => void;
    broadcastCallback({
      payload: { machine_id: '10.0.0.1', originator_key: ORIGINATOR_KEY },
    });

    expect(onHint).toHaveBeenCalledWith({
      machineId: '10.0.0.1',
      originatorKey: ORIGINATOR_KEY,
    });
  });

  it('preserves machine_id and originator_key through the wire→client conversion', () => {
    // Mutation-kill: a mutant that swapped the two fields, dropped
    // either, or substituted a constant should fail this test.
    const { supabase, channel } = makeMocks();
    const onHint = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.5', onHint);

    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: { readonly machine_id: string; readonly originator_key: string };
    }) => void;
    broadcastCallback({
      payload: { machine_id: '10.0.0.5', originator_key: 'cc'.repeat(32) },
    });

    expect(onHint).toHaveBeenCalledWith({
      machineId: '10.0.0.5',
      originatorKey: 'cc'.repeat(32),
    });
  });

  it('returned function calls channel.unsubscribe() when invoked', () => {
    const { supabase, channel } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = subscribeToMachine(supabase as any, '10.0.0.1', vi.fn());

    expect(channel.unsubscribe).not.toHaveBeenCalled();

    unsubscribe();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe is idempotent — multiple calls work without throwing (caller defensive)', () => {
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = subscribeToMachine(supabase as any, '10.0.0.1', vi.fn());

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
