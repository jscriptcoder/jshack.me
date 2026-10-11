// Wire-payload smoke for the LEDGER — what an address holds, read by anybody, how coins
// come to exist, how they move, and what an address has sent and received. Drives the REAL /api/wallet endpoint against a running
// `vercel dev` + supabase, writes the rows it reads back straight into `wallet_balances`
// through the service role, mints with the operator's `scripts/mintCoins.ts`, run as a
// child process exactly as the operator runs it, and sends transfers signed the way the
// game's own client signs them.
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
//   - THE TRANSFER. A signed transfer moves the amount from the address of the key that
//     signed it, raises that address's sequence number by one, creates a destination the
//     ledger has never seen, and records one transfer row naming both addresses.
//   - A balance that does not cover the amount moves nothing, and one that covers it
//     exactly is emptied. An address with no row holds nothing to send.
//   - A sequence number that is not the sender's next one moves nothing, whichever side
//     it is wrong on, and is judged before the balance.
//   - The same signed transfer sent twice moves the coins once. Of two transfers signed at
//     one sequence and sent together, exactly one lands: through the endpoint, and through
//     the function called twice at once. Two wallets paying each other at once both land.
//   - A destination that can hold no more refuses the credit and the sender keeps the coins.
//   - A forged or stale signature, a transfer to its own address and a malformed one are
//     turned away by the endpoint and move nothing.
//   - The debit, the credit and the transfer row are one act, and the function is closed
//     to a client holding only the anon key.
//   - Every balance the transfers touched adds up to what was minted, throughout.
//   - THE HISTORY. An address's history is every transfer it sent or received and no
//     other, newest first, which is what proves the filter and the ordering the endpoint
//     asks the table for. A mint comes back with no sender, and each transfer carries the
//     moment it was made, in UTC.
//   - The same transfer shows on both sides, and the largest amount comes back digit for
//     digit.
//   - An address with 21 transfers is shown the latest 20 and no sign of the first.
//   - An address the ledger has never seen has an empty history, and asking leaves no row.
//   - Text that is not address-shaped is a 400 here too, the mint's label included.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testWallet.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { sign } from '../src/core/identity/identity.js';
import { bytesToHex, hexToBytes } from '../src/core/identity/hex.js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateWalletKey, signerOf, type WalletKey } from '../src/core/wallet/walletKey.js';

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

// The wallets that send, and the addresses they send to. Everything these hold comes
// from a mint, so what they add up to is known at every step.
const PAYER = generateWalletKey();
const PAUPER = generateWalletKey();
const RACER = generateWalletKey();
const CROSS_A = generateWalletKey();
const CROSS_B = generateWalletKey();
const PAYEE = generateWalletKey().address;
const THIRD = generateWalletKey().address;
const NOWHERE = generateWalletKey().address;
const BRIM = generateWalletKey().address;

// Two addresses only the history checks use: one with more to tell than a history
// holds, and one with nothing.
const BUSY = generateWalletKey().address;
const QUIET = generateWalletKey().address;

const LEDGER = [
  PAYER.address,
  PAUPER.address,
  RACER.address,
  CROSS_A.address,
  CROSS_B.address,
  PAYEE,
  THIRD,
  NOWHERE,
  BRIM,
];

const EVERY_ADDRESS = [
  UNSEEN,
  HELD,
  FULL,
  REFUSED,
  MINTED,
  NEARLY_FULL,
  MISTYPED,
  OTHER,
  BUSY,
  QUIET,
  ...LEDGER,
];

const cleanup = async () => {
  await sr.from('wallet_transfers').delete().in('to_address', EVERY_ADDRESS);
  await sr.from('wallet_transfers').delete().in('from_address', EVERY_ADDRESS);
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

// === 13. A wallet sends. ===
let minted = 0n;
const fund = async (address: string, amount: number) => {
  const { error } = await sr.rpc('wallet_mint', { mint_to: address, mint_amount: amount });
  if (error === null) minted += BigInt(amount);
  return error;
};

/** What the game's client posts for a transfer: the envelope its own signer makes. */
const transferOf = (wallet: WalletKey, to: string, amount: number, sequence: number) =>
  signRequest(signerOf(wallet.keyHex), 'transfer', { to, amount, sequence });

const transfer = (wallet: WalletKey, to: string, amount: number, sequence: number) =>
  send('POST', transferOf(wallet, to, amount, sequence));

/** An envelope around any payload at all, signed by `wallet`: for what the client's
 *  own signer would never produce. */
const signedBy = (wallet: WalletKey, payload: unknown) => {
  const text = JSON.stringify(payload);
  const key = hexToBytes(wallet.keyHex);
  if (key === null) throw new Error('a wallet key that is not hex');
  return {
    payload: text,
    publicKey: signerOf(wallet.keyHex).publicKeyHex,
    signature: bytesToHex(sign(key, new TextEncoder().encode(text))),
  };
};

const reads = async (address: string, balance: number, nextSequence: number) => {
  const { body } = await balanceOf(address);
  return { as: show(body), right: show(body) === show({ balance, nextSequence }) };
};

const transfersFrom = async (address: string) => {
  const { data } = await sr
    .from('wallet_transfers')
    .select('to_address, amount')
    .eq('from_address', address)
    .order('id');
  return data ?? [];
};

/** What every address the transfers touch holds, added up. Whole coins past the largest
 *  exact number need more than a number to add. */
const heldInAll = async (): Promise<bigint> => {
  const { data } = await sr.from('wallet_balances').select('balance').in('address', LEDGER);
  return (data ?? []).reduce((sum, row) => sum + BigInt(row.balance as number), 0n);
};

const refusedAs = (
  answer: { readonly status: number; readonly body: unknown },
  status: number,
  error: string,
) => answer.status === status && errorOf(answer.body) === error;

const funded = await fund(PAYER.address, 500);
const sent200 = await transfer(PAYER, PAYEE, 200, 0);
const payerAfter200 = await reads(PAYER.address, 300, 1);
const payeeAfter200 = await reads(PAYEE, 200, 0);
check(
  'a signed transfer of 200 from an address holding 500 is made',
  funded === null && sent200.status === 200 && show(sent200.body) === show({ ok: true }),
  `mint=${funded?.message ?? 'ok'} status=${sent200.status} body=${show(sent200.body)}`,
);
check(
  'it leaves 300 at the sender and raises its sequence number by one',
  payerAfter200.right,
  `sender=${payerAfter200.as}`,
);
check(
  'it creates a destination the ledger had never seen, holding 200 at sequence 0',
  payeeAfter200.right,
  `destination=${payeeAfter200.as}`,
);
const firstRows = await transfersFrom(PAYER.address);
check(
  'it records one transfer row naming both addresses',
  show(firstRows) === show([{ to_address: PAYEE, amount: 200 }]),
  `rows=${show(firstRows)}`,
);
const heldAfterFirst = await heldInAll();
check(
  'what the addresses hold still adds up to what was minted',
  heldAfterFirst === minted,
  `held=${heldAfterFirst} minted=${minted}`,
);

// === 14. A balance that does not cover the amount. ===
const tooDear = await transfer(PAYER, PAYEE, 301, 1);
const payerAfterTooDear = await reads(PAYER.address, 300, 1);
const rowsAfterTooDear = (await transfersFrom(PAYER.address)).length;
check(
  'one coin more than the sender holds is a 409 insufficient_balance',
  refusedAs(tooDear, 409, 'insufficient_balance'),
  `status=${tooDear.status} body=${show(tooDear.body)}`,
);
check(
  'and it moves nothing, records nothing, and leaves the sequence number alone',
  payerAfterTooDear.right && rowsAfterTooDear === 1,
  `sender=${payerAfterTooDear.as} rows=${rowsAfterTooDear}`,
);
const everything = await transfer(PAYER, PAYEE, 300, 1);
const payerEmptied = await reads(PAYER.address, 0, 2);
const payeeAfterAll = await reads(PAYEE, 500, 0);
check(
  'exactly what the sender holds is taken, and empties it',
  everything.status === 200 && payerEmptied.right && payeeAfterAll.right,
  `status=${everything.status} sender=${payerEmptied.as} destination=${payeeAfterAll.as}`,
);
const fromNothing = await transfer(PAUPER, NOWHERE, 1, 0);
const pauperRows = (await rowsAt(PAUPER.address)) + (await rowsAt(NOWHERE));
check(
  'an address with no row holds nothing to send, and neither end gains a row',
  refusedAs(fromNothing, 409, 'insufficient_balance') && pauperRows === 0,
  `status=${fromNothing.status} body=${show(fromNothing.body)} rows=${pauperRows}`,
);

// === 15. A sequence number that is not the sender's next one. ===
await fund(PAYER.address, 1000);
for (const [label, sequence, amount] of [
  ['one the sender has already used', 1, 100],
  ['one the sender has not reached', 3, 100],
  ['a used one, on an amount the sender could not cover either', 1, 5000],
] as const) {
  const stale = await transfer(PAYER, PAYEE, amount, sequence);
  check(
    `${label} is a 409 stale_sequence`,
    refusedAs(stale, 409, 'stale_sequence'),
    `status=${stale.status} body=${show(stale.body)}`,
  );
}
const payerAfterStale = await reads(PAYER.address, 1000, 2);
check('and none of those moved anything', payerAfterStale.right, `sender=${payerAfterStale.as}`);

// === 16. The same signed transfer, sent twice. ===
const once = transferOf(PAYER, PAYEE, 100, 2);
const firstTime = await send('POST', once);
const secondTime = await send('POST', once);
const payerAfterReplay = await reads(PAYER.address, 900, 3);
const payeeAfterReplay = await reads(PAYEE, 600, 0);
check(
  'the first is made and the second is a 409 stale_sequence',
  firstTime.status === 200 && refusedAs(secondTime, 409, 'stale_sequence'),
  `first=${firstTime.status} second=${secondTime.status} ${show(secondTime.body)}`,
);
check(
  'and the coins moved once',
  payerAfterReplay.right && payeeAfterReplay.right,
  `sender=${payerAfterReplay.as} destination=${payeeAfterReplay.as}`,
);

// === 17. Two transfers signed at one sequence, sent together. ===
const ROUNDS = 5;
await fund(RACER.address, 1000);
const racedOverTheWire: string[] = [];
for (let round = 0; round < ROUNDS; round++) {
  const pair = await Promise.all([
    transfer(RACER, PAYEE, 50, round),
    transfer(RACER, THIRD, 50, round),
  ]);
  racedOverTheWire.push(
    pair
      .map((answer) =>
        answer.status === 200 ? 'moved' : `${answer.status} ${errorOf(answer.body)}`,
      )
      .sort()
      .join(' + '),
  );
}
check(
  'through the endpoint, exactly one of each pair lands and the other is stale',
  racedOverTheWire.every((outcome) => outcome === '409 stale_sequence + moved'),
  `rounds=${show(racedOverTheWire)}`,
);
const racedInTheLedger: string[] = [];
for (let round = ROUNDS; round < ROUNDS * 2; round++) {
  const order = { transfer_from: RACER.address, transfer_amount: 50, transfer_sequence: round };
  const pair = await Promise.all([
    sr.rpc('wallet_transfer', { ...order, transfer_to: PAYEE }),
    sr.rpc('wallet_transfer', { ...order, transfer_to: THIRD }),
  ]);
  racedInTheLedger.push(
    pair
      .map((answer) => String(answer.error?.code ?? answer.data))
      .sort()
      .join(' + '),
  );
}
check(
  'and the same when the function itself is called twice at once',
  racedInTheLedger.every((outcome) => outcome === 'moved + stale_sequence'),
  `rounds=${show(racedInTheLedger)}`,
);
const racerAfter = await reads(RACER.address, 1000 - 50 * ROUNDS * 2, ROUNDS * 2);
check(
  'the racing wallet paid once a round and its sequence number rose once a round',
  racerAfter.right,
  `racer=${racerAfter.as}`,
);
await fund(CROSS_A.address, 100);
await fund(CROSS_B.address, 100);
const crossed: number[] = [];
for (let round = 0; round < ROUNDS; round++) {
  const pair = await Promise.all([
    transfer(CROSS_A, CROSS_B.address, 10, round),
    transfer(CROSS_B, CROSS_A.address, 10, round),
  ]);
  crossed.push(...pair.map((answer) => answer.status));
}
const crossAAfter = await reads(CROSS_A.address, 100, ROUNDS);
const crossBAfter = await reads(CROSS_B.address, 100, ROUNDS);
check(
  'two wallets paying each other at once both land, every round',
  crossed.every((status) => status === 200) && crossAAfter.right && crossBAfter.right,
  `statuses=${show(crossed)} a=${crossAAfter.as} b=${crossBAfter.as}`,
);
const heldAfterRaces = await heldInAll();
check(
  'and after all of it the addresses still hold exactly what was minted',
  heldAfterRaces === minted,
  `held=${heldAfterRaces} minted=${minted}`,
);

// === 18. A destination that can hold no more. ===
await fund(BRIM, LARGEST - 100);
const overflowing = await transfer(PAYER, BRIM, 101, 3);
const payerAfterOverflow = await reads(PAYER.address, 900, 3);
const brimAfterOverflow = await reads(BRIM, LARGEST - 100, 0);
check(
  'a credit that would pass the largest balance is a 409 destination_full',
  refusedAs(overflowing, 409, 'destination_full'),
  `status=${overflowing.status} body=${show(overflowing.body)}`,
);
check(
  'and the sender keeps the coins and its sequence number',
  payerAfterOverflow.right && brimAfterOverflow.right,
  `sender=${payerAfterOverflow.as} destination=${brimAfterOverflow.as}`,
);
const topsUp = await transfer(PAYER, BRIM, 100, 3);
const brimFull = await reads(BRIM, LARGEST, 0);
check(
  'a credit that lands exactly on the largest balance is taken',
  topsUp.status === 200 && brimFull.right,
  `status=${topsUp.status} destination=${brimFull.as}`,
);

// === 19. What the endpoint turns away before the ledger. ===
const honest = transferOf(PAYER, PAYEE, 100, 4);
const signedFields = (overrides: Readonly<Record<string, unknown>>) =>
  signedBy(PAYER, { ...(JSON.parse(honest.payload) as object), ...overrides });
for (const [label, envelope, status, error] of [
  [
    'a transfer whose amount was changed after it was signed',
    { ...honest, payload: honest.payload.replace('"amount":100', '"amount":800') },
    401,
    'signature_invalid',
  ],
  [
    'a transfer signed by another wallet under this one’s public key',
    { ...signedBy(RACER, JSON.parse(honest.payload)), publicKey: honest.publicKey },
    401,
    'signature_invalid',
  ],
  [
    'a transfer signed three minutes ago',
    signedFields({ ts: Date.now() - 180_000 }),
    401,
    'timestamp_skew',
  ],
  [
    'a transfer to the address it comes from',
    signedFields({ to: PAYER.address }),
    400,
    'self_transfer',
  ],
  ['a transfer of nothing', signedFields({ amount: 0 }), 400, 'payload_invalid'],
  ['a transfer of half a coin', signedFields({ amount: 0.5 }), 400, 'payload_invalid'],
  ['a transfer to the mint label', signedFields({ to: 'coinbase' }), 400, 'payload_invalid'],
  ['a signed read of a balance', signedFields({ action: 'balance' }), 400, 'payload_invalid'],
  [
    'a transfer nobody signed',
    { action: 'transfer', to: PAYEE, amount: 100, sequence: 4 },
    400,
    'unknown_action',
  ],
] as const) {
  const turnedAway = await send('POST', envelope);
  check(
    `${label} is a ${status} ${error}`,
    refusedAs(turnedAway, status, error),
    `status=${turnedAway.status} body=${show(turnedAway.body)}`,
  );
}
const payerAfterRefusals = await reads(PAYER.address, 800, 4);
check(
  'and none of those moved anything',
  payerAfterRefusals.right,
  `sender=${payerAfterRefusals.as}`,
);

// === 20. The debit, the credit and the transfer row are one act. ===
const ofNothing = await sr.rpc('wallet_transfer', {
  transfer_from: PAYER.address,
  transfer_to: PAYEE,
  transfer_amount: 0,
  transfer_sequence: 4,
});
const toItself = await sr.rpc('wallet_transfer', {
  transfer_from: PAYER.address,
  transfer_to: PAYER.address,
  transfer_amount: 100,
  transfer_sequence: 4,
});
const payerAfterUndone = await reads(PAYER.address, 800, 4);
check(
  'a transfer row the table refuses takes the debit and the sequence number back with it',
  ofNothing.error?.code === '23514' && toItself.error?.code === '23514' && payerAfterUndone.right,
  `nothing=${ofNothing.error?.code ?? show(ofNothing.data)} itself=${toItself.error?.code ?? show(toItself.data)} sender=${payerAfterUndone.as}`,
);
const unnumbered = await sr.rpc('wallet_transfer', {
  transfer_from: PAYER.address,
  transfer_to: PAYEE,
  transfer_amount: 100,
  transfer_sequence: null,
});
const payerAfterUnnumbered = await reads(PAYER.address, 800, 4);
check(
  'a transfer with no sequence number answers nothing and moves nothing',
  unnumbered.error === null && unnumbered.data === null && payerAfterUnnumbered.right,
  `error=${unnumbered.error?.message ?? 'none'} data=${show(unnumbered.data)} sender=${payerAfterUnnumbered.as}`,
);
const anonTransfer = await anon.rpc('wallet_transfer', {
  transfer_from: PAYER.address,
  transfer_to: PAYEE,
  transfer_amount: 100,
  transfer_sequence: 4,
});
const payerAfterAnon = await reads(PAYER.address, 800, 4);
check(
  'a client holding only the anon key cannot move coins',
  anonTransfer.error?.code === '42501' &&
    anonTransfer.error.message.includes('function wallet_transfer') &&
    payerAfterAnon.right,
  `error=${anonTransfer.error?.message ?? 'none (it moved)'} sender=${payerAfterAnon.as}`,
);

// === 21. Everything the sender did, and what it all adds up to. ===
const payerRows = await transfersFrom(PAYER.address);
check(
  'the sender’s transfers are the four that were made, in order, and no other',
  show(payerRows) ===
    show([
      { to_address: PAYEE, amount: 200 },
      { to_address: PAYEE, amount: 300 },
      { to_address: PAYEE, amount: 100 },
      { to_address: BRIM, amount: 100 },
    ]),
  `rows=${show(payerRows)}`,
);
const heldAtTheEnd = await heldInAll();
check(
  'what the addresses hold adds up to what was minted, to the coin',
  heldAtTheEnd === minted,
  `held=${heldAtTheEnd} minted=${minted}`,
);

// === 22. What an address has sent and received. ===
const historyOf = (address: unknown) => send('POST', { action: 'history', address });

type Listed = {
  readonly from: string | null;
  readonly to: string;
  readonly amount: number;
  readonly at: string;
};

const listedIn = (body: unknown): readonly Listed[] => {
  const transfers =
    typeof body === 'object' && body !== null ? (body as { transfers?: unknown }).transfers : null;
  return Array.isArray(transfers) ? (transfers as Listed[]) : [];
};

/** Who and how many, without the moment: the part of a history a run can predict. */
const movesIn = (body: unknown) =>
  listedIn(body).map(({ from, to, amount }) => ({ from, to, amount }));

const payerHistory = await historyOf(PAYER.address);
check(
  'an address’s history is everything it sent and received, newest first, and nothing else',
  payerHistory.status === 200 &&
    show(movesIn(payerHistory.body)) ===
      show([
        { from: PAYER.address, to: BRIM, amount: 100 },
        { from: PAYER.address, to: PAYEE, amount: 100 },
        { from: null, to: PAYER.address, amount: 1000 },
        { from: PAYER.address, to: PAYEE, amount: 300 },
        { from: PAYER.address, to: PAYEE, amount: 200 },
        { from: null, to: PAYER.address, amount: 500 },
      ]),
  `status=${payerHistory.status} moves=${show(movesIn(payerHistory.body))}`,
);

const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const QUARTER_HOUR_MS = 15 * 60_000;
const payerListed = listedIn(payerHistory.body);
const stamps = payerListed.map((listed) => listed.at);
check(
  'each transfer carries the moment it was made, in UTC, and the list runs back in time',
  stamps.length === 6 &&
    stamps.every(
      (at) => UTC_STAMP.test(at) && Math.abs(Date.now() - Date.parse(at)) < QUARTER_HOUR_MS,
    ) &&
    stamps.every((at, index) => index === 0 || (stamps[index - 1] ?? '') >= at),
  `now=${new Date().toISOString()} stamps=${show(stamps)}`,
);
check(
  'a transfer is told as who, how many and when, and nothing else of its row',
  show(Object.keys(payerHistory.body ?? {})) === show(['transfers']) &&
    payerListed.every(
      (listed) => show(Object.keys(listed).sort()) === show(['amount', 'at', 'from', 'to']),
    ),
  `answer=${show(Object.keys(payerHistory.body ?? {}))} transfer=${show(Object.keys(payerListed[0] ?? {}))}`,
);

const mintedHistory = await historyOf(MINTED);
check(
  'a mint comes back with no sender',
  show(movesIn(mintedHistory.body)) ===
    show([
      { from: null, to: MINTED, amount: 500 },
      { from: null, to: MINTED, amount: 500 },
    ]),
  `moves=${show(movesIn(mintedHistory.body))}`,
);

const brimHistory = await historyOf(BRIM);
check(
  'the same transfer shows at the address it reached, under the largest mint, digit for digit',
  show(movesIn(brimHistory.body)) ===
    show([
      { from: PAYER.address, to: BRIM, amount: 100 },
      { from: null, to: BRIM, amount: LARGEST - 100 },
    ]),
  `moves=${show(movesIn(brimHistory.body))}`,
);

for (let coins = 1; coins <= 21; coins += 1) {
  await sr.rpc('wallet_mint', { mint_to: BUSY, mint_amount: coins });
}
const busyHistory = await historyOf(BUSY);
const busyAmounts = listedIn(busyHistory.body).map((listed) => listed.amount);
check(
  'an address with 21 transfers is shown the latest 20, newest first, and no sign of the first',
  busyHistory.status === 200 &&
    show(busyAmounts) === show(Array.from({ length: 20 }, (_unused, index) => 21 - index)) &&
    show(Object.keys(busyHistory.body ?? {})) === show(['transfers']),
  `status=${busyHistory.status} amounts=${show(busyAmounts)}`,
);

const quietHistory = await historyOf(QUIET);
const quietRows = (await rowsAt(QUIET)) + (await transfersTo(QUIET)).length;
check(
  'an address the ledger has never seen has an empty history, and asking leaves no row',
  quietHistory.status === 200 &&
    show(quietHistory.body) === show({ transfers: [] }) &&
    quietRows === 0,
  `status=${quietHistory.status} body=${show(quietHistory.body)} rows=${quietRows}`,
);

for (const [label, address] of [
  ['the mint’s label', 'coinbase'],
  ['an address in upper case', BUSY.toUpperCase()],
  ['an address one character short', BUSY.slice(0, -1)],
  ['no address at all', undefined],
] as const) {
  const turnedAway = await historyOf(address);
  check(
    `a history of ${label} is a 400 invalid_address`,
    refusedAs(turnedAway, 400, 'invalid_address'),
    `status=${turnedAway.status} body=${show(turnedAway.body)}`,
  );
}

await cleanup();
await sr.from('wallet_transfers').delete().eq('to_address', 'coinbase');
await sr.from('wallet_balances').delete().in('address', ['coinbase', REFUSED.toUpperCase()]);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
