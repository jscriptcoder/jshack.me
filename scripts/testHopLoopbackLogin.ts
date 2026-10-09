// Wire-check — `localhost` typed in a shell on a hop names the hop. The client cannot
// read that box's live `/var/run`, so it sends loopback for the server to place: a box
// the network generates through the own-LAN door, a player's workstation (which only
// its owner's lease places) through the same-LAN door. The daemon on the hop sees the
// knock come over loopback, so that is what the row and the line record. The facts
// under test, against the REAL session table and journal:
//   - an ssh login to 127.0.0.1 from a generated hop lands on the hop itself, the row
//     and the hop's auth.log naming 127.0.0.1;
//   - the port is checked server-side: a port the hop's sshd is not on is refused and
//     leaves no line;
//   - an ftp login to 127.0.0.1 from a generated hop lands as kind:ftp, the hop's
//     vsftpd log naming 127.0.0.1;
//   - from a shell on another player's workstation, an ssh login to 127.0.0.1 through
//     the same-LAN door lands on that workstation, its auth.log naming 127.0.0.1;
//   - an ftp login through the same-LAN door is traced in the workstation's vsftpd log,
//     never as an sshd line in its auth.log.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopLoopbackLogin.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { workstationGuestPassword } from '../src/core/generation/workstationFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { formatPidfileContent, readOpenPorts } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

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

const post = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signRequest(bob, action, payload)),
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
};

const ESSID = 'HOP-LOOPBACK-WIFI';
const CAROL_OCTET = 60;
const LOOPBACK = '127.0.0.1';

const bob = generateIdentity();
const carol = generateIdentity();
const CAROL_WS = computeWorkstationId('rig', carol.publicKeyHex);

/** A recoverable account password on a host, matched against the weak pool the way a
 *  cracker would — undefined when that account has no pool-derived password. */
const recover = (host: LanHost, username: string): string | undefined => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  const account = accountsIn(baseFs).find((candidate) => candidate.username === username);
  return ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account?.hash);
};

const portOf = (host: LanHost, service: string): number | undefined =>
  readOpenPorts(resolveLanHostIdentity(host, ESSID).baseFs).find(
    (open) => open.service === service,
  )?.port;

const machines = generateHomeLan(ESSID).hosts.filter((host) => host.kind === 'machine');
const sshHop = machines.find(
  (host) => portOf(host, SERVICE_CATALOG.ssh.service) !== undefined && recover(host, 'root'),
);
const ftpHop = machines.find(
  (host) =>
    host !== sshHop &&
    portOf(host, SERVICE_CATALOG.ftp.service) !== undefined &&
    recover(host, 'guest'),
);
if (sshHop === undefined || ftpHop === undefined) {
  console.error(`ESSID ${ESSID} lacks an ssh hop and an ftp hop — pick another.`);
  process.exit(2);
}
const SSH_HOP = machineIdForLanHost(sshHop, ESSID);
const FTP_HOP = machineIdForLanHost(ftpHop, ESSID);
const sshPort = portOf(sshHop, SERVICE_CATALOG.ssh.service)!;
const ftpPort = portOf(ftpHop, SERVICE_CATALOG.ftp.service)!;

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

/** Carol started a daemon on her workstation — a fresh one serves nothing until then. */
const daemonOn = (spec: (typeof SERVICE_CATALOG)['ssh' | 'ftp'], port: number) => ({
  machine_id: CAROL_WS,
  path: `/var/run/${spec.pidfile}`,
  content: formatPidfileContent(spec, port),
  owner: 'root',
  permissions: WORLD_PID,
  node_type: 'file',
  writer_key: carol.publicKeyHex,
  updated_at: new Date().toISOString(),
});

/** Bob already holds a root shell on `machineId` — how he got it is another check's. */
const shellOn = (sessionId: string, machineId: string) => ({
  session_id: sessionId,
  player_key: bob.publicKeyHex,
  machine_id: machineId,
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: null,
  source_ip: null,
  kind: 'ssh',
  essid: ESSID,
});

const row = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id, source_ip, kind')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as { machine_id: string; source_ip: string | null; kind: string } | null;
};

const logOf = async (machineId: string, path: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content: string | null } | null)?.content ?? '';
};

const lastLine = (content: string): string => content.trim().split('\n').at(-1) ?? '';

const cleanUp = async () => {
  await leaveNetwork(sr, ESSID);
  for (const machineId of [CAROL_WS, SSH_HOP, FTP_HOP]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
};

await cleanUp();
await standOnNetwork(sr, ESSID, carol, CAROL_OCTET);
await sr.from('patches').insert([
  daemonOn(SERVICE_CATALOG.ssh, 22),
  daemonOn(SERVICE_CATALOG.ftp, 21),
]);
await sr
  .from('sessions')
  .insert([
    shellOn('hop-ssh-1', SSH_HOP),
    shellOn('hop-ftp-1', FTP_HOP),
    shellOn('hop-carol-1', CAROL_WS),
  ]);

const networkWriter = apGatewayLogWriterKey(ESSID);

// === 1. ssh to 127.0.0.1 from a generated hop lands on the hop, over loopback. ===
const intoHop = await post('authCreateSession', {
  session_id: 'loop-ssh-1',
  essid: ESSID,
  target_ip: LOOPBACK,
  port: sshPort,
  username: 'root',
  password: recover(sshHop, 'root'),
  parent_session_id: 'hop-ssh-1',
  caller_machine_id: SSH_HOP,
  kind: 'ssh',
});
const sshRow = await row('loop-ssh-1');
check(
  'r1 ssh localhost from a generated hop lands on the hop, the row naming loopback',
  intoHop.status === 200 && sshRow?.machine_id === SSH_HOP && sshRow.source_ip === LOOPBACK,
  `status=${intoHop.status} row=${JSON.stringify(sshRow)}`,
);
const hopAuth = await logOf(SSH_HOP, AUTH_LOG_PATH, networkWriter);
check(
  'r2 the hop’s auth.log names 127.0.0.1',
  lastLine(hopAuth).includes(`Accepted password for root from ${LOOPBACK}`),
  lastLine(hopAuth) || '(no line)',
);

// === 2. The port is the server's to check: one the hop's sshd is not on is refused. ===
const offPort = await post('authCreateSession', {
  session_id: 'loop-ssh-2',
  essid: ESSID,
  target_ip: LOOPBACK,
  port: sshPort + 1000,
  username: 'root',
  password: recover(sshHop, 'root'),
  parent_session_id: 'hop-ssh-1',
  caller_machine_id: SSH_HOP,
  kind: 'ssh',
});
check(
  'r3 localhost on a port the hop’s sshd is not on is refused, leaving no line',
  offPort.status === 404 && (await logOf(SSH_HOP, AUTH_LOG_PATH, networkWriter)) === hopAuth,
  `status=${offPort.status} ${JSON.stringify(offPort.body)}`,
);

// === 3. ftp to 127.0.0.1 from a generated hop, traced in its vsftpd log. ===
const ftpIntoHop = await post('authCreateSession', {
  session_id: 'loop-ftp-1',
  essid: ESSID,
  target_ip: LOOPBACK,
  port: ftpPort,
  username: 'guest',
  password: recover(ftpHop, 'guest'),
  parent_session_id: 'hop-ftp-1',
  caller_machine_id: FTP_HOP,
  kind: 'ftp',
});
const ftpRow = await row('loop-ftp-1');
const hopVsftpd = await logOf(FTP_HOP, VSFTPD_LOG_PATH, networkWriter);
check(
  'r4 ftp localhost from a generated hop lands as kind:ftp, vsftpd naming 127.0.0.1',
  ftpIntoHop.status === 200 &&
    ftpRow?.machine_id === FTP_HOP &&
    ftpRow.kind === 'ftp' &&
    hopVsftpd.includes(`CONNECT: Client "${LOOPBACK}"`),
  `status=${ftpIntoHop.status} row=${JSON.stringify(ftpRow)} log=${lastLine(hopVsftpd)}`,
);

// === 4. From Carol's workstation, through the same-LAN door, to her box itself. ===
const intoCarol = await post('authCreateSessionSameLan', {
  session_id: 'loop-carol-1',
  essid: ESSID,
  target_ip: LOOPBACK,
  port: 22,
  username: 'guest',
  password: workstationGuestPassword(carol.publicKeyHex),
  parent_session_id: 'hop-carol-1',
  caller_machine_id: CAROL_WS,
});
const carolRow = await row('loop-carol-1');
const carolAuth = await logOf(CAROL_WS, AUTH_LOG_PATH, carol.publicKeyHex);
check(
  'r5 ssh localhost from Carol’s workstation lands on it, the row naming loopback',
  intoCarol.status === 200 && carolRow?.machine_id === CAROL_WS && carolRow.source_ip === LOOPBACK,
  `status=${intoCarol.status} row=${JSON.stringify(carolRow)}`,
);
check(
  'r6 Carol’s auth.log names 127.0.0.1',
  lastLine(carolAuth).includes(`Accepted password for guest from ${LOOPBACK}`),
  lastLine(carolAuth) || '(no line)',
);

// === 5. An ftp login through the same-LAN door goes to the door's own log. ===
const ftpIntoCarol = await post('authCreateSessionSameLan', {
  session_id: 'loop-carol-ftp-1',
  essid: ESSID,
  target_ip: LOOPBACK,
  port: 21,
  username: 'guest',
  password: workstationGuestPassword(carol.publicKeyHex),
  parent_session_id: 'hop-carol-1',
  caller_machine_id: CAROL_WS,
  kind: 'ftp',
});
const carolVsftpd = await logOf(CAROL_WS, VSFTPD_LOG_PATH, carol.publicKeyHex);
check(
  'r7 ftp through the same-LAN door is traced in vsftpd’s log, auth.log untouched',
  ftpIntoCarol.status === 200 &&
    carolVsftpd.includes(`[guest] OK LOGIN: Client "${LOOPBACK}"`) &&
    (await logOf(CAROL_WS, AUTH_LOG_PATH, carol.publicKeyHex)) === carolAuth,
  `status=${ftpIntoCarol.status} log=${lastLine(carolVsftpd) || '(no line)'}`,
);

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
