import type { FileSystemPatch } from '../filesystem/types';
import type { ThemeId } from '../theme/themes';
import type { WifiConnection } from '../network/wifiTypes';

type SyncMessage =
  | { readonly type: 'filesystem-patch'; readonly patch: FileSystemPatch }
  | { readonly type: 'wifi-changed'; readonly connection: WifiConnection | null }
  | { readonly type: 'mission-changed'; readonly seed: string | null }
  | { readonly type: 'theme-changed'; readonly theme: ThemeId }
  | { readonly type: 'bricked-changed'; readonly machine: string };

const CHANNEL_NAME = 'jshack-sync';

type SyncChannel = {
  readonly broadcast: (message: SyncMessage) => void;
  readonly onMessage: (handler: (message: SyncMessage) => void) => void;
  readonly close: () => void;
};

export type { SyncMessage };

// Creates a BroadcastChannel for cross-tab state synchronization.
// Returns a no-op fallback when BroadcastChannel is unavailable (e.g. SSR, old browsers).
export const createSyncChannel = (): SyncChannel => {
  if (typeof BroadcastChannel === 'undefined') {
    return {
      broadcast: () => {},
      onMessage: () => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);

  return {
    broadcast: (message: SyncMessage) => {
      try {
        channel.postMessage(message);
      } catch {
        // Channel already closed (e.g. broadcast during unmount) — safe to ignore,
        // the state change is persisted independently via IndexedDB/sessionStorage.
      }
    },
    onMessage: (handler: (message: SyncMessage) => void) => {
      channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        handler(event.data);
      };
    },
    close: () => {
      channel.close();
    },
  };
};
