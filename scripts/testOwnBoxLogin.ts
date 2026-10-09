// Wire-payload check for a login to the player's OWN box — `ssh guest@localhost` at home.
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

const readAuthLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', player.publicKeyHex)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

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

const r5 = await post(SESSIONS, await sshSession('ssh'));
check(
  'an own-box ssh session is held',
  r5.status === 200,
  `status=${r5.status} body=${JSON.stringify(r5.body)}`,
);

const r6 = await post(SESSIONS, await signRequest(player, 'listSessions', {}));
const open = (r6.body as { sessions?: readonly { session_id: string }[] } | null)?.sessions ?? [];
check(
  'listSessions reports it open, so the next line does not pop the shell',
  r6.status === 200 && open.some((row) => row.session_id === SESSION_ID),
  `status=${r6.status} open=${JSON.stringify(open.map((row) => row.session_id))}`,
);

const r7 = await post(SESSIONS, await sshSession('nc'));
check(
  'a kind no own-box shell produces is refused 400',
  r7.status === 400,
  `status=${r7.status} body=${JSON.stringify(r7.body)}`,
);

await wipe();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
