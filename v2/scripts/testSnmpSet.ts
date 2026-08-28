// Wire-payload smoke for the SNMP WRITE door — `snmpSet` against a generated device.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `snmpSet` is DISPATCHED at all, with the dep set its own block builds. It is the
//     first door in the game that WRITES a file the rest of the world routes by, so a
//     write landing at the wrong path, on the wrong machine, or under the wrong writer
//     key would pass every unit test in the suite and still produce a forward nothing
//     honours.
//   - The port table is read and stored back through the REAL journal replay. Every
//     unit test hands the handler a fake filesystem; that the edit lands on the row a
//     later read actually replays is provable only here.
//   - THE TWO DOORS AGREE over one live stack: what `snmpSet` writes, `snmpWalk` reads
//     back as the device's port table. One fact, two interfaces, across the wire.
//   - The SET line lands in the device's own `/var/log/snmpd.log`, in the SAME row as
//     the arrival and the verdict — one append, not three racing read-modify-writes.
//   - A refusal AFTER the community was accepted is a 200 carrying a reason, while a
//     refused community is the walk's own 404 silence. Off the wire, not compared as
//     two objects in memory.
//   - A set mints NO row in `sessions`, at the tier that rewrites a NAT table.
//   - The switch half writes a DIFFERENT file through the same door.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpSet.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable device.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { md5 } from '../src/core/generation/md5';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { readOpenPorts } from '../src/core/services/pidfile';
import { SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog';
import { RULES_V4_PATH } from '../src/core/network/iptablesRules';
import { ACL_CONF_PATH } from '../src/core/network/switchAcl';

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

// Its own ESSID, shared with no other check. Machines are ESSID-seeded, so two scripts
// on one ESSID read each other's rows as their own.
const ESSID = 'SNMP-SET-WIFI';
const ATTACKER_IP = '192.168.1.50';
const NOWHERE_IP = '10.255.255.254';
/** Planted in the clear rather than cracked: this script proves the DOOR, and
 *  `routerFs.test.ts` owns the seeding. */
const RW_COMMUNITY = 'corpnet';
const RW_STATE_PATH = '/var/lib/snmp/snmpd.conf';
const FORWARDED_PORT = 2222;

const lan = generateHomeLan(ESSID);
const attacker = generateIdentity();

/** An address on the device's own segment — the only place a forward may point. */
const onSegment = (octet: number): string => `${lan.subnet}.${octet}`;
const FORWARD_TARGET = `${onSegment(10)}:22`;

const runsAgent = (baseFs: Parameters<typeof readOpenPorts>[0]): boolean =>
  readOpenPorts(baseFs).some(({ service }) => service === SERVICE_CATALOG.snmp.service);

// The access point's own `.1` — pinned to run an agent on every ESSID, and the router
// this door was aimed at.
const gateway = lan.hosts.find((host) => host.ip.endsWith('.1'));
if (gateway === undefined) {
  console.error(`ESSID ${ESSID} generated no .1 gateway — pick another ESSID.`);
  process.exit(2);
}

const router = resolveLanHostIdentity(gateway, ESSID);
if (!runsAgent(router.baseFs)) {
  console.error(
    `${gateway.hostname} (${gateway.ip}) runs no SNMP agent — pick another ESSID.`,
  );
  process.exit(2);
}

// A switch on the same LAN, for the half of the door that writes the OTHER file.
const switchHost = lan.hosts.find(
  (host) =>
    host.kind === 'switch' &&
    !host.ip.endsWith('.1') &&
    runsAgent(resolveLanHostIdentity(host, ESSID).baseFs),
);
if (switchHost === undefined) {
  console.error(`ESSID ${ESSID} has no switch running an agent — pick another ESSID.`);
  process.exit(2);
}
const switchDevice = resolveLanHostIdentity(switchHost, ESSID);

type StoredRow = {
  readonly content: string;
  readonly owner: string;
  readonly writerKey: string;
  readonly rows: number;
};

const stringAt = (row: object, key: string): string =>
  String(Object.getOwnPropertyDescriptor(row, key)?.value ?? '');

const rowAt = async (machineId: string, path: string): Promise<StoredRow | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, owner, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path);
  if (!Array.isArray(data) || data.length === 0) return null;
  const first: unknown = data[0];
  if (typeof first !== 'object' || first === null) return null;
  return {
    content: stringAt(first, 'content'),
    owner: stringAt(first, 'owner'),
    writerKey: stringAt(first, 'writer_key'),
    rows: data.length,
  };
};

const contentAt = async (machineId: string, path: string): Promise<string> =>
  (await rowAt(machineId, path))?.content ?? '';

const linesOf = (content: string): readonly string[] => content.split('\n').filter(Boolean);

const stringField = (body: unknown, key: string): string => {
  if (typeof body !== 'object' || body === null) return '';
  return String(Object.getOwnPropertyDescriptor(body, key)?.value ?? '');
};

/** A refusal as a CLIENT has to read it — off an untyped body, by the keys present. */
const refusalIn = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null) return {};
  const refusal = Object.getOwnPropertyDescriptor(body, 'refusal')?.value;
  return typeof refusal === 'object' && refusal !== null
    ? (refusal as Record<string, unknown>)
    : {};
};

const portTableIn = (body: unknown): string => {
  if (typeof body !== 'object' || body === null) return '';
  const table = Object.getOwnPropertyDescriptor(body, 'portTable')?.value;
  return JSON.stringify(table ?? null);
};

const sessionRowsForCaller = async (): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', attacker.publicKeyHex);
  return count ?? 0;
};

const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

/** Plant a file on a device the way its owner's own edit arrives. Loud on failure: a
 *  fixture that cannot be built must stop the run, never soften into a check that
 *  passes against an unmodified world. */
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

const set = (targetIp: string, assignment: string, community = RW_COMMUNITY) =>
  post(
    signRequest(attacker, 'snmpSet', {
      essid: ESSID,
      target_ip: targetIp,
      community,
      assignment,
      source_ip: ATTACKER_IP,
    }),
  );

const walk = (targetIp: string, community = RW_COMMUNITY) =>
  post(
    signRequest(attacker, 'snmpWalk', {
      essid: ESSID,
      target_ip: targetIp,
      community,
      source_ip: ATTACKER_IP,
    }),
  );

// Deleted at SETUP, not only at teardown: machine ids are ESSID-seeded and therefore
// identical across runs, so a crashed run leaves rows the next one would read as its own.
const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', router.machineId);
  await sr.from('patches').delete().eq('machine_id', switchDevice.machineId);
};

const main = async (): Promise<void> => {
  console.log(
    `router ${gateway.hostname} ${gateway.ip} (machine ${router.machineId})\n` +
      `switch ${switchHost.hostname} ${switchHost.ip} (machine ${switchDevice.machineId})\n` +
      `setting as ${attacker.publicKeyHex.slice(0, 8)}... from ${ATTACKER_IP}\n`,
  );

  await clear();
  await plant(router.machineId, RW_STATE_PATH, `rwcommunity ${md5(RW_COMMUNITY)}\n`);

  // ─── the set that is applied ───
  const opened = await set(gateway.ip, `natForward.${FORWARDED_PORT}=${FORWARD_TARGET}`);
  check(
    'snmpSet is dispatched at all, and echoes the state the port is now in',
    opened.status === 200 &&
      stringField(opened.body, 'ok') === 'true' &&
      stringField(opened.body, 'oid') === `NAT-MIB::natForward.${FORWARDED_PORT}` &&
      stringField(opened.body, 'value') === FORWARD_TARGET,
    `status ${opened.status} ${JSON.stringify(opened.body)}`,
  );

  const stored = await rowAt(router.machineId, RULES_V4_PATH);
  check(
    'the forward lands on the device own rules.v4, as one root-owned row',
    stored !== null &&
      stored.rows === 1 &&
      stored.owner === 'root' &&
      stored.writerKey === attacker.publicKeyHex,
    `${RULES_V4_PATH}: ${stored === null ? 'no row' : `${stored.rows} row(s), owner ${stored.owner}`}`,
  );
  check(
    'and it is the seeded file plus one line, header and commented example intact',
    (stored?.content ?? '').includes('# /etc/iptables/rules.v4 — NAT port-forward table') &&
      (stored?.content ?? '').includes('# forward 2222 to 10.0.0.10:22') &&
      linesOf(stored?.content ?? '').filter((line) => !line.startsWith('#')).length === 1,
    JSON.stringify(stored?.content ?? ''),
  );

  // The two doors over one live replay: what the write stored, the read renders.
  const afterOpen = await walk(gateway.ip);
  check(
    'and snmpWalk reads it back as the device port table — one fact, two doors',
    portTableIn(afterOpen.body) ===
      JSON.stringify({
        kind: 'nat',
        forwards: [{ publicPort: FORWARDED_PORT, internalIp: onSegment(10), internalPort: 22 }],
      }),
    `table ${portTableIn(afterOpen.body)}`,
  );

  // ─── what the device kept ───
  const trace = await rowAt(router.machineId, SNMPD_LOG_PATH);
  const setLines = linesOf(trace?.content ?? '');
  check(
    'the arrival, the verdict and the SET line share one row on snmpd.log',
    trace !== null &&
      trace.rows === 1 &&
      setLines.length >= 3 &&
      setLines[0]?.includes(`Connection from UDP: [${ATTACKER_IP}]`) === true &&
      setLines[1]?.includes(`Authentication succeeded from UDP: [${ATTACKER_IP}]`) === true &&
      setLines[2]?.includes(
        `SET NAT-MIB::natForward.${FORWARDED_PORT} = none -> ${FORWARD_TARGET} ` +
          `from UDP: [${ATTACKER_IP}]`,
      ) === true,
    JSON.stringify(setLines),
  );

  // ─── the set that overwrites ───
  const moved = await set(gateway.ip, `natForward.${FORWARDED_PORT}=${onSegment(11)}:3306`);
  check(
    'a second set on the same port overwrites it and names both values',
    stringField(moved.body, 'value') === `${onSegment(11)}:3306` &&
      (await contentAt(router.machineId, SNMPD_LOG_PATH)).includes(
        `SET NAT-MIB::natForward.${FORWARDED_PORT} = ${FORWARD_TARGET} -> ${onSegment(11)}:3306`,
      ),
    `value ${stringField(moved.body, 'value')}`,
  );

  // ─── the set that closes ───
  await set(gateway.ip, `natForward.${FORWARDED_PORT}=none`);
  const afterClose = await walk(gateway.ip);
  check(
    'closing the port empties the table the walk renders',
    portTableIn(afterClose.body) === JSON.stringify({ kind: 'nat', forwards: [] }),
    `table ${portTableIn(afterClose.body)}`,
  );

  // ─── refusals, once the community has been accepted ───
  const beforeRefusals = await contentAt(router.machineId, RULES_V4_PATH);

  const offSegment = await set(gateway.ip, `natForward.${FORWARDED_PORT}=10.9.9.9:22`);
  check(
    'a forward off the device segment is refused with a reason, not with silence',
    offSegment.status === 200 &&
      refusalIn(offSegment.body)['reason'] === 'wrongValue' &&
      String(refusalIn(offSegment.body)['detail']).includes('10.9.9.9'),
    `status ${offSegment.status} ${JSON.stringify(offSegment.body)}`,
  );

  const readOnly = await set(gateway.ip, `natForward.${FORWARDED_PORT}=${FORWARD_TARGET}`, 'public');
  check(
    'and so is the free community, which the device answers but cannot write with',
    readOnly.status === 200 && refusalIn(readOnly.body)['reason'] === 'notWritable',
    `status ${readOnly.status} ${JSON.stringify(readOnly.body)}`,
  );

  const wrongMib = await set(gateway.ip, 'aclPort.22=deny');
  check(
    'and an OID the router does not implement, named as the MIB it belongs to',
    refusalIn(wrongMib.body)['reason'] === 'noSuchName' &&
      String(refusalIn(wrongMib.body)['detail']).includes('ACL-MIB'),
    JSON.stringify(wrongMib.body),
  );

  check(
    'none of the three touched the file',
    (await contentAt(router.machineId, RULES_V4_PATH)) === beforeRefusals,
    `rules.v4 ${(await contentAt(router.machineId, RULES_V4_PATH)) === beforeRefusals ? 'unchanged' : 'CHANGED'}`,
  );

  // ─── silence, before the community is accepted ───
  const beforeSilence = await contentAt(router.machineId, RULES_V4_PATH);
  const wrongString = await set(gateway.ip, `natForward.${FORWARDED_PORT}=none`, 'not-the-string');
  const absent = await set(NOWHERE_IP, `natForward.${FORWARDED_PORT}=none`);
  check(
    'a refused community is word-for-word an address nothing occupies',
    wrongString.status === 404 &&
      wrongString.status === absent.status &&
      JSON.stringify(wrongString.body) === JSON.stringify(absent.body),
    `refused ${wrongString.status} ${JSON.stringify(wrongString.body)} / absent ${absent.status} ${JSON.stringify(absent.body)}`,
  );
  check(
    'and it wrote nothing, though the guess itself is on the record',
    (await contentAt(router.machineId, RULES_V4_PATH)) === beforeSilence &&
      (await contentAt(router.machineId, SNMPD_LOG_PATH)).includes(
        `Authentication failure (incorrect community name) from UDP: [${ATTACKER_IP}]`,
      ),
    `rules.v4 ${(await contentAt(router.machineId, RULES_V4_PATH)) === beforeSilence ? 'unchanged' : 'CHANGED'}`,
  );

  // ─── the other file, through the same door ───
  await plant(switchDevice.machineId, RW_STATE_PATH, `rwcommunity ${md5(RW_COMMUNITY)}\n`);

  const shut = await set(switchHost.ip, 'aclPort.22=deny');
  check(
    'a switch takes a deny into its own acl.conf, never the router NAT file',
    shut.status === 200 &&
      stringField(shut.body, 'oid') === 'ACL-MIB::aclPort.22' &&
      (await contentAt(switchDevice.machineId, ACL_CONF_PATH)).includes('deny 22') &&
      (await rowAt(switchDevice.machineId, RULES_V4_PATH)) === null,
    `status ${shut.status} ${JSON.stringify(shut.body)}`,
  );

  await set(switchHost.ip, 'aclPort.8080=permit');
  const switchWalk = await walk(switchHost.ip);
  check(
    'and re-opening the seeded deny leaves the walk showing only what is still shut',
    portTableIn(switchWalk.body) === JSON.stringify({ kind: 'acl', denies: [22] }),
    `table ${portTableIn(switchWalk.body)}`,
  );

  check(
    'and none of it minted a session, at the tier that rewrites a port table',
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
