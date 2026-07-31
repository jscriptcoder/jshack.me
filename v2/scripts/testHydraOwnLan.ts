// Wire-payload smoke for the own-LAN credential sweep — the `hydraCrack` action.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase,
// seeding the caller's wordlist as a patch row (as `apt install hydra` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A wordlist holding a host's real passwords → 200, every matching account
//     reported with its plaintext, on the port the service actually listens on.
//   - A wordlist with one password REMOVED → that account survives the sweep. The
//     gate is wordlist membership, and this is the check that proves it: with a
//     full list everything cracks, so a handler that ignored the list entirely
//     would pass every other assertion here.
//   - A named username → only that account is attacked.
//   - NO wordlist row → 200 with wordlistFound:false, cracked empty. Distinct from
//     a sweep that matched nothing.
//   - A caller_machine_id belonging to someone ELSE → 403 not_own_machine, so a
//     player cannot read a wordlist off another player's box.
//   - A target that is not a host on the LAN → 404 host_unreachable.
//   - A host running no ssh → 404 service_not_running.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHydraOwnLan.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices, WEAK_PASSWORDS } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import {
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';

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
const stranger = generateIdentity();
const attackerMachine = computeWorkstationId('cracklab', attacker.publicKeyHex);

const runsSsh = (host: LanHost): boolean =>
  hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.ssh);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && runsSsh(host));
const sshless = lan.hosts.find((host) => host.kind === 'machine' && !runsSsh(host));

if (target === undefined || sshless === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a usable pair (ssh host: ${target?.ip ?? 'none'}, ssh-less host: ${sshless?.ip ?? 'none'}).`,
  );
  console.error('Pick another ESSID — this is the trap slice 4 of D1 lost a cycle to.');
  process.exit(2);
}

const { baseFs } = resolveLanHostIdentity(target, ESSID);
const accounts = accountsIn(baseFs).flatMap((account) => {
  const password = WEAK_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
  return password === undefined ? [] : [{ username: account.username, password }];
});
const listeningPort = hostServices(ESSID, target).find(
  ({ spec }) => spec === SERVICE_CATALOG.ssh,
)?.port;

const crackEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: target.ip,
    service: 'ssh',
    caller_machine_id: attackerMachine,
    ...over,
  });

/** Seed the attacker's wordlist exactly as `apt install hydra` writes it. */
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

const clearWordlist = async () => {
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', attackerMachine)
    .eq('path', WORDLIST_PATH)
    .eq('writer_key', attacker.publicKeyHex);
};

const crackedIn = (body: unknown): readonly { username: string; password: string }[] => {
  const cracked = (body as { cracked?: unknown } | null)?.cracked;
  return Array.isArray(cracked) ? (cracked as { username: string; password: string }[]) : [];
};

const main = async () => {
  console.log(`Target ${target.ip} (${target.hostname}) on ${ESSID}, ssh :${listeningPort}`);
  console.log(`Accounts recoverable from the pool: ${accounts.map((a) => a.username).join(', ')}`);
  await clearWordlist();

  // 1. A wordlist holding everything cracks everything.
  await seedWordlist(accounts.map((account) => account.password));
  const full = await post(crackEnvelope());
  const fullCracked = crackedIn(full.body);
  check(
    'full wordlist cracks every account',
    full.status === 200 && fullCracked.length === accounts.length,
    `status ${full.status}, cracked ${fullCracked.length}/${accounts.length}`,
  );
  check(
    'reports the real listening port',
    (full.body as { port?: number } | null)?.port === listeningPort,
    `port ${(full.body as { port?: number } | null)?.port} (expected ${listeningPort})`,
  );

  // 2. Remove ONE password — that account must survive. The load-bearing check:
  //    a handler ignoring the wordlist passes everything else in this file.
  const withheld = accounts[0];
  await seedWordlist(accounts.slice(1).map((account) => account.password));
  const partial = await post(crackEnvelope());
  const partialCracked = crackedIn(partial.body);
  check(
    'a password absent from the wordlist is never reported',
    !partialCracked.some((entry) => entry.username === withheld.username),
    `withheld ${withheld.username}; cracked ${partialCracked.map((e) => e.username).join(',') || 'none'}`,
  );

  // 3. A named account narrows the sweep.
  await seedWordlist(accounts.map((account) => account.password));
  const named = await post(crackEnvelope({ username: accounts[0].username }));
  const namedCracked = crackedIn(named.body);
  check(
    'a named username attacks only that account',
    namedCracked.length === 1 && namedCracked[0].username === accounts[0].username,
    `cracked ${namedCracked.map((e) => e.username).join(',') || 'none'}`,
  );

  // 4. No wordlist at all is a distinct answer from "nothing matched".
  await clearWordlist();
  const bare = await post(crackEnvelope());
  check(
    'no wordlist reports wordlistFound:false, not an empty sweep',
    bare.status === 200 &&
      (bare.body as { wordlistFound?: boolean } | null)?.wordlistFound === false &&
      crackedIn(bare.body).length === 0,
    `status ${bare.status}, body ${JSON.stringify(bare.body)}`,
  );

  // 5. A foreign caller_machine_id is refused — this is what stops a player
  //    reading someone else's wordlist by naming their box.
  const foreign = await post(
    crackEnvelope({ caller_machine_id: computeWorkstationId('victim', stranger.publicKeyHex) }),
  );
  check(
    "a stranger's machine_id is refused",
    foreign.status === 403 && (foreign.body as { error?: string } | null)?.error === 'not_own_machine',
    `status ${foreign.status}, body ${JSON.stringify(foreign.body)}`,
  );

  // 6/7. Reachability refusals match ssh's.
  const nowhere = await post(crackEnvelope({ target_ip: '10.99.99.99' }));
  check(
    'a target off the LAN is unreachable',
    nowhere.status === 404 && (nowhere.body as { error?: string } | null)?.error === 'host_unreachable',
    `status ${nowhere.status}, body ${JSON.stringify(nowhere.body)}`,
  );

  const noService = await post(crackEnvelope({ target_ip: sshless.ip }));
  check(
    'a host running no ssh reports the service, not a failed crack',
    noService.status === 404 &&
      (noService.body as { error?: string } | null)?.error === 'service_not_running',
    `status ${noService.status}, body ${JSON.stringify(noService.body)}`,
  );

  await clearWordlist();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
