// Wire-payload smoke for D2.4 slice 2 — B cracks the AP GATEWAY behind a stranger's
// PUBLIC IP. Drives the REAL /api/sessions endpoint against a running `vercel dev` +
// supabase, seeding the stranger's AP and B's wordlist via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the `hydraCrackPublic` route: its public-IP lookup, gateway journal read,
//     occupancy/lease reads, wordlist read and auth.log append, every one of which is
//     a column selection no unit test can get wrong.
//   - hydra and ssh AGREEING: the password the sweep reports is posted straight to
//     `authCreateSessionPublic`, which must accept it. This is the claim the whole
//     credential layer rests on, and only a live run proves both handlers resolve the
//     same box from the same address.
//   - the source IP the trace records, which is derived SERVER-side by walking
//     home_network_occupants -> network_public_ips for the attacker's own key.
//   - the writer key the trace accretes under: the AP's stable lowest-octet lease
//     holder, never the attacker, so two attackers cannot erase each other's lines.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHydraCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const crackedIn = (body: unknown): readonly { username: string; password: string }[] => {
  const cracked = (body as { cracked?: unknown } | null)?.cracked;
  return Array.isArray(cracked) ? (cracked as { username: string; password: string }[]) : [];
};

// --- Identities: the RESIDENT owns a box on the target AP (and, holding its only
//     lease, is the key its ownerless gateway logs under); the ATTACKER lives on a
//     different network entirely and reaches the AP only by its public IP. ---
const resident = generateIdentity();
const attacker = generateIdentity();

const TARGET_ESSID = 'PIED-PIPER-GUEST';
const TARGET_PUBLIC_IP = '203.0.113.77';
const TARGET_GATEWAY = computeApGatewayId(TARGET_ESSID);
const RESIDENT_WS = computeWorkstationId('anton', resident.publicKeyHex);
const ADMIN_PW = seedApGatewayAdminPw(TARGET_ESSID);
// The lease the resident holds — the address their published forward names, and (as
// the AP's only lease) the key its ownerless gateway logs under.
const RESIDENT_OCTET = 23;
// The door the resident opened to their own box. Not 22: on this address 22 is the
// gateway, a different machine.
const FORWARD_PORT = 5544;

// The attacker's OWN network — this is what the server must walk to derive the address
// the target records. Nothing the client sends can name it.
const ATTACKER_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_PUBLIC_IP = '198.51.100.44';
const ATTACKER_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);

const UNREGISTERED_IP = '203.0.113.254';

// A THIRD network, so the pivot has somewhere to point that is neither the attacker's
// home nor the network they are standing on. Without three parties the derived origin
// and the attacker's own address can be the same string by accident.
const bystander = generateIdentity();
const VICTIM_ESSID = 'HOOLI-XYZ';
const VICTIM_PUBLIC_IP = '203.0.113.99';
const VICTIM_GATEWAY = computeApGatewayId(VICTIM_ESSID);
const VICTIM_ADMIN_PW = seedApGatewayAdminPw(VICTIM_ESSID);
const BYSTANDER_WS = computeWorkstationId('erlich', bystander.publicKeyHex);
const BYSTANDER_OCTET = 31;
// The session that puts the attacker on the resident's box — an ssh hop, as
// `authCreateSessionPublic` would have written it after a successful login.
const PIVOT_SESSION = 'ssh-pivot-wirecheck';

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: TARGET_ESSID, publicIp: TARGET_PUBLIC_IP },
    { essid: ATTACKER_ESSID, publicIp: ATTACKER_PUBLIC_IP },
    { essid: VICTIM_ESSID, publicIp: VICTIM_PUBLIC_IP },
  ]);
  for (const essid of [TARGET_ESSID, ATTACKER_ESSID, VICTIM_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  for (const id of [TARGET_GATEWAY, ATTACKER_WS, RESIDENT_WS, VICTIM_GATEWAY, BYSTANDER_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
};

await clean();

// The target AP as a real join leaves it: a public IP, one occupant, and the lease
// that occupant holds — the lease is what gives the ownerless gateway a stable log key.
await seedPublicIps(sr, [{ essid: TARGET_ESSID, publicIp: TARGET_PUBLIC_IP }]);
await sr
  .from('network_lan_leases')
  .insert({ essid: TARGET_ESSID, owner_key: resident.publicKeyHex, octet: RESIDENT_OCTET });
await sr.from('home_network_occupants').insert({
  essid: TARGET_ESSID,
  owner_key: resident.publicKeyHex,
  workstation_machine_id: RESIDENT_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: 'anton',
  workstation_root_hash: md5('resident-root-secret'),
});

// The attacker's own home network, so the server can derive their public address.
await seedPublicIps(sr, [{ essid: ATTACKER_ESSID, publicIp: ATTACKER_PUBLIC_IP }]);
await sr.from('home_network_occupants').insert({
  essid: ATTACKER_ESSID,
  owner_key: attacker.publicKeyHex,
  workstation_machine_id: ATTACKER_WS,
  workstation_username: 'mallory',
  workstation_machine_name: 'cracklab',
  workstation_root_hash: md5('attacker-root-secret'),
});

/** The wordlist as `apt install hydra` leaves it on the attacker's own box. */
const seedWordlist = async (words: readonly string[]) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: ATTACKER_WS,
      path: WORDLIST_PATH,
      writer_key: attacker.publicKeyHex,
      content: formatWordlist(words),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`wordlist seed failed: ${error.message}`);
};

const crackEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'hydraCrackPublic', {
    essid: ATTACKER_ESSID,
    target: TARGET_PUBLIC_IP,
    service: 'ssh',
    caller_machine_id: ATTACKER_WS,
    ...over,
  });

const authLogOf = async (
  machineId: string,
): Promise<{ content: string; writerKey: string } | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .maybeSingle();
  const row = data as { content: string; writer_key: string } | null;
  return row === null ? null : { content: row.content, writerKey: row.writer_key };
};

const gatewayAuthLog = () => authLogOf(TARGET_GATEWAY);

// --- 1. A wordlist that does NOT hold the admin password takes nothing. ---
await seedWordlist(['hunter2', 'letmein', 'correcthorse']);
const held = await post(crackEnvelope());
check(
  '1. a gateway whose password is absent from the wordlist holds',
  held.status === 200 && crackedIn(held.body).length === 0,
  `status ${held.status}; cracked ${crackedIn(held.body).length}`,
);

// --- 2. Add the real admin password and the gateway falls. ---
await seedWordlist(['hunter2', ADMIN_PW]);
const cracked = await post(crackEnvelope());
const root = crackedIn(cracked.body).find((entry) => entry.username === 'root');
check(
  '2. the gateway behind a public IP cracks to root',
  cracked.status === 200 && root?.password === ADMIN_PW,
  `status ${cracked.status}; cracked ${JSON.stringify(crackedIn(cracked.body))}`,
);

// --- 3. THE claim: what hydra reports, ssh accepts. Same address, same box. ---
const login = await post(
  signRequest(attacker, 'authCreateSessionPublic', {
    session_id: `ssh-attacker-${Date.now()}`,
    target: TARGET_PUBLIC_IP,
    username: 'root',
    password: root?.password ?? 'no-password-cracked',
    parent_session_id: null,
    source_ip: null,
  }),
);
check(
  '3. ssh accepts the password hydra reported',
  login.status === 200,
  `status ${login.status}; ${JSON.stringify(login.body)}`,
);

// --- 4. The trace: at the attacker's SERVER-DERIVED home address, under the AP's key. ---
const log = await gatewayAuthLog();
check(
  '4. the sweep is recorded at the attacker home public IP, server-derived',
  log !== null && log.content.includes(`Accepted password for root from ${ATTACKER_PUBLIC_IP}`),
  log === null ? 'no auth.log row' : log.content.split('\n').slice(-3).join(' | '),
);
check(
  '5. a failed attempt is recorded per password tried',
  log !== null && log.content.includes(`Failed password for root from ${ATTACKER_PUBLIC_IP}`),
  log === null ? 'no auth.log row' : `${(log.content.match(/Failed password/g) ?? []).length} failed`,
);
check(
  "6. the gateway's log accretes under the AP's lease holder, never the attacker",
  log !== null && log.writerKey === resident.publicKeyHex && log.writerKey !== attacker.publicKeyHex,
  log === null ? 'no auth.log row' : `writer ${log.writerKey.slice(0, 12)}...`,
);

// --- 7. An address no access point bears reaches nothing. ---
const nowhere = await post(crackEnvelope({ target: UNREGISTERED_IP }));
check(
  '7. an unregistered public IP is unreachable',
  nowhere.status === 404 && errorOf(nowhere.body) === 'host_unreachable',
  `status ${nowhere.status}; error ${errorOf(nowhere.body)}`,
);

// --- 8. Standing somewhere you hold no session is refused, not traced. ---
const foreign = await post(crackEnvelope({ caller_machine_id: RESIDENT_WS }));
check(
  '8. a caller with no session on the machine they name is refused',
  foreign.status === 403 && errorOf(foreign.body) === 'no_session',
  `status ${foreign.status}; error ${errorOf(foreign.body)}`,
);

// --- The NAT forward: the resident publishes a door to their OWN box, and it is the
//     same door an attacker walks through. Everything above reached the shared
//     gateway; from here the target is a PERSON's machine. ---
const RESIDENT_LAN_IP = lanAddressFor(TARGET_ESSID, RESIDENT_OCTET);
const RESIDENT_GUEST_PW = workstationGuestPassword(resident.publicKeyHex);

const patchRow = (machineId: string, path: string, content: string) => ({
  machine_id: machineId,
  path,
  writer_key: resident.publicKeyHex,
  content,
  owner: 'root',
  node_type: 'file',
  permissions: { read: ['root'], write: ['root'], execute: [] },
});

// The forward table lives on the GATEWAY; the running sshd lives on the resident's
// box. A forward bridges two machines, and a live check must seed both.
const forwardSeed = await sr.from('patches').upsert(
  [
    patchRow(
      TARGET_GATEWAY,
      '/etc/iptables/rules.v4',
      `forward ${FORWARD_PORT} to ${RESIDENT_LAN_IP}:22`,
    ),
    patchRow(RESIDENT_WS, '/var/run/sshd.pid', 'sshd:port=22'),
  ],
  { onConflict: 'machine_id,path,writer_key' },
);
if (forwardSeed.error) throw new Error(`forward seed failed: ${forwardSeed.error.message}`);

await seedWordlist(['hunter2', ADMIN_PW, RESIDENT_GUEST_PW]);

const forwarded = await post(crackEnvelope({ port: FORWARD_PORT }));
const guest = crackedIn(forwarded.body).find((entry) => entry.username === 'guest');
check(
  "9. a forwarded port cracks the OCCUPANT's guest account, not the gateway",
  forwarded.status === 200 && guest?.password === RESIDENT_GUEST_PW,
  `status ${forwarded.status}; cracked ${JSON.stringify(crackedIn(forwarded.body))}`,
);
check(
  '10. the result names the door knocked on, not the box’s internal port',
  (forwarded.body as { port?: number } | null)?.port === FORWARD_PORT,
  `port ${(forwarded.body as { port?: number } | null)?.port} (expected ${FORWARD_PORT})`,
);
check(
  '11. the resident’s CHOSEN root password holds where their guest account fell',
  crackedIn(forwarded.body).every((entry) => entry.username !== 'root'),
  `cracked ${crackedIn(forwarded.body).map((entry) => entry.username).join(',') || 'none'}`,
);

// THE claim again, one layer deeper: what hydra reports through a forward, ssh accepts
// through that same forward. Two handlers, one resolver, one box.
const forwardLogin = await post(
  signRequest(attacker, 'authCreateSessionPublic', {
    session_id: `ssh-forward-${Date.now()}`,
    target: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    username: 'guest',
    password: guest?.password ?? 'no-password-cracked',
    parent_session_id: null,
    source_ip: null,
  }),
);
check(
  '12. ssh accepts, through the same forward, the password hydra reported',
  forwardLogin.status === 200,
  `status ${forwardLogin.status}; ${JSON.stringify(forwardLogin.body)}`,
);

const residentLog = await authLogOf(RESIDENT_WS);
check(
  '13. the trace lands on the OCCUPANT’s auth.log, under their own key',
  residentLog !== null &&
    residentLog.writerKey === resident.publicKeyHex &&
    residentLog.content.includes(`Accepted password for guest from ${ATTACKER_PUBLIC_IP}`),
  residentLog === null
    ? 'no auth.log row on the occupant box'
    : `writer ${residentLog.writerKey.slice(0, 12)}...; ${residentLog.content.split('\n').slice(-2).join(' | ')}`,
);

// A port nobody forwarded is not a door, even on an AP that has one.
const unforwarded = await post(crackEnvelope({ port: FORWARD_PORT + 1 }));
check(
  '14. a port with no forward behind it is unreachable',
  unforwarded.status === 404 && errorOf(unforwarded.body) === 'host_unreachable',
  `status ${unforwarded.status}; error ${errorOf(unforwarded.body)}`,
);

// --- The pivot: three parties. The attacker holds a session on the RESIDENT's box,
//     which lives on the target network, and from there sweeps a THIRD network's
//     gateway. What that third party's log must record is the network the attack was
//     launched from — not the attacker's own, which is the only address the server
//     could have known before this. ---
await seedPublicIps(sr, [{ essid: VICTIM_ESSID, publicIp: VICTIM_PUBLIC_IP }]);
await sr
  .from('network_lan_leases')
  .insert({ essid: VICTIM_ESSID, owner_key: bystander.publicKeyHex, octet: BYSTANDER_OCTET });
await sr.from('home_network_occupants').insert({
  essid: VICTIM_ESSID,
  owner_key: bystander.publicKeyHex,
  workstation_machine_id: BYSTANDER_WS,
  workstation_username: 'erlich',
  workstation_machine_name: 'aviato',
  workstation_root_hash: md5('bystander-root-secret'),
});

// The hop that makes the resident's box a place to stand. Its `essid` is what the
// server reads to place the attacker — stamped here exactly as a real ssh login
// stamps it, never claimed by the request below.
await sr.from('sessions').insert({
  session_id: PIVOT_SESSION,
  player_key: attacker.publicKeyHex,
  machine_id: RESIDENT_WS,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: TARGET_ESSID,
  created_at: '2020-01-01T00:00:00.000Z',
});

// Tools run where you stand, and so does the ammunition: the wordlist has to be on
// the resident's box, because that is the machine the sweep now reads from.
const { error: pivotWordlistError } = await sr.from('patches').upsert(
  {
    machine_id: RESIDENT_WS,
    path: WORDLIST_PATH,
    writer_key: attacker.publicKeyHex,
    content: formatWordlist([VICTIM_ADMIN_PW]),
    owner: 'root',
    node_type: 'file',
    permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  },
  { onConflict: 'machine_id,path,writer_key' },
);
if (pivotWordlistError) {
  throw new Error(`pivot wordlist seed failed: ${pivotWordlistError.message}`);
}

const pivoted = await post(
  crackEnvelope({ target: VICTIM_PUBLIC_IP, caller_machine_id: RESIDENT_WS }),
);
const pivotedRoot = crackedIn(pivoted.body).find((entry) => entry.username === 'root');
check(
  '15. a sweep launched from a box on another network cracks its target',
  pivoted.status === 200 && pivotedRoot?.password === VICTIM_ADMIN_PW,
  `status ${pivoted.status}; cracked ${JSON.stringify(crackedIn(pivoted.body))}`,
);

const victimLog = await authLogOf(VICTIM_GATEWAY);
check(
  '15b. the trace names the network stood on, never the attacker’s own',
  victimLog !== null &&
    victimLog.content.includes(`Accepted password for root from ${TARGET_PUBLIC_IP}`) &&
    !victimLog.content.includes(ATTACKER_PUBLIC_IP),
  victimLog === null
    ? 'no auth.log row on the third party’s gateway'
    : victimLog.content.split('\n').slice(-2).join(' | '),
);

await clean();

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
