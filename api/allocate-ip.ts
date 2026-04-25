import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import { createPrng } from '../src/generation/prng';
import { generatePublicIp } from '../src/generation/ip';
import { handleAllocateRequest } from '../src/ipRegistry/handler';
import { createSupabaseInsertIp } from '../src/ipRegistry/supabaseInsert';
import {
  createUpstashRateLimiter,
  noopRateLimiter,
  type RateLimiter,
} from '../src/ipRegistry/rateLimit';
import type { IpRow } from '../src/ipRegistry/types';

// Vercel adapter for POST /api/allocate-ip.
//
// Keeps the code in this file to the minimum necessary glue: method guard,
// env-var lookup, Supabase + Upstash client construction, dependency wiring.
// All validation and business logic live in handleAllocateRequest +
// allocateIp + the rateLimit module, which are pure and unit-tested.

// Per-IP rate limit. 30 requests/minute is comfortably above any legitimate
// flow (a player cracking a WiFi or accepting a mission triggers ~1 call)
// while stopping a script that's hammering the endpoint.
const RATE_LIMIT_PER_MINUTE = 30;

const buildRateLimiter = (): RateLimiter => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Local dev / pre-Upstash-setup: don't rate-limit. The server is private
    // enough that this is fine. Production should always have Upstash set.
    console.warn('[allocate-ip] Upstash not configured — rate limiting disabled');
    return noopRateLimiter;
  }
  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'allocate-ip',
  });
  return createUpstashRateLimiter((id) => ratelimit.limit(id));
};

// Vercel sets x-forwarded-for (the originating client IP, possibly via a
// chain of proxies). The first comma-separated entry is the real caller.
// Fall back to a constant when running locally without proxy headers — local
// dev typically uses noopRateLimiter anyway, so this string is unused.
const extractCallerKey = (req: VercelRequest): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const headerValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return headerValue?.split(',')[0]?.trim() ?? 'unknown';
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
    return { error };
  });

  // Fresh PRNG per roll, seeded with crypto entropy so allocations are
  // non-deterministic across requests even on the same process.
  const rollIp = () => generatePublicIp(createPrng(randomUUID()));

  const callerKey = extractCallerKey(req);
  const rateLimiter = buildRateLimiter();

  const { status, body, headers } = await handleAllocateRequest(req.body, callerKey, {
    insertIp,
    rollIp,
    rateLimiter,
  });

  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.status(status).json(body);
}
