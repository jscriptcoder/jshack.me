// Wire-payload check for the shared-box log rule — the one claim no unit test can make.
//
// A box nobody owns is ESSID-SHARED: it is regenerated from the ESSID with an id that does
// not depend on who is asking, so every occupant reaches the identical machine. `patches`
// rows are keyed `(machine_id, path, writer_key)` and a log patch carries the WHOLE file,
// so a row per caller means the journal's replay keeps only whichever landed last and the
// earlier attacker's lines are gone. That is a property of the REAL journal's fold, which
// is why it belongs here and not in vitest.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - TWO different players sweep the SAME generated box. Afterwards there is exactly ONE
//     row at that `(machine_id, /var/log/auth.log)` — not one per attacker.
//   - That row is keyed to the ESSID's OWN key. Neither attacker's own key appears, so a
//     caller-keyed write cannot satisfy this check — and nor does the key of the third
//     player who holds the lowest lease and never acts.
//   - BOTH attackers' lines are present in it, each naming its own source address. This is
//     the accretion the rule exists for: under the old rule the second sweep's row would
//     have hidden the first entirely.
//   - The key does not depend on who has joined — carol holds octet 5 and is not an
//     occupant at all, and the row is still not hers.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSharedBoxLogTruth.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';

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

/** Every seed is loud. A rejected row leaves the scenario unbuilt while the checks run on
 *  regardless and report against an unmodified world — a green run that tested nothing. */
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

const ESSID = 'SHARED-LOG-WIFI';

// alice and bob attack; carol only ever HELD a lease. She is not an occupant, which is the
// point: the key has to be stable across who happens to be standing on the network, and a
// lease outlives the occupancy that created it.
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const CAROL_OCTET = 5;
const ALICE_OCTET = 21;
const BOB_OCTET = 22;

const ALICE_IP = '192.168.1.60';
const BOB_IP = '192.168.1.61';

const aliceMachine = computeWorkstationId('alicelab', alice.publicKeyHex);
const bobMachine = computeWorkstationId('boblab', bob.publicKeyHex);

/** An ordinary generated sibling running ssh. `kind === 'machine'` is load-bearing: a
 *  router or switch above `.1` is an INNER GATEWAY on a router tree, which resolves
 *  through a different arm entirely and would prove nothing about a plain NPC box. */
const runsSsh = (host: LanHost): boolean =>
  hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.ssh);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && runsSsh(host));

if (target === undefined) {
  console.error(`ESSID ${ESSID} carries no generated machine running ssh — pick another.`);
  process.exit(2);
}

const targetMachine = resolveLanHostIdentity(target, ESSID).machineId;

const occupantRow = (owner: ReturnType<typeof generateIdentity>, wsName: string) => ({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

const seedWordlist = async (machineId: string, writerKey: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
      path: WORDLIST_PATH,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      writer_key: writerKey,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  mustNotFail(`wordlist seed on ${machineId}`, error);
};

/** The ssh session the server checks before it will read a box's wordlist. */
const seedSession = async (
  owner: ReturnType<typeof generateIdentity>,
  machineId: string,
  sourceIp: string,
) => {
  await sr.from('sessions').delete().eq('player_key', owner.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: crypto.randomUUID(),
    player_key: owner.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    parent_session_id: null,
    source_ip: sourceIp,
    kind: 'ssh',
    essid: ESSID,
  });
  mustNotFail(`session seed for ${machineId}`, error);
};

const sweep = (owner: ReturnType<typeof generateIdentity>, machineId: string, sourceIp: string) =>
  post(
    signRequest(owner, 'hydraCrack', {
      essid: ESSID,
      target_ip: target.ip,
      service: 'ssh',
      caller_machine_id: machineId,
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

const main = async () => {
  console.log(`Target ${target.ip} (${target.hostname}) on ${ESSID} → ${targetMachine}`);
  console.log(`Lowest lease: carol @ .${CAROL_OCTET} (never acts) — NOT the expected writer.`);

  // Cleaned at SETUP, not only at teardown. This machine_id is ESSID-seeded and therefore
  // identical across runs, so a crashed or half-failing earlier run leaves rows this run
  // would read as its own — the trap that let a trace assertion pass against a row written
  // the previous day.
  await sr.from('patches').delete().eq('machine_id', targetMachine).eq('path', AUTH_LOG_PATH);
  await sr.from('patches').delete().eq('machine_id', aliceMachine).eq('path', WORDLIST_PATH);
  await sr.from('patches').delete().eq('machine_id', bobMachine).eq('path', WORDLIST_PATH);
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);

  const occupants = await sr
    .from('home_network_occupants')
    .insert([occupantRow(alice, 'alicelab'), occupantRow(bob, 'boblab')]);
  mustNotFail('occupancy seed', occupants.error);

  // carol's lease with no occupancy row: she left, her address did not. The rule under test
  // is that the log's key does not move when players join, leave or rejoin — it belongs
  // to the network, not to any of them.
  const leases = await sr.from('network_lan_leases').insert([
    { essid: ESSID, owner_key: carol.publicKeyHex, octet: CAROL_OCTET },
    { essid: ESSID, owner_key: alice.publicKeyHex, octet: ALICE_OCTET },
    { essid: ESSID, owner_key: bob.publicKeyHex, octet: BOB_OCTET },
  ]);
  mustNotFail('lease seed', leases.error);

  await seedWordlist(aliceMachine, alice.publicKeyHex);
  await seedWordlist(bobMachine, bob.publicKeyHex);
  await seedSession(alice, aliceMachine, ALICE_IP);
  await seedSession(bob, bobMachine, BOB_IP);

  const before = await authLogRows();
  check(
    'the target starts with no auth.log row at all',
    before.length === 0,
    `${before.length} row(s) before the first sweep`,
  );

  // === 1. alice sweeps. ===
  const first = await sweep(alice, aliceMachine, ALICE_IP);
  const afterAlice = await authLogRows();
  const aliceContent = afterAlice[0]?.content ?? '';
  check(
    'alice’s sweep lands one row on the shared box',
    first.status === 200 && afterAlice.length === 1,
    `status=${first.status} rows=${afterAlice.length}`,
  );
  check(
    'that row is keyed to the NETWORK, not to alice nor to the lowest lease',
    afterAlice[0]?.writer_key === apGatewayLogWriterKey(ESSID),
    `writer=${(afterAlice[0]?.writer_key ?? '(none)').slice(0, 12)}… carol=${carol.publicKeyHex.slice(0, 12)}… alice=${alice.publicKeyHex.slice(0, 12)}…`,
  );

  // === 2. bob sweeps the SAME box. This is the whole point. ===
  const second = await sweep(bob, bobMachine, BOB_IP);
  const afterBob = await authLogRows();
  check(
    'bob’s sweep does NOT open a second row — one box keeps one log',
    second.status === 200 && afterBob.length === 1,
    `status=${second.status} rows=${afterBob.length} (a row per attacker would be 2)`,
  );

  // The DELTA, not the whole file: ssh and hydra write the same sentence to the same log,
  // so an `includes()` over everything is satisfied by lines an earlier step already wrote.
  const bobDelta = (afterBob[0]?.content ?? '').slice(aliceContent.length);
  check(
    'bob’s lines were APPENDED to alice’s, not written over them',
    (afterBob[0]?.content ?? '').startsWith(aliceContent) && bobDelta.length > 0,
    `alice ${linesIn(aliceContent).length} line(s), +${linesIn(bobDelta).length} from bob`,
  );

  // === 3. The accretion itself: both attackers are readable in the one row. ===
  const finalContent = afterBob[0]?.content ?? '';
  check(
    'BOTH attackers’ addresses survive in the single row',
    finalContent.includes(ALICE_IP) && finalContent.includes(BOB_IP),
    `alice ${finalContent.includes(ALICE_IP) ? 'present' : 'MISSING'}, bob ${finalContent.includes(BOB_IP) ? 'present' : 'MISSING'}`,
  );
  check(
    'neither attacker’s own key holds a row — the bucket belongs to the network',
    !afterBob.some(
      (row) => row.writer_key === alice.publicKeyHex || row.writer_key === bob.publicKeyHex,
    ),
    afterBob.map((row) => row.writer_key.slice(0, 12)).join(',') || '(none)',
  );

  // Teardown. Setup cleans too, so a crash here costs the next run nothing.
  await sr.from('patches').delete().eq('machine_id', targetMachine).eq('path', AUTH_LOG_PATH);
  await sr.from('patches').delete().eq('machine_id', aliceMachine).eq('path', WORDLIST_PATH);
  await sr.from('patches').delete().eq('machine_id', bobMachine).eq('path', WORDLIST_PATH);
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

void main();
