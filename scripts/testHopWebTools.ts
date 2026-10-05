// Wire-check — the web tools (`curl`/`lynx`/`gobuster`) run from a hop.
//
// B sits at home and holds a shell on a box on network N. Every fetch names that box
// (`caller_machine_id`), and the server works out from B's session row where B stands —
// never from anything the request claims. So:
//   - a fetch of a serving host on N's LAN lands an access.log line on THAT host, under
//     N's own key, naming the HOP's LAN address — not a client-sent source;
//   - a fetch of a web host on a DEEP layer the hop reaches lands a line on that host,
//     naming the address the hop is seen at there (the layer's `.1`);
//   - `curl localhost` on the hop lands a line on the hop box itself, over `127.0.0.1`;
//   - a fetch naming a network the hop is not on, or a box B holds no shell on, is refused
//     and writes nothing;
//   - a PUBLIC fetch run from the hop is logged on the target's server under N's public
//     address, the same fetch from home under B's own, and a fetch naming a box B holds
//     no shell on is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopWebTools.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { chainLinks, machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { resolveDeepScanHosts } from '../src/core/scan/deepScanHosts.js';
import { chainGatewayBaseFs } from '../src/core/generation/lanHostIdentity.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteServer } from '../src/core/generation/siteServer.js';
import { publisherIp } from '../src/core/generation/publisher.js';
import { buildRemoteHostFs } from '../src/core/generation/remoteHostFs.js';
import { readOpenPorts } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { publicAddressOf } from './publicAddressOf.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

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
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

const readAccessLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lastLine = (log: string): string => log.trim().split('\n').at(-1) ?? '';
const httpPortOf = (essid: string, host: LanHost): number | null => {
  const open = readOpenPorts(buildRemoteHostFs(essid, host)).find(
    (entry) => entry.service === SERVICE_CATALOG.http.service,
  );
  return open === undefined ? null : open.port;
};

// --- B's home, and the LAN hop network N (needs a serving host + a plain sibling). ---
const HOME = 'SMART-FRIDGE-NET';
const HOME_PUBLIC = publicAddressOf(HOME);

const N = crackableEssidPool.find((essid) => {
  const machines = generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');
  return (
    machines.filter((host) => httpPortOf(essid, host) !== null).length >= 1 && machines.length >= 2
  );
});
if (N === undefined) {
  console.error('no crackable network has a serving host and a sibling — pick another pool');
  process.exit(2);
}
const N_PUBLIC = publicAddressOf(N);
const nMachines = generateHomeLan(N).hosts.filter((host) => host.kind === 'machine');
const nServing = nMachines.find((host) => httpPortOf(N, host) !== null)!;
const nSibling = nMachines.find((host) => host.ip !== nServing.ip)!;
const SERVING_PORT = httpPortOf(N, nServing)!;
const HOP_BOX = machineIdForLanHost(nSibling, N);
const SERVING_ID = hostMachineId(nServing, N);

// --- The deep hop network D: a router-fronted layer with a web host. ---
type Deep = { essid: string; gatewayMachineId: string; subnet: string; hostId: string; ip: string; port: number };
const findDeep = (): Deep | undefined => {
  for (const essid of crackableEssidPool) {
    for (const gateway of chainLinks(essid)) {
      if (gateway.host.kind !== 'router') continue;
      const layer = generateDeepLayer(
        essid,
        { machineId: gateway.machineId, kind: gateway.host.kind },
        { hangsChild: gateway.hangsChild },
      );
      const web = resolveDeepScanHosts(essid, gateway, chainGatewayBaseFs(essid, gateway)).hosts.find(
        (entry) => entry.host.kind === 'machine' && entry.ports.some((p) => p.service === 'http'),
      );
      if (web !== undefined) {
        return {
          essid,
          gatewayMachineId: gateway.machineId,
          subnet: layer.subnet,
          hostId: hostMachineId(web.host, essid),
          ip: web.host.ip,
          port: web.ports.find((p) => p.service === 'http')!.port,
        };
      }
    }
  }
  return undefined;
};
const deep = findDeep();
if (deep === undefined) {
  console.error('no crackable network has a web host on a router-fronted deep layer');
  process.exit(2);
}

// --- The public target: an institution that publishes a website (no seeding needed). ---
const SITE = 'CAMPUS-GUEST-OPEN';
const SITE_IP = publisherIp(SITE);
const SITE_SERVER = siteServer(SITE);
if (SITE_IP === undefined || SITE_SERVER === undefined) {
  console.error(`FATAL: ${SITE} publishes no website`);
  process.exit(2);
}
const SITE_MACHINE = machineIdForLanHost(SITE_SERVER, SITE);
const SITE_KEY = apGatewayLogWriterKey(SITE);

const bob = generateIdentity();
const touched = [HOP_BOX, SERVING_ID, deep.hostId, SITE_MACHINE, computeApGatewayId(SITE)];

const seedSession = async (sessionId: string, machineId: string, essid: string) =>
  sr.from('sessions').insert({
    session_id: sessionId,
    player_key: bob.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid,
  });

for (const machineId of touched) await sr.from('patches').delete().eq('machine_id', machineId);
await leaveNetwork(sr, N);
await standOnNetwork(sr, HOME, bob, 34);
await seedSession('ssh-hop-web-lan', HOP_BOX, N);
await seedSession('ssh-hop-web-deep', deep.gatewayMachineId, deep.essid);

const fetched = (essid: string, target: string, port: number, over: Record<string, unknown>) =>
  signRequest(bob, 'recordLanFetch', { essid, target, port, paths: ['/'], ...over });

try {
  // === 1. A LAN fetch from the hop lands on the serving host, from the hop's address. ===
  const lan = await post(PATCHES, await fetched(N, nServing.ip, SERVING_PORT, { caller_machine_id: HOP_BOX }));
  const servingLog = await readAccessLog(SERVING_ID, apGatewayLogWriterKey(N));
  check(
    "a LAN fetch from the hop names the hop's LAN address on the serving host",
    lan.status === 200 && lastLine(servingLog).includes(`${nSibling.ip} - - [`),
    `status=${lan.status} line="${lastLine(servingLog)}"`,
  );

  // === 2. A deep-layer fetch lands on the deep host, from the layer's .1. ===
  const deepFetch = await post(
    PATCHES,
    await fetched(deep.essid, deep.ip, deep.port, { caller_machine_id: deep.gatewayMachineId }),
  );
  const deepLog = await readAccessLog(deep.hostId, apGatewayLogWriterKey(deep.essid));
  check(
    "a deep-layer fetch names the layer's .1 on the deep host",
    deepFetch.status === 200 && lastLine(deepLog).includes(`${deep.subnet}.1 - - [`),
    `status=${deepFetch.status} line="${lastLine(deepLog)}"`,
  );

  // === 3. A fetch naming a box B holds no shell on is refused. ===
  const noSession = await post(
    PATCHES,
    await fetched(N, nServing.ip, SERVING_PORT, { caller_machine_id: SERVING_ID }),
  );
  check(
    'a fetch from a box held by no shell is refused',
    noSession.status === 403 && noSession.body?.error === 'no_session',
    `status=${noSession.status} body=${JSON.stringify(noSession.body)}`,
  );

  // === 4. A fetch naming a network the hop is not on is refused. ===
  const wrongNet = await post(
    PATCHES,
    await fetched(HOME, nServing.ip, SERVING_PORT, { caller_machine_id: HOP_BOX }),
  );
  check(
    'a fetch naming a network the hop is not on is refused',
    wrongNet.status === 403 && wrongNet.body?.error === 'wrong_network',
    `status=${wrongNet.status} body=${JSON.stringify(wrongNet.body)}`,
  );

  // === 5. `curl localhost` on the hop lands a line on the hop box itself, over loopback. ===
  //      The hop box here is a serving host, so loopback resolves to a box that answers.
  await sr.from('sessions').delete().eq('session_id', 'ssh-hop-web-lan');
  await seedSession('ssh-hop-web-self', SERVING_ID, N);
  const loop = await post(
    PATCHES,
    await fetched(N, '127.0.0.1', SERVING_PORT, { caller_machine_id: SERVING_ID }),
  );
  const selfLog = await readAccessLog(SERVING_ID, apGatewayLogWriterKey(N));
  check(
    'a loopback fetch on the hop is recorded as a local visit',
    loop.status === 200 && lastLine(selfLog).includes('127.0.0.1 - - ['),
    `status=${loop.status} line="${lastLine(selfLog)}"`,
  );

  // === 6. A public fetch from the hop is logged under N's public address. ===
  const pubFromHop = await post(
    NETWORK,
    signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/', caller_machine_id: SERVING_ID }),
  );
  const siteAfterHop = await readAccessLog(SITE_MACHINE, SITE_KEY);
  check(
    "a public fetch from the hop is logged under the hop network's public address",
    pubFromHop.status === 200 && lastLine(siteAfterHop).includes(`${N_PUBLIC} - - [`),
    `status=${pubFromHop.status} line="${lastLine(siteAfterHop)}"`,
  );

  // === 7. The same public fetch from home is logged under B's own public address. ===
  const pubFromHome = await post(
    NETWORK,
    signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/' }),
  );
  const siteAfterHome = await readAccessLog(SITE_MACHINE, SITE_KEY);
  check(
    "the same public fetch from home is logged under B's home address",
    pubFromHome.status === 200 && lastLine(siteAfterHome).includes(`${HOME_PUBLIC} - - [`),
    `status=${pubFromHome.status} line="${lastLine(siteAfterHome)}"`,
  );

  // === 8. A public fetch from a box B holds no shell on is refused. ===
  const pubBorrowed = await post(
    NETWORK,
    signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/', caller_machine_id: HOP_BOX }),
  );
  check(
    'a public fetch from a box held by no shell is refused',
    pubBorrowed.status === 403 && pubBorrowed.body?.error === 'no_session',
    `status=${pubBorrowed.status} body=${JSON.stringify(pubBorrowed.body)}`,
  );
} finally {
  for (const machineId of touched) await sr.from('patches').delete().eq('machine_id', machineId);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
  await leaveNetwork(sr, N);
  await sr.from('home_network_occupants').delete().eq('owner_key', bob.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', bob.publicKeyHex);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
