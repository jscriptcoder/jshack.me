// Wire-check: can a listener behind a NAT forward be FOUND and ENTERED from another
// network entirely — and does it stop being either the moment it is taken away?
//
// This is the last claim D5 makes, and the one `tsc` can see least of. Every hop
// crosses the api/ runtime: the public scan resolves the AP's occupants, reads each
// forward's target journal, and decides liveness per forward; the knock re-resolves
// the same routing and then reads a tier off a pidfile in a tree the server rebuilt.
// A unit test asserts each handler's return value against fake deps. Only this
// asserts the rows, the endpoints, and the two of them agreeing.
//
// The checks below carry the slice; the third, the seventh and the last carry most
// of it:
//
//   1. an outsider's scan of the AP's public IP lists the forwarded port, and calls
//      it `unknown` — an open port nobody can name is what makes a stranger reach
//      for `nc` at all;
//   2. a forward aimed at an address no occupant leases never appears. The world
//      leaves backdoors on NPC boxes, so forwarding one is the first thing a player
//      will try; NPCs lease nothing, and this is the line between the two;
//   3. `nc <public IP> <forwarded port>` from off-LAN lands a session on the
//      OCCUPANT's box, at the tier the pidfile records — the persistence loop
//      closing, across two networks;
//   4. nothing is written to the box it just let a stranger into. A backdoor is
//      silent on the far side of a NAT for the same reason it is silent on the LAN;
//   5. the dead forward refuses the knock as well as hiding from the scan;
//   6. an `nc` row on its own authorizes the SERVED tree, and the tree served is the
//      target's. The shell an intruder stands in reads that tree, so a gate that
//      answered only `ssh` would leave them looking at their own filesystem while
//      their writes landed on the target — which is exactly what a browser run found.
//      No unit test can see this: the session row is right either way;
//   7. killing the listener closes the port for the outside world too — it leaves
//      the scan AND refuses the knock that worked a moment ago. A door that
//      survived its own process on the public IP would be one no defender could shut.
//
// The public and internal ports are DELIBERATELY different numbers. Where they
// coincide, a handler reading the wrong end of the forward passes anyway.
//
// Drives the REAL /api/network + /api/sessions endpoints against a running
// `vercel dev` + local supabase, seeding join state via service_role.
//
// Usage (from v2/, with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testNcCrossPlayerReach.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import {
  formatListenerContent,
  listenerOn,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
  UNKNOWN_SERVICE,
} from '../src/core/services/pidfile';
import { deserializeTree } from '../src/core/filesystem/treeCodec';
import { md5 } from '../src/core/generation/md5';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { clearPublicIps, seedPublicIps } from './networkFixture';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

type ScannedPort = { readonly port?: number; readonly service?: string };

const scannedPorts = (body: unknown): readonly ScannedPort[] =>
  (body as { ports?: readonly ScannedPort[] } | null)?.ports ?? [];

const serviceAt = (body: unknown, port: number): string | undefined =>
  scannedPorts(body).find((entry) => entry.port === port)?.service;

const portList = (body: unknown): string =>
  scannedPorts(body)
    .map((entry) => `${entry.port}/${entry.service ?? '-'}`)
    .join(',');

// --- The world under test ------------------------------------------------------
// Alice holds a box on the shared AP. Somebody rooted it, left a listener behind,
// and published it through the gateway's NAT table. Carol is on another network
// entirely and knows none of them — she has only the public IP.

const alice = generateIdentity();
const carol = generateIdentity();

const ESSID = 'PORT-FORWARD-WIFI';
const CAROL_ESSID = 'ELSEWHERE-NET';
const AP_GATEWAY = computeApGatewayId(ESSID);
const AP_PUBLIC_IP = '203.0.113.181';
const CAROL_PUBLIC_IP = '192.0.2.181';

const ALICE_WS_NAME = 'daisy-chain';
const ALICE_WS = computeWorkstationId(ALICE_WS_NAME, alice.publicKeyHex);
const ALICE_OCTET = 63;
const ALICE_LAN = lanAddressFor(ESSID, ALICE_OCTET);
// An address on the same /24 that nobody leases — where an NPC box would sit.
const NPC_LAN = lanAddressFor(ESSID, 251);

const BACKDOOR_PORT = 4444;
const PUBLIC_PORT = 31337;
const DEAD_PUBLIC_PORT = 40404;
const PLANTER = 'mallory';

const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

// One shared gateway, one NAT table: the live forward onto Alice's listener, and a
// second aimed where no occupant is.
const FORWARD_RULES = [
  '# /etc/iptables/rules.v4 — NAT port-forward table',
  `forward ${PUBLIC_PORT} to ${ALICE_LAN}:${BACKDOOR_PORT}`,
  `forward ${DEAD_PUBLIC_PORT} to ${NPC_LAN}:${BACKDOOR_PORT}`,
  '',
].join('\n');

const occupantRow = (
  owner: ReturnType<typeof generateIdentity>,
  essid: string,
  wsName: string,
) => ({
  essid,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

/** The listener row, exactly as `nc -l` leaves it on the box it was planted on. */
const listenerRow = () => ({
  machine_id: ALICE_WS,
  path: listenerPidfilePath(BACKDOOR_PORT),
  content: formatListenerContent({ port: BACKDOOR_PORT, user: PLANTER, userType: 'root' }),
  owner: 'root',
  permissions: PIDFILE_PERMISSIONS,
  node_type: 'file',
  writer_key: alice.publicKeyHex,
  updated_at: new Date().toISOString(),
});

const scan = () => post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: AP_PUBLIC_IP }));

const knock = (sessionId: string, port: number) =>
  post(
    SESSIONS,
    signRequest(carol, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: AP_PUBLIC_IP,
      port,
      kind: 'nc',
      parent_session_id: null,
      source_ip: null,
    }),
  );

const sessionRow = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id, credentials, kind')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as {
    machine_id: string;
    credentials: { username: string; userType: string };
    kind: string;
  } | null;
};

const authLogRows = async (): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('path')
    .eq('machine_id', ALICE_WS)
    .eq('path', AUTH_LOG_PATH);
  return data?.length ?? 0;
};

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: ESSID, publicIp: AP_PUBLIC_IP },
    { essid: CAROL_ESSID, publicIp: CAROL_PUBLIC_IP },
  ]);
  await sr.from('home_network_occupants').delete().in('essid', [ESSID, CAROL_ESSID]);
  // Leases are permanent by design, so a re-run would otherwise find the octet held.
  await sr.from('network_lan_leases').delete().in('essid', [ESSID, CAROL_ESSID]);
  for (const machineId of [AP_GATEWAY, ALICE_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', carol.publicKeyHex);
};

// --- Setup ---------------------------------------------------------------------

await clean();
await seedPublicIps(sr, [
  { essid: ESSID, publicIp: AP_PUBLIC_IP },
  { essid: CAROL_ESSID, publicIp: CAROL_PUBLIC_IP },
]);
await sr.from('network_lan_leases').insert([
  { essid: ESSID, owner_key: alice.publicKeyHex, octet: ALICE_OCTET },
  { essid: CAROL_ESSID, owner_key: carol.publicKeyHex, octet: 42 },
]);
await sr
  .from('home_network_occupants')
  .insert([occupantRow(alice, ESSID, ALICE_WS_NAME), occupantRow(carol, CAROL_ESSID, 'serenity')]);
await sr.from('patches').insert([
  {
    machine_id: AP_GATEWAY,
    path: RULES,
    content: FORWARD_RULES,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
  listenerRow(),
]);

// === 1. A stranger's scan finds the port, and cannot name it. ===================

const found = await scan();
check(
  'nmap <AP public IP> lists the forwarded backdoor, service unknown',
  found.status === 200 && serviceAt(found.body, PUBLIC_PORT) === UNKNOWN_SERVICE,
  `status=${found.status} ports=[${portList(found.body)}]`,
);

// === 2. The forward aimed where no occupant is stays invisible. =================

check(
  'a forward aimed at an address no occupant leases never appears in the scan',
  serviceAt(found.body, DEAD_PUBLIC_PORT) === undefined,
  `ports=[${portList(found.body)}]`,
);

// === 3. And a stranger walks through it, onto the occupant's box. ===============

const entered = await knock('nc-reach-1', PUBLIC_PORT);
const enteredRow = await sessionRow('nc-reach-1');
check(
  'nc <AP public IP> <forwarded port> lands a session on the OCCUPANT’s box',
  entered.status === 200 && enteredRow?.machine_id === ALICE_WS && enteredRow.kind === 'nc',
  `status=${entered.status} machine=${enteredRow?.machine_id ?? '—'} kind=${enteredRow?.kind ?? '—'}`,
);
check(
  'the row carries the pidfile’s user and tier, read across two networks',
  enteredRow?.credentials.username === PLANTER && enteredRow?.credentials.userType === 'root',
  `user=${enteredRow?.credentials.username ?? '—'} tier=${enteredRow?.credentials.userType ?? '—'}`,
);

// === 4. Silently. ==============================================================

const logged = await authLogRows();
check(
  'the occupant’s auth.log is untouched — a backdoor is silent across a NAT too',
  logged === 0,
  `${logged} auth.log row(s) on ${ALICE_WS}`,
);

// === 5. The tree that shell reads is the TARGET's. ===============================
// `authorizeMachineAccess` gates the served-tree fetch on an active session row
// whatever kind it is — asserted here rather than believed, because the whole client
// fix rests on it and `tsc` cannot see a session table.

const served = await post(
  NETWORK,
  signRequest(carol, 'resolveCrossPlayerFs', { machine_id: ALICE_WS }),
);
const servedTree = (served.body as { tree?: unknown } | null)?.tree;
const tree =
  servedTree === undefined || servedTree === null
    ? null
    : deserializeTree(servedTree as Parameters<typeof deserializeTree>[0]);
check(
  'an nc row alone is served the target’s own tree, listener and all',
  served.status === 200 && tree !== null && listenerOn(tree, BACKDOOR_PORT) !== null,
  `status=${served.status} listener=${tree === null ? 'no tree' : String(listenerOn(tree, BACKDOOR_PORT) !== null)}`,
);

// === 6. The dead forward refuses the knock as well. =============================

await sr.from('sessions').delete().eq('player_key', carol.publicKeyHex);
const atNobody = await knock('nc-reach-2', DEAD_PUBLIC_PORT);
check(
  'a forward aimed at nobody refuses the knock too, and lands no row',
  atNobody.status === 404 && (await sessionRow('nc-reach-2')) === null,
  `status=${atNobody.status}`,
);

// === 7. Killing the listener shuts the public port too. =========================
// The defender never touches the gateway: they kill a process on their own box, and
// a port they never published stops answering the internet.

await sr.from('sessions').delete().eq('player_key', carol.publicKeyHex);
await sr
  .from('patches')
  .delete()
  .eq('machine_id', ALICE_WS)
  .eq('path', listenerPidfilePath(BACKDOOR_PORT));

const afterKill = await scan();
check(
  'killing the listener drops the forward from the public scan',
  afterKill.status === 200 && serviceAt(afterKill.body, PUBLIC_PORT) === undefined,
  `status=${afterKill.status} ports=[${portList(afterKill.body)}]`,
);

const shut = await knock('nc-reach-3', PUBLIC_PORT);
check(
  'and refuses the knock that worked a moment ago, landing no row',
  shut.status === 404 && (await sessionRow('nc-reach-3')) === null,
  `status=${shut.status}`,
);

// --- Teardown ------------------------------------------------------------------

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
