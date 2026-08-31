// Wire-payload smoke for the SNMP doors across the world — B reconfigures an access
// point they have never stood on, reached only by the address the internet routes it by.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// This is the whole D8 arc end to end, and the first live proof that the four doors
// resolve the SAME box from a public address: nmap's world, hydra's sweep, the walk's
// read and the set's write, plus ssh walking through the door the set opened.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the SNMP doors DISPATCHED for a public address at all. Every unit test hands the
//     handlers a fake filesystem and a fake lookup; that a public IP resolves through
//     the real column selections — network_public_ips, home_network_occupants,
//     network_lan_leases, patches — is provable only here.
//   - the community a sweep reports being the one the walk and the set then ACCEPT.
//     Three doors reading one seeded string off one materialized gateway; a live run is
//     what turns "by construction" into evidence.
//   - the forward B writes being LIVE: the rule lands in the gateway's own rules.v4 row
//     and `ssh` immediately walks through it onto A's workstation. One table, written by
//     a stranger, read by the resolver every public door shares.
//   - the bound on where that forward may point, resolved from the DEFENDER's network
//     server-side. The ESSID on B's request names their own wifi, and judged by it every
//     address inside A's LAN would be refused.
//   - whose row the gateway's log accretes under, with two strangers writing to it.
//   - the filter closing the agent to the world, which slice 6 could only ever exercise
//     from inside a LAN.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { seedApGatewayCommunity, seedApGatewayHostname } from '../src/core/generation/routerFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { formatSnmpdState } from '../src/core/snmp/rwCommunity';
import { formatPidfileContent, pidfilePath } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import { SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog';
import { RULES_V4_PATH } from '../src/core/network/iptablesRules';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';
import type { Identity } from '../src/core/commands/types';

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

/** Read an untyped body the way a CLIENT has to — by the keys present, off whatever the
 *  wire actually returned, never through a type the server was assumed to honour. */
const fieldOf = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null
    ? Object.getOwnPropertyDescriptor(body, key)?.value
    : undefined;

const errorOf = (body: unknown): string => String(fieldOf(body, 'error') ?? '');
const textOf = (body: unknown): string => JSON.stringify(body ?? null);
const identityOf = (body: unknown): unknown => fieldOf(body, 'identity');
const refusalOf = (body: unknown, key: string): string =>
  String(fieldOf(fieldOf(body, 'refusal'), key) ?? '');
const crackedIn = (body: unknown): readonly { password?: string }[] => {
  const cracked = fieldOf(body, 'cracked');
  return Array.isArray(cracked) ? (cracked as { password?: string }[]) : [];
};

// === The two worlds ===
// A owns an access point and has never heard of B. B stands on a different network
// entirely and reaches A only by the address the internet routes A's gateway by.
const defender = generateIdentity();
const attacker = generateIdentity();
// A second stranger, so the gateway's single log row is proved with two authors rather
// than asserted about one.
const bystander = generateIdentity();

const TARGET_ESSID = 'PIED-PIPER-CROSS';
const TARGET_PUBLIC_IP = '203.0.113.41';
const TARGET_GATEWAY = computeApGatewayId(TARGET_ESSID);
const TARGET_SUBNET = generateHomeLan(TARGET_ESSID).subnet;
const GATEWAY_HOSTNAME = seedApGatewayHostname(TARGET_ESSID);
/** Seeded from A's ESSID and nothing B holds — the string the whole arc is aimed at. */
const COMMUNITY = seedApGatewayCommunity(TARGET_ESSID);

const DEFENDER_OCTET = 23;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
const DEFENDER_WS = computeWorkstationId('anton', defender.publicKeyHex);
const DEFENDER_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);
/** A community on A's OWN workstation agent, so the box behind the forward answers a
 *  set — which is how "this device fronts no network" gets said out loud. */
const DEFENDER_WS_COMMUNITY = 'homelab';

// B's own network. Only the server can name it: it walks B's verified key to their
// occupancy row and reads the address from there, which is what makes A's log evidence.
const ATTACKER_ESSID = 'BEAN-THERE-CROSS';
const ATTACKER_PUBLIC_IP = '198.51.100.31';
const ATTACKER_SUBNET = generateHomeLan(ATTACKER_ESSID).subnet;
const ATTACKER_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);

const BYSTANDER_ESSID = 'HOOLI-CROSS';
const BYSTANDER_PUBLIC_IP = '198.51.100.32';
const BYSTANDER_WS = computeWorkstationId('erlich', bystander.publicKeyHex);

if (TARGET_SUBNET === ATTACKER_SUBNET) {
  console.error('the two worlds share a subnet — pick another ESSID, the bound proves nothing');
  process.exit(2);
}

const UNREGISTERED_IP = '203.0.113.254';
/** The door B opens into A's LAN. Not 22: on this address 22 is the GATEWAY. */
const PUBLISHED_PORT = 2222;
/** A door A opened for themselves BEFORE any of this, onto their own agent. It shares
 *  the file B is about to write into, and it is how the box behind a forward gets
 *  reached at all. */
const OWNER_PORT = 2223;

const SNMPD_STATE_PATH = '/var/lib/snmp/snmpd.conf';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_READABLE = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const MACHINES = [TARGET_GATEWAY, DEFENDER_WS, ATTACKER_WS, BYSTANDER_WS];
const NETWORKS = [
  { essid: TARGET_ESSID, publicIp: TARGET_PUBLIC_IP },
  { essid: ATTACKER_ESSID, publicIp: ATTACKER_PUBLIC_IP },
  { essid: BYSTANDER_ESSID, publicIp: BYSTANDER_PUBLIC_IP },
];

const clean = async (): Promise<void> => {
  await clearPublicIps(sr, NETWORKS);
  for (const { essid } of NETWORKS) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  for (const machineId of MACHINES) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  for (const player of [attacker, bystander]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  }
};

/** Plant a file the way its owner's own edit arrives. Loud on failure: a fixture that
 *  cannot be built must stop the run, never soften into a check that passes against an
 *  unmodified world. */
const plant = async (
  writer: Identity,
  machineId: string,
  path: string,
  content: string,
  permissions: Record<string, readonly string[]> = ROOT_ONLY,
): Promise<void> => {
  const { error } = await sr.from('patches').upsert(
    {
      writer_key: writer.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions,
      node_type: 'file',
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error !== null) {
    console.error(`FATAL: could not plant ${path} on ${machineId}: ${error.message}`);
    process.exit(1);
  }
};

const joinNetwork = async (
  player: Identity,
  network: { readonly essid: string; readonly machineId: string; readonly name: string },
): Promise<void> => {
  const { error } = await sr.from('home_network_occupants').insert({
    essid: network.essid,
    owner_key: player.publicKeyHex,
    workstation_machine_id: network.machineId,
    workstation_username: network.name,
    workstation_machine_name: network.name,
    workstation_root_hash: md5(`${network.name}-root-secret`),
  });
  if (error !== null) {
    console.error(`FATAL: could not join ${network.essid}: ${error.message}`);
    process.exit(1);
  }
};

// === Envelopes ===
const walkAs = (player: Identity) =>
  // The ESSID is the CALLER's own wifi, exactly as their client sends it — the whole
  // point being that the server must not believe a word of it about A's device.
  (essid: string, community: string, targetIp = TARGET_PUBLIC_IP) =>
    post(
      signRequest(player, 'snmpWalk', { essid, target_ip: targetIp, community, source_ip: null }),
    );

const setAs = (player: Identity) =>
  (
    essid: string,
    assignment: string,
    over: { readonly community?: string; readonly port?: number } = {},
  ) =>
    post(
      signRequest(player, 'snmpSet', {
        essid,
        target_ip: TARGET_PUBLIC_IP,
        port: over.port,
        community: over.community ?? COMMUNITY,
        assignment,
        source_ip: null,
      }),
    );

const walk = walkAs(attacker);
const set = setAs(attacker);

const sweep = (targetIp = TARGET_PUBLIC_IP) =>
  post(
    signRequest(attacker, 'hydraCrackPublic', {
      essid: ATTACKER_ESSID,
      target: targetIp,
      service: SERVICE_CATALOG.snmp.service,
      port: SERVICE_CATALOG.snmp.defaultPort,
      caller_machine_id: ATTACKER_WS,
    }),
  );

const rowAt = async (
  machineId: string,
  path: string,
): Promise<{ content: string; writerKey: string; rows: number } | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path);
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as { content: string | null; writer_key: string };
  return { content: first.content ?? '', writerKey: first.writer_key, rows: data.length };
};

const sessionRowsFor = async (player: Identity): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', player.publicKeyHex);
  return count ?? 0;
};

// === The world, as a real join would leave it ===
await clean();
await seedPublicIps(sr, NETWORKS);

// A joined their own network and holds its only lease — which is what gives their
// ownerless gateway a stable row to keep its log in.
await joinNetwork(defender, { essid: TARGET_ESSID, machineId: DEFENDER_WS, name: 'anton' });
const { error: leaseError } = await sr
  .from('network_lan_leases')
  .insert({ essid: TARGET_ESSID, owner_key: defender.publicKeyHex, octet: DEFENDER_OCTET });
if (leaseError !== null) {
  console.error(`FATAL: could not seed A's lease: ${leaseError.message}`);
  process.exit(1);
}

await joinNetwork(attacker, { essid: ATTACKER_ESSID, machineId: ATTACKER_WS, name: 'cracklab' });
await joinNetwork(bystander, { essid: BYSTANDER_ESSID, machineId: BYSTANDER_WS, name: 'erlich' });

// A brought their own box up: an sshd for the door B is about to open onto it, and an
// agent of their own with a community they chose.
await plant(
  defender,
  DEFENDER_WS,
  pidfilePath(SERVICE_CATALOG.ssh),
  formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
  WORLD_READABLE,
);
await plant(
  defender,
  DEFENDER_WS,
  pidfilePath(SERVICE_CATALOG.snmp),
  formatPidfileContent(SERVICE_CATALOG.snmp, SERVICE_CATALOG.snmp.defaultPort),
  WORLD_READABLE,
);
await plant(
  defender,
  DEFENDER_WS,
  SNMPD_STATE_PATH,
  formatSnmpdState(md5(DEFENDER_WS_COMMUNITY)),
);

// A's own forward, written with `nano` long before B showed up.
await plant(
  defender,
  TARGET_GATEWAY,
  RULES_V4_PATH,
  `# /etc/iptables/rules.v4 — NAT port-forward table\nforward ${OWNER_PORT} to ${DEFENDER_LAN_IP}:${SERVICE_CATALOG.snmp.defaultPort}\n`,
);

// B's wordlist, as `apt install hydra` leaves it, holding the string that opens A's
// gateway among words that do not.
await plant(
  attacker,
  ATTACKER_WS,
  WORDLIST_PATH,
  formatWordlist(['hunter2', 'letmein', COMMUNITY]),
  WORLD_READABLE,
);

console.log(
  `A: ${TARGET_ESSID} @ ${TARGET_PUBLIC_IP} — gateway ${GATEWAY_HOSTNAME} (${TARGET_GATEWAY})\n` +
    `   lease ${DEFENDER_LAN_IP}, workstation ${DEFENDER_WS}\n` +
    `B: ${ATTACKER_ESSID} @ ${ATTACKER_PUBLIC_IP} — ${attacker.publicKeyHex.slice(0, 8)}...\n`,
);

// === 1. The free look. `public` is not a secret and never was. ===
const identityWalk = await walk(ATTACKER_ESSID, 'public');
const addresses = JSON.stringify(fieldOf(identityOf(identityWalk.body), 'addresses') ?? null);
check(
  '1. a stranger walks the gateway and gets its name and its public face ALONE',
  identityWalk.status === 200 &&
    fieldOf(identityWalk.body, 'tier') === 'read-only' &&
    fieldOf(identityOf(identityWalk.body), 'hostname') === GATEWAY_HOSTNAME &&
    addresses === JSON.stringify([TARGET_PUBLIC_IP]) &&
    !textOf(identityWalk.body).includes(TARGET_SUBNET),
  `${identityWalk.status} addresses ${addresses} | ${textOf(identityWalk.body).slice(0, 160)}`,
);

// === 2. The sweep. The one credential here that belongs to no person. ===
const swept = await sweep();
const community = crackedIn(swept.body)[0]?.password;
check(
  "2. hydra recovers the gateway's read-write community from B's own wordlist",
  swept.status === 200 && community === COMMUNITY,
  `${swept.status} cracked ${JSON.stringify(crackedIn(swept.body))}`,
);

// === 3. What the sweep reported, the walk accepts — one string, two doors. ===
const tableWalk = await walk(ATTACKER_ESSID, community ?? 'nothing-cracked');
check(
  '3. the walk answers that community with the port table read from A’s own rules file',
  tableWalk.status === 200 &&
    fieldOf(tableWalk.body, 'tier') === 'read-write' &&
    textOf(tableWalk.body).includes(`"publicPort":${OWNER_PORT}`),
  `${tableWalk.status} ${textOf(tableWalk.body).slice(0, 200)}`,
);

// === 4. THE observable. A stranger opens a port into somebody else's home. ===
const opened = await set(ATTACKER_ESSID, `forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`, {
  community: community ?? 'nothing-cracked',
});
check(
  '4. the set is accepted and echoes what the port was and now is',
  opened.status === 200 &&
    fieldOf(opened.body, 'ok') === true &&
    fieldOf(opened.body, 'value') === `${DEFENDER_LAN_IP}:22`,
  `${opened.status} ${textOf(opened.body)}`,
);

// === 5. One table, two authors. ===
const rules = await rowAt(TARGET_GATEWAY, RULES_V4_PATH);
check(
  "5. the rule lands in the gateway's OWN file, beside the one its owner wrote",
  rules !== null &&
    rules.rows === 1 &&
    rules.content.includes(`forward ${PUBLISHED_PORT} to ${DEFENDER_LAN_IP}:22`) &&
    rules.content.includes(`forward ${OWNER_PORT} to ${DEFENDER_LAN_IP}:161`),
  rules === null ? 'no rules.v4 row' : `${rules.rows} row(s) | ${JSON.stringify(rules.content)}`,
);

// === 6. No session anywhere. This tier rewrites a NAT table without one. ===
check(
  '6. neither the walk nor the set minted a session row',
  (await sessionRowsFor(attacker)) === 0,
  `${await sessionRowsFor(attacker)} session row(s) for B`,
);

// === 7. The door is real: ssh walks straight through it onto A's box. ===
const throughTheDoor = await post(
  signRequest(attacker, 'authCreateSessionPublic', {
    session_id: `ssh-cross-${Date.now()}`,
    target: TARGET_PUBLIC_IP,
    username: 'guest',
    password: DEFENDER_GUEST_PW,
    port: PUBLISHED_PORT,
    parent_session_id: null,
    source_ip: null,
  }),
);
check(
  "7. ssh through the port B published lands on A's workstation",
  throughTheDoor.status === 200 && fieldOf(throughTheDoor.body, 'machine_id') === DEFENDER_WS,
  `${throughTheDoor.status} machine ${String(fieldOf(throughTheDoor.body, 'machine_id'))}`,
);

// === 8. A's only evidence, and it names B by an address B never sent. ===
const log = await rowAt(TARGET_GATEWAY, SNMPD_LOG_PATH);
check(
  "8. the gateway's log carries B's own public address, in A's row and never B's",
  log !== null &&
    log.rows === 1 &&
    log.content.includes(ATTACKER_PUBLIC_IP) &&
    log.content.includes(`SET forward.${PUBLISHED_PORT}`) &&
    log.writerKey === defender.publicKeyHex &&
    log.writerKey !== attacker.publicKeyHex,
  log === null
    ? 'no snmpd.log row'
    : `${log.rows} row(s), writer ${log.writerKey.slice(0, 12)}... | ${log.content.split('\n').filter(Boolean).slice(-2).join(' | ')}`,
);

// === 9. A second stranger adds to that row rather than replacing it. ===
const linesBefore = (log?.content ?? '').split('\n').filter(Boolean).length;
await walkAs(bystander)(BYSTANDER_ESSID, 'public');
const accreted = await rowAt(TARGET_GATEWAY, SNMPD_LOG_PATH);
check(
  "9. a second stranger's visit accretes onto the same row, erasing nothing",
  accreted !== null &&
    accreted.rows === 1 &&
    accreted.content.includes(ATTACKER_PUBLIC_IP) &&
    accreted.content.includes(BYSTANDER_PUBLIC_IP) &&
    accreted.content.split('\n').filter(Boolean).length > linesBefore,
  accreted === null
    ? 'no snmpd.log row'
    : `${accreted.rows} row(s), ${linesBefore} → ${accreted.content.split('\n').filter(Boolean).length} lines`,
);

// === 10–11. A community you have not cracked is silence — and still recorded. ===
const nowhere = await walk(ATTACKER_ESSID, 'public', UNREGISTERED_IP);
const refusedCommunity = await walk(ATTACKER_ESSID, 'not-the-one');
check(
  '10. a wrong community answers word-for-word what an address bearing no network does',
  refusedCommunity.status === nowhere.status &&
    errorOf(refusedCommunity.body) === errorOf(nowhere.body) &&
    refusedCommunity.status === 404 &&
    errorOf(refusedCommunity.body) === 'host_unreachable',
  `refused ${refusedCommunity.status} ${errorOf(refusedCommunity.body)} | nowhere ${nowhere.status} ${errorOf(nowhere.body)}`,
);

const afterRefusal = await rowAt(TARGET_GATEWAY, SNMPD_LOG_PATH);
check(
  '11. the refused visit is silent to the caller and never to the owner',
  afterRefusal !== null &&
    afterRefusal.content.includes(
      `Authentication failure (incorrect community name) from UDP: [${ATTACKER_PUBLIC_IP}]`,
    ),
  afterRefusal === null
    ? 'no snmpd.log row'
    : afterRefusal.content.split('\n').filter(Boolean).slice(-1).join(''),
);

// === 12. The bound, judged by A's network and never by the one on B's request. ===
const offSegment = await set(ATTACKER_ESSID, `forward.9001=${ATTACKER_SUBNET}.44:22`, {
  community: community ?? 'nothing-cracked',
});
check(
  "12. a forward aimed at B's OWN LAN is refused — the device's segment decides, not the request's",
  offSegment.status === 200 &&
    refusalOf(offSegment.body, 'reason') === 'wrongValue' &&
    refusalOf(offSegment.body, 'detail') === `${ATTACKER_SUBNET}.44 is not on this device's segment`,
  `${offSegment.status} ${textOf(offSegment.body)}`,
);

// === 13. A box behind the NAT fronts nothing, and the refusal says so. ===
const onWorkstation = await set(ATTACKER_ESSID, `forward.9002=${DEFENDER_LAN_IP}:22`, {
  community: DEFENDER_WS_COMMUNITY,
  port: OWNER_PORT,
});
check(
  '13. a NAT rule on the box behind the forward is refused for fronting no network at all',
  onWorkstation.status === 200 &&
    refusalOf(onWorkstation.body, 'reason') === 'wrongValue' &&
    refusalOf(onWorkstation.body, 'detail') === 'this device fronts no network',
  `${onWorkstation.status} ${textOf(onWorkstation.body)}`,
);

// === 14–15. A's filter closes the agent to the world, on both doors. ===
await plant(
  defender,
  TARGET_GATEWAY,
  RULES_V4_PATH,
  `# /etc/iptables/rules.v4 — NAT port-forward table\ndeny ${SERVICE_CATALOG.snmp.defaultPort}\n`,
);
const filteredWalk = await walk(ATTACKER_ESSID, community ?? 'nothing-cracked');
check(
  '14. a gateway whose owner denied 161 is dark to the walk, exactly as an empty address is',
  filteredWalk.status === nowhere.status && errorOf(filteredWalk.body) === errorOf(nowhere.body),
  `filtered ${filteredWalk.status} ${errorOf(filteredWalk.body)} | nowhere ${nowhere.status} ${errorOf(nowhere.body)}`,
);

const filteredSweep = await sweep();
check(
  '15. …and dark to the sweep, so a wordlist cannot tell defended from absent',
  filteredSweep.status === 404 && errorOf(filteredSweep.body) === 'host_unreachable',
  `${filteredSweep.status} ${errorOf(filteredSweep.body)}`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
