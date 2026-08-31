// Wire-payload smoke for the SNMP READ door — `snmpWalk` against a generated device.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `snmpWalk` is DISPATCHED at all, and answers out of the device's GENERATED tree.
//     Nothing here seeds `/etc/snmp/snmpd.conf` — the file the boot generator plants is
//     what accepts `public`, so a generator that stopped planting it turns the accepted
//     walk into a refusal and this script goes red.
//   - The gateway's SECOND address is a `network_public_ips` ROW READ, not a generated
//     value. Every unit test hands `findPublicIpByEssid` a fake, so the live wiring —
//     right table, right column, right key — is proven only here. Checked in BOTH
//     directions: with the row seeded, and again once it is gone.
//   - The two lines land at the TARGET's own `/var/log/snmpd.log`, as ONE row,
//     root-owned, with NOTHING in auth.log. `patches` is keyed on
//     `(machine_id, path, writer_key)`, so a trace filed under the wrong daemon, the
//     wrong box or the wrong key passes every unit test in the suite.
//   - A REFUSED community is identical to an address nothing occupies — status AND body,
//     off the wire, rather than two `HandlerResponse` objects compared in memory.
//   - A walk mints NO row in `sessions`. There is no account at this door, and a row
//     minted here would hand `listPatches` and `upsertPatch` to anyone who reaches 161.
//   - The READ-WRITE tier answers off two files the unit tests only ever hand a fake:
//     the root-only `/var/lib/snmp/snmpd.conf` the community is compared against, and
//     the `rules.v4` the port table is rendered from. Both arrive here through the real
//     patch replay, so a walk that read the wrong path, or replayed a row it should not
//     have, is only visible on a live stack.
//   - The tier is STATED in the body. Checked in both directions — a read-only walk
//     carries no port table, and a read-write walk carries one even when it is empty —
//     because a dropped field would downgrade the tier silently and tell a player their
//     cracked community bought nothing.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpWalk.ts
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
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { SNMPD_LOG_OWNER, SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog';
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

// Its own ESSID, shared with no other check. Machines are ESSID-seeded, so two scripts
// on one ESSID read each other's rows as their own.
const ESSID = 'SNMP-WALK-WIFI';
const PUBLIC_IP = '198.51.100.77';
const ATTACKER_IP = '192.168.1.50';
const NOWHERE_IP = '10.255.255.254';
/** The community this run plants, in the clear. The generated one is drawn from a pool
 *  and is not guaranteed to be recoverable, and this script is proving the DOOR rather
 *  than the seeding — `routerFs.test.ts` owns that. */
const RW_COMMUNITY = 'corpnet';
const RW_STATE_PATH = '/var/lib/snmp/snmpd.conf';
const RULES_V4_PATH = '/etc/iptables/rules.v4';
const FORWARDED_PORT = 2222;
const FORWARD_TARGET = '192.168.147.10:22';

const attacker = generateIdentity();

// The access point's own `.1`, pinned to run an agent on every ESSID and the one device
// that also FRONTS a public address — so it exercises the second interface that only a
// table read can produce.
const gateway = generateHomeLan(ESSID).hosts.find((host) => host.ip.endsWith('.1'));
if (gateway === undefined) {
  console.error(`ESSID ${ESSID} generated no .1 gateway — pick another ESSID.`);
  process.exit(2);
}

const { machineId: targetMachine, baseFs } = resolveLanHostIdentity(gateway, ESSID);

if (!readOpenPorts(baseFs).some(({ service }) => service === SERVICE_CATALOG.snmp.service)) {
  console.error(
    `${gateway.hostname} (${gateway.ip}) runs no SNMP agent — a walk against it proves ` +
      `nothing about this door. Pick another ESSID.`,
  );
  process.exit(2);
}

type LogRow = {
  readonly content: string;
  readonly owner: string;
  readonly writerKey: string;
  readonly rows: number;
};

const stringAt = (row: object, key: string): string =>
  String(Object.getOwnPropertyDescriptor(row, key)?.value ?? '');

const logAt = async (machineId: string, path: string): Promise<LogRow | null> => {
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
  (await logAt(machineId, path))?.content ?? '';

const linesOf = (content: string): readonly string[] => content.split('\n').filter(Boolean);

/** The identity as a CLIENT has to read it — off an untyped body, by the keys present. */
const identityIn = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null) return {};
  const identity = Object.getOwnPropertyDescriptor(body, 'identity')?.value;
  return typeof identity === 'object' && identity !== null
    ? (identity as Record<string, unknown>)
    : {};
};

const addressesIn = (body: unknown): readonly string[] => {
  const addresses = identityIn(body)['addresses'];
  return Array.isArray(addresses) ? addresses.map(String) : [];
};

const sessionRowsForCaller = async (): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', attacker.publicKeyHex);
  return count ?? 0;
};

const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

/** Plant a file on the target the way its owner's own edit arrives — one patch row,
 *  replayed over the generated tree by the same path the door reads through. */
const plant = async (path: string, content: string): Promise<void> => {
  const { error } = await sr.from('patches').insert([
    {
      writer_key: attacker.publicKeyHex,
      machine_id: targetMachine,
      path,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    },
  ]);
  // Loud rather than swallowed: a fixture that cannot be built must stop the run, never
  // soften into a check that passes against an unmodified world.
  if (error !== null) {
    console.error(`could not plant ${path}: ${JSON.stringify(error)}`);
    process.exit(2);
  }
};

const stringField = (body: unknown, key: string): string => {
  if (typeof body !== 'object' || body === null) return '';
  return String(Object.getOwnPropertyDescriptor(body, key)?.value ?? '');
};

const hasField = (body: unknown, key: string): boolean =>
  typeof body === 'object' &&
  body !== null &&
  Object.getOwnPropertyDescriptor(body, key) !== undefined;

/** The port table as a CLIENT has to read it — off an untyped body, by the keys
 *  present. A device renders one table per question it can be asked, so naming the kind
 *  is what keeps an assertion about forwards from silently reading whichever table
 *  happens to come first. */
const portTableIn = (body: unknown, kind: string): string => {
  if (typeof body !== 'object' || body === null) return '';
  const tables = Object.getOwnPropertyDescriptor(body, 'portTables')?.value;
  if (!Array.isArray(tables)) return JSON.stringify(null);
  const table = tables.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      Object.getOwnPropertyDescriptor(candidate, 'kind')?.value === kind,
  );
  return JSON.stringify(table ?? null);
};

const walk = (targetIp: string, community: string) =>
  post(
    signRequest(attacker, 'snmpWalk', {
      essid: ESSID,
      target_ip: targetIp,
      community,
      source_ip: ATTACKER_IP,
    }),
  );

// Delete at SETUP, not only at teardown: the gateway's machine_id is ESSID-seeded and
// therefore identical across runs, so a crashed run leaves lines the next one would read
// as its own.
const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', targetMachine);
};

const main = async (): Promise<void> => {
  console.log(
    `target ${gateway.hostname} ${gateway.ip} on ${ESSID} (machine ${targetMachine})\n` +
      `walking as ${attacker.publicKeyHex.slice(0, 8)}... from ${ATTACKER_IP}\n`,
  );

  await clear();
  await seedPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);

  // ─── the walk that is answered ───
  const answered = await walk(gateway.ip, 'public');
  check(
    'snmpWalk is dispatched at all',
    answered.status === 200,
    `status ${answered.status} ${JSON.stringify(answered.body)}`,
  );

  const identity = identityIn(answered.body);
  check(
    'and names the device off its generated tree, conf and all',
    identity['hostname'] === gateway.hostname &&
      identity['kind'] === 'router' &&
      identity['sysContact'] === 'netops@corp.local',
    JSON.stringify(identity),
  );
  check(
    'the second address is the network_public_ips row, read live',
    JSON.stringify(addressesIn(answered.body)) === JSON.stringify([gateway.ip, PUBLIC_IP]),
    `addresses ${JSON.stringify(addressesIn(answered.body))}`,
  );

  // ─── what the device kept ───
  const trace = await logAt(targetMachine, SNMPD_LOG_PATH);
  const accepted = linesOf(trace?.content ?? '');
  check(
    'the walk lands on the target own snmpd.log, as one row',
    trace !== null && trace.rows === 1,
    `${SNMPD_LOG_PATH}: ${trace === null ? 'no row' : `${trace.rows} row(s)`}`,
  );
  check(
    'two lines, arrival then verdict, both naming the caller address',
    accepted.length === 2 &&
      accepted[0]?.includes(`${gateway.hostname} snmpd[`) === true &&
      accepted[0]?.includes(`Connection from UDP: [${ATTACKER_IP}]`) === true &&
      accepted[1]?.includes(`Authentication succeeded from UDP: [${ATTACKER_IP}]`) === true,
    JSON.stringify(accepted),
  );
  check(
    'root-owned, and filed under the caller key an unowned box leaves it under',
    trace?.owner === SNMPD_LOG_OWNER && trace?.writerKey === attacker.publicKeyHex,
    `owner ${trace?.owner ?? 'none'}, writer ${(trace?.writerKey ?? 'none').slice(0, 8)}...`,
  );
  check(
    'and NOTHING went to auth.log',
    (await logAt(targetMachine, AUTH_LOG_PATH)) === null,
    `${AUTH_LOG_PATH}: ${(await logAt(targetMachine, AUTH_LOG_PATH)) === null ? 'no row' : 'a row exists'}`,
  );

  // ─── the walk that is refused ───
  const before = await contentAt(targetMachine, SNMPD_LOG_PATH);
  const refused = await walk(gateway.ip, 'private');
  const absent = await walk(NOWHERE_IP, 'public');
  check(
    'a refused community is word-for-word an address nothing occupies',
    refused.status === absent.status &&
      JSON.stringify(refused.body) === JSON.stringify(absent.body) &&
      refused.status === 404,
    `refused ${refused.status} ${JSON.stringify(refused.body)} / absent ${absent.status} ${JSON.stringify(absent.body)}`,
  );

  // On the DELTA, never on the whole file: an assertion over everything the box holds is
  // satisfied by the accepted walk above whether or not the refusal wrote a word.
  const added = linesOf((await contentAt(targetMachine, SNMPD_LOG_PATH)).slice(before.length));
  check(
    'and the guess is recorded anyway, the only tell the owner of a device gets',
    added.length === 2 &&
      added[0]?.includes(`Connection from UDP: [${ATTACKER_IP}]`) === true &&
      added[1]?.includes(
        `Authentication failure (incorrect community name) from UDP: [${ATTACKER_IP}]`,
      ) === true,
    JSON.stringify(added),
  );

  // ─── the address that is not in the table ───
  await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
  const unregistered = await walk(gateway.ip, 'public');
  check(
    'with no row for the ESSID the gateway shows the one address it really holds',
    JSON.stringify(addressesIn(unregistered.body)) === JSON.stringify([gateway.ip]),
    `addresses ${JSON.stringify(addressesIn(unregistered.body))}`,
  );

  check(
    'and none of it minted a session, because this door has no account to session',
    (await sessionRowsForCaller()) === 0,
    `${await sessionRowsForCaller()} session row(s) for the caller`,
  );

  // ─── the tier a cracked community buys ───
  // Both files land BEFORE the walk, and the door reads each through the same replay a
  // player's own `nano` edit would arrive by. Every unit test at this door hands that a
  // fake, so which path is read, and whether the row replays at all, is proven only
  // here.
  await clear();
  await seedPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
  await plant(RW_STATE_PATH, `rwcommunity ${md5(RW_COMMUNITY)}\n`);

  const readOnly = await walk(gateway.ip, 'public');
  check(
    'the free community still names the tier it answered at, and carries no table',
    stringField(readOnly.body, 'tier') === 'read-only' && !hasField(readOnly.body, 'portTables'),
    `tier ${stringField(readOnly.body, 'tier')}, portTables ${portTableIn(readOnly.body, 'nat')}`,
  );

  const bare = await walk(gateway.ip, RW_COMMUNITY);
  check(
    'the cracked community answers read-write on a device that forwards nothing',
    bare.status === 200 &&
      stringField(bare.body, 'tier') === 'read-write' &&
      portTableIn(bare.body, 'nat') === JSON.stringify({ kind: 'nat', forwards: [] }),
    `status ${bare.status}, tier ${stringField(bare.body, 'tier')}, table ${portTableIn(bare.body, 'nat')}`,
  );

  await plant(RULES_V4_PATH, `forward ${FORWARDED_PORT} to ${FORWARD_TARGET}\n`);
  const withTable = await walk(gateway.ip, RW_COMMUNITY);
  check(
    'and renders the forward off the very rules.v4 the box routes by',
    portTableIn(withTable.body, 'nat') ===
      JSON.stringify({
        kind: 'nat',
        forwards: [{ publicPort: FORWARDED_PORT, internalIp: '192.168.147.10', internalPort: 22 }],
      }),
    `table ${portTableIn(withTable.body, 'nat')}`,
  );

  check(
    'and STILL minted no session at the tier that can rewrite the table',
    (await sessionRowsForCaller()) === 0,
    `${await sessionRowsForCaller()} session row(s) for the caller`,
  );

  await clear();
  await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
