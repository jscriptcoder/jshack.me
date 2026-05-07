import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { handlePatchesRequest } from '../src/patchRegistry/handler.js';
import { createSupabaseUpsertPatch } from '../src/patchRegistry/supabaseUpsert.js';
import {
  createSupabaseRemovePatch,
  createSupabaseClearOwnedPatches,
} from '../src/patchRegistry/supabaseDelete.js';
import { createSupabaseListPatchesForMachines } from '../src/patchRegistry/supabaseSelectByMachine.js';
import { publishPatchChange as publishPatchChangeHelper } from '../src/patchRegistry/broadcast.js';
import type { BroadcastFn } from '../src/patchRegistry/broadcast.js';
import type { ClearOwnedArg, DeletePatchesArg } from '../src/patchRegistry/supabaseDelete.js';
import type { PatchRow, ListPatchesForMachinesParams } from '../src/patchRegistry/types.js';
import { createSupabaseFindActiveSession } from '../src/sessionRegistry/supabaseFindActive.js';
import type { FindActiveSessionParams } from '../src/sessionRegistry/supabaseFindActive.js';
import { createSupabaseFindMachineFs } from '../src/patchRegistry/supabaseFindMachineFs.js';
import type { FindMachineFsParams } from '../src/patchRegistry/supabaseFindMachineFs.js';
import { createSupabaseFindMachineFsBatch } from '../src/patchRegistry/supabaseFindMachineFsBatch.js';
import type { FindMachineFsBatchParams } from '../src/patchRegistry/supabaseFindMachineFsBatch.js';
import { createSupabaseFindActiveSessionsBatch } from '../src/sessionRegistry/supabaseFindActiveBatch.js';
import type { FindActiveSessionsBatchParams } from '../src/sessionRegistry/supabaseFindActiveBatch.js';
import {
  createUpstashRateLimiter,
  noopRateLimiter,
  type RateLimiter,
} from '../src/ipRegistry/rateLimit.js';
import {
  createUpstashNonceStore,
  noopNonceStore,
  type NonceStore,
} from '../src/signedRequest/nonceStore.js';

// Vercel adapter for POST /api/patches.
//
// Single endpoint, action-dispatched by the signed payload's `action`
// field — upsertPatch / removePatch / listPatchesForMachines /
// clearOwnedPatches. Same Supabase + Upstash wiring pattern as
// /api/sessions and /api/allocate-ip.

// Per-pubkey rate limit. Filesystem patches fire once per nano save,
// once per cp/mv/rm, etc., and a busy editing session can write
// dozens per minute. 120/min gives plenty of headroom for active
// editing while still capping a runaway script. Separate `prefix`
// keeps the budget distinct from sessions and allocate-ip.
const RATE_LIMIT_PER_MINUTE = 120;

const buildUpstashAdapters = (): { rateLimiter: RateLimiter; nonceStore: NonceStore } => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn('[patches] Upstash not configured — rate limit + replay protection disabled');
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'patches',
  });
  const rateLimiter = createUpstashRateLimiter((id) => ratelimit.limit(id));
  const nonceStore = createUpstashNonceStore((key, value, opts) =>
    redis.set(key, value, { ex: opts.ex, nx: opts.nx }),
  );
  return { rateLimiter, nonceStore };
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

  const upsertPatch = createSupabaseUpsertPatch(
    async (row: PatchRow, dualWrite: boolean, projectFsContent: boolean) => {
      // L2 dual-write: a single RPC call writes to `patches` and (if
      // dualWrite) projects onto `machine_filesystems` in the same
      // transaction. projectFsContent gates the new content column —
      // true only for paths in FS_PROJECTED_CONTENT_PATHS, computed by
      // the adapter from row.path. Function signature lives in
      // 20260507100000_machine_fs_selective_content.sql.
      const { error } = await supabase.rpc('upsert_patch_with_fs', {
        p_player_key: row.player_key,
        p_machine_id: row.machine_id,
        p_path: row.path,
        p_content: row.content,
        p_owner: row.owner,
        p_permissions: row.permissions ?? null,
        p_is_new: row.is_new ?? null,
        p_node_type: row.node_type ?? null,
        p_dual_write: dualWrite,
        p_project_fs_content: projectFsContent,
      });
      if (error) console.error('[patches] rpc upsert_patch_with_fs error:', error);
      return { error };
    },
  );

  const removePatch = createSupabaseRemovePatch(async (arg: DeletePatchesArg) => {
    // L2 dual-delete: a single RPC call deletes from `patches` (exact
    // path + descendant prefix) and (if dual_write) cascades the same
    // delete to `machine_filesystems`. Function returns the deleted
    // patches paths so the adapter can compute `affected`.
    //
    // .like 'prefix%' caveat (now inside SQL): '_' is a single-char
    // wildcard, so a prefix containing '_' could match sibling paths
    // (e.g. '/etc/my_dir/' would also match '/etc/myXdir/foo').
    // Accepted for v1; future PR can switch to a range condition
    // (>= prefix AND < successor) once we hit a real conflict.
    const { data, error } = await supabase.rpc('remove_patches_with_fs', {
      p_player_key: arg.player_key,
      p_machine_id: arg.machine_id,
      p_path: arg.path,
      p_path_prefix: arg.path_prefix,
      p_dual_write: arg.dual_write,
    });
    if (error) {
      console.error('[patches] rpc remove_patches_with_fs error:', error);
      return { data: null, error };
    }
    // RPC returns rows with column `deleted_path` (per the SQL function
    // definition). Map to the adapter's expected `{ path }` shape.
    const paths = (data ?? []).map((row: { deleted_path: string }) => ({ path: row.deleted_path }));
    return { data: paths, error: null };
  });

  const listPatchesForMachines = createSupabaseListPatchesForMachines(
    async (params: ListPatchesForMachinesParams) => {
      // Cross-player read for the requested machines, no per-player
      // filter. Under the eliminated-localhost model every machine_id
      // is per-player unique by construction (workstations are keyed
      // by suffixed hostname, mission instances by IP-registry-allocated
      // public IP, home-network LAN occupants by hostname column).
      // The legacy `machine_id <> 'localhost' OR player_key = me` guard
      // existed only to stop neighbors from leaking each other's
      // localhost mutations through a shared literal machine_id; it's
      // no longer load-bearing.
      //
      // ORDER BY updated_at ASC is load-bearing: client-side
      // `applyPatches` reduces in array order, so the latest write per
      // (machine_id, path) wins automatically.
      const { data, error } = await supabase
        .from('patches')
        .select('machine_id, path, content, owner, permissions, is_new, node_type')
        .in('machine_id', [...params.machine_ids])
        .order('updated_at', { ascending: true });
      if (error) console.error('[patches] supabase selectByMachine error:', error);
      return { data, error };
    },
  );

  const clearOwnedPatches = createSupabaseClearOwnedPatches(async (arg: ClearOwnedArg) => {
    // Wipes ONLY this player's own workstation patches. Cross-player
    // patches (e.g., this player's mods on another player's workstation
    // or a mission instance) are part of the shared world and persist
    // across reset, by design.
    //
    // Both filters are load-bearing: player_key alone would match this
    // player's writes on OTHER machines (mission gateways, peers'
    // workstations); workstation_id alone would match other players'
    // writes on the same workstation_id (impossible in practice — the
    // suffix is identity-derived — but the filter belt-and-braces it).
    const { data, error } = await supabase
      .from('patches')
      .delete()
      .eq('player_key', arg.player_key)
      .eq('machine_id', arg.workstation_id)
      .select('path');
    if (error) console.error('[patches] supabase clearOwned error:', error);
    return { data, error };
  });

  // Realtime broadcast adapter — POSTs to Supabase's broadcast REST
  // endpoint with the service_role key. We use direct fetch instead of
  // supabase-js's channel().send() because Vercel functions are
  // short-lived and opening a WebSocket per request just to fan out one
  // message is wasteful. The REST endpoint is one-shot, idiomatic for
  // server-side publish.
  //
  // See: https://supabase.com/docs/guides/realtime/broadcast (REST API).
  const broadcastViaRest: BroadcastFn = async (channel, event, payload) => {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: channel, event, payload }],
      }),
    });
    if (!response.ok) {
      throw new Error(`broadcast REST returned ${response.status}`);
    }
  };

  const publishPatchChange = (machine_id: string, originator_key: string) =>
    publishPatchChangeHelper(broadcastViaRest, machine_id, originator_key);

  const findActiveSession = createSupabaseFindActiveSession(
    async (params: FindActiveSessionParams) => {
      // L1 + L2 patch-validation query. Hits `sessions_active_by_player_idx`
      // (partial index on player_key WHERE ended_at IS NULL). L1 only
      // needs the existence boolean; L2 (Step 6+) consumes the verified
      // credentials JSONB so the permission walker can key its decision
      // on a server-side projection (not a client claim). `.limit(1)`
      // keeps the read tiny.
      const { data, error } = await supabase
        .from('sessions')
        .select('session_id, credentials')
        .eq('player_key', params.player_key)
        .eq('machine_id', params.machine_id)
        .is('ended_at', null)
        .limit(1);
      if (error) console.error('[patches] supabase findActiveSession error:', error);
      return { data, error };
    },
  );

  const findMachineFs = createSupabaseFindMachineFs(async (params: FindMachineFsParams) => {
    // L2 lookup. Hits the (machine_id, path) PK directly. We only need
    // the projected node fields the walker uses; row absence is normal
    // (unpatched paths) and handled permissively at the handler layer.
    const { data, error } = await supabase
      .from('machine_filesystems')
      .select('owner, permissions')
      .eq('machine_id', params.machine_id)
      .eq('path', params.path)
      .limit(1);
    if (error) console.error('[patches] supabase findMachineFs error:', error);
    return { data, error };
  });

  const findMachineFsBatch = createSupabaseFindMachineFsBatch(
    async (params: FindMachineFsBatchParams) => {
      // Bulk lookup driving the read-path filter. Single round-trip
      // for every (machine_id, path, owner, permissions) row whose
      // machine_id is in the requested set. Handler builds the
      // Map<machine_id, Map<path, perms>> in JS and uses it for both
      // target perms and ancestor traverse decisions.
      const { data, error } = await supabase
        .from('machine_filesystems')
        .select('machine_id, path, owner, permissions')
        .in('machine_id', [...params.machine_ids]);
      if (error) console.error('[patches] supabase findMachineFsBatch error:', error);
      return { data, error };
    },
  );

  const findActiveSessionsBatch = createSupabaseFindActiveSessionsBatch(
    async (params: FindActiveSessionsBatchParams) => {
      // Bulk lookup of the requester's active sessions across the
      // requested machines. Single round-trip; handler dispatches
      // tier 2 vs tier 3 per machine_id from the resulting Map.
      // ended_at IS NULL filter is enforced here (the adapter assumes
      // restricted-to-active rows). ORDER BY created_at DESC ensures
      // the newest row comes first for each (player_key, machine_id);
      // the adapter's first-write-wins keeps the foreground session
      // when stacked sessions exist (su / nested ssh / exploit).
      const { data, error } = await supabase
        .from('sessions')
        .select('machine_id, credentials')
        .eq('player_key', params.player_key)
        .in('machine_id', [...params.machine_ids])
        .is('ended_at', null)
        .order('created_at', { ascending: false });
      if (error) console.error('[patches] supabase findActiveSessionsBatch error:', error);
      return { data, error };
    },
  );

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handlePatchesRequest(req.body, {
    upsertPatch,
    removePatch,
    listPatchesForMachines,
    clearOwnedPatches,
    findActiveSession,
    findMachineFs,
    findMachineFsBatch,
    findActiveSessionsBatch,
    publishPatchChange,
    rateLimiter,
    nonceStore,
  });

  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.status(status).json(body);
}
