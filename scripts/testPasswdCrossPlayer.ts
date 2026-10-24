// Wire-payload smoke for `passwd` on a box that is not the caller's own.
//
// A caller who has rooted somebody else's box POSTs `passwdChange` to /api/sessions to
// rewrite an account's md5 hash in that box's `/etc/passwd`, locking the owner out of the
// next `su`/`ssh` with the old password. The server starts from the caller's own live
// shell on the machine (its absence is the refusal), confirms that shell is ROOT (only
// root may write the root-owned `/etc/passwd` — L2), finds the box from the network the
// shell is on, composes the one-row rewrite against the box AS ITS JOURNAL LEAVES IT, and
// stamps the `passwd` trace on the box's auth.log — one authorized act, so a tampered
// client can neither write the row without the trace nor forge the time.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A non-root shell on the box: `passwdChange` is refused by L2 (403 not_authorized)
//     with nothing read or written — a user/guest cannot touch the root-owned file.
//   - No shell on the box: `passwdChange` is refused (403 no_session).
//   - An account that does not exist on the box: 404 user_not_found.
//   - A smuggled player_key is rejected before any lookup.
//   - A root shell: the rewrite lands (200), the row is attributed to the caller, and the
//     reader sees the NEW hash — the change persists in the journal and hides from the
//     owner, who only ever reads the live file.
//   - The rewrite composes over a PRIOR /etc/passwd patch from a DIFFERENT writer (a
//     systemctl-hole row append) rather than erasing it: the intruder row survives and the
//     root hash still changes.
//   - The server stamps the auth.log breadcrumb (`password changed for <user>`), under the
//     key that owns the box's logs, with a time the client never supplied.
//   - The lockout bites the next login: the owner's generated root password no longer
//     authenticates and the new one does.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds the occupancy row and the shells via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testPasswdCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { buildWorkstationBaseFsFromIdentity } from '../src/core/generation/workstationFs.js';
import { PASSWD_FILE } from '../src/core/generation/baseFs.js';
import {
  materializeMachineFs,
  type OwnerPatchRow,
} from '../src/core/network/materializeMachineFs.js';
import { accountIn, PASSWD_PATH } from '../src/core/sessions/passwdAccount.js';
import { md5 } from '../src/core/generation/md5.js';

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
const okOf = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
const userTypeOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { userType?: string }).userType : undefined;

type Identity = ReturnType<typeof generateIdentity>;

const ESSID = 'BEAN-THERE-WIFI';

// --- Identities: alice owns a workstation (the victim); bob holds a ROOT shell on it (he
// rooted it) and runs `passwd`; carol holds a GUEST shell (the non-root refusal + the
// lockout `su`); dave holds no shell; erin is a prior intruder whose systemctl-hole row
// append already sits on alice's /etc/passwd. ---
const alice = generateIdentityIn(RIDGEMONT);
const bob = generateIdentityIn(RIDGEMONT);
const carol = generateIdentityIn(RIDGEMONT);
const dave = generateIdentityIn(RIDGEMONT);
const erin = generateIdentityIn(RIDGEMONT);

const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_USERNAME = 'alice';
const A_HOSTNAME = 'skylab';

const ROOT_PW = 'alice-root-secret';
const LOCKOUT_PW = 'locked-out-by-bob';
// The row erin's systemctl hole appended — a foothold account on the owner's own passwd.
const INTRUDER = 'intruder';
const INTRUDER_HASH = md5('way-in');

// A's /etc/passwd as the generator writes it, with alice's chosen root password.
const generatedPasswd = (() => {
  const etc = buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: alice.publicKeyHex,
    username: A_USERNAME,
    rootPasswordHash: md5(ROOT_PW),
  }).entries.get('etc');
  const node = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;
  return node?.kind === 'file' ? node.content : null;
})();
if (generatedPasswd === null) {
  console.error('the generated workstation has no /etc/passwd');
  process.exit(1);
}
// erin's prior patch: the generated file with an extra foothold row appended.
const withIntruderRow = `${generatedPasswd.replace(/\n$/, '')}\n${INTRUDER}:${INTRUDER_HASH}:1001:1001:Intruder:/home/${INTRUDER}:/bin/sh\n`;

const changePasswd = (
  caller: Identity,
  machineId: string,
  fields: { readonly username: string; readonly newHash: string; readonly extra?: object },
) =>
  post(
    SESSIONS,
    signRequest(caller, 'passwdChange', {
      machine_id: machineId,
      username: fields.username,
      new_hash: fields.newHash,
      ...fields.extra,
    }),
  );

const su = (caller: Identity, machineId: string, password: string) =>
  post(
    SESSIONS,
    signRequest(caller, 'suElevate', {
      session_id: `passwd-lockout-${caller.publicKeyHex.slice(0, 8)}-${machineId}-${password}`,
      machine_id: machineId,
      username: 'root',
      password,
      parent_session_id: null,
      source_ip: null,
    }),
  );

// A shell a login would have left, stamped in the PAST so a live su row is unambiguously
// the latest the lookup reads.
const shell = (
  caller: Identity,
  machineId: string,
  credentials: { readonly username: string; readonly userType: string },
) => ({
  session_id: `passwd-shell-${caller.publicKeyHex.slice(0, 8)}-${machineId}`,
  player_key: caller.publicKeyHex,
  machine_id: machineId,
  credentials,
  kind: 'ssh',
  essid: ESSID,
  created_at: '2020-01-01T00:00:00.000Z',
});

const passwdRows = async (): Promise<readonly OwnerPatchRow[]> => {
  const { data } = await sr
    .from('patches')
    .select('path, content, owner, permissions, node_type, updated_at, writer_key')
    .eq('machine_id', A_MACHINE)
    .eq('path', PASSWD_PATH);
  return (data ?? []) as readonly OwnerPatchRow[];
};

const authLogRows = async (): Promise<readonly { content: string; writer_key: string }[]> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', A_MACHINE)
    .eq('path', '/var/log/auth.log');
  return (data ?? []) as readonly { content: string; writer_key: string }[];
};

const cleanUp = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('patches').delete().eq('machine_id', A_MACHINE);
  await sr
    .from('sessions')
    .delete()
    .in(
      'player_key',
      [bob, carol, dave].map((identity) => identity.publicKeyHex),
    );
};

// Clean slate, then the join state a real `registerNetwork` writes (occupancy is what
// makes A's box reachable as another player's workstation), the shells the logins left,
// and erin's prior systemctl-hole row append.
await cleanUp();
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  workstation_username: A_USERNAME,
  workstation_machine_name: A_HOSTNAME,
  workstation_root_hash: md5(ROOT_PW),
});
const seeded = await sr
  .from('sessions')
  .insert([
    shell(bob, A_MACHINE, { username: 'root', userType: 'root' }),
    shell(carol, A_MACHINE, { username: 'guest', userType: 'guest' }),
  ]);
if (seeded.error) {
  console.error('could not seed sessions:', seeded.error);
  process.exit(1);
}
const seededPatch = await sr.from('patches').insert({
  machine_id: A_MACHINE,
  path: PASSWD_PATH,
  content: withIntruderRow,
  owner: 'root',
  permissions: PASSWD_FILE,
  node_type: 'file',
  writer_key: erin.publicKeyHex,
  updated_at: '2021-06-01T00:00:00.000Z',
});
if (seededPatch.error) {
  console.error('could not seed erin’s prior passwd patch:', seededPatch.error);
  process.exit(1);
}

// === Refusals (before the box is read or written) ===

// 1. carol holds a GUEST shell on A. L2 refuses: only root may write the root-owned
//    /etc/passwd on a box that isn't yours. Nothing of hers is written.
const r1 = await changePasswd(carol, A_MACHINE, { username: 'root', newHash: md5(LOCKOUT_PW) });
const carolWrote = (await passwdRows()).some((row) => row.writer_key === carol.publicKeyHex);
check(
  'carol (guest shell) passwdChange on A’s box → 403 not_authorized, nothing written',
  r1.status === 403 && errorOf(r1.body) === 'not_authorized' && !carolWrote,
  `status=${r1.status} error=${errorOf(r1.body)} carolRow=${carolWrote}`,
);

// 2. dave holds no shell on A. A caller who is not on the box is refused `no_session`.
const r2 = await changePasswd(dave, A_MACHINE, { username: 'root', newHash: md5(LOCKOUT_PW) });
check(
  'dave (no shell on A) passwdChange → 403 no_session',
  r2.status === 403 && errorOf(r2.body) === 'no_session',
  `status=${r2.status} error=${errorOf(r2.body)}`,
);

// 3. bob is root, but the named account does not exist on the box → 404 user_not_found.
const r3 = await changePasswd(bob, A_MACHINE, { username: 'nobody-here', newHash: md5('x') });
check(
  'bob (root) passwdChange for an account with no row → 404 user_not_found',
  r3.status === 404 && errorOf(r3.body) === 'user_not_found',
  `status=${r3.status} error=${errorOf(r3.body)}`,
);

// 4. A smuggled client player_key is forged provenance → rejected before any lookup.
const r4 = await changePasswd(bob, A_MACHINE, {
  username: 'root',
  newHash: md5(LOCKOUT_PW),
  extra: { player_key: 'attacker' },
});
check(
  'bob passwdChange smuggling a client player_key → 400 (server stamps the writer)',
  r4.status === 400,
  `status=${r4.status} error=${errorOf(r4.body) ?? '-'}`,
);

// === The root change ===

// 5. bob is root on A. The rewrite lands, attributed to bob.
const r5 = await changePasswd(bob, A_MACHINE, { username: 'root', newHash: md5(LOCKOUT_PW) });
const rows5 = await passwdRows();
const bobRow = rows5.find((row) => row.writer_key === bob.publicKeyHex);
check(
  'bob (root) passwdChange root → 200 ok, a /etc/passwd row attributed to bob',
  r5.status === 200 && okOf(r5.body) && bobRow !== undefined,
  `status=${r5.status} ok=${okOf(r5.body)} bobRow=${bobRow !== undefined}`,
);

// 6. THE READER'S VIEW: materialize A's journal exactly as a login does. root answers to
//    the NEW hash, erin's intruder row SURVIVES the rewrite (composed over, not erased),
//    and the owner's own account is untouched.
const fs6 = materializeMachineFs(
  buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: alice.publicKeyHex,
    username: A_USERNAME,
    rootPasswordHash: md5(ROOT_PW),
  }),
  rows5,
);
const root6 = accountIn(fs6, 'root');
const intruder6 = accountIn(fs6, INTRUDER);
const owner6 = accountIn(fs6, A_USERNAME);
check(
  'the reader sees root’s NEW hash, erin’s intruder row preserved, and alice untouched',
  root6?.hash === md5(LOCKOUT_PW) &&
    root6?.hash !== md5(ROOT_PW) &&
    intruder6?.hash === INTRUDER_HASH &&
    owner6 !== null,
  `root=${root6?.hash === md5(LOCKOUT_PW) ? 'new' : root6?.hash} intruder=${intruder6?.hash === INTRUDER_HASH} alice=${owner6 !== null}`,
);

// 7. The server stamped the breadcrumb on A's auth.log, under the key that owns the box's
//    logs (alice), with a time bob never supplied.
const log7 = await authLogRows();
const passwdLine = log7.find((row) => row.content.includes('password changed for root'));
check(
  'the server stamps `password changed for root` on A’s auth.log under the box-log key',
  passwdLine !== undefined &&
    passwdLine.writer_key === alice.publicKeyHex &&
    passwdLine.content.includes(`${A_HOSTNAME} passwd[`),
  `found=${passwdLine !== undefined} writer=${passwdLine?.writer_key === alice.publicKeyHex ? 'box' : 'other'}`,
);

// === The lockout bites the next login ===

// 8. carol (still a guest shell holder) tries to su to root: the generated password no
//    longer works, the new one does. Existing shells were never touched — only auth.
const r8old = await su(carol, A_MACHINE, ROOT_PW);
const r8new = await su(carol, A_MACHINE, LOCKOUT_PW);
check(
  'after the change, A’s old root password is refused and the new one is accepted',
  r8old.status === 401 && r8new.status === 200 && userTypeOf(r8new.body) === 'root',
  `old=${r8old.status} new=${r8new.status} userType=${userTypeOf(r8new.body)}`,
);

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
