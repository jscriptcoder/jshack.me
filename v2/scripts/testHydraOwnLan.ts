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
//   - A wordlist row written by ANOTHER player on the caller's machine → used. The
//     read is machine-scoped, not writer-scoped: a file belongs to the box it is
//     on. A writer-scoped query passes every other check in this file.
//   - Two writers holding the same path → the newest row wins, ordered on the
//     server's `updated_at` rather than on which query returned first.
//   - A caller_machine_id the caller holds no session on → 403 no_session, so a
//     player cannot read a wordlist off a box they never reached.
//   - A sweep launched FROM a LAN box the caller holds a real session on: it reads
//     THAT box's wordlist, and the trace on the target names that box rather than
//     the workstation the request was signed on.
//   - A session on a machine the server cannot place on the LAN → 403
//     caller_not_on_lan, and no trace: an origin nobody can point at is never
//     written up as if it were one.
//   - A target that is not a host on the LAN → 404 host_unreachable.
//   - A host running no ssh → 404 service_not_running.
//   - The TRACE the sweep leaves on the target: a row at (target, /var/log/auth.log,
//     attacker key), root-owned and world-readable, holding one line per password
//     TRIED — `Accepted` for the account that fell, `Failed` for the rest — and
//     naming the attacker's address. A second sweep APPENDS to it, and a refused
//     sweep writes nothing at all. This is the half `tsc` cannot see: the column
//     names, the upsert conflict target and the permissions JSON shape are only
//     proven by a real round-trip.
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
import { hostServices } from '../src/core/generation/remoteHostFs';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { machineIdForLanHost, resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_OWNER, AUTH_LOG_PATH } from '../src/core/logging/authLog';

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

type NamedCredential = { readonly username: string; readonly password: string };

/** Every account on a host with its real plaintext. Matched against BOTH pools:
 *  an account now draws from either, so searching the crackable pool alone would
 *  quietly drop the holdouts — and the checks below exist to find those. */
const credentialsOn = (host: LanHost): readonly NamedCredential[] => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  return accountsIn(baseFs).flatMap((account) => {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    return password === undefined ? [] : [{ username: account.username, password }];
  });
};

const inStarterWordlist = (credential: NamedCredential): boolean =>
  DEFAULT_WORDLIST.includes(credential.password);

/** A usable target runs ssh AND holds at least one account the starter wordlist
 *  covers and at least one it does not. Both halves are load-bearing: the covered
 *  accounts prove a sweep reports what it should, the holdout proves it withholds
 *  what it should. A host with no holdout cannot fail the check that matters. */
const usableTarget = (host: LanHost): boolean => {
  if (host.kind !== 'machine' || !runsSsh(host)) return false;
  const credentials = credentialsOn(host);
  return (
    credentials.some(inStarterWordlist) &&
    credentials.some((credential) => !inStarterWordlist(credential))
  );
};

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find(usableTarget);
const sshless = lan.hosts.find((host) => host.kind === 'machine' && !runsSsh(host));

if (target === undefined || sshless === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a usable pair (usable ssh host: ${target?.ip ?? 'none'}, ssh-less host: ${sshless?.ip ?? 'none'}).`,
  );
  console.error(
    'A usable target needs ssh, one starter-wordlist account, and one holdout. Pick another ESSID —',
  );
  console.error('this is the trap slice 4 of D1 lost a cycle to.');
  process.exit(2);
}

const accounts = credentialsOn(target);
const starterAccounts = accounts.filter(inStarterWordlist);
const holdoutAccounts = accounts.filter((credential) => !inStarterWordlist(credential));
const listeningPort = hostServices(ESSID, target).find(
  ({ spec }) => spec === SERVICE_CATALOG.ssh,
)?.port;

const ATTACKER_IP = '192.168.1.50';
const targetMachine = resolveLanHostIdentity(target, ESSID).machineId;

const crackEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: target.ip,
    service: 'ssh',
    caller_machine_id: attackerMachine,
    source_ip: ATTACKER_IP,
    ...over,
  });

/** The trace row the sweep is expected to leave on the TARGET — keyed the way the
 *  appender writes it, so a wrong key here reads as "no trace at all". */
const readTrace = async (): Promise<{
  readonly content: string;
  readonly owner: string | null;
  readonly permissions: unknown;
  readonly nodeType: string | null;
} | null> => {
  const { data, error } = await sr
    .from('patches')
    .select('content, owner, permissions, node_type')
    .eq('machine_id', targetMachine)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', attacker.publicKeyHex)
    .maybeSingle();
  if (error) throw new Error(`auth.log read failed: ${error.message}`);
  if (data === null) return null;
  return {
    content: data.content ?? '',
    owner: data.owner,
    permissions: data.permissions,
    nodeType: data.node_type,
  };
};

const clearTrace = async () => {
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', targetMachine)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', attacker.publicKeyHex);
};

const traceLines = (content: string): readonly string[] =>
  content.split('\n').filter((line) => line.length > 0);

/** Seed a wordlist on the attacker's machine exactly as `apt install hydra` writes
 *  it. `writerKey` defaults to the attacker; pass another player's key to stand in
 *  for a list someone ELSE left on the box. */
const seedWordlist = async (
  words: readonly string[],
  on: { readonly writerKey?: string; readonly machineId?: string } = {},
) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: on.machineId ?? attackerMachine,
      path: WORDLIST_PATH,
      content: formatWordlist(words),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      writer_key: on.writerKey ?? attacker.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`wordlist seed failed: ${error.message}`);
};

/** Every writer's row at the path, not just the attacker's — the read under test
 *  is machine-scoped, so a leftover foreign row would silently arm later checks. */
const clearWordlist = async (machineId = attackerMachine) => {
  await sr.from('patches').delete().eq('machine_id', machineId).eq('path', WORDLIST_PATH);
};

/** A LAN box other than the target — the machine the player stands ON for the
 *  pivot checks. Its machine_id is what a real ssh session there would carry. */
const standing = lan.hosts.find(
  (host) => host.kind === 'machine' && host.ip !== target.ip,
);
if (standing === undefined) {
  console.error(`ESSID ${ESSID} has no second machine to stand on.`);
  process.exit(2);
}
const standingMachine = machineIdForLanHost(standing, ESSID);

/** An ssh session for the attacker on `machineId`, exactly as a real login leaves
 *  behind — this is what the server checks before it will read a box's wordlist. */
const seedSession = async (machineId: string) => {
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: crypto.randomUUID(),
    player_key: attacker.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    parent_session_id: null,
    source_ip: ATTACKER_IP,
    kind: 'ssh',
    essid: ESSID,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

const clearSessions = async () => {
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
};

const crackedIn = (body: unknown): readonly { username: string; password: string }[] => {
  const cracked = (body as { cracked?: unknown } | null)?.cracked;
  return Array.isArray(cracked) ? (cracked as { username: string; password: string }[]) : [];
};

const main = async () => {
  console.log(`Target ${target.ip} (${target.hostname}) on ${ESSID}, ssh :${listeningPort}`);
  console.log(`All accounts:   ${accounts.map((entry) => entry.username).join(', ')}`);
  console.log(`Starter covers: ${starterAccounts.map((entry) => entry.username).join(', ')}`);
  console.log(`Holds out:      ${holdoutAccounts.map((entry) => entry.username).join(', ')}`);
  await clearWordlist();

  // 0. THE DIFFICULTY CURVE, end to end against the real endpoint. The starter
  //    wordlist is what a player actually has after `apt install hydra`, so this
  //    is the only check here that measures the game as shipped: the accounts it
  //    covers fall, and the ones it does not are withheld even though the server
  //    knows their plaintext perfectly well.
  await seedWordlist(DEFAULT_WORDLIST);
  const starter = await post(crackEnvelope());
  const starterCracked = crackedIn(starter.body);
  const starterNames = starterCracked.map((entry) => entry.username).sort();
  check(
    'the starter wordlist cracks exactly the accounts it covers',
    starter.status === 200 &&
      JSON.stringify(starterNames) ===
        JSON.stringify(starterAccounts.map((entry) => entry.username).sort()),
    `cracked ${starterNames.join(',') || 'none'}; expected ${starterAccounts.map((entry) => entry.username).join(',')}`,
  );
  check(
    'an account outside the starter wordlist HOLDS against a default install',
    !starterCracked.some((entry) =>
      holdoutAccounts.some((holdout) => holdout.username === entry.username),
    ),
    `holdouts ${holdoutAccounts.map((entry) => entry.username).join(',')}; cracked ${starterNames.join(',') || 'none'}`,
  );

  // 0b. Growing the list is the progression: append one harvested password and the
  //     account that held now falls. Proven here rather than argued, because the
  //     server reads the FILE per run — nothing is compiled in or cached.
  const harvested = holdoutAccounts[0]!;
  await seedWordlist([...DEFAULT_WORDLIST, harvested.password]);
  const grown = await post(crackEnvelope());
  check(
    'appending a harvested password makes the account that held fall',
    crackedIn(grown.body).some((entry) => entry.username === harvested.username),
    `harvested ${harvested.username}; cracked ${crackedIn(grown.body).map((entry) => entry.username).join(',') || 'none'}`,
  );

  // 0c. A box is one box: the wordlist is whatever the LAST writer left there, not
  //     the caller's private row. Seeded under a stranger's key with nothing of the
  //     attacker's at that path, the sweep must still use it — this is the live
  //     proof that the read is machine-scoped, which `tsc` cannot see and a
  //     writer-scoped query would fail while every other check here still passed.
  await clearWordlist();
  await seedWordlist([...DEFAULT_WORDLIST, harvested.password], { writerKey: stranger.publicKeyHex });
  const strangersList = await post(crackEnvelope());
  check(
    "a wordlist another player left on the box is the one the sweep uses",
    crackedIn(strangersList.body).some((entry) => entry.username === harvested.username),
    `harvested ${harvested.username}; cracked ${crackedIn(strangersList.body).map((entry) => entry.username).join(',') || 'none'}`,
  );

  // 0d. …and the LATEST write wins across writers. The attacker's own row lands
  //     after the stranger's and drops the harvested password, so the account that
  //     just fell must hold again. Ordering is on the SERVER's `updated_at`, so
  //     this also proves the two rows are being ordered rather than picked by luck.
  await seedWordlist(DEFAULT_WORDLIST);
  const overwritten = await post(crackEnvelope());
  check(
    'the newest row wins when two writers hold the same file',
    !crackedIn(overwritten.body).some((entry) => entry.username === harvested.username),
    `harvested ${harvested.username} should hold; cracked ${crackedIn(overwritten.body).map((entry) => entry.username).join(',') || 'none'}`,
  );
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

  // 5. A caller_machine_id the caller holds no session on is refused — this is what
  //    stops a player reading a wordlist off a box they never reached.
  const foreign = await post(
    crackEnvelope({ caller_machine_id: computeWorkstationId('victim', stranger.publicKeyHex) }),
  );
  check(
    "a machine the caller has no session on is refused",
    foreign.status === 403 && (foreign.body as { error?: string } | null)?.error === 'no_session',
    `status ${foreign.status}, body ${JSON.stringify(foreign.body)}`,
  );

  // 6. TOOLS RUN WHERE YOU STAND. With a real session row on a LAN box, the sweep
  //    launches FROM that box: it reads THAT machine's wordlist, and the trace on
  //    the target names the box the packets came from rather than the workstation
  //    the request was signed on. The session lookup, the sessions/patches column
  //    names and the derived address are all invisible to tsc.
  await seedSession(standingMachine);
  await clearWordlist(standingMachine);
  await seedWordlist(accounts.map((account) => account.password), {
    machineId: standingMachine,
  });
  await clearTrace();
  const pivot = await post(crackEnvelope({ caller_machine_id: standingMachine }));
  check(
    'a sweep launched from a box the caller stands on cracks with THAT box-s wordlist',
    pivot.status === 200 && crackedIn(pivot.body).length === accounts.length,
    `status ${pivot.status}, cracked ${crackedIn(pivot.body).length}/${accounts.length}`,
  );
  const pivotTrace = await readTrace();
  check(
    'the trace names the box the sweep was launched FROM, not the workstation',
    pivotTrace !== null &&
      traceLines(pivotTrace.content).every((line) => line.includes(`from ${standing.ip}`)) &&
      !pivotTrace.content.includes(ATTACKER_IP),
    `standing ${standing.ip}, workstation ${ATTACKER_IP}, first line ${traceLines(pivotTrace?.content ?? '')[0] ?? 'none'}`,
  );

  // 7. A session is not enough on its own: a machine the server cannot place on the
  //    LAN has no address to record, so the sweep is refused rather than written up
  //    as coming from a box nobody can point at.
  await seedSession('not-a-box-on-this-lan');
  await clearTrace();
  const unplaceable = await post(crackEnvelope({ caller_machine_id: 'not-a-box-on-this-lan' }));
  check(
    'a session on a machine that is not on the LAN is still refused',
    unplaceable.status === 403 &&
      (unplaceable.body as { error?: string } | null)?.error === 'caller_not_on_lan',
    `status ${unplaceable.status}, body ${JSON.stringify(unplaceable.body)}`,
  );
  check(
    'the refused sweep left no trace on the target',
    (await readTrace()) === null,
    'expected no auth.log row',
  );
  await clearWordlist(standingMachine);

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

  // 8. THE DEFENDER'S HALF. Everything above is what the ATTACKER learns; this is
  //    what the box's occupant reads back afterwards.
  await clearTrace();
  const fallen = accounts.find(
    (candidate) => accounts.filter((other) => other.password === candidate.password).length === 1,
  );
  if (fallen === undefined) throw new Error('no account on this host holds a unique password');
  // The match sits in the MIDDLE: a sweep that carried on past it would record a
  // password the attacker never sent.
  const sweepWords = ['zzz-not-a-password', fallen.password, 'never-reached'];
  const expectedLines = accounts.reduce((total, account) => {
    const matchedAt = sweepWords.indexOf(account.password);
    return total + (matchedAt === -1 ? sweepWords.length : matchedAt + 1);
  }, 0);

  await seedWordlist(sweepWords);
  await post(crackEnvelope());
  const trace = await readTrace();
  const lines = traceLines(trace?.content ?? '');
  const accepted = lines.filter((line) => line.includes('Accepted password'));
  check(
    'a sweep leaves one auth.log line per password TRIED',
    lines.length === expectedLines,
    `${lines.length} lines over ${accounts.length} accounts (expected ${expectedLines})`,
  );
  check(
    'the account that fell is Accepted and nothing else is',
    accepted.length === 1 &&
      accepted[0].includes(`Accepted password for ${fallen.username} from ${ATTACKER_IP}`),
    `accepted: ${accepted.join(' | ') || 'none'}`,
  );
  check(
    "every line names the attacker's address",
    lines.length > 0 && lines.every((line) => line.includes(`from ${ATTACKER_IP}`)),
    `${lines.filter((line) => line.includes(`from ${ATTACKER_IP}`)).length}/${lines.length} lines`,
  );
  const perms = trace?.permissions as Record<string, readonly string[]> | null | undefined;
  check(
    'the trace is a root-owned file every tier can read',
    trace?.owner === AUTH_LOG_OWNER &&
      trace?.nodeType === 'file' &&
      perms?.read?.includes('guest') === true &&
      JSON.stringify(perms?.write) === JSON.stringify(['root']),
    `owner ${trace?.owner}, node_type ${trace?.nodeType}, perms ${JSON.stringify(perms)}`,
  );

  // A second sweep must APPEND. The read-modify-write against the real table is
  // exactly what a local typecheck cannot prove.
  await post(crackEnvelope());
  const twice = traceLines((await readTrace())?.content ?? '');
  check(
    'a second sweep appends rather than replacing the first',
    twice.length === expectedLines * 2,
    `${twice.length} lines after two sweeps (expected ${expectedLines * 2})`,
  );

  // 9. A sweep that never reached the box leaves nothing behind — a log line would
  //    tell its owner they were attacked when they were not.
  await clearTrace();
  await post(crackEnvelope({ target_ip: '10.99.99.99' }));
  check(
    'a refused sweep writes no trace at all',
    (await readTrace()) === null,
    'no auth.log row after an unreachable target',
  );

  await clearTrace();
  await clearWordlist();
  await clearWordlist(standingMachine);
  await clearSessions();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
