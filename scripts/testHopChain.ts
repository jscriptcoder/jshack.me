// Wire-check — a chain of hops masks where an attack comes from, and a defender can walk
// it back one hop at a time until a root wipe cuts the trail.
//
// B sits at home and builds a chain by hand, one login per leg, each leg run FROM the box
// the last one landed on (it names that box as `caller_machine_id`, as `ssh` in a remote
// shell does):
//
//   home → P's gateway → Q's gateway → R's gateway
//
// Each gateway's auth.log must name the network the login came FROM — R names Q, Q names
// P, P names B's home — so reading a log, looking the address up in the world (what
// `whois` does) and repeating walks back to B. Then B, holding root on Q, wipes Q's
// auth.log: R still names Q, but Q now names nobody, and a later login on Q does not bring
// the wiped line back. The trail ends at Q.
//
// A caller cannot borrow a hop: naming a box they hold no session on is refused.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopChain.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs.js';
import { networkAt } from '../src/core/generation/world.js';
import { orderPatchesForReplay } from '../src/core/patches/orderPatchesForReplay.js';
import { publicAddressOf } from './publicAddressOf.js';
import { standOnNetwork } from './standVantage.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (
  endpoint: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const AUTH_LOG = '/var/log/auth.log';
const ROOT_RW = { read: ['root'], write: ['root'], execute: [] };

type Identity = ReturnType<typeof generateIdentity>;

/** One network in the chain: its gateway, the address it answers at, and its root
 *  password. */
const hopOn = (essid: string) => ({
  essid,
  gateway: computeApGatewayId(essid),
  publicIp: publicAddressOf(essid),
  adminPw: seedApGatewayAdminPw(essid),
});

const HOME = 'SMART-FRIDGE-NET';
const CAROL_HOME = 'UPSTAIRS-NEIGHBOR';
const P = hopOn('NAKATOMI-PLAZA');
const Q = hopOn('OSCORP-GUEST');
const R = hopOn('TYRELL-CORP');
const HOPS = [P, Q, R];

const bob = generateIdentity();
const carol = generateIdentity();
const BOB_WS = computeWorkstationId('rig', bob.publicKeyHex);
const CAROL_WS = computeWorkstationId('rig', carol.publicKeyHex);

// The gateways are ESSID-seeded, so their machine ids are the same on every run: clean
// them at SETUP, or a previous run's lines answer this run's assertions.
for (const hop of HOPS) {
  await sr.from('patches').delete().eq('machine_id', hop.gateway);
}
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await standOnNetwork(sr, HOME, bob, 31);
await standOnNetwork(sr, CAROL_HOME, carol, 32);

/** A root login on `hop`'s gateway, run from the box `from` names. */
const login = (
  actor: Identity,
  hop: ReturnType<typeof hopOn>,
  leg: { readonly sessionId: string; readonly from: string; readonly parent: string | null },
  password = hop.adminPw,
) =>
  post(
    SESSIONS,
    signRequest(actor, 'authCreateSessionPublic', {
      session_id: leg.sessionId,
      target: hop.publicIp,
      username: 'root',
      password,
      port: 22,
      parent_session_id: leg.parent,
      caller_machine_id: leg.from,
    }),
  );

type ListedRow = {
  readonly path: string;
  readonly content: string | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

/** The auth.log a defender holding a shell on the box reads: every writer's row for the
 *  path, replayed in order, the last one winning. `null` = absent. */
const readAuthLog = async (machineId: string): Promise<string | null> => {
  const listed = await post(PATCHES, signRequest(bob, 'listPatches', { machine_id: machineId }));
  const rows = ((listed.body as { patches?: ListedRow[] } | null)?.patches ?? []).filter(
    (row) => row.path === AUTH_LOG,
  );
  return orderPatchesForReplay(rows).at(-1)?.content ?? null;
};

/** The address the last accepted root login on a box came from, as a defender reads it. */
const lastRootLoginFrom = (log: string | null): string | null => {
  const accepted = (log ?? '')
    .split('\n')
    .filter((line) => line.includes('Accepted password for root from '));
  const match = accepted.at(-1)?.match(/Accepted password for root from (\S+)/);
  return match?.[1] ?? null;
};

/** Walk the trail back from `start`: read who logged in, look the address up in the
 *  world, and move to that network's gateway if it is one of the chain's. Stops at a box
 *  whose log names nobody, or at a network outside the chain. */
const walkBack = async (start: ReturnType<typeof hopOn>): Promise<string[]> => {
  const trail: string[] = [];
  let current: ReturnType<typeof hopOn> | undefined = start;
  while (current !== undefined) {
    const from = lastRootLoginFrom(await readAuthLog(current.gateway));
    const network = from === null ? undefined : networkAt(from);
    if (network === undefined) break;
    trail.push(network);
    current = HOPS.find((hop) => hop.essid === network);
  }
  return trail;
};

// === 1. B builds the chain, each leg run from where the last one landed. ===
const legP = await login(bob, P, { sessionId: 'ssh-chain-p', from: BOB_WS, parent: null });
check('B at home reaches P’s gateway', legP.status === 200, `status=${legP.status}`);
const legQ = await login(bob, Q, {
  sessionId: 'ssh-chain-q',
  from: P.gateway,
  parent: 'ssh-chain-p',
});
check('B, standing on P’s gateway, reaches Q’s', legQ.status === 200, `status=${legQ.status}`);
const legR = await login(bob, R, {
  sessionId: 'ssh-chain-r',
  from: Q.gateway,
  parent: 'ssh-chain-q',
});
check('B, standing on Q’s gateway, reaches R’s', legR.status === 200, `status=${legR.status}`);

// === 2. Each log names the network the login came from. ===
const homeIp = publicAddressOf(HOME);
const fromOnP = lastRootLoginFrom(await readAuthLog(P.gateway));
check('P’s auth.log names B’s home', fromOnP === homeIp, `from=${fromOnP} want=${homeIp}`);
const fromOnQ = lastRootLoginFrom(await readAuthLog(Q.gateway));
check('Q’s auth.log names P, not B', fromOnQ === P.publicIp, `from=${fromOnQ} want=${P.publicIp}`);
const fromOnR = lastRootLoginFrom(await readAuthLog(R.gateway));
check('R’s auth.log names Q, not B', fromOnR === Q.publicIp, `from=${fromOnR} want=${Q.publicIp}`);

// === 3. Log → whois → next hop walks back to B, one hop at a time. ===
const trail = await walkBack(R);
check(
  'the trail from R walks back Q → P → B’s home',
  JSON.stringify(trail) === JSON.stringify([Q.essid, P.essid, HOME]),
  trail.join(' → '),
);

// === 4. A hop cannot be borrowed: Carol holds no session on Q’s gateway. ===
const borrowed = await login(carol, R, {
  sessionId: 'ssh-borrow-r',
  from: Q.gateway,
  parent: null,
});
check(
  'naming a box the caller holds no session on is refused',
  borrowed.status === 403 && (borrowed.body as { error?: string } | null)?.error === 'no_session',
  `status=${borrowed.status} body=${JSON.stringify(borrowed.body)}`,
);

// === 5. B, root on Q, wipes Q’s auth.log; a later login does not bring it back. ===
const wipe = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: Q.gateway,
    path: AUTH_LOG,
    content: '',
    owner: 'root',
    permissions: ROOT_RW,
    node_type: 'file',
  }),
);
check('B (root on Q) may wipe Q’s auth.log', wipe.status === 200, `status=${wipe.status}`);
const later = await login(
  carol,
  Q,
  { sessionId: 'ssh-later-q', from: CAROL_WS, parent: null },
  'not-the-password',
);
check('a later stranger’s login on Q is refused', later.status === 401, `status=${later.status}`);
const qAfter = await readAuthLog(Q.gateway);
check(
  'the wipe sticks: Q’s log no longer names P',
  qAfter !== null && !qAfter.includes(P.publicIp) && qAfter.includes(publicAddressOf(CAROL_HOME)),
  JSON.stringify(qAfter),
);
const cutTrail = await walkBack(R);
check(
  'the trail from R now ends at Q',
  JSON.stringify(cutTrail) === JSON.stringify([Q.essid]),
  cutTrail.join(' → '),
);

// Teardown — the gateways' rows and both players' state.
for (const hop of HOPS) {
  await sr.from('patches').delete().eq('machine_id', hop.gateway);
}
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', id.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
