import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import type { NonceStore } from '../src/core/signedRequest/nonceStore.js';
import { handleWalletBalance } from '../src/core/wallet/handleWalletBalance.js';
import {
  handleWalletTransfer,
  type TransferOrder,
} from '../src/core/wallet/handleWalletTransfer.js';

// Vercel adapter for POST /api/wallet — the ledger.
//
// The one endpoint that verifies no envelope on a read. The ledger is keyed by
// address and public, so a balance read names an address and nothing else.
//
// A transfer is the one request here that is signed, and it is signed by the
// wallet's key, not a player's. A body that carries a signed payload is a
// transfer; anything else is a read.
//
// Logic lives in core/ handlers (unit + mutation tested); this file stays a thin
// Supabase adapter. It's typechecked via tsconfig.node.json (`npm run typecheck`),
// but its runtime correctness (column names, constraints) is only proven by the
// wire-check script against a live endpoint.

// No nonce is kept. What stops a transfer from being sent twice is its sequence
// number: the ledger moves coins only at the sending address's next one.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

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

  if (typeof (req.body as { payload?: unknown } | null)?.payload === 'string') {
    // The debit, the credit and the transfer row are one transaction inside the
    // function. Its answer is a word, handed over as it came off the wire for
    // the handler to parse.
    const transfer = async ({ from, to, amount, sequence }: TransferOrder) => {
      const { data, error } = await supabase.rpc('wallet_transfer', {
        transfer_from: from,
        transfer_to: to,
        transfer_amount: amount,
        transfer_sequence: sequence,
      });
      if (error) console.error('[wallet] transfer error:', error);
      return { data: data as unknown, error };
    };

    const { status, body } = await handleWalletTransfer(req.body, {
      nonceStore: noopNonceStore,
      transfer,
    });
    res.status(status).json(body);
    return;
  }

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
