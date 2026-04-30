import type { SupabaseClient } from '@supabase/supabase-js';
import { getRealtimeClient } from '../patchRegistry/realtime.js';
import type { TestNetwork } from './types.js';

// Direct anon-key read of the dev-only test_networks table. Bypasses
// the usual Vercel-function pattern because:
//   - test_networks data is intentionally public (RLS allows anon
//     SELECT in the migration). No auth, no validation, nothing
//     server-computed — going through a function would be theatre.
//   - The whole module is dev-only and removed at game release.
//     Skipping the function reduces the deletion surface.
//
// Failures degrade gracefully: env-vars missing → empty list, DB
// error → empty list (logged). The app continues normally without
// test networks if the table or client is unavailable.
//
// supabaseClient is injectable for tests; production callers omit it
// and pick up the singleton via getRealtimeClient().

const PROJECTION = 'public_ip, seed, name, description';

export const listTestNetworks = async (
  supabaseClient?: SupabaseClient,
): Promise<ReadonlyArray<TestNetwork>> => {
  const supabase = supabaseClient ?? getRealtimeClient();
  if (!supabase) return [];

  const { data, error } = await supabase.from('test_networks').select(PROJECTION);
  if (error) {
    console.error('[testNetworks] list error:', error);
    return [];
  }
  return (data ?? []) as ReadonlyArray<TestNetwork>;
};
