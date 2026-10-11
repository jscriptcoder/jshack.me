// Wire-payload smoke for the LEDGER — what an address holds, read by anybody, and how coins
// come to exist. Drives the REAL /api/wallet endpoint against a running `vercel dev` +
// supabase, writes the rows it reads back straight into `wallet_balances` through the
// service role, and mints with the operator's `scripts/mintCoins.ts`, run as a child
// process exactly as the operator runs it.
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
//   - THE MINT. The script raises an address's balance by what it was told and records one
//     transfer with no sender each time; an address the ledger has never seen is created;
//     the sequence number of an address that has one is left alone; it names the database
//     before it writes and the new balance after.
//   - A mint that would pass the largest balance is refused and writes nothing, while one
//     that lands exactly on it is taken.
//   - Bad arguments and missing env stop the script before it writes anything.
//   - The credit and its transfer row are one act: a mint whose transfer row the table
//     refuses leaves the balance where it was.
//   - The transfers table refuses what no transfer may be, and neither it nor the mint is
//     open to a client holding only the anon key.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testWallet.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { spawnSync } from 'node:child_process';
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

const transfersTo = async (
  address: string,
): Promise<readonly { readonly from_address: string | null; readonly amount: number }[]> => {
  const { data } = await sr
    .from('wallet_transfers')
    .select('from_address, amount')
    .eq('to_address', address)
    .order('id');
  return data ?? [];
};

const MINT_SCRIPT = 'scripts/mintCoins.ts';

/** Runs the operator's mint the way the operator does, with `env` as its environment. */
const mint = (words: readonly string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ['--import', 'tsx', MINT_SCRIPT, ...words], {
    env,
    encoding: 'utf8',
  });

const LARGEST = 9007199254740991;

// Fresh addresses every run, made the way the game makes them, so a run never reads a
// row an earlier one left and never touches an address anybody holds.
const UNSEEN = generateWalletKey().address;
const HELD = generateWalletKey().address;
const FULL = generateWalletKey().address;
const REFUSED = generateWalletKey().address;
const MINTED = generateWalletKey().address;
const NEARLY_FULL = generateWalletKey().address;
const MISTYPED = generateWalletKey().address;
const OTHER = generateWalletKey().address;

const EVERY_ADDRESS = [UNSEEN, HELD, FULL, REFUSED, MINTED, NEARLY_FULL, MISTYPED, OTHER];

const cleanup = async () => {
  await sr.from('wallet_transfers').delete().in('to_address', EVERY_ADDRESS);
  await sr.from('wallet_balances').delete().in('address', EVERY_ADDRESS);
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

// === 7. The operator mints. ===
const HOST = new URL(url).host;
const first = mint([MINTED, '500']);
const afterFirst = await balanceOf(MINTED);
check(
  'a mint to an address the ledger has never seen creates it holding the amount',
  first.status === 0 &&
    afterFirst.status === 200 &&
    show(afterFirst.body) === show({ balance: 500, nextSequence: 0 }),
  `exit=${first.status} stderr=${show(first.stderr)} body=${show(afterFirst.body)}`,
);
check(
  'it names the database before it writes and the new balance after',
  first.stdout === `Minting 500 JSC to ${MINTED} on ${HOST}\n${MINTED}  500 JSC\n`,
  `stdout=${show(first.stdout)}`,
);
const second = mint([MINTED, '500']);
const afterSecond = await balanceOf(MINTED);
check(
  'minting again raises the balance by the amount again',
  second.status === 0 &&
    second.stdout.endsWith(`${MINTED}  1000 JSC\n`) &&
    show(afterSecond.body) === show({ balance: 1000, nextSequence: 0 }),
  `exit=${second.status} stdout=${show(second.stdout)} body=${show(afterSecond.body)}`,
);
const mintedRows = await transfersTo(MINTED);
check(
  'each mint is one transfer of the amount with no sender',
  show(mintedRows) ===
    show([
      { from_address: null, amount: 500 },
      { from_address: null, amount: 500 },
    ]),
  `rows=${show(mintedRows)}`,
);
const toHeld = mint([HELD, '100']);
const heldAfter = await balanceOf(HELD);
check(
  'a mint leaves the sequence number of an address that has one alone',
  toHeld.status === 0 && show(heldAfter.body) === show({ balance: 350, nextSequence: 3 }),
  `exit=${toHeld.status} stderr=${show(toHeld.stderr)} body=${show(heldAfter.body)}`,
);

// === 8. The largest balance is a wall. ===
await sr.from('wallet_balances').insert({ address: NEARLY_FULL, balance: LARGEST - 500 });
const tooMuch = mint([NEARLY_FULL, '501']);
const afterTooMuch = await balanceOf(NEARLY_FULL);
const tooMuchRows = await transfersTo(NEARLY_FULL);
check(
  'a mint that would pass the largest balance exits 1 and says it was refused',
  tooMuch.status === 1 &&
    tooMuch.stderr === `mint refused: ${NEARLY_FULL} would hold more than ${LARGEST} JSC\n`,
  `exit=${tooMuch.status} stderr=${show(tooMuch.stderr)}`,
);
check(
  'and leaves the balance and the transfers as they were',
  show(afterTooMuch.body) === show({ balance: LARGEST - 500, nextSequence: 0 }) &&
    tooMuchRows.length === 0,
  `body=${show(afterTooMuch.body)} transfers=${tooMuchRows.length}`,
);
const justFits = mint([NEARLY_FULL, '500']);
const afterJustFits = await balanceOf(NEARLY_FULL);
check(
  'a mint that lands exactly on the largest balance is taken',
  justFits.status === 0 && show(afterJustFits.body) === show({ balance: LARGEST, nextSequence: 0 }),
  `exit=${justFits.status} stderr=${show(justFits.stderr)} body=${show(afterJustFits.body)}`,
);

// === 9. What stops the script before it writes. ===
for (const [label, words] of [
  ['text that is not an address', ['coinbase', '500']],
  ['an amount of nothing', [MISTYPED, '0']],
  ['an amount with a fraction', [MISTYPED, '2.5']],
  ['no amount', [MISTYPED]],
  ['a third word', [MISTYPED, '500', '500']],
] as const) {
  const stopped = mint(words);
  check(
    `${label} exits 2 with the usage`,
    stopped.status === 2 && stopped.stderr === 'Usage: mintCoins.ts <address> <amount>\n',
    `exit=${stopped.status} stderr=${show(stopped.stderr)}`,
  );
}
const { SUPABASE_SERVICE_ROLE_KEY: _withheld, ...keyless } = process.env;
const noKey = mint([MISTYPED, '500'], keyless);
check(
  'a missing service key exits 2',
  noKey.status === 2 && noKey.stderr === 'Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\n',
  `exit=${noKey.status} stderr=${show(noKey.stderr)}`,
);
const mistypedRows = (await rowsAt(MISTYPED)) + (await transfersTo(MISTYPED)).length;
check('and none of those wrote anything', mistypedRows === 0, `rows=${mistypedRows}`);

// === 10. The credit and its transfer row are one act. ===
const nothing = await sr.rpc('wallet_mint', { mint_to: OTHER, mint_amount: 0 });
const otherRows = await rowsAt(OTHER);
check(
  'a mint of nothing is refused by the transfers table and leaves no balance row',
  nothing.error?.code === '23514' && otherRows === 0,
  `code=${nothing.error?.code ?? 'none'} rows=${otherRows}`,
);
const negative = await sr.rpc('wallet_mint', { mint_to: MINTED, mint_amount: -5 });
const afterNegative = await balanceOf(MINTED);
check(
  'a mint of a negative amount is refused and takes nothing from the balance',
  negative.error?.code === '23514' &&
    show(afterNegative.body) === show({ balance: 1000, nextSequence: 0 }),
  `code=${negative.error?.code ?? 'none'} body=${show(afterNegative.body)}`,
);

// === 11. What the transfers table itself refuses. ===
for (const [label, row] of [
  ['a transfer of nothing', { to_address: OTHER, amount: 0 }],
  ['a transfer past the largest exact number', { to_address: OTHER, amount: '9007199254740992' }],
  ['a destination that is not address-shaped', { to_address: 'coinbase', amount: 1 }],
  [
    'a sender that is not address-shaped',
    { from_address: 'coinbase', to_address: OTHER, amount: 1 },
  ],
  ['a transfer to the address it came from', { from_address: OTHER, to_address: OTHER, amount: 1 }],
] as const) {
  const { error } = await sr.from('wallet_transfers').insert(row);
  check(
    `the transfers table refuses ${label}`,
    error?.code === '23514',
    `code=${error?.code ?? 'none (the row was written)'}`,
  );
}

// === 12. Neither the mint nor the transfers are open to the anon key. ===
const anonMint = await anon.rpc('wallet_mint', { mint_to: OTHER, mint_amount: 500 });
const afterAnonMint = (await rowsAt(OTHER)) + (await transfersTo(OTHER)).length;
check(
  'a client holding only the anon key cannot mint',
  // Row security would stop the write too, under the same code; the message is what
  // says the function itself was closed.
  anonMint.error?.code === '42501' &&
    anonMint.error.message.includes('function wallet_mint') &&
    afterAnonMint === 0,
  `error=${anonMint.error?.message ?? 'none (it minted)'} rows=${afterAnonMint}`,
);
const peekedTransfers = await anon.from('wallet_transfers').select('id').eq('to_address', MINTED);
check(
  'and reads nothing off the transfers table',
  (peekedTransfers.data ?? []).length === 0,
  `rows=${peekedTransfers.data?.length ?? 0} error=${peekedTransfers.error?.message ?? 'none'}`,
);

await cleanup();
await sr.from('wallet_transfers').delete().eq('to_address', 'coinbase');
await sr.from('wallet_balances').delete().in('address', ['coinbase', REFUSED.toUpperCase()]);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
