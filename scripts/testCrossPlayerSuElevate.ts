// Wire-payload smoke for `su` on a box that is not the caller's own.
//
// A caller holding a shell on somebody else's box POSTs `suElevate` to /api/sessions.
// The server starts from the caller's own session row on that machine: the network on
// it says which box this is (another player's workstation, the access point's gateway,
// or a machine the network generates), the box is read as its journal leaves it, and
// the typed password is checked against its `/etc/passwd`. A match inserts a
// `kind:'su'` session row at the account's tier. Because the write gate reads the
// latest live row, the caller's writes are then judged at that tier — the SAME
// root-owned create that was 403 as guest now lands.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Another player's workstation: wrong password 401 and no row; right password 200,
//     one `root` row on the network the shell under it was opened on; the root-only
//     write lands after it and not before.
//   - No session, no `su`: a caller who knows the root password but holds no shell on
//     the box is refused `no_session`, gets no row, and still cannot write there.
//   - A box on no network: a shell whose box has no occupancy row is `host_unreachable`.
//   - The box as it is: after the journal changes the root password, `su` answers to
//     the new one and no longer to the generated one.
//   - A machine the network generates, and the access point's gateway: both elevate,
//     and the generated machine's root-only write lands after it.
//   - A shell that is already root switches to another account without its password.
//   - The trace on a generated machine files under the network's key, in the box's name.
//   - A smuggled player_key is rejected before any lookup.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds the occupancy row and the shells via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerSuElevate.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { baseFsForLanHost, machineIdForLanHost } from '../src/core/generation/lanHostIdentity.js';
import { npcUsername } from '../src/core/generation/remoteHostFs.js';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs.js';
import { buildWorkstationBaseFsFromIdentity } from '../src/core/generation/workstationFs.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { PASSWD_FILE } from '../src/core/generation/baseFs.js';
import { accountIn } from '../src/core/sessions/passwdAccount.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { md5 } from '../src/core/generation/md5.js';

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

type Identity = ReturnType<typeof generateIdentity>;

const ESSID = 'BEAN-THERE-WIFI';
// The network the shell on A's box was opened across. Not the one A's occupancy row
// names, as for a player met on another of the access points they have joined.
const SHELL_ESSID = 'SOME-OTHER-WIFI';

// --- Identities: A owns a workstation; B holds a guest shell on every box; C holds a
// guest shell on A's box for the changed password; D holds no shell anywhere; E holds a
// shell on a box that is on no network. ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const dave = generateIdentity();
const erin = generateIdentity();

const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const OFF_NETWORK = computeWorkstationId('adrift', generateIdentity().publicKeyHex);
const GATEWAY = computeApGatewayId(ESSID);
const npc = generateHomeLan(ESSID).hosts.find((candidate) => candidate.kind === 'machine');
if (npc === undefined) {
  console.error(`no machine host generated on ${ESSID}`);
  process.exit(1);
}
const GENERATED = machineIdForLanHost(npc, ESSID);
const NPC_USER = npcUsername(ESSID, npc);
// The generator keeps only the hash, and every password it draws comes from one pool.
const npcRootHash = accountIn(baseFsForLanHost(npc, ESSID), 'root')?.hash;
const NPC_ROOT_PW = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === npcRootHash);
if (NPC_ROOT_PW === undefined) {
  console.error(`no generated root password found for ${GENERATED}`);
  process.exit(1);
}

const ROOT_PW = 'alice-root-secret';
const CHANGED_PW = 'changed-in-the-journal';
// A NEW file under root-only /etc — a create the containing dir gates to root only.
const IMPLANT = '/etc/implant';
const AUTH_LOG = '/var/log/auth.log';

const su = (
  caller: Identity,
  machineId: string,
  fields: { readonly username?: string; readonly password: string; readonly extra?: object },
) =>
  post(
    SESSIONS,
    signRequest(caller, 'suElevate', {
      session_id: `su-elevate-${caller.publicKeyHex.slice(0, 8)}-${machineId}-${fields.password}`,
      machine_id: machineId,
      username: fields.username ?? 'root',
      password: fields.password,
      parent_session_id: null,
      source_ip: null,
      ...fields.extra,
    }),
  );

const writeImplant = (signer: Identity, machineId: string) =>
  post(
    PATCHES,
    signRequest(signer, 'upsertPatch', {
      machine_id: machineId,
      path: IMPLANT,
      content: 'persistence',
      owner: 'root',
      is_new: true,
      node_type: 'file',
    }),
  );

const rowsAtImplant = async (machineId: string): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('writer_key')
    .eq('machine_id', machineId)
    .eq('path', IMPLANT);
  return data?.length ?? 0;
};

type SuRow = { readonly credentials: { readonly userType: string }; readonly essid: string };
const suRows = async (caller: Identity, machineId: string): Promise<readonly SuRow[]> => {
  const { data } = await sr
    .from('sessions')
    .select('credentials, essid')
    .eq('player_key', caller.publicKeyHex)
    .eq('machine_id', machineId)
    .eq('kind', 'su')
    .is('ended_at', null);
  return (data ?? []) as readonly SuRow[];
};

// The shell a login would have left. Stamped in the PAST so a su row inserted live is
// unambiguously the latest one the write gate reads.
const guestShell = (caller: Identity, machineId: string, essid: string) => ({
  session_id: `su-elevate-ssh-${caller.publicKeyHex.slice(0, 8)}-${machineId}`,
  player_key: caller.publicKeyHex,
  machine_id: machineId,
  credentials: { username: 'guest', userType: 'guest' },
  kind: 'ssh',
  essid,
  created_at: '2020-01-01T00:00:00.000Z',
});

const cleanUp = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('patches').delete().in('machine_id', [A_MACHINE, GATEWAY, GENERATED]);
  await sr
    .from('sessions')
    .delete()
    .in(
      'player_key',
      [bob, carol, dave, erin].map((identity) => identity.publicKeyHex),
    );
};

// Clean slate, then the join state a real `registerNetwork` writes (occupancy is what
// makes a box reachable) and the shells the logins would have left.
await cleanUp();
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: md5(ROOT_PW),
});
const seeded = await sr
  .from('sessions')
  .insert([
    guestShell(bob, A_MACHINE, SHELL_ESSID),
    guestShell(carol, A_MACHINE, ESSID),
    guestShell(bob, GATEWAY, ESSID),
    guestShell(bob, GENERATED, ESSID),
    guestShell(erin, OFF_NETWORK, ESSID),
  ]);
if (seeded.error) {
  console.error('could not seed sessions:', seeded.error);
  process.exit(1);
}

// === Another player's workstation ===

// 1. Baseline: B (guest) creating a root-only path on A → 403, no row. Proves the
//    write is genuinely tier-gated — the elevation in step 4 is what changes it.
const w1 = await writeImplant(bob, A_MACHINE);
check(
  'B (guest) denied creating /etc/implant on A’s box → 403, no row',
  w1.status === 403 &&
    errorOf(w1.body) === 'permission_denied' &&
    (await rowsAtImplant(A_MACHINE)) === 0,
  `status=${w1.status} error=${errorOf(w1.body)} rows=${await rowsAtImplant(A_MACHINE)}`,
);

// 2. Wrong password → 401 invalid_credentials, NO su row inserted.
const e2 = await su(bob, A_MACHINE, { password: 'not-the-root-pw' });
check(
  'B suElevate with WRONG password → 401, no su row',
  e2.status === 401 &&
    errorOf(e2.body) === 'invalid_credentials' &&
    (await suRows(bob, A_MACHINE)).length === 0,
  `status=${e2.status} error=${errorOf(e2.body)} suRows=${(await suRows(bob, A_MACHINE)).length}`,
);

// 3. After a failed elevation B is still guest → the root-only create is still 403.
const w3 = await writeImplant(bob, A_MACHINE);
check(
  'after wrong-pw, B is still guest → /etc/implant still 403',
  w3.status === 403 && errorOf(w3.body) === 'permission_denied',
  `status=${w3.status} error=${errorOf(w3.body)}`,
);

// 4. Correct password → 200 { userType:'root' }, exactly one root-tier su row for (B,A),
//    on the network B's shell was opened across.
const e4 = await su(bob, A_MACHINE, { password: ROOT_PW });
const suRows4 = await suRows(bob, A_MACHINE);
check(
  'B suElevate with A’s root password → 200 userType=root, one root su row on the shell’s network',
  e4.status === 200 &&
    userTypeOf(e4.body) === 'root' &&
    suRows4.length === 1 &&
    suRows4[0]?.credentials.userType === 'root' &&
    suRows4[0]?.essid === SHELL_ESSID,
  `status=${e4.status} userType=${userTypeOf(e4.body)} suRows=${suRows4.length} essid=${suRows4[0]?.essid}`,
);

// 5. THE PAYOFF: the SAME root-only create now lands (the write gate reads the su row →
//    root tier), attributed to B on A's journal.
const w5 = await writeImplant(bob, A_MACHINE);
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

// 6. No session, no su: knowing the password is not being on the box.
const e6 = await su(dave, A_MACHINE, { password: ROOT_PW });
const w6 = await writeImplant(dave, A_MACHINE);
check(
  'D, with the right password and no shell on A’s box → 403 no_session, no row, no write',
  e6.status === 403 &&
    errorOf(e6.body) === 'no_session' &&
    (await suRows(dave, A_MACHINE)).length === 0 &&
    w6.status === 403,
  `su=${e6.status} error=${errorOf(e6.body)} suRows=${(await suRows(dave, A_MACHINE)).length} write=${w6.status}`,
);

// 7. A shell on a box that is on no network → 404 host_unreachable.
const e7 = await su(erin, OFF_NETWORK, { password: ROOT_PW });
check(
  'E, on a workstation no occupancy row names → 404 host_unreachable',
  e7.status === 404 && errorOf(e7.body) === 'host_unreachable',
  `status=${e7.status} error=${errorOf(e7.body)}`,
);

// 8. Smuggled client player_key → 400, rejected before any lookup/insert.
const e8 = await su(bob, A_MACHINE, { password: ROOT_PW, extra: { player_key: 'attacker' } });
check(
  'B suElevate smuggling a client player_key → 400 (server stamps it)',
  e8.status === 400,
  `status=${e8.status} error=${errorOf(e8.body) ?? '-'}`,
);

// 9. The box as it is. The root password changes in the journal, as an exploit's reset
//    or the owner's own edit would leave it; `su` follows it, as every login does.
const generatedPasswd = (() => {
  const etc = buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: alice.publicKeyHex,
    username: 'alice',
    rootPasswordHash: md5(ROOT_PW),
  }).entries.get('etc');
  const node = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;
  return node?.kind === 'file' ? node.content : null;
})();
if (generatedPasswd === null) {
  console.error('the generated workstation has no /etc/passwd');
  process.exit(1);
}
const changed = await sr.from('patches').insert({
  machine_id: A_MACHINE,
  path: '/etc/passwd',
  content: generatedPasswd.replace(md5(ROOT_PW), md5(CHANGED_PW)),
  owner: 'root',
  permissions: PASSWD_FILE,
  node_type: 'file',
  writer_key: alice.publicKeyHex,
  updated_at: new Date().toISOString(),
});
if (changed.error) {
  console.error('could not seed the changed passwd:', changed.error);
  process.exit(1);
}
const e9old = await su(carol, A_MACHINE, { password: ROOT_PW });
const e9new = await su(carol, A_MACHINE, { password: CHANGED_PW });
check(
  'after the journal changes root’s password, C is refused the generated one and let in by the new one',
  e9old.status === 401 && e9new.status === 200 && userTypeOf(e9new.body) === 'root',
  `generated=${e9old.status} new=${e9new.status} userType=${userTypeOf(e9new.body)}`,
);

// === A machine the network generates ===

// 10. Wrong password first, while B's shell there is still the guest one.
const w10 = await writeImplant(bob, GENERATED);
const e10 = await su(bob, GENERATED, { password: 'not-the-root-pw' });
check(
  'on a generated machine, B (guest) is denied the root-only write and a wrong password → 403, 401',
  w10.status === 403 && e10.status === 401 && (await suRows(bob, GENERATED)).length === 0,
  `write=${w10.status} su=${e10.status} suRows=${(await suRows(bob, GENERATED)).length}`,
);

// 11. The box's own root password → a root row, and the write lands.
const e11 = await su(bob, GENERATED, { password: NPC_ROOT_PW });
const suRows11 = await suRows(bob, GENERATED);
const w11 = await writeImplant(bob, GENERATED);
check(
  'B suElevate with the generated machine’s root password → 200, a root row, and the write lands',
  e11.status === 200 &&
    userTypeOf(e11.body) === 'root' &&
    suRows11.length === 1 &&
    suRows11[0]?.credentials.userType === 'root' &&
    suRows11[0]?.essid === ESSID &&
    w11.status === 200,
  `su=${e11.status} userType=${userTypeOf(e11.body)} suRows=${suRows11.length} write=${w11.status}`,
);

// 12. Both attempts are on the box's auth.log, in ONE row under the network's key.
const { data: log12 } = await sr
  .from('patches')
  .select('content, writer_key')
  .eq('machine_id', GENERATED)
  .eq('path', AUTH_LOG);
const line12 = log12?.[0]?.content ?? '';
check(
  'the generated machine’s auth.log holds both su lines under the network’s key, in the box’s name',
  log12?.length === 1 &&
    log12[0]?.writer_key === apGatewayLogWriterKey(ESSID) &&
    line12.includes('FAILED su for root by guest') &&
    line12.includes('Successful su for root by guest') &&
    line12.includes(`${npc.hostname} su[`),
  `rows=${log12?.length} lines=${line12.trim().split('\n').length}`,
);

// 13. B is root there now, and root becomes anyone without being asked.
const e13 = await su(bob, GENERATED, { username: NPC_USER, password: '' });
const e13ghost = await su(bob, GENERATED, { username: 'nobody-here', password: '' });
check(
  'B, already root, switches to the box’s user with no password, and not to an account it lacks',
  e13.status === 200 && userTypeOf(e13.body) === 'user' && e13ghost.status === 401,
  `user=${e13.status} userType=${userTypeOf(e13.body)} ghost=${e13ghost.status}`,
);

// === The access point's gateway ===

// 14. Nobody's box: found from the network on B's shell, not from occupancy.
const e14 = await su(bob, GATEWAY, { password: seedApGatewayAdminPw(ESSID) });
const suRows14 = await suRows(bob, GATEWAY);
check(
  'B suElevate on the access point’s gateway with its admin password → 200, a root row',
  e14.status === 200 &&
    userTypeOf(e14.body) === 'root' &&
    suRows14.length === 1 &&
    suRows14[0]?.credentials.userType === 'root',
  `status=${e14.status} error=${errorOf(e14.body) ?? '-'} suRows=${suRows14.length}`,
);

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
