import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
  // private: true routes the subscribe handshake through Supabase's
  // Realtime authorization path, which evaluates the RLS policies on
  // realtime.messages installed by 20260502100000_realtime_publish_authorization.
  // Without it the channel uses the legacy public path, where any anon
  // client can call channel.send() to forge patch_change events.
  const channel = supabase.channel(channelForMachine(machine_id), {
    config: { private: true },
  });
  channel.on('broadcast', { event: PATCH_CHANGE_EVENT }, (event: { payload: WirePatch }) => {
    onPatch(toFileSystemPatch(event.payload));
  });
  channel.subscribe();
  return () => {
    channel.unsubscribe();
  };
};

// Lazy singleton anon-key Supabase client for browser-side subscriptions.
// Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from the build-time
// env. Returns null if either is missing — caller (FileSystemContext)
// gracefully degrades to no live updates rather than crashing the app.
//
// Constructed lazily so unit tests that don't import this directly
// don't pay the cost or hit env-var assertion paths. The client uses
// the public anon key, NOT service_role — service_role lives only in
// Vercel functions (api/patches.ts) and never ships to the browser.
let cachedClient: SupabaseClient | null | undefined;
let warnedAboutMissingEnv = false;

export const getRealtimeClient = (): SupabaseClient | null => {
  if (cachedClient !== undefined) return cachedClient;

  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    if (!warnedAboutMissingEnv) {
      console.warn(
        '[realtime] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing — live cross-player updates disabled',
      );
      warnedAboutMissingEnv = true;
    }
    cachedClient = null;
    return null;
  }

  cachedClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
};
