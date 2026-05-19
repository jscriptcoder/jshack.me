import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { handleLookupHomeNetworkRequest } from '../src/homeNetworks/lookupHandler.js';
import type { HomeNetworkRow } from '../src/homeNetworks/types.js';
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
// api/join-home-network.ts: keeps this file to the minimum necessary glue
// (env-var lookup, client construction, dependency wiring); business logic
// lives in handleLookupHomeNetworkRequest.
//
// Used by the cross-LAN seed-regen resolver to fetch a foreign
// home_networks row by public IP. RLS keeps anon SELECT off the table
// directly; this signed-envelope endpoint is the read boundary.

const RATE_LIMIT_PER_MINUTE = 120;

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

const findNetworkByPublicIp =
  (supabase: SupabaseClient) =>
  async (publicIp: string): Promise<HomeNetworkRow | null> => {
    const { data, error } = await supabase
      .from('home_networks')
      .select('public_ip, essid_template, density_tier, max_slots, seed')
      .eq('public_ip', publicIp)
      .maybeSingle();
    if (error) {
      console.error('[lookup-home-network] findNetworkByPublicIp error:', error);
      return null;
    }
    return (data as HomeNetworkRow | null) ?? null;
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
    findNetworkByPublicIp: findNetworkByPublicIp(supabase),
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
