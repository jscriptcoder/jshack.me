import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { handleLookupHomeNetworkRequest } from '../src/homeNetworks/handler.js';
import {
  occupantSummarySchema,
  type HomeNetworkRow,
  type OccupantSummary,
} from '../src/homeNetworks/types.js';
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

// Vercel adapter for POST /api/lookup-home-network. Mirrors
// api/join-home-network.ts: keeps this file to env-var lookup, client
// construction, and dependency wiring; business logic lives in
// handleLookupHomeNetworkRequest.
//
// Conservative rate limit — lazy subscription is not a hot path. Each
// foreign public IP a player touches resolves to one call; piece 3
// (findit.io) browsing will surface more, but the per-pubkey ceiling
// still leaves plenty of headroom for normal exploration. The 60/min
// here matches the read-side endpoint rate caps and pre-empts noisy
// adapters scripted against a single identity.

const RATE_LIMIT_PER_MINUTE = 60;

const buildUpstashAdapters = (): { rateLimiter: RateLimiter; nonceStore: NonceStore } => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn(
      '[lookup-home-network] Upstash not configured — rate limit + replay protection disabled',
    );
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'lookup-home-network',
  });
  return {
    rateLimiter: createUpstashRateLimiter((id) => ratelimit.limit(id)),
    nonceStore: createUpstashNonceStore((key, value, opts) =>
      redis.set(key, value, { ex: opts.ex, nx: opts.nx }),
    ),
  };
};

const findHomeNetworkByPublicIp =
  (supabase: SupabaseClient) =>
  async (publicIp: string): Promise<HomeNetworkRow | null> => {
    const { data, error } = await supabase
      .from('home_networks')
      .select('*')
      .eq('public_ip', publicIp)
      .maybeSingle();
    if (error) {
      console.error('[lookup-home-network] findHomeNetworkByPublicIp error:', error);
      return null;
    }
    return (data as HomeNetworkRow | null) ?? null;
  };

const listOccupantsByNetworkId =
  (supabase: SupabaseClient) =>
  async (networkId: string): Promise<readonly OccupantSummary[]> => {
    const { data, error } = await supabase
      .from('home_network_occupants')
      .select('network_id, lan_ip, hostname')
      .eq('network_id', networkId);
    if (error) {
      console.error('[lookup-home-network] listOccupantsByNetworkId error:', error);
      return [];
    }
    // Schema-validate each row — drops anything malformed (defensive against
    // schema drift). Matches the listOccupants helper used by anon SELECT.
    return (data ?? []).flatMap((row): readonly OccupantSummary[] => {
      const parsed = occupantSummarySchema.safeParse(row);
      if (parsed.success) return [parsed.data];
      console.error('[lookup-home-network] dropping malformed occupant row:', parsed.error.issues);
      return [];
    });
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

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleLookupHomeNetworkRequest(req.body, {
    findHomeNetworkByPublicIp: findHomeNetworkByPublicIp(supabase),
    listOccupantsByNetworkId: listOccupantsByNetworkId(supabase),
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
