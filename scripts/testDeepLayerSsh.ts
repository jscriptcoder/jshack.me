// Wire-payload smoke for `ssh` across a deep layer — a box on a deep layer stands on that
// layer, and a gateway stands on the layer it fronts, so a shell on either logs into the
// boxes there by address, with no forward. The login is the ordinary signed
// `authCreateSession`, naming the box it runs from; the server works out from that box's
// live session which layer the target is on and the address the box is seen at there, and
// stamps that address on the target's /var/log/auth.log. Drives /api/sessions against
// `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - a gateway's login onto the layer it fronts is logged from that layer's `.1`;
//   - a deep host's login onto a neighbour on its layer is logged from its own address;
//   - a login onto the layer above is logged from the gateway the caller sits behind;
//   - a refused password is logged and opens no session;
//   - a SWITCH replays its journal to read acl.conf, so a `deny 22` patch refuses the
//     login and removing it lets it through (the materialize → ACL read path);
//   - a caller with no shell on the box they name, a layer below the one a gateway fronts,
//     and a layer's `.1` are all refused, and log nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDeepLayerSsh.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no suitable network.

import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeDeepGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { buildDeepHostFs } from '../src/core/generation/deepHostFs.js';
import { resolveDeepGatewayIdentity } from '../src/core/generation/lanHostIdentity.js';
import { chainLinks, type ChainLink } from '../src/core/generation/lanTopology.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { md5 } from '../src/core/generation/md5.js';
import type { Directory } from '../src/core/filesystem/types.js';

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

const layerOf = (essid: string, link: ChainLink) =>
  generateDeepLayer(
    essid,
    { machineId: link.machineId, kind: link.host.kind },
    { hangsChild: link.hangsChild },
  );

/** The plaintext root password of a box, recovered from its seeded /etc/passwd. */
const rootPasswordOf = (fs: Directory): string => {
  const etc = fs.entries.get('etc');
  const passwd = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;
  if (passwd?.kind !== 'file') throw new Error('no /etc/passwd');
  const hash = passwd.content
    .split('\n')
    .map((line) => line.split(':'))
    .find((fields) => fields[0] === 'root')?.[1];
  const plain = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === hash);
  if (plain === undefined) throw new Error('root password is not in the pool');
  return plain;
};

// --- The network: an inner ROUTER fronting a layer that hangs a child ROUTER (so the child
//     fronts a layer of its own below), and an inner SWITCH for the ACL case. ---
const suitable = (essid: string): boolean => {
  const links = chainLinks(essid);
  const innerRouter = links.find(
    (link) => link.parentMachineId === null && link.host.kind === 'router',
  );
  const innerSwitch = links.find(
    (link) => link.parentMachineId === null && link.host.kind === 'switch',
  );
  if (innerRouter === undefined || innerSwitch === undefined) return false;
  return layerOf(essid, innerRouter).childGateway?.kind === 'router';
};
const ESSID = crackableEssidPool.find(suitable);
if (ESSID === undefined) {
  console.error(
    'no network in the crackable pool has a router chain two gateways deep and a switch',
  );
  process.exit(2);
}

// The acting player holds a shell on every box a check logs in from; mallory holds none.
const alice = generateIdentity();
const mallory = generateIdentity();

const links = chainLinks(ESSID);
const INNER_R = links.find((link) => link.parentMachineId === null && link.host.kind === 'router')!;
const INNER_S = links.find((link) => link.parentMachineId === null && link.host.kind === 'switch')!;
const R_LAYER = layerOf(ESSID, INNER_R);
const R_NPC_ID = hostMachineId(R_LAYER.host, ESSID);
const R_CHILD = R_LAYER.childGateway!;
const R_CHILD_ID = computeDeepGatewayId(INNER_R.machineId, Number(R_CHILD.ip.split('.')[3]));
const CHILD_LINK = links.find((link) => link.machineId === R_CHILD_ID)!;
const CHILD_LAYER = layerOf(ESSID, CHILD_LINK);
const CHILD_NPC_ID = hostMachineId(CHILD_LAYER.host, ESSID);
const S_LAYER = layerOf(ESSID, INNER_S);
const S_NPC_ID = hostMachineId(S_LAYER.host, ESSID);

const R_NPC_PASSWORD = rootPasswordOf(buildDeepHostFs(ESSID, R_LAYER.host));
const R_CHILD_PASSWORD = rootPasswordOf(
  resolveDeepGatewayIdentity(ESSID, INNER_R.machineId, R_CHILD.ip, R_CHILD.kind).baseFs,
);
const CHILD_NPC_PASSWORD = rootPasswordOf(buildDeepHostFs(ESSID, CHILD_LAYER.host));
const S_NPC_PASSWORD = rootPasswordOf(buildDeepHostFs(ESSID, S_LAYER.host));

const ACL_PATH = '/etc/switch/acl.conf';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const TOUCHED = [R_NPC_ID, R_CHILD_ID, CHILD_NPC_ID, S_NPC_ID, INNER_S.machineId];

let attempt = 0;
const loginFrom = (
  identity: ReturnType<typeof generateIdentity>,
  callerMachineId: string,
  targetIp: string,
  password: string,
) => {
  attempt += 1;
  return post(
    SESSIONS,
    signRequest(identity, 'authCreateSession', {
      session_id: `ssh-root-deep-login-${attempt}`,
      essid: ESSID,
      target_ip: targetIp,
      username: 'root',
      password,
      caller_machine_id: callerMachineId,
    }),
  );
};

const readAuthLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('writer_key', apGatewayLogWriterKey(ESSID))
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

const lastLine = (content: string): string =>
  content.trim().split('\n').filter(Boolean).at(-1) ?? '';

const sessionRow = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id, source_ip')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as { machine_id?: string; source_ip?: string | null } | null;
};

const cleanUp = async () => {
  for (const machineId of TOUCHED) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
};

// Clean slate, then alice's shells — as `ssh` would have left them, each stamped with the
// network it was opened on. A deep box's row carries the access point's ESSID: the layer it
// stands on is worked out from the box, never from the row.
await cleanUp();
const shells = [INNER_R.machineId, INNER_S.machineId, R_NPC_ID, R_CHILD_ID, CHILD_NPC_ID];
for (const [index, machineId] of shells.entries()) {
  const seeded = await sr.from('sessions').insert({
    session_id: `ssh-root-deep-shell-${index}`,
    player_key: alice.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (seeded.error) {
    console.error(`FATAL: session seed failed: ${seeded.error.message}`);
    process.exit(1);
  }
}

try {
  // 1. The inner router logs onto the layer it fronts: from that layer's `.1`.
  const l1 = await loginFrom(alice, INNER_R.machineId, R_LAYER.host.ip, R_NPC_PASSWORD);
  const row1 = await sessionRow(`ssh-root-deep-login-${attempt}`);
  const npcLog = lastLine(await readAuthLog(R_NPC_ID));
  check(
    'inner router: lands on the deep NPC, logged and stored from the layer .1',
    l1.status === 200 &&
      row1?.machine_id === R_NPC_ID &&
      row1.source_ip === `${R_LAYER.subnet}.1` &&
      npcLog.includes('Accepted password for root') &&
      npcLog.endsWith(`from ${R_LAYER.subnet}.1`),
    `status=${l1.status} row=${JSON.stringify(row1)} log=${JSON.stringify(npcLog)}`,
  );

  // 2. The deep NPC logs onto the child gateway beside it: from its own address.
  const l2 = await loginFrom(alice, R_NPC_ID, R_CHILD.ip, R_CHILD_PASSWORD);
  const row2 = await sessionRow(`ssh-root-deep-login-${attempt}`);
  const childLog = lastLine(await readAuthLog(R_CHILD_ID));
  check(
    'deep host: lands on the gateway beside it, logged from the host’s own address',
    l2.status === 200 &&
      row2?.machine_id === R_CHILD_ID &&
      childLog.endsWith(`from ${R_LAYER.host.ip}`),
    `status=${l2.status} row=${JSON.stringify(row2)} log=${JSON.stringify(childLog)}`,
  );

  // 3. The child gateway logs onto the layer it fronts: from that layer's `.1`.
  const l3 = await loginFrom(alice, R_CHILD_ID, CHILD_LAYER.host.ip, CHILD_NPC_PASSWORD);
  const childNpcLog = lastLine(await readAuthLog(CHILD_NPC_ID));
  check(
    'deep gateway: lands on the NPC of the layer it fronts, logged from that layer .1',
    l3.status === 200 && childNpcLog.endsWith(`from ${CHILD_LAYER.subnet}.1`),
    `status=${l3.status} log=${JSON.stringify(childNpcLog)}`,
  );

  // 4. A box two layers down logs onto the layer above: as the gateway it sits behind.
  const l4 = await loginFrom(alice, CHILD_NPC_ID, R_LAYER.host.ip, R_NPC_PASSWORD);
  const npcFromBelow = lastLine(await readAuthLog(R_NPC_ID));
  check(
    'layer above: the deep NPC logs a login from below as the child gateway’s address',
    l4.status === 200 && npcFromBelow.endsWith(`from ${R_CHILD.ip}`),
    `status=${l4.status} log=${JSON.stringify(npcFromBelow)}`,
  );

  // 5. A wrong password is logged as a failure, and opens no session.
  const l5 = await loginFrom(alice, INNER_R.machineId, R_LAYER.host.ip, 'not-the-password');
  const row5 = await sessionRow(`ssh-root-deep-login-${attempt}`);
  const failedLine = lastLine(await readAuthLog(R_NPC_ID));
  check(
    'wrong password: 401, a Failed line from the layer .1, no session row',
    l5.status === 401 &&
      row5 === null &&
      failedLine.includes('Failed password for root') &&
      failedLine.endsWith(`from ${R_LAYER.subnet}.1`),
    `status=${l5.status} row=${JSON.stringify(row5)} log=${JSON.stringify(failedLine)}`,
  );

  // 6. A live `deny 22` on the switch fronting the layer refuses the login, logging nothing.
  await sr.from('patches').insert({
    machine_id: INNER_S.machineId,
    writer_key: alice.publicKeyHex,
    path: ACL_PATH,
    content: 'deny 22',
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
    updated_at: new Date().toISOString(),
  });
  const l6 = await loginFrom(alice, INNER_S.machineId, S_LAYER.host.ip, S_NPC_PASSWORD);
  const sLogDenied = await readAuthLog(S_NPC_ID);
  check(
    'switch ACL: a live `deny 22` refuses the login with 404 service_not_running, nothing logged',
    l6.status === 404 &&
      (l6.body as { error?: string } | null)?.error === 'service_not_running' &&
      sLogDenied === '',
    `status=${l6.status} body=${JSON.stringify(l6.body)} log=${JSON.stringify(sLogDenied)}`,
  );

  // 7. Deleting the deny lets the next login through, from the switch layer's `.1`.
  await sr.from('patches').delete().eq('machine_id', INNER_S.machineId).eq('path', ACL_PATH);
  const l7 = await loginFrom(alice, INNER_S.machineId, S_LAYER.host.ip, S_NPC_PASSWORD);
  const sLogOpen = lastLine(await readAuthLog(S_NPC_ID));
  check(
    'switch ACL: removing the deny lets the login through, logged from the switch layer .1',
    l7.status === 200 && sLogOpen.endsWith(`from ${S_LAYER.subnet}.1`),
    `status=${l7.status} log=${JSON.stringify(sLogOpen)}`,
  );

  // 8. Naming the inner router without a shell on it is refused.
  const l8 = await loginFrom(mallory, INNER_R.machineId, R_LAYER.host.ip, R_NPC_PASSWORD);
  check(
    'no shell: naming the inner router without a session on it is 403 no_session',
    l8.status === 403 && (l8.body as { error?: string } | null)?.error === 'no_session',
    `status=${l8.status} body=${JSON.stringify(l8.body)}`,
  );

  // 9. The layer below the one the inner router fronts is out of its reach.
  const l9 = await loginFrom(alice, INNER_R.machineId, CHILD_LAYER.host.ip, CHILD_NPC_PASSWORD);
  check(
    'reach: the inner router naming a host a layer below its own is 404 host_unreachable',
    l9.status === 404 && (l9.body as { error?: string } | null)?.error === 'host_unreachable',
    `status=${l9.status} body=${JSON.stringify(l9.body)}`,
  );

  // 10. A layer's `.1` is no host: the gateway is reached at its address above.
  const l10 = await loginFrom(alice, R_NPC_ID, `${R_LAYER.subnet}.1`, R_NPC_PASSWORD);
  check(
    'reach: a layer’s .1 is 404 host_unreachable',
    l10.status === 404 && (l10.body as { error?: string } | null)?.error === 'host_unreachable',
    `status=${l10.status} body=${JSON.stringify(l10.body)}`,
  );
} finally {
  await cleanUp();
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
