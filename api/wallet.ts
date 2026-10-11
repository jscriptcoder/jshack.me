import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleWalletBalance } from '../src/core/wallet/handleWalletBalance.js';

// Vercel adapter for POST /api/wallet — the ledger.
//
// The one endpoint that verifies no envelope on a read. The ledger is keyed by
// address and public, so a balance read names an address and nothing else, and
// the handler is given no nonce store because there is no signature to replay.
//
// Logic lives in core/ handlers (unit + mutation tested); this file stays a thin
// Supabase adapter. It's typechecked via tsconfig.node.json (`npm run typecheck`),
// but its runtime correctness (column names, constraints) is only proven by the
// wire-check script against a live endpoint.
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

  // One address's row, or null when the ledger has never been asked to hold
  // anything there. The handler parses the row itself, so it is handed over as
  // it came off the wire.
  const findBalance = async (address: string) => {
    const { data, error } = await supabase
      .from('wallet_balances')
      .select('balance, next_sequence')
      .eq('address', address)
      .maybeSingle();
    if (error) console.error('[wallet] balance lookup error:', error);
    return { data: data as unknown, error };
  };

  const { status, body } = await handleWalletBalance(req.body, { findBalance });
  res.status(status).json(body);
}
