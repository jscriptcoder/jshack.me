// Wire-payload smoke for the KEY-VALUE DOOR ON A DEEP LAYER — `redisConnect` and
// `redisStatement` reached through a NAT forward on the player's own inner gateway,
// and `hydraCrackInnerGateway` pointed down the same one. Drives the REAL
// /api/sessions + /api/patches endpoints against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The redis actions ROUTE THROUGH A FORWARD at all. Unit tests call the handlers
//     directly, so a chain resolver wired only into ssh stays green there.
//   - The terminal box's JOURNAL is replayed. The chain resolver hands back its SEEDED
//     tree, so a store written down here would persist and never be read back. A second
//     round-trip reading what the first one wrote is the only proof of that a live run
//     can give — nothing is held between the two, so an echoed client copy cannot fake
//     it.
//   - The address is the ROUTE's. Behind NAT the deep box has only ever seen the
//     fronting gateway's `.1`, so the line a defender finds must carry that one string,
//     asserted against the row the table really holds.
//   - Every write lands on the DEEP box's machine id. The gateway carried the packet
//     and ran nothing; a row filed against it is a change no store is read from.
//   - The GATEWAY records NOTHING. NAT does not log, and an absence is a thing no
//     injected `upsertPatch` can prove.
//   - The datadir the door writes is accepted by the real `patches` table root-owned
//     and root-only-readable — a column-level claim `tsc` cannot see.
//   - A store's password recovered by hydra down the forward is the one `AUTH` then
//     accepts through the SAME forward.
//   - NO row appears in `sessions` — this door holds no session at any depth.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRedisDeep.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable network.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer';
import { buildDeepHostFs } from '../src/core/generation/deepHostFs';
import { computeInnerGatewayId } from '../src/core/identity/router';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import { storeIn, DATADIR_PATH } from '../src/core/redis/datadir';
import { readOpenPorts } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { md5 } from '../src/core/generation/md5';
import { DATADIR_FILE } from '../src/core/generation/baseFs';
import { REDIS_LOG_OWNER, REDIS_LOG_PATH } from '../src/core/logging/redisLog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import type { RedisStore } from '../src/core/redis/types';

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

const errorOf = (body: unknown): string | undefined => (body as { error?: string } | null)?.error;
const outputOf = (body: unknown): readonly string[] =>
  (body as { output?: readonly string[] } | null)?.output ?? [];

// --- The network. Which layers run a store, and whether its password came from a pool
//     anything outside the game can recover, are both per-network rolls — so the ESSID
//     is SEARCHED for. Naming one would leave this passing on a fixture and failing the
//     day the world re-rolls. ---
const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

type DeepTarget = {
  readonly essid: string;
  readonly gateway: LanHost;
  readonly gatewayId: string;
  readonly deepIp: string;
  readonly deepId: string;
  readonly hostname: string;
  readonly storePort: number;
  readonly natIp: string;
  readonly store: RedisStore;
  readonly password: string | null;
};

const deepStoreAt = (essid: string, gateway: LanHost): DeepTarget | null => {
  if (gateway.kind !== 'router' || octetOf(gateway) === 1) return null;
  const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
  const layer = generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' });
  const fs = buildDeepHostFs(essid, layer.host);
  const open = readOpenPorts(fs).find(
    (candidate) => candidate.service === SERVICE_CATALOG.redis.service,
  );
  const store = storeIn(fs);
  if (open === undefined || store === null) return null;
  const hash = store.requirepassHash;
  const password = hash === null ? null : (ALL_GENERATED_PASSWORDS.find((word) => md5(word) === hash) ?? null);
  if (hash !== null && password === null) return null;
  return {
    essid,
    gateway,
    gatewayId,
    deepIp: layer.host.ip,
    deepId: hostMachineId(layer.host, essid),
    hostname: layer.host.hostname,
    storePort: open.port,
    natIp: `${layer.subnet}.1`,
    store,
    password,
  };
};

const findDeepStore = (locked: boolean): DeepTarget | null => {
  for (const essid of crackableEssidPool) {
    for (const gateway of generateHomeLan(essid).hosts) {
      const found = deepStoreAt(essid, gateway);
      if (found !== null && (found.password !== null) === locked) return found;
    }
  }
  return null;
};

const OPEN = findDeepStore(false);
const LOCKED = findDeepStore(true);

if (OPEN === null || LOCKED === null) {
  console.error('the crackable pool fronts no deep store of both shapes');
  process.exit(2);
}

const alice = generateIdentity();
const CLIENT_IP = '192.168.1.50';
const FORWARD_PORT = 36379;
const RULES = '/etc/iptables/rules.v4';
const PIDFILE = `/var/run/${SERVICE_CATALOG.redis.pidfile}`;
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

const connect = (target: DeepTarget, port = FORWARD_PORT) =>
  post(
    SESSIONS,
    signRequest(alice, 'redisConnect', {
      essid: target.essid,
      target_ip: target.gateway.ip,
      port,
      source_ip: CLIENT_IP,
    }),
  );

const statement = (
  target: DeepTarget,
  line: string,
  options: { readonly password?: string; readonly port?: number } = {},
) =>
  post(
    SESSIONS,
    signRequest(alice, 'redisStatement', {
      essid: target.essid,
      target_ip: target.gateway.ip,
      port: options.port ?? FORWARD_PORT,
      statement: line,
      ...(options.password === undefined ? {} : { password: options.password }),
      source_ip: CLIENT_IP,
    }),
  );

const rowAt = async (machineId: string, path: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, owner, permissions')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  if (typeof data !== 'object' || data === null) return null;
  const at = (field: string): unknown => Object.getOwnPropertyDescriptor(data, field)?.value;
  return {
    content: typeof at('content') === 'string' ? String(at('content')) : null,
    owner: typeof at('owner') === 'string' ? String(at('owner')) : null,
    permissions: at('permissions'),
  };
};

/** Plant a row as service_role — the deep box's own state, which no player-signed write
 *  could reach without first rooting the box down there. */
const plant = async (machineId: string, path: string, content: string | null) => {
  await sr.from('patches').upsert(
    {
      writer_key: alice.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: DATADIR_FILE,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

/** The one thing a player has to do by hand: root the gateway and write the forward.
 *  Done through the REAL endpoint rather than planted, because a forward the player
 *  could not have opened is a layer nobody can reach. */
const openForward = async (target: DeepTarget, label: string) => {
  const sessionId = `ssh-alice-gw-${target.gatewayId}`;
  // By session_id as well as player_key: the id is derived from the gateway and is the
  // SAME every run, while alice is fresh each time. Deleting only her rows would leave
  // the previous run's row holding the id, and the insert below fails on it — which
  // reads here as "the door refused her" rather than as a dirty table.
  await sr.from('sessions').delete().eq('session_id', sessionId);
  const seeded = await sr.from('sessions').insert({
    session_id: sessionId,
    player_key: alice.publicKeyHex,
    machine_id: target.gatewayId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: target.essid,
  });
  if (seeded.error !== null) {
    console.error(`could not seed alice's root session on the ${label} gateway`);
    process.exit(2);
  }
  const opened = await post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: target.gatewayId,
      path: RULES,
      content: `# NAT port-forward table\nforward ${FORWARD_PORT} to ${target.deepIp}:${target.storePort}\n`,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    }),
  );
  check(
    `alice opens the forward onto the ${label} layer, on her own gateway rules.v4`,
    opened.status === 200,
    `status=${opened.status} error=${errorOf(opened.body) ?? '-'}`,
  );
};

const main = async (): Promise<void> => {
  console.log(
    `open store:   ${OPEN.essid} — gateway ${OPEN.gateway.ip}, ${OPEN.hostname} ` +
      `${OPEN.deepIp} behind NAT at ${OPEN.natIp}, ${Object.keys(OPEN.store.keys).length} keys\n` +
      `locked store: ${LOCKED.essid} — gateway ${LOCKED.gateway.ip}, ${LOCKED.hostname} ` +
      `${LOCKED.deepIp} behind NAT at ${LOCKED.natIp}\n`,
  );

  for (const target of [OPEN, LOCKED]) {
    await sr.from('patches').delete().eq('machine_id', target.gatewayId);
    await sr.from('patches').delete().eq('machine_id', target.deepId);
  }
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

  await openForward(OPEN, 'open');
  await openForward(LOCKED, 'locked');

  // 1. The door opens the box BEHIND the forward, and names it. That name is absent
  //    from the generated LAN, so no client could have looked it up.
  const opened = await connect(OPEN);
  check(
    'the store behind the forward opens, and the answer names the deep box',
    opened.status === 200 &&
      JSON.stringify(opened.body) === JSON.stringify({ ok: true, hostname: OPEN.hostname }),
    `status=${opened.status} body=${JSON.stringify(opened.body)}`,
  );

  // 2. The arrival lands on the DEEP box, at the address NAT showed it.
  const arrival = await rowAt(OPEN.deepId, REDIS_LOG_PATH);
  check(
    'the arrival is recorded on the DEEP box, naming the fronting gateway .1',
    (arrival?.content ?? '').includes(`Client connected from ${OPEN.natIp}`) &&
      !(arrival?.content ?? '').includes(CLIENT_IP),
    `${OPEN.deepId}${REDIS_LOG_PATH}: ${(arrival?.content ?? 'no row').trim()}`,
  );
  check(
    'and the log is root-owned, so a visitor cannot edit the record of their visit',
    arrival?.owner === REDIS_LOG_OWNER,
    `owner=${arrival?.owner}`,
  );

  // 3. The gateway records NOTHING. NAT carried the packet and ran no daemon.
  const gatewayLog = await rowAt(OPEN.gatewayId, REDIS_LOG_PATH);
  check(
    'the GATEWAY records nothing — NAT does not log',
    gatewayLog === null,
    gatewayLog === null ? 'no redis.log row on the gateway' : `unexpected row: ${gatewayLog.content}`,
  );

  // 4. A read through the forward answers off the deep box's own store.
  const seededKey = Object.keys(OPEN.store.keys)[0];
  if (seededKey === undefined) throw new Error('the deep store the world generated is empty');
  const read = await statement(OPEN, `GET ${seededKey}`);
  check(
    'a read through the forward answers from the deep box own store',
    read.status === 200 && outputOf(read.body).join('').length > 0,
    `status=${read.status} GET ${seededKey} -> ${outputOf(read.body).join(' | ')}`,
  );

  // 5. A write lands on the DEEP box's datadir, root-owned and root-only-readable.
  const written = await statement(OPEN, 'SET sess:wirecheck deep-and-live');
  const datadir = await rowAt(OPEN.deepId, DATADIR_PATH);
  const gatewayDatadir = await rowAt(OPEN.gatewayId, DATADIR_PATH);
  check(
    'a SET through the forward answers OK and lands on the DEEP box datadir',
    written.status === 200 &&
      outputOf(written.body).join('') === 'OK' &&
      (datadir?.content ?? '').includes('deep-and-live') &&
      gatewayDatadir === null,
    `status=${written.status} deep row ${datadir === null ? 'MISSING' : 'present'}, ` +
      `gateway row ${gatewayDatadir === null ? 'absent' : 'PRESENT'}`,
  );
  check(
    'and the real patches table accepts it root-owned and root-only-readable',
    datadir?.owner === 'root' &&
      JSON.stringify(datadir?.permissions) === JSON.stringify(DATADIR_FILE),
    `owner=${datadir?.owner} permissions=${JSON.stringify(datadir?.permissions)}`,
  );

  // 6. THE criterion the seeded tree would fail: a SECOND round-trip reads it back.
  //    Nothing is held between the two, so this is the journal really being replayed
  //    over the box the resolver handed back unmaterialized.
  const readBack = await statement(OPEN, 'GET sess:wirecheck');
  check(
    'a LATER request reads back what the first one wrote — the deep journal is replayed',
    readBack.status === 200 && outputOf(readBack.body).join('') === '"deep-and-live"',
    `status=${readBack.status} output=${outputOf(readBack.body).join(' | ')}`,
  );

  // 7. The change is recorded on the deep box, at the route's address.
  const afterWrite = await rowAt(OPEN.deepId, REDIS_LOG_PATH);
  check(
    'the change is recorded on the deep box, naming the address NAT showed it',
    (afterWrite?.content ?? '').includes(
      `Client ${OPEN.natIp} SET sess:wirecheck "deep-and-live"`,
    ) && !(afterWrite?.content ?? '').includes(CLIENT_IP),
    `${(afterWrite?.content ?? 'no row').trim().split('\n').slice(-1)[0]}`,
  );

  // 8. A DEL that removed something files a line; reads file nothing.
  const removed = await statement(OPEN, 'DEL sess:wirecheck');
  const linesBeforeReads = ((await rowAt(OPEN.deepId, REDIS_LOG_PATH))?.content ?? '').trim();
  await statement(OPEN, 'KEYS *');
  await statement(OPEN, 'DBSIZE');
  await statement(OPEN, 'DEL sess:never-there');
  const linesAfterReads = ((await rowAt(OPEN.deepId, REDIS_LOG_PATH))?.content ?? '').trim();
  check(
    'a DEL that removed a key files its own line at depth',
    outputOf(removed.body).join('') === '(integer) 1' && linesBeforeReads.includes('DEL sess:wirecheck'),
    `output=${outputOf(removed.body).join(' | ')}`,
  );
  check(
    'and reads, plus a DEL that matched nothing, add not one line to the deep log',
    linesAfterReads === linesBeforeReads,
    `${linesBeforeReads.split('\n').length} lines before, ${linesAfterReads.split('\n').length} after`,
  );

  // 9. A locked store refuses at depth exactly as it does on the LAN.
  const password = LOCKED.password;
  if (password === null) throw new Error('the locked target is not locked');
  const refused = await statement(LOCKED, 'DBSIZE');
  check(
    'a locked deep store refuses a statement sent without its password',
    refused.status === 200 &&
      outputOf(refused.body).join('') === '(error) NOAUTH Authentication required.',
    `status=${refused.status} output=${outputOf(refused.body).join(' | ')}`,
  );

  // 10. hydra down the SAME forward recovers the password the door then accepts.
  await sr.from('patches').upsert(
    {
      machine_id: LOCKED.gatewayId,
      path: WORDLIST_PATH,
      writer_key: alice.publicKeyHex,
      content: formatWordlist([password, 'not-a-password']),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  const swept = await post(
    SESSIONS,
    signRequest(alice, 'hydraCrackInnerGateway', {
      essid: LOCKED.essid,
      target: LOCKED.gateway.ip,
      service: 'redis',
      port: FORWARD_PORT,
      caller_machine_id: LOCKED.gatewayId,
    }),
  );
  const cracked =
    (swept.body as { cracked?: { username?: string; password: string }[] } | null)?.cracked ?? [];
  check(
    'hydra down the same forward hands back the store password, with no login field',
    swept.status === 200 &&
      cracked.length === 1 &&
      cracked[0]?.password === password &&
      cracked[0]?.username === undefined,
    `status=${swept.status} cracked=${JSON.stringify(cracked)}`,
  );
  const accepted = await statement(LOCKED, 'DBSIZE', { password });
  check(
    'and the store accepts that same password through the same forward',
    accepted.status === 200 && outputOf(accepted.body).join('').startsWith('(integer)'),
    `status=${accepted.status} output=${outputOf(accepted.body).join(' | ')}`,
  );

  // 11. An OPEN store is open access rather than an empty sweep.
  await sr.from('patches').upsert(
    {
      machine_id: OPEN.gatewayId,
      path: WORDLIST_PATH,
      writer_key: alice.publicKeyHex,
      content: formatWordlist(['not-a-password']),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  const sweptOpen = await post(
    SESSIONS,
    signRequest(alice, 'hydraCrackInnerGateway', {
      essid: OPEN.essid,
      target: OPEN.gateway.ip,
      service: 'redis',
      port: FORWARD_PORT,
      caller_machine_id: OPEN.gatewayId,
    }),
  );
  check(
    'an OPEN deep store answers open access rather than a sweep that found nothing',
    sweptOpen.status === 404 && errorOf(sweptOpen.body) === 'no_password_set',
    `status=${sweptOpen.status} error=${errorOf(sweptOpen.body) ?? '-'}`,
  );

  // 12. No session at any depth — the claim this whole door rests on.
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', alice.publicKeyHex)
    .neq('kind', 'ssh');
  check(
    'the store door holds no session at any depth',
    (count ?? 0) === 0,
    `non-ssh sessions for alice: ${count ?? 0}`,
  );

  // 13. A pulled forward and a stopped daemon each drop the player mid-session, which
  //     is the whole eviction mechanism when there is no session row to invalidate.
  const pulled = await statement(OPEN, 'DBSIZE', { port: FORWARD_PORT + 1 });
  check(
    'a forward the gateway does not carry refuses, which the client reads as no route',
    pulled.status === 404 && errorOf(pulled.body) === 'host_unreachable',
    `status=${pulled.status} error=${errorOf(pulled.body) ?? '-'}`,
  );

  await plant(OPEN.deepId, PIDFILE, null);
  const stopped = await statement(OPEN, 'DBSIZE');
  check(
    'a stopped deep daemon refuses as a stopped daemon rather than a missing box',
    stopped.status === 404 && errorOf(stopped.body) === 'service_not_running',
    `status=${stopped.status} error=${errorOf(stopped.body) ?? '-'}`,
  );

  const failed = results.filter(({ pass }) => !pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

await main();
