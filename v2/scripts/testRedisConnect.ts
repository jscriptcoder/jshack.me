// Wire-payload smoke for the KEY-VALUE STORE door — `redisConnect` + `redisStatement`.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Both new actions are DISPATCHED at all. A new action on an existing endpoint is
//     the one thing no unit test can see: the handler is called directly there, so a
//     route that never routes to it stays green all the way to production.
//   - A store with no secret opens for a caller who sent NO credential, and answers
//     `KEYS *` with what the box actually holds. This door has no login, so "it opened"
//     and "it answered" are two separate claims and both have to cross the wire.
//   - A store WITH a secret opens the same way and then discloses nothing: the body
//     carries the NOAUTH refusal and not one key, over the wire and not merely in a
//     return value a test read directly.
//   - The arrival line lands at the TARGET's `/var/log/redis.log`, root-owned and
//     world-readable. Unit tests inject a fake `upsertPatch`, so which machine_id and
//     path a row lands at, and whether the table accepts its owner and permissions, is
//     asserted against a spy rather than against the table.
//   - EXACTLY ONE row is written per connection, and a session of reads adds none.
//     That is the rule the write verbs will be measured against, and a spy cannot prove
//     an absence in a table it never sees.
//   - NO row appears in `sessions`. This door mints none at any tier — there is no
//     credential to have validated, so a row would authorize everything on the strength
//     of nothing.
//   - A store edited THROUGH `patches` is the store that answers. Live, the journal has
//     to really be found and replayed; the unit test hands it over.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRedisConnect.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { storeIn, DATADIR_PATH } from '../src/core/redis/datadir';
import { redisStoreSchema } from '../src/core/redis/types';
import { DATADIR_FILE } from '../src/core/generation/baseFs';
import { REDIS_LOG_OWNER, REDIS_LOG_PATH } from '../src/core/logging/redisLog';

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

// Chosen for a LAN carrying BOTH shapes of store — one open, one locked. The contrast
// is the point: "the locked one disclosed nothing" proves little unless the open one on
// the same LAN, through the same endpoint, disclosed everything.
const ESSID = 'REDIS-LAB-4';
const CLIENT_IP = '192.168.1.50';
const PORT = SERVICE_CATALOG.redis.defaultPort;

const client = generateIdentity();

const storeHosts = generateHomeLan(ESSID).hosts.filter(
  (host: LanHost) =>
    host.kind === 'machine' &&
    hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.redis),
);

const storeOf = (host: LanHost) => storeIn(resolveLanHostIdentity(host, ESSID).baseFs);

const openHost = storeHosts.find((host) => storeOf(host)?.requirepassHash === null);
const lockedHost = storeHosts.find((host) => {
  const store = storeOf(host);
  return store !== null && store.requirepassHash !== null;
});

if (openHost === undefined || lockedHost === undefined) {
  console.error(`ESSID ${ESSID} needs one OPEN and one LOCKED store — pick another ESSID.`);
  process.exit(2);
}

const openStore = storeOf(openHost);
const lockedStore = storeOf(lockedHost);
if (openStore === null || lockedStore === null) {
  console.error('a chosen host holds no readable store');
  process.exit(2);
}

const machineOf = (host: LanHost) => resolveLanHostIdentity(host, ESSID).machineId;
const openMachine = machineOf(openHost);
const lockedMachine = machineOf(lockedHost);

type PatchRowRead = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string | null;
  readonly permissions: unknown;
};

const rowsOn = async (machineId: string): Promise<readonly PatchRowRead[]> => {
  const { data } = await sr
    .from('patches')
    .select('path, content, owner, permissions')
    .eq('machine_id', machineId);
  return Array.isArray(data) ? (data as PatchRowRead[]) : [];
};

const readersOf = (permissions: unknown): readonly string[] => {
  if (typeof permissions !== 'object' || permissions === null) return [];
  const read = Object.getOwnPropertyDescriptor(permissions, 'read')?.value;
  return Array.isArray(read) ? read.map(String) : [];
};

const sessionRowCount = async (): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', client.publicKeyHex);
  return count ?? 0;
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', openMachine);
  await sr.from('patches').delete().eq('machine_id', lockedMachine);
  await sr.from('sessions').delete().eq('player_key', client.publicKeyHex);
};

const connect = (host: LanHost) =>
  post(
    signRequest(client, 'redisConnect', {
      essid: ESSID,
      target_ip: host.ip,
      port: PORT,
      source_ip: CLIENT_IP,
    }),
  );

const ask = (host: LanHost, statement: string) =>
  post(
    signRequest(client, 'redisStatement', {
      essid: ESSID,
      target_ip: host.ip,
      port: PORT,
      statement,
      source_ip: CLIENT_IP,
    }),
  );

/** Plant an edited store the way a rooted player would: one row at the datadir path on
 *  the target's machine, which is what the journal replay has to pick up. */
const plantStore = async (machineId: string, content: string) => {
  await sr.from('patches').upsert(
    {
      writer_key: client.publicKeyHex,
      machine_id: machineId,
      path: DATADIR_PATH,
      content,
      owner: 'root',
      permissions: DATADIR_FILE,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const main = async (): Promise<void> => {
  console.log(
    `open   ${openHost.hostname} ${openHost.ip} — ${Object.keys(openStore.keys).length} keys\n` +
      `locked ${lockedHost.hostname} ${lockedHost.ip} — ` +
      `${Object.keys(lockedStore.keys).length} keys behind a secret\n`,
  );

  await clear();

  // ─── the open store: no credential in, everything out ───
  const opened = await connect(openHost);
  check(
    'an open store opens for a caller who sent no credential',
    opened.status === 200,
    `status ${opened.status} ${JSON.stringify(opened.body)}`,
  );
  check(
    'and the answer carries nothing but that it opened and which box answered',
    JSON.stringify(opened.body) === JSON.stringify({ ok: true, hostname: openHost.hostname }),
    `body ${JSON.stringify(opened.body)}`,
  );

  const listed = await ask(openHost, 'KEYS *');
  const expectedKeys = Object.keys(openStore.keys).map((key, index) => `${index + 1}) "${key}"`);
  check(
    'and it answers KEYS * with what the box actually holds',
    JSON.stringify(listed.body) === JSON.stringify({ output: expectedKeys, failed: false }),
    `status ${listed.status} ${JSON.stringify(listed.body).slice(0, 160)}`,
  );

  const firstKey = Object.keys(openStore.keys)[0] ?? '';
  const got = await ask(openHost, `GET ${firstKey}`);
  check(
    'and GET gives the value back through the endpoint',
    JSON.stringify(got.body) === JSON.stringify({ output: [`"${openStore.keys[firstKey]}"`], failed: false }),
    `${firstKey} -> ${JSON.stringify(got.body).slice(0, 120)}`,
  );

  // ─── the trace, in the real table ───
  const afterReads = await rowsOn(openMachine);
  const logRows = afterReads.filter((row) => row.path === REDIS_LOG_PATH);
  const logRow = logRows[0];
  check(
    'the arrival line landed on the TARGET at /var/log/redis.log',
    logRow !== undefined && (logRow.content ?? '').includes(`Client connected from ${CLIENT_IP}`),
    `${logRows.length} row(s), content ${JSON.stringify(logRow?.content ?? null)}`,
  );
  check(
    'root-owned and readable by everyone on the box, as the table stored it',
    logRow?.owner === REDIS_LOG_OWNER && readersOf(logRow?.permissions).includes('guest'),
    `owner ${logRow?.owner ?? 'none'}, readers ${JSON.stringify(readersOf(logRow?.permissions))}`,
  );
  check(
    'ONE line for the connection, and NOT ONE for the three reads behind it',
    afterReads.length === 1 && (logRow?.content ?? '').trim().split('\n').length === 1,
    `${afterReads.length} row(s) on the box: ${JSON.stringify(afterReads.map((row) => row.path))}`,
  );

  check(
    'and no session row exists, at any tier',
    (await sessionRowCount()) === 0,
    `${await sessionRowCount()} row(s) for this key`,
  );

  // ─── the locked store: opens, and then says nothing ───
  const lockedOpen = await connect(lockedHost);
  check(
    'a LOCKED store opens too — the lock is on the questions, not the door',
    lockedOpen.status === 200,
    `status ${lockedOpen.status} ${JSON.stringify(lockedOpen.body)}`,
  );

  const refused = await ask(lockedHost, 'KEYS *');
  const refusedBody = JSON.stringify(refused.body);
  const heldKeys = Object.keys(lockedStore.keys);
  check(
    'and discloses nothing: the refusal crosses the wire, not the keys',
    refusedBody === JSON.stringify({ output: ['(error) NOAUTH Authentication required.'], failed: true }),
    `body ${refusedBody.slice(0, 160)}`,
  );
  check(
    'not one of its keys appears anywhere in the response body',
    heldKeys.length > 0 && heldKeys.every((key) => !refusedBody.includes(key)),
    `${heldKeys.length} keys held, none leaked`,
  );

  // ─── the journal is really replayed ───
  const planted = redisStoreSchema.parse({
    keys: { 'sess:planted-by-hand': 'somebody edited this file as root' },
    requirepassHash: null,
  });
  await plantStore(openMachine, JSON.stringify(planted));

  const afterEdit = await ask(openHost, 'KEYS *');
  check(
    'a store edited THROUGH patches is the store that answers',
    JSON.stringify(afterEdit.body) ===
      JSON.stringify({ output: ['1) "sess:planted-by-hand"'], failed: false }),
    `body ${JSON.stringify(afterEdit.body).slice(0, 160)}`,
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
