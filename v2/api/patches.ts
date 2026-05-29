import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleUpsertPatch, type PatchRow } from '../src/core/patches/upsertPatch';
import { handleListPatches, type ListPatchesQuery } from '../src/core/patches/listPatches';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/patches.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe:
//   - upsertPatch: own-workstation write (L1 bypass, server-stamped player_key)
//   - listPatches: own-workstation read of the patch journal (reload-durability)
//
// The cross-player three-tier read filter is a later plan; this read is
// own-only via the same suffix match as the write.
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands when
// cross-player flows need it). Acceptable for local dev — same posture as
// legacy when Upstash env vars are absent.
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

  if (actionOf(req.body) === 'listPatches') {
    const listPatches = async ({ player_key, machine_id }: ListPatchesQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('*')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id);
      if (error) console.error('[patches] list error:', error);
      return { data, error };
    };
    const { status, body } = await handleListPatches(req.body, {
      nonceStore: noopNonceStore,
      listPatches,
    });
    res.status(status).json(body);
    return;
  }

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
