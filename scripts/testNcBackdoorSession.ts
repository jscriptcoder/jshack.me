// Wire-check: does connecting to a planted listener land a session whose USER AND
// TIER came off the pidfile — and does it really leave no trace?
//
// This is the security claim D5 slice 4 rests on, and `tsc` cannot see any of it.
// The tier is derived inside `handleAuthCreateSession`, from a tree the server
// rebuilds by replaying the target's journal; whether the row that lands carries
// that tier (rather than one the caller named) is a fact about a live endpoint and
// a live DB column. A unit test asserts the handler's return value; only this
// asserts the row.
//
// Three things are checked, and the second matters most:
//
//   1. a knock at a planted listener inserts a `kind:'nc'` session whose
//      credentials are the pidfile's;
//   2. the SAME knock, with `username: 'root'` in the payload against a
//      `userType=user` listener, still lands as `user` — a client cannot name its
//      own rank. Without this, a backdoor would be a privilege-escalation
//      primitive on any box anyone ever left one on;
//   3. nothing is written to the target's `/var/log/auth.log`. Locked decision 6
//      says a backdoor is silent, and silence is only provable against the real
//      journal — a handler that "returns without logging" could still be logged
//      by a shared helper further down.
//
// Drives the REAL endpoints against a running `vercel dev` + local supabase.
//
// Usage (from v2/, with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testNcBackdoorSession.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import {
  lanBaseFsForMachineId,
  machineIdForLanHost,
} from '../src/core/generation/lanHostIdentity';
import {
  formatListenerContent,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
} from '../src/core/services/pidfile';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';

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

// --- The world under test ------------------------------------------------------

const ESSID = 'BACKDOOR-WIFI';
const BACKDOOR_PORT = 4444;
const PLANTER = 'mallory';

const intruder = generateIdentity();

// An ordinary NPC sibling — the box the backdoor demo actually walks. Selecting on
// `kind: 'machine'` rather than "not .1" matters: the first non-.1 host this ESSID
// generates is an inner gateway, which is a different tree entirely.
const lanHosts = generateHomeLan(ESSID).hosts;
const npcHost = lanHosts.find(
  (host) =>
    host.kind === 'machine' &&
    lanBaseFsForMachineId(ESSID, machineIdForLanHost(host, ESSID)) !== null,
);
if (npcHost === undefined) {
  console.error(`No ordinary NPC host (kind 'machine') generated for ESSID ${ESSID}`);
  process.exit(2);
}
const NPC_MACHINE = machineIdForLanHost(npcHost, ESSID);

/** Plant a listener on the NPC's journal, exactly as `nc -l` would have. Written
 *  under the intruder's key at root, since only root could have written it. */
const plantListener = async (userType: 'root' | 'user') => {
  await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
  await sr.from('patches').insert({
    machine_id: NPC_MACHINE,
    writer_key: intruder.publicKeyHex,
    path: listenerPidfilePath(BACKDOOR_PORT),
    content: formatListenerContent({ port: BACKDOOR_PORT, user: PLANTER, userType }),
    owner: 'root',
    permissions: PIDFILE_PERMISSIONS,
    is_new: true,
    node_type: 'file',
  });
};

const knock = (sessionId: string, claim: Record<string, unknown> = {}) =>
  post(
    signRequest(intruder, 'authCreateSession', {
      session_id: sessionId,
      essid: ESSID,
      target_ip: npcHost.ip,
      port: BACKDOOR_PORT,
      kind: 'nc',
      parent_session_id: null,
      source_ip: null,
      ...claim,
    }),
  );

const sessionRow = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id, credentials, kind')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as {
    machine_id: string;
    credentials: { username: string; userType: string };
    kind: string;
  } | null;
};

const authLogRows = async (): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('path')
    .eq('machine_id', NPC_MACHINE)
    .eq('path', AUTH_LOG_PATH);
  return data?.length ?? 0;
};

// --- Setup ---------------------------------------------------------------------
// Generated hosts are ESSID-seeded, so NPC_MACHINE is identical across runs — a
// crashed run would otherwise leave rows this one reads as its own.
await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);

// --- 1. A knock at a planted listener opens as whoever planted it ---------------

await plantListener('user');
const opened = await knock('nc-wire-1');
const openedRow = await sessionRow('nc-wire-1');
check(
  'a planted listener opens a session',
  opened.status === 200 && openedRow !== null && openedRow.kind === 'nc',
  `status ${opened.status}, row ${openedRow === null ? 'absent' : `kind=${openedRow.kind}`}`,
);
check(
  'the row carries the pidfile’s user, on the machine that holds it',
  openedRow?.credentials.username === PLANTER && openedRow?.machine_id === NPC_MACHINE,
  `username=${openedRow?.credentials.username ?? '—'}, machine=${openedRow?.machine_id ?? '—'}`,
);

// --- 2. The tier is the pidfile's, never the caller's ---------------------------
// The payload names root against a user-tier listener. If the row comes back root,
// a backdoor is a way to mint privilege rather than inherit it.

await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);
const claimed = await knock('nc-wire-2', { username: 'root', password: '' });
const claimedRow = await sessionRow('nc-wire-2');
check(
  'a client claiming root against a user-tier listener lands as user',
  claimed.status === 200 && claimedRow?.credentials.userType === 'user',
  `status ${claimed.status}, tier=${claimedRow?.credentials.userType ?? '—'}`,
);

// A root-planted listener DOES land root — proving the tier is read rather than
// pinned to the safe answer, which the check above alone cannot tell apart.
await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);
await plantListener('root');
const asRoot = await knock('nc-wire-3');
const rootRow = await sessionRow('nc-wire-3');
check(
  'a root-planted listener really does land root',
  asRoot.status === 200 && rootRow?.credentials.userType === 'root',
  `status ${asRoot.status}, tier=${rootRow?.credentials.userType ?? '—'}`,
);

// --- 3. Nothing is written anywhere --------------------------------------------

const logged = await authLogRows();
check(
  'the target’s auth.log is untouched — a backdoor is silent',
  logged === 0,
  `${logged} auth.log row(s) on ${NPC_MACHINE}`,
);

// --- 4. A port no listener holds is no door ------------------------------------

await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);
const shut = await post(
  signRequest(intruder, 'authCreateSession', {
    session_id: 'nc-wire-4',
    essid: ESSID,
    target_ip: npcHost.ip,
    port: 9999,
    kind: 'nc',
    parent_session_id: null,
    source_ip: null,
  }),
);
check(
  'a port no listener holds refuses, and lands no row',
  shut.status === 404 && (await sessionRow('nc-wire-4')) === null,
  `status ${shut.status}`,
);

// --- Teardown ------------------------------------------------------------------

await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
