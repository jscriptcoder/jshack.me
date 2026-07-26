// Wire-payload smoke for Story-4 Slice 1 — server-authoritative cross-player su.
//
// The headline new behaviour: a SECOND identity (B), holding a guest cross-player
// ssh session on A's REGISTERED workstation, escalates to root by POSTing `suElevate`
// to /api/sessions with A's REAL root password. The server resolves A by machine_id,
// rebuilds A's box from the registry identity, validates md5(pw) against A's real
// /etc/passwd, and inserts a root-tier `kind:'su'` session row. Because L1's
// findActiveSession returns the TOP of the stack (latest active row), B's subsequent
// writes then authorize at ROOT — the SAME root-owned create that was 403 as guest
// now lands. A wrong password leaves B at guest; an unregistered machine is 404; a
// smuggled player_key is rejected before any lookup.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds A's registry row + B's guest session via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerSuElevate.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { md5 } from '../src/core/generation/md5';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;
const userTypeOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { userType?: string }).userType : undefined;

// --- Identities: A (owner), B (guest session on A who escalates). ---
const alice = generateIdentity();
const bob = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.78';
const ROOT_PW = 'alice-root-secret';
const ROOT_HASH = md5(ROOT_PW);
const GUEST_SESSION = `ssh-bob-${A_PUBLIC_IP}`;
const SU_SESSION = `su-bob-root-${A_PUBLIC_IP}`;
// A NEW file under root-only /etc — a create the containing dir gates to root only.
const IMPLANT = '/etc/implant';

const writeImplant = (signer: typeof alice) =>
  post(
    PATCHES,
    signRequest(signer, 'upsertPatch', {
      machine_id: A_MACHINE,
      path: IMPLANT,
      content: 'persistence',
      owner: 'root',
      is_new: true,
      node_type: 'file',
    }),
  );

const rowsAtImplant = async (): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('writer_key')
    .eq('machine_id', A_MACHINE)
    .eq('path', IMPLANT);
  return data?.length ?? 0;
};
const suRowsForBob = async (): Promise<readonly { credentials: { userType: string } }[]> => {
  const { data } = await sr
    .from('sessions')
    .select('credentials')
    .eq('player_key', bob.publicKeyHex)
    .eq('machine_id', A_MACHINE)
    .eq('kind', 'su')
    .is('ended_at', null);
  return (data ?? []) as readonly { credentials: { userType: string } }[];
};

// Clean slate, then seed A's registry row (as the join would) + B's active guest
// session on A (as the 2b cross-player ssh login would). The guest row is stamped
// in the PAST so the su row (inserted live by suElevate) is unambiguously the top
// of the stack that L1's findActiveSession returns.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
await sr.from('network_registry').insert({
  public_ip: A_PUBLIC_IP,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  router_machine_id: computeApGatewayId('BEAN-THERE-WIFI'),
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});
await sr.from('sessions').insert({
  session_id: GUEST_SESSION,
  player_key: bob.publicKeyHex,
  machine_id: A_MACHINE,
  credentials: { username: 'guest', userType: 'guest' },
  kind: 'ssh',
  essid: 'BEAN-THERE-WIFI',
  created_at: '2020-01-01T00:00:00.000Z',
});

// 1. Baseline: B (guest) creating a root-only path on A → 403, no row. Proves the
//    write is genuinely tier-gated — the elevation in step 4 is what changes it.
const w1 = await writeImplant(bob);
check(
  'B (guest) denied creating /etc/implant on A’s box → 403, no row',
  w1.status === 403 && errorOf(w1.body) === 'permission_denied' && (await rowsAtImplant()) === 0,
  `status=${w1.status} error=${errorOf(w1.body)} rows=${await rowsAtImplant()}`,
);

// 2. Wrong password → 401 invalid_credentials, NO su row inserted.
const e2 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: SU_SESSION,
    machine_id: A_MACHINE,
    username: 'root',
    from_user: 'guest',
    password: 'not-the-root-pw',
    parent_session_id: GUEST_SESSION,
    source_ip: null,
  }),
);
check(
  'B suElevate with WRONG password → 401, no su row',
  e2.status === 401 &&
    errorOf(e2.body) === 'invalid_credentials' &&
    (await suRowsForBob()).length === 0,
  `status=${e2.status} error=${errorOf(e2.body)} suRows=${(await suRowsForBob()).length}`,
);

// 3. After a failed elevation B is still guest → the root-only create is still 403.
const w3 = await writeImplant(bob);
check(
  'after wrong-pw, B is still guest → /etc/implant still 403',
  w3.status === 403 && errorOf(w3.body) === 'permission_denied',
  `status=${w3.status} error=${errorOf(w3.body)}`,
);

// 4. Correct password → 200 { userType:'root' }, exactly one root-tier su row for (B,A).
const e4 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: SU_SESSION,
    machine_id: A_MACHINE,
    username: 'root',
    from_user: 'guest',
    password: ROOT_PW,
    parent_session_id: GUEST_SESSION,
    source_ip: null,
  }),
);
const suRows4 = await suRowsForBob();
check(
  'B suElevate with A’s root password → 200 userType=root, one root su row inserted',
  e4.status === 200 &&
    userTypeOf(e4.body) === 'root' &&
    suRows4.length === 1 &&
    suRows4[0]?.credentials.userType === 'root',
  `status=${e4.status} userType=${userTypeOf(e4.body)} suRows=${suRows4.length}`,
);

// 5. THE PAYOFF: the SAME root-only create now lands (L1 returns the su row → root
//    tier → L2 allows), attributed to B on A's journal.
const w5 = await writeImplant(bob);
const { data: rows5 } = await sr
  .from('patches')
  .select('writer_key, content')
  .eq('machine_id', A_MACHINE)
  .eq('path', IMPLANT);
const bRow5 = (rows5 ?? []).find((row) => row.writer_key === bob.publicKeyHex);
check(
  'as root, B creates /etc/implant on A’s box → 200, row attributed to B',
  w5.status === 200 && rows5?.length === 1 && bRow5?.content === 'persistence',
  `status=${w5.status} rows=${rows5?.length} writer=${bRow5 ? 'B' : '-'}`,
);

// 6. Unregistered machine id → 404 host_unreachable, no su row for that machine.
const e6 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: 'su-bob-ghost',
    machine_id: 'ghost-00000000',
    username: 'root',
    from_user: 'guest',
    password: ROOT_PW,
    parent_session_id: GUEST_SESSION,
    source_ip: null,
  }),
);
check(
  'B suElevate against an unregistered machine → 404 host_unreachable',
  e6.status === 404 && errorOf(e6.body) === 'host_unreachable',
  `status=${e6.status} error=${errorOf(e6.body)}`,
);

// 7. Smuggled client player_key → 400, rejected before any lookup/insert.
const e7 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: 'su-bob-smuggle',
    machine_id: A_MACHINE,
    username: 'root',
    from_user: 'guest',
    password: ROOT_PW,
    parent_session_id: GUEST_SESSION,
    source_ip: null,
    player_key: 'attacker',
  }),
);
check(
  'B suElevate smuggling a client player_key → 400 (server stamps it)',
  e7.status === 400,
  `status=${e7.status} error=${errorOf(e7.body) ?? '-'}`,
);

// Cleanup.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
