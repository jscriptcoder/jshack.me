// Wire-payload check for the shared-box login log — the claim no unit test can make.
//
// A box nobody owns is ESSID-SHARED: every player on the WiFi regenerates the identical
// machine, so their `ssh` logins land on one `auth.log`. `patches` rows are keyed
// `(machine_id, path, writer_key)` and a log patch carries the WHOLE file, so a row per
// caller means the journal's replay keeps only whichever landed last and the earlier
// player's login is gone. That fold belongs to the REAL journal, which is why it is
// checked here and not in vitest.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - TWO players on one WiFi log in to the SAME generated box — one accepted, one
//     refused. Afterwards there is exactly ONE row at that `(machine_id, auth.log)`.
//   - That row is keyed to the network's own key, never either player's.
//   - BOTH logins are readable in it, each naming its own source address, the second
//     appended below the first rather than written over it.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSharedBoxLoginLog.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { md5 } from '../src/core/generation/md5.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

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

/** A failed read leaves the checks running against nothing — a green run that tested
 *  nothing — so every read is loud. */
const mustNotFail = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
};

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const ESSID = 'SHARED-LOGIN-WIFI';

const alice = generateIdentity();
const bob = generateIdentity();

// The server derives each login's source address from the lease the player holds, so the
// addresses are the ones those leases name on this ESSID's own /24 — not literals.
const ALICE_OCTET = 60;
const BOB_OCTET = 61;
const ALICE_IP = lanAddressFor(ESSID, ALICE_OCTET);
const BOB_IP = lanAddressFor(ESSID, BOB_OCTET);

/** An ordinary generated sibling running ssh. `kind === 'machine'` is load-bearing: a
 *  router or switch above `.1` is an INNER GATEWAY, which logs in through a different
 *  endpoint entirely and would prove nothing about a plain NPC box. */
const runsSsh = (host: LanHost): boolean =>
  hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.ssh);

const target = generateHomeLan(ESSID).hosts.find(
  (host) => host.kind === 'machine' && runsSsh(host),
);

if (target === undefined) {
  console.error(`ESSID ${ESSID} carries no generated machine running ssh — pick another.`);
  process.exit(2);
}

const { machineId: targetMachine, baseFs } = resolveLanHostIdentity(target, ESSID);

const rootPassword = (() => {
  const root = accountsIn(baseFs).find((account) => account.username === 'root');
  return ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === root?.hash);
})();

if (rootPassword === undefined) {
  console.error(`No recoverable root password on ${target.ip} — pick another ESSID.`);
  process.exit(2);
}

const login = (player: ReturnType<typeof generateIdentity>, password: string, sourceIp: string) =>
  post(
    signRequest(player, 'authCreateSession', {
      session_id: crypto.randomUUID(),
      essid: ESSID,
      target_ip: target.ip,
      username: 'root',
      password,
      parent_session_id: null,
      source_ip: sourceIp,
    }),
  );

/** EVERY row at the target's auth.log, whoever wrote it — the count is the whole claim, so
 *  a reader scoped to one writer_key would hide exactly the failure under test. */
const authLogRows = async (): Promise<readonly { writer_key: string; content: string }[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', targetMachine)
    .eq('path', AUTH_LOG_PATH);
  mustNotFail('auth.log read', error);
  return (data ?? []) as readonly { writer_key: string; content: string }[];
};

const linesIn = (content: string): readonly string[] =>
  content.split('\n').filter((line) => line.length > 0);

const cleanUp = async () => {
  await leaveNetwork(sr, ESSID);
  await sr.from('patches').delete().eq('machine_id', targetMachine).eq('path', AUTH_LOG_PATH);
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
};

const main = async () => {
  console.log(`Target ${target.ip} (${target.hostname}) on ${ESSID} → ${targetMachine}`);

  // Cleaned at SETUP, not only at teardown. This machine_id is ESSID-seeded and therefore
  // identical across runs, so a crashed earlier run leaves rows this run would read as
  // its own.
  await cleanUp();
  // Both players are at home on this lab network: the server places their logins — and
  // derives the address each is seen from — off these leases.
  await standOnNetwork(sr, ESSID, alice, ALICE_OCTET);
  await standOnNetwork(sr, ESSID, bob, BOB_OCTET);

  const before = await authLogRows();
  check(
    'the target starts with no auth.log row at all',
    before.length === 0,
    `${before.length} row(s) before the first login`,
  );

  // === 1. alice logs in. ===
  const first = await login(alice, rootPassword, ALICE_IP);
  const afterAlice = await authLogRows();
  const aliceContent = afterAlice[0]?.content ?? '';
  check(
    'alice’s login is accepted and lands one row on the shared box',
    first.status === 200 && afterAlice.length === 1,
    `status=${first.status} rows=${afterAlice.length}`,
  );
  check(
    'that row is keyed to the NETWORK, not to alice',
    afterAlice[0]?.writer_key === apGatewayLogWriterKey(ESSID),
    `writer=${(afterAlice[0]?.writer_key ?? '(none)').slice(0, 24)}`,
  );

  // === 2. bob knocks on the SAME box with the wrong password. ===
  const second = await login(bob, 'not-the-password', BOB_IP);
  const afterBob = await authLogRows();
  check(
    'bob’s refused login does NOT open a second row — one box keeps one log',
    second.status === 401 && afterBob.length === 1,
    `status=${second.status} rows=${afterBob.length} (a row per player would be 2)`,
  );

  // The DELTA, not the whole file: an `includes()` over everything is satisfied by lines
  // an earlier step already wrote.
  const finalContent = afterBob[0]?.content ?? '';
  const bobDelta = finalContent.slice(aliceContent.length);
  check(
    'bob’s line was APPENDED to alice’s, not written over it',
    finalContent.startsWith(aliceContent) && bobDelta.includes(BOB_IP),
    `alice ${linesIn(aliceContent).length} line(s), +${linesIn(bobDelta).length} from bob`,
  );
  check(
    'BOTH logins survive in the single row, each naming its own address',
    finalContent.includes(`Accepted password for root from ${ALICE_IP}`) &&
      finalContent.includes(`Failed password for root from ${BOB_IP}`),
    `alice ${finalContent.includes(ALICE_IP) ? 'present' : 'MISSING'}, bob ${finalContent.includes(BOB_IP) ? 'present' : 'MISSING'}`,
  );
  check(
    'neither player’s own key holds a row — the log belongs to the network',
    !afterBob.some(
      (row) => row.writer_key === alice.publicKeyHex || row.writer_key === bob.publicKeyHex,
    ),
    afterBob.map((row) => row.writer_key.slice(0, 24)).join(',') || '(none)',
  );

  await cleanUp();

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

void main();
