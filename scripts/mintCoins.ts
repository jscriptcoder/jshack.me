// Operator mint — credits an address on the ledger with coins that did not exist before.
// The operator runs it by hand; it is the only way coins come to exist.
//
// The ledger's `wallet_mint` function does the work: it raises the address's balance and
// records the transfer, with no sender, in one transaction. An address the ledger has
// never seen is created. The address's sequence number is left alone, since that counts
// only what the address itself has sent.
//
// There is no confirmation and no undo. Running it twice mints twice, and a mistyped
// address that is still address-shaped is paid. The one guard is the line it prints
// before it writes, naming the database it is about to write to.
//
// A mint that would take an address past the largest whole number a browser holds
// exactly (9007199254740991) is refused by the ledger, and nothing is written.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/mintCoins.ts <address> <amount>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 on success, 1 on a refused mint or a database error, 2 on anything but an
// address and a whole amount of at least 1, or on missing env — both before anything is
// touched.

import { createClient } from '@supabase/supabase-js';
import { exactCount } from '../src/core/wallet/exactCount.js';
import { readMintOrder } from '../src/core/wallet/mintOrder.js';

const order = readMintOrder(process.argv.slice(2));
if (order === null) {
  console.error('Usage: mintCoins.ts <address> <amount>');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const main = async () => {
  console.log(`Minting ${order.amount} JSC to ${order.address} on ${new URL(url).host}`);

  const minted = await sr.rpc('wallet_mint', {
    mint_to: order.address,
    mint_amount: order.amount,
  });
  if (minted.error) {
    console.error(`mint failed: ${minted.error.message}`);
    process.exit(1);
  }
  // The ledger answers nothing, and writes nothing, when the credit would not fit.
  if (minted.data === null) {
    console.error(
      `mint refused: ${order.address} would hold more than ${Number.MAX_SAFE_INTEGER} JSC`,
    );
    process.exit(1);
  }

  const held = exactCount.safeParse(minted.data);
  if (!held.success) {
    console.error('minted, but the ledger did not answer with the new balance');
    process.exit(1);
  }
  console.log(`${order.address}  ${held.data} JSC`);
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
