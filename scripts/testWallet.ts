// Wire-payload smoke for the LEDGER — what an address holds, read by anybody. Drives the
// REAL /api/wallet endpoint against a running `vercel dev` + supabase, and writes the rows
// it reads back straight into `wallet_balances` through the service role.
//
// Net-new under test (the locally-untypechecked api/ runtime, and the table itself):
//   - An address the ledger has never seen reads 0 with sequence 0, and asking leaves no
//     row behind.
//   - An address the ledger holds reads the balance and the sequence number in its row,
//     which is what proves the column names the endpoint selects.
//   - The largest balance the table allows comes back as the same number, digit for digit.
//   - The request needs no signature: a bare `{ action, address }` is answered.
//   - Text that is not address-shaped is a 400, as is an action the endpoint does not
//     know, and anything but POST is a 405.
//   - The table refuses what no balance may be: a negative one, one past the largest whole
//     number a browser holds exactly, and a row whose address is not address-shaped.
//   - A client holding only the anon key reads nothing off the table.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testWallet.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { generateWalletKey } from '../src/core/wallet/walletKey.js';

const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const send = async (
  method: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const response = await fetch(WALLET, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const balanceOf = (address: unknown) => send('POST', { action: 'balance', address });

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const show = (value: unknown): string => JSON.stringify(value);

const rowsAt = async (address: string): Promise<number> => {
  const { count } = await sr
    .from('wallet_balances')
    .select('*', { count: 'exact', head: true })
    .eq('address', address);
  return count ?? 0;
};

const LARGEST = 9007199254740991;

// Fresh addresses every run, made the way the game makes them, so a run never reads a
// row an earlier one left and never touches an address anybody holds.
const UNSEEN = generateWalletKey().address;
const HELD = generateWalletKey().address;
const FULL = generateWalletKey().address;
const REFUSED = generateWalletKey().address;

const cleanup = async () => {
  await sr.from('wallet_balances').delete().in('address', [UNSEEN, HELD, FULL, REFUSED]);
};
await cleanup();

// === 1. An address the ledger has never seen. ===
const unseen = await balanceOf(UNSEEN);
check(
  'an unseen address reads 0 with sequence 0',
  unseen.status === 200 && show(unseen.body) === show({ balance: 0, nextSequence: 0 }),
  `status=${unseen.status} body=${show(unseen.body)}`,
);
const unseenRows = await rowsAt(UNSEEN);
check('asking about it leaves no row behind', unseenRows === 0, `rows=${unseenRows}`);

// === 2. An address the ledger holds. ===
const credited = await sr
  .from('wallet_balances')
  .insert({ address: HELD, balance: 250, next_sequence: 3 });
const held = await balanceOf(HELD);
check(
  'a held address reads the balance and the sequence number in its row',
  credited.error === null &&
    held.status === 200 &&
    show(held.body) === show({ balance: 250, nextSequence: 3 }),
  `insert=${credited.error?.message ?? 'ok'} status=${held.status} body=${show(held.body)}`,
);

// === 3. The largest balance there is. ===
const filled = await sr.from('wallet_balances').insert({ address: FULL, balance: LARGEST });
const full = await balanceOf(FULL);
check(
  'the largest balance the table allows comes back digit for digit',
  filled.error === null &&
    full.status === 200 &&
    show(full.body) === show({ balance: LARGEST, nextSequence: 0 }),
  `insert=${filled.error?.message ?? 'ok'} status=${full.status} body=${show(full.body)}`,
);

// === 4. What the endpoint turns away. ===
for (const [label, text] of [
  ['the mint label', 'coinbase'],
  ['an address in upper case', HELD.toUpperCase()],
  ['an address one character short', HELD.slice(0, -1)],
] as const) {
  const refused = await balanceOf(text);
  check(
    `${label} is a 400 invalid_address`,
    refused.status === 400 && errorOf(refused.body) === 'invalid_address',
    `status=${refused.status} body=${show(refused.body)}`,
  );
}
const unknownAction = await send('POST', { action: 'drain', address: HELD });
check(
  'an action the endpoint does not know is a 400 unknown_action',
  unknownAction.status === 400 && errorOf(unknownAction.body) === 'unknown_action',
  `status=${unknownAction.status} body=${show(unknownAction.body)}`,
);
const got = await send('GET', null);
check(
  'anything but POST is a 405',
  got.status === 405 && errorOf(got.body) === 'method_not_allowed',
  `status=${got.status} body=${show(got.body)}`,
);

// === 5. What the table itself refuses. ===
for (const [label, row] of [
  ['a negative balance', { address: REFUSED, balance: -1 }],
  ['a balance past the largest exact number', { address: REFUSED, balance: '9007199254740992' }],
  ['a negative sequence number', { address: REFUSED, balance: 0, next_sequence: -1 }],
  ['an address that is not address-shaped', { address: 'coinbase', balance: 1 }],
  ['an address in upper case', { address: REFUSED.toUpperCase(), balance: 1 }],
] as const) {
  const { error } = await sr.from('wallet_balances').insert(row);
  check(
    `the table refuses ${label}`,
    error?.code === '23514',
    `code=${error?.code ?? 'none (the row was written)'}`,
  );
}
const refusedRows = await rowsAt(REFUSED);
check('and none of those rows was written', refusedRows === 0, `rows=${refusedRows}`);

// === 6. The table is closed to everything but the endpoint. ===
const peeked = await anon.from('wallet_balances').select('address').eq('address', HELD);
check(
  'a client holding only the anon key reads nothing off the table',
  (peeked.data ?? []).length === 0,
  `rows=${peeked.data?.length ?? 0} error=${peeked.error?.message ?? 'none'}`,
);

await cleanup();
await sr.from('wallet_balances').delete().in('address', ['coinbase', REFUSED.toUpperCase()]);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
