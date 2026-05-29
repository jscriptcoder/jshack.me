import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleUpsertPatch, type PatchRow } from '../src/core/patches/upsertPatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/patches.
//
// Slice scope: upsertPatch only. The pure handler (src/core/patches) verifies
// the envelope, enforces the own-workstation L1 bypass, and server-stamps
// player_key; this file is glue — Supabase client + nonce store + HTTP.
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands when
// cross-player flows need it). Acceptable for local dev — same posture as
// legacy when Upstash env vars are absent.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

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

  const upsertPatch = async (row: PatchRow) => {
    // .upsert resolves the (player_key, machine_id, path) PK conflict as an
    // update — write-overwrites-content semantics for `>`.
    const { error } = await supabase.from('patches').upsert(row);
    if (error) console.error('[patches] upsert error:', error);
    return { error };
  };

  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    upsertPatch,
  });
  res.status(status).json(body);
}
