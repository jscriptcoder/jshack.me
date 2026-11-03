// The operator's desk for contracts — stages a job for a handle, drops the one it holds,
// posts a board fresh offers, or shows what a contract number drew. Run against dev or local, never needed in play, as
// guardian.ts and valleynews.ts are. It cannot COMPLETE a job: a payout only ever goes
// through the real mail door, so every test of one goes through that door.
//
//   accept <handle> [--number N]  Accepts a job for the handle. Refuses a handle with no
//                                 mailbox, or one that already holds an active contract. A
//                                 number may be chosen (how a dev gets a contract with given
//                                 axes) or drawn free at random. Prints the address the
//                                 network now answers at.
//   drop <handle>                 Abandons the handle's active contract. The network stays
//                                 reachable (it is persistent and shared); the handle is free
//                                 to accept again. Refuses a handle with no active contract.
//   post <handle>                 Burns the handle's live offers and posts three fresh ones
//                                 now, past the board's 24-hour turnover, as a read of the
//                                 board would. A held contract keeps its slot, so a handle
//                                 working a job gets two. Prints each new offer's ref and
//                                 address (offers are not reachable until accepted).
//   show <address>                Prints the contract's template, route, forward, services,
//                                 key path and key. The key is derived from MISSION_KEY_SECRET,
//                                 so only an operator with the deployment secret can run it.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts accept alice
//   npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts accept alice --number 66051
//   npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts drop alice
//   npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts post alice
//   npx dotenv -e .env.development.local -- npx tsx scripts/hireme.ts show 195.1.2.3
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// (and MISSION_KEY_SECRET and JSHACK_SECRETS for `show`). Neither is printed; only what `show`
// derives from them: a contract's key and, on a leak route, its word.
//
// Exits 0 when done; 1 on a refusal (no mailbox, active contract, no active contract) or a
// database error; 2 on a bad order, a 195 address that names no contract, or missing env.

import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  acceptedLine,
  droppedLine,
  readMissionOrder,
  showReport,
} from '../src/core/missions/hiremeOrders.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionNumberForAddress,
} from '../src/core/missions/missionNetwork.js';
import { requireMissionSecret } from '../src/core/missions/missionSecret.js';

const order = readMissionOrder(process.argv.slice(2));
if (order === null) {
  console.error(
    'Usage: hireme.ts accept <handle> [--number N] | drop <handle> | post <handle> | show <address>',
  );
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

// Typed where declared, so the code after a call knows it never returns.
const fail: (label: string, error: { message: string }) => never = (label, error) => {
  console.error(`${label} failed: ${error.message}`);
  process.exit(1);
};

const refuse: (message: string) => never = (message) => {
  console.error(message);
  process.exit(1);
};

/** A contract number the missions table does not already hold, drawn at random — the whole
 *  24-bit host-octet space, so a collision with the handful of rows is vanishingly rare and
 *  retried on the off chance. */
const drawFreeNumber = async (): Promise<number> => {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = randomInt(0, 256) * 65536 + randomInt(0, 256) * 256 + randomInt(2, 255);
    const found = await sr
      .from('hireme_missions')
      .select('number')
      .eq('number', candidate)
      .maybeSingle();
    if (found.error) fail('drawing a contract number', found.error);
    if (found.data === null) return candidate;
  }
  return refuse('Could not draw a free contract number');
};

const accept = async (handle: string, chosen: number | null) => {
  const mailbox = await sr.from('email_accounts').select('handle').eq('handle', handle).maybeSingle();
  if (mailbox.error) fail('reading the mailbox', mailbox.error);
  if (mailbox.data === null) refuse(`${handle} has no mailbox; nothing accepted`);

  const active = await sr
    .from('hireme_missions')
    .select('number')
    .eq('handle', handle)
    .eq('state', 'accepted')
    .maybeSingle();
  if (active.error) fail('reading the active contract', active.error);
  if (active.data !== null) {
    refuse(`${handle} already holds an active contract; drop it first`);
  }

  let missionNumber: number;
  if (chosen === null) {
    missionNumber = await drawFreeNumber();
  } else {
    if (!isMissionNumber(chosen)) refuse(`${chosen} is not a contract number`);
    const taken = await sr
      .from('hireme_missions')
      .select('number')
      .eq('number', chosen)
      .maybeSingle();
    if (taken.error) fail('reading the contract number', taken.error);
    if (taken.data !== null) refuse(`contract ${chosen} is already held; nothing accepted`);
    missionNumber = chosen;
  }

  const inserted = await sr.from('hireme_missions').insert({
    number: missionNumber,
    handle,
    state: 'accepted',
    accepted_at: new Date().toISOString(),
  });
  if (inserted.error) fail('accepting the contract', inserted.error);
  // A valid contract number always writes an address.
  console.log(acceptedLine(handle, missionNumber, missionAddressForNumber(missionNumber)!));
};

const drop = async (handle: string) => {
  const active = await sr
    .from('hireme_missions')
    .select('number')
    .eq('handle', handle)
    .eq('state', 'accepted')
    .maybeSingle();
  if (active.error) fail('reading the active contract', active.error);
  if (active.data === null) refuse(`${handle} holds no active contract; nothing dropped`);
  const missionNumber = (active.data as { number: number }).number;

  const closed = await sr
    .from('hireme_missions')
    .update({ state: 'abandoned', closed_at: new Date().toISOString() })
    .eq('number', missionNumber);
  if (closed.error) fail('dropping the contract', closed.error);
  console.log(droppedLine(handle, missionNumber, missionAddressForNumber(missionNumber)!));
};

/** The offers a board holds once topped up, as the store answers them. */
type PostedBoard = { readonly offers: readonly { number: number; ref: string }[] };

const post = async (handle: string) => {
  const burned = await sr
    .from('hireme_missions')
    .update({ state: 'burned' })
    .eq('handle', handle)
    .eq('state', 'offered');
  if (burned.error) fail('burning the live offers', burned.error);

  const candidates = Array.from({ length: 3 }, () => ({
    number: randomInt(0, 256) * 65536 + randomInt(0, 256) * 256 + randomInt(2, 255),
    ref: randomInt(0x1000000).toString(16).padStart(6, '0'),
  }));
  const posted = await sr.rpc('hireme_post_offers', {
    post_handle: handle,
    candidate_numbers: candidates.map((candidate) => candidate.number),
    candidate_refs: candidates.map((candidate) => candidate.ref),
  });
  if (posted.error) fail('posting offers', posted.error);
  if (posted.data === null) refuse(`${handle} has no mailbox; nothing posted`);
  for (const offer of (posted.data as PostedBoard).offers) {
    console.log(`Offered ${handle} ref ${offer.ref}: ${missionAddressForNumber(offer.number)!}`);
  }
};

const show = (address: string) => {
  const missionNumber = missionNumberForAddress(address);
  if (missionNumber === null) {
    console.error(`${address} is not a contract address`);
    process.exit(2);
  }
  let secret: string;
  try {
    secret = requireMissionSecret(process.env.MISSION_KEY_SECRET);
  } catch {
    console.error('Missing env: MISSION_KEY_SECRET');
    return process.exit(2);
  }
  console.log(showReport(missionNumber, secret, process.env.JSHACK_SECRETS));
};

const main = async () => {
  if (order.verb === 'accept') await accept(order.handle, order.number);
  else if (order.verb === 'drop') await drop(order.handle);
  else if (order.verb === 'post') await post(order.handle);
  else show(order.address);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
