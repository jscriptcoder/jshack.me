// Wire-payload smoke for the KEY-VALUE STORE door — `hydraCrack` against redis.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `hydra <host> redis` is DISPATCHED for a service the sweep endpoint has never
//     been asked about before, and hands back the store's password.
//   - The credential crosses the wire with NO `username` FIELD AT ALL. A unit test
//     compares objects, where an absent key and an undefined one are the same thing;
//     JSON is where they stop being. A client rendering `login: undefined` is exactly
//     the failure this door's whole shape exists to avoid.
//   - The trace lands at the target's own `/var/log/redis.log`, in redis's line shape,
//     and NOTHING is written to `auth.log`. `patches` is keyed on
//     `(machine_id, path, writer_key)`, so a sweep that filed under the wrong daemon
//     passes every unit test in the suite.
//   - An OPEN store answers `no_password_set` and leaves its log untouched. Live, that
//     means the guard really runs before anything is attacked rather than after.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRedisSweep.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { storeIn } from '../src/core/redis/datadir';
import { md5 } from '../src/core/generation/md5';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
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

// Chosen because it seeds BOTH shapes of store — one open, one locked — and the locked
// one's secret is drawn from the CRACKABLE pool. All three matter: the requirepass is
// drawn at 0.7, so roughly three locked stores in ten cannot fall to the shipped
// wordlist at all, and a run against one of those would report an empty sweep that
// looks exactly like a broken endpoint.
const ESSID = 'REDIS-LAB-4';
const ATTACKER_IP = '192.168.1.50';

const attacker = generateIdentity();
const attackerMachine = computeWorkstationId('datalab', attacker.publicKeyHex);

const storeHosts = generateHomeLan(ESSID).hosts.filter(
  (host) =>
    host.kind === 'machine' &&
    hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.redis),
);

const storeOf = (host: LanHost) => storeIn(resolveLanHostIdentity(host, ESSID).baseFs);

/** The shipped wordlist's word for a hash, or nothing. The oracle is the DATADIR read
 *  directly rather than the catalog column under test — an expectation computed through
 *  `secretOn` would move with the very thing this exists to check. */
const openerOf = (hash: string): string | undefined =>
  DEFAULT_WORDLIST.find((word) => md5(word) === hash);

const openHost = storeHosts.find((host) => storeOf(host)?.requirepassHash === null);
const lockedHost = storeHosts.find((host) => {
  const hash = storeOf(host)?.requirepassHash;
  return typeof hash === 'string' && openerOf(hash) !== undefined;
});

if (openHost === undefined || lockedHost === undefined) {
  console.error(
    `ESSID ${ESSID} needs one OPEN store and one LOCKED store whose secret the shipped ` +
      `wordlist holds — pick another ESSID.`,
  );
  process.exit(2);
}

const secret = openerOf(storeOf(lockedHost)?.requirepassHash ?? '');
if (secret === undefined) {
  console.error(`the locked store on ${lockedHost.hostname} is not crackable after all`);
  process.exit(2);
}

const machineOf = (host: LanHost) => resolveLanHostIdentity(host, ESSID).machineId;
const lockedMachine = machineOf(lockedHost);
const openMachine = machineOf(openHost);

/** The cracked entries as a CLIENT has to read them — off an untyped body, and looking
 *  at which keys are present rather than at what they hold. */
const crackedIn = (body: unknown): readonly Record<string, unknown>[] => {
  if (typeof body !== 'object' || body === null) return [];
  const cracked = Object.getOwnPropertyDescriptor(body, 'cracked')?.value;
  if (!Array.isArray(cracked)) return [];
  return cracked.filter(
    (entry: unknown): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null,
  );
};

const errorIn = (body: unknown): string =>
  typeof body === 'object' && body !== null
    ? String(Object.getOwnPropertyDescriptor(body, 'error')?.value ?? '')
    : '';

const logAt = async (machineId: string, path: string): Promise<string | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, owner')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  if (typeof data !== 'object' || data === null) return null;
  const content = Object.getOwnPropertyDescriptor(data, 'content')?.value;
  return typeof content === 'string' ? content : null;
};

const ownerAt = async (machineId: string, path: string): Promise<string | null> => {
  const { data } = await sr
    .from('patches')
    .select('owner')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  if (typeof data !== 'object' || data === null) return null;
  const owner = Object.getOwnPropertyDescriptor(data, 'owner')?.value;
  return typeof owner === 'string' ? owner : null;
};

const rowCount = async (machineId: string): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('path', { count: 'exact', head: true })
    .eq('machine_id', machineId);
  return count ?? 0;
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', lockedMachine);
  await sr.from('patches').delete().eq('machine_id', openMachine);
  await sr.from('patches').delete().eq('machine_id', attackerMachine);
};

const seedWordlist = async () => {
  await sr.from('patches').upsert(
    {
      writer_key: attacker.publicKeyHex,
      machine_id: attackerMachine,
      path: WORDLIST_PATH,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      is_new: true,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const sweep = (host: LanHost, username?: string) =>
  post(
    signRequest(attacker, 'hydraCrack', {
      essid: ESSID,
      target_ip: host.ip,
      service: SERVICE_CATALOG.redis.service,
      ...(username === undefined ? {} : { username }),
      caller_machine_id: attackerMachine,
      source_ip: ATTACKER_IP,
    }),
  );

const main = async (): Promise<void> => {
  console.log(
    `locked ${lockedHost.hostname} ${lockedHost.ip} — secret "${secret}" is in the wordlist\n` +
      `open   ${openHost.hostname} ${openHost.ip} — nothing to crack\n`,
  );

  await clear();
  await seedWordlist();

  const cracked = await sweep(lockedHost);
  check(
    'hydra <host> redis is answered at all',
    cracked.status === 200,
    `status ${cracked.status} ${JSON.stringify(cracked.body)}`,
  );

  const entries = crackedIn(cracked.body);
  check(
    'and hands back the store password',
    entries.length === 1 && entries[0]?.['password'] === secret,
    `cracked ${JSON.stringify(entries)}`,
  );
  check(
    'with NO login field on the wire — absent, not undefined',
    entries.every((entry) => !('username' in entry)),
    `keys ${JSON.stringify(entries.map((entry) => Object.keys(entry)))}`,
  );

  const trace = await logAt(lockedMachine, REDIS_LOG_PATH);
  const lines = (trace ?? '').trim().split('\n').filter(Boolean);
  check(
    'the sweep lands in the store daemon OWN log',
    lines.length > 1 && lines.some((line) => line.includes('authenticated successfully')),
    `${REDIS_LOG_PATH}: ${lines.length} line(s)`,
  );
  check(
    'one line per password tried, and none after the one that matched',
    lines.length === DEFAULT_WORDLIST.indexOf(secret) + 1 &&
      lines.at(-1)?.includes('authenticated successfully') === true,
    `${lines.length} line(s), secret at index ${DEFAULT_WORDLIST.indexOf(secret)}`,
  );
  check(
    'written in redis shape, naming no account, and root-owned as the table stored it',
    !(trace ?? '').includes('sshd[') &&
      !(trace ?? '').includes('for user') &&
      (await ownerAt(lockedMachine, REDIS_LOG_PATH)) === REDIS_LOG_OWNER,
    `owner ${await ownerAt(lockedMachine, REDIS_LOG_PATH)}`,
  );
  check(
    'and NOTHING went to auth.log',
    (await logAt(lockedMachine, AUTH_LOG_PATH)) === null,
    `${AUTH_LOG_PATH}: ${(await logAt(lockedMachine, AUTH_LOG_PATH)) === null ? 'no row' : 'a row exists'}`,
  );

  const named = await sweep(lockedHost, 'root');
  check(
    'a login named against a store is answered rather than filtered by',
    crackedIn(named.body).some((entry) => entry['password'] === secret),
    `cracked ${JSON.stringify(crackedIn(named.body))}`,
  );

  // ─── the store that was never shut ───
  const openSweep = await sweep(openHost);
  check(
    'an OPEN store says it has no password to find',
    openSweep.status === 404 && errorIn(openSweep.body) === 'no_password_set',
    `status ${openSweep.status} ${JSON.stringify(openSweep.body)}`,
  );
  check(
    'and its log is left exactly as the sweep found it',
    (await rowCount(openMachine)) === 0,
    `${await rowCount(openMachine)} row(s) on ${openHost.hostname}`,
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
