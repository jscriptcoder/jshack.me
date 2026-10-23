// Wire-check — does a data door reached over `localhost` obey the hop's OWN `rules.v4`
// filter? The box's seeded filter file promises it does not ("localhost is never
// filtered — 127.0.0.1 still reaches it"), and the login doors honour that over loopback
// (`reachDoor`'s `overLoopback`). The data doors go through `reachServiceHost`, which asks
// `portsOpenToNetwork` whatever the request arrived over — so a `redis-cli localhost` on a
// box whose owner denied the redis port should, if the promise holds, still connect.
//
// One variable isolated four ways on ONE box that serves an open redis store, standing on
// it as the hop:
//   - network path, no deny: a sibling reaching the store's LAN address connects (baseline);
//   - network path, deny present: the same reach is refused service_not_running (the filter
//     works on the network, so the deny parses and is honoured);
//   - loopback, no deny: `redis-cli localhost` on the box connects (baseline);
//   - loopback, deny present: `redis-cli localhost` on the box — the question. 200 means
//     loopback bypasses the filter as the file promises; service_not_running means the data
//     door filters loopback where the login door would not.
//
// Usage (with v2 supabase + vercel dev on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLoopbackFilter.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { storeIn } from '../src/core/redis/datadir.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { publicAddress, RIDGEMONT } from '../src/core/generation/world.js';
import { RULES_V4_PATH, RULES_V4_OWNER } from '../src/core/network/iptablesRules.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { standOnNetwork, leaveNetwork } from './standVantage.js';

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

const op = generateIdentity();

// A crackable network carrying a box that serves an OPEN redis store (so loopback has a
// daemon to answer) plus a sibling to knock from on the network path.
const servesOpenRedis = (essid: string, host: LanHost): boolean => {
  if (!hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.redis)) return false;
  const store = storeIn(resolveLanHostIdentity(host, essid).baseFs);
  return store !== null && store.requirepassHash === null;
};

const redisLan = () => {
  for (const essid of wifiPoolOf(RIDGEMONT)) {
    if (publicAddress(essid) === undefined) continue;
    const machines = generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');
    const storeHost = machines.find((host) => servesOpenRedis(essid, host));
    const sibling = storeHost && machines.find((host) => host.ip !== storeHost.ip);
    if (storeHost !== undefined && sibling !== undefined) return { essid, storeHost, sibling };
  }
  return null;
};

const lan = redisLan();
if (lan === null) {
  console.error('no crackable network carries an open redis store and a sibling');
  process.exit(2);
}

const N = lan.essid;
const STORE_HOST_ID = resolveLanHostIdentity(lan.storeHost, N).machineId;
const SIBLING_ID = machineIdForLanHost(lan.sibling, N);
const TOUCHED = [STORE_HOST_ID, SIBLING_ID];

const redisConnect = (over: Record<string, unknown>) =>
  post(signRequest(op, 'redisConnect', { essid: N, port: REDIS_PORT, ...over }));

const errorOf = (body: Record<string, unknown> | null): string => String(body?.error ?? '');

const seedSession = (sessionId: string, machineId: string) =>
  sr.from('sessions').insert({
    session_id: sessionId,
    player_key: op.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: N,
  });

const denyRedis = () =>
  sr.from('patches').upsert(
    {
      writer_key: op.publicKeyHex,
      machine_id: STORE_HOST_ID,
      path: RULES_V4_PATH,
      content: `# /etc/iptables/rules.v4 — local INPUT filter\ndeny ${REDIS_PORT}\n`,
      owner: RULES_V4_OWNER,
      permissions: ROOT_ONLY,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );

const clearDeny = () =>
  sr
    .from('patches')
    .delete()
    .eq('machine_id', STORE_HOST_ID)
    .eq('path', RULES_V4_PATH)
    .eq('writer_key', op.publicKeyHex);

const cleanUp = async () => {
  for (const machineId of TOUCHED) await sr.from('patches').delete().eq('machine_id', machineId);
  await sr.from('sessions').delete().eq('player_key', op.publicKeyHex);
  await leaveNetwork(sr, N);
};

await cleanUp();
// The op occupies N and holds a shell on the store box (for the localhost calls) and on the
// sibling (for the network-path calls).
await standOnNetwork(sr, N, op, 27);
await seedSession('on-store', STORE_HOST_ID);
await seedSession('on-sibling', SIBLING_ID);

console.log(
  `N ${N} — store ${lan.storeHost.hostname} ${lan.storeHost.ip}, sibling ${lan.sibling.ip}; ` +
    `redis :${REDIS_PORT}\n`,
);

try {
  // === Baselines, no deny: both paths reach the store's redis. ===
  await clearDeny();
  const netOpen = await redisConnect({ target_ip: lan.storeHost.ip, caller_machine_id: SIBLING_ID });
  check(
    'no deny — a sibling reaching the store LAN address connects',
    netOpen.status === 200,
    `status=${netOpen.status} body=${JSON.stringify(netOpen.body)}`,
  );
  const loopOpen = await redisConnect({ target_ip: '127.0.0.1', caller_machine_id: STORE_HOST_ID });
  check(
    'no deny — redis-cli localhost on the store box connects',
    loopOpen.status === 200,
    `status=${loopOpen.status} body=${JSON.stringify(loopOpen.body)}`,
  );

  // === Deny present: the filter must close the NETWORK path (proves the deny is honoured). ===
  await denyRedis();
  const netDenied = await redisConnect({
    target_ip: lan.storeHost.ip,
    caller_machine_id: SIBLING_ID,
  });
  check(
    'deny present — the same network reach is refused service_not_running (filter is in effect)',
    netDenied.status === 404 && errorOf(netDenied.body) === 'service_not_running',
    `status=${netDenied.status} body=${JSON.stringify(netDenied.body)}`,
  );

  // === The question: localhost with the deny present. The seeded filter file promises
  //     loopback is never filtered, and the login doors keep that promise. ===
  const loopDenied = await redisConnect({
    target_ip: '127.0.0.1',
    caller_machine_id: STORE_HOST_ID,
  });
  const loopbackBypassesFilter = loopDenied.status === 200;
  check(
    'deny present — redis-cli localhost STILL connects (loopback is never filtered, as the file promises)',
    loopbackBypassesFilter,
    `status=${loopDenied.status} body=${JSON.stringify(loopDenied.body)}` +
      (loopbackBypassesFilter
        ? ''
        : `  <-- BUG CONFIRMED: the data door filtered loopback; ssh localhost on this same box would connect`),
  );
} finally {
  await cleanUp();
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
