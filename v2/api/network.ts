import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  handleRegisterNetwork,
  type NetworkRegistryRow,
} from '../src/core/network/registerNetwork';
import {
  handleResolvePublicScan,
  type RegistryLookup,
} from '../src/core/scan/resolvePublicScan';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/network — the cross-player public-IP registry.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action`; each handler re-verifies the envelope itself, so routing on the raw
// action is safe:
//   - registerNetwork: upsert the caller's network on join (owner_key + public_ip
//     server-stamped; one row per public IP)
//   - resolvePublicScan: resolve a DIFFERENT identity's nmap of a public IP to the
//     registered machine (existence today; slice 1b adds open ports)
//
// Logic lives in typechecked core/ handlers; this file stays a thin Supabase
// adapter (api/* is not typechecked locally — project_v2_api_not_typechecked_locally).
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands with
// cross-player writes, Story 3). Same posture as /api/patches and /api/sessions.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

const actionOf = (body: unknown): string | undefined => {
  const payload = (body as { payload?: unknown } | null)?.payload;
  if (typeof payload !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as { action?: string }).action
      : undefined;
  } catch {
    return undefined;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (actionOf(req.body) === 'resolvePublicScan') {
    // Resolve the TARGET public IP (another identity's network) — no caller
    // scoping: any authenticated player may scan any public IP, like the internet.
    const findRegistryByPublicIp = async (publicIp: string) => {
      const { data, error } = await supabase
        .from('network_registry')
        .select('workstation_machine_id, owner_key')
        .eq('public_ip', publicIp)
        .maybeSingle();
      if (error) console.error('[network] registry lookup error:', error);
      return { data: data as RegistryLookup | null, error };
    };
    const { status, body } = await handleResolvePublicScan(req.body, {
      nonceStore: noopNonceStore,
      findRegistryByPublicIp,
    });
    res.status(status).json(body);
    return;
  }

  // .upsert resolves the public_ip PK conflict as an update — re-joining the same
  // AP refreshes the owner/workstation rather than erroring.
  const upsertRegistry = async (row: NetworkRegistryRow) => {
    const { error } = await supabase.from('network_registry').upsert(row);
    if (error) console.error('[network] registry upsert error:', error);
    return { error };
  };
  const { status, body } = await handleRegisterNetwork(req.body, {
    nonceStore: noopNonceStore,
    upsertRegistry,
  });
  res.status(status).json(body);
}
