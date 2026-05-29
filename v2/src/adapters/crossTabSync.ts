/**
 * crossTabSync — a thin `BroadcastChannel` wrapper for same-browser, cross-tab
 * patch synchronization.
 *
 * When the player writes in one tab, the other tabs of the SAME browser (same
 * identity, same workstation) need to see it without a reload. We broadcast a
 * lightweight hint after each successful write; the receiving tab re-pulls its
 * own patch journal so its next command reflects server truth. This mirrors the
 * (deferred) Realtime hint→refetch design, just over a same-browser transport —
 * when Realtime lands for the cross-player read path, both feed one refetch.
 *
 * Hint-only (no patch content on the wire): the receiver always refetches the
 * authoritative journal, so a stale or duplicate hint is harmless. The
 * BroadcastChannel spec does NOT echo a message to the posting context, so a
 * tab never receives — and never self-refetches on — its own writes.
 *
 * `BroadcastChannel` is injected so the absent-API path (SSR, old browsers) is
 * exercised in tests; production uses the real global when present.
 */

export type PatchesChangedMessage = {
  readonly type: 'patches-changed';
  /** The machine whose journal changed — receivers refetch only their own. */
  readonly machineId: string;
};

export type SyncChannel = {
  readonly broadcast: (message: PatchesChangedMessage) => void;
  readonly onMessage: (handler: (message: PatchesChangedMessage) => void) => void;
  readonly close: () => void;
};

const CHANNEL_NAME = 'jshack-sync';

const NOOP_CHANNEL: SyncChannel = {
  broadcast: () => undefined,
  onMessage: () => undefined,
  close: () => undefined,
};

export const createSyncChannel = (
  // `null` (not `undefined`) is the absent sentinel: passing `undefined`
  // explicitly would trigger this default, so tests couldn't reach the no-op
  // path. `null` survives default-param coalescing.
  Ctor: typeof BroadcastChannel | null = typeof BroadcastChannel === 'undefined'
    ? null
    : BroadcastChannel,
): SyncChannel => {
  if (Ctor === null) return NOOP_CHANNEL;
  const channel = new Ctor(CHANNEL_NAME);
  return {
    broadcast: (message) => channel.postMessage(message),
    onMessage: (handler) =>
      channel.addEventListener('message', (event: MessageEvent) =>
        handler(event.data as PatchesChangedMessage),
      ),
    close: () => channel.close(),
  };
};
