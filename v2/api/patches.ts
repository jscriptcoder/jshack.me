import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleUpsertPatch, type PatchRow } from '../src/core/patches/upsertPatch';
import { handleListPatches, type ListPatchesQuery } from '../src/core/patches/listPatches';
import { handleRemovePatch, type PatchTreeQuery } from '../src/core/patches/removePatch';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/patches.
//
// Three signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe:
//   - upsertPatch: own-workstation write (L1 bypass, server-stamped player_key)
//   - listPatches: own-workstation read of the patch journal (reload-durability)
//   - removePatch: own-workstation delete — drops an is_new row + descendants,
//     or tombstones a base node (server decides from the table)
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

  const upsertPatch = async (row: PatchRow) => {
    // .upsert resolves the (player_key, machine_id, path) PK conflict as an
    // update — write-overwrites-content semantics for `>`. Columns omitted from
    // the row (e.g. is_new on an overwrite) are NOT in the ON CONFLICT SET, so
    // the stored value is preserved.
    const { error } = await supabase.from('patches').upsert(row);
    if (error) console.error('[patches] upsert error:', error);
    return { error };
  };

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

  if (actionOf(req.body) === 'removePatch') {
    const findPatch = async ({ player_key, machine_id, path }: PatchTreeQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('is_new')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[patches] find error:', error);
      return { data, error };
    };
    // Two scoped deletes (the row, then its descendants) rather than a single
    // `.or(...)` — a PostgREST `.or` filter would mis-parse a path containing a
    // comma, and the LIKE wildcard differs between the two filter dialects.
    const deletePatchTree = async ({ player_key, machine_id, path }: PatchTreeQuery) => {
      const base = () =>
        supabase.from('patches').delete().eq('player_key', player_key).eq('machine_id', machine_id);
      const exact = await base().eq('path', path);
      if (exact.error) {
        console.error('[patches] delete error:', exact.error);
        return { error: exact.error };
      }
      const descendants = await base().like('path', `${path}/%`);
      if (descendants.error)
        console.error('[patches] delete (descendants) error:', descendants.error);
      return { error: descendants.error };
    };
    const { status, body } = await handleRemovePatch(req.body, {
      nonceStore: noopNonceStore,
      findPatch,
      deletePatchTree,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    upsertPatch,
  });
  res.status(status).json(body);
}
