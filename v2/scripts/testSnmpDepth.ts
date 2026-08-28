// Wire-payload smoke for the SNMP doors reaching THROUGH an inner gateway — the vantage
// where the address a player types is no longer the device that answers.
//
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The `port` field survives the wire on BOTH doors. Every unit test hands the
//     handler a payload object; that the schema accepts it, the envelope carries it, and
//     the dispatch passes it to the reach is provable only here.
//   - THE LOOP, over one live stack: `snmpset` opens a forward on a gateway, the journal
//     stores it, and `snmpwalk` through that same port then answers as the box behind it.
//     Two doors, one file, and nothing logged into at any point.
//   - The chain walk runs against REAL journal replay across TWO machines. A unit test
//     hands the resolver a fake filesystem per hop; that the gateway's stored rules.v4 is
//     what the next reach routes by is only true if the row is real.
//   - The corrected segment bound over the wire: a destination on the layer the gateway
//     FRONTS is written, and one on the LAN it merely stands on is refused. Judged by the
//     typed address these were the wrong way round, and both answers looked like success
//     or failure equally from the client.
//   - A deep box's log line carries the FRONTING GATEWAY's `.1`, written to the DEVICE's
//     own machine row and not the gateway's.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpDepth.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable topology.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { md5 } from '../src/core/generation/md5';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import {
  generateDeepLayer,
  seedNetworkDepth,
} from '../src/core/generation/generateDeepLayer';
import {
  buildDeepGatewayBaseFs,
  buildDeepSwitchBaseFs,
} from '../src/core/generation/routerFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { computeDeepGatewayId, computeInnerGatewayId } from '../src/core/identity/router';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { readOpenPorts } from '../src/core/services/pidfile';
import { SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog';
import { RULES_V4_PATH } from '../src/core/network/iptablesRules';

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

const ATTACKER_IP = '192.168.1.50';
const RW_COMMUNITY = 'corpnet';
const RW_STATE_PATH = '/var/lib/snmp/snmpd.conf';
const FORWARDED_PORT = 2222;
const CLOSED_PORT = 9999;

const attacker = generateIdentity();

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const runsAgent = (baseFs: Parameters<typeof readOpenPorts>[0]): boolean =>
  readOpenPorts(baseFs).some((open) => open.service === SERVICE_CATALOG.snmp.service);

/** Its OWN namespace, shared with no other script — machines are ESSID-seeded, so two
 *  scripts on one ESSID read each other's rows as their own. Searched rather than fixed
 *  because the topology this needs is three seeded rolls deep: a chain at least two
 *  gateways long, an inner router running an agent, and a child gateway behind it
 *  running one too. A world that cannot supply all three stops the run rather than
 *  softening into checks that pass against a shallower network. */
const topology = (() => {
  for (let index = 1; index <= 200; index++) {
    const essid = `SNMP-DEPTH-WIFI-${index}`;
    if (seedNetworkDepth(essid) < 2) continue;
    const lan = generateHomeLan(essid);
    const gateway = lan.hosts.find((host) => host.kind === 'router' && octetOf(host) !== 1);
    if (gateway === undefined) continue;
    const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
    if (!runsAgent(resolveLanHostIdentity(gateway, essid).baseFs)) continue;
    const deep = generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' });
    const device = deep.childGateway;
    if (device === null) continue;
    const deviceOctet = octetOf(device);
    const deviceFs =
      device.kind === 'switch'
        ? buildDeepSwitchBaseFs(gatewayId, deviceOctet)
        : buildDeepGatewayBaseFs(gatewayId, deviceOctet);
    if (!runsAgent(deviceFs)) continue;
    return {
      essid,
      lanSubnet: lan.subnet,
      gateway,
      gatewayId,
      device,
      deviceId: computeDeepGatewayId(gatewayId, deviceOctet),
      deepSubnet: deep.subnet,
    };
  }
  console.error('no seeded world supplies a two-deep chain with agents on both gateways');
  process.exit(2);
})();

const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

/** Plant a file the way its owner's own edit arrives. Loud on failure: a fixture that
 *  cannot be built must stop the run, never soften into a check that passes against an
 *  unmodified world. */
const plant = async (machineId: string, path: string, content: string): Promise<void> => {
  const { error } = await sr.from('patches').insert([
    {
      writer_key: attacker.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    },
  ]);
  if (error !== null) {
    console.error(`could not plant ${path}: ${JSON.stringify(error)}`);
    process.exit(2);
  }
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', topology.gatewayId);
  await sr.from('patches').delete().eq('machine_id', topology.deviceId);
};

const walk = (targetIp: string, options: { port?: number; community?: string } = {}) =>
  post(
    signRequest(attacker, 'snmpWalk', {
      essid: topology.essid,
      target_ip: targetIp,
      port: options.port,
      community: options.community ?? 'public',
      source_ip: ATTACKER_IP,
    }),
  );

const set = (targetIp: string, assignment: string, options: { port?: number } = {}) =>
  post(
    signRequest(attacker, 'snmpSet', {
      essid: topology.essid,
      target_ip: targetIp,
      port: options.port,
      community: RW_COMMUNITY,
      assignment,
      source_ip: ATTACKER_IP,
    }),
  );

const identityIn = (body: unknown): Record<string, unknown> => {
  const identity = (body as { identity?: unknown } | null)?.identity;
  return identity !== null && typeof identity === 'object'
    ? (identity as Record<string, unknown>)
    : {};
};

const contentAt = async (machineId: string, path: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .order('updated_at', { ascending: false })
    .limit(1);
  const row = data?.[0] as { content?: string } | undefined;
  return row?.content ?? '';
};

const sessionRowsForCaller = async (): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', attacker.publicKeyHex);
  return count ?? 0;
};

const main = async (): Promise<void> => {
  console.log(
    `essid  ${topology.essid} (lan ${topology.lanSubnet}.0/24, deep ${topology.deepSubnet}.0/24)\n` +
      `gateway ${topology.gateway.hostname} ${topology.gateway.ip} (machine ${topology.gatewayId})\n` +
      `device  ${topology.device.hostname} ${topology.device.ip} ${topology.device.kind} (machine ${topology.deviceId})\n` +
      `acting as ${attacker.publicKeyHex.slice(0, 8)}... from ${ATTACKER_IP}\n`,
  );

  await clear();
  await plant(topology.gatewayId, RW_STATE_PATH, `rwcommunity ${md5(RW_COMMUNITY)}\n`);

  // ─── the gateway answers at its own address, with no port naming anything behind it ───
  const bare = await walk(topology.gateway.ip);
  check(
    'a bare address walks the gateway itself',
    bare.status === 200 && identityIn(bare.body).hostname === topology.gateway.hostname,
    `${bare.status} ${JSON.stringify(identityIn(bare.body).hostname)}`,
  );

  // ─── the write that opens the way in ───
  const opened = await set(
    topology.gateway.ip,
    `natForward.${FORWARDED_PORT}=${topology.device.ip}:161`,
  );
  check(
    'a forward onto the layer the gateway fronts is accepted',
    opened.status === 200 && (opened.body as { ok?: boolean } | null)?.ok === true,
    `${opened.status} ${JSON.stringify(opened.body)}`,
  );

  const storedRules = await contentAt(topology.gatewayId, RULES_V4_PATH);
  check(
    'and the journal really holds it, as the file the world routes by',
    storedRules.includes(`forward ${FORWARDED_PORT} to ${topology.device.ip}:161`),
    JSON.stringify(storedRules),
  );

  // ─── THE LOOP: what the set opened, the walk now reaches ───
  const deep = await walk(topology.gateway.ip, { port: FORWARDED_PORT });
  check(
    'the walk through that port answers as the DEVICE behind it',
    deep.status === 200 && identityIn(deep.body).hostname === topology.device.hostname,
    `${deep.status} ${JSON.stringify(identityIn(deep.body).hostname)} (gateway is ${topology.gateway.hostname})`,
  );

  check(
    "and reports the device's own address, not the one that was typed",
    JSON.stringify(identityIn(deep.body).addresses) === JSON.stringify([topology.device.ip]),
    JSON.stringify(identityIn(deep.body).addresses),
  );

  const deviceLog = await contentAt(topology.deviceId, SNMPD_LOG_PATH);
  check(
    "the device's own log records the visit, on the device's machine row",
    deviceLog.length > 0,
    `${deviceLog.split('\n').filter(Boolean).length} line(s) on ${topology.deviceId}`,
  );

  check(
    'and stamps it from the fronting gateway, which is all NAT ever shows it',
    deviceLog.includes(`${topology.deepSubnet}.1`) && !deviceLog.includes(ATTACKER_IP),
    JSON.stringify(deviceLog.split('\n')[0] ?? ''),
  );

  // ─── the bound, the way round it has to be ───
  const offSegment = await set(
    topology.gateway.ip,
    `natForward.3333=${topology.lanSubnet}.9:22`,
  );
  check(
    'a destination on the LAN the gateway merely stands on is refused',
    offSegment.status === 200 && (offSegment.body as { ok?: boolean } | null)?.ok === false,
    `${offSegment.status} ${JSON.stringify(offSegment.body)}`,
  );

  check(
    'and nothing of it reached the file',
    !(await contentAt(topology.gatewayId, RULES_V4_PATH)).includes('3333'),
    JSON.stringify(await contentAt(topology.gatewayId, RULES_V4_PATH)),
  );

  // ─── ports that name nothing ───
  const closed = await walk(topology.gateway.ip, { port: CLOSED_PORT });
  check(
    'a port the gateway neither listens on nor forwards is silence',
    closed.status === 404,
    `${closed.status} ${JSON.stringify(closed.body)}`,
  );

  const wrongCommunity = await walk(topology.gateway.ip, {
    port: FORWARDED_PORT,
    community: 'not-this-one',
  });
  check(
    'and a community the device does not answer is the same silence',
    wrongCommunity.status === 404,
    `${wrongCommunity.status} ${JSON.stringify(wrongCommunity.body)}`,
  );

  check(
    'none of it minted a session, at the tier that reconfigures a hidden device',
    (await sessionRowsForCaller()) === 0,
    `${await sessionRowsForCaller()} session row(s) for the caller`,
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
