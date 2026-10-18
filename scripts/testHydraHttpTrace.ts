// Wire-payload smoke for the trace a `hydra <host> http` sweep leaves on its target —
// the `hydraCrack` action against the web door. Drives the REAL /api/sessions endpoint
// against a running `vercel dev` + supabase, seeding the caller's wordlist as a patch
// row (as `apt install hydra` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The sweep lands in the TARGET's /var/log/access.log, under the network's own key,
//     root-owned and world-readable: one request per password tried, the account in the
//     HTTP-auth field, `401` for a miss and `200` for the one that fell, from the
//     attacker's server-derived address.
//   - It writes NOTHING to auth.log: a web sweep is not an sshd login.
//   - It appends to what access.log already holds, so a sweep and the fetches before it
//     share one file — the reader's view is built on, not replaced.
//   - A refused sweep writes no access.log row at all.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHydraHttpTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { md5 } from '../src/core/generation/md5.js';
import {
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
} from '../src/core/logging/accessLog.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { standOnNetwork, leaveNetwork } from './standVantage.js';
import { ALL_GENERATED_PASSWORDS } from '../src/test/passwords.js';

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

const ESSID = 'HYDRA-CRACK-WIFI';

const attacker = generateIdentity();
const attackerMachine = computeWorkstationId('cracklab', attacker.publicKeyHex);

const webPortOf = (host: LanHost): number | undefined =>
  hostServices(ESSID, host).find(({ spec }) => spec === SERVICE_CATALOG.http)?.port;

/** The first account on a host whose plaintext is known, so a two-word list can miss
 *  once and then open it. */
const knownAccountOn = (host: LanHost) =>
  accountsIn(resolveLanHostIdentity(host, ESSID).baseFs).flatMap((account) => {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    return password === undefined ? [] : [{ username: account.username, password }];
  })[0];

const target = generateHomeLan(ESSID).hosts.find(
  (host) =>
    host.kind === 'machine' && webPortOf(host) !== undefined && knownAccountOn(host) !== undefined,
);
if (target === undefined) {
  console.error(`ESSID ${ESSID} has no web host with a known account. Pick another ESSID.`);
  process.exit(2);
}
const webPort = webPortOf(target)!;
const account = knownAccountOn(target)!;
const targetMachine = resolveLanHostIdentity(target, ESSID).machineId;
const NETWORK_KEY = apGatewayLogWriterKey(ESSID);

const ATTACKER_OCTET = 50;
const ATTACKER_IP = lanAddressFor(ESSID, ATTACKER_OCTET);

const crackEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: target.ip,
    service: 'http',
    port: webPort,
    username: account.username,
    caller_machine_id: attackerMachine,
    ...over,
  });

const readRow = async (path: string) => {
  const { data, error } = await sr
    .from('patches')
    .select('content, owner, permissions')
    .eq('machine_id', targetMachine)
    .eq('path', path)
    .eq('writer_key', NETWORK_KEY)
    .maybeSingle();
  if (error) throw new Error(`${path} read failed: ${error.message}`);
  return data;
};

/** Every writer's row at the path — a leftover from another run would arm later checks. */
const clearPath = async (path: string) => {
  await sr.from('patches').delete().eq('machine_id', targetMachine).eq('path', path);
};

const seedWordlist = async (words: readonly string[]) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: attackerMachine,
      path: WORDLIST_PATH,
      content: formatWordlist(words),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      writer_key: attacker.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`wordlist seed failed: ${error.message}`);
};

const lines = (content: string | null | undefined): readonly string[] =>
  (content ?? '').split('\n').filter((line) => line.length > 0);

/** One access.log request line for the swept account, at any server timestamp. */
const sweepLine = (status: 401 | 200) =>
  new RegExp(
    `^${ATTACKER_IP.replace(/\./g, '\\.')} - ${account.username} \\[[^\\]]+\\] "GET / HTTP/1\\.1" ${status} 0$`,
  );

const main = async () => {
  console.log(`Target ${target.ip} (${target.hostname}) on ${ESSID}, http :${webPort}`);
  console.log(`Swept account: ${account.username}`);
  await leaveNetwork(sr, ESSID);
  await standOnNetwork(sr, ESSID, attacker, ATTACKER_OCTET, 'cracklab');
  await clearPath(ACCESS_LOG_PATH);
  await clearPath(AUTH_LOG_PATH);
  await seedWordlist(['no-such-word', account.password]);

  // 1. The sweep reports the account it opened.
  const swept = await post(crackEnvelope());
  const cracked = (swept.body as { cracked?: { username: string }[] } | null)?.cracked ?? [];
  check(
    'the web sweep cracks the account its list covers',
    swept.status === 200 && cracked.some((entry) => entry.username === account.username),
    `${swept.status} ${JSON.stringify(swept.body)}`,
  );

  // 2. Its trace is the web server's: one request per word, in the target's access.log.
  const access = await readRow(ACCESS_LOG_PATH);
  const written = lines(access?.content);
  check(
    'the sweep lands in access.log as a 401 then a 200, naming the account',
    written.length === 2 &&
      sweepLine(401).test(written[0] ?? '') &&
      sweepLine(200).test(written[1] ?? ''),
    written.join(' | ') || 'no access.log row',
  );
  check(
    "access.log is the daemon's: root-owned, readable by every tier",
    access?.owner === ACCESS_LOG_OWNER &&
      JSON.stringify(access?.permissions) === JSON.stringify(ACCESS_LOG_PERMISSIONS),
    `owner ${access?.owner} permissions ${JSON.stringify(access?.permissions)}`,
  );

  // 3. Nothing in auth.log: no sshd was knocked on.
  check('the web sweep writes nothing to auth.log', (await readRow(AUTH_LOG_PATH)) === null, '');

  // 4. A sweep appends to the fetches the log already holds.
  const earlier = `${ATTACKER_IP} - - [18/Oct/2026:09:00:00 +0000] "GET /index.html HTTP/1.1" 200 12`;
  await clearPath(ACCESS_LOG_PATH);
  const { error: seedError } = await sr.from('patches').upsert(
    {
      machine_id: targetMachine,
      path: ACCESS_LOG_PATH,
      content: `${earlier}\n`,
      owner: ACCESS_LOG_OWNER,
      permissions: ACCESS_LOG_PERMISSIONS,
      node_type: 'file',
      writer_key: NETWORK_KEY,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (seedError) throw new Error(`access.log seed failed: ${seedError.message}`);
  await post(crackEnvelope());
  const appended = lines((await readRow(ACCESS_LOG_PATH))?.content);
  check(
    'the sweep appends after the fetches already in access.log',
    appended.length === 3 && appended[0] === earlier && sweepLine(200).test(appended[2] ?? ''),
    `${appended.length} lines; first ${appended[0]}`,
  );

  // 5. A sweep that never reached the box writes nothing.
  await clearPath(ACCESS_LOG_PATH);
  await post(crackEnvelope({ target_ip: '10.99.99.99' }));
  check(
    'a refused web sweep writes no access.log row',
    (await readRow(ACCESS_LOG_PATH)) === null,
    '',
  );

  await clearPath(ACCESS_LOG_PATH);
  await clearPath(AUTH_LOG_PATH);
  await sr.from('patches').delete().eq('machine_id', attackerMachine).eq('path', WORDLIST_PATH);
  await leaveNetwork(sr, ESSID);

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
