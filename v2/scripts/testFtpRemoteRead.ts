// Wire-check for the REMOTE half of the `ftp>` prompt: an `ftp`-kind session is what
// lets the player read the target box's journal, and it is the ONLY thing that does.
// Drives the REAL /api/sessions + /api/patches endpoints against a running
// `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `listPatches` on a box the caller holds nothing on is 403 `no_session` — the
//     baseline the door has to change.
//   - An `ftp` row authorizes that same read. The L1 gate looks for an ACTIVE session
//     and never asks which kind, which is the epic's central claim (the door adds no
//     authorization dimension) — but every unit test fakes `findActiveSession`, so
//     only a live row against the live query can show that `kind:'ftp'` counts.
//   - What comes back is the box's REAL state: the journal holds the `vsftpd.log`
//     line the server itself wrote when the player arrived. A client cannot compute
//     that from the generated world, so a listing containing it was genuinely read
//     off the target.
//   - The grant is per-BOX: the same session does not open a second machine's journal.
//   - The grant DIES with the session: after `endSession` the read is 403 again, so a
//     player who quits stops being able to read the box they left.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpRemoteRead.ts
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

// The same ESSID `testFtpSweepTrace` uses: most generate no host running the ftp
// door at all, so the lab network is picked rather than left to chance.
const ESSID = 'VSFTPD-LAB';

const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp));
// A second box, to prove the grant is per-machine rather than per-player.
const bystander = lan.hosts.find(
  (host) => host.kind === 'machine' && host.ip !== target?.ip,
);

if (target === undefined || bystander === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a pair (ftp host: ${target?.ip ?? 'none'}, second host: ${bystander?.ip ?? 'none'}).`,
  );
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);
const bystanderMachine = machineIdForLanHost(bystander, ESSID);

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

const readJournal = (machineId: string) =>
  post(PATCHES, signRequest(player, 'listPatches', { machine_id: machineId }));

const pathsIn = (body: unknown): readonly string[] =>
  ((body as { patches?: readonly { path: string }[] } | null)?.patches ?? []).map(
    (row) => row.path,
  );

const logLineIn = (body: unknown): string =>
  (
    (body as { patches?: readonly { path: string; content: string | null }[] } | null)?.patches ?? []
  ).find((row) => row.path === VSFTPD_LOG_PATH)?.content ?? '';

const clear = async () => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('patches').delete().eq('machine_id', bystanderMachine);
};

const main = async (): Promise<void> => {
  await clear();

  // --- the baseline: no session, no journal ---
  const before = await readJournal(targetMachine);
  check(
    'a box the player holds nothing on refuses its journal',
    before.status === 403,
    `status ${before.status} ${JSON.stringify(before.body)}`,
  );

  // --- the door ---
  const login = await post(
    SESSIONS,
    signRequest(player, 'authCreateSession', {
      session_id: 'ftp-read-1',
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

  const opened = await readJournal(targetMachine);
  check(
    'and the ftp row alone authorizes the journal read — the gate never asks which door',
    opened.status === 200,
    `status ${opened.status}`,
  );
  check(
    'what comes back is the box as it stands, including the log of the arrival itself',
    pathsIn(opened.body).includes(VSFTPD_LOG_PATH) && logLineIn(opened.body).includes('OK LOGIN'),
    `paths: ${JSON.stringify(pathsIn(opened.body))}`,
  );

  const other = await readJournal(bystanderMachine);
  check(
    'the grant is for the box it was bought on, not for the network',
    other.status === 403,
    `status ${other.status} on ${bystander.ip}`,
  );

  // --- and it dies when the player quits ---
  const ended = await post(SESSIONS, signRequest(player, 'endSession', { session_id: 'ftp-read-1' }));
  check('the session ends', ended.status === 200, `status ${ended.status}`);

  const after = await readJournal(targetMachine);
  check(
    'a quit player can no longer read the box they left',
    after.status === 403,
    `status ${after.status} ${JSON.stringify(after.body)}`,
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
