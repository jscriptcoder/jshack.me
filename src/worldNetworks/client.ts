import type { SupabaseClient } from '@supabase/supabase-js';
import { getRealtimeClient } from '../patchRegistry/realtime.js';
import { WorldNetworkSchema, type WorldNetwork } from './types.js';

// Direct anon-key read of the world_networks table. Bypasses the
// usual Vercel-function pattern because:
//   - world_networks data is intentionally public (RLS allows anon
//     SELECT in the migration). World content is meant to be
//     surfaced to every player; going through service_role would be
//     theatre.
//   - The data is small + read-once-at-boot, no rate-limiting need.
//
// Failures degrade gracefully: env-vars missing → empty list, DB
// error → empty list (logged). The app continues normally without
// world networks if the table or client is unavailable.
//
// supabaseClient is injectable for tests; production callers omit it
// and pick up the singleton via getRealtimeClient().

const PROJECTION = 'public_ip, seed, name, description, theme, public_domain, search_metadata';

export const listWorldNetworks = async (
  supabaseClient?: SupabaseClient,
): Promise<ReadonlyArray<WorldNetwork>> => {
  const supabase = supabaseClient ?? getRealtimeClient();
  if (!supabase) return [];

  const { data, error } = await supabase.from('world_networks').select(PROJECTION);
  if (error) {
    console.error('[worldNetworks] list error:', error);
    return [];
  }
  return (data ?? []).flatMap((row): readonly WorldNetwork[] => {
    const parsed = WorldNetworkSchema.safeParse(row);
    if (parsed.success) return [parsed.data];
    console.error('[worldNetworks] dropping malformed row:', parsed.error.issues);
    return [];
  });
};
