import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import { createPrng } from '../src/generation/prng.js';
import { generatePublicIp } from '../src/generation/ip.js';
import { handleJoinHomeNetworkRequest } from '../src/homeNetworks/handler.js';
import { createInsertOccupant } from '../src/homeNetworks/createInsertOccupant.js';
import { pickRandomLanIp } from '../src/homeNetworks/pickRandomLanIp.js';
import type {
  DensityTier,
  HomeNetworkOccupantRow,
  HomeNetworkRow,
} from '../src/homeNetworks/types.js';
import { allocateIp } from '../src/ipRegistry/allocate.js';
import { createSupabaseInsertIp } from '../src/ipRegistry/supabaseInsert.js';
import type { IpRow } from '../src/ipRegistry/types.js';
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

// Vercel adapter for POST /api/join-home-network. Mirrors api/allocate-ip.ts:
// keeps this file to the minimum necessary glue (env-var lookup, client
// construction, dependency wiring); business logic lives in
// handleJoinHomeNetworkRequest.

const RATE_LIMIT_PER_MINUTE = 30;

const buildUpstashAdapters = (): { rateLimiter: RateLimiter; nonceStore: NonceStore } => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn(
      '[join-home-network] Upstash not configured — rate limit + replay protection disabled',
    );
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'join-home-network',
  });
  return {
    rateLimiter: createUpstashRateLimiter((id) => ratelimit.limit(id)),
    nonceStore: createUpstashNonceStore((key, value, opts) =>
      redis.set(key, value, { ex: opts.ex, nx: opts.nx }),
    ),
  };
};

// Looks up the player's existing occupant row for a (essid_template,
// density_tier) — the idempotency key. Two queries: networks for the
// template, then an occupant row owned by this player on any of them.
// Two-step approach avoids depending on Supabase FK-embed semantics.
const findOccupantByPlayer =
  (supabase: SupabaseClient) =>
  async (params: {
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
    readonly playerKey: string;
  }): Promise<{
    readonly network: HomeNetworkRow;
    readonly occupant: HomeNetworkOccupantRow;
  } | null> => {
    const { data: networks, error: e1 } = await supabase
      .from('home_networks')
      .select('*')
      .eq('essid_template', params.essidTemplate)
      .eq('density_tier', params.densityTier);
    if (e1) {
      console.error('[join-home-network] networks lookup error:', e1);
      return null;
    }
    if (!networks?.length) return null;

    const networkIds = networks.map((n) => n.public_ip as string);
    const { data: occupant, error: e2 } = await supabase
      .from('home_network_occupants')
      .select('*')
      .eq('player_key', params.playerKey)
      .in('network_id', networkIds)
      .maybeSingle();
    if (e2) {
      console.error('[join-home-network] occupant lookup error:', e2);
      return null;
    }
    if (!occupant) return null;

    const network = networks.find((n) => n.public_ip === occupant.network_id);
    if (!network) return null;

    return {
      network: network as HomeNetworkRow,
      occupant: occupant as HomeNetworkOccupantRow,
    };
  };

// Finds an existing network for the (template, tier) with free slots.
// Two queries (same reasoning as findOccupantByPlayer) — fetch candidate
// networks, fetch occupant counts, pick the oldest network with room.
const findNetworkWithFreeSlots =
  (supabase: SupabaseClient) =>
  async (params: {
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
  }): Promise<HomeNetworkRow | null> => {
    const { data: networks, error: e1 } = await supabase
      .from('home_networks')
      .select('*')
      .eq('essid_template', params.essidTemplate)
      .eq('density_tier', params.densityTier)
      .order('created_at', { ascending: true });
    if (e1) {
      console.error('[join-home-network] free-slots lookup error:', e1);
      return null;
    }
    if (!networks?.length) return null;

    const networkIds = networks.map((n) => n.public_ip as string);
    const { data: occupantRows, error: e2 } = await supabase
      .from('home_network_occupants')
      .select('network_id')
      .in('network_id', networkIds);
    if (e2) {
      console.error('[join-home-network] occupant count error:', e2);
      return null;
    }

    const countByNetwork = new Map<string, number>();
    for (const row of occupantRows ?? []) {
      const id = row.network_id as string;
      countByNetwork.set(id, (countByNetwork.get(id) ?? 0) + 1);
    }

    const free = networks.find(
      (n) => (countByNetwork.get(n.public_ip as string) ?? 0) < (n.max_slots as number),
    );
    return (free ?? null) as HomeNetworkRow | null;
  };

const createNetwork =
  (supabase: SupabaseClient) =>
  async (params: {
    readonly publicIp: string;
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
    readonly maxSlots: number;
    readonly seed: string;
  }): Promise<HomeNetworkRow> => {
    const row: HomeNetworkRow = {
      public_ip: params.publicIp,
      essid_template: params.essidTemplate,
      density_tier: params.densityTier,
      max_slots: params.maxSlots,
      seed: params.seed,
    };
    const { error } = await supabase.from('home_networks').insert(row);
    if (error) {
      console.error('[join-home-network] createNetwork error:', error);
      throw new Error(`createNetwork failed: ${error.message ?? 'unknown'}`);
    }
    return row;
  };

const allocateHomeNetworkPublicIp =
  (supabase: SupabaseClient) => async (): Promise<string | null> => {
    const insertIp = createSupabaseInsertIp(async (ipRow: IpRow) => {
      const { error } = await supabase.from('public_ips').insert(ipRow);
      if (error) console.error('[join-home-network] public_ips insert error:', error);
      return { error };
    });
    const rollIp = () => generatePublicIp(createPrng(randomUUID()));
    // owner_key omitted: home networks are shared (mirrors world_networks).
    const result = await allocateIp({ kind: 'home_network' }, { insertIp, rollIp });
    return result.ok ? result.ip : null;
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

  const insertOccupant = createInsertOccupant(async (occupantRow) => {
    const { error } = await supabase.from('home_network_occupants').insert(occupantRow);
    if (error) console.error('[join-home-network] insertOccupant error:', error);
    return { error };
  });

  // Fresh PRNG per slot pick — non-deterministic across requests, even on
  // the same process. Same posture as rollIp in api/allocate-ip.ts.
  const pickLanIp = () => pickRandomLanIp(createPrng(randomUUID()));

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleJoinHomeNetworkRequest(req.body, {
    findOccupantByPlayer: findOccupantByPlayer(supabase),
    findNetworkWithFreeSlots: findNetworkWithFreeSlots(supabase),
    createNetwork: createNetwork(supabase),
    insertOccupant,
    allocatePublicIp: allocateHomeNetworkPublicIp(supabase),
    pickLanIp,
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
