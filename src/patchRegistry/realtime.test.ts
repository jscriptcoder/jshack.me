import { describe, it, expect, vi } from 'vitest';
import { subscribeToMachine } from './realtime';
import type { FileSystemPatch } from '../filesystem/types';

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

const wirePayload = {
  machine_id: '10.0.0.1',
  path: '/etc/hosts',
  content: 'shared world',
  owner: 'root' as const,
  permissions: null,
  is_new: false,
  node_type: 'file' as const,
};

describe('subscribeToMachine', () => {
  it('creates a channel named "patches:<machine_id>"', () => {
    const { supabase } = makeMocks();
    const onPatch = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', onPatch);

    expect(supabase.channel).toHaveBeenCalledWith(
      'patches:10.0.0.1',
      expect.objectContaining({ config: expect.objectContaining({ private: true }) }),
    );
  });

  it('uses machine_id verbatim — "localhost" produces "patches:localhost"', () => {
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, 'localhost', vi.fn());

    expect(supabase.channel).toHaveBeenCalledWith(
      'patches:localhost',
      expect.objectContaining({ config: expect.objectContaining({ private: true }) }),
    );
  });

  it('opts the channel into Realtime authorization (private: true) so RLS evaluates', () => {
    // The realtime.messages RLS policies installed by
    // 20260502100000_realtime_publish_authorization.sql only run when
    // the subscribe handshake is on the authorized path. private: true
    // is the client-side flag that selects that path. Without it, the
    // anon-key forgery vector remains open.
    const { supabase } = makeMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', vi.fn());

    expect(supabase.channel).toHaveBeenCalledTimes(1);
    const [, opts] = supabase.channel.mock.calls[0] as [string, { config: { private: boolean } }];
    expect(opts.config.private).toBe(true);
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

  it('invokes onPatch with the converted FileSystemPatch when the broadcast fires', () => {
    const { supabase, channel } = makeMocks();
    const onPatch = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', onPatch);

    // Pull out the registered broadcast callback and trigger it
    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: typeof wirePayload;
    }) => void;
    broadcastCallback({ payload: wirePayload });

    const expected: FileSystemPatch = {
      machineId: '10.0.0.1',
      path: '/etc/hosts',
      content: 'shared world',
      owner: 'root',
    };
    expect(onPatch).toHaveBeenCalledWith(expected);
  });

  it('preserves wire→client conversion (is_new=true → isNew=true; node_type="directory" → nodeType="directory")', () => {
    const { supabase, channel } = makeMocks();
    const onPatch = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribeToMachine(supabase as any, '10.0.0.1', onPatch);

    const broadcastCallback = channel.on.mock.calls[0][2] as (event: {
      readonly payload: Record<string, unknown>;
    }) => void;
    broadcastCallback({
      payload: {
        machine_id: '10.0.0.1',
        path: '/srv/data',
        content: null,
        owner: 'root',
        permissions: null,
        is_new: true,
        node_type: 'directory',
      },
    });

    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: '10.0.0.1',
        path: '/srv/data',
        content: null,
        owner: 'root',
        isNew: true,
        nodeType: 'directory',
      }),
    );
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
