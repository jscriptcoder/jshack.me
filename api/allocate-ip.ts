import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import { createPrng } from '../src/generation/prng.js';
import { generatePublicIp } from '../src/generation/ip.js';
import { handleAllocateRequest } from '../src/ipRegistry/handler.js';
import { createSupabaseInsertIp } from '../src/ipRegistry/supabaseInsert.js';
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
import type { IpRow } from '../src/ipRegistry/types.js';

// Vercel adapter for POST /api/allocate-ip.
//
// Keeps the code in this file to the minimum necessary glue: method guard,
// env-var lookup, Supabase + Upstash client construction, dependency wiring.
// All validation and business logic live in handleAllocateRequest +
// allocateIp + verifySignedRequest, which are pure and unit-tested.

// Per-pubkey rate limit. 30 requests/minute is comfortably above any
// legitimate flow (a player cracking a WiFi or accepting a mission triggers
// ~1 call) while stopping a script that's hammering the endpoint. Switched
// from per-IP to per-pubkey: shared NAT no longer causes collateral damage,
// and a single attacker can't burn through the limit by rotating IPs.
const RATE_LIMIT_PER_MINUTE = 30;

// Both rate-limiting and nonce dedupe live in the same Upstash Redis. We
// build one Redis client and split it across the two abstractions.
const buildUpstashAdapters = (): { rateLimiter: RateLimiter; nonceStore: NonceStore } => {
  // Accepts either naming convention:
  //   - UPSTASH_REDIS_REST_URL/TOKEN — Upstash native, direct integration
  //   - KV_REST_API_URL/TOKEN        — Vercel Marketplace Upstash integration
  //                                     (legacy Vercel KV namespace; current default)
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Local dev / pre-Upstash-setup: don't rate-limit, don't dedupe nonces.
    // Replay protection is effectively disabled in this mode — the server is
    // private enough that this is fine for dev. Production must have Upstash.
    console.warn('[allocate-ip] Upstash not configured — rate limit + replay protection disabled');
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'allocate-ip',
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

  const insertIp = createSupabaseInsertIp(async (row: IpRow) => {
    const { error } = await supabase.from('public_ips').insert(row);
    if (error) console.error('[allocate-ip] supabase insert error:', error);
    return { error };
  });

  // Fresh PRNG per roll, seeded with crypto entropy so allocations are
  // non-deterministic across requests even on the same process.
  const rollIp = () => generatePublicIp(createPrng(randomUUID()));

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleAllocateRequest(req.body, {
    insertIp,
    rollIp,
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
