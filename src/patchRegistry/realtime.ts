import type { SupabaseClient } from '@supabase/supabase-js';
import type { FileSystemPatch } from '../filesystem/types.js';
import { toFileSystemPatch, type WirePatch } from './client.js';

// Client-side subscription wrapper for the per-machine Realtime
// broadcast channel. Pairs with the server-side publishPatchChange
// helper (broadcast.ts): every successful upsertPatch / removePatch
// emits a `patch_change` event on `patches:<machine_id>`, and this
// wrapper converts the wire-shaped payload back to a FileSystemPatch
// before delivering it to the caller.
//
// Why a thin wrapper:
//   - portability: the rest of the app only needs to know
//     subscribe/unsubscribe semantics, not Supabase's channel API.
//     Swapping Realtime for Pusher / Ably / a custom WS later only
//     requires re-implementing this file.
//   - testability: callers inject a Supabase client; tests inject a
//     mock. No live WebSocket needed.
//
// The returned function MUST be called when the caller is done with
// this subscription (component unmount, view-keyset change). Without
// cleanup, channels leak across React Strict Mode's double-effect
// cycle and across mid-session home/mission transitions.

const channelForMachine = (machine_id: string): string => `patches:${machine_id}`;

const PATCH_CHANGE_EVENT = 'patch_change';

export const subscribeToMachine = (
  supabase: SupabaseClient,
  machine_id: string,
  onPatch: (patch: FileSystemPatch) => void,
): (() => void) => {
  const channel = supabase.channel(channelForMachine(machine_id));
  channel.on('broadcast', { event: PATCH_CHANGE_EVENT }, (event: { payload: WirePatch }) => {
    onPatch(toFileSystemPatch(event.payload));
  });
  channel.subscribe();
  return () => {
    channel.unsubscribe();
  };
};
