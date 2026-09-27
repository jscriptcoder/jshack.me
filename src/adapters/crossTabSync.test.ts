import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncChannel, type PatchesChangedMessage } from './crossTabSync';

const HINT: PatchesChangedMessage = { type: 'patches-changed', machineId: 'box-1' };

/** A minimal BroadcastChannel double. Records what the wrapper posts/closes and
 *  lets a test drive an inbound `message` event — so we verify OUR forwarding,
 *  not the platform's cross-context delivery (untestable + not our behavior).
 *  Listeners are keyed by event type so a wrapper that registers the wrong type
 *  ('message' → anything else) is caught: only true 'message' delivery fires. */
class FakeBroadcastChannel {
  readonly posted: unknown[] = [];
  closed = false;
  private readonly byType = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly name: string) {}
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const existing = this.byType.get(type) ?? [];
    this.byType.set(type, [...existing, listener]);
  }
  close(): void {
    this.closed = true;
  }
  /** Test-only: simulate a 'message' arriving from another tab. */
  deliver(data: unknown): void {
    (this.byType.get('message') ?? []).forEach((listener) => listener({ data } as MessageEvent));
  }
}

/** Build a sync channel over a fresh injected fake, returning both so the test
 *  can drive inbound delivery and assert on what was posted/closed. */
const withFake = () => {
  const instances: FakeBroadcastChannel[] = [];
  class TrackingChannel extends FakeBroadcastChannel {
    constructor(name: string) {
      super(name);
      instances.push(this);
    }
  }
  // createSyncChannel constructs exactly one channel synchronously.
  const channel = createSyncChannel(TrackingChannel as unknown as typeof BroadcastChannel);
  return { channel, fake: instances[0]! };
};

describe('createSyncChannel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the shared jshack-sync channel', () => {
    const { fake } = withFake();
    expect(fake.name).toBe('jshack-sync');
  });

  it('forwards a broadcast to the channel as a postMessage', () => {
    const { channel, fake } = withFake();

    channel.broadcast(HINT);

    expect(fake.posted).toEqual([HINT]);
  });

  it('delivers an inbound message to the handler, unwrapping event.data', () => {
    const { channel, fake } = withFake();
    const received: PatchesChangedMessage[] = [];
    channel.onMessage((message) => received.push(message));

    fake.deliver(HINT);

    expect(received).toEqual([HINT]);
  });

  it('closes the underlying channel on close()', () => {
    const { channel, fake } = withFake();

    channel.close();

    expect(fake.closed).toBe(true);
  });

  it('returns a silent no-op channel when given no BroadcastChannel (null)', () => {
    const channel = createSyncChannel(null);
    const received: PatchesChangedMessage[] = [];

    // No underlying channel exists, so these must be inert rather than throw.
    expect(() => channel.onMessage((message) => received.push(message))).not.toThrow();
    expect(() => channel.broadcast(HINT)).not.toThrow();
    expect(() => channel.close()).not.toThrow();
    expect(received).toEqual([]);
  });

  it('uses the global BroadcastChannel by default when one is present', () => {
    const instances: FakeBroadcastChannel[] = [];
    class GlobalFake extends FakeBroadcastChannel {
      constructor(name: string) {
        super(name);
        instances.push(this);
      }
    }
    vi.stubGlobal('BroadcastChannel', GlobalFake);

    const channel = createSyncChannel(); // no arg → reads the global
    channel.broadcast(HINT);

    expect(instances).toHaveLength(1);
    expect(instances[0]!.name).toBe('jshack-sync');
    expect(instances[0]!.posted).toEqual([HINT]);
  });

  it('falls back to a no-op when the global BroadcastChannel is absent', () => {
    vi.stubGlobal('BroadcastChannel', undefined);

    const channel = createSyncChannel(); // no arg → detects absence, no-op

    expect(() => channel.broadcast(HINT)).not.toThrow();
    expect(() => channel.close()).not.toThrow();
  });
});
