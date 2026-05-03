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
import { getReservedLanOctets } from '../src/homeNetworks/getReservedLanOctets.js';
import {
  publishOccupantChange as publishOccupantChangeHelper,
  type BroadcastFn as OccupantBroadcastFn,
} from '../src/homeNetworks/broadcast.js';
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
import { regenHomeNetworkRows } from '../src/machineFilesystems/populateHomeNetworkBaseFs.js';
import { createBulkInsertMachineFs } from '../src/machineFilesystems/bulkInsertMachineFs.js';
import type { MachineFsRow } from '../src/machineFilesystems/flattenFileNode.js';

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

    // L2 base-FS backfill: regenerate the network's filesystems
    // deterministically from the seed and bulk-insert one row per
    // FileNode into machine_filesystems. ON CONFLICT DO NOTHING
    // semantics mean live patches (already dual-written) are preserved
    // and only base-FS rows that don't already exist get added.
    //
    // Best effort: a populate failure logs but does NOT fail the join
    // — the home_networks row is already committed and the backfill
    // script (scripts/backfillHomeNetworkBaseFs.ts) can re-run any
    // missed populates idempotently. The L2 walker falls back to allow
    // for unpatched paths in the meantime, matching the leaf-only
    // posture.
    await populateBaseFsBestEffort(supabase, params.seed, params.publicIp);

    return row;
  };

// Bulk-inserts the base-FS rows generated from the seed. Wrapped in a
// try/catch so any failure (regen exception, DB error, network blip)
// is logged but doesn't fail the calling join flow. Idempotent at the
// DB level via ON CONFLICT DO NOTHING on the (machine_id, path) PK.
const populateBaseFsBestEffort = async (
  supabase: SupabaseClient,
  seed: string,
  publicIp: string,
): Promise<void> => {
  try {
    const rows = await regenHomeNetworkRows({ seed, publicIp });
    const bulkInsert = createBulkInsertMachineFs(async (chunk: readonly MachineFsRow[]) => {
      const { error } = await supabase
        .from('machine_filesystems')
        .upsert([...chunk], { onConflict: 'machine_id,path', ignoreDuplicates: true });
      return { error };
    });
    const result = await bulkInsert(rows);
    if (!result.ok) {
      console.error('[join-home-network] base-FS populate failed for', publicIp);
    }
  } catch (e) {
    console.error('[join-home-network] base-FS populate threw:', e);
  }
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
  //
  // Builds the exclusion set per network: the NPC octets the FS generator
  // produced for this seed (via getReservedLanOctets — runs the home-
  // network generator deterministically) plus the existing occupant
  // octets already taken on this LAN. Without exclusions, blind random
  // rolls landed players onto NPC IPs (e.g. `http-srv`'s slot) and the
  // multi-player views diverged — each player rendering the LAN
  // locally either showed the NPC or the occupant overlay, never both.
  const pickLanIp = async ({
    seed,
    publicIp,
  }: {
    readonly seed: string;
    readonly publicIp: string;
  }): Promise<string> => {
    const reservedOctets = await getReservedLanOctets({ seed, publicIp });
    const { data: occupants } = await supabase
      .from('home_network_occupants')
      .select('lan_ip')
      .eq('network_id', publicIp);
    const occupantOctets = new Set<number>();
    for (const row of occupants ?? []) {
      const octet = Number((row.lan_ip as string).slice(1));
      if (Number.isFinite(octet)) occupantOctets.add(octet);
    }
    const excluded = new Set<number>([...reservedOctets, ...occupantOctets]);
    return pickRandomLanIp(createPrng(randomUUID()), { excludedOctets: excluded });
  };

  // Realtime broadcast adapter — POSTs to Supabase's broadcast REST
  // endpoint with the service_role key. Mirrors api/patches.ts's
  // broadcastViaRest exactly: direct fetch beats opening a WebSocket
  // per Vercel function invocation, since these functions are
  // short-lived. See: https://supabase.com/docs/guides/realtime/broadcast.
  const broadcastViaRest: OccupantBroadcastFn = async (channel, event, payload) => {
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

  const publishOccupantChange = (network_id: string, originator_key: string) =>
    publishOccupantChangeHelper(broadcastViaRest, network_id, originator_key);

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleJoinHomeNetworkRequest(req.body, {
    findOccupantByPlayer: findOccupantByPlayer(supabase),
    findNetworkWithFreeSlots: findNetworkWithFreeSlots(supabase),
    createNetwork: createNetwork(supabase),
    insertOccupant,
    allocatePublicIp: allocateHomeNetworkPublicIp(supabase),
    pickLanIp,
    publishOccupantChange,
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
