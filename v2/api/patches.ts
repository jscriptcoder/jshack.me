import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleUpsertPatch, type PatchRow } from '../src/core/patches/upsertPatch';
import { handleListPatches, type ListPatchesQuery } from '../src/core/patches/listPatches';
import { handleRemovePatch, type PatchTreeQuery } from '../src/core/patches/removePatch';
import {
  handleAppendAuthLog,
  type AuthLogContentQuery,
} from '../src/core/patches/appendAuthLog';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from '../src/core/patches/authorizeMachineAccess';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';
import type { UserType } from '../src/core/types';

// Vercel adapter for POST /api/patches.
//
// Three signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe. All three share the L1 gate (`authorizeMachineAccess` via
// `findActiveSession`): the caller's OWN workstation (suffix match) OR an active
// ssh session on the target machine; else 403 no_session.
//   - upsertPatch: L1-gated write (server-stamped player_key)
//   - listPatches: L1-gated read of the patch journal (reload-durability, and
//     the read-back of a remote ssh write)
//   - removePatch: L1-gated delete — drops an is_new row + descendants, or
//     tombstones a base node (server decides from the table)
//
// L2 (tier-based perms on a remote write) and the cross-player three-tier read
// filter are later plans; today an authenticated remote session may write/read
// at any tier.
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

  // L1 lookup shared by upsert/list/remove: the caller's ACTIVE session on the
  // target machine (an ssh hop). The handler only needs its presence today; the
  // projected `userType`/`essid` are what the remote-write L2 pass reads next.
  // `.limit(1)` guards `maybeSingle` against a host the player re-ssh'd into.
  const findActiveSession = async ({
    player_key,
    machine_id,
  }: ActiveSessionQuery): Promise<FindActiveSessionResult> => {
    const { data, error } = await supabase
      .from('sessions')
      .select('credentials, essid')
      .eq('player_key', player_key)
      .eq('machine_id', machine_id)
      .is('ended_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) console.error('[patches] active-session lookup error:', error);
    if (data === null) return { data: null, error };
    const row = data as { credentials: { userType: UserType }; essid: string };
    return { data: { userType: row.credentials.userType, essid: row.essid }, error };
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
      findActiveSession,
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
      findActiveSession,
      findPatch,
      deletePatchTree,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'appendAuthLog') {
    // The server reads the current auth.log content (own-workstation, scoped to
    // the verified player_key) so the append is a read-modify-write the SERVER
    // performs — the client never supplies content or time.
    const readAuthLog = async ({ player_key, machine_id, path }: AuthLogContentQuery) => {
      const { data, error } = await supabase
        .from('patches')
        .select('content')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
        .eq('path', path)
        .maybeSingle();
      if (error) console.error('[patches] auth-log read error:', error);
      return { data, error };
    };
    const { status, body } = await handleAppendAuthLog(req.body, {
      nonceStore: noopNonceStore,
      now: () => Date.now(),
      readAuthLog,
      upsertPatch,
    });
    res.status(status).json(body);
    return;
  }

  const { status, body } = await handleUpsertPatch(req.body, {
    nonceStore: noopNonceStore,
    findActiveSession,
    upsertPatch,
  });
  res.status(status).json(body);
}
