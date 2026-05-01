import type { SupabaseClient } from '@supabase/supabase-js';
import { getRealtimeClient } from '../patchRegistry/realtime.js';
import { occupantSummarySchema, type OccupantSummary } from './types.js';

// Direct anon-key read of home_network_occupants for a given network_id.
// Same pattern as listWorldNetworks: occupant rows are public-readable
// (RLS allows anon SELECT in the migration) since their visibility on the
// LAN is the whole point — other players need to discover you to leave
// trails / attribute attacks.
//
// Failures degrade gracefully: env vars missing → empty, DB error →
// empty (logged). HomeNetworksProvider polls this periodically; transient
// failures are recoverable on the next tick.

const PROJECTION = 'network_id, player_key, lan_ip, hostname';

export const listOccupants = async (
  networkId: string,
  supabaseClient?: SupabaseClient,
): Promise<ReadonlyArray<OccupantSummary>> => {
  const supabase = supabaseClient ?? getRealtimeClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('home_network_occupants')
    .select(PROJECTION)
    .eq('network_id', networkId);
  if (error) {
    console.error('[homeNetworks] listOccupants error:', error);
    return [];
  }
  return (data ?? []).flatMap((row): readonly OccupantSummary[] => {
    const parsed = occupantSummarySchema.safeParse(row);
    if (parsed.success) return [parsed.data];
    console.error('[homeNetworks] dropping malformed occupant row:', parsed.error.issues);
    return [];
  });
};
