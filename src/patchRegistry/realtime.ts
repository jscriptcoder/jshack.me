import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client-side subscription wrapper for the per-machine Realtime
// broadcast channel. Pairs with the server-side publishPatchChange
// helper (broadcast.ts): every successful upsertPatch / removePatch
// emits a `patch_change` HINT event on `patches:<machine_id>`, and
// this wrapper converts the wire-shaped payload (snake_case) to the
// client-shaped hint (camelCase) before delivering it to the caller.
//
// Hint design: the broadcast carries only `{ machineId, originatorKey }`
// — no content, no path, no owner. Receivers refetch authoritative
// state via listPatchesForMachines. This closes the broadcast forgery
// vector accepted by PR #81 architecturally — there's nothing forge-
// able to inject; a forged hint just causes a no-op refetch that
// returns server truth. See project_realtime_publish_authorization
// memory for the full threat model.
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

// Wire shape received from the server's publishPatchChange. Kept local
// so the realtime module owns its own protocol-translation layer
// (mirrors the WirePatch pattern in client.ts).
type WirePatchHint = {
  readonly machine_id: string;
  readonly originator_key: string;
};

// Client-side hint shape — camelCase, what callers consume.
export type PatchHint = {
  readonly machineId: string;
  readonly originatorKey: string;
};

const toPatchHint = (wire: WirePatchHint): PatchHint => ({
  machineId: wire.machine_id,
  originatorKey: wire.originator_key,
});

export const subscribeToMachine = (
  supabase: SupabaseClient,
  machine_id: string,
  onHint: (hint: PatchHint) => void,
): (() => void) => {
  const channel = supabase.channel(channelForMachine(machine_id));
  channel.on('broadcast', { event: PATCH_CHANGE_EVENT }, (event: { payload: WirePatchHint }) => {
    onHint(toPatchHint(event.payload));
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
