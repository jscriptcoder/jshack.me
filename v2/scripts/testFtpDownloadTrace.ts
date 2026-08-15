// Wire-check for the DOWNLOAD half of the `ftp>` prompt: a file leaving a box is
// itemised in that box's own `/var/log/vsftpd.log`, and only a player who actually
// holds a session there can put a line in it. Drives the REAL /api/sessions +
// /api/patches endpoints against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `recordFtpDownload` on a box the caller holds nothing on is 403 `no_session`,
//     and writes nothing. Without this anyone could author lines in any stranger's
//     evidence, inventing thefts on boxes they never reached.
//   - An `ftp` row authorizes it, and the line lands on the TARGET's log — read back
//     through `listPatches`, so the check reads what the box holds rather than what
//     the handler returned.
//   - The account in the line is the one the SESSION carries, even when the payload
//     claims another. Every unit test fakes `findActiveSession`; only the live query
//     can show the real `credentials.username` reaching the formatter.
//   - The download line lands AFTER the login lines, in the same file — the record
//     accumulates rather than replacing itself.
//   - The grant dies with the session: after `endSession` the record is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpDownloadTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { machineIdForLanHost, resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog';

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

// The same lab network the other ftp wire-checks use: most ESSIDs generate no host
// running the door at all, so the target is picked rather than left to chance.
const ESSID = 'VSFTPD-LAB';
const STOLEN = '/etc/passwd';
const BYTES = 1243;

const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp));

if (target === undefined) {
  console.error(`ESSID ${ESSID} has no ftp-serving host.`);
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);

/** One real account on the target, with the plaintext its hash was seeded from. */
const credential = (host: LanHost): { readonly username: string; readonly password: string } => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  for (const account of accountsIn(baseFs)) {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    if (password !== undefined) return { username: account.username, password };
  }
  console.error(`no recoverable account on ${host.ip}`);
  process.exit(2);
};

const account = credential(target);

const recordDownload = (over: Record<string, unknown> = {}) =>
  post(
    PATCHES,
    signRequest(player, 'recordFtpDownload', {
      machine_id: targetMachine,
      path: STOLEN,
      bytes: BYTES,
      source_ip: '192.168.1.50',
      ...over,
    }),
  );

/** The target's `vsftpd.log` as the box itself holds it — read back through the
 *  journal rather than trusted from the handler's own answer. */
const readVsftpdLog = async (): Promise<string> => {
  const { body } = await post(PATCHES, signRequest(player, 'listPatches', { machine_id: targetMachine }));
  const rows =
    (body as { patches?: readonly { path: string; content: string | null }[] } | null)?.patches ?? [];
  return rows.find((row) => row.path === VSFTPD_LOG_PATH)?.content ?? '';
};

const rowCount = async (): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('*', { count: 'exact', head: true })
    .eq('machine_id', targetMachine)
    .eq('path', VSFTPD_LOG_PATH);
  return count ?? 0;
};

const clear = async () => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', targetMachine);
};

const main = async (): Promise<void> => {
  await clear();

  // --- the baseline: no session, no line ---
  const uninvited = await recordDownload();
  check(
    'a player holding nothing on the box cannot write to its log',
    uninvited.status === 403,
    `status ${uninvited.status} ${JSON.stringify(uninvited.body)}`,
  );
  check(
    'and nothing was written on the way to being refused',
    (await rowCount()) === 0,
    `${await rowCount()} vsftpd.log rows on ${target.ip}`,
  );

  // --- the door ---
  const login = await post(
    SESSIONS,
    signRequest(player, 'authCreateSession', {
      session_id: 'ftp-get-1',
      essid: ESSID,
      target_ip: target.ip,
      username: account.username,
      password: account.password,
      parent_session_id: null,
      source_ip: '192.168.1.50',
      kind: 'ftp',
    }),
  );
  check(
    'an ftp login is accepted',
    login.status === 200,
    `status ${login.status} ${JSON.stringify(login.body)}`,
  );
  const afterLogin = await readVsftpdLog();

  // --- the theft, claimed under a borrowed name. A name no generated box carries,
  // so the check cannot pass by accidentally matching the session's own account. ---
  const taken = await recordDownload({ user: 'impostor' });
  check(
    'the ftp row authorizes the record',
    taken.status === 200,
    `status ${taken.status} ${JSON.stringify(taken.body)}`,
  );

  const log = await readVsftpdLog();
  const downloadLine = log
    .split('\n')
    .find((line) => line.includes('OK DOWNLOAD'));
  check(
    'the box own log names the file and its size',
    downloadLine !== undefined &&
      downloadLine.includes(`"${STOLEN}", ${BYTES} bytes`) &&
      downloadLine.includes('Client "192.168.1.50"'),
    downloadLine ?? '(no OK DOWNLOAD line)',
  );
  check(
    'the account is the one the SESSION carries, not the one the payload claimed',
    downloadLine !== undefined &&
      downloadLine.includes(`[${account.username}]`) &&
      !downloadLine.includes('[impostor]'),
    `session account ${account.username}; line: ${downloadLine ?? '(none)'}`,
  );
  check(
    'the login that got them in is still there — the record accumulates',
    log.startsWith(afterLogin) && afterLogin.includes('OK LOGIN'),
    `${afterLogin.trim().split('\n').length} line(s) before, ${log.trim().split('\n').length} after`,
  );

  // --- and it dies when the player quits ---
  const ended = await post(SESSIONS, signRequest(player, 'endSession', { session_id: 'ftp-get-1' }));
  check('the session ends', ended.status === 200, `status ${ended.status}`);

  const afterQuit = await recordDownload();
  check(
    'a player who quit can no longer write to the log of the box they left',
    afterQuit.status === 403,
    `status ${afterQuit.status} ${JSON.stringify(afterQuit.body)}`,
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
