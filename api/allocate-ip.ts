import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { createPrng } from '../src/generation/prng';
import { generatePublicIp } from '../src/generation/ip';
import { handleAllocateRequest } from '../src/ipRegistry/handler';
import { createSupabaseInsertIp } from '../src/ipRegistry/supabaseInsert';
import type { IpRow } from '../src/ipRegistry/types';

// Vercel adapter for POST /api/allocate-ip.
//
// Keeps the code in this file to the minimum necessary glue: method guard,
// env-var lookup, Supabase client construction, dependency wiring. All
// validation and business logic live in handleAllocateRequest + allocateIp,
// which are pure and unit-tested.

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

  const { status, body } = await handleAllocateRequest(req.body, { insertIp, rollIp });
  res.status(status).json(body);
}
