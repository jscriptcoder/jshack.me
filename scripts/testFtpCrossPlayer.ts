// Wire-payload smoke for D3 slice 6 — B reaches A's ftp door across the network, and A
// reads the whole visit out of their own log. Drives the REAL /api/sessions and
// /api/patches endpoints against a running `vercel dev` + supabase, seeding A's AP, A's
// forward and A's running daemon via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `authCreateSessionPublic` carrying a `kind` and a `caller_machine_id`: the door
//     decides which log the visit lands in, and the box named decides the address.
//   - the port-serves-the-door check: a forward names ONE internal port, so a forward
//     to sshd must not be an ftp door (and the reverse).
//   - `recordFtpTransfer` on a FOREIGN box: the occupancy reverse-lookup that routes the
//     line to the machine owner's row, and the occupancy -> public-ip walk that names the
//     address. Both are column selections no unit test can get wrong.
//   - the whole visit landing in ONE row: the login and the transfers share a writer key,
//     or the journal replays with one of them erased.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { md5 } from '../src/core/generation/md5';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import type { Directory, FileNode } from '../src/core/filesystem/types';
import { clearPublicIps, seedPublicIps } from './networkFixture';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const entryAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

// --- The parties. A (the defender) runs the door; B (the visitor) lives on a different
//     network entirely and reaches it only by A's public address. ---
const defender = generateIdentity();
const visitor = generateIdentity();

const A_ESSID = 'PIED-PIPER-GUEST';
const A_PUBLIC_IP = '203.0.113.77';
const A_GATEWAY = computeApGatewayId(A_ESSID);
const A_WS = computeWorkstationId('anton', defender.publicKeyHex);
const A_OCTET = 23;
const A_LAN_IP = lanAddressFor(A_ESSID, A_OCTET);
const A_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);
// The two doors A publishes. Neither is 22 or 21: on a public address those belong to
// the AP's own gateway, which is a different machine.
const FTP_FORWARD = 2121;
const SSH_FORWARD = 5544;

// B's own network — what the server must walk to derive the address A's log records.
// Nothing B sends can name it.
const B_ESSID = 'BEAN-THERE-WIFI';
const B_PUBLIC_IP = '198.51.100.44';
const B_WS = computeWorkstationId('cracklab', visitor.publicKeyHex);

// A THIRD network, so the pivot has somewhere to point that is neither B's home nor A's.
const bystander = generateIdentity();
const C_ESSID = 'HOOLI-XYZ';
const C_PUBLIC_IP = '203.0.113.99';
const C_WS = computeWorkstationId('erlich', bystander.publicKeyHex);
const C_OCTET = 31;
// The hop that puts B on C's box, stamped as a real ssh login would stamp it.
const PIVOT_SESSION = 'ssh-pivot-ftp-wirecheck';

const TAKEN = '/etc/secrets.conf';
const TAKEN_BYTES = 41;
const LEFT = '/tmp/dropped.sh';
const LEFT_BYTES = 512;
const SEALED = '/root/dropped.sh';

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: A_ESSID, publicIp: A_PUBLIC_IP },
    { essid: B_ESSID, publicIp: B_PUBLIC_IP },
    { essid: C_ESSID, publicIp: C_PUBLIC_IP },
  ]);
  for (const essid of [A_ESSID, B_ESSID, C_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  for (const id of [A_GATEWAY, A_WS, B_WS, C_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
};

await clean();

// A's network as a real join leaves it: a public IP, the occupancy row, and the lease
// their published forward names.
await seedPublicIps(sr, [{ essid: A_ESSID, publicIp: A_PUBLIC_IP }]);
await sr
  .from('network_lan_leases')
  .insert({ essid: A_ESSID, owner_key: defender.publicKeyHex, octet: A_OCTET });
await sr.from('home_network_occupants').insert({
  essid: A_ESSID,
  owner_key: defender.publicKeyHex,
  workstation_machine_id: A_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: 'anton',
  workstation_root_hash: md5('defender-root-secret'),
});

// B's own home network, so the server can derive B's public address.
await seedPublicIps(sr, [{ essid: B_ESSID, publicIp: B_PUBLIC_IP }]);
await sr.from('home_network_occupants').insert({
  essid: B_ESSID,
  owner_key: visitor.publicKeyHex,
  workstation_machine_id: B_WS,
  workstation_username: 'mallory',
  workstation_machine_name: 'cracklab',
  workstation_root_hash: md5('visitor-root-secret'),
});

const asDefender = (machineId: string, path: string, content: string) => ({
  machine_id: machineId,
  path,
  writer_key: defender.publicKeyHex,
  content,
  owner: 'root',
  node_type: 'file',
  permissions: { read: ['root'], write: ['root'], execute: [] },
});

// The forward table lives on the GATEWAY; the running daemons live on A's box. A forward
// bridges two machines, and a live check must seed both. Both doors are published: the
// ftp one is the door under test, the ssh one is what proves a forward is not a door to
// every daemon.
const seeded = await sr.from('patches').upsert(
  [
    asDefender(
      A_GATEWAY,
      '/etc/iptables/rules.v4',
      [`forward ${FTP_FORWARD} to ${A_LAN_IP}:21`, `forward ${SSH_FORWARD} to ${A_LAN_IP}:22`].join(
        '\n',
      ),
    ),
    asDefender(A_WS, '/var/run/vsftpd.pid', 'vsftpd:port=21'),
    asDefender(A_WS, '/var/run/sshd.pid', 'sshd:port=22'),
  ],
  { onConflict: 'machine_id,path,writer_key' },
);
if (seeded.error) throw new Error(`forward seed failed: ${seeded.error.message}`);

const loginEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(visitor, 'authCreateSessionPublic', {
    session_id: `ftp-visitor-${Date.now()}-${Math.round(performance.now())}`,
    target: A_PUBLIC_IP,
    port: FTP_FORWARD,
    username: 'guest',
    password: A_GUEST_PW,
    parent_session_id: null,
    // The address B CLAIMS. It must never reach the log — every check below reads
    // A's file for the address the server derived instead.
    source_ip: '10.0.0.66',
    kind: 'ftp',
    caller_machine_id: B_WS,
    ...over,
  });

/** A's own vsftpd.log, read from the journal rather than trusted from a handler's
 *  answer — with the writer key, because whose row it lands in is half the claim. */
const logRow = async (
  machineId: string,
  path: string,
): Promise<{ content: string; writerKey: string } | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  const row = data as { content: string; writer_key: string } | null;
  return row === null ? null : { content: row.content, writerKey: row.writer_key };
};

const vsftpdLog = () => logRow(A_WS, VSFTPD_LOG_PATH);

/** The most recent line the daemon wrote. Every append ends with a newline, so the
 *  naive last element is the empty string after it. */
const latestLine = (content: string): string => content.trimEnd().split('\n').at(-1) ?? '';

// --- 1. The door opens from outside, and lands on A's REAL machine. ---
const login = await post(SESSIONS, loginEnvelope());
const landedOn = (login.body as { machine_id?: string } | null)?.machine_id;
check(
  '1. an ftp login through the forward lands on the box behind it',
  login.status === 200 && landedOn === A_WS,
  `status ${login.status}; ${JSON.stringify(login.body)}`,
);

// --- 2. The session is an ftp row, not a hop. ---
const { data: sessionRows } = await sr
  .from('sessions')
  .select('kind, machine_id, essid, credentials')
  .eq('player_key', visitor.publicKeyHex);
const ftpRow = (sessionRows ?? []).find(
  (row) => (row as { machine_id: string }).machine_id === A_WS,
) as { kind?: string; essid?: string; credentials?: { userType?: string } } | undefined;
check(
  "2. the row records the door, the target's network and the tier the credential bought",
  ftpRow?.kind === 'ftp' && ftpRow.essid === A_ESSID && ftpRow.credentials?.userType === 'guest',
  JSON.stringify(ftpRow ?? null),
);

// --- 3. The visit is in A's OWN vsftpd.log — not auth.log, which ssh owns. ---
const afterLogin = await vsftpdLog();
check(
  '3. the login is recorded in the box vsftpd.log, arrival and all',
  afterLogin !== null &&
    afterLogin.content.includes('CONNECT: Client') &&
    afterLogin.content.includes('[guest] OK LOGIN'),
  afterLogin === null ? 'no vsftpd.log row' : afterLogin.content.split('\n').slice(-2).join(' | '),
);
check(
  '4. the ftp door writes nothing into auth.log',
  (await logRow(A_WS, AUTH_LOG_PATH)) === null,
  'auth.log absent on the target',
);

// --- 5. The address is B's, server-derived. The one B claimed is nowhere. ---
check(
  "5. the line names B's server-derived address, never the one B sent",
  afterLogin !== null &&
    afterLogin.content.includes(`Client "${B_PUBLIC_IP}"`) &&
    !afterLogin.content.includes('10.0.0.66'),
  afterLogin === null ? 'no vsftpd.log row' : latestLine(afterLogin.content),
);

// --- 6. The row belongs to A. A visitor-keyed row would split A's log in two. ---
check(
  '6. the log accretes under the BOX owner key, never the visitor',
  afterLogin !== null &&
    afterLogin.writerKey === defender.publicKeyHex &&
    afterLogin.writerKey !== visitor.publicKeyHex,
  afterLogin === null ? 'no vsftpd.log row' : `writer ${afterLogin.writerKey.slice(0, 12)}...`,
);

// --- 7/8. A forward names ONE internal port. ---
const wrongDoor = await post(SESSIONS, loginEnvelope({ port: SSH_FORWARD }));
check(
  '7. an ftp login on a forward that reaches sshd is refused',
  wrongDoor.status === 404 && errorOf(wrongDoor.body) === 'service_not_running',
  `status ${wrongDoor.status}; error ${errorOf(wrongDoor.body)}`,
);
const sshOnFtp = await post(
  SESSIONS,
  loginEnvelope({ kind: 'ssh', session_id: `ssh-wrong-${Date.now()}` }),
);
check(
  '8. an ssh login on the ftp forward is refused, the same rule the other way',
  sshOnFtp.status === 404 && errorOf(sshOnFtp.body) === 'service_not_running',
  `status ${sshOnFtp.status}; error ${errorOf(sshOnFtp.body)}`,
);

// --- 9/10. A take, itemised. The session the login just created is what authorizes it. ---
const took = await post(
  PATCHES,
  signRequest(visitor, 'recordFtpTransfer', {
    direction: 'download',
    machine_id: A_WS,
    path: TAKEN,
    bytes: TAKEN_BYTES,
    source_ip: '10.0.0.66',
    caller_machine_id: B_WS,
  }),
);
const afterTake = await vsftpdLog();
check(
  '9. a file taken off the box is itemised in the same file the login is in',
  took.status === 200 &&
    afterTake !== null &&
    afterTake.content.includes(`OK DOWNLOAD: Client "${B_PUBLIC_IP}", "${TAKEN}", ${TAKEN_BYTES}`),
  `status ${took.status}; ${afterTake === null ? 'no row' : latestLine(afterTake.content)}`,
);
check(
  '10. login and transfer share ONE row, so A reads the whole visit',
  afterTake !== null &&
    afterTake.writerKey === defender.publicKeyHex &&
    afterTake.content.includes('OK LOGIN') &&
    afterTake.content.includes('OK DOWNLOAD'),
  afterTake === null ? 'no row' : `writer ${afterTake.writerKey.slice(0, 12)}...; ${afterTake.content.split('\n').length} lines`,
);

// --- 11/12/13. A drop, gated by the tier the credential bought — the epic's claim, live
//     across the network: an ftp row authorizes a write through the shipped endpoint. ---
const drop = (path: string) =>
  post(
    PATCHES,
    signRequest(visitor, 'upsertPatch', {
      machine_id: A_WS,
      path,
      content: '#!/bin/sh\necho owned\n',
      owner: 'guest',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      node_type: 'file',
      is_new: true,
    }),
  );

const landed = await drop(LEFT);
check(
  '11. an ftp session authorizes a write on the box, through the SAME endpoint ssh uses',
  landed.status === 200,
  `status ${landed.status}; ${JSON.stringify(landed.body)}`,
);
const sealed = await drop(SEALED);
check(
  '12. the same session cannot write where its tier may not, across the network as on the LAN',
  sealed.status === 403,
  `status ${sealed.status}; error ${errorOf(sealed.body)}`,
);

await post(
  PATCHES,
  signRequest(visitor, 'recordFtpTransfer', {
    direction: 'upload',
    machine_id: A_WS,
    path: LEFT,
    bytes: LEFT_BYTES,
    source_ip: null,
    caller_machine_id: B_WS,
  }),
);
const afterDrop = await vsftpdLog();
check(
  '13. what was LEFT on the box is itemised beside what was taken, in order',
  afterDrop !== null &&
    afterDrop.content.includes(`OK UPLOAD: Client "${B_PUBLIC_IP}", "${LEFT}", ${LEFT_BYTES}`) &&
    afterDrop.content.indexOf('OK DOWNLOAD') < afterDrop.content.indexOf('OK UPLOAD'),
  afterDrop === null ? 'no row' : afterDrop.content.split('\n').slice(-2).join(' | '),
);

// --- 14. Standing somewhere you hold no session is refused, not traced. ---
const framed = await post(
  PATCHES,
  signRequest(visitor, 'recordFtpTransfer', {
    direction: 'download',
    machine_id: A_WS,
    path: TAKEN,
    bytes: TAKEN_BYTES,
    source_ip: null,
    caller_machine_id: C_WS,
  }),
);
check(
  '14. a visitor naming a box they hold no session on is refused',
  framed.status === 403 && errorOf(framed.body) === 'no_session',
  `status ${framed.status}; error ${errorOf(framed.body)}`,
);

// --- 15/16. The pivot: B stands on C's box and reaches A from there. What A's log has
//     to record is the network the visit came from — C's, not B's own. ---
await seedPublicIps(sr, [{ essid: C_ESSID, publicIp: C_PUBLIC_IP }]);
await sr
  .from('network_lan_leases')
  .insert({ essid: C_ESSID, owner_key: bystander.publicKeyHex, octet: C_OCTET });
await sr.from('home_network_occupants').insert({
  essid: C_ESSID,
  owner_key: bystander.publicKeyHex,
  workstation_machine_id: C_WS,
  workstation_username: 'erlich',
  workstation_machine_name: 'aviato',
  workstation_root_hash: md5('bystander-root-secret'),
});
await sr.from('sessions').insert({
  session_id: PIVOT_SESSION,
  player_key: visitor.publicKeyHex,
  machine_id: C_WS,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: C_ESSID,
  created_at: '2020-01-01T00:00:00.000Z',
});

const pivotLogin = await post(
  SESSIONS,
  loginEnvelope({
    session_id: `ftp-pivot-${Date.now()}`,
    caller_machine_id: C_WS,
  }),
);
const afterPivot = await vsftpdLog();
check(
  '15. a login launched from a box on another network still opens the door',
  pivotLogin.status === 200,
  `status ${pivotLogin.status}; ${JSON.stringify(pivotLogin.body)}`,
);
check(
  '16. and A reads the network it was launched FROM, not the one B owns',
  afterPivot !== null &&
    latestLine(afterPivot.content).includes(`Client "${C_PUBLIC_IP}"`),
  afterPivot === null ? 'no row' : latestLine(afterPivot.content),
);

// --- 17/18. The tree the door hands over. `authorizeMachineAccess` gates the served-tree
//     fetch on an active session row whatever kind it is — asserted here rather than
//     believed, because the client renders whatever comes back and `tsc` cannot see a
//     session table. Every row B holds on A's box is an ftp login; the pivot row is on C.
//     Two files, because "the target's tree" and "the tier the credential bought" are two
//     claims and one file can only carry one of them. ---
const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] };
await sr.from('patches').insert([
  {
    writer_key: defender.publicKeyHex,
    machine_id: A_WS,
    path: '/srv/on-a-box.txt',
    content: 'BELONGS_TO_A',
    owner: 'root',
    permissions: worldReadable,
    node_type: 'file',
  },
  {
    writer_key: defender.publicKeyHex,
    machine_id: A_WS,
    path: '/srv/above-the-door.txt',
    content: 'NOT_FOR_GUESTS',
    owner: 'root',
    permissions: userOnly,
    node_type: 'file',
  },
]);

const served = await post(NETWORK, signRequest(visitor, 'resolveCrossPlayerFs', { machine_id: A_WS }));
const servedTree =
  served.status === 200
    ? deserializeTree((served.body as { tree: SerializedDirectory }).tree)
    : null;
const onABox = servedTree === null ? undefined : entryAt(servedTree, 'srv', 'on-a-box.txt');
check(
  "17. an ftp row alone is served the target's own tree",
  served.status === 200 && onABox?.kind === 'file' && onABox.content === 'BELONGS_TO_A',
  `status=${served.status} file=${onABox?.kind === 'file' ? onABox.content : 'absent'}`,
);
check(
  '18. and the tree is filtered to the tier the credential bought, not the box owner’s',
  servedTree !== null && entryAt(servedTree, 'srv', 'above-the-door.txt') === undefined,
  servedTree === null ? 'no tree' : `above-the-door=${String(entryAt(servedTree, 'srv', 'above-the-door.txt') !== undefined)}`,
);

await clean();

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
