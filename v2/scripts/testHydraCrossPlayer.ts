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
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { md5 } from '../src/core/generation/md5';

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

// The attacker's OWN network — this is what the server must walk to derive the address
// the target records. Nothing the client sends can name it.
const ATTACKER_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_PUBLIC_IP = '198.51.100.44';
const ATTACKER_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);

const UNREGISTERED_IP = '203.0.113.254';

const clean = async () => {
  for (const ip of [TARGET_PUBLIC_IP, ATTACKER_PUBLIC_IP]) {
    await sr.from('network_public_ips').delete().eq('public_ip', ip);
  }
  for (const essid of [TARGET_ESSID, ATTACKER_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  for (const id of [TARGET_GATEWAY, ATTACKER_WS, RESIDENT_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
};

await clean();

// The target AP as a real join leaves it: a public IP, one occupant, and the lease
// that occupant holds — the lease is what gives the ownerless gateway a stable log key.
await sr.from('network_public_ips').insert({ essid: TARGET_ESSID, public_ip: TARGET_PUBLIC_IP });
await sr
  .from('network_lan_leases')
  .insert({ essid: TARGET_ESSID, owner_key: resident.publicKeyHex, octet: 23 });
await sr.from('home_network_occupants').insert({
  essid: TARGET_ESSID,
  owner_key: resident.publicKeyHex,
  workstation_machine_id: RESIDENT_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: 'anton',
  workstation_root_hash: md5('resident-root-secret'),
});

// The attacker's own home network, so the server can derive their public address.
await sr
  .from('network_public_ips')
  .insert({ essid: ATTACKER_ESSID, public_ip: ATTACKER_PUBLIC_IP });
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

const gatewayAuthLog = async (): Promise<{ content: string; writerKey: string } | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', TARGET_GATEWAY)
    .eq('path', AUTH_LOG_PATH)
    .maybeSingle();
  const row = data as { content: string; writer_key: string } | null;
  return row === null ? null : { content: row.content, writerKey: row.writer_key };
};

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

await clean();

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
