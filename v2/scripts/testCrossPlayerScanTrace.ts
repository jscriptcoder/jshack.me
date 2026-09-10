// Wire-payload smoke for Story 6.1 — a cross-player public scan leaves a truthful
// kern.log trace on the TARGET's shared ROUTER record. Drives the REAL /api/network
// endpoint against a running `vercel dev` + supabase, seeding the occupancy rows via
// service_role (as the join would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B `nmap <A.publicIp>` (host up) → ONE `[iptables] Port scan from <B's home
//     public IP>` line lands on A's ROUTER kern.log, keyed by A's OWNER writer_key
//     (decision 1), naming A's seeded router hostname, with the ports B saw.
//   - The source IP is SERVER-DERIVED from B's verified key (B's home network's public IP),
//     NOT the client `source_ip` — a forged `source_ip` in the payload is ignored.
//   - Keystone: a SECOND scanner (C) accretes its own line into the SAME row instead
//     of collapsing it under the last-write-wins fold — both source IPs coexist.
//   - found:false (unknown public IP) writes nothing.
//   - `-sV`: each returned port carries the VERSION of the software behind it, read
//     from the TARGET's own package manifest server-side. This is the half `tsc`
//     cannot see — the client casts the response body rather than parsing it, so a
//     server that stopped sending the field would look identical to one that never
//     had it, and every unit test would stay green.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerScanTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { md5 } from '../src/core/generation/md5';
import { seedApGatewayHostname } from '../src/core/generation/routerFs';
import { clearPublicIps, seedPublicIps } from './networkFixture';
import { liveCve } from '../src/core/cve/liveCve';
import { gameDayAt } from '../src/core/cve/worldClock';
import { asEpochMs } from '../src/core/types';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

type WirePort = {
  readonly port: number;
  readonly service: string;
  readonly version?: string;
  readonly cve?: string;
  readonly severity?: string;
};

const portsOf = (body: unknown): readonly WirePort[] =>
  (body as { ports?: readonly WirePort[] } | null)?.ports ?? [];

const KERN_LOG = '/var/log/kern.log';

/** Read the ROUTER's kern.log row keyed by the OWNER's writer_key — the single
 *  canonical row the system writes its scan lines to (decision 1). */
const readRouterKernLog = async (routerId: string, ownerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', routerId)
    .eq('path', KERN_LOG)
    .eq('writer_key', ownerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

// --- Identities: A (the target/owner), B + C (two scanners with their own home nets). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const A_ESSID = 'ABSTERGO-NET';
const B_ESSID = 'BLUE-SUN-CAFE';
const C_ESSID = 'CYBERDYNE-GUEST';
const A_ROUTER = computeApGatewayId(A_ESSID);
const A_PUBLIC_IP = '203.0.113.92';
// B's + C's truthful source IPs: the public IPs in their seeded occupancy rows, which the
// server recovers from each verified key via their home network — never a client claim. Explicit
// constants, since this script seeds those rows directly (self-consistent with the asserts).
const B_PUBLIC_IP = '198.51.100.92';
const C_PUBLIC_IP = '192.0.2.92';
const A_ROUTER_HOST = seedApGatewayHostname(A_ESSID);

// Clean slate, then seed the three players' occupancy rows (as each player's join would).
await clearPublicIps(sr, [
  { essid: A_ESSID, publicIp: A_PUBLIC_IP },
  { essid: B_ESSID, publicIp: B_PUBLIC_IP },
  { essid: C_ESSID, publicIp: C_PUBLIC_IP },
]);
await sr.from('home_network_occupants').delete().in('essid', [A_ESSID, B_ESSID, C_ESSID]);
await sr.from('network_lan_leases').delete().in('essid', [A_ESSID, B_ESSID, C_ESSID]);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
// The join state a real `registerNetwork` writes for each player: their AP's public IP,
// plus themselves as an OCCUPANT of its ESSID. Occupancy is what makes a box reachable,
// and it is where the scanner's own source IP is derived from.
const occupantRow = (owner: ReturnType<typeof generateIdentity>, essid: string, wsName: string) => ({
  essid,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});
await seedPublicIps(sr, [
  { essid: A_ESSID, publicIp: A_PUBLIC_IP },
  { essid: B_ESSID, publicIp: B_PUBLIC_IP },
  { essid: C_ESSID, publicIp: C_PUBLIC_IP },
]);
await sr
  .from('home_network_occupants')
  .insert([
    occupantRow(alice, A_ESSID, 'skylab'),
    occupantRow(bob, B_ESSID, 'nebuchadnezzar'),
    occupantRow(carol, C_ESSID, 'serenity'),
  ]);
// The lease the join allocates BEFORE it writes the occupancy row. It is what fixes each
// occupant's LAN address — and on the AP itself, which occupant's row its ownerless
// system logs accrete under (the lowest octet leased, so the row never moves).
await sr.from('network_lan_leases').insert([
  { essid: A_ESSID, owner_key: alice.publicKeyHex, octet: 21 },
  { essid: B_ESSID, owner_key: bob.publicKeyHex, octet: 22 },
  { essid: C_ESSID, owner_key: carol.publicKeyHex, octet: 23 },
]);

// === 1. B scans A (host up) → one kern.log line on A's ROUTER under A's writer_key. ===
const s1 = await post(NETWORK, signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP }));
check(
  'B nmap <A.publicIp> resolves host-up with the router’s :22',
  s1.status === 200 && foundOf(s1.body),
  `status=${s1.status} found=${foundOf(s1.body)}`,
);

// The VERSION a scan reads. It has to survive the round trip as a real field on the
// wire: the client casts this body rather than parsing it, so nothing between here and
// the terminal would notice the server dropping it.
const routerSsh = portsOf(s1.body).find((openPort) => openPort.port === 22);
check(
  'the resolved :22 carries a VERSION read from A’s own manifest',
  routerSsh?.version === 'OpenSSH 9.7.0',
  `version=${routerSsh?.version ?? '(absent)'}`,
);
check(
  'every resolved port names its software, or honestly names none',
  portsOf(s1.body).every(
    (openPort) => openPort.version === undefined || /^\D.*\d+(\.\d+)*$/.test(openPort.version),
  ),
  portsOf(s1.body)
    .map((openPort) => `${openPort.port}=${openPort.version ?? '-'}`)
    .join(' '),
);

// The VULNERABILITY, on the same wire. The server derives it from the SAME manifest read
// that produced the version, on its OWN clock — nothing the client sent about time is
// consulted. Compared against what core says rather than a hardcoded id, so this asserts
// the field survived the round trip rather than re-asserting the derivation, and stays
// true whatever day the world stands on.
const expected = liveCve('openssh-server', '9.7.0', gameDayAt(asEpochMs(Date.now())));
check(
  'the resolved :22 carries the CVE the server derived from A’s own manifest',
  routerSsh?.cve === expected?.cve && routerSsh?.severity === expected?.severity,
  `wire=${routerSsh?.cve ?? '(absent)'}/${routerSsh?.severity ?? '-'} ` +
    `core=${expected?.cve ?? '(none yet)'}/${expected?.severity ?? '-'}`,
);
check(
  'no port claims a vulnerability without the version it is keyed on',
  portsOf(s1.body).every((openPort) => openPort.cve === undefined || openPort.version !== undefined),
  portsOf(s1.body)
    .map((openPort) => `${openPort.port}=${openPort.version ?? '-'}/${openPort.cve ?? '-'}`)
    .join(' '),
);

const log1 = await readRouterKernLog(A_ROUTER, alice.publicKeyHex);
check(
  'A’s router kern.log records the scan from B’s home public IP, naming the seeded router',
  log1.includes(`Port scan from ${B_PUBLIC_IP}`) && log1.includes(`${A_ROUTER_HOST} kernel:`),
  `line=${log1.trim().split('\n').slice(-1)[0] ?? '(empty)'}`,
);
check(
  'the trace lists the port B saw (22)',
  /probed ports [^\n]*\b22\b/.test(log1),
  `line=${log1.trim().split('\n').slice(-1)[0] ?? '(empty)'}`,
);

// === 2. A forged client source_ip in the payload is IGNORED (server derives B's IP). ===
await sr.from('patches').delete().eq('machine_id', A_ROUTER); // reset the row
await post(
  NETWORK,
  signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP, source_ip: '10.6.6.6' }),
);
const log2 = await readRouterKernLog(A_ROUTER, alice.publicKeyHex);
check(
  'a client-supplied source_ip is ignored — the line carries B’s home public IP, not the forged one',
  log2.includes(`Port scan from ${B_PUBLIC_IP}`) && !log2.includes('10.6.6.6'),
  `line=${log2.trim().split('\n').slice(-1)[0] ?? '(empty)'}`,
);

// === 3. Keystone: a SECOND scanner (C) accretes into the SAME row, not collapsing it. ===
await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: A_PUBLIC_IP }));
const log3 = await readRouterKernLog(A_ROUTER, alice.publicKeyHex);
check(
  'both B’s and C’s scans coexist in the one owner-keyed row (no last-write-wins collapse)',
  log3.includes(`Port scan from ${B_PUBLIC_IP}`) && log3.includes(`Port scan from ${C_PUBLIC_IP}`),
  `lines=${log3.trim().split('\n').length}`,
);

// === 4. found:false (unknown public IP) writes nothing. ===
const before = await readRouterKernLog(A_ROUTER, alice.publicKeyHex);
const s4 = await post(NETWORK, signRequest(bob, 'resolvePublicScan', { target: '203.0.113.250' }));
const after = await readRouterKernLog(A_ROUTER, alice.publicKeyHex);
check(
  'scanning an unregistered IP is host-down and writes no trace',
  s4.status === 200 && !foundOf(s4.body) && before === after,
  `found=${foundOf(s4.body)} logUnchanged=${before === after}`,
);

// Cleanup. The lease table is permanent by design, so a re-run would otherwise find the
// octets already held.
await clearPublicIps(sr, [
  { essid: A_ESSID, publicIp: A_PUBLIC_IP },
  { essid: B_ESSID, publicIp: B_PUBLIC_IP },
  { essid: C_ESSID, publicIp: C_PUBLIC_IP },
]);
await sr.from('home_network_occupants').delete().in('essid', [A_ESSID, B_ESSID, C_ESSID]);
await sr.from('network_lan_leases').delete().in('essid', [A_ESSID, B_ESSID, C_ESSID]);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
