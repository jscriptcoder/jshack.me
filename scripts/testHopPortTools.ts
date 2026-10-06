// Wire-payload check for the file-transfer doors operating from a hop — the claim no
// unit test can make, because it is the REAL journal and the REAL session table that
// place the caller and route the trace.
//
// A player with a shell on a box runs `ftp`/`scp` FROM that box: the login lands on a
// host on the hop's LAN, the target records it under the HOP's own address, and the
// session row carries the door's own kind. The two doors route their trace to different
// files — ftp to the target's vsftpd log, scp (an ssh transfer) to auth.log — a split a
// unit test only sees against a spy, never against the table. So the facts under test:
//   - an `ftp` login from a held hop lands as a `kind:'ftp'` session, and the target's
//     vsftpd log names the HOP's LAN address (keyed to the network, `ap:<essid>`);
//   - an `scp` login from the same hop lands as a `kind:'scp'` session, and the target's
//     AUTH.LOG (not vsftpd) names the HOP's address;
//   - a login NAMING a network the caller is not standing on is refused (403);
//   - a login naming a box the caller holds NO session on is refused (403);
//   - an `nc` connect from the hop opens a planted listener on a box on the hop's LAN,
//     landing a `kind:'nc'` session on that box;
//   - `nc localhost` from the hop resolves to the box the shell stands ON — loopback is
//     sent for the server to place, and the session lands on the HOP itself.
//
// The occupant and public arms reuse the endpoints ssh's own wire-checks already cover
// (testHopSidewaysLogin, testDeepLayerSsh), and an occupant login is unstageable against
// a fresh player box that runs no ftp — so neither is re-proven here.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopPortTools.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import {
  formatListenerContent,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
  readOpenPorts,
} from '../src/core/services/pidfile.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { md5 } from '../src/core/generation/md5.js';
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

const mustNotFail = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
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

const ESSID = 'HOP-PORTTOOLS-WIFI';
const HOME_OCTET = 27;

const op = generateIdentity();

const runs = (host: LanHost, spec: unknown): boolean =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

/** A recoverable account password on a host, matched against the weak pool the way a
 *  cracker would — undefined when that account has no pool-derived password. */
const recover = (host: LanHost, username: string): string | undefined => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  const account = accountsIn(baseFs).find((candidate) => candidate.username === username);
  return ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account?.hash);
};

const servingPort = (host: LanHost, serviceSpec: unknown): number | undefined => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  return readOpenPorts(baseFs).find((open) => open.service === (serviceSpec as { service: string }).service)
    ?.port;
};

const machines = generateHomeLan(ESSID).hosts.filter((host) => host.kind === 'machine');
const ftpHost = machines.find((host) => runs(host, SERVICE_CATALOG.ftp) && recover(host, 'guest'));
const scpHost = machines.find((host) => runs(host, SERVICE_CATALOG.ssh) && recover(host, 'root'));
const hop = machines.find((host) => host !== ftpHost && host !== scpHost);
const unheld = machines.find((host) => host !== ftpHost && host !== scpHost && host !== hop);

if (ftpHost === undefined || scpHost === undefined || hop === undefined || unheld === undefined) {
  console.error(`ESSID ${ESSID} lacks an ftp host, an ssh host, a hop and a spare — pick another.`);
  process.exit(2);
}

const ftpPort = servingPort(ftpHost, SERVICE_CATALOG.ftp);
const scpPort = servingPort(scpHost, SERVICE_CATALOG.ssh);
const guestPw = recover(ftpHost, 'guest');
const rootPw = recover(scpHost, 'root');
if (ftpPort === undefined || scpPort === undefined || guestPw === undefined || rootPw === undefined) {
  console.error('Chosen hosts lost their door or recoverable account — pick another ESSID.');
  process.exit(2);
}

const hopMachine = machineIdForLanHost(hop, ESSID);
const ftpMachine = machineIdForLanHost(ftpHost, ESSID);
const scpMachine = machineIdForLanHost(scpHost, ESSID);
const unheldMachine = machineIdForLanHost(unheld, ESSID);

// A listener someone left behind — the door `nc` connects to. 4444 is no catalog
// service, so the box can only answer for it through the planted pidfile.
const BACKDOOR_PORT = 4444;

/** A door login from the caller's current stance. `callerMachineId` names the box the
 *  shell is standing on; `kind` is the door being knocked on. */
const login = (params: {
  readonly sessionId: string;
  readonly essid: string;
  readonly targetIp: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly kind: 'ftp' | 'scp';
  readonly callerMachineId?: string;
}) =>
  post(
    signRequest(op, 'authCreateSession', {
      session_id: params.sessionId,
      essid: params.essid,
      target_ip: params.targetIp,
      port: params.port,
      username: params.username,
      password: params.password,
      parent_session_id: null,
      kind: params.kind,
      ...(params.callerMachineId === undefined ? {} : { caller_machine_id: params.callerMachineId }),
    }),
  );

const sessionKind = async (sessionId: string): Promise<string | undefined> => {
  const { data, error } = await sr.from('sessions').select('kind').eq('session_id', sessionId);
  mustNotFail('sessions read', error);
  return (data?.[0] as { kind?: string } | undefined)?.kind;
};

const sessionMachine = async (sessionId: string): Promise<string | undefined> => {
  const { data, error } = await sr.from('sessions').select('machine_id').eq('session_id', sessionId);
  mustNotFail('sessions read', error);
  return (data?.[0] as { machine_id?: string } | undefined)?.machine_id;
};

/** A backdoor knock — `nc` carries no account, so there is no username or password to
 *  send: the pidfile on the far side names who it admits. */
const ncKnock = (params: {
  readonly sessionId: string;
  readonly targetIp: string;
  readonly port: number;
  readonly callerMachineId: string;
}) =>
  post(
    signRequest(op, 'authCreateSession', {
      session_id: params.sessionId,
      essid: ESSID,
      target_ip: params.targetIp,
      port: params.port,
      parent_session_id: null,
      kind: 'nc',
      caller_machine_id: params.callerMachineId,
    }),
  );

/** Leave a listener in a box's journal, the way `nc -l` would — the one row that IS the
 *  open port, world-readable so the network can see it. */
const plantListener = (machineId: string, user: string, userType: 'root' | 'user' | 'guest') =>
  sr.from('patches').insert({
    machine_id: machineId,
    path: listenerPidfilePath(BACKDOOR_PORT),
    content: formatListenerContent({ port: BACKDOOR_PORT, user, userType }),
    owner: 'root',
    permissions: PIDFILE_PERMISSIONS,
    node_type: 'file',
    writer_key: op.publicKeyHex,
  });

const logContent = async (machineId: string, path: string): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', apGatewayLogWriterKey(ESSID));
  mustNotFail('log read', error);
  return (data ?? []).map((row) => (row as { content: string }).content).join('\n');
};

const seedHopSession = () =>
  sr.from('sessions').insert({
    session_id: 'hop-shell-1',
    player_key: op.publicKeyHex,
    machine_id: hopMachine,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  });

const cleanUp = async () => {
  await leaveNetwork(sr, ESSID);
  for (const machineId of [ftpMachine, scpMachine, hopMachine]) {
    await sr.from('patches').delete().eq('machine_id', machineId).eq('path', AUTH_LOG_PATH);
    await sr.from('patches').delete().eq('machine_id', machineId).eq('path', VSFTPD_LOG_PATH);
  }
  for (const machineId of [unheldMachine, hopMachine]) {
    await sr.from('patches').delete().eq('machine_id', machineId).eq('path', listenerPidfilePath(BACKDOOR_PORT));
  }
  await sr.from('sessions').delete().eq('player_key', op.publicKeyHex);
};

const main = async () => {
  console.log(
    `Hop ${hop.ip} (${hopMachine})\n` +
      `  ftp target ${ftpHost.ip}:${ftpPort} (guest)\n` +
      `  scp target ${scpHost.ip}:${scpPort} (root)\n` +
      `  on ${ESSID}`,
  );

  // Seeded machine_ids are identical across runs, so a crashed earlier run would leave
  // rows this one reads as its own.
  await cleanUp();
  await standOnNetwork(sr, ESSID, op, HOME_OCTET);
  mustNotFail('seed hop session', (await seedHopSession()).error as { message: string } | null);

  // === 1. An ftp login from the hop lands, as its own kind, traced to the hop. ===
  const ftpLogin = await login({
    sessionId: 'ftp-from-hop-1',
    essid: ESSID,
    targetIp: ftpHost.ip,
    port: ftpPort,
    username: 'guest',
    password: guestPw,
    kind: 'ftp',
    callerMachineId: hopMachine,
  });
  check(
    'an ftp login from the hop lands',
    ftpLogin.status === 200,
    `status=${ftpLogin.status} ${JSON.stringify(ftpLogin.body)}`,
  );
  check(
    'the ftp session row carries kind:ftp, not ssh',
    (await sessionKind('ftp-from-hop-1')) === 'ftp',
    `kind=${await sessionKind('ftp-from-hop-1')}`,
  );
  const ftpLog = await logContent(ftpMachine, VSFTPD_LOG_PATH);
  check(
    'the ftp target’s vsftpd log names the HOP’s address, and auth.log is untouched',
    ftpLog.includes(hop.ip) && (await logContent(ftpMachine, AUTH_LOG_PATH)) === '',
    ftpLog.trim().split('\n').at(-1) ?? '(no vsftpd row)',
  );

  // === 2. An scp login from the hop lands as its own kind, traced to auth.log. ===
  const scpLogin = await login({
    sessionId: 'scp-from-hop-1',
    essid: ESSID,
    targetIp: scpHost.ip,
    port: scpPort,
    username: 'root',
    password: rootPw,
    kind: 'scp',
    callerMachineId: hopMachine,
  });
  check(
    'an scp login from the hop lands',
    scpLogin.status === 200,
    `status=${scpLogin.status} ${JSON.stringify(scpLogin.body)}`,
  );
  check(
    'the scp session row carries kind:scp',
    (await sessionKind('scp-from-hop-1')) === 'scp',
    `kind=${await sessionKind('scp-from-hop-1')}`,
  );
  const scpLog = await logContent(scpMachine, AUTH_LOG_PATH);
  check(
    'the scp target’s AUTH.LOG names the HOP’s address (scp is an ssh transfer), vsftpd untouched',
    scpLog.includes(hop.ip) && (await logContent(scpMachine, VSFTPD_LOG_PATH)) === '',
    scpLog.trim().split('\n').at(-1) ?? '(no auth row)',
  );

  // === 3. A login naming a network the caller is not standing on is refused. ===
  const craftedEssid = await login({
    sessionId: 'ftp-crafted-1',
    essid: 'SOME-OTHER-WIFI',
    targetIp: ftpHost.ip,
    port: ftpPort,
    username: 'guest',
    password: guestPw,
    kind: 'ftp',
    callerMachineId: hopMachine,
  });
  check(
    'an ftp login claiming a network the caller is not on is refused',
    craftedEssid.status === 403,
    `status=${craftedEssid.status} ${JSON.stringify(craftedEssid.body)}`,
  );

  // === 4. A login naming a box the caller holds no session on is refused. ===
  const noSession = await login({
    sessionId: 'ftp-nosession-1',
    essid: ESSID,
    targetIp: ftpHost.ip,
    port: ftpPort,
    username: 'guest',
    password: guestPw,
    kind: 'ftp',
    callerMachineId: unheldMachine,
  });
  check(
    'an ftp login from a box the caller holds no session on is refused',
    noSession.status === 403,
    `status=${noSession.status} ${JSON.stringify(noSession.body)}`,
  );

  // === 5. An nc connect from the hop opens a listener on a box on the hop's own LAN. ===
  const lanPlant = await plantListener(unheldMachine, 'mallory', 'user');
  mustNotFail('plant LAN listener', lanPlant.error as { message: string } | null);
  const ncLan = await ncKnock({
    sessionId: 'nc-from-hop-1',
    targetIp: unheld.ip,
    port: BACKDOOR_PORT,
    callerMachineId: hopMachine,
  });
  check(
    'an nc connect from the hop opens a listener on the hop’s LAN',
    ncLan.status === 200,
    `status=${ncLan.status} ${JSON.stringify(ncLan.body)}`,
  );
  check(
    'the nc session row carries kind:nc and lands on the box the listener is on',
    (await sessionKind('nc-from-hop-1')) === 'nc' &&
      (await sessionMachine('nc-from-hop-1')) === unheldMachine,
    `kind=${await sessionKind('nc-from-hop-1')} machine=${await sessionMachine('nc-from-hop-1')}`,
  );

  // === 6. `nc localhost` from the hop reaches a listener on the HOP ITSELF. ===
  // The client sends loopback; the server resolves it to the box the shell stands on and
  // lands the session there — the own-box door the home card still refuses.
  const hopPlant = await plantListener(hopMachine, 'root', 'root');
  mustNotFail('plant hop listener', hopPlant.error as { message: string } | null);
  const ncLoopback = await ncKnock({
    sessionId: 'nc-localhost-1',
    targetIp: '127.0.0.1',
    port: BACKDOOR_PORT,
    callerMachineId: hopMachine,
  });
  check(
    'an nc localhost connect from the hop lands on the hop itself',
    ncLoopback.status === 200 && (await sessionMachine('nc-localhost-1')) === hopMachine,
    `status=${ncLoopback.status} machine=${await sessionMachine('nc-localhost-1')} ${JSON.stringify(ncLoopback.body)}`,
  );
  check(
    'the nc localhost session carries kind:nc',
    (await sessionKind('nc-localhost-1')) === 'nc',
    `kind=${await sessionKind('nc-localhost-1')}`,
  );

  await cleanUp();

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

void main();
