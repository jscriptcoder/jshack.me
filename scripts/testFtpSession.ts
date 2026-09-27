// Wire-payload smoke for the ftp DOOR — `authCreateSession` asked for an `ftp`-kind
// row, and the `endSession` reason that closes it. Drives the REAL /api/sessions
// endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A correct credential against an ftp-serving host inserts a row whose `kind` is
//     `ftp`, and `listSessions` returns it as active. `sessions.kind` is `TEXT NOT
//     NULL` with NO check constraint, so this is read off the DDL rather than proven
//     — until here. A constraint added later would reject the insert at runtime while
//     every unit test (which fakes `insertSession`) stayed green.
//   - The login trace lands on the target's `/var/log/vsftpd.log` as a CONNECT line
//     followed by an OK LOGIN — and NOT on `auth.log`.
//   - A refused credential writes CONNECT + FAIL LOGIN and inserts nothing.
//   - `endSession` stamps `end_reason`: `user_exit` by default, `abandoned` when the
//     boot sweep says so. The column write is a plain string the handler never reads
//     back, so nothing but a real round-trip can show it landed.
//   - A login against a host running NO ftp daemon is refused, and leaves no log row.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpSession.ts
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
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog';

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

const ESSID = 'VSFTPD-LAB';

const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp));
// A box with no ftp door: the refusal has to be a real answer about a real machine,
// not a 404 that only means "no such host".
const doorless = lan.hosts.find(
  (host) => host.kind === 'machine' && !serves(host, SERVICE_CATALOG.ftp),
);
// The ssh-hop checks need a box that actually runs sshd, and the ftp target is chosen
// for its FTP door with no reason to have one. On this ESSID it does not: the first
// machine serving ftp offers ftp:2121 and nothing else, so an ssh login there is
// refused `service_not_running`, no session row is written, and the two checks that
// read one back report a missing default rather than a broken default.
const sshTarget = lan.hosts.find(
  (host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ssh),
);

if (target === undefined || doorless === undefined || sshTarget === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a trio (ftp host: ${target?.ip ?? 'none'}, ftp-less host: ${doorless?.ip ?? 'none'}, ssh host: ${sshTarget?.ip ?? 'none'}).`,
  );
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

const login = (options: {
  readonly sessionId: string;
  readonly host: LanHost;
  readonly username: string;
  readonly password: string;
  readonly kind?: string;
}) =>
  post(
    signRequest(player, 'authCreateSession', {
      session_id: options.sessionId,
      essid: ESSID,
      target_ip: options.host.ip,
      username: options.username,
      password: options.password,
      parent_session_id: null,
      source_ip: '192.168.1.50',
      ...(options.kind === undefined ? {} : { kind: options.kind }),
    }),
  );

const readLog = async (machineId: string, path: string): Promise<string | null> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  return (data as { content: string | null } | null)?.content ?? null;
};

const sessionRow = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('kind, ended_at, end_reason')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as { kind?: string; ended_at?: string | null; end_reason?: string | null } | null;
};

const clear = async () => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('patches').delete().eq('machine_id', machineIdForLanHost(doorless, ESSID));
};

const main = async (): Promise<void> => {
  await clear();

  // --- a refused ftp login: the knock is recorded, the row is not ---
  const refused = await login({
    sessionId: 'ftp-refused-1',
    host: target,
    username: account.username,
    password: 'not-the-password',
    kind: 'ftp',
  });
  check('a wrong password is refused', refused.status === 401, `status ${refused.status}`);
  check('and inserts no session row', (await sessionRow('ftp-refused-1')) === null, 'no row');

  const afterRefusal = await readLog(targetMachine, VSFTPD_LOG_PATH);
  check(
    'but the attempt IS written to vsftpd.log as CONNECT + FAIL LOGIN',
    afterRefusal !== null &&
      afterRefusal.includes('CONNECT: Client') &&
      afterRefusal.includes('FAIL LOGIN: Client'),
    afterRefusal === null ? 'no row' : afterRefusal.trim().split('\n').slice(-2).join(' | '),
  );

  // --- the real login ---
  const accepted = await login({
    sessionId: 'ftp-session-1',
    host: target,
    username: account.username,
    password: account.password,
    kind: 'ftp',
  });
  check(
    'a correct credential is accepted over ftp',
    accepted.status === 200,
    `status ${accepted.status} ${JSON.stringify(accepted.body)}`,
  );

  const inserted = await sessionRow('ftp-session-1');
  check(
    'the row persists the kind it was asked for — the DDL really does accept `ftp`',
    inserted?.kind === 'ftp',
    `kind=${inserted?.kind ?? 'no row'}`,
  );

  const listed = await post(signRequest(player, 'listSessions', {}));
  const rows = (listed.body as { sessions?: readonly { session_id: string; kind: string }[] } | null)
    ?.sessions;
  check(
    'listSessions returns it as active, kind and all',
    rows?.some((row) => row.session_id === 'ftp-session-1' && row.kind === 'ftp') === true,
    `sessions: ${JSON.stringify(rows?.map((row) => `${row.session_id}:${row.kind}`))}`,
  );

  const afterLogin = await readLog(targetMachine, VSFTPD_LOG_PATH);
  check(
    'the successful login appends CONNECT + OK LOGIN to the same file',
    afterLogin !== null && afterLogin.includes('OK LOGIN: Client'),
    afterLogin === null ? 'no row' : `${afterLogin.trim().split('\n').length} lines`,
  );
  check(
    'and nothing reached auth.log — the door you came through is the one recorded',
    (await readLog(targetMachine, AUTH_LOG_PATH)) === null,
    'auth.log has no row',
  );

  // --- closing it, and saying why ---
  const ended = await post(
    signRequest(player, 'endSession', { session_id: 'ftp-session-1', reason: 'abandoned' }),
  );
  check('endSession accepts a reason', ended.status === 200, `status ${ended.status}`);

  const closed = await sessionRow('ftp-session-1');
  check(
    'the row is closed AND says a refresh abandoned it, not that the player quit',
    closed?.ended_at !== null && closed?.end_reason === 'abandoned',
    `ended_at=${closed?.ended_at === null ? 'null' : 'set'} end_reason=${closed?.end_reason}`,
  );

  // The default has to survive the parameterization: every shipped caller omits it.
  // Against the ssh box, not the ftp one — an omitted `kind` means an ssh hop, and a
  // hop only happens where there is an sshd to answer it.
  const sshAccount = credential(sshTarget);
  await login({
    sessionId: 'ssh-hop-1',
    host: sshTarget,
    username: sshAccount.username,
    password: sshAccount.password,
  });
  const hop = await sessionRow('ssh-hop-1');
  check(
    'a login that names no kind is still an ssh hop',
    hop?.kind === 'ssh',
    `kind=${hop?.kind ?? 'no row'}`,
  );
  await post(signRequest(player, 'endSession', { session_id: 'ssh-hop-1' }));
  check(
    'and ending one without a reason still reads as the player leaving',
    (await sessionRow('ssh-hop-1'))?.end_reason === 'user_exit',
    `end_reason=${(await sessionRow('ssh-hop-1'))?.end_reason}`,
  );

  // --- a box with no ftp daemon ---
  const doorlessAccount = credential(doorless);
  const noDoor = await login({
    sessionId: 'ftp-nodoor-1',
    host: doorless,
    username: doorlessAccount.username,
    password: doorlessAccount.password,
    kind: 'ftp',
  });
  check(
    'a correct credential on a box with no ftp daemon is still refused',
    noDoor.status === 404,
    `status ${noDoor.status} ${JSON.stringify(noDoor.body)}`,
  );
  check(
    'and that box logs nothing — a knock it never heard leaves no trace',
    (await readLog(machineIdForLanHost(doorless, ESSID), VSFTPD_LOG_PATH)) === null,
    'no vsftpd.log row on the doorless host',
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
