// Wire-payload check for a login to the player's OWN box — `ssh guest@localhost` at home,
// and `scp`/`ftp` through the same doors.
// The client answers the login itself from its own tree, as an own-box `su` is; what
// crosses the wire is the two things only the server can do: stamp sshd's line into the
// box's auth.log, and hold the session row that keeps the opened shell open. Drives the
// REAL /api/patches and /api/sessions endpoints against a running `vercel dev` + supabase.
// Both are own-workstation writes, authorized by the key-suffix match alone, so the setup
// is only a clean slate on the player's own box.
//
// Net-new under test (the locally-untypechecked api/ runtime, which a handler test injects
// fakes around):
//   - A `doorLogin` appendAuthLog writes sshd's own line into the box's auth.log, from the
//     address the box was reached by, and a refused one accretes after it in the same row.
//   - An address that is not one is refused 400 and writes nothing: it is written into the
//     line verbatim, so it could otherwise carry a line of its own.
//   - A door login filed on another player's box is refused 403 and writes nothing.
//   - An `scp` door login is written up as sshd's own line in auth.log: the daemon cannot
//     know the login is a copy.
//   - An `ftp` door login lands in vsftpd's own log, not auth.log: the connection and the
//     login together, in one append.
//   - An `ftpTransfer` appendAuthLog itemises a file moved over that login in the same
//     vsftpd row, in either direction; a path that breaks the line is refused 400, and one
//     filed on another player's box 403. `recordFtpTransfer` still refuses the own box.
//   - A `createSession` of kind `ssh` on the own box is held, and `listSessions` reports it
//     open — without that the shell is popped as closed on the very next line typed.
//   - A kind no own-box shell produces (`nc`) is still refused 400.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testOwnBoxLogin.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog.js';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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

// The player and their own workstation, matched by the key-suffix derivation the server
// authorizes on. The FOREIGN box carries a different key, so it is nobody the player owns.
const player = generateIdentity();
const stranger = generateIdentity();
const WS = computeWorkstationId('loginbox', player.publicKeyHex);
const FOREIGN = computeWorkstationId('victimbox', stranger.publicKeyHex);
const HOSTNAME = 'loginbox';
const SESSION_ID = `ssh-guest-${Date.now()}`;

const readLog = async (machineId: string, path: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', player.publicKeyHex)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const readAuthLog = (machineId: string): Promise<string> => readLog(machineId, AUTH_LOG_PATH);

const lines = (log: string): readonly string[] => (log.trim() === '' ? [] : log.trim().split('\n'));

const doorLogin = (machineId: string, over: Record<string, unknown> = {}) =>
  signRequest(player, 'appendAuthLog', {
    kind: 'doorLogin',
    door: 'ssh',
    machine_id: machineId,
    user: 'guest',
    from_ip: '127.0.0.1',
    outcome: 'success',
    hostname: HOSTNAME,
    ...over,
  });

const sshSession = (kind: string) =>
  signRequest(player, 'createSession', {
    machine_id: WS,
    session_id: kind === 'ssh' ? SESSION_ID : `${kind}-guest-${Date.now()}`,
    credentials: { username: 'guest', userType: 'guest' },
    kind,
    parent_session_id: null,
  });

const wipe = async () => {
  await sr.from('patches').delete().eq('machine_id', WS);
  await sr.from('patches').delete().eq('machine_id', FOREIGN);
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
};
await wipe();

const r1 = await post(PATCHES, await doorLogin(WS));
const auth1 = await readAuthLog(WS);
check('an own-box door login is accepted', r1.status === 200, `status=${r1.status}`);
check(
  'it records sshd’s accepted line, from loopback',
  lines(auth1).length === 1 &&
    /sshd\[\d+\]: Accepted password for guest from 127\.0\.0\.1$/.test(lines(auth1)[0] ?? ''),
  `line=${lines(auth1)[0] ?? '(empty)'}`,
);

const r2 = await post(PATCHES, await doorLogin(WS, { outcome: 'failure', from_ip: '10.4.0.23' }));
const auth2 = await readAuthLog(WS);
check(
  'a refused login accretes sshd’s failed line, from the leased address',
  r2.status === 200 &&
    lines(auth2).length === 2 &&
    /sshd\[\d+\]: Failed password for guest from 10\.4\.0\.23$/.test(lines(auth2)[1] ?? ''),
  `lines=${lines(auth2).length} last=${lines(auth2)[1] ?? '(empty)'}`,
);

const r3 = await post(PATCHES, await doorLogin(WS, { from_ip: '127.0.0.1\nforged line' }));
check(
  'an address that is not one is refused 400 and writes nothing',
  r3.status === 400 && lines(await readAuthLog(WS)).length === 2,
  `status=${r3.status} body=${JSON.stringify(r3.body)}`,
);

const r4 = await post(PATCHES, await doorLogin(FOREIGN));
check(
  'a door login on another player’s box is refused 403 and writes nothing',
  r4.status === 403 && (await readAuthLog(FOREIGN)) === '',
  `status=${r4.status} body=${JSON.stringify(r4.body)}`,
);

const r5 = await post(PATCHES, await doorLogin(WS, { door: 'scp' }));
const auth5 = await readAuthLog(WS);
check(
  'an scp login is written up as sshd’s own accepted line',
  r5.status === 200 &&
    lines(auth5).length === 3 &&
    /sshd\[\d+\]: Accepted password for guest from 127\.0\.0\.1$/.test(lines(auth5)[2] ?? ''),
  `status=${r5.status} lines=${lines(auth5).length} last=${lines(auth5)[2] ?? '(empty)'}`,
);

const r6 = await post(PATCHES, await doorLogin(WS, { door: 'ftp' }));
const vsftpd6 = await readLog(WS, VSFTPD_LOG_PATH);
check(
  'an ftp login lands in vsftpd’s log as the connection then the login, not in auth.log',
  r6.status === 200 &&
    lines(vsftpd6).length === 2 &&
    /\] CONNECT: Client "127\.0\.0\.1"$/.test(lines(vsftpd6)[0] ?? '') &&
    /\] \[guest\] OK LOGIN: Client "127\.0\.0\.1"$/.test(lines(vsftpd6)[1] ?? '') &&
    lines(await readAuthLog(WS)).length === 3,
  `status=${r6.status} lines=${JSON.stringify(lines(vsftpd6))}`,
);

const ftpTransfer = (machineId: string, over: Record<string, unknown> = {}) =>
  signRequest(player, 'appendAuthLog', {
    kind: 'ftpTransfer',
    machine_id: machineId,
    user: 'guest',
    from_ip: '127.0.0.1',
    direction: 'download',
    path: '/etc/passwd',
    bytes: 1243,
    ...over,
  });

const t1 = await post(PATCHES, await ftpTransfer(WS));
const vsftpdT1 = await readLog(WS, VSFTPD_LOG_PATH);
check(
  'a file taken over ftp on the own box is itemised after the login, in the same row',
  t1.status === 200 &&
    lines(vsftpdT1).length === 3 &&
    /\] \[guest\] OK DOWNLOAD: Client "127\.0\.0\.1", "\/etc\/passwd", 1243 bytes$/.test(
      lines(vsftpdT1)[2] ?? '',
    ),
  `status=${t1.status} last=${lines(vsftpdT1)[2] ?? '(empty)'}`,
);

const t2 = await post(
  PATCHES,
  await ftpTransfer(WS, { direction: 'upload', path: '/tmp/planted.sh', bytes: 0 }),
);
const vsftpdT2 = await readLog(WS, VSFTPD_LOG_PATH);
check(
  'a file left over ftp on the own box is itemised too',
  t2.status === 200 &&
    lines(vsftpdT2).length === 4 &&
    /\] \[guest\] OK UPLOAD: Client "127\.0\.0\.1", "\/tmp\/planted\.sh", 0 bytes$/.test(
      lines(vsftpdT2)[3] ?? '',
    ),
  `status=${t2.status} last=${lines(vsftpdT2)[3] ?? '(empty)'}`,
);

const t3 = await post(
  PATCHES,
  await ftpTransfer(WS, { path: '/tmp/x", 1 bytes\nforged line' }),
);
check(
  'a path that carries a line of its own is refused 400 and writes nothing',
  t3.status === 400 && lines(await readLog(WS, VSFTPD_LOG_PATH)).length === 4,
  `status=${t3.status} body=${JSON.stringify(t3.body)}`,
);

const t4 = await post(PATCHES, await ftpTransfer(FOREIGN));
check(
  'a transfer filed on another player’s box is refused 403 and writes nothing',
  t4.status === 403 && (await readLog(FOREIGN, VSFTPD_LOG_PATH)) === '',
  `status=${t4.status} body=${JSON.stringify(t4.body)}`,
);

const t5 = await post(
  PATCHES,
  await signRequest(player, 'recordFtpTransfer', {
    machine_id: WS,
    direction: 'download',
    path: '/etc/passwd',
    bytes: 1243,
  }),
);
check(
  'the transfer action still refuses the own box: it has no session row to name an account from',
  t5.status === 403 && lines(await readLog(WS, VSFTPD_LOG_PATH)).length === 4,
  `status=${t5.status} body=${JSON.stringify(t5.body)}`,
);

const r7 = await post(SESSIONS, await sshSession('ssh'));
check(
  'an own-box ssh session is held',
  r7.status === 200,
  `status=${r7.status} body=${JSON.stringify(r7.body)}`,
);

const r8 = await post(SESSIONS, await signRequest(player, 'listSessions', {}));
const open = (r8.body as { sessions?: readonly { session_id: string }[] } | null)?.sessions ?? [];
check(
  'listSessions reports it open, so the next line does not pop the shell',
  r8.status === 200 && open.some((row) => row.session_id === SESSION_ID),
  `status=${r8.status} open=${JSON.stringify(open.map((row) => row.session_id))}`,
);

const r9 = await post(SESSIONS, await sshSession('nc'));
check(
  'a kind no own-box shell produces is refused 400',
  r9.status === 400,
  `status=${r9.status} body=${JSON.stringify(r9.body)}`,
);

await wipe();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
