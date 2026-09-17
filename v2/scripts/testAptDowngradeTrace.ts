// Wire-check for the trace an `apt install pkg=<older>` leaves: rolling a package
// BACKWARDS on a box is recorded in THAT box's own `/var/log/dpkg.log`, under its
// OWNER's row, addressed from where the visitor was really standing. Drives the REAL
// /api/patches endpoint against a running `vercel dev` + supabase.
//
// Pinning is the one apt verb that leaves a machine more exposed than it found it, and
// after an ssh hop it is run by somebody who does not own the box. Its owner's only way
// to learn it happened is this line.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `recordPackageDowngrade` on a box the caller holds nothing on is 403 `no_session`
//     and writes nothing. Without it anyone could author rollbacks into any stranger's
//     package history, inventing exposure on a box they never reached.
//   - The occupancy reverse-lookup that routes the line to the machine OWNER's row
//     rather than the visitor's. A column selection no unit test can get wrong, and the
//     difference between a defender reading one visit and reading half of one.
//   - The occupancy -> public-ip walk that names the address, ignoring the `source_ip`
//     the caller sends.
//   - THE PIVOT. A rollback run from a box the visitor merely holds a session on is
//     addressed from THAT network. This is the branch the client chooses via
//     `launchVantage` (the hop below the active one), and the only place it can be
//     proved end to end: a unit test can assert the rule, but only the live occupancy
//     and session rows can show the server agreeing with it.
//   - An unowned generated host keeps the CALLER's own row and the address they
//     reported — the opposite of every branch above, so the rule is proved both ways.
//
// Usage (from v2/, with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testAptDowngradeTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { lanBaseFsForMachineId, machineIdForLanHost } from '../src/core/generation/lanHostIdentity';
import { md5 } from '../src/core/generation/md5';
import { DPKG_LOG_PATH } from '../src/core/logging/dpkgLog';
import { clearPublicIps, seedPublicIps } from './networkFixture';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(PATCHES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

// --- The parties -------------------------------------------------------------------
// A owns the box that gets rolled back. B does the rolling, from their own network or
// from C's. C exists so the pivot has somewhere to point that is neither B's home nor
// A's own — without a third network, "the address is B's" and "the address is the box
// they stand on" cannot be told apart.
const victim = generateIdentity();
const attacker = generateIdentity();
const bystander = generateIdentity();

const A_ESSID = 'DPKG-LAB-A';
const A_PUBLIC_IP = '203.0.113.41';
const A_WS = computeWorkstationId('victimbox', victim.publicKeyHex);

const B_ESSID = 'DPKG-LAB-B';
const B_PUBLIC_IP = '198.51.100.62';
const B_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);

const C_ESSID = 'DPKG-LAB-C';
const C_PUBLIC_IP = '203.0.113.88';
const C_WS = computeWorkstationId('borrowed', bystander.publicKeyHex);

// An ordinary generated sibling nobody owns — the branch where the caller's own row IS
// the record. Selected the way `testRemoteAptInstall` selects one: `kind: 'machine'` and
// actually resolvable, since routers and switches are a different tree entirely.
const lanHosts = generateHomeLan(A_ESSID).hosts;
const npcHost = lanHosts.find(
  (host) =>
    host.kind === 'machine' &&
    lanBaseFsForMachineId(A_ESSID, machineIdForLanHost(host, A_ESSID)) !== null,
);
if (npcHost === undefined) {
  console.error(`No ordinary NPC host generated for ESSID ${A_ESSID}`);
  process.exit(2);
}
const NPC_MACHINE = machineIdForLanHost(npcHost, A_ESSID);

const PACKAGE = 'redis';
const FROM_VERSION = '7.9.7';
const TO_VERSION = '7.2.5';
// The address B CLAIMS. It must never reach a log that is not B's own.
const CLAIMED_IP = '10.0.0.66';

const PIVOT_SESSION = 'ssh-pivot-dpkg-wirecheck';

const downgrade = (over: Record<string, unknown> = {}) =>
  post(
    signRequest(attacker, 'recordPackageDowngrade', {
      machine_id: A_WS,
      package_name: PACKAGE,
      from_version: FROM_VERSION,
      to_version: TO_VERSION,
      source_ip: CLAIMED_IP,
      ...over,
    }),
  );

/** The box's own dpkg.log, read from the journal rather than trusted from the handler's
 *  answer — with the writer key, because whose row it lands in is half the claim. */
const logRow = async (
  machineId: string,
): Promise<{ content: string; writerKey: string } | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', DPKG_LOG_PATH)
    .maybeSingle();
  const row = data as { content: string; writer_key: string } | null;
  return row === null ? null : { content: row.content, writerKey: row.writer_key };
};

const rowCount = async (machineId: string): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('*', { count: 'exact', head: true })
    .eq('machine_id', machineId)
    .eq('path', DPKG_LOG_PATH);
  return count ?? 0;
};

/** The latest line the recorder wrote. Every append ends with a newline, so the naive
 *  last element is the empty string after it. */
const latestLine = (content: string): string => content.trimEnd().split('\n').at(-1) ?? '';

/** Replace the attacker's session on a machine — the row an ssh hop would have left.
 *  Deleted rather than ended so L1's findActiveSession cannot return a stale top. */
const seedSession = async (machineId: string, essid: string, sessionId: string) => {
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: sessionId,
    player_key: attacker.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

/** Both hops at once: standing ON the pivot, and holding the victim's box. The pivot row
 *  carries C's ESSID, which is the only place the server can learn which network the
 *  visitor is operating from. */
const seedPivotAndTarget = async () => {
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
  const { error } = await sr.from('sessions').insert([
    {
      session_id: PIVOT_SESSION,
      player_key: attacker.publicKeyHex,
      machine_id: C_WS,
      credentials: { username: 'root', userType: 'root' },
      kind: 'ssh',
      essid: C_ESSID,
    },
    {
      session_id: 'ssh-target-dpkg-wirecheck',
      player_key: attacker.publicKeyHex,
      machine_id: A_WS,
      credentials: { username: 'root', userType: 'root' },
      kind: 'ssh',
      essid: A_ESSID,
    },
  ]);
  if (error) throw new Error(`pivot seed failed: ${error.message}`);
};

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: A_ESSID, publicIp: A_PUBLIC_IP },
    { essid: B_ESSID, publicIp: B_PUBLIC_IP },
    { essid: C_ESSID, publicIp: C_PUBLIC_IP },
  ]);
  for (const essid of [A_ESSID, B_ESSID, C_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
  }
  for (const id of [A_WS, B_WS, C_WS, NPC_MACHINE]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
};

// --- Setup -------------------------------------------------------------------------
// Cleared at SETUP as well as teardown: generated ids are ESSID-seeded and identical
// across runs, so a crashed run would otherwise leave rows the next one reads as its own.
await clean();

await seedPublicIps(sr, [
  { essid: A_ESSID, publicIp: A_PUBLIC_IP },
  { essid: B_ESSID, publicIp: B_PUBLIC_IP },
  { essid: C_ESSID, publicIp: C_PUBLIC_IP },
]);

const occupancy = await sr.from('home_network_occupants').insert([
  {
    essid: A_ESSID,
    owner_key: victim.publicKeyHex,
    workstation_machine_id: A_WS,
    workstation_username: 'anton',
    workstation_machine_name: 'victimbox',
    workstation_root_hash: md5('victim-root-secret'),
  },
  // B's own home network, so the server can derive the address B OWNS.
  {
    essid: B_ESSID,
    owner_key: attacker.publicKeyHex,
    workstation_machine_id: B_WS,
    workstation_username: 'mallory',
    workstation_machine_name: 'cracklab',
    workstation_root_hash: md5('attacker-root-secret'),
  },
  {
    essid: C_ESSID,
    owner_key: bystander.publicKeyHex,
    workstation_machine_id: C_WS,
    workstation_username: 'erlich',
    workstation_machine_name: 'borrowed',
    workstation_root_hash: md5('bystander-root-secret'),
  },
]);
if (occupancy.error) throw new Error(`occupancy seed failed: ${occupancy.error.message}`);

console.log(`victim box   ${A_WS}  (${A_ESSID} @ ${A_PUBLIC_IP})`);
console.log(`attacker box ${B_WS}  (${B_ESSID} @ ${B_PUBLIC_IP})`);
console.log(`pivot box    ${C_WS}  (${C_ESSID} @ ${C_PUBLIC_IP})`);
console.log(`npc host     ${npcHost.hostname} (${npcHost.ip})  ${NPC_MACHINE}`);
console.log('');

// === 1. No session on the box → refused, and nothing written ========================
const uninvited = await downgrade();
check(
  '1. a player holding nothing on the box cannot record a rollback on it',
  uninvited.status === 403 && errorOf(uninvited.body) === 'no_session',
  `status ${uninvited.status} ${errorOf(uninvited.body) ?? '-'}`,
);
check(
  '2. and nothing was written on the way to being refused',
  (await rowCount(A_WS)) === 0,
  `${await rowCount(A_WS)} dpkg.log rows on the victim box`,
);

// === 2. With a session: the line lands under the OWNER's row ========================
await seedSession(A_WS, A_ESSID, 'ssh-target-dpkg-wirecheck');
const rolled = await downgrade();
check(
  '3. an ssh session on the box authorizes the record',
  rolled.status === 200,
  `status ${rolled.status} ${JSON.stringify(rolled.body)}`,
);

const owned = await logRow(A_WS);
check(
  "4. the line is filed under the BOX OWNER's key, not the visitor's",
  owned !== null && owned.writerKey === victim.publicKeyHex,
  owned === null
    ? '(no dpkg.log row)'
    : `writer ${owned.writerKey.slice(0, 12)}… (victim ${victim.publicKeyHex.slice(0, 12)}…)`,
);

// === 3. Both releases, in dpkg's order, and the address the SERVER derived ==========
const line = owned === null ? '' : latestLine(owned.content);
check(
  '5. the line names the release the box left before the one it landed on',
  line.includes(`downgrade ${PACKAGE} ${FROM_VERSION} ${TO_VERSION}`),
  line || '(no line)',
);
check(
  '6. the address is the one the SERVER derived, never the one the caller claimed',
  line.includes(`Client "${B_PUBLIC_IP}"`) && !line.includes(CLAIMED_IP),
  `${line || '(no line)'}  — claimed ${CLAIMED_IP}, B owns ${B_PUBLIC_IP}`,
);

// === 4. THE PIVOT — the branch nothing else can prove ==============================
// Standing on C, reaching A. The victim's log must name C's network: B's own address
// never touched this box, and A's own is the one address it cannot have been.
await sr.from('patches').delete().eq('machine_id', A_WS);
await seedPivotAndTarget();
const viaPivot = await downgrade({ caller_machine_id: C_WS });
check(
  '7. a rollback run from a box the visitor is STANDING on is accepted',
  viaPivot.status === 200,
  `status ${viaPivot.status} ${JSON.stringify(viaPivot.body)}`,
);

const pivoted = await logRow(A_WS);
const pivotLine = pivoted === null ? '' : latestLine(pivoted.content);
check(
  "8. and it is addressed from the PIVOT's network, not the visitor's home nor the box's own",
  pivotLine.includes(`Client "${C_PUBLIC_IP}"`) &&
    !pivotLine.includes(B_PUBLIC_IP) &&
    !pivotLine.includes(A_PUBLIC_IP),
  `${pivotLine || '(no line)'}  — pivot ${C_PUBLIC_IP}, home ${B_PUBLIC_IP}, target ${A_PUBLIC_IP}`,
);

// === 5. A box claimed as a vantage but not held is refused =========================
await sr.from('patches').delete().eq('machine_id', A_WS);
await seedSession(A_WS, A_ESSID, 'ssh-target-dpkg-wirecheck');
const borrowedVantage = await downgrade({ caller_machine_id: C_WS });
check(
  '9. claiming to stand on a box they hold no session on is refused, and writes nothing',
  borrowedVantage.status === 403 && (await rowCount(A_WS)) === 0,
  `status ${borrowedVantage.status} ${errorOf(borrowedVantage.body) ?? '-'}, rows ${await rowCount(A_WS)}`,
);

// === 6. An unowned generated host keeps the CALLER's own row =======================
await seedSession(NPC_MACHINE, A_ESSID, 'ssh-npc-dpkg-wirecheck');
const onNpc = await downgrade({ machine_id: NPC_MACHINE });
check(
  '10. a rollback on a host nobody owns is accepted',
  onNpc.status === 200,
  `status ${onNpc.status} ${JSON.stringify(onNpc.body)}`,
);

const npcRow = await logRow(NPC_MACHINE);
const npcLine = npcRow === null ? '' : latestLine(npcRow.content);
check(
  "11. it lands in the CALLER's own row, at the address they reported",
  npcRow !== null &&
    npcRow.writerKey === attacker.publicKeyHex &&
    npcLine.includes(`Client "${CLAIMED_IP}"`),
  npcRow === null ? '(no dpkg.log row)' : `writer ${npcRow.writerKey.slice(0, 12)}…; ${npcLine}`,
);

// === 7. A blank version is refused rather than rendered ============================
await sr.from('patches').delete().eq('machine_id', A_WS);
await seedSession(A_WS, A_ESSID, 'ssh-target-dpkg-wirecheck');
const hollow = await downgrade({ to_version: '' });
check(
  '12. a blank version is refused rather than written as a line with a hole in it',
  hollow.status === 400 && (await rowCount(A_WS)) === 0,
  `status ${hollow.status} ${errorOf(hollow.body) ?? '-'}, rows ${await rowCount(A_WS)}`,
);

// === 8. The history accumulates ===================================================
const first = await downgrade();
const second = await downgrade({ package_name: 'vsftpd', from_version: '3.0.5', to_version: '3.0.3' });
const both = await logRow(A_WS);
check(
  '13. a second rollback appends rather than replacing the first',
  first.status === 200 &&
    second.status === 200 &&
    both !== null &&
    both.content.includes(`downgrade ${PACKAGE} ${FROM_VERSION} ${TO_VERSION}`) &&
    both.content.includes('downgrade vsftpd 3.0.5 3.0.3'),
  both === null ? '(no dpkg.log row)' : `${both.content.trimEnd().split('\n').length} line(s)`,
);

// === 9. The grant dies with the session ===========================================
await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
const afterQuit = await downgrade();
check(
  '14. a visitor who left can no longer record rollbacks on the box',
  afterQuit.status === 403,
  `status ${afterQuit.status} ${errorOf(afterQuit.body) ?? '-'}`,
);

// --- Teardown ----------------------------------------------------------------------
await clean();

const failed = results.filter((result) => !result.pass).length;
console.log('');
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
