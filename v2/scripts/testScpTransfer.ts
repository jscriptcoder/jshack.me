// Wire-payload smoke for the scp DOOR, both ways in — the own-LAN login and the
// cross-player one — against a running `vercel dev` + supabase.
//
// This is the FIRST live run of the `scp` kind. The command shipped in two slices
// behind a widened enum that nothing but unit tests (which fake `insertSession`) had
// ever exercised, so everything below is read off the real DDL and the real handlers
// rather than off the code that was meant to reach them.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `sessions.kind` really accepts a THIRD value. The column is `TEXT NOT NULL`
//     with no check constraint, which is a DDL reading until a row is inserted.
//   - scp rides sshd: the visit is written through the SSH spec into `auth.log`, and
//     the door has no log of its own to leave a second line in. There is no
//     `SERVICE_CATALOG.scp`, so a mapping that regressed would 500 rather than lie.
//   - the listening check applies to EVERY door alike, scp and ssh both. A box with
//     sshd down is shut to a transfer and to a login, for one reason and with one
//     error. The ssh exemption this script once asserted was removed once it was
//     found to be protecting nothing.
//   - the same on a public address: a forward names ONE internal port, so a forward
//     onto A's vsftpd is not a door a transfer can open.
//   - `resolveCrossPlayerFs` authorizes on ANY active row, so a transient scp row is
//     enough to read a stranger's box — and ending it is enough to stop. That is the
//     whole of what makes the download direction work across the network, and it is
//     one un-filtered session lookup away from being wrong.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testScpTransfer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { machineIdForLanHost, resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog';
import { clearPublicIps, seedPublicIps } from './networkFixture';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const readLog = async (machineId: string, path: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  return data as { content: string; writer_key: string } | null;
};

const sessionRow = async (sessionId: string) => {
  const { data } = await sr
    .from('sessions')
    .select('kind, ended_at, credentials, essid, machine_id')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data as {
    kind?: string;
    ended_at?: string | null;
    credentials?: { userType?: string };
    essid?: string | null;
    machine_id?: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Part one: the player's OWN LAN — the login the first two slices shipped behind.
// ---------------------------------------------------------------------------

const ESSID = 'SCP-LAB';
const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ssh));
// A box running no sshd: the refusal has to be a real answer about a real machine
// rather than a 404 that only means "no such host".
const doorless = lan.hosts.find(
  (host) => host.kind === 'machine' && !serves(host, SERVICE_CATALOG.ssh),
);

if (target === undefined || doorless === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a pair (ssh host: ${target?.ip ?? 'none'}, sshd-less host: ${doorless?.ip ?? 'none'}).`,
  );
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);
const doorlessMachine = machineIdForLanHost(doorless, ESSID);

/** One real account on the box, with the plaintext its hash was seeded from. */
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

const lanLogin = (options: {
  readonly sessionId: string;
  readonly host: LanHost;
  readonly username: string;
  readonly password: string;
  readonly kind?: string;
}) =>
  post(
    SESSIONS,
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

// ---------------------------------------------------------------------------
// Part two: somebody else's box, behind the port its owner forwarded.
// ---------------------------------------------------------------------------

const defender = generateIdentity();
const visitor = generateIdentity();

const A_ESSID = 'PIED-PIPER-GUEST';
const A_PUBLIC_IP = '203.0.113.78';
const A_GATEWAY = computeApGatewayId(A_ESSID);
const A_WS = computeWorkstationId('anton', defender.publicKeyHex);
const A_OCTET = 24;
const A_LAN_IP = lanAddressFor(A_ESSID, A_OCTET);
const A_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);
// Neither is 22 or 21: on a public address those belong to the AP's own gateway,
// which is a different machine entirely.
const SSH_FORWARD = 5544;
const FTP_FORWARD = 2121;

const B_ESSID = 'BEAN-THERE-WIFI';
const B_PUBLIC_IP = '198.51.100.45';
const B_WS = computeWorkstationId('cracklab', visitor.publicKeyHex);

const CARRIED = '/tmp/carried.txt';
const SEALED = '/root/carried.txt';
const SECRET = '/root/secret.txt';

const clean = async () => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  for (const id of [targetMachine, doorlessMachine, A_GATEWAY, A_WS, B_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
  await clearPublicIps(sr, [
    { essid: A_ESSID, publicIp: A_PUBLIC_IP },
    { essid: B_ESSID, publicIp: B_PUBLIC_IP },
  ]);
  for (const essid of [A_ESSID, B_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
};

const asDefender = (
  machineId: string,
  path: string,
  content: string,
  permissions: Record<string, readonly string[]> = { read: ['root'], write: ['root'], execute: [] },
) => ({
  machine_id: machineId,
  path,
  writer_key: defender.publicKeyHex,
  content,
  owner: 'root',
  node_type: 'file',
  permissions,
});

const publicLogin = (over: Record<string, unknown> = {}) =>
  signRequest(visitor, 'authCreateSessionPublic', {
    session_id: `scp-visitor-${Date.now()}-${Math.round(performance.now())}`,
    target: A_PUBLIC_IP,
    port: SSH_FORWARD,
    username: 'guest',
    password: A_GUEST_PW,
    parent_session_id: null,
    // The address B CLAIMS. It must never reach A's log — the checks below read A's
    // own file for the address the server derived instead.
    source_ip: '10.0.0.66',
    kind: 'scp',
    caller_machine_id: B_WS,
    ...over,
  });

/** A's box as the server materializes it for a visitor — the read the download
 *  direction is built on. Serialized names are what a tree is made of, so a path's
 *  last segment appearing in the answer means the file crossed the wire. */
const servedTree = async (): Promise<{ status: number; body: string }> => {
  const answer = await post(NETWORK, signRequest(visitor, 'resolveCrossPlayerFs', { machine_id: A_WS }));
  return { status: answer.status, body: JSON.stringify(answer.body) };
};

const main = async (): Promise<void> => {
  await clean();

  // --- 1-5. The own-LAN door, and the log it rides. ---
  const refused = await lanLogin({
    sessionId: 'scp-refused-1',
    host: target,
    username: account.username,
    password: 'not-the-password',
    kind: 'scp',
  });
  check(
    '1. a wrong password is refused and inserts no row',
    refused.status === 401 && (await sessionRow('scp-refused-1')) === null,
    `status ${refused.status}`,
  );

  const accepted = await lanLogin({
    sessionId: 'scp-session-1',
    host: target,
    username: account.username,
    password: account.password,
    kind: 'scp',
  });
  check(
    '2. a transfer login is accepted on a box serving sshd',
    accepted.status === 200,
    `status ${accepted.status} ${JSON.stringify(accepted.body)}`,
  );

  const inserted = await sessionRow('scp-session-1');
  check(
    '3. the row persists a THIRD kind — the DDL really does accept `scp`',
    inserted?.kind === 'scp',
    `kind=${inserted?.kind ?? 'no row'}`,
  );

  const afterLogin = await readLog(targetMachine, AUTH_LOG_PATH);
  check(
    '4. the visit is written through the SSH spec, indistinguishable from a login',
    afterLogin !== null && afterLogin.content.includes(`Accepted password for ${account.username}`),
    afterLogin === null ? 'no auth.log row' : afterLogin.content.trim().split('\n').slice(-1)[0]!,
  );
  check(
    '5. and the door leaves no log of its own — there is no scp line to forget to suppress',
    (await readLog(targetMachine, VSFTPD_LOG_PATH)) === null,
    'no second log on the target',
  );

  // --- 6. The row's whole lifetime is one command. ---
  const ended = await post(
    SESSIONS,
    signRequest(player, 'endSession', { session_id: 'scp-session-1' }),
  );
  const closed = await sessionRow('scp-session-1');
  check(
    '6. ending it closes the row the transfer opened',
    ended.status === 200 && closed?.ended_at !== null,
    `status ${ended.status}; ended_at=${closed?.ended_at === null ? 'null' : 'set'}`,
  );

  // --- 7/8. sshd down: shut to a transfer AND to a login. One question, asked once. ---
  const doorlessAccount = credential(doorless);
  const noDaemon = await lanLogin({
    sessionId: 'scp-nodoor-1',
    host: doorless,
    username: doorlessAccount.username,
    password: doorlessAccount.password,
    kind: 'scp',
  });
  check(
    '7. a correct credential on a box running no sshd is refused a transfer',
    noDaemon.status === 404,
    `status ${noDaemon.status} ${JSON.stringify(noDaemon.body)}`,
  );
  const plainSsh = await lanLogin({
    sessionId: 'ssh-nodoor-1',
    host: doorless,
    username: doorlessAccount.username,
    password: doorlessAccount.password,
  });
  check(
    '8. and a plain ssh login into the same box is refused for the same reason',
    plainSsh.status === 404 && errorOf(plainSsh.body) === 'service_not_running',
    `status ${plainSsh.status} ${errorOf(plainSsh.body)}`,
  );

  // --- The far side: A's network, A's forwards, A's running daemons. ---
  await seedPublicIps(sr, [{ essid: A_ESSID, publicIp: A_PUBLIC_IP }]);
  await sr
    .from('network_lan_leases')
    .insert({ essid: A_ESSID, owner_key: defender.publicKeyHex, octet: A_OCTET });
  await sr.from('home_network_occupants').insert({
    essid: A_ESSID,
    owner_key: defender.publicKeyHex,
    workstation_machine_id: A_WS,
    workstation_username: 'gilfoyle',
    workstation_machine_name: 'anton',
    workstation_root_hash: md5('defender-root-secret'),
  });
  await seedPublicIps(sr, [{ essid: B_ESSID, publicIp: B_PUBLIC_IP }]);
  await sr.from('home_network_occupants').insert({
    essid: B_ESSID,
    owner_key: visitor.publicKeyHex,
    workstation_machine_id: B_WS,
    workstation_username: 'mallory',
    workstation_machine_name: 'cracklab',
    workstation_root_hash: md5('visitor-root-secret'),
  });

  // A forward bridges two machines: the table lives on the GATEWAY, the daemons run
  // on A's box. Both doors are published, because one of them is what proves a
  // forward is not a door to every daemon.
  const seeded = await sr.from('patches').upsert(
    [
      asDefender(
        A_GATEWAY,
        '/etc/iptables/rules.v4',
        [`forward ${SSH_FORWARD} to ${A_LAN_IP}:22`, `forward ${FTP_FORWARD} to ${A_LAN_IP}:21`].join(
          '\n',
        ),
      ),
      asDefender(A_WS, '/var/run/sshd.pid', 'sshd:port=22'),
      asDefender(A_WS, '/var/run/vsftpd.pid', 'vsftpd:port=21'),
      asDefender(A_WS, SECRET, 'the-one-thing-guest-may-not-read\n'),
    ],
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (seeded.error) throw new Error(`forward seed failed: ${seeded.error.message}`);

  // --- 9-13. The cross-player login. ---
  const across = await post(SESSIONS, publicLogin({ session_id: 'scp-across-1' }));
  const landedOn = (across.body as { machine_id?: string } | null)?.machine_id;
  check(
    '9. a transfer login through the ssh forward lands on the box behind it',
    across.status === 200 && landedOn === A_WS,
    `status ${across.status}; ${JSON.stringify(across.body)}`,
  );

  const acrossRow = await sessionRow('scp-across-1');
  check(
    '10. the row records the door, the target network and the tier the credential bought',
    acrossRow?.kind === 'scp' &&
      acrossRow.essid === A_ESSID &&
      acrossRow.credentials?.userType === 'guest',
    JSON.stringify(acrossRow ?? null),
  );

  const aLog = await readLog(A_WS, AUTH_LOG_PATH);
  check(
    "11. A's auth.log names B's server-derived address, never the one B sent",
    aLog !== null &&
      aLog.content.includes('Accepted password for guest') &&
      aLog.content.includes(B_PUBLIC_IP) &&
      !aLog.content.includes('10.0.0.66'),
    aLog === null ? 'no auth.log row' : aLog.content.trim().split('\n').slice(-1)[0]!,
  );
  check(
    '12. under the BOX owner key, so every visitor accretes into one row A can read',
    aLog !== null && aLog.writer_key === defender.publicKeyHex,
    aLog === null ? 'no row' : `writer ${aLog.writer_key.slice(0, 12)}...`,
  );
  check(
    '13. and nothing reached the other door log across the network either',
    (await readLog(A_WS, VSFTPD_LOG_PATH)) === null,
    'no vsftpd.log on the target',
  );

  // --- 14. A forward names ONE internal port. ---
  const wrongDoor = await post(
    SESSIONS,
    publicLogin({ session_id: 'scp-wrongdoor-1', port: FTP_FORWARD }),
  );
  check(
    '14. a transfer onto a forward that reaches vsftpd is refused before the password counts',
    wrongDoor.status === 404 && errorOf(wrongDoor.body) === 'service_not_running',
    `status ${wrongDoor.status}; error ${errorOf(wrongDoor.body)}`,
  );

  // --- 15/16. The carry: an scp row authorizes a write through the SHIPPED endpoint. ---
  const carry = (path: string) =>
    post(
      PATCHES,
      signRequest(visitor, 'upsertPatch', {
        machine_id: A_WS,
        path,
        content: 'hunter2\nletmein\n',
        owner: 'guest',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
        node_type: 'file',
      }),
    );
  const landed = await carry(CARRIED);
  check(
    '15. a transfer session authorizes a write on the box, through the SAME gate ssh uses',
    landed.status === 200,
    `status ${landed.status}; ${JSON.stringify(landed.body)}`,
  );
  const sealed = await carry(SEALED);
  check(
    '16. and cannot write where its tier may not, across the network as on the LAN',
    sealed.status === 403,
    `status ${sealed.status}; error ${errorOf(sealed.body)}`,
  );

  // --- 17-19. The take: the read the download direction is built on. ---
  const withRow = await servedTree();
  check(
    '17. a transient transfer row is enough to be served the stranger box',
    withRow.status === 200 && withRow.body.includes('carried.txt'),
    `status ${withRow.status}; ${withRow.body.length} bytes of tree`,
  );
  check(
    '18. pruned to the tier the credential bought — what guest may not read never crosses',
    !withRow.body.includes('secret.txt'),
    'root-only file absent from the served tree',
  );

  await post(SESSIONS, signRequest(visitor, 'endSession', { session_id: 'scp-across-1' }));
  const afterEnd = await servedTree();
  check(
    '19. and ending the row ends the view — a transfer sees the box only while it is open',
    afterEnd.status === 200 && !afterEnd.body.includes('carried.txt'),
    `status ${afterEnd.status}; ${afterEnd.body.length} bytes of tree`,
  );

  await clean();

  const failed = results.filter((entry) => !entry.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

await main();
