// Wire-check — the database and SNMP doors (`mysql`/`redis-cli`/`snmpwalk`/`snmpset`) run
// from a hop. All four reach the server through one lookup (`reachServiceHost`), so proving
// that lookup lives from a hop proves the door for every one of them. The op sits at home
// and holds a shell on a box; every call names that box (`caller_machine_id`), and the
// server works out from the op's own session row where the op stands — never from anything
// the request claims. So, across the two doors this check drives (redis for the box-state
// cases, snmp for the public one):
//   - a LAN call from the hop lands on a box on the hop's LAN, logged from the HOP's own
//     LAN address rather than a client-sent source;
//   - a call to a box on a DEEP layer the hop reaches opens it by its address there, and a
//     switch fronting that layer applies its live ACL — a denied port is refused exactly
//     like an unserved one, and clearing the deny re-opens it;
//   - a call naming a network the hop is not on is 403 `wrong_network`, and one naming a box
//     the op holds no shell on is 403 `no_session`; both write nothing;
//   - `localhost` on the hop reaches the hop box's own daemon, logged over `127.0.0.1`;
//   - a PUBLIC target reached from the hop is logged under the HOP network's public address,
//     and the same target from home under the op's own — the origin the hop masks;
//   - once the hop's shell is gone, the next statement is refused `no_session`.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopDataDoors.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { storeIn, DATADIR_PATH } from '../src/core/redis/datadir.js';
import { redisStoreSchema } from '../src/core/redis/types.js';
import { chainLinks } from '../src/core/generation/lanTopology.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { publicAddress } from '../src/core/generation/world.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { REDIS_LOG_PATH } from '../src/core/logging/redisLog.js';
import { SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog.js';
import { formatPidfileContent, pidfilePath } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { DATADIR_FILE } from '../src/core/generation/baseFs.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

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
  envelope: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

const REDIS_PORT = SERVICE_CATALOG.redis.defaultPort;
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_READABLE = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const op = generateIdentity();

// ─── Network N: a redis LAN with an OPEN store and a sibling, for the LAN, loopback and
//     statement-after-shell cases. Declared in the world, so the hop has a public face. ───
const servesOpenRedis = (essid: string, host: LanHost): boolean => {
  if (!hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.redis)) return false;
  const store = storeIn(resolveLanHostIdentity(host, essid).baseFs);
  return store !== null && store.requirepassHash === null;
};

const redisLan = (deepEssid: string) => {
  for (const essid of crackableEssidPool) {
    if (essid === deepEssid || publicAddress(essid) === undefined) continue;
    const machines = generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');
    const storeHost = machines.find((host) => servesOpenRedis(essid, host));
    const sibling = storeHost && machines.find((host) => host.ip !== storeHost.ip);
    if (storeHost !== undefined && sibling !== undefined) return { essid, storeHost, sibling };
  }
  return null;
};

// ─── Network D: an inner SWITCH fronting a deep layer, for the deep-by-address case. The
//     switch's ACL is what a denied port is refused by. ───
const deepSwitch = (essid: string) => {
  const innerSwitch = chainLinks(essid).find(
    (link) => link.parentMachineId === null && link.host.kind === 'switch',
  );
  if (innerSwitch === undefined) return null;
  const layer = generateDeepLayer(
    essid,
    { machineId: innerSwitch.machineId, kind: 'switch' },
    { hangsChild: innerSwitch.hangsChild },
  );
  return {
    essid,
    switchId: innerSwitch.machineId,
    deepHost: layer.host,
    deepId: hostMachineId(layer.host, essid),
    layerSubnet: layer.subnet,
  };
};

const deep = crackableEssidPool.map(deepSwitch).find((found) => found !== null) ?? null;
if (deep === null) {
  console.error('no crackable network fronts a deep layer behind an inner switch');
  process.exit(2);
}
const lan = redisLan(deep.essid);
if (lan === null) {
  console.error('no crackable network carries an open redis store and a sibling');
  process.exit(2);
}

// Home (H) and the public SNMP target (M): two more declared crackable networks, distinct
// from N and D, so the three public addresses this check contrasts are all different.
const spare = crackableEssidPool.filter(
  (essid) => essid !== lan.essid && essid !== deep.essid && publicAddress(essid) !== undefined,
);
const HOME = spare[0];
const TARGET = spare[1];
if (HOME === undefined || TARGET === undefined) {
  console.error('not enough declared crackable networks to stand a home and a public target apart');
  process.exit(2);
}

const N = lan.essid;
const N_PUBLIC = publicAddress(N)!;
const HOME_PUBLIC = publicAddress(HOME)!;
const STORE_HOST_ID = resolveLanHostIdentity(lan.storeHost, N).machineId;
const HOP_SIBLING_ID = machineIdForLanHost(lan.sibling, N);
const N_GATEWAY_ID = computeApGatewayId(N);

const TARGET_GATEWAY_ID = computeApGatewayId(TARGET);
const TARGET_PUBLIC = publicAddress(TARGET)!;

const TOUCHED = [
  STORE_HOST_ID,
  HOP_SIBLING_ID,
  N_GATEWAY_ID,
  deep.deepId,
  deep.switchId,
  TARGET_GATEWAY_ID,
];

const redisConnect = (over: Record<string, unknown>) =>
  post(signRequest(op, 'redisConnect', { essid: N, port: REDIS_PORT, ...over }));
const redisStatement = (over: Record<string, unknown>) =>
  post(signRequest(op, 'redisStatement', { essid: N, port: REDIS_PORT, ...over }));
const snmpWalk = (over: Record<string, unknown>) =>
  post(signRequest(op, 'snmpWalk', { community: 'public', ...over }));

const logOn = async (machineId: string, path: string, essid: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', apGatewayLogWriterKey(essid))
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

const clearLog = (machineId: string, path: string, essid: string) =>
  sr
    .from('patches')
    .delete()
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', apGatewayLogWriterKey(essid));

const plant = async (
  machineId: string,
  path: string,
  content: string,
  permissions: Record<string, readonly string[]> = ROOT_ONLY,
) => {
  const { error } = await sr.from('patches').upsert(
    {
      writer_key: op.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error !== null) {
    console.error(`FATAL: could not plant ${path} on ${machineId}: ${error.message}`);
    process.exit(1);
  }
};

const seedSession = (sessionId: string, machineId: string, essid: string) =>
  sr.from('sessions').insert({
    session_id: sessionId,
    player_key: op.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid,
  });

const errorOf = (body: Record<string, unknown> | null): string => String(body?.error ?? '');

const cleanUp = async () => {
  for (const machineId of TOUCHED) await sr.from('patches').delete().eq('machine_id', machineId);
  await sr.from('sessions').delete().eq('player_key', op.publicKeyHex);
  await leaveNetwork(sr, HOME);
};

// ─── The world, as a real session would leave it ───
await cleanUp();
// The op occupies their HOME network (for the from-home public call), and holds shells on a
// sibling and the store box on N, and on the inner switch on D.
await standOnNetwork(sr, HOME, op, 27);
await seedSession('hop-n-sibling', HOP_SIBLING_ID, N);
await seedSession('hop-n-store', STORE_HOST_ID, N);
await seedSession('hop-d-switch', deep.switchId, deep.essid);
// D's deep box runs an open store, planted as its own daemon would leave it — a layer host
// serves nothing by default, so without this there is nothing on the deep layer to reach.
await plant(
  deep.deepId,
  pidfilePath(SERVICE_CATALOG.redis),
  formatPidfileContent(SERVICE_CATALOG.redis, REDIS_PORT),
  WORLD_READABLE,
);
await plant(
  deep.deepId,
  DATADIR_PATH,
  JSON.stringify(redisStoreSchema.parse({ keys: { greeting: 'hello' }, requirepassHash: null })),
  DATADIR_FILE,
);

console.log(
  `N ${N} @ ${N_PUBLIC} — store ${lan.storeHost.hostname} ${lan.storeHost.ip}, ` +
    `hop sibling ${lan.sibling.ip}\n` +
    `D ${deep.essid} — deep box ${deep.deepHost.hostname} ${deep.deepHost.ip} behind a switch ` +
    `at ${deep.layerSubnet}.1\n` +
    `home ${HOME} @ ${HOME_PUBLIC}; public target ${TARGET} @ ${TARGET_PUBLIC}\n`,
);

try {
  // === 1. A LAN call from the hop lands on the store box, from the HOP's own address. ===
  await clearLog(STORE_HOST_ID, REDIS_LOG_PATH, N);
  const lanCall = await redisConnect({
    target_ip: lan.storeHost.ip,
    caller_machine_id: HOP_SIBLING_ID,
  });
  const lanLog = await logOn(STORE_HOST_ID, REDIS_LOG_PATH, N);
  check(
    "a LAN call from the hop opens the store, logged from the hop's own LAN address",
    lanCall.status === 200 && lanLog.includes(`Client connected from ${lan.sibling.ip}`),
    `status=${lanCall.status} log=${JSON.stringify(lanLog.trim())}`,
  );

  // === 2. `localhost` on the hop reaches the hop box's OWN daemon, over loopback. ===
  await clearLog(STORE_HOST_ID, REDIS_LOG_PATH, N);
  const loop = await redisConnect({ target_ip: '127.0.0.1', caller_machine_id: STORE_HOST_ID });
  const loopLog = await logOn(STORE_HOST_ID, REDIS_LOG_PATH, N);
  check(
    'localhost on the hop opens the hop box own store, logged over loopback',
    loop.status === 200 && loopLog.includes('Client connected from 127.0.0.1'),
    `status=${loop.status} log=${JSON.stringify(loopLog.trim())}`,
  );

  // === 3. A network the hop is not on → wrong_network; a box with no shell → no_session. ===
  const wrongNet = await redisConnect({
    target_ip: lan.storeHost.ip,
    essid: HOME,
    caller_machine_id: HOP_SIBLING_ID,
  });
  check(
    'a call naming a network the hop is not on is refused wrong_network',
    wrongNet.status === 403 && errorOf(wrongNet.body) === 'wrong_network',
    `status=${wrongNet.status} body=${JSON.stringify(wrongNet.body)}`,
  );
  const noShell = await redisConnect({
    target_ip: lan.storeHost.ip,
    caller_machine_id: N_GATEWAY_ID,
  });
  check(
    'a call naming a box the op holds no shell on is refused no_session',
    noShell.status === 403 && errorOf(noShell.body) === 'no_session',
    `status=${noShell.status} body=${JSON.stringify(noShell.body)}`,
  );

  // === 4. A box on a DEEP layer the hop reaches, opened by its address there. ===
  await clearLog(deep.deepId, REDIS_LOG_PATH, deep.essid);
  const deepOpen = await redisConnect({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    caller_machine_id: deep.switchId,
  });
  const deepLog = await logOn(deep.deepId, REDIS_LOG_PATH, deep.essid);
  check(
    "a deep-layer call opens the box by its address, logged from the layer's .1",
    deepOpen.status === 200 && deepLog.includes(`Client connected from ${deep.layerSubnet}.1`),
    `status=${deepOpen.status} log=${JSON.stringify(deepLog.trim())}`,
  );

  // === 5. A switch-denied port is refused like an unserved one, and clearing it re-opens. ===
  await plant(deep.switchId, '/etc/switch/acl.conf', `# acl\ndeny ${REDIS_PORT}\n`);
  const denied = await redisConnect({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    caller_machine_id: deep.switchId,
  });
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', deep.switchId)
    .eq('path', '/etc/switch/acl.conf');
  const reopened = await redisConnect({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    caller_machine_id: deep.switchId,
  });
  check(
    'a switch ACL that denies the port makes the deep box dark, and removing it re-opens it',
    denied.status === 404 &&
      errorOf(denied.body) === 'service_not_running' &&
      reopened.status === 200,
    `denied=${denied.status}/${errorOf(denied.body)} reopened=${reopened.status}`,
  );

  // === 6. A PUBLIC target from the hop is logged under the HOP network's public address,
  //     and from home under the op's own. ===
  await clearLog(TARGET_GATEWAY_ID, SNMPD_LOG_PATH, TARGET);
  const fromHop = await snmpWalk({
    essid: N,
    target_ip: TARGET_PUBLIC,
    caller_machine_id: HOP_SIBLING_ID,
  });
  const fromHome = await snmpWalk({ essid: HOME, target_ip: TARGET_PUBLIC });
  const targetLog = await logOn(TARGET_GATEWAY_ID, SNMPD_LOG_PATH, TARGET);
  check(
    "a public walk from the hop shows the hop network's address, from home the op's own",
    fromHop.status === 200 &&
      fromHome.status === 200 &&
      N_PUBLIC !== HOME_PUBLIC &&
      targetLog.includes(`[${N_PUBLIC}]`) &&
      targetLog.includes(`[${HOME_PUBLIC}]`),
    `hop=${fromHop.status} home=${fromHome.status} ${N_PUBLIC} vs ${HOME_PUBLIC} | ` +
      JSON.stringify(targetLog.trim().split('\n').slice(-4)),
  );

  // === 7. Once the hop's shell is gone, the next statement is refused no_session. ===
  const beforeGone = await redisStatement({
    target_ip: lan.storeHost.ip,
    statement: 'DBSIZE',
    caller_machine_id: HOP_SIBLING_ID,
  });
  await sr.from('sessions').delete().eq('session_id', 'hop-n-sibling');
  const afterGone = await redisStatement({
    target_ip: lan.storeHost.ip,
    statement: 'DBSIZE',
    caller_machine_id: HOP_SIBLING_ID,
  });
  check(
    'a statement works from the hop, and once that shell has ended the next is refused no_session',
    beforeGone.status === 200 &&
      afterGone.status === 403 &&
      errorOf(afterGone.body) === 'no_session',
    `before=${beforeGone.status} after=${afterGone.status}/${errorOf(afterGone.body)}`,
  );
} finally {
  await cleanUp();
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
