import type { SupabaseClient } from '@supabase/supabase-js';

// Client-side subscription wrapper for the per-network occupants
// broadcast channel. Pairs with the server-side publishOccupantChange
// helper (broadcast.ts): every successful occupant INSERT emits an
// `occupant_change` HINT event on `occupants:<network_id>`, and this
// wrapper converts the wire-shaped payload (snake_case) to the
// client-shaped hint (camelCase) before delivering it to the caller.
//
// Mirrors patchRegistry/realtime.ts. The hint architecture defangs
// broadcast forgery — there's no row content in the payload, just
// "something changed on this LAN" + "who triggered it." Receivers
// refetch authoritative state via listOccupants. See
// project_realtime_publish_authorization memory.
//
// The returned function MUST be called when the caller is done with
// this subscription (LAN reconnect, component unmount). Without
// cleanup, channels leak across React Strict Mode's double-effect
// cycle and across reconnects.

const channelForNetwork = (network_id: string): string => `occupants:${network_id}`;

const OCCUPANT_CHANGE_EVENT = 'occupant_change';

// Wire shape received from the server's publishOccupantChange. Kept
// local so the realtime module owns its own protocol-translation layer
// (mirrors WirePatchHint in patchRegistry/realtime.ts).
type WireOccupantHint = {
  readonly network_id: string;
  readonly originator_key: string;
};

// Client-side hint shape — camelCase, what callers consume.
export type OccupantHint = {
  readonly networkId: string;
  readonly originatorKey: string;
};

const toOccupantHint = (wire: WireOccupantHint): OccupantHint => ({
  networkId: wire.network_id,
  originatorKey: wire.originator_key,
});

export const subscribeToNetworkOccupants = (
  supabase: SupabaseClient,
  network_id: string,
  onHint: (hint: OccupantHint) => void,
): (() => void) => {
  const channel = supabase.channel(channelForNetwork(network_id));
  channel.on(
    'broadcast',
    { event: OCCUPANT_CHANGE_EVENT },
    (event: { payload: WireOccupantHint }) => {
      onHint(toOccupantHint(event.payload));
    },
  );
  channel.subscribe();
  return () => {
    channel.unsubscribe();
  };
};
