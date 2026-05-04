import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { handleRegisterWorkstationRequest } from '../src/workstationRegistry/handler.js';
import { createSupabaseUpsertWorkstation } from '../src/workstationRegistry/supabaseUpsert.js';
import type { PopulateBaseFsResult, WorkstationRow } from '../src/workstationRegistry/types.js';
import { regenWorkstationRows } from '../src/machineFilesystems/populateWorkstationBaseFs.js';
import { createBulkInsertMachineFs } from '../src/machineFilesystems/bulkInsertMachineFs.js';
import type { MachineFsRow } from '../src/machineFilesystems/flattenFileNode.js';
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

// Vercel adapter for POST /api/register-workstation.
//
// Once-per-game endpoint that records a workstation server-side and
// populates the L2 projection (machine_filesystems) with its base FS.
// Closes the leaf-only fallback that lets intruders with cracked
// sessions on a player's workstation forge envelopes that bypass L2.
//
// See plans/l2-own-workstation-backfill.md (Step 4).

// Low rate limit — register is once-per-game, but allow a small
// handful of retries for transient failures (network blip, populate
// retry path, etc.). Per-pubkey, like the other signed endpoints.
const RATE_LIMIT_PER_MINUTE = 5;

const buildUpstashAdapters = (): {
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
} => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn(
      '[register-workstation] Upstash not configured — rate limit + replay protection disabled',
    );
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'register-workstation',
  });
  return {
    rateLimiter: createUpstashRateLimiter((id) => ratelimit.limit(id)),
    nonceStore: createUpstashNonceStore((key, value, opts) =>
      redis.set(key, value, { ex: opts.ex, nx: opts.nx }),
    ),
  };
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

  const upsertWorkstation = createSupabaseUpsertWorkstation(
    async (row: WorkstationRow) => {
      // ignoreDuplicates: true → on conflict, the row is silently
      // dropped; .select returns only rows that were actually inserted
      // (empty array on conflict). Matches the supabaseUpsert
      // adapter's contract.
      const { data, error } = await supabase
        .from('workstations')
        .upsert(row, { onConflict: 'player_key', ignoreDuplicates: true })
        .select('player_key, workstation_name, username');
      if (error) {
        console.error('[register-workstation] upsert error:', error);
      }
      return { data, error };
    },
    async (player_key: string) => {
      const { data, error } = await supabase
        .from('workstations')
        .select('player_key, workstation_name, username')
        .eq('player_key', player_key)
        .maybeSingle();
      if (error) {
        console.error('[register-workstation] read-back error:', error);
      }
      return { data, error };
    },
  );

  const populateBaseFs = async (row: WorkstationRow): Promise<PopulateBaseFsResult> => {
    try {
      const rows = regenWorkstationRows({
        playerKey: row.player_key,
        workstationName: row.workstation_name,
        username: row.username,
      });
      const bulkInsert = createBulkInsertMachineFs(async (chunk: readonly MachineFsRow[]) => {
        const { error } = await supabase.from('machine_filesystems').upsert([...chunk], {
          onConflict: 'machine_id,path',
          ignoreDuplicates: true,
        });
        return { error };
      });
      const result = await bulkInsert(rows);
      return { ok: result.ok };
    } catch (e) {
      console.error('[register-workstation] base-FS populate threw:', e);
      return { ok: false };
    }
  };

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleRegisterWorkstationRequest(req.body, {
    upsertWorkstation,
    populateBaseFs,
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
