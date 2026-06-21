// Wire-payload smoke for Slice 7.5b — a same-WiFi LAN scan leaves a truthful kern.log
// trace on a REAL fellow occupant's box, sourced from the scanner's LAN IP. Drives the
// REAL /api/patches endpoint (nmapScan) against a running `vercel dev` + supabase,
// seeding A's + B's occupancy rows + A's sshd pidfile via service_role (as A's and B's
// joins + A's `sshd` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B (a live occupant of X) `nmap <A's LAN IP>` → ONE `[iptables] Port scan from
//     <B's LAN IP> — probed ports 22` line lands on A's WORKSTATION kern.log, keyed by
//     A's OWNER writer_key (decision 1), naming A's hostname, listing A's REAL ports.
//   - The source is B's server-derived LAN IP — NOT a forged client source_ip, NOT B's
//     home public IP.
//   - A range covering A traces A too; scanners accrete into the one owner-keyed row.
//   - A NON-occupant caller traces nobody (the LAN-boundary gate).
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanScanTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';

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

const KERN_LOG = '/var/log/kern.log';

/** Read a machine's kern.log row keyed by the OWNER's writer_key — the single canonical
 *  row the system writes its scan lines to (decision 1). */
const readKernLog = async (machineId: string, ownerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', KERN_LOG)
    .eq('writer_key', ownerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lineCount = (log: string): number => (log.trim() === '' ? 0 : log.trim().split('\n').length);

// --- Identities: A (the target/owner), B (a fellow occupant + scanner), C (a non-occupant). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'SAME-LAN-SCAN-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_LAN = assignHomeNetwork(alice.publicKeyHex, ESSID).localIp; // A's ws LAN ip
const B_LAN = assignHomeNetwork(bob.publicKeyHex, ESSID).localIp; // B's LAN ip — the source
const B_PUBLIC = assignHomeNetwork(bob.publicKeyHex, ESSID).publicIp; // must NOT appear
const SUBNET = assignHomeNetwork(alice.publicKeyHex, ESSID).localIp.split('.').slice(0, 3).join('.');
const FORGED_SOURCE = '203.0.113.250'; // a client-claimed source_ip the server must ignore

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const occupancyRow = (owner: ReturnType<typeof generateIdentity>, wsName: string) => ({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

// Clean slate, then seed A's + B's occupancy rows and A's workstation sshd pidfile (a
// fresh ws has an empty /var/run — dark until its `sshd` starts).
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr
  .from('home_network_occupants')
  .insert([occupancyRow(alice, A_WS_NAME), occupancyRow(bob, B_WS_NAME)]);
await sr.from('patches').insert([
  {
    machine_id: A_WS,
    path: '/var/run/sshd.pid',
    content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
    owner: 'root',
    permissions: WORLD_PID,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
]);

const scan = (caller: ReturnType<typeof generateIdentity>, target: string) =>
  signRequest(caller, 'nmapScan', { essid: ESSID, target, source_ip: FORGED_SOURCE });

// === 1. B (occupant) nmap <A's LAN IP> → 200 + a kern.log scan line from B's LAN IP. ===
const s1 = await post(PATCHES, scan(bob, A_LAN));
const log1 = await readKernLog(A_WS, alice.publicKeyHex);
check('B (occupant) nmap <A LAN IP> is accepted', s1.status === 200, `status=${s1.status}`);
check(
  'A’s WORKSTATION kern.log records "[iptables] Port scan from <B’s LAN IP> — probed ports 22", naming the host',
  log1.includes(`Port scan from ${B_LAN}`) &&
    log1.includes('probed ports 22') &&
    log1.includes(`${A_WS_NAME} kernel:`),
  `line=${log1.trim().split('\n').slice(-1)[0] ?? '(empty)'}`,
);

// === 2. The source is B's LAN IP — never the forged client source_ip, never B's public IP. ===
check(
  'the trace source is B’s LAN IP, not the forged client source_ip and not B’s home public IP',
  log1.includes(B_LAN) && !log1.includes(FORGED_SOURCE) && !log1.includes(B_PUBLIC),
  `lanIp=${B_LAN} forgedAbsent=${!log1.includes(FORGED_SOURCE)} publicAbsent=${!log1.includes(B_PUBLIC)}`,
);

// === 3. A range covering A traces A too; scanners accrete into the one owner-keyed row. ===
const before3 = lineCount(log1);
const s3 = await post(PATCHES, scan(bob, `${SUBNET}.1-254`));
const log3 = await readKernLog(A_WS, alice.publicKeyHex);
check(
  'a range covering A adds another scan line to the SAME owner-keyed row (accretion)',
  s3.status === 200 && lineCount(log3) > before3 && log3.includes(`Port scan from ${B_LAN}`),
  `before=${before3} after=${lineCount(log3)}`,
);

// === 4. A NON-occupant caller traces nobody (LAN-boundary gate). ===
const before4 = await readKernLog(A_WS, alice.publicKeyHex);
const s4 = await post(PATCHES, scan(carol, A_LAN));
const after4 = await readKernLog(A_WS, alice.publicKeyHex);
check(
  'a non-occupant caller traces nobody — A’s kern.log is unchanged',
  s4.status === 200 && before4 === after4,
  `status=${s4.status} logUnchanged=${before4 === after4}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
