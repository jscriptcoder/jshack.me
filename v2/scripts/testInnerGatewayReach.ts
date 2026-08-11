// Wire-payload smoke for Story 5b.1b-ii — `ssh user@<inner>:<fwd port>` through a NAT
// forward on the player's OWN inner gateway, landing a session on the hidden Layer-2
// host. Drives the REAL /api/sessions (authCreateSessionInnerGateway) + /api/patches
// endpoints against a running `vercel dev` + supabase, seeding alice's root session on
// the gateway via service_role so her own-box write to rules.v4 passes the L1/L2 gate.
//
// Under test (the locally-untypechecked api/ runtime): both doors into the deep layer,
// which share one chain walk. The auth handler regenerates the gateway from the essid,
// replays its journal (canBoot gate), routes the forwarded port via machineServing onto
// the deep NPC, validates against ITS /etc/passwd, and inserts a session on the DEEP
// host's machine id — not the gateway's. `hydraCrackInnerGateway` sweeps the same box
// through the same walk, traces it at the fronting gateway's `.1` (all NAT ever shows a
// deep host), and — the check that matters — reports a password `ssh` then accepts.
//
// The layer is ESSID-seeded and SHARED, not private: every occupant of the network
// resolves the same gateway, forwards and deep hosts.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testInnerGatewayReach.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no inner gateway.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeDeepGatewayId, computeInnerGatewayId } from '../src/core/identity/router';
import { seedDeepGatewayAdminPw, seedInnerGatewayAdminPw } from '../src/core/generation/routerFs';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import {
  generateDeepLayer,
  buildDeepHostFs,
  seedNetworkDepth,
} from '../src/core/generation/generateDeepLayer';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import { accountIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;
const machineOf = (body: unknown): string | undefined =>
  (body as { machine_id?: string } | null)?.machine_id;
const userTypeOf = (body: unknown): string | undefined =>
  (body as { userType?: string } | null)?.userType;

// --- The network. Pick a depth-≥2 ESSID so its inner router fronts a child gateway (the
//     2223 forward reaches it) — depth is a per-network roll, so an arbitrary ESSID could
//     front none. The acting player is any identity: the chain belongs to the access point,
//     so alice brings a session and a signature rather than a private world. ---
const ESSID = crackableEssidPool.find((essid) => seedNetworkDepth(essid) >= 2);
if (ESSID === undefined) {
  console.error('no network in the crackable pool seeds a depth-≥2 chain');
  process.exit(2);
}
const alice = generateIdentity();

const innerGateway = generateHomeLan(ESSID).hosts.find(
  (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
);
if (innerGateway === undefined) {
  console.error('no inner gateway on the generated LAN');
  process.exit(2);
}
const INNER_IP = innerGateway.ip;
const INNER_OCTET = Number(INNER_IP.split('.')[3]);
const INNER_GW_ID = computeInnerGatewayId(ESSID, INNER_OCTET);
const GATEWAY_ROOT_PW = seedInnerGatewayAdminPw(ESSID, INNER_OCTET);

const deep = generateDeepLayer(ESSID, { machineId: INNER_GW_ID, kind: 'router' });
const DEEP_IP = deep.host.ip;
const DEEP_ID = hostMachineId(deep.host, ESSID);
const guestAccount = accountIn(buildDeepHostFs(ESSID, deep.host), 'guest');
if (guestAccount === null) {
  console.error('no guest account on the deep host');
  process.exit(2);
}
const DEEP_GUEST_PW = ALL_GENERATED_PASSWORDS.find(
  (candidate) => md5(candidate) === guestAccount.hash,
);
if (DEEP_GUEST_PW === undefined) {
  console.error('cannot recover the deep host guest password');
  process.exit(2);
}

// The CHILD GATEWAY (the chain door) hanging on the inner router's deep layer — its
// own deep-gateway id + admin pw, reached through a SECOND forward on the inner router.
const child = deep.childGateway;
if (child === null) {
  console.error('the inner router deep layer hangs no child gateway');
  process.exit(2);
}
const CHILD_IP = child.ip;
const CHILD_OCTET = Number(CHILD_IP.split('.')[3]);
const CHILD_ID = computeDeepGatewayId(INNER_GW_ID, CHILD_OCTET);
const CHILD_ROOT_PW = seedDeepGatewayAdminPw(INNER_GW_ID, CHILD_OCTET);

const RULES = '/etc/iptables/rules.v4';
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
// Two NAT forwards on the inner router: 2222 → the terminal NPC, 2223 → the child
// gateway. The reach must route each public port to the right deep box.
const liveForward = `# NAT port-forward table\nforward 2222 to ${DEEP_IP}:22\nforward 2223 to ${CHILD_IP}:22\n`;

const reach = (over: Record<string, unknown>) =>
  post(
    SESSIONS,
    signRequest(alice, 'authCreateSessionInnerGateway', {
      session_id: `reach-${Math.round(performance.now())}-${Math.random()}`,
      essid: ESSID,
      target: INNER_IP,
      username: 'guest',
      password: DEEP_GUEST_PW,
      port: 2222,
      parent_session_id: null,
      source_ip: null,
      ...over,
    }),
  );

const sessionRowsOn = async (machineId: string): Promise<number> => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('player_key', alice.publicKeyHex)
    .eq('machine_id', machineId);
  return data?.length ?? 0;
};

// Clean slate, then seed alice's own ROOT session on the inner gateway (as her
// `ssh root@<inner>` would leave it) so her own-box write to rules.v4 passes L1/L2.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
// The DEEP host's journal too. Its auth.log is ESSID-seeded, so it survives across runs
// under a different alice — and a trace assertion that reads a PREVIOUS run's lines
// passes without this run having written anything at all.
await sr.from('patches').delete().eq('machine_id', DEEP_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').insert({
  session_id: `ssh-alice-inner-${INNER_GW_ID}`,
  player_key: alice.publicKeyHex,
  machine_id: INNER_GW_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});

// Open the NAT forward `2222 → <deep host>:22` on the gateway journal.
const w0 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: INNER_GW_ID,
    path: RULES,
    content: liveForward,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
  }),
);
check('alice opens the NAT forward on the gateway’s rules.v4 → 200', w0.status === 200, `status=${w0.status} error=${errorOf(w0.body) ?? '-'}`);

// 1. REACH — ssh guest@<inner>:2222 with the deep host's own password lands a session
//    ON THE DEEP HOST (its machine id), not the gateway.
const r1 = await reach({});
const landedRows = await sessionRowsOn(DEEP_ID);
check(
  'reach: ssh guest@<inner>:2222 → 200, session lands on the deep host id (not the gateway)',
  r1.status === 200 &&
    machineOf(r1.body) === DEEP_ID &&
    machineOf(r1.body) !== INNER_GW_ID &&
    userTypeOf(r1.body) === 'guest' &&
    landedRows === 1,
  `status=${r1.status} machine=${machineOf(r1.body)} userType=${userTypeOf(r1.body)} deepRows=${landedRows}`,
);

// 1b. REACH THE CHILD GATEWAY — ssh root@<inner>:2223 with the child gateway's OWN
//     admin pw lands a session ON THE CHILD GATEWAY (its deep-gateway id), not the
//     gateway and not the terminal NPC. The chain is now traversable to its door.
const r1b = await reach({ port: 2223, username: 'root', password: CHILD_ROOT_PW });
const childRows = await sessionRowsOn(CHILD_ID);
check(
  'reach: ssh root@<inner>:2223 → 200, session lands on the child gateway id (not gateway, not NPC)',
  r1b.status === 200 &&
    machineOf(r1b.body) === CHILD_ID &&
    machineOf(r1b.body) !== INNER_GW_ID &&
    machineOf(r1b.body) !== DEEP_ID &&
    userTypeOf(r1b.body) === 'root' &&
    childRows === 1,
  `status=${r1b.status} machine=${machineOf(r1b.body)} userType=${userTypeOf(r1b.body)} childRows=${childRows}`,
);

// 1c. WRONG CHILD-GATEWAY PASSWORD — the child gateway rejects, no session.
const r1c = await reach({ port: 2223, username: 'root', password: 'not-the-admin-pw' });
check(
  'wrong child-gateway password → 401 invalid_credentials',
  r1c.status === 401 && errorOf(r1c.body) === 'invalid_credentials',
  `status=${r1c.status} error=${errorOf(r1c.body) ?? '-'}`,
);

// 2. WRONG PASSWORD — the deep host rejects, no session.
const r2 = await reach({ password: 'definitely-not-the-password' });
check(
  'wrong deep-host password → 401 invalid_credentials',
  r2.status === 401 && errorOf(r2.body) === 'invalid_credentials',
  `status=${r2.status} error=${errorOf(r2.body) ?? '-'}`,
);

// 3. NO FORWARD ON THE PORT — a port the gateway neither serves nor forwards is dark.
const r3 = await reach({ port: 3333 });
check(
  'a port with no matching forward → 404 host_unreachable',
  r3.status === 404 && errorOf(r3.body) === 'host_unreachable',
  `status=${r3.status} error=${errorOf(r3.body) ?? '-'}`,
);

// 4. PORT 22 → THE GATEWAY ITSELF — its own sshd, validated against its admin password,
//    lands on the GATEWAY's id (5b.1a unbroken: `ssh root@<inner>` stays the gateway).
const r4 = await reach({ port: 22, username: 'root', password: GATEWAY_ROOT_PW });
check(
  'port 22 → lands on the gateway id (root, its own sshd), never the deep host',
  r4.status === 200 && machineOf(r4.body) === INNER_GW_ID && userTypeOf(r4.body) === 'root',
  `status=${r4.status} machine=${machineOf(r4.body)} userType=${userTypeOf(r4.body)}`,
);

// --- hydra down the same forward. The deep layer's only credential door: its hosts are
//     built to be entered by a wordlist but have no address any shell can name, and the
//     gateway holds forwards rather than passwords. alice sweeps FROM the gateway she
//     rooted, which is where her wordlist lives. ---

const sweep = (over: Record<string, unknown>) =>
  post(
    SESSIONS,
    signRequest(alice, 'hydraCrackInnerGateway', {
      essid: ESSID,
      target: INNER_IP,
      service: 'ssh',
      port: 2222,
      username: 'guest',
      caller_machine_id: INNER_GW_ID,
      ...over,
    }),
  );

const crackedOf = (body: unknown): { username: string; password: string }[] =>
  (body as { cracked?: { username: string; password: string }[] } | null)?.cracked ?? [];

/** The wordlist as `apt install hydra` leaves it on the box alice is standing on —
 *  game-provided state rather than a player write, so it is seeded via service_role
 *  exactly as the other hydra checks do, not pushed through the L2 gate. */
const seedWordlist = async (words: readonly string[]) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: INNER_GW_ID,
      path: WORDLIST_PATH,
      writer_key: alice.publicKeyHex,
      content: formatWordlist(words),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`wordlist seed failed: ${error.message}`);
};

const deepAuthLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', DEEP_ID)
    .eq('path', '/var/log/auth.log')
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

// A decoy first so the trace carries a Failed line before the Accepted one — a sweep
// that reported only its success would look identical to a lucky first guess.
await seedWordlist(['hunter2', DEEP_GUEST_PW]);
// The log BEFORE the sweep. `ssh` writes the same sentences to the same file, so only
// the delta proves hydra traced anything at all.
const logBeforeSweep = await deepAuthLog();

// 4b. HYDRA THROUGH THE FORWARD — the deep host's guest password is recovered from a
//     box that has no address on the LAN at all.
const h1 = await sweep({});
check(
  'hydra -p 2222 <inner> → 200, recovers the DEEP host’s guest password',
  h1.status === 200 &&
    crackedOf(h1.body).length === 1 &&
    crackedOf(h1.body)[0]?.username === 'guest' &&
    crackedOf(h1.body)[0]?.password === DEEP_GUEST_PW,
  `status=${h1.status} cracked=${JSON.stringify(crackedOf(h1.body))}`,
);

// 4c. THE TRACE IS ADDRESSED BY THE ROUTE — NAT means the deep box only ever sees the
//     fronting gateway's `.1`, so that is what its auth.log records.
const appendedBySweep = (await deepAuthLog()).slice(logBeforeSweep.length);
const GATEWAY_INNER_IP = `${deep.subnet}.1`;
check(
  'the sweep is traced on the DEEP host at the fronting gateway’s .1',
  appendedBySweep.includes(`Failed password for guest from ${GATEWAY_INNER_IP}`) &&
    appendedBySweep.includes(`Accepted password for guest from ${GATEWAY_INNER_IP}`) &&
    !appendedBySweep.includes(INNER_IP),
  `gatewayIp=${GATEWAY_INNER_IP} appended=${JSON.stringify(appendedBySweep.split('\n').filter(Boolean))}`,
);

// 4d. THE AGREEMENT — the password hydra reported is one `ssh` then accepts, on the same
//     box. This is the whole point of both tools resolving through one walk.
const reported = crackedOf(h1.body)[0]?.password ?? 'nothing-was-cracked';
const h2 = await reach({ password: reported });
check(
  'the password hydra reported is one ssh then accepts, landing on the deep host',
  h2.status === 200 && machineOf(h2.body) === DEEP_ID,
  `status=${h2.status} machine=${machineOf(h2.body)}`,
);

// 4e. A PORT WITH NO FORWARD — dark to a sweep exactly as it is to a login.
const h3 = await sweep({ port: 3333 });
check(
  'hydra on a port with no matching forward → 404 host_unreachable',
  h3.status === 404 && errorOf(h3.body) === 'host_unreachable',
  `status=${h3.status} error=${errorOf(h3.body) ?? '-'}`,
);

// 4f. PORT 22 IS THE GATEWAY ITSELF — its own sshd, swept against its admin password.
//     The deep layer is not involved, so nothing is traced there.
await seedWordlist([GATEWAY_ROOT_PW]);
const h4 = await sweep({ port: 22, username: 'root' });
check(
  'hydra -p 22 <inner> → cracks the GATEWAY’s own root password, not the deep host’s',
  h4.status === 200 &&
    crackedOf(h4.body).length === 1 &&
    crackedOf(h4.body)[0]?.password === GATEWAY_ROOT_PW,
  `status=${h4.status} cracked=${JSON.stringify(crackedOf(h4.body))}`,
);

// 5. BRICK — rm /boot/vmlinuz on the gateway: it stops answering, the deep entrance
//    goes dark even with the forward still configured (the boot gate runs first).
await post(PATCHES, signRequest(alice, 'removePatch', { machine_id: INNER_GW_ID, path: VMLINUZ, owner: 'root' }));
const r5 = await reach({});
check(
  'brick: rm /boot/vmlinuz → reaching the deep host is refused host_unreachable',
  r5.status === 404 && errorOf(r5.body) === 'host_unreachable',
  `status=${r5.status} error=${errorOf(r5.body) ?? '-'}`,
);

// 5b. THE BRICK IS DARK TO A SWEEP TOO — a wordlist attack is not a way around a box
//     that cannot boot, and nothing is recorded on a host nobody could reach.
const h5 = await sweep({});
check(
  'brick: the deep sweep is refused host_unreachable as well',
  h5.status === 404 && errorOf(h5.body) === 'host_unreachable',
  `status=${h5.status} error=${errorOf(h5.body) ?? '-'}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('patches').delete().eq('machine_id', DEEP_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
